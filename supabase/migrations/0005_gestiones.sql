-- ══════════════════════════════════════════════════════════════════════
--  0005 — Multi-gestión (Fase 4A)
--  Idempotente. Ejecutar en: Supabase Dashboard → SQL Editor → New query
-- ══════════════════════════════════════════════════════════════════════
--
--  OBJETIVO: al entrar una gestión nueva se arranca de cero y la anterior
--  queda accesible en solo lectura.
--
--  BLOQUEOS ESTRUCTURALES QUE RESUELVE (verificados contra la base real):
--    · periodos_evaluacion.nombre es UNIQUE GLOBAL → no puede haber "PE1"
--      en 2026-2027 y "PE1" en 2027-2028.
--    · criterios.key es UNIQUE GLOBAL → clonar los criterios a la gestión
--      nueva violaría la restricción.
--    · config.clave es PK → la misma clave no puede existir en dos gestiones.
--    · trabajos_entregados guarda periodo_nombre TEXT: en cuanto los nombres
--      de PE se repitan entre gestiones deja de poder resolverse.
--
--  NO toca profiles: mover tipo_miembro/distrito/rol_id a gestion_miembros
--  va en la migración 0006, aparte, porque obliga a reescribir 5 funciones
--  SECURITY DEFINER y 5 policies.
--
--  Backfill: todo lo existente se asigna a la gestión "2026-2027".
-- ══════════════════════════════════════════════════════════════════════


-- ── 1. Tabla de gestiones ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gestiones (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre     TEXT        NOT NULL UNIQUE,
  inicio     DATE,
  fin        DATE,
  activa     BOOLEAN     NOT NULL DEFAULT false,
  archivada  BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Una sola gestión activa, garantizado por la base (mismo patrón que 0003).
DROP INDEX IF EXISTS public.gestiones_solo_una_activa;
CREATE UNIQUE INDEX gestiones_solo_una_activa
  ON public.gestiones (activa) WHERE activa;

ALTER TABLE public.gestiones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gestiones_read"  ON public.gestiones;
CREATE POLICY "gestiones_read"
  ON public.gestiones FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "gestiones_admin" ON public.gestiones;
CREATE POLICY "gestiones_admin"
  ON public.gestiones FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Gestión inicial. Solo se crea la primera vez.
INSERT INTO public.gestiones (nombre, activa, archivada)
SELECT '2026-2027', true, false
 WHERE NOT EXISTS (SELECT 1 FROM public.gestiones);


-- ── 2. gestion_id en las tablas de configuración ──────────────────────
DO $mig$
DECLARE g BIGINT;
BEGIN
  SELECT id INTO g FROM public.gestiones ORDER BY created_at LIMIT 1;

  -- periodos_evaluacion
  ALTER TABLE public.periodos_evaluacion ADD COLUMN IF NOT EXISTS gestion_id BIGINT;
  UPDATE public.periodos_evaluacion SET gestion_id = g WHERE gestion_id IS NULL;

  -- criterios
  ALTER TABLE public.criterios ADD COLUMN IF NOT EXISTS gestion_id BIGINT;
  UPDATE public.criterios SET gestion_id = g WHERE gestion_id IS NULL;

  -- rubrica
  ALTER TABLE public.rubrica ADD COLUMN IF NOT EXISTS gestion_id BIGINT;
  UPDATE public.rubrica SET gestion_id = g WHERE gestion_id IS NULL;

  -- calendario
  ALTER TABLE public.calendario ADD COLUMN IF NOT EXISTS gestion_id BIGINT;
  UPDATE public.calendario SET gestion_id = g WHERE gestion_id IS NULL;

  -- config
  ALTER TABLE public.config ADD COLUMN IF NOT EXISTS gestion_id BIGINT;
  UPDATE public.config SET gestion_id = g WHERE gestion_id IS NULL;
END $mig$;

-- NOT NULL + FK una vez rellenado
ALTER TABLE public.periodos_evaluacion ALTER COLUMN gestion_id SET NOT NULL;
ALTER TABLE public.criterios           ALTER COLUMN gestion_id SET NOT NULL;
ALTER TABLE public.rubrica             ALTER COLUMN gestion_id SET NOT NULL;
ALTER TABLE public.calendario          ALTER COLUMN gestion_id SET NOT NULL;
ALTER TABLE public.config              ALTER COLUMN gestion_id SET NOT NULL;

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='periodos_gestion_fk') THEN
    ALTER TABLE public.periodos_evaluacion ADD CONSTRAINT periodos_gestion_fk
      FOREIGN KEY (gestion_id) REFERENCES public.gestiones(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='criterios_gestion_fk') THEN
    ALTER TABLE public.criterios ADD CONSTRAINT criterios_gestion_fk
      FOREIGN KEY (gestion_id) REFERENCES public.gestiones(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rubrica_gestion_fk') THEN
    ALTER TABLE public.rubrica ADD CONSTRAINT rubrica_gestion_fk
      FOREIGN KEY (gestion_id) REFERENCES public.gestiones(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='calendario_gestion_fk') THEN
    ALTER TABLE public.calendario ADD CONSTRAINT calendario_gestion_fk
      FOREIGN KEY (gestion_id) REFERENCES public.gestiones(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='config_gestion_fk') THEN
    ALTER TABLE public.config ADD CONSTRAINT config_gestion_fk
      FOREIGN KEY (gestion_id) REFERENCES public.gestiones(id) ON DELETE RESTRICT;
  END IF;
END $fk$;


-- ── 3. Unicidad POR GESTIÓN, no global ────────────────────────────────
ALTER TABLE public.periodos_evaluacion DROP CONSTRAINT IF EXISTS periodos_evaluacion_nombre_key;
DROP INDEX IF EXISTS public.periodos_nombre_por_gestion;
CREATE UNIQUE INDEX periodos_nombre_por_gestion
  ON public.periodos_evaluacion (gestion_id, nombre);

ALTER TABLE public.criterios DROP CONSTRAINT IF EXISTS criterios_key_key;
DROP INDEX IF EXISTS public.criterios_key_por_gestion;
CREATE UNIQUE INDEX criterios_key_por_gestion
  ON public.criterios (gestion_id, key);

-- config: la PK pasa a ser compuesta
ALTER TABLE public.config DROP CONSTRAINT IF EXISTS config_pkey;
DO $pk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='config_pkey') THEN
    ALTER TABLE public.config ADD CONSTRAINT config_pkey PRIMARY KEY (gestion_id, clave);
  END IF;
END $pk$;

-- Un período activo POR GESTIÓN (sustituye al índice global de 0003)
DROP INDEX IF EXISTS public.periodos_solo_uno_activo;
DROP INDEX IF EXISTS public.periodos_un_activo_por_gestion;
CREATE UNIQUE INDEX periodos_un_activo_por_gestion
  ON public.periodos_evaluacion (gestion_id) WHERE activo;


-- ── 4. trabajos_entregados: periodo_nombre TEXT → periodo_id UUID ─────
--  Crítico: los nombres de PE se repiten entre gestiones, así que esto
--  solo puede resolverse mientras exista una sola gestión.
ALTER TABLE public.trabajos_entregados ADD COLUMN IF NOT EXISTS periodo_id UUID;

UPDATE public.trabajos_entregados t
   SET periodo_id = p.id
  FROM public.periodos_evaluacion p
 WHERE t.periodo_id IS NULL
   AND p.nombre = t.periodo_nombre;

DO $tw$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trabajos_periodo_fk') THEN
    ALTER TABLE public.trabajos_entregados ADD CONSTRAINT trabajos_periodo_fk
      FOREIGN KEY (periodo_id) REFERENCES public.periodos_evaluacion(id) ON DELETE CASCADE;
  END IF;
END $tw$;

-- Solo se retira la columna vieja si NO quedó ninguna fila sin resolver.
DO $drop$
DECLARE huerfanos INT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='trabajos_entregados'
                AND column_name='periodo_nombre') THEN
    SELECT count(*) INTO huerfanos
      FROM public.trabajos_entregados WHERE periodo_id IS NULL;
    IF huerfanos = 0 THEN
      ALTER TABLE public.trabajos_entregados DROP COLUMN periodo_nombre;
    ELSE
      RAISE WARNING 'periodo_nombre NO se elimino: % filas sin periodo_id resuelto', huerfanos;
    END IF;
  END IF;
END $drop$;


-- ── 5. Lo pasado se lee siempre, se escribe nunca ─────────────────────
CREATE OR REPLACE FUNCTION public.gestion_escribible(p_periodo_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT NOT g.archivada
       FROM periodos_evaluacion p
       JOIN gestiones g ON g.id = p.gestion_id
      WHERE p.id = p_periodo_id),
    false);
$$;

-- Se añade SOLO al WITH CHECK: las policies de lectura no cambian.
DROP POLICY IF EXISTS "evaluaciones_admin" ON public.evaluaciones;
CREATE POLICY "evaluaciones_admin"
  ON public.evaluaciones FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin() AND public.gestion_escribible(periodo_id));

DROP POLICY IF EXISTS "eval_dist_admin" ON public.evaluaciones_distrito;
CREATE POLICY "eval_dist_admin"
  ON public.evaluaciones_distrito FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin() AND public.gestion_escribible(periodo_id));

DROP POLICY IF EXISTS "trabajos_write_own" ON public.trabajos_entregados;
CREATE POLICY "trabajos_write_own"
  ON public.trabajos_entregados FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.gestion_escribible(periodo_id));


-- ── 6. Abrir una gestión nueva ────────────────────────────────────────
--  Archiva la activa, crea la nueva y clona criterios/rúbrica/calendario
--  como plantilla editable. Arranca con CERO evaluaciones y CERO miembros.
CREATE OR REPLACE FUNCTION public.abrir_gestion(p_nombre TEXT, p_clonar_de BIGINT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id     BIGINT;
  v_origen BIGINT;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede abrir una gestion.' USING ERRCODE = '42501';
  END IF;

  v_origen := COALESCE(p_clonar_de, (SELECT id FROM gestiones WHERE activa LIMIT 1));

  UPDATE gestiones SET activa = false, archivada = true WHERE activa;

  INSERT INTO gestiones (nombre, activa, archivada)
  VALUES (p_nombre, true, false)
  RETURNING id INTO v_id;

  IF v_origen IS NOT NULL THEN
    -- Criterios + rúbrica en un solo paso: la rúbrica referencia criterio_id,
    -- así que hay que remapearlo a los criterios recién clonados. El join se
    -- hace por `key`, único dentro de cada gestión.
    WITH nuevos AS (
      INSERT INTO criterios (gestion_id, key, label, abbr, color, orden, activo, max)
      SELECT v_id, key, label, abbr, color, orden, activo, max
        FROM criterios WHERE gestion_id = v_origen
      RETURNING id, key
    )
    INSERT INTO rubrica (gestion_id, criterio_id, criterio, nivel4, nivel3, nivel2, nivel1, orden)
    SELECT v_id, n.id, r.criterio, r.nivel4, r.nivel3, r.nivel2, r.nivel1, r.orden
      FROM rubrica r
      JOIN criterios c ON c.id = r.criterio_id
      JOIN nuevos    n ON n.key = c.key
     WHERE r.gestion_id = v_origen;

    -- Calendario: se clona la estructura, NO las fechas (son de otro año).
    INSERT INTO calendario (gestion_id, numero, titulo, descripcion, color, estado)
    SELECT v_id, numero, titulo, descripcion, color, 'Pendiente'
      FROM calendario WHERE gestion_id = v_origen;

    -- Períodos base, sin fechas y sin ninguno activo.
    INSERT INTO periodos_evaluacion (gestion_id, nombre, descripcion, activo)
    SELECT v_id, nombre, descripcion, false
      FROM periodos_evaluacion WHERE gestion_id = v_origen;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.abrir_gestion(TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abrir_gestion(TEXT, BIGINT) TO authenticated;

-- set_periodo_activo pasa a ser consciente de la gestión: desactiva solo
-- dentro de la gestión del período indicado.
CREATE OR REPLACE FUNCTION public.set_periodo_activo(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_gestion BIGINT;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede cambiar el periodo activo.' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    UPDATE periodos_evaluacion SET activo = false
     WHERE activo AND gestion_id = (SELECT id FROM gestiones WHERE activa LIMIT 1);
    RETURN;
  END IF;

  SELECT gestion_id INTO v_gestion FROM periodos_evaluacion WHERE id = p_id;
  IF v_gestion IS NULL THEN
    RAISE EXCEPTION 'No existe el periodo %', p_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE periodos_evaluacion SET activo = false
   WHERE activo AND gestion_id = v_gestion AND id <> p_id;

  UPDATE periodos_evaluacion SET activo = true WHERE id = p_id;
END;
$$;


-- ── VERIFICACIÓN ──────────────────────────────────────────────────────
-- 1 gestión activa, 4 períodos asignados:
--   SELECT g.nombre, g.activa, count(p.id) FROM gestiones g
--     LEFT JOIN periodos_evaluacion p ON p.gestion_id=g.id GROUP BY 1,2;
--
-- Ninguna fila sin resolver y la columna vieja fuera:
--   SELECT count(*) FROM trabajos_entregados WHERE periodo_id IS NULL;
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='trabajos_entregados' AND column_name='periodo_nombre';
--
-- La unicidad ya no es global:
--   SELECT indexname FROM pg_indexes WHERE tablename='periodos_evaluacion';


-- ══════════════════════════════════════════════════════════════════════
-- -- DOWN (revertir)
-- ══════════════════════════════════════════════════════════════════════
-- DROP FUNCTION IF EXISTS public.abrir_gestion(TEXT, BIGINT);
-- DROP FUNCTION IF EXISTS public.gestion_escribible(UUID);
-- DROP INDEX IF EXISTS public.periodos_un_activo_por_gestion;
-- DROP INDEX IF EXISTS public.periodos_nombre_por_gestion;
-- DROP INDEX IF EXISTS public.criterios_key_por_gestion;
-- ALTER TABLE public.periodos_evaluacion DROP COLUMN IF EXISTS gestion_id;
-- ALTER TABLE public.criterios  DROP COLUMN IF EXISTS gestion_id;
-- ALTER TABLE public.rubrica    DROP COLUMN IF EXISTS gestion_id;
-- ALTER TABLE public.calendario DROP COLUMN IF EXISTS gestion_id;
-- ALTER TABLE public.config     DROP COLUMN IF EXISTS gestion_id;
-- DROP TABLE IF EXISTS public.gestiones;
-- NOTA: trabajos_entregados.periodo_nombre NO se puede restaurar con datos
-- una vez eliminada la columna. El DOWN deja periodo_id en su sitio.
