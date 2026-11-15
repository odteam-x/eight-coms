-- ══════════════════════════════════════════════════════════════════════
--  0062 — Hasta dos roles por persona, y evaluación por rol
-- ══════════════════════════════════════════════════════════════════════
--
--  PEDIDO. Que una persona pueda tener más de un rol (máximo 2) y que, según las tareas, se la evalúe por uno u otro. La
--  administración definió el impacto en la rúbrica (lo de abajo).
--
--  MODELO. Rol principal = profiles.rol_id (decide el perfil y el núcleo, como siempre). Rol secundario = la única fila de
--  persona_roles distinta del principal. Máximo 2 roles distintos por persona (triggers; lo ya guardado NO se borra: ver sección 9).
--
--  EVALUACIÓN. Sigue habiendo UNA evaluación por persona y período (no cambia la unicidad ni nada de lo que la lee: seguimiento,
--  reportes, cobertura, versiones, rectificación). Se le agregan dos columnas: `puntajes_rol2` (puntajes TÉCNICOS del rol secundario,
--  de 0 a su peso en el perfil de ese rol) y `perfil2_id` (el perfil vigente de ese rol, fijado al primer guardado con datos). El núcleo
--  transversal se puntúa UNA sola vez (en `puntajes`). Con `puntajes_rol2` vacío todo funciona exactamente como antes.
--
--  IMPACTO EN LA RÚBRICA (resultados_periodo):
--    peso del rol = suma del peso efectivo de las tareas que CUENTAN en el período con ese rol (tareas.rol_id; una tarea sin rol o de
--    equipo cuenta para el principal). w2 = peso_rol2 / peso_total, solo si hay puntajes del rol 2 y tiene tareas que cuenten.
--      técnico   = (1 − w2)·técnico_rol1 + w2·técnico_rol2
--      percentil = (1 − w2)·percentil_en_rol1 + w2·percentil_en_rol2   (cada rol se compara solo con quienes tienen puntajes de ESE rol;
--                                                                       rol pequeño n < 4 → su técnico, como siempre)
--      individual = (1 − w)·(0.6·técnico + 0.4·núcleo) + w·nota de tareas        general = (1 − w)·(0.4·núcleo + 0.6·percentil) + w·tareas
--    Si hay tareas del rol 2 pero falta su evaluación → `rol2_incompleta = true` y se usa solo el principal (nunca se rellena con 0).
--    Una persona con un solo rol (o sin puntajes del rol 2) da EXACTAMENTE el resultado de antes (prueba de paridad en sql-0062.mjs).
--
--  QUÉ CAMBIA. Columnas nuevas en evaluaciones; rol_secundario_de(); triggers de máximo 2; evaluaciones_validar_modelo() (valida y exige
--  completar los puntajes del rol 2), evaluaciones_publicada_guardia() y _eval_estado_json() (la rectificación y el historial incluyen
--  los puntajes del rol 2); rectificar_evaluacion() con un parámetro más (puntajes del rol 2); resultados_periodo() con columnas nuevas
--  (rol2_id, rol2_nombre, tecnico_rol1, tecnico_rol2, peso_rol2, rol2_incompleta); personas_con_mas_de_dos_roles().
--
--  Aplicar DESPUÉS de 0061. Idempotente. Reversa al final.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Columnas ───────────────────────────────────────────────────────
ALTER TABLE public.evaluaciones
  ADD COLUMN IF NOT EXISTS puntajes_rol2 JSONB  NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS perfil2_id    BIGINT REFERENCES public.perfiles_rol(id);

-- ── 2. El rol secundario de una persona (interna) ─────────────────────
CREATE OR REPLACE FUNCTION public.rol_secundario_de(p_persona UUID) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT pr.rol_id FROM persona_roles pr
   WHERE pr.persona_id = p_persona
     AND pr.rol_id IS DISTINCT FROM (SELECT p.rol_id FROM profiles p WHERE p.id = p_persona)
   ORDER BY pr.created_at, pr.rol_id LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.rol_secundario_de(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. Máximo 2 roles por persona ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.persona_roles_max2() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_princ BIGINT; n INT;
BEGIN
  SELECT p.rol_id INTO v_princ FROM profiles p WHERE p.id = NEW.persona_id;
  SELECT COUNT(*) INTO n FROM (
    SELECT v_princ AS r WHERE v_princ IS NOT NULL
    UNION SELECT pr.rol_id FROM persona_roles pr
           WHERE pr.persona_id = NEW.persona_id
             AND NOT (TG_OP = 'UPDATE' AND pr.persona_id = OLD.persona_id AND pr.rol_id = OLD.rol_id)
    UNION SELECT NEW.rol_id
  ) s;
  IF n > 2 THEN
    RAISE EXCEPTION 'Una persona puede tener como maximo 2 roles (el principal y uno mas).' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.persona_roles_max2() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS persona_roles_max2 ON public.persona_roles;
CREATE TRIGGER persona_roles_max2 BEFORE INSERT OR UPDATE OF persona_id, rol_id ON public.persona_roles
  FOR EACH ROW EXECUTE FUNCTION public.persona_roles_max2();

CREATE OR REPLACE FUNCTION public.profiles_rol_max2() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n INT;
BEGIN
  IF NEW.rol_id IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO n FROM (
    SELECT NEW.rol_id::BIGINT AS r UNION SELECT pr.rol_id FROM persona_roles pr WHERE pr.persona_id = NEW.id
  ) s;
  IF n > 2 THEN
    RAISE EXCEPTION 'Con ese rol principal la persona tendria mas de 2 roles: quita primero uno de sus roles habilitados.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.profiles_rol_max2() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS profiles_rol_max2 ON public.profiles;
CREATE TRIGGER profiles_rol_max2 BEFORE UPDATE OF rol_id ON public.profiles
  FOR EACH ROW WHEN (NEW.rol_id IS DISTINCT FROM OLD.rol_id) EXECUTE FUNCTION public.profiles_rol_max2();

-- ── 4. Validación de la evaluación (con los puntajes del segundo rol) ─
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
  v_faltan2 TEXT;
  v_c       RECORD;
  v_viejo   JSONB;
  v_tipo    TEXT;
  v_max     INT;
  v_rol2    BIGINT;
BEGIN
  SELECT modelo, gestion_id INTO v_modelo, v_gestion
    FROM periodos_evaluacion WHERE id = NEW.periodo_id;
  NEW.modelo := COALESCE(v_modelo, 'legacy');

  IF NEW.modelo <> 'v2' THEN
    NEW.escala := 'cinco';   -- sin significado fuera de v2
    NEW.perfil_id := NULL;
    NEW.respuestas := '{}'::jsonb;
    NEW.perfil2_id := NULL;
    NEW.puntajes_rol2 := '{}'::jsonb;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.bono_ext, 0) <> 0 THEN
    RAISE EXCEPTION 'La rubrica v2 no tiene bono.' USING ERRCODE = '23514';
  END IF;

  -- Escala: la fija el servidor en el primer guardado y no cambia. Lo guardado antes de 0023 sigue siendo 'cinco'
  -- (1 a 5); lo nuevo es 'pesos' (cada criterio puntúa de 0 a su propio peso). Lo que mande el cliente se ignora.
  IF TG_OP = 'UPDATE' THEN NEW.escala := OLD.escala; ELSE NEW.escala := 'pesos'; END IF;

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

  -- Segundo rol (0062): los puntajes técnicos del rol secundario viven en la MISMA evaluación (una por persona y período). El perfil
  -- del segundo rol se fija al primer guardado con datos y no cambia. El núcleo se puntúa una sola vez (arriba).
  IF jsonb_typeof(COALESCE(NEW.puntajes_rol2, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'puntajes_rol2 debe ser un objeto.' USING ERRCODE = '23514';
  END IF;
  NEW.puntajes_rol2 := COALESCE(NEW.puntajes_rol2, '{}'::jsonb);
  IF TG_OP = 'UPDATE' AND OLD.perfil2_id IS NOT NULL THEN
    NEW.perfil2_id := OLD.perfil2_id;
  ELSIF NEW.puntajes_rol2 = '{}'::jsonb THEN
    NEW.perfil2_id := NULL;
  ELSE
    IF NEW.escala <> 'pesos' THEN
      RAISE EXCEPTION 'El segundo rol solo se evalúa en evaluaciones con puntuación por peso.' USING ERRCODE = '23514';
    END IF;
    v_rol2 := public.rol_secundario_de(NEW.evaluado_id);
    IF v_rol2 IS NULL THEN
      RAISE EXCEPTION 'La persona evaluada no tiene un segundo rol habilitado.' USING ERRCODE = '23514';
    END IF;
    NEW.perfil2_id := public.perfil_vigente(v_rol2, NEW.periodo_id);
    IF NEW.perfil2_id IS NULL THEN
      RAISE EXCEPTION 'No hay un perfil de evaluacion vigente para el segundo rol en este periodo.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF jsonb_typeof(NEW.puntajes) <> 'object' THEN
    RAISE EXCEPTION 'puntajes debe ser un objeto.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(COALESCE(NEW.respuestas, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'respuestas debe ser un objeto.' USING ERRCODE = '23514';
  END IF;
  NEW.respuestas := COALESCE(NEW.respuestas, '{}'::jsonb);

  -- Puntajes: solo criterios de escala del nucleo o del perfil. Los desactivados despues siguen
  -- valiendo si ya estaban en la evaluacion (historia), pero no se agregan a una nueva.
  FOR v_clave, v_val IN SELECT key, value FROM jsonb_each(NEW.puntajes) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM criterios_v2 c
       WHERE c.gestion_id = v_gestion AND c.key = v_clave AND c.tipo_campo = 'escala'
         AND (c.activo OR (TG_OP = 'UPDATE' AND OLD.puntajes ? v_clave))
         AND (c.tipo = 'nucleo'
              OR v_clave IN (SELECT criterio_key FROM perfil_criterios WHERE perfil_id = NEW.perfil_id))
    ) THEN
      RAISE EXCEPTION 'El criterio "%" no aplica a este perfil.', v_clave USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(v_val) <> 'number' THEN
      RAISE EXCEPTION 'El puntaje de "%" debe ser un numero.', v_clave USING ERRCODE = '23514';
    END IF;
    v_num := (v_val #>> '{}')::NUMERIC;
    IF v_num <> trunc(v_num) THEN
      RAISE EXCEPTION 'El puntaje de "%" debe ser un numero entero.', v_clave USING ERRCODE = '23514';
    END IF;
    IF NEW.escala = 'cinco' THEN
      IF v_num < 1 OR v_num > 5 THEN
        RAISE EXCEPTION 'El puntaje de "%" debe ser un entero de 1 a 5.', v_clave USING ERRCODE = '23514';
      END IF;
    ELSE
      -- Nucleo: 0 a 10 (todos pesan igual). Tecnico: 0 a su peso en el perfil de la evaluacion.
      SELECT c.tipo INTO v_tipo FROM criterios_v2 c WHERE c.gestion_id = v_gestion AND c.key = v_clave;
      IF v_tipo = 'nucleo' THEN
        v_max := 10;
      ELSE
        SELECT pc.peso INTO v_max FROM perfil_criterios pc WHERE pc.perfil_id = NEW.perfil_id AND pc.criterio_key = v_clave;
      END IF;
      IF v_num < 0 OR v_num > COALESCE(v_max, 0) THEN
        RAISE EXCEPTION 'El puntaje de "%" debe ser un entero de 0 a %.', v_clave, COALESCE(v_max, 0) USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;

  -- Puntajes del segundo rol: solo criterios técnicos de su perfil (el núcleo no se repite), de 0 a su peso.
  FOR v_clave, v_val IN SELECT key, value FROM jsonb_each(NEW.puntajes_rol2) LOOP
    SELECT pc.peso INTO v_max FROM perfil_criterios pc
      JOIN criterios_v2 c ON c.gestion_id = v_gestion AND c.key = pc.criterio_key AND c.tipo <> 'nucleo' AND c.tipo_campo = 'escala'
     WHERE pc.perfil_id = NEW.perfil2_id AND pc.criterio_key = v_clave
       AND (c.activo OR (TG_OP = 'UPDATE' AND OLD.puntajes_rol2 ? v_clave));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El criterio "%" no aplica al perfil del segundo rol.', v_clave USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(v_val) <> 'number' OR (v_val #>> '{}')::NUMERIC <> trunc((v_val #>> '{}')::NUMERIC) THEN
      RAISE EXCEPTION 'El puntaje de "%" (segundo rol) debe ser un numero entero.', v_clave USING ERRCODE = '23514';
    END IF;
    IF (v_val #>> '{}')::NUMERIC < 0 OR (v_val #>> '{}')::NUMERIC > COALESCE(v_max, 0) THEN
      RAISE EXCEPTION 'El puntaje de "%" (segundo rol) debe ser un entero de 0 a %.', v_clave, COALESCE(v_max, 0) USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- Respuestas: campos de registro del catalogo, con el tipo que declaran.
  FOR v_clave, v_val IN SELECT key, value FROM jsonb_each(NEW.respuestas) LOOP
    SELECT * INTO v_c FROM criterios_v2 c
     WHERE c.gestion_id = v_gestion AND c.key = v_clave AND c.tipo_campo <> 'escala'
       AND (c.activo OR (TG_OP = 'UPDATE' AND OLD.respuestas ? v_clave));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El campo "%" no aplica a esta evaluacion.', v_clave USING ERRCODE = '23514';
    END IF;
    IF v_c.tipo_campo = 'si_no' THEN
      IF jsonb_typeof(v_val) <> 'boolean' THEN
        RAISE EXCEPTION 'La respuesta de "%" debe ser si o no.', v_c.nombre USING ERRCODE = '23514';
      END IF;
    ELSIF v_c.tipo_campo = 'opcion' THEN
      IF jsonb_typeof(v_val) <> 'string' OR NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_c.opciones) o WHERE o = v_val) THEN
        RAISE EXCEPTION 'La respuesta de "%" debe ser una de sus opciones.', v_c.nombre USING ERRCODE = '23514';
      END IF;
    ELSE
      IF jsonb_typeof(v_val) <> 'string' OR btrim(v_val #>> '{}') = '' OR char_length(v_val #>> '{}') > 1000 THEN
        RAISE EXCEPTION 'La respuesta de "%" debe ser un texto de hasta 1000 caracteres.', v_c.nombre USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;

  IF NEW.estado = 'publicado' THEN
    -- Solo lo obligatorio y vigente: lo opcional sin responder se omite (no vale 0).
    SELECT string_agg(c.nombre, ', ' ORDER BY c.orden) INTO v_faltan
      FROM criterios_v2 c
     WHERE c.gestion_id = v_gestion AND c.activo AND c.obligatorio AND c.tipo_campo = 'escala'
       AND (c.tipo = 'nucleo'
            OR c.key IN (SELECT criterio_key FROM perfil_criterios WHERE perfil_id = NEW.perfil_id))
       AND NOT (NEW.puntajes ? c.key);
    SELECT string_agg(c.nombre, ', ' ORDER BY c.orden) INTO v_faltan2
      FROM criterios_v2 c
     WHERE c.gestion_id = v_gestion AND c.activo AND c.obligatorio AND c.tipo_campo <> 'escala'
       AND NOT (NEW.respuestas ? c.key);
    IF v_faltan IS NOT NULL OR v_faltan2 IS NOT NULL THEN
      RAISE EXCEPTION 'No se puede publicar: faltan por puntuar: %. Faltan por completar: %.',
        COALESCE(v_faltan, 'nada'), COALESCE(v_faltan2, 'nada') USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Si hay puntajes del segundo rol, para publicar deben estar completos (lo obligatorio de su perfil). Sin ellos, se publica igual:
  -- el resultado muestra «evaluación incompleta» del segundo rol y usa solo el principal.
  IF NEW.estado = 'publicado' AND NEW.puntajes_rol2 <> '{}'::jsonb THEN
    SELECT string_agg(c.nombre, ', ' ORDER BY c.orden) INTO v_faltan
      FROM criterios_v2 c
     WHERE c.gestion_id = v_gestion AND c.activo AND c.obligatorio AND c.tipo_campo = 'escala' AND c.tipo <> 'nucleo'
       AND c.key IN (SELECT criterio_key FROM perfil_criterios WHERE perfil_id = NEW.perfil2_id)
       AND NOT (NEW.puntajes_rol2 ? c.key);
    IF v_faltan IS NOT NULL THEN
      RAISE EXCEPTION 'No se puede publicar: faltan por puntuar en el segundo rol: %.', v_faltan USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.evaluaciones_validar_modelo() FROM PUBLIC, anon, authenticated;

-- ── 5. Guardia de la publicada: también protege los puntajes del segundo rol ─
CREATE OR REPLACE FUNCTION public.evaluaciones_publicada_guardia() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_flag  BOOLEAN := COALESCE(current_setting('ec.rectificando', true), '') = '1';
  v_cambia BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Solo se bloquea el borrado directo de un cliente; el borrado en cascada (profundidad > 1) sigue.
    IF OLD.estado = 'publicado' AND auth.uid() IS NOT NULL AND NOT v_flag AND pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION 'Una evaluacion publicada no se borra: usa retirar_evaluacion() con motivo.' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  -- Publicación (INSERT publicado, o borrador → publicado): fecha de publicación. El REGISTRO de la versión lo escribe el
  -- trigger AFTER de abajo: un BEFORE INSERT también corre para la fila propuesta de un `INSERT … ON CONFLICT DO UPDATE`
  -- (el upsert que usa el front), aunque acabe siendo un UPDATE, y registraría dos veces (una con un id que no existe).
  IF NEW.estado = 'publicado' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'publicado') THEN
    NEW.publicada_en := NOW();
    IF TG_OP = 'INSERT' THEN NEW.version := 1; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.estado = 'publicado' THEN
    v_cambia := NEW.estado IS DISTINCT FROM OLD.estado
             OR NEW.puntajes IS DISTINCT FROM OLD.puntajes OR NEW.respuestas IS DISTINCT FROM OLD.respuestas
             OR NEW.puntajes_rol2 IS DISTINCT FROM OLD.puntajes_rol2
             OR NEW.bono_ext IS DISTINCT FROM OLD.bono_ext OR NEW.comentarios IS DISTINCT FROM OLD.comentarios
             OR NEW.evaluado_id IS DISTINCT FROM OLD.evaluado_id OR NEW.periodo_id IS DISTINCT FROM OLD.periodo_id;
    IF v_cambia AND NOT v_flag THEN
      IF auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'La evaluacion ya esta publicada: se corrige con rectificar_evaluacion() (exige motivo y conserva la version anterior).'
          USING ERRCODE = '42501';
      END IF;
      -- Sin sesión (mantenimiento): pasa, pero deja rastro.
      NEW.version := OLD.version + 1; NEW.rectificada_en := NOW();
      INSERT INTO public.evaluaciones_versiones
        (evaluacion_id, periodo_id, evaluado_id, version, accion, antes, despues, motivo, actor)
      VALUES (NEW.id, NEW.periodo_id, NEW.evaluado_id, NEW.version,
              CASE WHEN NEW.estado = 'publicado' THEN 'rectificada' ELSE 'retirada' END,
              public._eval_estado_json(OLD), public._eval_estado_json(NEW), 'Sin sesión (mantenimiento)', NULL);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.evaluaciones_publicada_guardia() FROM PUBLIC, anon, authenticated;

-- ── 6. El historial guarda los puntajes del segundo rol (solo si los hay: lo anterior queda igual) ─
CREATE OR REPLACE FUNCTION public._eval_estado_json(p public.evaluaciones) RETURNS JSONB
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('puntajes', p.puntajes, 'respuestas', p.respuestas, 'bono_ext', p.bono_ext,
                            'comentarios', p.comentarios, 'estado', p.estado)
         || CASE WHEN p.puntajes_rol2 <> '{}'::jsonb THEN jsonb_build_object('puntajes_rol2', p.puntajes_rol2) ELSE '{}'::jsonb END;
$$;
REVOKE EXECUTE ON FUNCTION public._eval_estado_json(public.evaluaciones) FROM PUBLIC, anon, authenticated;

-- ── 7. Rectificar con puntajes del segundo rol (el id es UUID en producción y BIGINT en la base de pruebas) ─
DO $m62$
DECLARE v_id TEXT;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_id
    FROM pg_attribute a WHERE a.attrelid = 'public.evaluaciones'::regclass AND a.attname = 'id' AND NOT a.attisdropped;
  DROP FUNCTION IF EXISTS public.rectificar_evaluacion(BIGINT, JSONB, JSONB, TEXT, JSONB, NUMERIC);
  DROP FUNCTION IF EXISTS public.rectificar_evaluacion(UUID, JSONB, JSONB, TEXT, JSONB, NUMERIC);
  DROP FUNCTION IF EXISTS public.rectificar_evaluacion(BIGINT, JSONB, JSONB, TEXT, JSONB, NUMERIC, JSONB);
  DROP FUNCTION IF EXISTS public.rectificar_evaluacion(UUID, JSONB, JSONB, TEXT, JSONB, NUMERIC, JSONB);
  EXECUTE replace($f$
CREATE OR REPLACE FUNCTION public.rectificar_evaluacion(
  p_id         @@ID@@,
  p_puntajes   JSONB,
  p_comentarios JSONB,
  p_motivo     TEXT,
  p_respuestas JSONB   DEFAULT NULL,   -- NULL = no cambia
  p_bono       NUMERIC DEFAULT NULL,   -- NULL = no cambia (solo rúbrica clásica)
  p_puntajes_rol2 JSONB DEFAULT NULL   -- NULL = no cambia (puntajes técnicos del segundo rol, 0062)
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  e        public.evaluaciones%ROWTYPE;
  n        public.evaluaciones%ROWTYPE;
  v_antes  JSONB;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo la administracion puede rectificar una evaluacion.' USING ERRCODE = '42501';
  END IF;
  IF p_motivo IS NULL OR char_length(btrim(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'La rectificacion exige un motivo (al menos 5 caracteres).' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO e FROM public.evaluaciones WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa evaluacion no existe.' USING ERRCODE = '23514'; END IF;
  IF e.estado <> 'publicado' THEN
    RAISE EXCEPTION 'Solo se rectifica una evaluacion publicada; un borrador se edita directamente.' USING ERRCODE = '23514';
  END IF;
  IF NOT public.gestion_escribible(e.periodo_id) THEN
    RAISE EXCEPTION 'Esa gestion esta archivada: es solo lectura.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_puntajes, '{}'::jsonb)) <> 'object' OR jsonb_typeof(COALESCE(p_comentarios, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'puntajes y comentarios deben ser objetos.' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_puntajes, e.puntajes) IS NOT DISTINCT FROM e.puntajes
     AND COALESCE(p_comentarios, e.comentarios) IS NOT DISTINCT FROM e.comentarios
     AND COALESCE(p_respuestas, e.respuestas) IS NOT DISTINCT FROM e.respuestas
     AND COALESCE(p_bono, e.bono_ext) IS NOT DISTINCT FROM e.bono_ext
     AND COALESCE(p_puntajes_rol2, e.puntajes_rol2) IS NOT DISTINCT FROM e.puntajes_rol2 THEN
    RAISE EXCEPTION 'No hay cambios que rectificar.' USING ERRCODE = '23514';
  END IF;

  v_antes := public._eval_resultado_json(e.periodo_id, e.evaluado_id);

  PERFORM set_config('ec.rectificando', '1', true);
  UPDATE public.evaluaciones
     SET puntajes = COALESCE(p_puntajes, puntajes), comentarios = COALESCE(p_comentarios, comentarios),
         respuestas = COALESCE(p_respuestas, respuestas), bono_ext = COALESCE(p_bono, bono_ext),
         puntajes_rol2 = COALESCE(p_puntajes_rol2, puntajes_rol2),
         version = version + 1, rectificada_en = NOW(), rectificada_por = auth.uid()
   WHERE id = p_id
   RETURNING * INTO n;
  PERFORM set_config('ec.rectificando', '', true);

  INSERT INTO public.evaluaciones_versiones
    (evaluacion_id, periodo_id, evaluado_id, version, accion, antes, despues, resultado_antes, resultado_despues, motivo, actor)
  VALUES (n.id, n.periodo_id, n.evaluado_id, n.version, 'rectificada', public._eval_estado_json(e), public._eval_estado_json(n),
          v_antes, public._eval_resultado_json(n.periodo_id, n.evaluado_id), btrim(p_motivo), auth.uid());
  RETURN n.version;
END;
$$;
  $f$, '@@ID@@', v_id);
  EXECUTE format('REVOKE EXECUTE ON FUNCTION public.rectificar_evaluacion(%s, JSONB, JSONB, TEXT, JSONB, NUMERIC, JSONB) FROM PUBLIC, anon', v_id);
  EXECUTE format('GRANT  EXECUTE ON FUNCTION public.rectificar_evaluacion(%s, JSONB, JSONB, TEXT, JSONB, NUMERIC, JSONB) TO authenticated', v_id);
END $m62$;

-- ── 8. Resultados con dos roles ───────────────────────────────────────
DROP FUNCTION IF EXISTS public.resultados_periodo(UUID, BOOLEAN);
CREATE FUNCTION public.resultados_periodo(
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
  rol_pequeno BOOLEAN,
  escala      TEXT,
  individual_eval NUMERIC,     -- 0.6·técnico + 0.4·núcleo: solo la evaluación (sin tareas)
  general_eval    NUMERIC,     -- 0.4·núcleo + 0.6·percentil: solo la evaluación (sin tareas)
  tareas          NUMERIC,     -- nota de tareas 0–100 (NULL si no hay suficientes y la regla no las cuenta como 0; 0 si sin_tareas_pierde_puntos)
  tareas_n        INT,         -- tareas que cuentan
  peso_tareas     NUMERIC,     -- % del resultado que aportan las tareas A ESTA PERSONA (0 si tareas es NULL)
  -- 0062: segundo rol. Todo NULL / 0 / false para quien tiene un solo rol.
  rol2_id         BIGINT,      -- el segundo rol de la persona (el de su evaluación, o el habilitado ahora si aún no se evaluó)
  rol2_nombre     TEXT,
  tecnico_rol1    NUMERIC,     -- técnico solo con el perfil del rol principal
  tecnico_rol2    NUMERIC,     -- técnico solo con el perfil del segundo rol (NULL si no se evaluó)
  peso_rol2       NUMERIC,     -- % del técnico y del percentil que aporta el segundo rol (según sus tareas que cuentan)
  rol2_incompleta BOOLEAN      -- tiene tareas del segundo rol pero falta su evaluación: se usó solo el principal
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_admin   BOOLEAN;
  v_gestion BIGINT;
  v_peso    NUMERIC;
  v_pierde  BOOLEAN;
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
  SELECT c.peso_tareas, c.sin_tareas_pierde_puntos INTO v_peso, v_pierde FROM public.calif_config(p_periodo) c;

  RETURN QUERY
  WITH base AS (
    SELECT e.evaluado_id, e.perfil_id, e.perfil2_id, e.puntajes, e.puntajes_rol2, e.estado, e.escala,
           pr.rol_id, ro.nombre AS rol_nombre, pr2.rol_id AS rol2_eval, pf.nombre, pf.distrito
      FROM evaluaciones e
      JOIN perfiles_rol pr ON pr.id = e.perfil_id
      JOIN roles        ro ON ro.id = pr.rol_id
      LEFT JOIN perfiles_rol pr2 ON pr2.id = e.perfil2_id
      JOIN profiles     pf ON pf.id = e.evaluado_id
     WHERE e.periodo_id = p_periodo
       AND e.modelo = 'v2'
       AND (e.estado = 'publicado' OR (v_admin AND p_borradores))
  ),
  nuc AS (
    SELECT b.evaluado_id, AVG(CASE b.escala WHEN 'cinco' THEN (v.value::NUMERIC - 1) / 4 * 100 ELSE v.value::NUMERIC / 10 * 100 END) AS nucleo
      FROM base b
      CROSS JOIN LATERAL jsonb_each_text(b.puntajes) v(key, value)
      JOIN criterios_v2 c ON c.gestion_id = v_gestion AND c.key = v.key AND c.tipo = 'nucleo'
     GROUP BY b.evaluado_id
  ),
  tec AS (
    SELECT b.evaluado_id,
           SUM(pc.peso * (CASE b.escala WHEN 'cinco' THEN (v.value::NUMERIC - 1) / 4 * 100 ELSE v.value::NUMERIC / pc.peso * 100 END)) / NULLIF(SUM(pc.peso), 0) AS tecnico
      FROM base b
      CROSS JOIN LATERAL jsonb_each_text(b.puntajes) v(key, value)
      JOIN perfil_criterios pc ON pc.perfil_id = b.perfil_id AND pc.criterio_key = v.key
     GROUP BY b.evaluado_id
  ),
  -- Técnico del segundo rol (siempre escala por peso: 0 a su peso en el perfil de ese rol).
  tec2 AS (
    SELECT b.evaluado_id,
           SUM(pc.peso * (v.value::NUMERIC / NULLIF(pc.peso, 0) * 100)) / NULLIF(SUM(pc.peso), 0) AS tecnico2
      FROM base b
      CROSS JOIN LATERAL jsonb_each_text(b.puntajes_rol2) v(key, value)
      JOIN perfil_criterios pc ON pc.perfil_id = b.perfil2_id AND pc.criterio_key = v.key
     WHERE b.perfil2_id IS NOT NULL
     GROUP BY b.evaluado_id
  ),
  -- Cada rol se compara solo con quienes tienen puntajes de ESE rol (como principal o como segundo rol).
  coh AS (
    SELECT b.evaluado_id, 1 AS slot, b.rol_id AS rol, t.tecnico AS tec
      FROM base b LEFT JOIN tec t ON t.evaluado_id = b.evaluado_id
    UNION ALL
    SELECT b.evaluado_id, 2, b.rol2_eval, t2.tecnico2
      FROM base b JOIN tec2 t2 ON t2.evaluado_id = b.evaluado_id
     WHERE b.rol2_eval IS NOT NULL
  ),
  cohr AS (
    SELECT c.*,
           COUNT(*) OVER (PARTITION BY c.rol)                AS n_rol,
           RANK()   OVER (PARTITION BY c.rol ORDER BY c.tec) AS pos_min,
           COUNT(*) OVER (PARTITION BY c.rol, c.tec)         AS empates
      FROM coh c
  ),
  pct AS (
    SELECT c.evaluado_id, c.slot, c.n_rol,
           CASE WHEN c.n_rol >= 4 AND c.tec IS NOT NULL
                THEN ((c.pos_min + (c.empates - 1) / 2.0) - 1) / (c.n_rol - 1) * 100
           END AS percentil
      FROM cohr c
  ),
  -- Peso de cada rol según las tareas que cuentan (las de equipo y las sin rol cuentan para el principal).
  pes AS (
    SELECT b.evaluado_id,
           COALESCE(SUM(i.peso_efectivo) FILTER (WHERE i.cuenta), 0) AS ptot,
           COALESCE(SUM(i.peso_efectivo) FILTER (WHERE i.cuenta AND i.tipo = 'individual'
                                                   AND tr.rol_id = COALESCE(b.rol2_eval, public.rol_secundario_de(b.evaluado_id))), 0) AS p2
      FROM base b
      JOIN public.calif_items(p_periodo) i ON i.persona_id = b.evaluado_id
      LEFT JOIN tareas tr ON i.tipo = 'individual' AND tr.id = i.tarea_id
     GROUP BY b.evaluado_id
  ),
  junto AS (
    SELECT b.*, n.nucleo, t.tecnico AS t1, t2.tecnico2 AS t2,
           COALESCE(b.rol2_eval, public.rol_secundario_de(b.evaluado_id)) AS rol2,
           p1.percentil AS pct1, p1.n_rol AS n_rol, p2.percentil AS pct2,
           COALESCE(pe.ptot, 0) AS ptot, COALESCE(pe.p2, 0) AS pp2
      FROM base b
      LEFT JOIN nuc n  ON n.evaluado_id  = b.evaluado_id
      LEFT JOIN tec t  ON t.evaluado_id  = b.evaluado_id
      LEFT JOIN tec2 t2 ON t2.evaluado_id = b.evaluado_id
      LEFT JOIN pct p1 ON p1.evaluado_id = b.evaluado_id AND p1.slot = 1
      LEFT JOIN pct p2 ON p2.evaluado_id = b.evaluado_id AND p2.slot = 2
      LEFT JOIN pes pe ON pe.evaluado_id = b.evaluado_id
  ),
  calc AS (
    SELECT j.*,
           (j.n_rol < 4) AS rol_pequeno,
           CASE WHEN j.t2 IS NOT NULL AND j.pp2 > 0 AND j.ptot > 0 THEN j.pp2 / j.ptot ELSE 0 END AS wr2,
           (j.rol2 IS NOT NULL AND j.pp2 > 0 AND j.t2 IS NULL) AS incompleta
      FROM junto j
  ),
  calc2 AS (
    SELECT c.*,
           CASE WHEN c.wr2 > 0 THEN (1 - c.wr2) * c.t1 + c.wr2 * c.t2 ELSE c.t1 END AS tec_f,
           CASE WHEN c.wr2 > 0 THEN (1 - c.wr2) * COALESCE(c.pct1, c.t1) + c.wr2 * COALESCE(c.pct2, c.t2)
                ELSE COALESCE(c.pct1, c.t1) END AS ref_pct,
           CASE WHEN c.wr2 > 0 THEN (1 - c.wr2) * COALESCE(c.pct1, c.t1) + c.wr2 * COALESCE(c.pct2, c.t2) ELSE c.pct1 END AS pct_out
      FROM calc c
  ),
  -- Peso con que las tareas entran en CADA persona: el del PE, solo si ella tiene nota de tareas.
  mix AS (
    SELECT c.*, tp.nota AS t_nota, tp.n_cuentan AS t_n,
           CASE WHEN tp.nota IS NOT NULL OR COALESCE(v_pierde, false) THEN v_peso / 100 ELSE 0 END AS w
      FROM calc2 c
      LEFT JOIN public.calif_puntaje(p_periodo) tp ON tp.persona_id = c.evaluado_id
  )
  SELECT c.evaluado_id, c.nombre, c.distrito, c.rol_id, c.rol_nombre, c.perfil_id, c.estado,
         ROUND(c.nucleo, 1),
         ROUND(c.tec_f, 1),
         ROUND((1 - c.w) * (0.6 * c.tec_f + 0.4 * c.nucleo) + c.w * COALESCE(c.t_nota, 0), 1),
         ROUND(c.pct_out, 1),
         ROUND((1 - c.w) * (0.4 * c.nucleo + 0.6 * c.ref_pct) + c.w * COALESCE(c.t_nota, 0), 1),
         c.n_rol::INT,
         c.rol_pequeno,
         c.escala,
         ROUND(0.6 * c.tec_f + 0.4 * c.nucleo, 1),
         ROUND(0.4 * c.nucleo + 0.6 * c.ref_pct, 1),
         CASE WHEN c.w > 0 THEN COALESCE(c.t_nota, 0) ELSE c.t_nota END,
         COALESCE(c.t_n, 0)::INT,
         ROUND(c.w * 100, 2),
         c.rol2::BIGINT,
         (SELECT r2.nombre FROM roles r2 WHERE r2.id = c.rol2),
         ROUND(c.t1, 1),
         ROUND(c.t2, 1),
         ROUND(c.wr2 * 100, 1),
         c.incompleta
    FROM mix c
   WHERE v_admin
      OR c.evaluado_id = auth.uid()
      OR (public.is_secretario() AND c.evaluado_id IN (SELECT public.get_district_member_ids()));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resultados_periodo(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resultados_periodo(UUID, BOOLEAN) TO authenticated;

-- ── 9. Quién ya tiene más de 2 roles (no se borra nada: la administración decide) ─
CREATE OR REPLACE FUNCTION public.personas_con_mas_de_dos_roles()
RETURNS TABLE (persona_id UUID, nombre TEXT, roles BIGINT, roles_nombres TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Solo la administracion.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT p.id, p.nombre, COUNT(DISTINCT x.r)::BIGINT, string_agg(DISTINCT ro.nombre, ', ')
    FROM profiles p
    CROSS JOIN LATERAL (SELECT p.rol_id::BIGINT AS r WHERE p.rol_id IS NOT NULL
                        UNION SELECT pr.rol_id FROM persona_roles pr WHERE pr.persona_id = p.id) x
    JOIN roles ro ON ro.id = x.r
   GROUP BY p.id, p.nombre HAVING COUNT(DISTINCT x.r) > 2 ORDER BY p.nombre;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.personas_con_mas_de_dos_roles() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.personas_con_mas_de_dos_roles() TO authenticated;

DO $aviso$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM (SELECT p.id FROM profiles p
    CROSS JOIN LATERAL (SELECT p.rol_id::BIGINT AS r WHERE p.rol_id IS NOT NULL UNION SELECT pr.rol_id FROM persona_roles pr WHERE pr.persona_id = p.id) x
   GROUP BY p.id HAVING COUNT(DISTINCT x.r) > 2) s;
  IF n > 0 THEN RAISE NOTICE '0062: % persona(s) ya tienen mas de 2 roles; no se tocaron. Ver SELECT * FROM personas_con_mas_de_dos_roles().', n; END IF;
END $aviso$;

COMMIT;

-- ── REVERSA ───────────────────────────────────────────────────────────
-- 1) Sin puntajes del rol 2 el resultado es idéntico al anterior, así que normalmente basta con no usar la función.
-- 2) Para volver del todo: DROP TRIGGER persona_roles_max2 ON public.persona_roles; DROP TRIGGER profiles_rol_max2 ON public.profiles;
--    reaplicar evaluaciones_validar_modelo() de 0023, evaluaciones_publicada_guardia() y _eval_estado_json() de 0053, rectificar_evaluacion()
--    de 0059 (DROP de la de 7 parámetros), resultados_periodo() de 0061; DROP FUNCTION personas_con_mas_de_dos_roles(), rol_secundario_de().
--    Las columnas puntajes_rol2 / perfil2_id pueden quedarse (inofensivas) o borrarse si ningún puntaje del rol 2 es necesario.
