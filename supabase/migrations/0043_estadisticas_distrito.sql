-- ══════════════════════════════════════════════════════════════════════
--  0043 — Estadísticas de Instagram del distrito: las sube la secretaría, con una captura de prueba
-- ══════════════════════════════════════════════════════════════════════
--
--  HASTA AHORA: las siete cifras de Instagram del distrito (visualizaciones, cuentas alcanzadas, visitas al perfil,
--  seguidores netos, % publicaciones / historias / reels) las escribía solo la administración dentro de
--  evaluaciones_distrito.ig_stats; la secretaría no podía escribir ahí (la evaluación oficial es del admin) y no había
--  evidencia de dónde salían las cifras.
--
--  AHORA: cada distrito, para cada Período de Evaluación (PE), tiene UNA entrega de estadísticas que sube cualquier
--  secretaría de ESE distrito, con una captura de pantalla como prueba.
--
--  1. TABLA estadisticas_distrito: una fila por (periodo, distrito). Cifras tipadas con CHECK (no texto libre).
--     La captura es OBLIGATORIA: no se puede guardar una fila sin ella. La evaluación oficial (evaluaciones_distrito)
--     no cambia: sigue siendo solo del admin; la pantalla del admin precarga estas cifras al evaluar.
--  2. QUIÉN: una secretaría escribe SOLO las de su distrito (get_my_distrito()), en una gestión que no esté archivada
--     (gestion_escribible); el admin lee y corrige todo; nadie más ve nada. `subido_por` y `actualizado_en` los fija
--     un disparador: el cliente no los controla. periodo_id y distrito_id no se pueden mover después de creada la fila.
--  3. CAPTURAS: bucket PRIVADO `capturas-distrito` (solo WebP/JPEG, tope 600 KB: el navegador la reduce antes de
--     subir, pero el límite se impone aquí). Ruta obligatoria: <distrito>/<periodo>/<archivo>.webp|jpg.
--     Escribe la secretaría de ese distrito (o el admin) y lee igual; se ve con URL firmada de corta vida.
--  Nota: la base no puede comprobar que el archivo exista en Storage; solo que la ruta tenga la forma y la carpeta
--  correctas. Un archivo huérfano no da acceso a nada.
--
--  Requiere 0013 (gestion_escribible) y el bucket de Storage de la plataforma. Aplicación manual en el SQL Editor. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.estadisticas_distrito (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  periodo_id         UUID    NOT NULL REFERENCES public.periodos_evaluacion(id) ON DELETE CASCADE,
  distrito_id        TEXT    NOT NULL REFERENCES public.distritos(id) ON UPDATE CASCADE,
  visualizaciones    BIGINT  NOT NULL CHECK (visualizaciones    BETWEEN 0 AND 1000000000),
  cuentas_alcanzadas BIGINT  NOT NULL CHECK (cuentas_alcanzadas BETWEEN 0 AND 1000000000),
  visitas_perfil     BIGINT  NOT NULL CHECK (visitas_perfil     BETWEEN 0 AND 1000000000),
  seguidores_neto    INTEGER NOT NULL CHECK (seguidores_neto    BETWEEN -10000000 AND 10000000),
  pct_publicaciones  NUMERIC(5,2) NOT NULL CHECK (pct_publicaciones BETWEEN 0 AND 100),
  pct_historias      NUMERIC(5,2) NOT NULL CHECK (pct_historias     BETWEEN 0 AND 100),
  pct_reels          NUMERIC(5,2) NOT NULL CHECK (pct_reels         BETWEEN 0 AND 100),
  captura_path       TEXT    NOT NULL,
  subido_por         UUID    NOT NULL REFERENCES public.profiles(id),
  subido_por_nombre  TEXT    NOT NULL DEFAULT '',
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (periodo_id, distrito_id)
);
CREATE INDEX IF NOT EXISTS estadisticas_distrito_distrito_idx ON public.estadisticas_distrito (distrito_id);

-- Disparador: lo que el cliente no decide (quién, cuándo) y la forma de la ruta de la captura.
CREATE OR REPLACE FUNCTION public.estadisticas_distrito_validar() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.periodo_id IS DISTINCT FROM OLD.periodo_id OR NEW.distrito_id IS DISTINCT FROM OLD.distrito_id) THEN
    RAISE EXCEPTION 'El período y el distrito de una entrega no se pueden cambiar.' USING ERRCODE = '42501';
  END IF;
  -- <distrito>/<periodo>/<archivo>.webp|jpg : la carpeta DEBE ser la de esta fila (nadie apunta a la captura de otro distrito).
  IF NEW.captura_path IS NULL
     OR NEW.captura_path !~ '^[A-Za-z0-9_-]{1,20}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}\.(webp|jpe?g)$'
     OR split_part(NEW.captura_path, '/', 1) <> NEW.distrito_id
     OR split_part(NEW.captura_path, '/', 2) <> NEW.periodo_id::text THEN
    RAISE EXCEPTION 'La captura de prueba es obligatoria y debe estar en la carpeta de este distrito y período.' USING ERRCODE = '23514';
  END IF;
  NEW.subido_por := COALESCE(auth.uid(), NEW.subido_por);
  -- El nombre de quien subió se copia aquí (SECURITY DEFINER): una secretaría puede no tener permiso de leer el perfil del admin que corrigió.
  NEW.subido_por_nombre := COALESCE((SELECT p.nombre FROM profiles p WHERE p.id = NEW.subido_por), '');
  NEW.actualizado_en := NOW();
  IF TG_OP = 'INSERT' THEN NEW.creado_en := NOW(); END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS estadisticas_distrito_validar ON public.estadisticas_distrito;
CREATE TRIGGER estadisticas_distrito_validar BEFORE INSERT OR UPDATE ON public.estadisticas_distrito
  FOR EACH ROW EXECUTE FUNCTION public.estadisticas_distrito_validar();
REVOKE EXECUTE ON FUNCTION public.estadisticas_distrito_validar() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.estadisticas_distrito ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.estadisticas_distrito FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estadisticas_distrito TO authenticated;

DROP POLICY IF EXISTS est_dist_leer ON public.estadisticas_distrito;
CREATE POLICY est_dist_leer ON public.estadisticas_distrito FOR SELECT TO authenticated
  USING (public.is_admin() OR (public.is_secretario() AND distrito_id = public.get_my_distrito()));

DROP POLICY IF EXISTS est_dist_insertar ON public.estadisticas_distrito;
CREATE POLICY est_dist_insertar ON public.estadisticas_distrito FOR INSERT TO authenticated
  WITH CHECK ((public.is_admin() OR (public.is_secretario() AND distrito_id = public.get_my_distrito()))
              AND public.gestion_escribible(periodo_id));

DROP POLICY IF EXISTS est_dist_actualizar ON public.estadisticas_distrito;
CREATE POLICY est_dist_actualizar ON public.estadisticas_distrito FOR UPDATE TO authenticated
  USING (public.is_admin() OR (public.is_secretario() AND distrito_id = public.get_my_distrito()))
  WITH CHECK ((public.is_admin() OR (public.is_secretario() AND distrito_id = public.get_my_distrito()))
              AND public.gestion_escribible(periodo_id));

-- Borrar una entrega: solo la administración (una secretaría corrige, no borra).
DROP POLICY IF EXISTS est_dist_borrar ON public.estadisticas_distrito;
CREATE POLICY est_dist_borrar ON public.estadisticas_distrito FOR DELETE TO authenticated
  USING (public.is_admin() AND public.gestion_escribible(periodo_id));

-- ── Capturas: bucket privado, solo imágenes ligeras ──────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('capturas-distrito', 'capturas-distrito', false, 614400, ARRAY['image/webp','image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- La primera carpeta es el distrito; la segunda, el período (uuid). CASE para no convertir a uuid algo que no lo es.
DROP POLICY IF EXISTS capturas_distrito_leer ON storage.objects;
CREATE POLICY capturas_distrito_leer ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'capturas-distrito'
         AND (public.is_admin() OR (public.is_secretario() AND (storage.foldername(name))[1] = public.get_my_distrito())));

DROP POLICY IF EXISTS capturas_distrito_subir ON storage.objects;
CREATE POLICY capturas_distrito_subir ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'capturas-distrito'
              AND (public.is_admin() OR (public.is_secretario() AND (storage.foldername(name))[1] = public.get_my_distrito()))
              AND CASE WHEN (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       THEN public.gestion_escribible(((storage.foldername(name))[2])::uuid) ELSE false END);

DROP POLICY IF EXISTS capturas_distrito_cambiar ON storage.objects;
CREATE POLICY capturas_distrito_cambiar ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'capturas-distrito'
         AND (public.is_admin() OR (public.is_secretario() AND (storage.foldername(name))[1] = public.get_my_distrito())))
  WITH CHECK (bucket_id = 'capturas-distrito'
              AND (public.is_admin() OR (public.is_secretario() AND (storage.foldername(name))[1] = public.get_my_distrito())));

-- Reemplazar la captura = subir la nueva y borrar la anterior: la secretaría borra solo en la carpeta de su distrito.
DROP POLICY IF EXISTS capturas_distrito_borrar ON storage.objects;
CREATE POLICY capturas_distrito_borrar ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'capturas-distrito'
         AND (public.is_admin() OR (public.is_secretario() AND (storage.foldername(name))[1] = public.get_my_distrito())));

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- DESHACER (no borra capturas ya subidas; vaciar el bucket se hace desde el panel de Storage):
--   DROP TABLE public.estadisticas_distrito; DROP FUNCTION public.estadisticas_distrito_validar();
--   DROP POLICY capturas_distrito_leer/subir/cambiar/borrar ON storage.objects;  y borrar el bucket `capturas-distrito`.
-- ══════════════════════════════════════════════════════════════════════
