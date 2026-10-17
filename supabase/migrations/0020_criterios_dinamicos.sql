-- ══════════════════════════════════════════════════════════════════════
--  0020 — Criterios dinámicos: campos nuevos sin tocar el código
-- ══════════════════════════════════════════════════════════════════════
--
--  QUÉ HACE
--  Extiende `criterios_v2` (no crea un sistema paralelo) para que la administración cree, edite,
--  active, desactive y —si nunca se usó— elimine criterios desde la interfaz:
--
--    · nombre y descripción general (`descripcion`), además de las anclas 1-3-5 que ya existían;
--    · tipo de campo (`tipo_campo`):
--        'escala'  puntaje 1–5 con anclas. Entra en las fórmulas, como hasta ahora.
--        'si_no'   respuesta sí/no.      ┐  Son campos de REGISTRO: se guardan en
--        'opcion'  una de varias opciones │  `evaluaciones.respuestas` y NO puntúan
--        'texto'   texto libre (≤1000)   ┘  (igual que los puntos de una tarea: son un hecho).
--      Los campos de registro aplican a todos los roles (`tipo = 'nucleo'`); los técnicos son
--      siempre de escala, porque su peso es lo que suma 100 en el perfil.
--    · `opciones` (para 'opcion': de 2 a 12, distintas, ≤60 caracteres);
--    · `obligatorio`: si falta, ¿se puede publicar? Un criterio de escala opcional sin puntuar
--      queda fuera del promedio (nunca vale 0), como ya ocurría con los que no aplican.
--
--  HISTORIA PRESERVADA
--    · Un criterio que alguna evaluación usó NO se elimina (solo se desactiva) ni cambia de tipo.
--    · Si está usado por evaluaciones, no cambia `tipo_campo` y sus opciones solo pueden crecer.
--    · Desactivar un criterio no reescribe lo ya evaluado: una evaluación publicada que lo contiene
--      se puede seguir guardando; lo que no se puede es añadirlo a evaluaciones nuevas.
--    · `abrir_gestion` clona los campos nuevos.
--
--  VALIDACIÓN EN LA BASE (el cliente solo la repite para avisar antes)
--    `criterios_v2_validar` rechaza nombres vacíos, claves mal formadas, opciones inválidas o campos
--    de registro técnicos; deriva la clave del nombre si no llega; fija `created_by` y `orden`.
--
--  No toca resultados_periodo(): los campos de registro no están en `puntajes`.
--  Aplicación manual en el SQL Editor, tras 0019. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Columnas ───────────────────────────────────────────────────────
ALTER TABLE public.criterios_v2
  ADD COLUMN IF NOT EXISTS descripcion TEXT        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tipo_campo  TEXT        NOT NULL DEFAULT 'escala',
  ADD COLUMN IF NOT EXISTS opciones    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS obligatorio BOOLEAN     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_by  UUID;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'criterios_v2_tipo_campo_chk') THEN
    ALTER TABLE public.criterios_v2 ADD CONSTRAINT criterios_v2_tipo_campo_chk
      CHECK (tipo_campo IN ('escala','si_no','opcion','texto'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'criterios_v2_opciones_chk') THEN
    ALTER TABLE public.criterios_v2 ADD CONSTRAINT criterios_v2_opciones_chk
      CHECK (jsonb_typeof(opciones) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'criterios_v2_descripcion_chk') THEN
    ALTER TABLE public.criterios_v2 ADD CONSTRAINT criterios_v2_descripcion_chk
      CHECK (char_length(descripcion) <= 500);
  END IF;
END $chk$;

ALTER TABLE public.evaluaciones
  ADD COLUMN IF NOT EXISTS respuestas JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 2. ¿Está usado un criterio? ───────────────────────────────────────
--  `p_evaluaciones_solo`: true = solo cuenta lo evaluado (puntajes o respuestas); false = también
--  los perfiles que lo pesan.
CREATE OR REPLACE FUNCTION public.criterio_v2_en_uso(p_gestion BIGINT, p_key TEXT, p_evaluaciones_solo BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
           SELECT 1 FROM evaluaciones e JOIN periodos_evaluacion pe ON pe.id = e.periodo_id
            WHERE pe.gestion_id = p_gestion AND (e.puntajes ? p_key OR e.respuestas ? p_key))
      OR (NOT p_evaluaciones_solo AND EXISTS (
           SELECT 1 FROM perfil_criterios pc JOIN perfiles_rol p ON p.id = pc.perfil_id
            WHERE p.gestion_id = p_gestion AND pc.criterio_key = p_key));
$$;
REVOKE EXECUTE ON FUNCTION public.criterio_v2_en_uso(BIGINT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ── 3. Validación y valores por defecto de la definición ──────────────
CREATE OR REPLACE FUNCTION public.criterios_v2_validar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_base TEXT; v_clave TEXT; v_n INT := 1; v_op JSONB; v_vistos TEXT[] := '{}'; v_t TEXT;
BEGIN
  NEW.nombre      := btrim(COALESCE(NEW.nombre, ''));
  NEW.descripcion := btrim(COALESCE(NEW.descripcion, ''));
  IF char_length(NEW.nombre) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'El nombre del criterio debe tener entre 1 y 80 caracteres.' USING ERRCODE = '23514';
  END IF;
  IF char_length(NEW.descripcion) > 500 THEN
    RAISE EXCEPTION 'La descripcion no puede superar 500 caracteres.' USING ERRCODE = '23514';
  END IF;

  -- Clave: se deriva del nombre si no llega (minusculas, sin tildes, guion bajo). Nunca cambia despues.
  IF TG_OP = 'INSERT' AND btrim(COALESCE(NEW.key, '')) = '' THEN
    v_base := lower(translate(NEW.nombre, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'));
    v_base := trim(both '_' FROM regexp_replace(v_base, '[^a-z0-9]+', '_', 'g'));
    IF v_base = '' THEN v_base := 'criterio'; END IF;
    IF v_base !~ '^[a-z]' THEN v_base := 'c_' || v_base; END IF;
    v_base := left(v_base, 40);
    v_clave := v_base;
    WHILE EXISTS (SELECT 1 FROM criterios_v2 WHERE gestion_id = NEW.gestion_id AND key = v_clave) LOOP
      v_n := v_n + 1; v_clave := v_base || '_' || v_n;
    END LOOP;
    NEW.key := v_clave;
  END IF;

  -- Tipo de campo y opciones
  IF NEW.tipo_campo <> 'escala' AND NEW.tipo <> 'nucleo' THEN
    RAISE EXCEPTION 'Los campos de registro (si/no, opciones, texto) son comunes a todos los roles: un criterio tecnico es siempre de escala.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.tipo_campo = 'opcion' THEN
    IF jsonb_typeof(NEW.opciones) <> 'array' OR jsonb_array_length(NEW.opciones) NOT BETWEEN 2 AND 12 THEN
      RAISE EXCEPTION 'Un campo de opciones necesita entre 2 y 12 opciones.' USING ERRCODE = '23514';
    END IF;
    FOR v_op IN SELECT value FROM jsonb_array_elements(NEW.opciones) LOOP
      IF jsonb_typeof(v_op) <> 'string' THEN
        RAISE EXCEPTION 'Las opciones deben ser texto.' USING ERRCODE = '23514';
      END IF;
      v_t := btrim(v_op #>> '{}');
      IF v_t = '' OR char_length(v_t) > 60 THEN
        RAISE EXCEPTION 'Cada opcion debe tener entre 1 y 60 caracteres.' USING ERRCODE = '23514';
      END IF;
      IF lower(v_t) = ANY (v_vistos) THEN
        RAISE EXCEPTION 'La opcion "%" esta repetida.', v_t USING ERRCODE = '23514';
      END IF;
      v_vistos := v_vistos || lower(v_t);
    END LOOP;
    -- Se guardan sin espacios sobrantes.
    NEW.opciones := (SELECT COALESCE(jsonb_agg(to_jsonb(btrim(x #>> '{}'))), '[]'::jsonb)
                       FROM jsonb_array_elements(NEW.opciones) x);
  ELSE
    NEW.opciones := '[]'::jsonb;
  END IF;
  IF NEW.tipo_campo <> 'escala' THEN
    NEW.desc_1 := ''; NEW.desc_3 := ''; NEW.desc_5 := '';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := NOW();
    IF COALESCE(NEW.orden, 0) = 0 THEN
      SELECT COALESCE(MAX(orden), 0) + 1 INTO NEW.orden FROM criterios_v2 WHERE gestion_id = NEW.gestion_id;
    END IF;
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.criterios_v2_validar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS criterios_v2_validar ON public.criterios_v2;
CREATE TRIGGER criterios_v2_validar
  BEFORE INSERT OR UPDATE ON public.criterios_v2
  FOR EACH ROW EXECUTE FUNCTION public.criterios_v2_validar();

-- El orden alfabetico de los triggers BEFORE importa: `criterios_v2_protegido` (p) corre antes que
-- `criterios_v2_validar` (v), asi compara contra los valores que llegan sin normalizar.

-- ── 4. Lo usado no se borra ni se reinterpreta ────────────────────────
CREATE OR REPLACE FUNCTION public.criterios_v2_protegido()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_perfil BOOLEAN; v_eval BOOLEAN; v_viejo JSONB;
BEGIN
  v_perfil := EXISTS (SELECT 1 FROM perfil_criterios pc JOIN perfiles_rol p ON p.id = pc.perfil_id
                       WHERE p.gestion_id = OLD.gestion_id AND pc.criterio_key = OLD.key);
  v_eval   := public.criterio_v2_en_uso(OLD.gestion_id, OLD.key, true);

  IF TG_OP = 'DELETE' THEN
    IF v_perfil OR v_eval THEN
      RAISE EXCEPTION 'El criterio % esta en uso (%): solo se puede desactivar.', OLD.key,
        CASE WHEN v_eval THEN 'hay evaluaciones que lo contienen' ELSE 'un perfil lo pesa' END
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF (NEW.key IS DISTINCT FROM OLD.key OR NEW.tipo IS DISTINCT FROM OLD.tipo) AND (v_perfil OR v_eval) THEN
    RAISE EXCEPTION 'El criterio % esta en uso: no se cambia su clave ni su tipo; solo se puede desactivar.', OLD.key
      USING ERRCODE = '42501';
  END IF;
  IF NEW.tipo_campo IS DISTINCT FROM OLD.tipo_campo AND (v_eval OR v_perfil) THEN
    RAISE EXCEPTION 'El criterio % esta en uso: no se cambia el tipo de campo.', OLD.key USING ERRCODE = '42501';
  END IF;
  IF NEW.opciones IS DISTINCT FROM OLD.opciones AND v_eval THEN
    FOR v_viejo IN SELECT value FROM jsonb_array_elements(OLD.opciones) LOOP
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.opciones) n WHERE lower(btrim(n #>> '{}')) = lower(btrim(v_viejo #>> '{}'))) THEN
        RAISE EXCEPTION 'Hay evaluaciones con la opcion "%": no se quita, solo se pueden agregar opciones.', v_viejo #>> '{}'
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.criterios_v2_protegido() FROM PUBLIC, anon, authenticated;

-- ── 5. Un perfil solo pesa criterios de escala ────────────────────────
CREATE OR REPLACE FUNCTION public.perfil_validar_suma()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_perfil BIGINT;
  v_suma   INT;
BEGIN
  IF TG_TABLE_NAME = 'perfiles_rol' THEN
    v_perfil := NEW.id;
  ELSE
    v_perfil := COALESCE(NEW.perfil_id, OLD.perfil_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM perfiles_rol WHERE id = v_perfil) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(peso), 0) INTO v_suma
    FROM perfil_criterios WHERE perfil_id = v_perfil;
  IF v_suma <> 100 THEN
    RAISE EXCEPTION 'Los pesos del perfil deben sumar 100 (suman %).', v_suma
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM perfil_criterios pc
      JOIN perfiles_rol p ON p.id = pc.perfil_id
      LEFT JOIN criterios_v2 c ON c.gestion_id = p.gestion_id AND c.key = pc.criterio_key
     WHERE pc.perfil_id = v_perfil
       AND (c.id IS NULL OR c.tipo <> 'tecnico' OR c.tipo_campo <> 'escala' OR NOT c.activo)
  ) THEN
    RAISE EXCEPTION 'El perfil solo admite criterios tecnicos de escala activos del catalogo.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.perfil_validar_suma() FROM PUBLIC, anon, authenticated;

-- ── 6. Validación de las evaluaciones v2 (con respuestas y obligatoriedad) ──
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
BEGIN
  SELECT modelo, gestion_id INTO v_modelo, v_gestion
    FROM periodos_evaluacion WHERE id = NEW.periodo_id;
  NEW.modelo := COALESCE(v_modelo, 'legacy');

  IF NEW.modelo <> 'v2' THEN
    NEW.perfil_id := NULL;
    NEW.respuestas := '{}'::jsonb;
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
    IF v_num <> trunc(v_num) OR v_num < 1 OR v_num > 5 THEN
      RAISE EXCEPTION 'El puntaje de "%" debe ser un entero de 1 a 5.', v_clave USING ERRCODE = '23514';
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

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.evaluaciones_validar_modelo() FROM PUBLIC, anon, authenticated;

-- ── 7. abrir_gestion clona los campos nuevos ──────────────────────────
--  Idéntica a la de 0015 salvo el INSERT de criterios_v2.
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

    INSERT INTO periodos_evaluacion (gestion_id, nombre, descripcion, activo, modelo)
    SELECT v_id, nombre, descripcion, false,
           CASE WHEN EXISTS (SELECT 1 FROM criterios_v2 WHERE gestion_id = v_origen) THEN 'v2' ELSE 'legacy' END
      FROM periodos_evaluacion WHERE gestion_id = v_origen;

    INSERT INTO criterios_v2 (gestion_id, key, nombre, tipo, desc_1, desc_3, desc_5, orden, activo,
                              descripcion, tipo_campo, opciones, obligatorio)
    SELECT v_id, key, nombre, tipo, desc_1, desc_3, desc_5, orden, activo,
           descripcion, tipo_campo, opciones, obligatorio
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
--   SELECT key, tipo, tipo_campo, obligatorio FROM criterios_v2 WHERE gestion_id = (SELECT id FROM gestiones WHERE activa) LIMIT 5;
--   -- los 24 criterios de 0015 quedan 'escala' y obligatorios: nada cambia en lo ya evaluado.
-- ══════════════════════════════════════════════════════════════════════
-- DESHACER (comentado): restaurar abrir_gestion, evaluaciones_validar_modelo, criterios_v2_protegido y
-- perfil_validar_suma de 0015; DROP TRIGGER criterios_v2_validar; DROP FUNCTION criterio_v2_en_uso;
-- ALTER TABLE criterios_v2 DROP COLUMN descripcion, tipo_campo, opciones, obligatorio, created_at, created_by;
-- ALTER TABLE evaluaciones DROP COLUMN respuestas;
