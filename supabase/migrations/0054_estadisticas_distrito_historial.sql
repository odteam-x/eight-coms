-- ══════════════════════════════════════════════════════════════════════
--  0054 — Estadísticas de Instagram: conservar el valor anterior (auditoría H-04; PDF §6.8)
-- ══════════════════════════════════════════════════════════════════════
--
--  PROBLEMA
--  Corregir una cifra (`est_dist_actualizar`) sobrescribía la fila, y reemplazar la captura borraba la anterior:
--  no quedaba ni el valor ni la prueba originales.
--
--  QUÉ HACE
--  · `estadisticas_distrito_hist` (append-only, sin permisos de cliente): ANTES de cada corrección o borrado guarda
--    la fila anterior completa (cifras, ruta de la captura, quién la subió y cuándo) y quién hizo el cambio.
--  · `estadisticas_distrito_historial(periodo, distrito)` (SECURITY DEFINER): la administración ve cualquier
--    distrito; una secretaría solo el suyo; un miembro nada.
--  · El front deja de borrar la captura anterior de Storage al reemplazarla (core/estadisticas-distrito.js): la
--    ruta anterior queda referenciada por el historial.
--
--  QUÉ NO HACE (decisión de negocio pendiente): estados validada/cerrada y quién cierra la cifra.
--  QUÉ NO CAMBIA: la tabla `estadisticas_distrito`, sus políticas, sus triggers ni las cifras que hoy se ven.
--
--  APLICAR después de 0043. Idempotente. Reversa al final.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.estadisticas_distrito_hist (
  id                 BIGSERIAL   PRIMARY KEY,
  estadistica_id     BIGINT      NOT NULL,            -- sin FK: sobrevive a un borrado
  periodo_id         UUID        NOT NULL,
  distrito_id        TEXT        NOT NULL,
  accion             TEXT        NOT NULL CHECK (accion IN ('corregida', 'borrada')),
  visualizaciones    BIGINT,
  cuentas_alcanzadas BIGINT,
  visitas_perfil     BIGINT,
  seguidores_neto    INTEGER,
  pct_publicaciones  NUMERIC(5,2),
  pct_historias      NUMERIC(5,2),
  pct_reels          NUMERIC(5,2),
  captura_path       TEXT,                            -- la captura ANTERIOR (sigue en Storage)
  subido_por         UUID,
  subido_por_nombre  TEXT,
  subido_en          TIMESTAMPTZ,                     -- cuándo se subió ESA versión
  cambiado_por       UUID,                            -- quién la reemplazó o la borró (NULL = sin sesión)
  cambiado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS estadisticas_distrito_hist_idx ON public.estadisticas_distrito_hist (periodo_id, distrito_id, id);
ALTER TABLE public.estadisticas_distrito_hist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.estadisticas_distrito_hist FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.estadisticas_distrito_hist_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.estadisticas_distrito_guardar_hist() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  -- Una corrección que no cambia nada (mismo valor, misma captura) no es historia.
  IF TG_OP = 'UPDATE' AND ROW(NEW.visualizaciones, NEW.cuentas_alcanzadas, NEW.visitas_perfil, NEW.seguidores_neto,
        NEW.pct_publicaciones, NEW.pct_historias, NEW.pct_reels, NEW.captura_path)
     IS NOT DISTINCT FROM ROW(OLD.visualizaciones, OLD.cuentas_alcanzadas, OLD.visitas_perfil, OLD.seguidores_neto,
        OLD.pct_publicaciones, OLD.pct_historias, OLD.pct_reels, OLD.captura_path) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.estadisticas_distrito_hist
    (estadistica_id, periodo_id, distrito_id, accion, visualizaciones, cuentas_alcanzadas, visitas_perfil, seguidores_neto,
     pct_publicaciones, pct_historias, pct_reels, captura_path, subido_por, subido_por_nombre, subido_en, cambiado_por)
  VALUES (OLD.id, OLD.periodo_id, OLD.distrito_id, CASE TG_OP WHEN 'DELETE' THEN 'borrada' ELSE 'corregida' END,
          OLD.visualizaciones, OLD.cuentas_alcanzadas, OLD.visitas_perfil, OLD.seguidores_neto,
          OLD.pct_publicaciones, OLD.pct_historias, OLD.pct_reels, OLD.captura_path, OLD.subido_por, OLD.subido_por_nombre,
          OLD.actualizado_en, auth.uid());
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.estadisticas_distrito_guardar_hist() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS estadisticas_distrito_hist ON public.estadisticas_distrito;
CREATE TRIGGER estadisticas_distrito_hist AFTER UPDATE OR DELETE ON public.estadisticas_distrito
  FOR EACH ROW EXECUTE FUNCTION public.estadisticas_distrito_guardar_hist();

CREATE OR REPLACE FUNCTION public.estadisticas_distrito_historial(p_periodo UUID, p_distrito TEXT)
RETURNS SETOF public.estadisticas_distrito_hist
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501'; END IF;
  IF NOT (public.is_admin() OR (public.is_secretario() AND p_distrito = public.get_my_distrito())) THEN
    RAISE EXCEPTION 'Solo la administracion o la secretaria de ese distrito ven su historial.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.estadisticas_distrito_hist WHERE periodo_id = p_periodo AND distrito_id = p_distrito ORDER BY id DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.estadisticas_distrito_historial(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.estadisticas_distrito_historial(UUID, TEXT) TO authenticated;

-- ── REVERSA ───────────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS estadisticas_distrito_hist ON public.estadisticas_distrito;
-- DROP FUNCTION IF EXISTS public.estadisticas_distrito_guardar_hist();
-- DROP FUNCTION IF EXISTS public.estadisticas_distrito_historial(UUID, TEXT);
-- (conservar estadisticas_distrito_hist como registro; si se quiere: DROP TABLE public.estadisticas_distrito_hist;)
