-- ════════════════════════════════════════════════════════════════════════
-- 0018 — Actividades y etiquetas (independientes de los períodos)
-- ════════════════════════════════════════════════════════════════════════
-- Hasta ahora las "actividades" eran filas de `calendario`: un número de PE y
-- cuatro fechas fijas. Una actividad real (una capacitación, una jornada, una
-- reunión) no pertenece a un período de evaluación.
--
--   etiquetas   — categorías con nombre y tono (coral, violeta, verde, ámbar,
--                 cian, azul, rojo, gris). Las edita la administración.
--   actividades — título, descripción, fecha (o rango), etiqueta y, opcional,
--                 distrito. distrito IS NULL = para todo el equipo.
--
-- Quién puede qué (lo impone la base, no el cliente):
--   · todas las personas autenticadas LEEN las etiquetas;
--   · leen las actividades de todo el equipo y las de SU distrito;
--   · la administración escribe todo;
--   · una secretaría escribe SOLO actividades de su propio distrito;
--   · nadie escribe en una gestión archivada (gestion_id_escribible, 0013).
-- `calendario` NO se toca: queda como historial.

BEGIN;

-- Ayudante: distrito de quien consulta (SECURITY DEFINER para no depender de RLS de profiles).
CREATE OR REPLACE FUNCTION public.mi_distrito()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT distrito FROM profiles WHERE id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.mi_distrito() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mi_distrito() TO authenticated;

-- ── Etiquetas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.etiquetas (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gestion_id  BIGINT NOT NULL REFERENCES public.gestiones(id) ON DELETE CASCADE,
  nombre      TEXT   NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 40),
  tono        TEXT   NOT NULL CHECK (tono IN ('coral','violeta','verde','ambar','cian','azul','rojo','gris')),
  orden       SMALLINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gestion_id, nombre)
);

-- ── Actividades ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.actividades (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gestion_id   BIGINT NOT NULL REFERENCES public.gestiones(id) ON DELETE CASCADE,
  titulo       TEXT   NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 120),
  descripcion  TEXT   NOT NULL DEFAULT '',
  etiqueta_id  BIGINT REFERENCES public.etiquetas(id) ON DELETE SET NULL,
  fecha_inicio DATE   NOT NULL,
  fecha_fin    DATE,
  distrito     TEXT,
  creada_por   UUID   REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
);
CREATE INDEX IF NOT EXISTS actividades_gestion_fecha_idx ON public.actividades (gestion_id, fecha_inicio);

-- ── Reglas fijadas por el servidor ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.actividades_fijar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.creada_por := auth.uid();
  ELSE
    -- La gestión y la autoría no se reasignan.
    NEW.gestion_id := OLD.gestion_id;
    NEW.creada_por := OLD.creada_por;
  END IF;
  NEW.updated_at := now();
  -- La etiqueta debe ser de la misma gestión.
  IF NEW.etiqueta_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM etiquetas e WHERE e.id = NEW.etiqueta_id AND e.gestion_id = NEW.gestion_id) THEN
    RAISE EXCEPTION 'La etiqueta no pertenece a esta gestión.' USING ERRCODE = '23514';
  END IF;
  -- Una secretaría solo crea y edita actividades de su distrito.
  IF NOT public.is_admin() AND (NEW.distrito IS NULL OR NEW.distrito IS DISTINCT FROM public.mi_distrito()) THEN
    RAISE EXCEPTION 'Solo la administración crea actividades para todo el equipo; tú, para tu distrito.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.actividades_fijar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS actividades_fijar ON public.actividades;
CREATE TRIGGER actividades_fijar BEFORE INSERT OR UPDATE ON public.actividades
  FOR EACH ROW EXECUTE FUNCTION public.actividades_fijar();

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.etiquetas   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actividades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS etiquetas_leer ON public.etiquetas;
CREATE POLICY etiquetas_leer ON public.etiquetas FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS etiquetas_admin ON public.etiquetas;
CREATE POLICY etiquetas_admin ON public.etiquetas FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin() AND public.gestion_id_escribible(gestion_id));

DROP POLICY IF EXISTS actividades_leer ON public.actividades;
CREATE POLICY actividades_leer ON public.actividades FOR SELECT TO authenticated
  USING (public.is_admin() OR distrito IS NULL OR distrito = public.mi_distrito());

DROP POLICY IF EXISTS actividades_admin ON public.actividades;
CREATE POLICY actividades_admin ON public.actividades FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin() AND public.gestion_id_escribible(gestion_id));

DROP POLICY IF EXISTS actividades_secretaria ON public.actividades;
CREATE POLICY actividades_secretaria ON public.actividades FOR ALL TO authenticated
  USING (public.is_secretario() AND distrito = public.mi_distrito())
  WITH CHECK (public.is_secretario() AND distrito = public.mi_distrito() AND public.gestion_id_escribible(gestion_id));

-- ── Etiquetas de partida ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sembrar_etiquetas(p_gestion BIGINT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO etiquetas (gestion_id, nombre, tono, orden) VALUES
    (p_gestion, 'Entrega',      'coral',   1),
    (p_gestion, 'Jornada',      'violeta', 2),
    (p_gestion, 'Capacitación', 'verde',   3),
    (p_gestion, 'Reunión',      'ambar',   4),
    (p_gestion, 'Hito',         'cian',    5)
  ON CONFLICT (gestion_id, nombre) DO NOTHING;
$$;
REVOKE EXECUTE ON FUNCTION public.sembrar_etiquetas(BIGINT) FROM PUBLIC, anon, authenticated;

-- Las gestiones que ya existen y las que se abran después las reciben.
SELECT public.sembrar_etiquetas(id) FROM public.gestiones;

CREATE OR REPLACE FUNCTION public.gestiones_sembrar_etiquetas()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN PERFORM public.sembrar_etiquetas(NEW.id); RETURN NEW; END;
$$;
REVOKE EXECUTE ON FUNCTION public.gestiones_sembrar_etiquetas() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS gestiones_sembrar_etiquetas ON public.gestiones;
CREATE TRIGGER gestiones_sembrar_etiquetas AFTER INSERT ON public.gestiones
  FOR EACH ROW EXECUTE FUNCTION public.gestiones_sembrar_etiquetas();

COMMIT;

-- ── Deshacer ────────────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS gestiones_sembrar_etiquetas ON public.gestiones;
-- DROP FUNCTION IF EXISTS public.gestiones_sembrar_etiquetas();
-- DROP FUNCTION IF EXISTS public.sembrar_etiquetas(BIGINT);
-- DROP TABLE IF EXISTS public.actividades;
-- DROP TABLE IF EXISTS public.etiquetas;
-- DROP FUNCTION IF EXISTS public.actividades_fijar();
-- DROP FUNCTION IF EXISTS public.mi_distrito();
