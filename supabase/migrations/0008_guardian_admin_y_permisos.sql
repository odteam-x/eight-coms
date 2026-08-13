-- ══════════════════════════════════════════════════════════════════════
--  0008 — el guardián de admin estaba invertido, y permisos de EXECUTE
-- ══════════════════════════════════════════════════════════════════════
--
--  EL FALLO (introducido por mí en 0003 y 0005)
--
--    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
--      RAISE EXCEPTION 'Solo el administrador...';
--    END IF;
--
--  El prefijo `auth.uid() IS NOT NULL AND` invierte el sentido de la
--  comprobación: SIN sesión la condición entera es falsa y la función
--  continúa. Bloqueaba al usuario autenticado no administrador y dejaba
--  pasar al anónimo, que es justo al revés.
--
--  Verificado contra la base: con el rol `anon` y sin claims,
--  `set_periodo_activo(null)` se ejecutaba sin error.
--
--  IMPACTO — ambas cosas con solo la anon key, que es pública:
--    · set_periodo_activo(null) deja la gestión sin período activo, así
--      que el portal se queda sin PE en curso.
--    · set_periodo_activo(<uuid>) cambia el período activo a voluntad.
--    · abrir_gestion('x') archiva la gestión en curso y crea otra,
--      clonando criterios, rúbrica, calendario y períodos.
--
--  LA CORRECCIÓN
--  El guardián pasa a exigir administrador y punto:
--
--    IF NOT public.is_admin() THEN RAISE EXCEPTION ...
--
--  Se retira el escape para migraciones. No hace falta —ninguna migración
--  llama a estas funciones— y además no funcionaba: dentro de una función
--  SECURITY DEFINER, `current_user` es el DUEÑO de la función, no quien
--  llama, así que cualquier comprobación sobre current_user da siempre
--  verdadero. Una migración que necesite el efecto hace el UPDATE directo.
--
--  DEFENSA EN PROFUNDIDAD
--  Además se revoca EXECUTE:
--    · a `anon` en las dos mutadoras — sin sesión nunca es legítimo
--    · a `anon` y `authenticated` en las cuatro funciones de trigger, que
--      no están pensadas para llamarse por RPC. Un trigger se ejecuta sin
--      comprobar el EXECUTE del usuario que hace el DML, así que revocar
--      no los desactiva (verificado: la escalada de privilegios sigue
--      bloqueada después).
--
--  NO se tocan is_admin, is_secretario, get_my_distrito,
--  get_district_member_ids ni gestion_escribible: las usan 34 policies,
--  y una policy se evalúa con los privilegios de quien consulta. Revocar
--  EXECUTE ahí rompería las lecturas normales. `is_admin` sola aparece en
--  27, algunas para el rol `public`, que incluye a anon.
--
--  Idempotente: CREATE OR REPLACE y REVOKE son repetibles.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. set_periodo_activo ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_periodo_activo(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_gestion BIGINT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede cambiar el periodo activo.' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    UPDATE periodos_evaluacion SET activo = false
     WHERE activo AND gestion_id = (SELECT id FROM gestiones WHERE activa LIMIT 1);
    RETURN;
  END IF;

  SELECT gestion_id INTO v_gestion FROM periodos_evaluacion WHERE id = p_id;
  IF v_gestion IS NULL THEN
    RAISE EXCEPTION 'No existe el periodo %', p_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE periodos_evaluacion SET activo = false
   WHERE activo AND gestion_id = v_gestion AND id <> p_id;
  UPDATE periodos_evaluacion SET activo = true WHERE id = p_id;
END;
$function$;

-- ── 2. abrir_gestion ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.abrir_gestion(p_nombre text, p_clonar_de bigint DEFAULT NULL::bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_id     BIGINT;
  v_origen BIGINT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede abrir una gestion.' USING ERRCODE = '42501';
  END IF;

  v_origen := COALESCE(p_clonar_de, (SELECT id FROM gestiones WHERE activa LIMIT 1));

  UPDATE gestiones SET activa = false, archivada = true WHERE activa;

  INSERT INTO gestiones (nombre, activa, archivada)
  VALUES (p_nombre, true, false)
  RETURNING id INTO v_id;

  IF v_origen IS NOT NULL THEN
    WITH nuevos AS (
      INSERT INTO criterios (gestion_id, key, label, abbr, color, orden, activo, max)
      SELECT v_id, key, label, abbr, color, orden, activo, max
        FROM criterios WHERE gestion_id = v_origen
      RETURNING id, key
    )
    INSERT INTO rubrica (gestion_id, criterio_id, criterio, nivel4, nivel3, nivel2, nivel1, orden)
    SELECT v_id, n.id, r.criterio, r.nivel4, r.nivel3, r.nivel2, r.nivel1, r.orden
      FROM rubrica r
      JOIN criterios c ON c.id = r.criterio_id
      JOIN nuevos    n ON n.key = c.key
     WHERE r.gestion_id = v_origen;

    INSERT INTO calendario (gestion_id, numero, titulo, descripcion, color, estado)
    SELECT v_id, numero, titulo, descripcion, color, 'Pendiente'
      FROM calendario WHERE gestion_id = v_origen;

    INSERT INTO periodos_evaluacion (gestion_id, nombre, descripcion, activo)
    SELECT v_id, nombre, descripcion, false
      FROM periodos_evaluacion WHERE gestion_id = v_origen;
  END IF;

  RETURN v_id;
END;
$function$;

-- ── 3. touch_updated_at: search_path fijo ─────────────────────────────
-- Sin search_path, un esquema temporal en el camino de búsqueda puede
-- secuestrar los nombres que la función resuelve.
ALTER FUNCTION public.touch_updated_at() SET search_path TO 'public';

-- ── 4. EXECUTE ────────────────────────────────────────────────────────
-- Mutadoras: nunca legítimas sin sesión.
REVOKE EXECUTE ON FUNCTION public.set_periodo_activo(uuid)    FROM anon;
REVOKE EXECUTE ON FUNCTION public.abrir_gestion(text, bigint) FROM anon;

-- Funciones de trigger: no se llaman por RPC. Un trigger se ejecuta sin
-- comprobar el EXECUTE del usuario que hace el DML.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.profiles_bloquear_campos_privilegiados() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()                        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at()                       FROM anon, authenticated;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- DOWN (comentado) — restituye el estado anterior, agujero incluido.
-- Solo tiene sentido para depurar; no se ejecuta en producción.
-- ══════════════════════════════════════════════════════════════════════
-- BEGIN;
-- GRANT EXECUTE ON FUNCTION public.set_periodo_activo(uuid)    TO anon;
-- GRANT EXECUTE ON FUNCTION public.abrir_gestion(text, bigint) TO anon;
-- GRANT EXECUTE ON FUNCTION public.handle_new_user()                        TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.profiles_bloquear_campos_privilegiados() TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.rls_auto_enable()                        TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.touch_updated_at()                       TO anon, authenticated;
-- COMMIT;
