-- ══════════════════════════════════════════════════════════════════════
--  0059 — Corrige 0053: `evaluaciones.id` es UUID, no BIGINT (publicar daba error)
-- ══════════════════════════════════════════════════════════════════════
--
--  PROBLEMA
--  0053 declaró `evaluaciones_versiones.evaluacion_id` y el parámetro `p_id` de `rectificar_evaluacion`, `retirar_evaluacion`
--  y `evaluacion_versiones` como BIGINT. En producción `evaluaciones.id` es UUID (el stub de pruebas lo tenía BIGINT y por eso
--  las pruebas pasaron). Resultado: al PUBLICAR (borrador → publicado) el trigger de registro intenta guardar un UUID en una
--  columna BIGINT y la publicación falla («invalid input syntax for type bigint»); rectificar y retirar tampoco encontraban
--  la función (el cliente manda un UUID). Guardar BORRADORES nunca fallaba: ese trigger solo actúa al publicar.
--
--  QUÉ HACE
--  1. `evaluaciones_versiones.evaluacion_id` pasa a UUID. Solo si la tabla está vacía (en producción lo está: nada pudo
--     publicarse con 0053); si tuviera filas, se detiene sin tocar nada.
--  2. Reemplaza las tres funciones por versiones con `p_id UUID` y retira las de BIGINT.
--
--  Idempotente. Aplicar DESPUÉS de 0053..0058. Reversa al final.
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. Columna del historial ──────────────────────────────────────────
DO $$
DECLARE v_tipo TEXT; v_id TEXT;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_id
    FROM pg_attribute a WHERE a.attrelid = 'public.evaluaciones'::regclass AND a.attname = 'id' AND NOT a.attisdropped;
  IF v_id <> 'uuid' THEN
    RAISE EXCEPTION '0059 espera evaluaciones.id UUID y es %. No se cambia nada.', v_id;
  END IF;
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo
    FROM pg_attribute a WHERE a.attrelid = 'public.evaluaciones_versiones'::regclass AND a.attname = 'evaluacion_id' AND NOT a.attisdropped;
  IF v_tipo = 'bigint' THEN
    IF EXISTS (SELECT 1 FROM public.evaluaciones_versiones) THEN
      RAISE EXCEPTION 'evaluaciones_versiones tiene filas con evaluacion_id BIGINT: revisar a mano antes de convertir.';
    END IF;
    DROP INDEX IF EXISTS public.evaluaciones_versiones_eval_idx;
    ALTER TABLE public.evaluaciones_versiones ALTER COLUMN evaluacion_id TYPE UUID USING NULL::uuid;
    CREATE INDEX IF NOT EXISTS evaluaciones_versiones_eval_idx ON public.evaluaciones_versiones (evaluacion_id, id);
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.rectificar_evaluacion(BIGINT, JSONB, JSONB, TEXT, JSONB, NUMERIC);
DROP FUNCTION IF EXISTS public.retirar_evaluacion(BIGINT, TEXT);
DROP FUNCTION IF EXISTS public.evaluacion_versiones(BIGINT);

-- ── 2. Funciones con el tipo de id correcto ───────────────────────────
CREATE OR REPLACE FUNCTION public.rectificar_evaluacion(
  p_id         UUID,
  p_puntajes   JSONB,
  p_comentarios JSONB,
  p_motivo     TEXT,
  p_respuestas JSONB   DEFAULT NULL,   -- NULL = no cambia
  p_bono       NUMERIC DEFAULT NULL    -- NULL = no cambia (solo rúbrica clásica)
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
     AND COALESCE(p_bono, e.bono_ext) IS NOT DISTINCT FROM e.bono_ext THEN
    RAISE EXCEPTION 'No hay cambios que rectificar.' USING ERRCODE = '23514';
  END IF;

  v_antes := public._eval_resultado_json(e.periodo_id, e.evaluado_id);

  PERFORM set_config('ec.rectificando', '1', true);
  UPDATE public.evaluaciones
     SET puntajes = COALESCE(p_puntajes, puntajes), comentarios = COALESCE(p_comentarios, comentarios),
         respuestas = COALESCE(p_respuestas, respuestas), bono_ext = COALESCE(p_bono, bono_ext),
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

CREATE OR REPLACE FUNCTION public.retirar_evaluacion(p_id UUID, p_motivo TEXT) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  e public.evaluaciones%ROWTYPE;
  n public.evaluaciones%ROWTYPE;
  v_antes JSONB;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo la administracion puede retirar una evaluacion.' USING ERRCODE = '42501';
  END IF;
  IF p_motivo IS NULL OR char_length(btrim(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Retirar una evaluacion exige un motivo (al menos 5 caracteres).' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO e FROM public.evaluaciones WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR e.estado <> 'publicado' THEN
    RAISE EXCEPTION 'Solo se retira una evaluacion publicada.' USING ERRCODE = '23514';
  END IF;
  IF NOT public.gestion_escribible(e.periodo_id) THEN
    RAISE EXCEPTION 'Esa gestion esta archivada: es solo lectura.' USING ERRCODE = '42501';
  END IF;

  v_antes := public._eval_resultado_json(e.periodo_id, e.evaluado_id);
  PERFORM set_config('ec.rectificando', '1', true);
  UPDATE public.evaluaciones SET estado = 'borrador', version = version + 1, rectificada_en = NOW(), rectificada_por = auth.uid()
   WHERE id = p_id RETURNING * INTO n;
  PERFORM set_config('ec.rectificando', '', true);

  INSERT INTO public.evaluaciones_versiones
    (evaluacion_id, periodo_id, evaluado_id, version, accion, antes, despues, resultado_antes, motivo, actor)
  VALUES (n.id, n.periodo_id, n.evaluado_id, n.version, 'retirada', public._eval_estado_json(e), public._eval_estado_json(n),
          v_antes, btrim(p_motivo), auth.uid());
  RETURN n.version;
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluacion_versiones(p_id UUID) RETURNS SETOF public.evaluaciones_versiones
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo la administracion consulta el historial de una evaluacion.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.evaluaciones_versiones WHERE evaluacion_id = p_id ORDER BY id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rectificar_evaluacion(UUID, JSONB, JSONB, TEXT, JSONB, NUMERIC),
  public.retirar_evaluacion(UUID, TEXT), public.evaluacion_versiones(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rectificar_evaluacion(UUID, JSONB, JSONB, TEXT, JSONB, NUMERIC),
  public.retirar_evaluacion(UUID, TEXT), public.evaluacion_versiones(UUID) TO authenticated;

-- ── REVERSA ───────────────────────────────────────────────────────────
-- Volver a BIGINT no tiene sentido (los ids son UUID). Para deshacer: DROP FUNCTION de las tres funciones UUID y
-- reaplicar 0053 (que las recrea con BIGINT, es decir, con el defecto).
