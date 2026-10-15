-- ══════════════════════════════════════════════════════════════════════
--  0015 — Rúbrica v2: núcleo transversal + perfiles técnicos por rol
-- ══════════════════════════════════════════════════════════════════════
--
--  SOLO PARA PERÍODOS NUEVOS
--  Los períodos que ya existen cuando se aplica esta migración quedan marcados
--  `v2_permitido = false`: conservan su evaluación original y NO pueden pasar
--  a v2 (ni desde el formulario ni a mano). Cambiar la regla con la que se
--  evaluó a alguien después de evaluarlo mueve resultados sin que nadie haya
--  sido evaluado de nuevo. Los períodos creados después sí pueden usar v2.
--
--  QUÉ HACE
--  Añade el modelo de evaluación por roles (24 criterios: 5 de núcleo y 19
--  técnicos; escala 1–5; un perfil por rol cuyos pesos suman 100; perfiles
--  versionados e inmutables) SIN tocar los períodos antiguos: cada período
--  declara su `modelo` ('legacy' | 'v2') y se lee con su cálculo.
--
--  REGLAS QUE LA BASE GARANTIZA (el cliente solo las presenta)
--    · Los pesos de un perfil suman exactamente 100 (trigger diferido).
--    · Un perfil usado por alguna evaluación no se puede modificar: un
--      cambio de pesos es una versión nueva, vigente desde un período
--      posterior (crear_perfil_rol).
--    · Una evaluación v2 solo admite el núcleo + los criterios de SU perfil,
--      con enteros 1..5. Un criterio que no aplica no se puntúa: no existe
--      en el JSON, nunca vale 0, y no entra al denominador.
--    · Para publicar hay que haber puntuado todo lo aplicable.
--    · El perfil de una evaluación lo fija el servidor (perfil_vigente), no
--      el cliente, y no cambia después.
--    · El `modelo` de un período no cambia una vez que tiene evaluaciones.
--
--  CÁLCULO EN LA BASE (resultados_periodo)
--  Un solo sitio para los tres portales: ya divergieron una vez
--  (scoreClass, ver core/render.js). El percentil necesita ver a los pares
--  de otros distritos, que RLS no deja ver a un miembro; por eso la función
--  es SECURITY DEFINER y filtra ella misma qué filas devuelve.
--
--    Núcleo     = media de (s−1)/4·100 sobre los criterios de núcleo
--    Técnico    = Σ peso·(s−1)/4·100 / Σ peso   (solo criterios puntuados)
--    Individual = 0.6·Técnico + 0.4·Núcleo
--    Percentil  = (posición−1)/(n−1)·100 dentro del rol; empates = media
--    General    = 0.4·Núcleo + 0.6·Percentil
--    Rol pequeño (<4 evaluados en el rol y período): Percentil := Técnico
--
--  GUARDIAS: nada de `auth.uid() IS NOT NULL AND ...` (0008). Sin sesión se
--  deniega. Las funciones nuevas se revocan a PUBLIC (0010).
--
--  NO TOCA los roles ni crea perfiles: qué 8 roles de la rúbrica
--  corresponden a qué filas de `roles` es una decisión de datos. Ver
--  0015_seed_perfiles.PENDIENTE.sql.
--
--  Aplicación manual en el SQL Editor, en orden. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Columnas de modelo ─────────────────────────────────────────────
ALTER TABLE public.periodos_evaluacion
  ADD COLUMN IF NOT EXISTS modelo TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE public.evaluaciones
  ADD COLUMN IF NOT EXISTS modelo TEXT NOT NULL DEFAULT 'legacy';

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'periodos_modelo_chk') THEN
    ALTER TABLE public.periodos_evaluacion
      ADD CONSTRAINT periodos_modelo_chk CHECK (modelo IN ('legacy','v2'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evaluaciones_modelo_chk') THEN
    ALTER TABLE public.evaluaciones
      ADD CONSTRAINT evaluaciones_modelo_chk CHECK (modelo IN ('legacy','v2'));
  END IF;
END $chk$;

-- Los períodos que existen AHORA quedan fuera de v2. Solo en la primera
-- aplicación: la columna aún no existe; al repetir la migración no se toca.
DO $v2$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'periodos_evaluacion'
                    AND column_name = 'v2_permitido') THEN
    ALTER TABLE public.periodos_evaluacion ADD COLUMN v2_permitido BOOLEAN NOT NULL DEFAULT true;
    UPDATE public.periodos_evaluacion SET v2_permitido = false;
  END IF;
END $v2$;


-- ── 2. Catálogo de criterios v2 (por gestión, como `criterios`) ───────
CREATE TABLE IF NOT EXISTS public.criterios_v2 (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gestion_id BIGINT   NOT NULL REFERENCES public.gestiones(id) ON DELETE RESTRICT,
  key        TEXT     NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  nombre     TEXT     NOT NULL,
  tipo       TEXT     NOT NULL CHECK (tipo IN ('nucleo','tecnico')),
  desc_1     TEXT     NOT NULL DEFAULT '',
  desc_3     TEXT     NOT NULL DEFAULT '',
  desc_5     TEXT     NOT NULL DEFAULT '',
  orden      SMALLINT NOT NULL DEFAULT 0,
  activo     BOOLEAN  NOT NULL DEFAULT true,
  UNIQUE (gestion_id, key)
);

-- ── 3. Perfiles por rol, versionados ──────────────────────────────────
--  rol_id es BIGINT aunque `roles.id` sea INTEGER en la base viva: una FK
--  entre int4 e int8 es válida y evita depender del tipo exacto.
CREATE TABLE IF NOT EXISTS public.perfiles_rol (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gestion_id            BIGINT NOT NULL REFERENCES public.gestiones(id) ON DELETE RESTRICT,
  rol_id                BIGINT NOT NULL REFERENCES public.roles(id)     ON DELETE RESTRICT,
  version               INT    NOT NULL CHECK (version >= 1),
  -- NULL = rige desde el inicio de la gestión (versión 1 y clones).
  vigente_desde_periodo UUID   REFERENCES public.periodos_evaluacion(id) ON DELETE RESTRICT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gestion_id, rol_id, version)
);

CREATE TABLE IF NOT EXISTS public.perfil_criterios (
  perfil_id    BIGINT NOT NULL REFERENCES public.perfiles_rol(id) ON DELETE CASCADE,
  criterio_key TEXT   NOT NULL,
  peso         INT    NOT NULL CHECK (peso > 0 AND peso <= 100),
  PRIMARY KEY (perfil_id, criterio_key)
);

ALTER TABLE public.evaluaciones
  ADD COLUMN IF NOT EXISTS perfil_id BIGINT REFERENCES public.perfiles_rol(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS perfiles_rol_gestion_rol_idx ON public.perfiles_rol (gestion_id, rol_id);
CREATE INDEX IF NOT EXISTS evaluaciones_perfil_idx      ON public.evaluaciones (perfil_id);


-- ── 4. Qué perfil rige para un rol en un período ──────────────────────
--  El de mayor versión cuyo `vigente_desde_periodo` no sea posterior al
--  período consultado. Los períodos se ordenan por created_at, igual que
--  API.getPeriodos().
CREATE OR REPLACE FUNCTION public.perfil_vigente(p_rol_id BIGINT, p_periodo_id UUID)
RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT pr.id
    FROM perfiles_rol pr
    JOIN periodos_evaluacion pe ON pe.id = p_periodo_id
                               AND pe.gestion_id = pr.gestion_id
    LEFT JOIN periodos_evaluacion desde ON desde.id = pr.vigente_desde_periodo
   WHERE pr.rol_id = p_rol_id
     AND (pr.vigente_desde_periodo IS NULL OR desde.created_at <= pe.created_at)
   ORDER BY pr.version DESC
   LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.perfil_vigente(BIGINT, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.perfil_vigente(BIGINT, UUID) TO authenticated;


-- ── 5. Los pesos suman 100 (validado en la base, diferido) ────────────
--  Diferido para poder insertar el perfil y sus filas en una transacción.
CREATE OR REPLACE FUNCTION public.perfil_validar_suma()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perfil BIGINT;
  v_suma   INT;
BEGIN
  -- IF y no CASE: PL/pgSQL resuelve los campos de NEW/OLD al evaluar la
  -- expresión, y `perfil_id` no existe en perfiles_rol.
  IF TG_TABLE_NAME = 'perfiles_rol' THEN
    v_perfil := NEW.id;
  ELSE
    v_perfil := COALESCE(NEW.perfil_id, OLD.perfil_id);
  END IF;

  -- El perfil pudo desaparecer en cascada: no hay nada que validar.
  IF NOT EXISTS (SELECT 1 FROM perfiles_rol WHERE id = v_perfil) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(peso), 0) INTO v_suma
    FROM perfil_criterios WHERE perfil_id = v_perfil;
  IF v_suma <> 100 THEN
    RAISE EXCEPTION 'Los pesos del perfil deben sumar 100 (suman %).', v_suma
      USING ERRCODE = '23514';
  END IF;

  -- Solo criterios técnicos del catálogo de la misma gestión.
  IF EXISTS (
    SELECT 1
      FROM perfil_criterios pc
      JOIN perfiles_rol p ON p.id = pc.perfil_id
      LEFT JOIN criterios_v2 c ON c.gestion_id = p.gestion_id AND c.key = pc.criterio_key
     WHERE pc.perfil_id = v_perfil
       AND (c.id IS NULL OR c.tipo <> 'tecnico' OR NOT c.activo)
  ) THEN
    RAISE EXCEPTION 'El perfil solo admite criterios tecnicos activos del catalogo.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.perfil_validar_suma() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS perfil_criterios_suma ON public.perfil_criterios;
CREATE CONSTRAINT TRIGGER perfil_criterios_suma
  AFTER INSERT OR UPDATE OR DELETE ON public.perfil_criterios
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.perfil_validar_suma();

DROP TRIGGER IF EXISTS perfiles_rol_suma ON public.perfiles_rol;
CREATE CONSTRAINT TRIGGER perfiles_rol_suma
  AFTER INSERT ON public.perfiles_rol
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.perfil_validar_suma();


-- ── 6. Un perfil usado por una evaluación no se toca ──────────────────
CREATE OR REPLACE FUNCTION public.perfil_criterios_inmutable()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_perfil BIGINT := COALESCE(NEW.perfil_id, OLD.perfil_id);
BEGIN
  IF EXISTS (SELECT 1 FROM evaluaciones WHERE perfil_id = v_perfil) THEN
    RAISE EXCEPTION 'Este perfil ya se uso en evaluaciones: no se edita. Crea una version nueva.'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.perfil_criterios_inmutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS perfil_criterios_inmutable ON public.perfil_criterios;
CREATE TRIGGER perfil_criterios_inmutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.perfil_criterios
  FOR EACH ROW EXECUTE FUNCTION public.perfil_criterios_inmutable();

-- Tampoco se reescribe la clave o el tipo de un criterio que un perfil usa.
CREATE OR REPLACE FUNCTION public.criterios_v2_protegido()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.key IS DISTINCT FROM OLD.key OR NEW.tipo IS DISTINCT FROM OLD.tipo THEN
    IF EXISTS (
      SELECT 1 FROM perfil_criterios pc
        JOIN perfiles_rol p ON p.id = pc.perfil_id
       WHERE p.gestion_id = OLD.gestion_id AND pc.criterio_key = OLD.key
    ) THEN
      RAISE EXCEPTION 'El criterio % esta en uso por un perfil: solo se puede desactivar.', OLD.key
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.criterios_v2_protegido() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS criterios_v2_protegido ON public.criterios_v2;
CREATE TRIGGER criterios_v2_protegido
  BEFORE UPDATE OR DELETE ON public.criterios_v2
  FOR EACH ROW EXECUTE FUNCTION public.criterios_v2_protegido();


-- ── 7. Validación de las evaluaciones v2 ──────────────────────────────
--  `modelo` y `perfil_id` los fija el servidor. El cliente puede mandar lo
--  que quiera: se sobrescribe.
CREATE OR REPLACE FUNCTION public.evaluaciones_validar_modelo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_modelo  TEXT;
  v_gestion BIGINT;
  v_rol     BIGINT;
  v_clave   TEXT;
  v_val     JSONB;
  v_num     NUMERIC;
  v_faltan  TEXT;
BEGIN
  SELECT modelo, gestion_id INTO v_modelo, v_gestion
    FROM periodos_evaluacion WHERE id = NEW.periodo_id;
  NEW.modelo := COALESCE(v_modelo, 'legacy');

  IF NEW.modelo <> 'v2' THEN
    NEW.perfil_id := NULL;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.bono_ext, 0) <> 0 THEN
    RAISE EXCEPTION 'La rubrica v2 no tiene bono.' USING ERRCODE = '23514';
  END IF;

  -- Perfil: se fija en el primer guardado y no cambia.
  IF TG_OP = 'UPDATE' AND OLD.perfil_id IS NOT NULL THEN
    NEW.perfil_id := OLD.perfil_id;
  ELSE
    SELECT rol_id INTO v_rol FROM profiles WHERE id = NEW.evaluado_id;
    IF v_rol IS NULL THEN
      RAISE EXCEPTION 'La persona evaluada no tiene un rol asignado.' USING ERRCODE = '23514';
    END IF;
    NEW.perfil_id := public.perfil_vigente(v_rol, NEW.periodo_id);
    IF NEW.perfil_id IS NULL THEN
      RAISE EXCEPTION 'No hay un perfil de evaluacion vigente para ese rol en este periodo.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF jsonb_typeof(NEW.puntajes) <> 'object' THEN
    RAISE EXCEPTION 'puntajes debe ser un objeto.' USING ERRCODE = '23514';
  END IF;

  FOR v_clave, v_val IN SELECT key, value FROM jsonb_each(NEW.puntajes) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM criterios_v2 c
       WHERE c.gestion_id = v_gestion AND c.key = v_clave AND c.activo
         AND (c.tipo = 'nucleo'
              OR v_clave IN (SELECT criterio_key FROM perfil_criterios WHERE perfil_id = NEW.perfil_id))
    ) THEN
      RAISE EXCEPTION 'El criterio "%" no aplica a este perfil.', v_clave USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(v_val) <> 'number' THEN
      RAISE EXCEPTION 'El puntaje de "%" debe ser un numero.', v_clave USING ERRCODE = '23514';
    END IF;
    v_num := (v_val #>> '{}')::NUMERIC;
    IF v_num <> trunc(v_num) OR v_num < 1 OR v_num > 5 THEN
      RAISE EXCEPTION 'El puntaje de "%" debe ser un entero de 1 a 5.', v_clave USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF NEW.estado = 'publicado' THEN
    SELECT string_agg(c.nombre, ', ' ORDER BY c.orden) INTO v_faltan
      FROM criterios_v2 c
     WHERE c.gestion_id = v_gestion AND c.activo
       AND (c.tipo = 'nucleo'
            OR c.key IN (SELECT criterio_key FROM perfil_criterios WHERE perfil_id = NEW.perfil_id))
       AND NOT (NEW.puntajes ? c.key);
    IF v_faltan IS NOT NULL THEN
      RAISE EXCEPTION 'No se puede publicar: faltan por puntuar: %.', v_faltan USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.evaluaciones_validar_modelo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS evaluaciones_validar_modelo ON public.evaluaciones;
CREATE TRIGGER evaluaciones_validar_modelo
  BEFORE INSERT OR UPDATE ON public.evaluaciones
  FOR EACH ROW EXECUTE FUNCTION public.evaluaciones_validar_modelo();


-- ── 8. Reglas del modelo de un período ───────────────────────────────
--  · Un período anterior a esta migración no puede pasar a v2.
--  · `v2_permitido` no lo cambia nadie: es historia.
--  · El modelo no cambia una vez que el período tiene evaluaciones.
--  · Un período nuevo siempre nace pudiendo usar v2 (lo fija el servidor).
CREATE OR REPLACE FUNCTION public.periodos_modelo_fijo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.v2_permitido := true;
    RETURN NEW;
  END IF;

  IF NEW.v2_permitido IS DISTINCT FROM OLD.v2_permitido THEN
    RAISE EXCEPTION 'Ese dato de un periodo no se puede cambiar.' USING ERRCODE = '42501';
  END IF;
  IF NEW.modelo = 'v2' AND NOT OLD.v2_permitido THEN
    RAISE EXCEPTION 'Este periodo es anterior a la rubrica por roles: conserva su evaluacion original.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.modelo IS DISTINCT FROM OLD.modelo
     AND EXISTS (SELECT 1 FROM evaluaciones WHERE periodo_id = OLD.id) THEN
    RAISE EXCEPTION 'Este periodo ya tiene evaluaciones: no se puede cambiar su modelo.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.periodos_modelo_fijo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS periodos_modelo_fijo ON public.periodos_evaluacion;
CREATE TRIGGER periodos_modelo_fijo
  BEFORE INSERT OR UPDATE OF modelo, v2_permitido ON public.periodos_evaluacion
  FOR EACH ROW EXECUTE FUNCTION public.periodos_modelo_fijo();


-- ── 9. RLS ────────────────────────────────────────────────────────────
--  Lectura para cualquier autenticado (la rúbrica es pública para el
--  equipo, como `rubrica`). perfiles_rol y perfil_criterios NO tienen
--  policy de escritura: solo se crean con crear_perfil_rol(), que valida y
--  versiona. Sin sesión no se lee nada.
ALTER TABLE public.criterios_v2     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfiles_rol     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfil_criterios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS criterios_v2_read ON public.criterios_v2;
CREATE POLICY criterios_v2_read ON public.criterios_v2
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS criterios_v2_admin_write ON public.criterios_v2;
CREATE POLICY criterios_v2_admin_write ON public.criterios_v2
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin() AND public.gestion_id_escribible(gestion_id));

DROP POLICY IF EXISTS perfiles_rol_read ON public.perfiles_rol;
CREATE POLICY perfiles_rol_read ON public.perfiles_rol
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS perfil_criterios_read ON public.perfil_criterios;
CREATE POLICY perfil_criterios_read ON public.perfil_criterios
  FOR SELECT TO authenticated USING (true);


-- ── 10. Crear una versión de perfil ───────────────────────────────────
--  p_pesos: {"encuadre":30,"tecnico":25,...}  (enteros, suman 100).
--  La primera versión de un rol rige desde el inicio de la gestión. Las
--  siguientes exigen un período de entrada en vigor y solo se aceptan si
--  ese rol no tiene ya evaluaciones v2 en ese período o en uno posterior:
--  editar hacia atrás mueve rankings sin que nadie haya sido reevaluado.
CREATE OR REPLACE FUNCTION public.crear_perfil_rol(
  p_gestion_id BIGINT,
  p_rol_id     BIGINT,
  p_pesos      JSONB,
  p_vigente_desde UUID DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_version INT;
  v_id      BIGINT;
  v_desde   TIMESTAMPTZ;
  v_clave   TEXT;
  v_peso    TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede crear perfiles.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.gestion_id_escribible(p_gestion_id) THEN
    RAISE EXCEPTION 'La gestion esta archivada: solo lectura.' USING ERRCODE = '42501';
  END IF;
  IF p_pesos IS NULL OR jsonb_typeof(p_pesos) <> 'object' THEN
    RAISE EXCEPTION 'p_pesos debe ser un objeto {criterio: peso}.' USING ERRCODE = '22023';
  END IF;

  FOR v_clave, v_peso IN SELECT key, value FROM jsonb_each_text(p_pesos) LOOP
    IF v_peso !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'El peso de "%" debe ser un entero positivo.', v_clave USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM perfiles_rol WHERE gestion_id = p_gestion_id AND rol_id = p_rol_id;

  IF v_version > 1 THEN
    IF p_vigente_desde IS NULL THEN
      RAISE EXCEPTION 'Una version nueva debe indicar desde que periodo rige.' USING ERRCODE = '22023';
    END IF;
    SELECT created_at INTO v_desde FROM periodos_evaluacion
     WHERE id = p_vigente_desde AND gestion_id = p_gestion_id;
    IF v_desde IS NULL THEN
      RAISE EXCEPTION 'El periodo de entrada en vigor no pertenece a la gestion.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM evaluaciones e
        JOIN perfiles_rol pr ON pr.id = e.perfil_id
        JOIN periodos_evaluacion pe ON pe.id = e.periodo_id
       WHERE pr.gestion_id = p_gestion_id AND pr.rol_id = p_rol_id
         AND pe.created_at >= v_desde
    ) THEN
      RAISE EXCEPTION 'Ese rol ya tiene evaluaciones en ese periodo o en uno posterior: elige un periodo mas adelante.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    p_vigente_desde := NULL;
  END IF;

  INSERT INTO perfiles_rol (gestion_id, rol_id, version, vigente_desde_periodo)
  VALUES (p_gestion_id, p_rol_id, v_version, p_vigente_desde)
  RETURNING id INTO v_id;

  INSERT INTO perfil_criterios (perfil_id, criterio_key, peso)
  SELECT v_id, key, value::INT FROM jsonb_each_text(p_pesos);

  RETURN v_id;   -- la suma = 100 se valida al confirmar la transacción
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crear_perfil_rol(BIGINT, BIGINT, JSONB, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_perfil_rol(BIGINT, BIGINT, JSONB, UUID) TO authenticated;


-- ── 11. Resultados de un período (v2) ─────────────────────────────────
--  Devuelve las filas que el llamante puede ver:
--    · admin: todas
--    · secretario: las de su distrito
--    · miembro: la suya
--  pero el percentil se calcula contra TODOS los pares del rol, también los
--  que el llamante no puede leer. Solo cuentan evaluaciones publicadas; el
--  admin puede pedir los borradores para previsualizar.
CREATE OR REPLACE FUNCTION public.resultados_periodo(
  p_periodo    UUID,
  p_borradores BOOLEAN DEFAULT false
) RETURNS TABLE (
  evaluado_id UUID,
  nombre      TEXT,
  distrito    TEXT,
  rol_id      BIGINT,
  rol_nombre  TEXT,
  perfil_id   BIGINT,
  estado      TEXT,
  nucleo      NUMERIC,
  tecnico     NUMERIC,
  individual  NUMERIC,
  percentil   NUMERIC,
  general     NUMERIC,
  n_rol       INT,
  rol_pequeno BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_admin   BOOLEAN;
  v_gestion BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501';
  END IF;
  v_admin := public.is_admin();

  SELECT p.gestion_id INTO v_gestion FROM periodos_evaluacion p
   WHERE p.id = p_periodo AND p.modelo = 'v2';
  IF v_gestion IS NULL THEN
    RETURN;   -- período inexistente o legacy: sin resultados v2
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT e.evaluado_id, e.perfil_id, e.puntajes, e.estado,
           pr.rol_id, ro.nombre AS rol_nombre, pf.nombre, pf.distrito
      FROM evaluaciones e
      JOIN perfiles_rol pr ON pr.id = e.perfil_id
      JOIN roles        ro ON ro.id = pr.rol_id
      JOIN profiles     pf ON pf.id = e.evaluado_id
     WHERE e.periodo_id = p_periodo
       AND e.modelo = 'v2'
       AND (e.estado = 'publicado' OR (v_admin AND p_borradores))
  ),
  nuc AS (
    SELECT b.evaluado_id, AVG((v.value::NUMERIC - 1) / 4 * 100) AS nucleo
      FROM base b
      CROSS JOIN LATERAL jsonb_each_text(b.puntajes) v(key, value)
      JOIN criterios_v2 c ON c.gestion_id = v_gestion AND c.key = v.key AND c.tipo = 'nucleo'
     GROUP BY b.evaluado_id
  ),
  tec AS (
    SELECT b.evaluado_id,
           SUM(pc.peso * ((v.value::NUMERIC - 1) / 4 * 100)) / NULLIF(SUM(pc.peso), 0) AS tecnico
      FROM base b
      CROSS JOIN LATERAL jsonb_each_text(b.puntajes) v(key, value)
      JOIN perfil_criterios pc ON pc.perfil_id = b.perfil_id AND pc.criterio_key = v.key
     GROUP BY b.evaluado_id
  ),
  junto AS (
    SELECT b.*, n.nucleo, t.tecnico,
           COUNT(*) OVER (PARTITION BY b.rol_id)                  AS n_rol,
           RANK()   OVER (PARTITION BY b.rol_id ORDER BY t.tecnico) AS pos_min,
           COUNT(*) OVER (PARTITION BY b.rol_id, t.tecnico)       AS empates
      FROM base b
      LEFT JOIN nuc n ON n.evaluado_id = b.evaluado_id
      LEFT JOIN tec t ON t.evaluado_id = b.evaluado_id
  ),
  calc AS (
    SELECT j.*,
           (j.n_rol < 4) AS rol_pequeno,
           CASE WHEN j.n_rol >= 4 AND j.tecnico IS NOT NULL
                THEN ((j.pos_min + (j.empates - 1) / 2.0) - 1) / (j.n_rol - 1) * 100
           END AS percentil
      FROM junto j
  )
  SELECT c.evaluado_id, c.nombre, c.distrito, c.rol_id, c.rol_nombre, c.perfil_id, c.estado,
         ROUND(c.nucleo, 1),
         ROUND(c.tecnico, 1),
         ROUND(0.6 * c.tecnico + 0.4 * c.nucleo, 1),
         ROUND(c.percentil, 1),
         ROUND(0.4 * c.nucleo + 0.6 * COALESCE(c.percentil, c.tecnico), 1),
         c.n_rol::INT,
         c.rol_pequeno
    FROM calc c
   WHERE v_admin
      OR c.evaluado_id = auth.uid()
      OR (public.is_secretario() AND c.evaluado_id IN (SELECT public.get_district_member_ids()));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.resultados_periodo(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resultados_periodo(UUID, BOOLEAN) TO authenticated;


-- ── 12. Catálogo: 24 criterios en la gestión activa ───────────────────
--  Textos de la rúbrica "Sistema de evaluación por roles v1.0". Los niveles
--  2 y 4 son intermedios y no llevan descriptor propio.
INSERT INTO public.criterios_v2 (gestion_id, key, nombre, tipo, desc_1, desc_3, desc_5, orden)
SELECT g.id, v.key, v.nombre, v.tipo, v.d1, v.d3, v.d5, v.orden
  FROM public.gestiones g
 CROSS JOIN (VALUES
  -- ── Núcleo transversal ──
  ('plazos', 'Cumplimiento de plazos de entrega', 'nucleo', 1,
   'Entrega tarde de forma habitual y sin avisar. El equipo debe reorganizarse alrededor de sus retrasos.',
   'Cumple la mayoría de los plazos. Cuando se atrasa, avisa con tiempo suficiente para reaccionar.',
   'Entrega siempre en fecha o antes. Cuando un plazo peligra, lo levanta antes de que se convierta en problema y propone alternativa.'),
  ('respuesta', 'Respuesta y disponibilidad ante requerimientos', 'nucleo', 2,
   'Hay que buscarlo varias veces por distintos canales para obtener respuesta.',
   'Responde dentro del día en horario de actividad.',
   'Responde con rapidez y confirma recepción. Durante coberturas permanece localizable todo el tiempo acordado.'),
  ('colaboracion', 'Colaboración y trabajo en equipo', 'nucleo', 3,
   'Trabaja aislado, no comparte insumos, genera fricción con otras áreas.',
   'Colabora cuando se le solicita y entrega a tiempo lo que otros necesitan de él.',
   'Se anticipa a lo que otros van a necesitar y desbloquea a compañeros por iniciativa propia, sin que se lo pidan.'),
  ('iniciativa', 'Iniciativa y proactividad', 'nucleo', 4,
   'Ejecuta únicamente lo que se le asigna de forma explícita.',
   'Propone mejoras ocasionales dentro del alcance de su área.',
   'Identifica necesidades que nadie ha señalado, las propone con una solución concreta y las lleva hasta la ejecución.'),
  ('calidad', 'Calidad y completitud de la entrega', 'nucleo', 5,
   'El trabajo regresa casi siempre por correcciones, formato incorrecto o material incompleto.',
   'Entrega correcta, con correcciones menores ocasionales.',
   'Entrega lista para publicar sin retrabajo, con nomenclatura, formatos y archivos fuente en orden.'),
  -- ── Técnicos ──
  ('planificacion', 'Planificación y organización del trabajo', 'tecnico', 6,
   'Trabaja por reacción; no hay orden previo visible en lo que produce.',
   'Organiza sus tareas y llega a las actividades sabiendo qué debe hacer.',
   'Trabaja con plan escrito, prioriza según impacto y ajusta el plan cuando cambian las condiciones.'),
  ('revision', 'Revisión y control de calidad previo a la entrega', 'tecnico', 7,
   'Entrega sin revisar; los errores los detecta otra persona.',
   'Revisa su propio trabajo antes de entregarlo y corrige lo evidente.',
   'Revisa contra criterios definidos, detecta errores que otros pasarían por alto y revisa también el trabajo de terceros cuando se le pide.'),
  ('edicion', 'Edición y montaje audiovisual', 'tecnico', 8,
   'Cortes abruptos, audio descuidado, resultado difícil de ver hasta el final.',
   'Corte limpio, ritmo aceptable, audio equilibrado.',
   'El ritmo, las transiciones y la musicalización sirven a la historia. Las decisiones de montaje son intencionales y se pueden justificar.'),
  ('diseno', 'Diseño y composición gráfica', 'tecnico', 9,
   'Elementos desordenados, sin jerarquía; el mensaje principal no se distingue.',
   'Pieza limpia y ordenada, resuelta con plantilla.',
   'Jerarquía visual clara, uso deliberado de espacio y contraste. Cada decisión de diseño responde al objetivo de la pieza.'),
  ('fluidez', 'Fluidez y expresión oral', 'tecnico', 10,
   'Discurso entrecortado, muletillas constantes, pierde el hilo.',
   'Se expresa con claridad y sostiene una intervención preparada.',
   'Domina el ritmo y el tono, improvisa con solvencia y sostiene la atención incluso sin guion.'),
  ('narrativa', 'Construcción narrativa y estructura de guion', 'tecnico', 11,
   'Texto sin estructura; no se entiende qué se quiere contar.',
   'Texto ordenado y claro, con inicio, desarrollo y cierre.',
   'Estructura con gancho inicial, tensión sostenida y cierre que refuerza el mensaje. Adapta la narrativa al canal y a la audiencia.'),
  ('redes', 'Ejecución y publicación en redes sociales', 'tecnico', 12,
   'Publica fuera de calendario, con formatos incorrectos o incompletos.',
   'Publica a tiempo y según el calendario acordado.',
   'Publica en formato nativo de cada plataforma, ajusta horarios según comportamiento de audiencia y mantiene coherencia entre piezas.'),
  ('encuadre', 'Composición y encuadre fotográfico', 'tecnico', 13,
   'Encuadres descuidados, sujeto mal ubicado, fondos que distraen.',
   'Fotografía correcta y utilizable, aunque genérica.',
   'Hay intención clara en el encuadre. Usa perspectiva, profundidad y momento para construir sentido, no solo para registrar.'),
  ('tecnico', 'Dominio técnico del equipo de captura', 'tecnico', 14,
   'Depende del modo automático; resultados inconsistentes.',
   'Obtiene resultados aceptables en condiciones favorables.',
   'Controla exposición, enfoque, iluminación y audio de forma deliberada. Resuelve en condiciones difíciles y previene fallas de equipo.'),
  ('ortografia', 'Ortografía, gramática y redacción normativa', 'tecnico', 15,
   'Errores frecuentes que llegan a publicación.',
   'Errores puntuales, corregibles en revisión.',
   'Cero errores, puntuación precisa y registro adecuado al canal y al público.'),
  ('marca', 'Aplicación de la identidad de marca institucional', 'tecnico', 16,
   'Usa colores, tipografías o logo fuera de manual.',
   'Aplica correctamente los elementos básicos de marca.',
   'Domina el manual, resuelve casos no contemplados sin romper la identidad y corrige desviaciones de otros.'),
  ('metricas', 'Análisis e interpretación de métricas', 'tecnico', 17,
   'No consulta métricas o las reporta sin lectura.',
   'Reporta los números principales de cada período.',
   'Interpreta qué explica los números y modifica decisiones de contenido a partir de esa lectura.'),
  ('comunidad', 'Gestión de comunidad e interacción con la audiencia', 'tecnico', 18,
   'Comentarios y mensajes quedan sin responder.',
   'Responde comentarios y mensajes dentro de un plazo razonable.',
   'Gestiona la conversación de forma activa, maneja crisis menores con criterio y escala a tiempo lo que corresponde.'),
  ('logistica', 'Logística y coordinación de coberturas', 'tecnico', 19,
   'Improvisa; faltan recursos o personas el día de la actividad.',
   'La actividad sale bien y los recursos están donde deben estar.',
   'Trabaja con contingencias previstas. Cuando algo falla, ya existe un plan B y la actividad no se detiene.'),
  ('recursos', 'Gestión y cuidado de recursos y equipos', 'tecnico', 20,
   'Devuelve el equipo incompleto o dañado; no reporta faltantes.',
   'Usa correctamente lo disponible y devuelve en orden.',
   'Aprovecha al máximo los recursos existentes, da mantenimiento preventivo y reporta necesidades con anticipación suficiente para gestionarlas.'),
  ('liderazgo', 'Liderazgo, delegación y desarrollo del equipo', 'tecnico', 21,
   'Concentra el trabajo, no delega o delega sin instrucciones.',
   'Asigna tareas con claridad y da seguimiento.',
   'Delega con criterio de desarrollo: asigna según capacidad, acompaña y hace crecer a los integrantes del equipo.'),
  ('vision', 'Visión estratégica y alineación institucional', 'tecnico', 22,
   'Produce contenido sin relación con los objetivos institucionales.',
   'Tiene un plan de contenido definido para el período.',
   'Conecta cada línea de producción con objetivos institucionales explícitos y ajusta la estrategia según resultados.'),
  ('voceria', 'Vocería y representación institucional', 'tecnico', 23,
   'Evita representar a la institución o lo hace transmitiendo un mensaje impreciso.',
   'Representa correctamente a la institución en escenarios previstos.',
   'Sostiene la posición institucional con solvencia en escenarios imprevistos, incluyendo preguntas incómodas o situaciones de tensión.'),
  ('mensaje', 'Claridad y consistencia del mensaje institucional', 'tecnico', 24,
   'El mensaje varía según quién lo emite; hay contradicciones entre piezas.',
   'El mensaje es claro y consistente en los productos principales.',
   'Define y custodia el mensaje. Todas las piezas del equipo comunican lo mismo, con vocabulario y posicionamiento unificados.')
 ) AS v(key, nombre, tipo, orden, d1, d3, d5)
 WHERE g.activa
ON CONFLICT (gestion_id, key) DO NOTHING;


-- ── 13. abrir_gestion clona también el modelo v2 ──────────────────────
--  Misma función que 0008 (guardia `IF NOT is_admin()`), más: el modelo de
--  cada período y el catálogo v2 + la última versión de cada perfil, que en
--  la gestión nueva arranca como versión 1 vigente desde el inicio.
CREATE OR REPLACE FUNCTION public.abrir_gestion(p_nombre text, p_clonar_de bigint DEFAULT NULL::bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_id     BIGINT;
  v_origen BIGINT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede abrir una gestion.' USING ERRCODE = '42501';
  END IF;

  v_origen := COALESCE(p_clonar_de, (SELECT id FROM gestiones WHERE activa LIMIT 1));

  UPDATE gestiones SET activa = false, archivada = true WHERE activa;

  INSERT INTO gestiones (nombre, activa, archivada)
  VALUES (p_nombre, true, false)
  RETURNING id INTO v_id;

  IF v_origen IS NOT NULL THEN
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

    INSERT INTO calendario (gestion_id, numero, titulo, descripcion, color, estado)
    SELECT v_id, numero, titulo, descripcion, color, 'Pendiente'
      FROM calendario WHERE gestion_id = v_origen;

    -- Los períodos de una gestión nueva son nuevos: usan v2 si la gestión de
    -- origen tiene el catálogo; si no, siguen como antes.
    INSERT INTO periodos_evaluacion (gestion_id, nombre, descripcion, activo, modelo)
    SELECT v_id, nombre, descripcion, false,
           CASE WHEN EXISTS (SELECT 1 FROM criterios_v2 WHERE gestion_id = v_origen) THEN 'v2' ELSE 'legacy' END
      FROM periodos_evaluacion WHERE gestion_id = v_origen;

    -- Rúbrica v2: catálogo y la última versión de cada perfil.
    INSERT INTO criterios_v2 (gestion_id, key, nombre, tipo, desc_1, desc_3, desc_5, orden, activo)
    SELECT v_id, key, nombre, tipo, desc_1, desc_3, desc_5, orden, activo
      FROM criterios_v2 WHERE gestion_id = v_origen;

    INSERT INTO perfiles_rol (gestion_id, rol_id, version, vigente_desde_periodo)
    SELECT DISTINCT ON (rol_id) v_id, rol_id, 1, NULL::uuid
      FROM perfiles_rol WHERE gestion_id = v_origen
     ORDER BY rol_id, version DESC;

    INSERT INTO perfil_criterios (perfil_id, criterio_key, peso)
    SELECT nuevo.id, pc.criterio_key, pc.peso
      FROM perfiles_rol nuevo
      JOIN (SELECT DISTINCT ON (rol_id) id, rol_id
              FROM perfiles_rol WHERE gestion_id = v_origen
             ORDER BY rol_id, version DESC) viejo ON viejo.rol_id = nuevo.rol_id
      JOIN perfil_criterios pc ON pc.perfil_id = viejo.id
     WHERE nuevo.gestion_id = v_id;
  END IF;

  RETURN v_id;
END;
$function$;

COMMIT;


-- ══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (después de aplicar)
-- ══════════════════════════════════════════════════════════════════════
-- 24 criterios en la gestión activa (5 núcleo + 19 técnicos):
--   SELECT tipo, count(*) FROM criterios_v2
--    WHERE gestion_id = (SELECT id FROM gestiones WHERE activa) GROUP BY 1;
--
-- Sin sesión nada es legible ni ejecutable (debe dar [] / error):
--   SET ROLE anon; SELECT count(*) FROM criterios_v2; RESET ROLE;
--   SET ROLE anon; SELECT * FROM resultados_periodo(gen_random_uuid()); RESET ROLE;
--
-- Triggers y funciones sin EXECUTE para PUBLIC:
--   SELECT proname, proacl FROM pg_proc
--    WHERE proname IN ('perfil_validar_suma','evaluaciones_validar_modelo',
--                      'resultados_periodo','crear_perfil_rol','perfil_vigente');
--
-- Los períodos existentes siguen 'legacy', bloqueados, y sus evaluaciones no cambian:
--   SELECT modelo, v2_permitido, count(*) FROM periodos_evaluacion GROUP BY 1,2;
--   SELECT modelo, count(*) FROM evaluaciones GROUP BY 1;


-- ══════════════════════════════════════════════════════════════════════
-- DOWN (comentado)
-- ══════════════════════════════════════════════════════════════════════
-- Restaurar abrir_gestion a la versión de 0008 ANTES de borrar tablas.
-- BEGIN;
-- DROP TRIGGER IF EXISTS evaluaciones_validar_modelo ON public.evaluaciones;
-- DROP TRIGGER IF EXISTS periodos_modelo_fijo        ON public.periodos_evaluacion;
-- DROP FUNCTION IF EXISTS public.resultados_periodo(UUID, BOOLEAN);
-- DROP FUNCTION IF EXISTS public.crear_perfil_rol(BIGINT, BIGINT, JSONB, UUID);
-- DROP FUNCTION IF EXISTS public.evaluaciones_validar_modelo();
-- DROP FUNCTION IF EXISTS public.periodos_modelo_fijo();
-- ALTER TABLE public.evaluaciones DROP COLUMN IF EXISTS perfil_id;
-- ALTER TABLE public.evaluaciones DROP COLUMN IF EXISTS modelo;
-- ALTER TABLE public.periodos_evaluacion DROP COLUMN IF EXISTS v2_permitido;
-- ALTER TABLE public.periodos_evaluacion DROP COLUMN IF EXISTS modelo;
-- DROP TABLE IF EXISTS public.perfil_criterios, public.perfiles_rol, public.criterios_v2 CASCADE;
-- DROP FUNCTION IF EXISTS public.perfil_vigente(BIGINT, UUID);
-- COMMIT;
