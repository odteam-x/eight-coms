-- ══════════════════════════════════════════════════════════════════════
--  0052 — Gafetes con QR verificable
-- ══════════════════════════════════════════════════════════════════════
--
--  QUÉ HACE. Cada persona tiene un gafete con un código QR. El QR apunta a /v/<token>, una página PÚBLICA (sin sesión) que
--  confirma que la persona es miembro y muestra un récord resumido.
--
--  POR QUÉ UN TOKEN. El QR nunca lleva el id de la persona ni su correo: lleva un token aleatorio de 96 bits que solo
--  sirve para pedir el récord público. No se puede adivinar ni recorrer. Si un gafete se pierde o se filtra, se
--  REVOCA o se REGENERA y el QR viejo deja de valer.
--
--  QUÉ ES PÚBLICO (y nada más). Nombre, foto, rol, distrito, cargo (miembro / secretaría / administración), fecha de ingreso
--  y cuántos períodos de evaluación (PE) tiene evaluados y publicados. NO se publican correo, notas, comentarios ni tareas.
--  Solo valida una cuenta aprobada; una cuenta sin aprobar o un gafete revocado responden igual: «no válido».
--
--  ACCESO. La tabla no tiene políticas ni permisos para nadie: todo pasa por funciones SECURITY DEFINER.
--    · verificar_gafete(token)         anon + authenticated — récord público (o {valido:false}).
--    · obtener_gafete([perfil])        authenticated — la persona obtiene su token (se crea al primer uso); la administración
--                                      puede pedir el de otra persona.
--    · regenerar_gafete([perfil])      authenticated — token nuevo (el anterior deja de valer); misma regla de acceso.
--    · revocar_gafete(perfil)          solo administración.
--
--  Aplicación manual en el SQL Editor. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.gafetes (
  perfil_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  token     TEXT NOT NULL UNIQUE CHECK (token ~ '^[0-9a-f]{24}$'),
  activo    BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.gafetes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gafetes FROM PUBLIC, anon, authenticated;

-- ── Token ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._gafete_token() RETURNS TEXT
LANGUAGE sql VOLATILE AS $$ SELECT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24) $$;
REVOKE ALL ON FUNCTION public._gafete_token() FROM PUBLIC, anon, authenticated;

-- ── Obtener (y crear si no existe) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.obtener_gafete(p_perfil UUID DEFAULT NULL) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID := COALESCE(p_perfil, auth.uid()); v_tok TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Necesitas iniciar sesión' USING ERRCODE = '42501'; END IF;
  IF v_id <> auth.uid() AND NOT public.is_admin() THEN RAISE EXCEPTION 'Sin permiso' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_id) THEN RAISE EXCEPTION 'Persona no encontrada'; END IF;
  INSERT INTO gafetes(perfil_id, token) VALUES (v_id, public._gafete_token()) ON CONFLICT (perfil_id) DO NOTHING;
  SELECT token INTO v_tok FROM gafetes WHERE perfil_id = v_id AND activo;
  IF v_tok IS NULL THEN RAISE EXCEPTION 'Este gafete fue revocado; pide a la administración uno nuevo' USING ERRCODE = '42501'; END IF;
  RETURN v_tok;
END $$;

-- ── Regenerar ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.regenerar_gafete(p_perfil UUID DEFAULT NULL) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID := COALESCE(p_perfil, auth.uid()); v_tok TEXT := public._gafete_token(); v_activo BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Necesitas iniciar sesión' USING ERRCODE = '42501'; END IF;
  IF v_id <> auth.uid() AND NOT public.is_admin() THEN RAISE EXCEPTION 'Sin permiso' USING ERRCODE = '42501'; END IF;
  SELECT activo INTO v_activo FROM gafetes WHERE perfil_id = v_id;
  -- Un gafete revocado solo lo reactiva la administración; la persona no puede saltarse la revocación.
  IF v_activo IS FALSE AND NOT public.is_admin() THEN RAISE EXCEPTION 'Este gafete fue revocado; pide a la administración uno nuevo' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_id) THEN RAISE EXCEPTION 'Persona no encontrada'; END IF;
  INSERT INTO gafetes(perfil_id, token) VALUES (v_id, v_tok)
  ON CONFLICT (perfil_id) DO UPDATE SET token = EXCLUDED.token, activo = true, creado_en = NOW();
  RETURN v_tok;
END $$;

-- ── Revocar ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revocar_gafete(p_perfil UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Solo la administración puede revocar gafetes' USING ERRCODE = '42501'; END IF;
  UPDATE gafetes SET activo = false WHERE perfil_id = p_perfil;
END $$;

-- ── Verificar (público) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verificar_gafete(p_token TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{24}$' THEN RETURN jsonb_build_object('valido', false); END IF;
  SELECT p.id, p.nombre, p.avatar_url, p.distrito, p.tipo_miembro, p.es_admin, p.created_at, ro.nombre AS rol
    INTO r
    FROM gafetes g
    JOIN profiles p ON p.id = g.perfil_id
    LEFT JOIN roles ro ON ro.id = p.rol_id
   WHERE g.token = p_token AND g.activo AND COALESCE(p.aprobado, false);
  IF NOT FOUND THEN RETURN jsonb_build_object('valido', false); END IF;
  RETURN jsonb_build_object(
    'valido', true,
    'nombre', r.nombre,
    'avatar_url', r.avatar_url,
    'rol', r.rol,
    'distrito', r.distrito,
    'cargo', CASE WHEN r.es_admin THEN 'administracion' WHEN r.tipo_miembro = 'secretario' THEN 'secretaria' ELSE 'miembro' END,
    'miembro_desde', r.created_at,
    'pe_evaluados', (SELECT COUNT(DISTINCT e.periodo_id) FROM evaluaciones e WHERE e.evaluado_id = r.id AND e.estado = 'publicado'),
    'verificado_en', NOW());
END $$;

-- anon se revoca de forma explícita: en Supabase las funciones nuevas nacen ejecutables por anon además de PUBLIC (patrón de 0010).
REVOKE ALL ON FUNCTION public.obtener_gafete(UUID), public.regenerar_gafete(UUID), public.revocar_gafete(UUID), public.verificar_gafete(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obtener_gafete(UUID), public.regenerar_gafete(UUID), public.revocar_gafete(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verificar_gafete(TEXT) TO anon, authenticated;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- DESHACER: DROP FUNCTION public.verificar_gafete(TEXT), public.revocar_gafete(UUID), public.regenerar_gafete(UUID),
--                         public.obtener_gafete(UUID), public._gafete_token();  DROP TABLE public.gafetes;
-- ══════════════════════════════════════════════════════════════════════
