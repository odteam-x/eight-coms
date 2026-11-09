-- ══════════════════════════════════════════════════════════════════════
--  0053 — Evaluaciones publicadas: versión, rectificación con motivo y registro
--         (auditoría de arquitectura, hallazgo H-01; PDF §5.4 y §6.5)
-- ══════════════════════════════════════════════════════════════════════
--
--  PROBLEMA
--  La política `evaluaciones_admin` es FOR ALL y ningún trigger miraba `OLD.estado`: la administración podía
--  cambiar puntajes de una evaluación ya publicada (o devolverla a borrador, o borrarla) sin motivo ni rastro.
--
--  QUÉ HACE
--  · `evaluaciones.version` (1 al publicar; +1 en cada rectificación o retiro), `rectificada_en/por`.
--  · `evaluaciones_versiones` (append-only, sin permisos para clientes): una fila por publicación, rectificación
--    o retiro, con valores ANTES y DESPUÉS, el resultado calculado antes y después (v2, si se puede), el motivo
--    y el responsable.
--  · Trigger `zz_evaluaciones_publicada`: una evaluación PUBLICADA ya no se modifica, retira ni borra por
--    UPDATE/DELETE directo. Se corrige con `rectificar_evaluacion()` (motivo ≥ 5) y se retira con
--    `retirar_evaluacion()` (motivo ≥ 5). Al publicar (borrador → publicado) se registra la versión.
--  · `evaluacion_versiones(id)` (solo administración) para leer el historial.
--
--  QUÉ NO CAMBIA
--  · Estados `borrador` / `publicado` (lo leen RLS, resultados_periodo y ~10 consumidores): la rectificación es
--    un NÚMERO DE VERSIÓN, no un estado nuevo. Los resultados publicados no cambian al aplicar esta migración.
--  · Las evaluaciones ya publicadas quedan en versión 1, sin fila de historial (antes no existía); su
--    `publicada_en` queda NULL = «anterior a 0053».
--  · Sin sesión (`auth.uid()` NULL: SQL Editor, mantenimiento) el trigger deja pasar, pero REGISTRA el cambio en
--    `evaluaciones_versiones` con el motivo «Sin sesión (mantenimiento)». Un cliente siempre tiene sesión.
--  · Borrar a una persona en cascada (FK a auth.users) sigue funcionando: solo se bloquea el DELETE directo.
--
--  APLICAR después de 0052 (necesita 0015, 0020, 0023, 0035). El front degrada si no está aplicada
--  (`API.rectificacionDisponible()`).
--  Reversa: al final.
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. Columnas ───────────────────────────────────────────────────────
ALTER TABLE public.evaluaciones ADD COLUMN IF NOT EXISTS version         INT         NOT NULL DEFAULT 1;
ALTER TABLE public.evaluaciones ADD COLUMN IF NOT EXISTS publicada_en    TIMESTAMPTZ;
ALTER TABLE public.evaluaciones ADD COLUMN IF NOT EXISTS rectificada_en  TIMESTAMPTZ;
ALTER TABLE public.evaluaciones ADD COLUMN IF NOT EXISTS rectificada_por UUID;

-- ── 2. Historial (append-only; ningún cliente lo toca) ────────────────
CREATE TABLE IF NOT EXISTS public.evaluaciones_versiones (
  id             BIGSERIAL   PRIMARY KEY,
  evaluacion_id  BIGINT      NOT NULL,                 -- sin FK: el historial sobrevive a un borrado en cascada
  periodo_id     UUID        NOT NULL,
  evaluado_id    UUID        NOT NULL,
  version        INT         NOT NULL,                 -- versión DESPUÉS de la acción
  accion         TEXT        NOT NULL CHECK (accion IN ('publicada', 'rectificada', 'retirada')),
  antes          JSONB,                                -- {puntajes, respuestas, bono_ext, comentarios, estado}
  despues        JSONB,
  resultado_antes   JSONB,                             -- fila de resultados_periodo() (v2), si se pudo calcular
  resultado_despues JSONB,
  motivo         TEXT,
  actor          UUID,                                 -- auth.uid() (NULL = sin sesión)
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS evaluaciones_versiones_eval_idx ON public.evaluaciones_versiones (evaluacion_id, id);
CREATE INDEX IF NOT EXISTS evaluaciones_versiones_per_idx  ON public.evaluaciones_versiones (periodo_id, evaluado_id);

ALTER TABLE public.evaluaciones_versiones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.evaluaciones_versiones FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.evaluaciones_versiones_id_seq FROM PUBLIC, anon, authenticated;
-- Sin políticas: se lee solo con evaluacion_versiones() (SECURITY DEFINER, administración).

-- ── 3. Ayudantes (internos) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._eval_estado_json(p public.evaluaciones) RETURNS JSONB
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('puntajes', p.puntajes, 'respuestas', p.respuestas, 'bono_ext', p.bono_ext,
                            'comentarios', p.comentarios, 'estado', p.estado);
$$;

-- Resultado calculado de UNA persona (v2). Mejor esfuerzo: NULL si no aplica o falla (clásica, sin sesión…).
CREATE OR REPLACE FUNCTION public._eval_resultado_json(p_periodo UUID, p_persona UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v JSONB;
BEGIN
  BEGIN
    SELECT to_jsonb(r) INTO v FROM public.resultados_periodo(p_periodo, false) r WHERE r.evaluado_id = p_persona;
  EXCEPTION WHEN OTHERS THEN
    v := NULL;
  END;
  RETURN v;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._eval_estado_json(public.evaluaciones), public._eval_resultado_json(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── 4. Guardia de la evaluación publicada ─────────────────────────────
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

DROP TRIGGER IF EXISTS zz_evaluaciones_publicada ON public.evaluaciones;
CREATE TRIGGER zz_evaluaciones_publicada
  BEFORE INSERT OR UPDATE OR DELETE ON public.evaluaciones
  FOR EACH ROW EXECUTE FUNCTION public.evaluaciones_publicada_guardia();

-- Registro de la publicación: AFTER, así solo corre cuando la fila de verdad se insertó o se actualizó.
CREATE OR REPLACE FUNCTION public.evaluaciones_publicada_registro() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.estado = 'publicado' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'publicado')
     AND COALESCE(current_setting('ec.rectificando', true), '') <> '1' THEN
    INSERT INTO public.evaluaciones_versiones
      (evaluacion_id, periodo_id, evaluado_id, version, accion, antes, despues, actor)
    VALUES (NEW.id, NEW.periodo_id, NEW.evaluado_id, NEW.version, 'publicada', NULL, public._eval_estado_json(NEW), auth.uid());
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.evaluaciones_publicada_registro() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_evaluaciones_publicada_registro ON public.evaluaciones;
CREATE TRIGGER zz_evaluaciones_publicada_registro
  AFTER INSERT OR UPDATE ON public.evaluaciones
  FOR EACH ROW EXECUTE FUNCTION public.evaluaciones_publicada_registro();

-- ── 5. Rectificar y retirar (única vía de cambio de una publicada) ────
CREATE OR REPLACE FUNCTION public.rectificar_evaluacion(
  p_id         BIGINT,
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

CREATE OR REPLACE FUNCTION public.retirar_evaluacion(p_id BIGINT, p_motivo TEXT) RETURNS INT
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

CREATE OR REPLACE FUNCTION public.evaluacion_versiones(p_id BIGINT) RETURNS SETOF public.evaluaciones_versiones
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo la administracion consulta el historial de una evaluacion.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.evaluaciones_versiones WHERE evaluacion_id = p_id ORDER BY id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rectificar_evaluacion(BIGINT, JSONB, JSONB, TEXT, JSONB, NUMERIC),
  public.retirar_evaluacion(BIGINT, TEXT), public.evaluacion_versiones(BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rectificar_evaluacion(BIGINT, JSONB, JSONB, TEXT, JSONB, NUMERIC),
  public.retirar_evaluacion(BIGINT, TEXT), public.evaluacion_versiones(BIGINT) TO authenticated;

-- ── 6. Relleno: las ya publicadas quedan en versión 1 ─────────────────
--  El DEFAULT ya las dejó en 1. No se toca nada más (publicada_en NULL = anterior a 0053). Sin UPDATE: no se
--  disparan los triggers de notificación ni de validación.

-- ── REVERSA ───────────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS zz_evaluaciones_publicada_registro ON public.evaluaciones;
-- DROP FUNCTION IF EXISTS public.evaluaciones_publicada_registro();
-- DROP TRIGGER IF EXISTS zz_evaluaciones_publicada ON public.evaluaciones;
-- DROP FUNCTION IF EXISTS public.evaluaciones_publicada_guardia();
-- DROP FUNCTION IF EXISTS public.rectificar_evaluacion(BIGINT, JSONB, JSONB, TEXT, JSONB, NUMERIC);
-- DROP FUNCTION IF EXISTS public.retirar_evaluacion(BIGINT, TEXT);
-- DROP FUNCTION IF EXISTS public.evaluacion_versiones(BIGINT);
-- DROP FUNCTION IF EXISTS public._eval_resultado_json(UUID, UUID);
-- DROP FUNCTION IF EXISTS public._eval_estado_json(public.evaluaciones);
-- (conservar evaluaciones_versiones como registro; si se quiere borrar: DROP TABLE public.evaluaciones_versiones;)
-- ALTER TABLE public.evaluaciones DROP COLUMN version, DROP COLUMN publicada_en, DROP COLUMN rectificada_en, DROP COLUMN rectificada_por;
