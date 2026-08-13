-- ══════════════════════════════════════════════════════════════════════
--  0002 — Elimina la tabla `credenciales`
--  Idempotente. Ejecutar en: Supabase Dashboard → SQL Editor → New query
-- ══════════════════════════════════════════════════════════════════════
--
--  La tabla guarda contraseñas en texto plano:
--      credenciales(user_id UUID, email TEXT, clave TEXT, updated_at TIMESTAMPTZ)
--
--  El comentario del esquema original decía que existía «para que el admin
--  pueda consultarla». Supabase Auth ya hashea las contraseñas con bcrypt;
--  esta copia solo añade superficie de robo. Además la policy `cred_insert`
--  permitía a CUALQUIER usuario autenticado insertar su propia fila.
--
--  ⚠ DESTRUCTIVO E IRREVERSIBLE: en el momento de escribir esta migración la
--  tabla contiene 1 fila. Al borrarla se pierde esa contraseña en claro — que
--  es justamente el objetivo. No hay backfill posible ni deseable.
--
--  ⚠ ACCIÓN HUMANA REQUERIDA: la contraseña de esa persona estuvo almacenada
--  en claro y legible por cualquier admin. Pídele que la cambie desde
--  «¿Olvidaste tu contraseña?» en index.html ANTES o DESPUÉS de correr esto.
--  Borrar la tabla elimina la copia, no invalida la contraseña.
-- ══════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS public.credenciales CASCADE;


-- ── VERIFICACIÓN ──────────────────────────────────────────────────────
-- Debe devolver 0 filas:
--
--   SELECT tablename FROM pg_tables
--    WHERE schemaname='public' AND tablename='credenciales';
--
-- Debe devolver 0 filas (las policies caen con la tabla):
--
--   SELECT policyname FROM pg_policies
--    WHERE schemaname='public' AND tablename='credenciales';


-- ══════════════════════════════════════════════════════════════════════
-- -- DOWN (revertir)
-- ══════════════════════════════════════════════════════════════════════
-- Se puede recrear la estructura, pero NO los datos, y hacerlo reintroduce
-- la vulnerabilidad. Incluido solo por completitud del formato de migración:
--
-- CREATE TABLE IF NOT EXISTS public.credenciales (
--   user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
--   email      TEXT,
--   clave      TEXT,
--   updated_at TIMESTAMPTZ DEFAULT NOW()
-- );
-- ALTER TABLE public.credenciales ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "cred_admin" ON public.credenciales FOR ALL TO authenticated
--   USING (public.is_admin()) WITH CHECK (public.is_admin());
