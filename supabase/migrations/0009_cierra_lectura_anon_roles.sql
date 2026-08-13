-- ══════════════════════════════════════════════════════════════════════
--  0009 — `roles` era la última tabla legible sin sesión
-- ══════════════════════════════════════════════════════════════════════
--
--  La policy `roles_anon_read` la puse yo para que el ping diario de
--  keepalive tuviera algo que leer. No hace falta: sin filas visibles
--  PostgREST responde igualmente 200 con `[]`, y el workflow solo
--  comprueba el código HTTP. `getRoles()` además solo lo llama admin.js,
--  detrás del guardián de administrador; el registro dejó de pedir rol en
--  la fase 1.
--
--  `roles_select` y `roles_write` son restos legacy concedidos al rol
--  `public` que la limpieza de la 0004 no alcanzó. Son redundantes:
--    roles_select (public, auth.uid() IS NOT NULL) == roles_auth_read
--    roles_write  (public, is_admin())             == roles_admin_write
--
--  Verificado tras aplicarla: anon 0 filas, miembro 8, admin escribe,
--  miembro no. Keepalive sigue en HTTP 200.
-- ══════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS roles_anon_read ON roles;
DROP POLICY IF EXISTS roles_select    ON roles;
DROP POLICY IF EXISTS roles_write     ON roles;

-- DOWN (comentado)
-- CREATE POLICY roles_anon_read ON roles FOR SELECT TO anon USING (activo = true);
