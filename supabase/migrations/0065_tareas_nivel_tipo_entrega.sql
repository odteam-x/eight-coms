-- ═════════════════════════════════════════════════════════════════════
--  0065 — Tareas: nivel (distrital / regional), tipo de entrega y «quién evalúa mi iniciativa»
-- ═════════════════════════════════════════════════════════════════════
--
--  PEDIDOS DE LA ADMINISTRACIÓN
--   13. Que la tarea o iniciativa diga de qué TIPO es su entrega (enlace, documento, imagen, video, otro) y que se vea al abrirla.
--   14. Clasificar las tareas por NIVEL (distrital o regional) y QUITAR el peso que elegía quien revisaba.
--   15. Que quien crea una iniciativa propia elija quién la evalúa: la secretaría de su distrito (distrital) o la administración (regional).
--
--  QUÉ HACE
--   1. `tareas.nivel` y `tareas_equipo.nivel` ('distrital' | 'regional', CHECK). Lo que ya existía se clasifica así (sin tocar su nota):
--        · asignada por la administración → regional; asignada por una secretaría → distrital;
--        · iniciativa propia → distrital si la persona tiene distrito CON secretaría; si no, regional;
--        · tarea de equipo → distrital si el equipo es de un distrito; si no, regional.
--   2. `tareas.tipo_entrega` y `tareas_equipo.tipo_entrega` (CHECK; NULL = sin indicar). Las entregas con enlace anteriores quedan «enlace».
--   3. EL PESO DE TAREA SE RETIRA. La columna `peso` se CONSERVA (solo lectura: los triggers la dejan en 1 en tareas nuevas y la
--      congelan en las existentes) porque las tareas ya calificadas la usaron: así sus resultados NO cambian (paridad). La pantalla ya
--      no la pide ni la muestra como elección.
--   4. NUEVA PONDERACIÓN. peso_efectivo = peso_heredado × multiplicador del NIVEL × multiplicador del tipo (individual | colectiva).
--        · multiplicadores por nivel, por PE: `periodo_calif_config.mult_distrital` y `mult_regional` (DEFAULT 1, > 0). Con 1 y 1 la nota
--          es idéntica a la anterior (paridad probada en sql-0065.mjs); la administración los sube o baja en Tareas → reglas del PE.
--        · una INICIATIVA PROPIA pesa siempre ×1 por nivel: el nivel solo decide quién la evalúa (no se infla el propio promedio, regla
--          de 0033).
--        · peso_heredado = `tareas.peso` (1 en toda tarea nueva; las anteriores conservan el que tenían).
--      Se recrean: calif_items (+ nivel), tareas_calificacion_detalle (+ nivel), calif_config (+ 2 columnas), calif_config_guardar
--      (+ 2 parámetros al final, con DEFAULT NULL = «dejar como está»), tareas_equipo_estado (+ nivel, tipo_entrega) y equipo_resultados.
--      `resultados_periodo()`, `seguimiento_global()`, `reporte_general_pe()` y la cobertura NO se tocan: leen calif_items por nombre.
--   5. QUIÉN EVALÚA UNA INICIATIVA (pedido 15), impuesto en la base:
--        · puede_revisar_tarea_fila(persona, origen, nivel): la administración siempre; la secretaría del distrito de la persona solo si
--          la tarea NO es una iniciativa regional. Se parchea tareas_validar_update() y prorrogar_tarea() para usarla: una secretaría
--          que intenta aprobar/devolver una iniciativa regional recibe «No tienes acceso a esta tarea».
--        · Al crear: una iniciativa de una secretaría o de la administración es siempre regional; una persona sin secretaría en su distrito
--          cae a regional; una secretaría solo asigna tareas distritales (no se clasifica sola como regional para pesar más).
--        · `nivel` de una tarea ya creada solo lo cambia la administración (nadie cambia el evaluador a mitad de camino).
--        · avisos: la entrega de una iniciativa regional avisa solo a la administración; la distrital, solo a la secretaría del distrito
--          (si ya no hubiera, a la administración). Se parchea notif_trg_tarea() con pg_get_functiondef (cambia solo quién recibe).
--   6. `mi_instancia_distrital_disponible()`: la pantalla la usa para ofrecer o no «Distrital» al crear una iniciativa.
--
--  QUÉ NO CAMBIA
--   La nota de tareas de lo ya calificado (con 1 y 1), las reglas del PE existentes, la regla «nadie aprueba su propia tarea», los
--   estados, el historial. El administrador conserva acceso a toda tarea (es la instancia regional y supervisa la distrital).
--
--  Aplicar DESPUÉS de 0064. Idempotente (el reclasificado de lo existente solo corre la primera vez). REVERSA al final.
-- ═════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Funciones de apoyo (antes del reclasificado: lo usa) ───────────
--  ¿Existe una secretaría aprobada en ese distrito? (misma definición que notif_revisores, 0019)
CREATE OR REPLACE FUNCTION public.distrito_tiene_secretaria(p_distrito TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p_distrito IS NOT NULL AND EXISTS (
    SELECT 1 FROM profiles s
     WHERE s.tipo_miembro = 'secretario' AND NOT COALESCE(s.es_admin, false) AND s.distrito = p_distrito AND s.aprobado IS NOT FALSE);
$$;
REVOKE EXECUTE ON FUNCTION public.distrito_tiene_secretaria(TEXT) FROM PUBLIC, anon, authenticated;

--  Multiplicador por nivel de una pieza (interno).
CREATE OR REPLACE FUNCTION public.calif_mult_nivel(p_nivel TEXT, p_origen TEXT, p_md NUMERIC, p_mr NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_origen = 'propia' THEN 1::NUMERIC
              WHEN p_nivel = 'distrital' THEN COALESCE(p_md, 1)
              ELSE COALESCE(p_mr, 1) END;
$$;
REVOKE EXECUTE ON FUNCTION public.calif_mult_nivel(TEXT, TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon, authenticated;

-- ── 2. Columnas y reclasificado de lo existente ───────────────────────
ALTER TABLE public.periodo_calif_config ADD COLUMN IF NOT EXISTS mult_distrital NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK (mult_distrital > 0);
ALTER TABLE public.periodo_calif_config ADD COLUMN IF NOT EXISTS mult_regional  NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK (mult_regional > 0);

DO $m65$
DECLARE
  v_nuevo BOOLEAN;
BEGIN
  v_nuevo := NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'tareas' AND column_name = 'nivel');

  ALTER TABLE public.tareas        ADD COLUMN IF NOT EXISTS nivel TEXT NOT NULL DEFAULT 'regional';
  ALTER TABLE public.tareas        ADD COLUMN IF NOT EXISTS tipo_entrega TEXT;
  ALTER TABLE public.tareas_equipo ADD COLUMN IF NOT EXISTS nivel TEXT NOT NULL DEFAULT 'regional';
  ALTER TABLE public.tareas_equipo ADD COLUMN IF NOT EXISTS tipo_entrega TEXT;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tareas_nivel_chk') THEN
    ALTER TABLE public.tareas ADD CONSTRAINT tareas_nivel_chk CHECK (nivel IN ('distrital', 'regional'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tareas_tipo_entrega_chk') THEN
    ALTER TABLE public.tareas ADD CONSTRAINT tareas_tipo_entrega_chk
      CHECK (tipo_entrega IS NULL OR tipo_entrega IN ('enlace', 'documento', 'imagen', 'video', 'otro'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tareas_equipo_nivel_chk') THEN
    ALTER TABLE public.tareas_equipo ADD CONSTRAINT tareas_equipo_nivel_chk CHECK (nivel IN ('distrital', 'regional'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tareas_equipo_tipo_entrega_chk') THEN
    ALTER TABLE public.tareas_equipo ADD CONSTRAINT tareas_equipo_tipo_entrega_chk
      CHECK (tipo_entrega IS NULL OR tipo_entrega IN ('enlace', 'documento', 'imagen', 'video', 'otro'));
  END IF;

  IF v_nuevo THEN
    -- Los triggers de usuario se apagan solo durante el reclasificado: ni historial, ni avisos, ni «Se requiere sesión».
    ALTER TABLE public.tareas        DISABLE TRIGGER USER;
    ALTER TABLE public.tareas_equipo DISABLE TRIGGER USER;

    UPDATE public.tareas t SET nivel = CASE
        WHEN t.origen = 'asignada' THEN
          CASE WHEN t.asignada_por IS NULL OR COALESCE((SELECT a.es_admin FROM public.profiles a WHERE a.id = t.asignada_por), false)
               THEN 'regional' ELSE 'distrital' END
        ELSE
          CASE WHEN EXISTS (SELECT 1 FROM public.profiles p
                             WHERE p.id = t.asignada_a AND NOT COALESCE(p.es_admin, false) AND p.tipo_miembro IS DISTINCT FROM 'secretario'
                               AND public.distrito_tiene_secretaria(p.distrito))
               THEN 'distrital' ELSE 'regional' END
      END;
    UPDATE public.tareas SET tipo_entrega = 'enlace' WHERE entrega_url IS NOT NULL;

    UPDATE public.tareas_equipo t SET nivel = CASE WHEN EXISTS (SELECT 1 FROM public.equipos e WHERE e.id = t.equipo_id AND e.distrito IS NOT NULL)
                                                   THEN 'distrital' ELSE 'regional' END;
    UPDATE public.tareas_equipo SET tipo_entrega = 'enlace' WHERE entrega_url IS NOT NULL;

    ALTER TABLE public.tareas        ENABLE TRIGGER USER;
    ALTER TABLE public.tareas_equipo ENABLE TRIGGER USER;
  END IF;
END $m65$;

-- ── 3. Quién revisa una tarea (pedido 15) ─────────────────────────────
--  Igual que puede_revisar_tarea(), pero una INICIATIVA REGIONAL solo la revisa la administración.
CREATE OR REPLACE FUNCTION public.puede_revisar_tarea_fila(p_asignada_a UUID, p_origen TEXT, p_nivel TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_admin()
      OR (public.is_secretario()
          AND NOT (p_origen = 'propia' AND p_nivel = 'regional')
          AND p_asignada_a IS DISTINCT FROM auth.uid()
          AND p_asignada_a IN (SELECT public.get_district_member_ids()));
$$;
REVOKE EXECUTE ON FUNCTION public.puede_revisar_tarea_fila(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puede_revisar_tarea_fila(UUID, TEXT, TEXT) TO authenticated;

--  ¿Puedo elegir «Distrital» al crear mi iniciativa? (tengo distrito con secretaría y no soy secretaría ni administración)
CREATE OR REPLACE FUNCTION public.mi_instancia_distrital_disponible()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.id = auth.uid() AND NOT COALESCE(p.es_admin, false) AND p.tipo_miembro IS DISTINCT FROM 'secretario'
       AND public.distrito_tiene_secretaria(p.distrito));
$$;
REVOKE EXECUTE ON FUNCTION public.mi_instancia_distrital_disponible() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mi_instancia_distrital_disponible() TO authenticated;

-- Quién recibe el aviso de «entrega por revisar» / «bloqueada» de una tarea.
CREATE OR REPLACE FUNCTION public.notif_revisores_tarea(p_persona UUID, p_origen TEXT, p_nivel TEXT) RETURNS SETOF UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_origen IS DISTINCT FROM 'propia' THEN
    RETURN QUERY SELECT x FROM public.notif_revisores(p_persona) x;
    RETURN;
  END IF;
  -- Iniciativa propia: solo la instancia elegida (distrital → secretaría del distrito; si no la hay, administración).
  IF p_nivel = 'distrital' AND public.distrito_tiene_secretaria((SELECT distrito FROM profiles WHERE id = p_persona)) THEN
    RETURN QUERY
      SELECT s.id FROM profiles s JOIN profiles p ON p.id = p_persona
       WHERE s.tipo_miembro = 'secretario' AND NOT COALESCE(s.es_admin, false) AND s.distrito = p.distrito
         AND s.id <> p_persona AND s.aprobado IS NOT FALSE;
  ELSE
    RETURN QUERY
      SELECT a.id FROM profiles a WHERE COALESCE(a.es_admin, false) AND a.id <> p_persona AND a.aprobado IS NOT FALSE;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notif_revisores_tarea(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ── 4. Triggers: el peso se retira; nivel y tipo de entrega con reglas ──
CREATE OR REPLACE FUNCTION public.tareas_nivel_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  NEW.peso := 1;                                    -- el peso de tarea ya no se elige
  IF NEW.origen = 'propia' THEN
    -- La administración y las secretarías no tienen instancia distrital sobre sí: su iniciativa la evalúa la administración.
    IF public.is_admin() OR public.is_secretario() THEN
      NEW.nivel := 'regional';
    ELSIF NEW.nivel = 'distrital'
          AND NOT public.distrito_tiene_secretaria((SELECT p.distrito FROM profiles p WHERE p.id = NEW.asignada_a)) THEN
      NEW.nivel := 'regional';                      -- sin secretaría de distrito → regional
    END IF;
  ELSIF NOT public.is_admin() THEN
    NEW.nivel := 'distrital';                       -- una secretaría solo clasifica tareas distritales
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_nivel_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tareas_zz_nivel_insert ON public.tareas;
CREATE TRIGGER tareas_zz_nivel_insert BEFORE INSERT ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION public.tareas_nivel_insert();

CREATE OR REPLACE FUNCTION public.tareas_nivel_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  NEW.peso := OLD.peso;                             -- congelado: lo heredado se conserva, nadie lo cambia
  IF NEW.nivel IS DISTINCT FROM OLD.nivel AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo la administración cambia el nivel de una tarea (en una iniciativa define quién la evalúa).' USING ERRCODE = '42501';
  END IF;
  IF NEW.tipo_entrega IS DISTINCT FROM OLD.tipo_entrega AND OLD.estado IN ('entregada', 'aprobada') AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'El tipo de entrega no se cambia una vez entregada la tarea.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_nivel_update() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tareas_zz_nivel_update ON public.tareas;
CREATE TRIGGER tareas_zz_nivel_update BEFORE UPDATE ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION public.tareas_nivel_update();

CREATE OR REPLACE FUNCTION public.tareas_equipo_nivel_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  NEW.peso := 1;
  IF NOT public.is_admin() THEN NEW.nivel := 'distrital'; END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_equipo_nivel_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tareas_equipo_zz_nivel_insert ON public.tareas_equipo;
CREATE TRIGGER tareas_equipo_zz_nivel_insert BEFORE INSERT ON public.tareas_equipo
  FOR EACH ROW EXECUTE FUNCTION public.tareas_equipo_nivel_insert();

CREATE OR REPLACE FUNCTION public.tareas_equipo_nivel_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  NEW.peso := OLD.peso;
  IF NEW.nivel IS DISTINCT FROM OLD.nivel AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo la administración cambia el nivel de una tarea.' USING ERRCODE = '42501';
  END IF;
  IF NEW.tipo_entrega IS DISTINCT FROM OLD.tipo_entrega AND OLD.estado IN ('entregada', 'aprobada') AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'El tipo de entrega no se cambia una vez entregada la tarea.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_equipo_nivel_update() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tareas_equipo_zz_nivel_update ON public.tareas_equipo;
CREATE TRIGGER tareas_equipo_zz_nivel_update BEFORE UPDATE ON public.tareas_equipo
  FOR EACH ROW EXECUTE FUNCTION public.tareas_equipo_nivel_update();

-- ── 5. Parches (una línea cada uno, con pg_get_functiondef; si ya están, no hacen nada) ──
DO $m65p$
DECLARE
  v_def TEXT;
BEGIN
  -- 5a. tareas_validar_update(): quién es «revisor» pasa a depender del origen y el nivel de la tarea.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'tareas_validar_update';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '0065: falta tareas_validar_update() (0016).';
  ELSIF position('puede_revisar_tarea_fila' IN v_def) = 0 THEN
    IF position('public.puede_revisar_tarea(OLD.asignada_a)' IN v_def) = 0 THEN
      RAISE EXCEPTION '0065: no se encontró puede_revisar_tarea(OLD.asignada_a) en tareas_validar_update(); revisa su definición.';
    END IF;
    EXECUTE replace(v_def, 'public.puede_revisar_tarea(OLD.asignada_a)', 'public.puede_revisar_tarea_fila(OLD.asignada_a, OLD.origen, OLD.nivel)');
  END IF;

  -- 5b. prorrogar_tarea(): misma regla.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'prorrogar_tarea';
  IF v_def IS NOT NULL AND position('puede_revisar_tarea_fila' IN v_def) = 0 THEN
    IF position('public.puede_revisar_tarea(t.asignada_a)' IN v_def) > 0 THEN
      EXECUTE replace(v_def, 'public.puede_revisar_tarea(t.asignada_a)', 'public.puede_revisar_tarea_fila(t.asignada_a, t.origen, t.nivel)');
    ELSE
      RAISE WARNING '0065: prorrogar_tarea() no usa la forma esperada; revisa a mano que una secretaría no prorrogue una iniciativa regional.';
    END IF;
  END IF;

  -- 5c. notif_trg_tarea(): la entrega de una iniciativa avisa solo a la instancia elegida.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'notif_trg_tarea';
  IF v_def IS NULL THEN
    RAISE NOTICE '0065: notif_trg_tarea() no existe (falta 0019/0040): no se parchean los avisos.';
  ELSIF position('notif_revisores_tarea' IN v_def) = 0 THEN
    IF position('notif_revisores(NEW.asignada_a)' IN v_def) = 0 THEN
      RAISE EXCEPTION '0065: no se encontró notif_revisores(NEW.asignada_a) en notif_trg_tarea(); revisa su definición.';
    END IF;
    EXECUTE replace(v_def, 'notif_revisores(NEW.asignada_a)', 'notif_revisores_tarea(NEW.asignada_a, NEW.origen, NEW.nivel)');
  END IF;
END $m65p$;

-- ── 6. Motor de notas por nivel ───────────────────────────────────────

-- 6a. Reglas del PE (calif_config + calif_config_guardar, con los dos multiplicadores nuevos)
-- ── 1. calif_config (una columna más) ─────────────────────────────────
DROP FUNCTION IF EXISTS public.calif_config(UUID);
CREATE FUNCTION public.calif_config(p_periodo UUID)
RETURNS TABLE (peso_tareas NUMERIC, mult_individual NUMERIC, mult_colectiva NUMERIC, minimo_tareas INT,
               contar_propias BOOLEAN, vencidas_como_cero BOOLEAN, confirmado BOOLEAN, definida BOOLEAN, sin_tareas_pierde_puntos BOOLEAN,
               mult_distrital NUMERIC, mult_regional NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(c.peso_tareas, 0), COALESCE(c.mult_individual, 1), COALESCE(c.mult_colectiva, 1),
         COALESCE(c.minimo_tareas, 1), COALESCE(c.contar_propias, true), COALESCE(c.vencidas_como_cero, false),
         COALESCE(c.confirmado, false), c.periodo_id IS NOT NULL, COALESCE(c.sin_tareas_pierde_puntos, false),
         COALESCE(c.mult_distrital, 1), COALESCE(c.mult_regional, 1)
    FROM (SELECT 1) x LEFT JOIN periodo_calif_config c ON c.periodo_id = p_periodo
   WHERE auth.uid() IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.calif_config(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.calif_config(UUID) TO authenticated;

-- ── 2. calif_config_guardar (un parámetro más, al final) ──────────────
DROP FUNCTION IF EXISTS public.calif_config_guardar(UUID, NUMERIC, NUMERIC, NUMERIC, INT, BOOLEAN, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.calif_config_guardar(UUID, NUMERIC, NUMERIC, NUMERIC, INT, BOOLEAN, BOOLEAN, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.calif_config_guardar(UUID, NUMERIC, NUMERIC, NUMERIC, INT, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, NUMERIC, NUMERIC);
CREATE FUNCTION public.calif_config_guardar(
  p_periodo UUID, p_peso_tareas NUMERIC, p_mult_individual NUMERIC DEFAULT 1, p_mult_colectiva NUMERIC DEFAULT 1,
  p_minimo_tareas INT DEFAULT 1, p_contar_propias BOOLEAN DEFAULT true, p_vencidas_como_cero BOOLEAN DEFAULT false,
  p_motivo TEXT DEFAULT NULL, p_sin_tareas_pierde_puntos BOOLEAN DEFAULT false,
  p_mult_distrital NUMERIC DEFAULT NULL, p_mult_regional NUMERIC DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_antes JSONB; v_despues JSONB; v_pub BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo la administracion define las reglas de calificacion.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT modelo FROM periodos_evaluacion WHERE id = p_periodo) IS DISTINCT FROM 'v2' THEN
    RAISE EXCEPTION 'Las reglas de tareas solo existen en PE con la rubrica por roles.' USING ERRCODE = '23514';
  END IF;
  IF NOT public.gestion_escribible(p_periodo) THEN
    RAISE EXCEPTION 'Esta gestion esta archivada: solo lectura.' USING ERRCODE = '42501';
  END IF;
  IF p_peso_tareas IS NULL OR p_peso_tareas < 0 OR p_peso_tareas > 100 THEN
    RAISE EXCEPTION 'El peso de las tareas va de 0 a 100 %%.' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_mult_individual, 0) <= 0 OR COALESCE(p_mult_colectiva, 0) <= 0 THEN
    RAISE EXCEPTION 'Las ponderaciones relativas deben ser mayores que 0.' USING ERRCODE = '23514';
  END IF;
  IF (p_mult_distrital IS NOT NULL AND p_mult_distrital <= 0) OR (p_mult_regional IS NOT NULL AND p_mult_regional <= 0) THEN
    RAISE EXCEPTION 'Las ponderaciones por nivel deben ser mayores que 0.' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_minimo_tareas, 0) < 1 THEN
    RAISE EXCEPTION 'El minimo de tareas calificadas es 1 o mas.' USING ERRCODE = '23514';
  END IF;
  v_pub := EXISTS (SELECT 1 FROM evaluaciones WHERE periodo_id = p_periodo AND estado = 'publicado');
  IF v_pub AND char_length(COALESCE(btrim(p_motivo), '')) < 5 THEN
    RAISE EXCEPTION 'Ya hay evaluaciones publicadas: cambiar las reglas cambia sus resultados; explica el motivo (minimo 5 caracteres).' USING ERRCODE = '23514';
  END IF;

  SELECT to_jsonb(c) - 'actualizado_por' - 'actualizado_en' INTO v_antes FROM periodo_calif_config c WHERE c.periodo_id = p_periodo;
  INSERT INTO periodo_calif_config (periodo_id, peso_tareas, mult_individual, mult_colectiva, minimo_tareas, contar_propias,
                                    vencidas_como_cero, sin_tareas_pierde_puntos, mult_distrital, mult_regional, confirmado, actualizado_por, actualizado_en)
  VALUES (p_periodo, p_peso_tareas, p_mult_individual, p_mult_colectiva, p_minimo_tareas, COALESCE(p_contar_propias, true),
          COALESCE(p_vencidas_como_cero, false), COALESCE(p_sin_tareas_pierde_puntos, false),
          COALESCE(p_mult_distrital, (SELECT x.mult_distrital FROM periodo_calif_config x WHERE x.periodo_id = p_periodo), 1),
          COALESCE(p_mult_regional, (SELECT x.mult_regional FROM periodo_calif_config x WHERE x.periodo_id = p_periodo), 1),
          true, auth.uid(), NOW())
  ON CONFLICT (periodo_id) DO UPDATE SET
    peso_tareas = EXCLUDED.peso_tareas, mult_individual = EXCLUDED.mult_individual, mult_colectiva = EXCLUDED.mult_colectiva,
    minimo_tareas = EXCLUDED.minimo_tareas, contar_propias = EXCLUDED.contar_propias,
    vencidas_como_cero = EXCLUDED.vencidas_como_cero, sin_tareas_pierde_puntos = EXCLUDED.sin_tareas_pierde_puntos, mult_distrital = EXCLUDED.mult_distrital,
    mult_regional = EXCLUDED.mult_regional, confirmado = true,
    actualizado_por = auth.uid(), actualizado_en = NOW();
  SELECT to_jsonb(c) - 'actualizado_por' - 'actualizado_en' INTO v_despues FROM periodo_calif_config c WHERE c.periodo_id = p_periodo;
  INSERT INTO periodo_calif_config_hist (periodo_id, actor_id, antes, despues, motivo)
  VALUES (p_periodo, auth.uid(), v_antes, v_despues, NULLIF(btrim(COALESCE(p_motivo, '')), ''));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.calif_config_guardar(UUID, NUMERIC, NUMERIC, NUMERIC, INT, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, NUMERIC, NUMERIC) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.calif_config_guardar(UUID, NUMERIC, NUMERIC, NUMERIC, INT, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, NUMERIC, NUMERIC) TO authenticated;
-- 6b. calif_items con el nivel
DROP FUNCTION IF EXISTS public.calif_items(UUID);
CREATE FUNCTION public.calif_items(p_periodo UUID)
RETURNS TABLE (
  persona_id UUID, tipo TEXT, tarea_id BIGINT, titulo TEXT, equipo_id BIGINT, equipo_nombre TEXT,
  estado TEXT, origen TEXT, puntos SMALLINT, nota_grupo SMALLINT, individual_en_grupo BOOLEAN,
  peso_tarea NUMERIC, peso_efectivo NUMERIC, cuenta BOOLEAN, razon TEXT,
  fecha_limite DATE, aprobada_en TIMESTAMPTZ, vencida BOOLEAN, nivel TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  cfg   RECORD;
  v_hoy DATE;
BEGIN
  IF (SELECT modelo FROM periodos_evaluacion WHERE id = p_periodo) IS DISTINCT FROM 'v2' THEN RETURN; END IF;
  SELECT * INTO cfg FROM public.calif_config(p_periodo);
  v_hoy := (NOW() AT TIME ZONE public.zona_periodo(p_periodo))::DATE;

  RETURN QUERY
  WITH ind AS (
    SELECT t.asignada_a AS persona, t.id, t.titulo, t.estado, t.origen, t.puntos, t.peso, t.nota_anulada_en, t.fecha_limite,
           t.aprobada_en, t.entregada_en, t.nivel,
           (t.estado IN ('asignada','en_curso') AND t.entregada_en IS NULL AND t.fecha_limite IS NOT NULL AND t.fecha_limite < v_hoy) AS venc
      FROM tareas t WHERE t.periodo_id = p_periodo
  ),
  col AS (
    SELECT p.persona_id AS persona, t.id, t.titulo, t.estado, t.puntos AS nota_grupo, p.puntos_individual, t.peso, t.nota_anulada_en,
           t.fecha_limite, t.aprobada_en, t.equipo_id, e.nombre AS equipo, t.nivel,
           (t.estado IN ('asignada','en_curso') AND t.entregada_en IS NULL AND t.fecha_limite IS NOT NULL AND t.fecha_limite < v_hoy) AS venc,
           -- Cuenta quien participaba al aprobarse, o aportó algo aunque haya salido antes.
           CASE WHEN t.estado = 'aprobada' THEN
                  ((p.desde <= t.aprobada_en AND (p.hasta IS NULL OR p.hasta > t.aprobada_en))
                   OR EXISTS (SELECT 1 FROM tarea_equipo_aportes a WHERE a.tarea_id = t.id AND a.persona_id = p.persona_id))
                ELSE (p.hasta IS NULL) END AS participa
      FROM tareas_equipo t
      JOIN equipos e ON e.id = t.equipo_id
      JOIN tarea_equipo_participantes p ON p.tarea_id = t.id
     WHERE t.periodo_id = p_periodo
  )
  SELECT i.persona, 'individual'::TEXT, i.id, i.titulo, NULL::BIGINT, NULL::TEXT, i.estado, i.origen,
         i.puntos, NULL::SMALLINT, false,
         i.peso * public.calif_mult_nivel(i.nivel, i.origen, cfg.mult_distrital, cfg.mult_regional),
         i.peso * public.calif_mult_nivel(i.nivel, i.origen, cfg.mult_distrital, cfg.mult_regional) * cfg.mult_individual,
         CASE WHEN i.estado = 'aprobada' THEN (i.puntos IS NOT NULL AND i.nota_anulada_en IS NULL AND (i.origen = 'asignada' OR cfg.contar_propias))
              WHEN i.venc THEN cfg.vencidas_como_cero
              ELSE false END,
         CASE WHEN i.estado = 'anulada' THEN 'tarea_anulada'
              WHEN i.estado = 'aprobada' AND i.nota_anulada_en IS NOT NULL THEN 'nota_anulada'
              WHEN i.estado = 'aprobada' AND i.puntos IS NULL THEN 'sin_puntos'
              WHEN i.estado = 'aprobada' AND i.origen = 'propia' AND NOT cfg.contar_propias THEN 'propia_excluida'
              WHEN i.estado = 'aprobada' THEN 'calificada'
              WHEN i.venc AND cfg.vencidas_como_cero THEN 'vencida_como_cero'
              WHEN i.venc THEN 'vencida'
              WHEN i.estado = 'entregada' THEN 'pendiente_de_evaluacion'
              WHEN i.estado = 'bloqueada' THEN 'bloqueada'
              WHEN i.estado = 'devuelta' THEN 'devuelta'
              ELSE 'en_curso' END,
         i.fecha_limite, i.aprobada_en, i.venc, i.nivel
    FROM ind i
  UNION ALL
  SELECT c.persona, 'equipo'::TEXT, c.id, c.titulo, c.equipo_id, c.equipo, c.estado, 'grupal'::TEXT,
         COALESCE(c.puntos_individual, c.nota_grupo) , c.nota_grupo, c.puntos_individual IS NOT NULL,
         c.peso * public.calif_mult_nivel(c.nivel, 'grupal', cfg.mult_distrital, cfg.mult_regional),
         c.peso * public.calif_mult_nivel(c.nivel, 'grupal', cfg.mult_distrital, cfg.mult_regional) * cfg.mult_colectiva,
         CASE WHEN c.estado = 'aprobada' THEN (c.participa AND COALESCE(c.puntos_individual, c.nota_grupo) IS NOT NULL AND c.nota_anulada_en IS NULL)
              WHEN c.venc THEN (c.participa AND cfg.vencidas_como_cero)
              ELSE false END,
         CASE WHEN c.estado = 'anulada' THEN 'tarea_anulada'
              WHEN c.estado = 'aprobada' AND NOT c.participa THEN 'no_participo'
              WHEN c.estado = 'aprobada' AND c.nota_anulada_en IS NOT NULL THEN 'nota_anulada'
              WHEN c.estado = 'aprobada' AND COALESCE(c.puntos_individual, c.nota_grupo) IS NULL THEN 'sin_puntos'
              WHEN c.estado = 'aprobada' THEN CASE WHEN c.puntos_individual IS NOT NULL THEN 'individual_en_grupo' ELSE 'nota_del_grupo' END
              WHEN NOT c.participa THEN 'no_participa'
              WHEN c.venc AND cfg.vencidas_como_cero THEN 'vencida_como_cero'
              WHEN c.venc THEN 'vencida'
              WHEN c.estado = 'entregada' THEN 'pendiente_de_evaluacion'
              WHEN c.estado = 'bloqueada' THEN 'bloqueada'
              WHEN c.estado = 'devuelta' THEN 'devuelta'
              ELSE 'en_curso' END,
         c.fecha_limite, c.aprobada_en, c.venc, c.nivel
    FROM col c
   WHERE c.participa OR c.estado IN ('aprobada','anulada');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.calif_items(UUID) FROM PUBLIC, anon, authenticated;

-- Detalle por persona (con el nivel de cada tarea)

DROP FUNCTION IF EXISTS public.tareas_calificacion_detalle(UUID, UUID);
CREATE FUNCTION public.tareas_calificacion_detalle(p_periodo UUID, p_persona UUID DEFAULT NULL)
RETURNS TABLE (
  tipo TEXT, tarea_id BIGINT, titulo TEXT, equipo_id BIGINT, equipo_nombre TEXT, estado TEXT, origen TEXT,
  puntos SMALLINT, nota_grupo SMALLINT, individual_en_grupo BOOLEAN, peso_tarea NUMERIC, peso_efectivo NUMERIC,
  cuenta BOOLEAN, razon TEXT, aporte_pct NUMERIC, aporte_puntos NUMERIC, fecha_limite DATE, aprobada_en TIMESTAMPTZ, vencida BOOLEAN, nivel TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_p UUID := COALESCE(p_persona, auth.uid());
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  IF NOT public.calif_puede_ver(v_p) THEN RETURN; END IF;
  RETURN QUERY
  WITH it AS (SELECT * FROM public.calif_items(p_periodo) i WHERE i.persona_id = v_p),
       tot AS (SELECT NULLIF(SUM(x.peso_efectivo) FILTER (WHERE x.cuenta), 0) AS s FROM it x)
  SELECT i.tipo, i.tarea_id, i.titulo, i.equipo_id, i.equipo_nombre, i.estado, i.origen, i.puntos, i.nota_grupo,
         i.individual_en_grupo, i.peso_tarea, i.peso_efectivo, i.cuenta, i.razon,
         CASE WHEN i.cuenta THEN ROUND(100 * i.peso_efectivo / (SELECT s FROM tot), 1) END,
         CASE WHEN i.cuenta THEN ROUND(100 * i.peso_efectivo * COALESCE(i.puntos, 0) / 10.0 / (SELECT s FROM tot), 1) END,
         i.fecha_limite, i.aprobada_en, i.vencida, i.nivel
    FROM it i
   ORDER BY i.cuenta DESC, i.aprobada_en DESC NULLS LAST, i.fecha_limite NULLS LAST, i.tarea_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_calificacion_detalle(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tareas_calificacion_detalle(UUID, UUID) TO authenticated;


-- Tareas del equipo con su estado (más: nivel y tipo de entrega)

--  p_equipo NULL = todas las que la persona puede ver (para «Mis tareas»). Una fila por tarea.
DROP FUNCTION IF EXISTS public.tareas_equipo_estado(BIGINT, UUID);
CREATE FUNCTION public.tareas_equipo_estado(p_equipo BIGINT DEFAULT NULL, p_periodo UUID DEFAULT NULL)
RETURNS TABLE (
  tarea_id BIGINT, equipo_id BIGINT, equipo_nombre TEXT, periodo_id UUID, titulo TEXT, descripcion TEXT, instrucciones TEXT,
  criterios_evaluacion TEXT, criterios TEXT[], prioridad TEXT, estado TEXT, fecha_limite DATE, fecha_limite_original DATE,
  asignada_en TIMESTAMPTZ, responsable_id UUID, responsable_nombre TEXT, avance INT, participantes INT, aportes INT,
  entrega_url TEXT, entrega_nota TEXT, entregada_por UUID, entregada_por_nombre TEXT, entregada_en TIMESTAMPTZ,
  revision_nota TEXT, bloqueo_motivo TEXT, rondas_revision INT, puntos SMALLINT, puntos_original SMALLINT, peso NUMERIC,
  nota_anulada BOOLEAN, aprobada_en TIMESTAMPTZ, vencida BOOLEAN, soy_participante BOOLEAN, puedo_revisar BOOLEAN,
  nivel TEXT, tipo_entrega TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT t.id, t.equipo_id, e.nombre, t.periodo_id, t.titulo, t.descripcion, t.instrucciones, t.criterios_evaluacion, t.criterios,
         t.prioridad, t.estado, t.fecha_limite, t.fecha_limite_original, t.asignada_en, t.responsable_id,
         COALESCE(NULLIF(rp.nombre, ''), rp.email), public.tarea_equipo_avance(t.id),
         (SELECT COUNT(*)::INT FROM tarea_equipo_participantes p WHERE p.tarea_id = t.id AND p.hasta IS NULL),
         (SELECT COUNT(*)::INT FROM tarea_equipo_aportes a WHERE a.tarea_id = t.id),
         t.entrega_url, t.entrega_nota, t.entregada_por, COALESCE(NULLIF(ep.nombre, ''), ep.email), t.entregada_en,
         t.revision_nota, t.bloqueo_motivo, t.rondas_revision, t.puntos, t.puntos_original, t.peso,
         (t.nota_anulada_en IS NOT NULL), t.aprobada_en,
         (t.estado IN ('asignada','en_curso') AND t.entregada_en IS NULL AND t.fecha_limite IS NOT NULL
            AND t.fecha_limite < (NOW() AT TIME ZONE public.zona_periodo(t.periodo_id))::DATE),
         public.soy_participante_tarea_equipo(t.id, true), public.puede_revisar_tarea_equipo(t.id),
         t.nivel, t.tipo_entrega
    FROM tareas_equipo t
    JOIN equipos e ON e.id = t.equipo_id
    LEFT JOIN profiles rp ON rp.id = t.responsable_id
    LEFT JOIN profiles ep ON ep.id = t.entregada_por
   WHERE (p_equipo IS NULL OR t.equipo_id = p_equipo)
     AND (p_periodo IS NULL OR t.periodo_id = p_periodo)
     AND public.tarea_equipo_visible(t.id)
   ORDER BY (t.estado IN ('aprobada','anulada')), t.fecha_limite NULLS LAST, t.id DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tareas_equipo_estado(BIGINT, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tareas_equipo_estado(BIGINT, UUID) TO authenticated;

-- Resultado del equipo (cada tarea una vez, con su multiplicador de nivel)

--  (con las notas individuales dentro del grupo, si las hubo).
DROP FUNCTION IF EXISTS public.equipo_resultados(BIGINT);
CREATE FUNCTION public.equipo_resultados(p_equipo BIGINT)
RETURNS TABLE (persona_id UUID, nombre TEXT, tareas_cuentan INT, tareas_total INT, nota NUMERIC, con_nota_individual INT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_periodo UUID;
  v_md NUMERIC; v_mr NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  IF NOT public.equipo_visible(p_equipo) THEN RETURN; END IF;
  SELECT e.periodo_id INTO v_periodo FROM equipos e WHERE e.id = p_equipo;
  SELECT c.mult_distrital, c.mult_regional INTO v_md, v_mr FROM public.calif_config(v_periodo) c;

  RETURN QUERY
  SELECT NULL::UUID, 'Equipo'::TEXT,
         (COUNT(*) FILTER (WHERE t.estado = 'aprobada' AND t.puntos IS NOT NULL AND t.nota_anulada_en IS NULL))::INT,
         (COUNT(*) FILTER (WHERE t.estado <> 'anulada'))::INT,
         ROUND(100 * SUM(t.peso * public.calif_mult_nivel(t.nivel, 'grupal', v_md, v_mr) * t.puntos / 10.0) FILTER (WHERE t.estado = 'aprobada' AND t.puntos IS NOT NULL AND t.nota_anulada_en IS NULL)
               / NULLIF(SUM(t.peso * public.calif_mult_nivel(t.nivel, 'grupal', v_md, v_mr)) FILTER (WHERE t.estado = 'aprobada' AND t.puntos IS NOT NULL AND t.nota_anulada_en IS NULL), 0), 1),
         0
    FROM tareas_equipo t WHERE t.equipo_id = p_equipo
  UNION ALL
  SELECT i.persona_id, COALESCE(NULLIF(pf.nombre, ''), pf.email),
         (COUNT(*) FILTER (WHERE i.cuenta))::INT,
         (COUNT(*) FILTER (WHERE i.razon NOT IN ('tarea_anulada','no_participa')))::INT,
         ROUND(100 * SUM(i.peso_tarea * COALESCE(i.puntos, 0) / 10.0) FILTER (WHERE i.cuenta)
               / NULLIF(SUM(i.peso_tarea) FILTER (WHERE i.cuenta), 0), 1),
         (COUNT(*) FILTER (WHERE i.cuenta AND i.individual_en_grupo))::INT
    FROM public.calif_items(v_periodo) i
    JOIN profiles pf ON pf.id = i.persona_id
   WHERE i.tipo = 'equipo' AND i.equipo_id = p_equipo AND public.calif_puede_ver(i.persona_id)
   GROUP BY i.persona_id, pf.nombre, pf.email;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipo_resultados(BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.equipo_resultados(BIGINT) TO authenticated;



COMMIT;

-- ── Comprobaciones sugeridas ──────────────────────────────────────────
--   SELECT nivel, COUNT(*) FROM public.tareas GROUP BY 1;                 -- las existentes quedaron clasificadas
--   SELECT nivel, COUNT(*) FROM public.tareas_equipo GROUP BY 1;
--   SELECT periodo_id, mult_distrital, mult_regional FROM public.periodo_calif_config;   -- 1 y 1: nada cambia
--   -- Paridad: compara resultados_periodo(<pe>) antes y después; con 1 y 1 son idénticos.

-- ── REVERSA (solo si hiciera falta; ejecutar en este orden) ────────────
--  1. Restaurar las definiciones anteriores: calif_items y tareas_calificacion_detalle (0034), calif_config y calif_config_guardar
--     (0061), tareas_equipo_estado y equipo_resultados (0036), tareas_validar_update / prorrogar_tarea (0016) y notif_trg_tarea (0040).
--  2. DROP TRIGGER tareas_zz_nivel_insert, tareas_zz_nivel_update ON public.tareas;
--     DROP TRIGGER tareas_equipo_zz_nivel_insert, tareas_equipo_zz_nivel_update ON public.tareas_equipo;
--  3. DROP FUNCTION public.tareas_nivel_insert(), tareas_nivel_update(), tareas_equipo_nivel_insert(), tareas_equipo_nivel_update(),
--     puede_revisar_tarea_fila(UUID,TEXT,TEXT), mi_instancia_distrital_disponible(), notif_revisores_tarea(UUID,TEXT,TEXT),
--     calif_mult_nivel(TEXT,TEXT,NUMERIC,NUMERIC), distrito_tiene_secretaria(TEXT);
--  4. ALTER TABLE public.tareas DROP COLUMN nivel, DROP COLUMN tipo_entrega;
--     ALTER TABLE public.tareas_equipo DROP COLUMN nivel, DROP COLUMN tipo_entrega;
--     ALTER TABLE public.periodo_calif_config DROP COLUMN mult_distrital, DROP COLUMN mult_regional;
