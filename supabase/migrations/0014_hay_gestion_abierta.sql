-- ══════════════════════════════════════════════════════════════════════
--  0014 — ¿hay alguna gestión abierta? Solo el booleano.
-- ══════════════════════════════════════════════════════════════════════
--
--  registro.html tiene que cerrar el formulario cuando no hay ninguna
--  gestión activa. Pero quien visita esa página NO tiene sesión, y la
--  tabla `gestiones` no es legible para `anon`: `API.getGestiones()` le
--  devuelve `[]`, así que la comprobación "¿alguna activa?" habría dado
--  false SIEMPRE y el registro habría quedado cerrado para todo el mundo.
--
--  Verificado contra la API antes de escribir esto:
--    GET /rest/v1/gestiones?select=id,activa  →  HTTP 200  []
--
--  La función expone UN booleano y nada más: ni nombres, ni fechas, ni
--  cuántas gestiones hay. Es el mínimo que la página necesita para decidir.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.hay_gestion_abierta()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM gestiones WHERE activa);
$$;

REVOKE EXECUTE ON FUNCTION public.hay_gestion_abierta() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.hay_gestion_abierta() TO anon, authenticated;

-- DOWN (comentado)
-- DROP FUNCTION IF EXISTS public.hay_gestion_abierta();
