-- ══════════════════════════════════════════════════════════════════════
--  0044 — Manuales privados: el manual de administración solo lo lee la administración
-- ══════════════════════════════════════════════════════════════════════
--
--  EL PROBLEMA. Todo el sitio es estático: cualquier archivo del repositorio (también ayuda/admin.html) lo sirve Vercel a
--  quien conozca la dirección, con o sin sesión. Esconder el manual con JavaScript no protege nada: el contenido va en el
--  HTML que cualquiera descarga.
--
--  LA SOLUCIÓN. El texto del manual deja de estar en el sitio. Vive en esta tabla y solo la administración puede leerlo
--  (RLS: is_admin()). ayuda/admin.html es ahora una carcasa vacía que, tras comprobar la sesión, pide el contenido a la base.
--  Sin sesión de administración, la base no entrega ni una letra.
--
--  QUIÉN ESCRIBE. Nadie desde el portal: no hay políticas de INSERT/UPDATE/DELETE. El contenido se publica desde el SQL Editor
--  (o por la conexión de Supabase) con el archivo que genera `node tools/generar-manuales.mjs` en .manuales-privados/ (no se
--  versiona ni se despliega): ver CLAUDE.md, «Manuales privados».
--
--  Aplicación manual en el SQL Editor. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.manuales_privados (
  slug           TEXT PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{1,40}$'),
  titulo         TEXT NOT NULL DEFAULT '',
  html           TEXT NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.manuales_privados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manuales_privados FROM anon, authenticated;
GRANT SELECT ON public.manuales_privados TO authenticated;

DROP POLICY IF EXISTS manuales_privados_leer ON public.manuales_privados;
CREATE POLICY manuales_privados_leer ON public.manuales_privados FOR SELECT TO authenticated
  USING (public.is_admin());

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- DESHACER: DROP TABLE public.manuales_privados;  (y volver a generar los manuales con la versión anterior del generador)
-- ══════════════════════════════════════════════════════════════════════
