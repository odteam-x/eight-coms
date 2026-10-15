-- Esquema MÍNIMO equivalente al de producción, solo para probar migraciones en
-- un Postgres local (PGlite). No es el esquema real: reproduce lo que las
-- migraciones 0015 y 0016 necesitan de las anteriores (gestiones, periodos,
-- profiles, is_admin, get_district_member_ids, gestion_escribible…).
-- Esquema mínimo equivalente al de producción, solo para probar migraciones.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;

CREATE TABLE public.gestiones (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE, activa BOOLEAN NOT NULL DEFAULT false,
  archivada BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.roles (id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL, activo BOOLEAN DEFAULT true, orden SMALLINT DEFAULT 0);
CREATE TABLE public.profiles (id UUID PRIMARY KEY, nombre TEXT DEFAULT '', email TEXT DEFAULT '',
  rol_id INTEGER REFERENCES roles(id), es_admin BOOLEAN DEFAULT false,
  tipo_miembro TEXT DEFAULT 'miembro', distrito TEXT);
CREATE TABLE public.periodos_evaluacion (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gestion_id BIGINT NOT NULL REFERENCES gestiones(id), nombre TEXT NOT NULL,
  descripcion TEXT DEFAULT '', activo BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT clock_timestamp());
CREATE TABLE public.evaluaciones (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  periodo_id UUID NOT NULL REFERENCES periodos_evaluacion(id),
  evaluado_id UUID NOT NULL REFERENCES profiles(id), evaluador_id UUID,
  puntajes JSONB NOT NULL DEFAULT '{}', bono_ext NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (bono_ext BETWEEN 0 AND 2),
  comentarios JSONB NOT NULL DEFAULT '{}', estado TEXT NOT NULL DEFAULT 'borrador',
  UNIQUE (periodo_id, evaluado_id));
CREATE TABLE public.criterios (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gestion_id BIGINT, key TEXT, label TEXT, abbr TEXT, color TEXT, orden SMALLINT, activo BOOLEAN, max SMALLINT);
CREATE TABLE public.rubrica (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, gestion_id BIGINT,
  criterio_id BIGINT, criterio TEXT, nivel4 TEXT, nivel3 TEXT, nivel2 TEXT, nivel1 TEXT, orden SMALLINT);
CREATE TABLE public.calendario (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, gestion_id BIGINT,
  numero SMALLINT, titulo TEXT, descripcion TEXT, color TEXT, estado TEXT);

CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
$$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND es_admin) $$;
CREATE FUNCTION public.is_secretario() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
$$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND tipo_miembro='secretario') $$;
CREATE FUNCTION public.get_district_member_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS
$$ SELECT p.id FROM profiles p JOIN profiles s ON s.id = auth.uid()
    WHERE p.distrito = s.distrito AND s.tipo_miembro='secretario' AND s.distrito IS NOT NULL $$;
CREATE FUNCTION public.gestion_id_escribible(g BIGINT) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
$$ SELECT COALESCE((SELECT NOT archivada FROM gestiones WHERE id = g), false) $$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
CREATE FUNCTION public.gestion_escribible(p UUID) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
$$ SELECT COALESCE((SELECT NOT g.archivada FROM periodos_evaluacion pe JOIN gestiones g ON g.id = pe.gestion_id WHERE pe.id = p), false) $$;
GRANT EXECUTE ON FUNCTION public.gestion_escribible(UUID) TO anon, authenticated;
