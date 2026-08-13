-- ══════════════════════════════════════════════════════════════════════
--  0010 — revocar EXECUTE a PUBLIC en las funciones de trigger
-- ══════════════════════════════════════════════════════════════════════
--
--  La 0008 revocó a `anon` y `authenticated`, pero no bastaba.
--  PostgreSQL concede EXECUTE a PUBLIC al crear una función, y `anon` lo
--  hereda de ahí. Se ve en el ACL: la entrada `=X/postgres`, sin rol
--  delante, es PUBLIC.
--
--    handle_new_user      =X/postgres | postgres=X/postgres | ...   ← PUBLIC
--    set_periodo_activo   postgres=X/postgres | authenticated=X/... ← sin PUBLIC
--
--  Por eso el revoke de la 0008 sí funcionó en las dos mutadoras y no en
--  estas cuatro.
--
--  Revocar no las desactiva: un trigger se ejecuta sin comprobar el
--  EXECUTE del usuario que hace el DML. Verificado — el trigger
--  anti-escalada sigue bloqueando y un update legítimo del propio perfil
--  sigue permitido.
--
--  QUEDAN ABIERTAS A PROPÓSITO, y el linter las seguirá señalando:
--    is_admin, is_secretario, get_my_distrito, get_district_member_ids,
--    gestion_escribible
--  Las invocan 34 policies, y una policy se evalúa con los privilegios de
--  quien consulta: revocarles EXECUTE rompería las lecturas normales.
--  `is_admin` sola aparece en 27, algunas para el rol `public`, que
--  incluye a anon. A un anónimo le devuelven false / null / [], que es
--  justo lo que deben devolver.
-- ══════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.handle_new_user()                        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.profiles_bloquear_campos_privilegiados() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()                        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at()                       FROM PUBLIC;

-- DOWN (comentado) — restituye el estado anterior.
-- GRANT EXECUTE ON FUNCTION public.handle_new_user()                        TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.profiles_bloquear_campos_privilegiados() TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.rls_auto_enable()                        TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.touch_updated_at()                       TO PUBLIC;
