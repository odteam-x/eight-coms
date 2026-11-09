-- ══════════════════════════════════════════════════════════════════════
--  0058 — Banco de imágenes: enlaces a las fotos y videos de los eventos, con título y descripción
-- ══════════════════════════════════════════════════════════════════════
--
--  QUÉ ES. El sistema NO guarda archivos: guarda ENLACES (Drive, Dropbox, iCloud…) con un título, una descripción y, opcional,
--  el evento al que pertenecen. Así todas las imágenes de todos los eventos quedan localizables en un solo sitio sin pagar
--  almacenamiento ni exponer archivos pesados.
--
--  QUIÉN PUEDE QUÉ (lo impone la base, no el cliente).
--    · LEER: toda persona autenticada con el acceso aprobado ve TODO el banco de la gestión.
--      (Decisión provisional: el mensaje del dueño llegó cortado en «de acceso a las…»; si el acceso debe limitarse por rol o
--       distrito basta cambiar la política `banco_leer`. Los enlaces son de quien los sube: no se sube nada confidencial.)
--    · AÑADIR: cualquier persona con el acceso aprobado, en una gestión no archivada. `creado_por`, `gestion_id`, `rol_id` y
--      `distrito` los fija el servidor (el cliente no los elige): la fila queda con el ROL y el DISTRITO de quien la subió,
--      que es lo que permite que cada rol vea sus imágenes agrupadas.
--    · EDITAR / BORRAR: quien la subió o la administración, en una gestión no archivada.
--  El enlace debe ser http(s); título 3–120; descripción ≤ 600; evento ≤ 120.
--
--  NO TOCA ninguna tabla existente. Requiere 0013 (gestion_id_escribible). Aplicación manual en el SQL Editor. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.banco_imagenes (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gestion_id   BIGINT NOT NULL REFERENCES public.gestiones(id) ON DELETE CASCADE,
  titulo       TEXT   NOT NULL CHECK (length(btrim(titulo)) BETWEEN 3 AND 120),
  descripcion  TEXT   NOT NULL DEFAULT '' CHECK (length(descripcion) <= 600),
  enlace       TEXT   NOT NULL CHECK (length(enlace) <= 1000 AND enlace ~* '^https?://[^[:space:]]+$'),
  evento       TEXT   NOT NULL DEFAULT '' CHECK (length(evento) <= 120),
  rol_id       INTEGER REFERENCES public.roles(id) ON DELETE SET NULL,
  distrito     TEXT,
  creado_por   UUID   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS banco_imagenes_gestion_idx ON public.banco_imagenes (gestion_id, created_at DESC);
CREATE INDEX IF NOT EXISTS banco_imagenes_rol_idx ON public.banco_imagenes (rol_id);

-- El servidor decide quién es el autor, la gestión, el rol y el distrito.
CREATE OR REPLACE FUNCTION public.banco_fijar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesión.'; END IF;
    NEW.creado_por := auth.uid();
    IF NEW.gestion_id IS NULL THEN SELECT id INTO NEW.gestion_id FROM gestiones WHERE activa ORDER BY id DESC LIMIT 1; END IF;
    SELECT p.rol_id, p.distrito INTO NEW.rol_id, NEW.distrito FROM profiles p WHERE p.id = auth.uid();
  ELSE
    -- La autoría, la gestión y el rol de origen no se reasignan.
    NEW.creado_por := OLD.creado_por; NEW.gestion_id := OLD.gestion_id; NEW.rol_id := OLD.rol_id; NEW.distrito := OLD.distrito;
    NEW.updated_at := now();
  END IF;
  NEW.titulo := btrim(NEW.titulo); NEW.enlace := btrim(NEW.enlace);
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.banco_fijar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS banco_fijar ON public.banco_imagenes;
CREATE TRIGGER banco_fijar BEFORE INSERT OR UPDATE ON public.banco_imagenes FOR EACH ROW EXECUTE FUNCTION public.banco_fijar();

-- Acceso aprobado (una persona pendiente no ve ni escribe nada).
CREATE OR REPLACE FUNCTION public.es_persona_aprobada() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND aprobado IS NOT FALSE);
$$;
REVOKE EXECUTE ON FUNCTION public.es_persona_aprobada() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.es_persona_aprobada() TO authenticated;

ALTER TABLE public.banco_imagenes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.banco_imagenes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banco_imagenes TO authenticated;

DROP POLICY IF EXISTS banco_leer ON public.banco_imagenes;
CREATE POLICY banco_leer ON public.banco_imagenes FOR SELECT TO authenticated USING (public.es_persona_aprobada());

DROP POLICY IF EXISTS banco_insertar ON public.banco_imagenes;
CREATE POLICY banco_insertar ON public.banco_imagenes FOR INSERT TO authenticated
  WITH CHECK (public.es_persona_aprobada() AND public.gestion_id_escribible(gestion_id));

DROP POLICY IF EXISTS banco_editar ON public.banco_imagenes;
CREATE POLICY banco_editar ON public.banco_imagenes FOR UPDATE TO authenticated
  USING (public.es_persona_aprobada() AND (creado_por = auth.uid() OR public.is_admin()) AND public.gestion_id_escribible(gestion_id))
  WITH CHECK (public.es_persona_aprobada() AND (creado_por = auth.uid() OR public.is_admin()) AND public.gestion_id_escribible(gestion_id));

DROP POLICY IF EXISTS banco_borrar ON public.banco_imagenes;
CREATE POLICY banco_borrar ON public.banco_imagenes FOR DELETE TO authenticated
  USING (public.es_persona_aprobada() AND (creado_por = auth.uid() OR public.is_admin()) AND public.gestion_id_escribible(gestion_id));

COMMIT;
