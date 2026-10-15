-- ════════════════════════════════════════════════════════════════════════
-- 0017 — Puntos por tarea, fijados al aprobar
-- ════════════════════════════════════════════════════════════════════════
-- Quien aprueba una tarea le asigna una puntuación de 0 a 10. Es un HECHO
-- más para el evaluador (junto con plazos y devoluciones): no entra solo en
-- ninguna fórmula de resultados_periodo(), que sigue calculando lo de siempre.
--
-- Reglas, impuestas por el trigger y no por el cliente:
--   · la puntuación solo se escribe EN EL MOMENTO de aprobar (y es obligatoria);
--   · el admin puede corregirla mientras la tarea siga aprobada;
--   · reabrir la tarea la borra (vuelve a puntuarse al aprobar de nuevo);
--   · quién puede aprobar sigue decidiéndolo tareas_validar_update() (nadie
--     aprueba lo suyo); este trigger solo añade la regla de los puntos.
-- Se ejecuta DESPUÉS de tareas_validar_update (los triggers van por orden
-- alfabético): el nombre empieza por «zz_».

ALTER TABLE public.tareas
  ADD COLUMN IF NOT EXISTS puntos SMALLINT
  CHECK (puntos IS NULL OR puntos BETWEEN 0 AND 10);

CREATE OR REPLACE FUNCTION public.tareas_puntos_validar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.puntos := NULL;                       -- una tarea nueva nunca nace puntuada
    RETURN NEW;
  END IF;

  IF NEW.estado = 'aprobada' AND OLD.estado <> 'aprobada' THEN
    -- Al aprobar: la puntuación es obligatoria.
    IF NEW.puntos IS NULL THEN
      RAISE EXCEPTION 'Al aprobar una tarea asigna sus puntos (de 0 a 10).' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.estado = 'aprobada' AND OLD.estado = 'aprobada' THEN
    -- Ya aprobada: solo el admin corrige los puntos.
    IF NEW.puntos IS DISTINCT FROM OLD.puntos AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Los puntos de una tarea aprobada solo los corrige el administrador.' USING ERRCODE = '42501';
    END IF;
    IF NEW.puntos IS NULL AND OLD.puntos IS NOT NULL THEN
      RAISE EXCEPTION 'Una tarea aprobada necesita sus puntos.' USING ERRCODE = '23514';
    END IF;
  ELSE
    -- Sin aprobar (o reabierta): no hay puntos.
    IF NEW.puntos IS NOT NULL AND NEW.puntos IS DISTINCT FROM OLD.puntos THEN
      RAISE EXCEPTION 'Los puntos se asignan al aprobar la tarea.' USING ERRCODE = '42501';
    END IF;
    NEW.puntos := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_puntos_validar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_tareas_puntos ON public.tareas;
CREATE TRIGGER zz_tareas_puntos
  BEFORE INSERT OR UPDATE ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION public.tareas_puntos_validar();

-- Las tareas ya aprobadas antes de esta migración quedan sin puntos (null); no se
-- inventan puntos retroactivos y editarlas no obliga a puntuarlas.

-- ── Deshacer ────────────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS zz_tareas_puntos ON public.tareas;
-- DROP FUNCTION IF EXISTS public.tareas_puntos_validar();
-- ALTER TABLE public.tareas DROP COLUMN IF EXISTS puntos;
