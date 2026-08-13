-- ══════════════════════════════════════════════════════════════════════
--  0004 — Elimina las policies legacy que anulan a las restrictivas
--  Idempotente. Ejecutar en: Supabase Dashboard → SQL Editor → New query
-- ══════════════════════════════════════════════════════════════════════
--
--  MISMO PATRÓN QUE profiles_select EN LA MIGRACIÓN 0001: quedaron capas
--  antiguas concedidas al rol `public` (que incluye `anon`) por encima de
--  las policies correctas. Como las permisivas se combinan con OR, la
--  antigua gana siempre.
--
--  FUGA 1 — CONFIRMADA EN PRODUCCIÓN, sin sesión:
--    evaldist_select: USING (estado='publicado' OR is_admin() OR <soy secretario>)
--    Concedida a `public`. La primera rama no exige sesión, así que
--      curl -H "apikey: <clave publicable>" \
--        ".../rest/v1/evaluaciones_distrito?estado=eq.publicado"
--    devuelve el ranking completo de los distritos a cualquiera. La clave
--    publicable es pública por diseño: viaja en config.js a todos los
--    navegadores.
--
--  FUGA 2 — evaluaciones.eval_select
--    La rama de secretario NO filtra por estado:
--      ... OR EXISTS (soy secretario y comparto distrito con el evaluado)
--    Es decir, un secretario podía leer evaluaciones en BORRADOR de su
--    distrito, con sus comentarios, antes de publicarlas.
--    evaluaciones_read_secretario sí exige estado='publicado', pero
--    eval_select la anulaba.
--
--  FUGA 3 — trabajos_entregados.trabajos_select
--    ... OR EXISTS (soy secretario)  ← sin comparar distrito
--    Cualquier secretario leía los trabajos de TODOS los usuarios del
--    sistema, no solo los de su distrito.
--
--  No hay cambios de esquema ni de datos: solo se retiran policies.
-- ══════════════════════════════════════════════════════════════════════


-- ── evaluaciones ──────────────────────────────────────────────────────
--  Se conservan: evaluaciones_admin (ALL, authenticated, is_admin),
--  evaluaciones_read_own_published y evaluaciones_read_secretario, que ya
--  cubren todos los casos legítimos y sí exigen estado='publicado'.
DROP POLICY IF EXISTS "eval_select"       ON public.evaluaciones;
DROP POLICY IF EXISTS "eval_insert_admin" ON public.evaluaciones;
DROP POLICY IF EXISTS "eval_update_admin" ON public.evaluaciones;
DROP POLICY IF EXISTS "eval_delete_admin" ON public.evaluaciones;


-- ── evaluaciones_distrito ─────────────────────────────────────────────
--  Se conservan: eval_dist_admin (ALL, authenticated) y eval_dist_read
--  (authenticated, publicado OR admin). Al ser TO authenticated, `anon`
--  deja de tener acceso.
DROP POLICY IF EXISTS "evaldist_select"       ON public.evaluaciones_distrito;
DROP POLICY IF EXISTS "evaldist_insert_admin" ON public.evaluaciones_distrito;
DROP POLICY IF EXISTS "evaldist_update_admin" ON public.evaluaciones_distrito;
DROP POLICY IF EXISTS "evaldist_delete_admin" ON public.evaluaciones_distrito;


-- ── trabajos_entregados ───────────────────────────────────────────────
--  Las legacy cubrían UPDATE y DELETE del propio usuario, así que hay que
--  reponer esa capacidad con policies acotadas a `authenticated` antes de
--  retirarlas: el miembro debe poder editar y borrar sus propios trabajos.
DROP POLICY IF EXISTS "trabajos_update_own" ON public.trabajos_entregados;
CREATE POLICY "trabajos_update_own"
  ON public.trabajos_entregados FOR UPDATE TO authenticated
  USING      (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "trabajos_delete_own" ON public.trabajos_entregados;
CREATE POLICY "trabajos_delete_own"
  ON public.trabajos_entregados FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "trabajos_select" ON public.trabajos_entregados;
DROP POLICY IF EXISTS "trabajos_insert" ON public.trabajos_entregados;
DROP POLICY IF EXISTS "trabajos_update" ON public.trabajos_entregados;
DROP POLICY IF EXISTS "trabajos_delete" ON public.trabajos_entregados;


-- ── VERIFICACIÓN ──────────────────────────────────────────────────────
-- Ninguna policy debe quedar concedida a {public} en estas tablas:
--
--   SELECT tablename, policyname, roles FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename IN ('evaluaciones','evaluaciones_distrito','trabajos_entregados')
--      AND roles::text LIKE '%public%';
--
-- Y sin sesión esto debe devolver [] (antes devolvía el ranking completo):
--
--   curl -H "apikey: <clave publicable>" \
--     ".../rest/v1/evaluaciones_distrito?estado=eq.publicado&select=distrito_id"


-- ══════════════════════════════════════════════════════════════════════
-- -- DOWN (revertir)
-- ══════════════════════════════════════════════════════════════════════
-- NO se incluye la recreación de las policies eliminadas: eran las fugas.
-- Para deshacer solo las añadidas:
--
-- DROP POLICY IF EXISTS "trabajos_update_own" ON public.trabajos_entregados;
-- DROP POLICY IF EXISTS "trabajos_delete_own" ON public.trabajos_entregados;
