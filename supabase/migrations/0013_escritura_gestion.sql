-- ══════════════════════════════════════════════════════════════════════
--  0013 — no se puede escribir en una gestión archivada
-- ══════════════════════════════════════════════════════════════════════
--
--  EL AGUJERO
--  API._gid() devuelve _gestionActual, que setGestion() fija desde
--  ?gestion= en la URL. Si esa gestión está archivada, savePeriodo,
--  saveCriterio, saveRubricaRow, saveCalEvento y saveConfig insertaban
--  DENTRO de la gestión archivada. gestion_escribible() solo cubría
--  evaluaciones, evaluaciones_distrito y trabajos_entregados.
--
--  Y ADEMÁS, DOS POLICIES POR TABLA
--  Cada una de las cinco tablas tenía la suya nueva (`*_admin_write`) y
--  una legacy (`cal_write`, `cfg_write`, `crit_write`, `pe_write`,
--  `rub_write`) que la limpieza de la 0004 no alcanzó. Las legacy están
--  concedidas al rol `public` y tienen WITH CHECK **nulo**, así que
--  reutilizan su USING — que es solo `is_admin()`.
--
--  Como las policies permisivas se combinan con OR, añadir la condición
--  únicamente a la nueva no habría servido de nada: la legacy seguiría
--  autorizando el INSERT. Es exactamente la trampa que documenta
--  CLAUDE.md. Por eso primero se eliminan.
--
--  Son redundantes: `is_admin()` sin WITH CHECK es un subconjunto de la
--  nueva, así que eliminarlas no quita ninguna capacidad.
--
--  RLS ES LA FRONTERA
--  El cliente deshabilita los controles cuando ctx.soloLectura es true,
--  pero eso es ergonomía. Quien la salte se topa con esto.
--
--  Idempotente: DROP POLICY IF EXISTS antes de cada CREATE.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Fuera las legacy con WITH CHECK nulo ───────────────────────────
DROP POLICY IF EXISTS pe_write   ON periodos_evaluacion;
DROP POLICY IF EXISTS crit_write ON criterios;
DROP POLICY IF EXISTS rub_write  ON rubrica;
DROP POLICY IF EXISTS cal_write  ON calendario;
DROP POLICY IF EXISTS cfg_write  ON config;

-- ── 2. ¿Está escribible la gestión a la que pertenece la fila? ────────
-- Distinta de gestion_escribible(periodo_id): estas cinco tablas llevan
-- gestion_id directamente, sin pasar por un período.
CREATE OR REPLACE FUNCTION public.gestion_id_escribible(p_gestion_id BIGINT)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT NOT archivada FROM gestiones WHERE id = p_gestion_id),
    false            -- una gestión que no existe no es escribible
  );
$$;

REVOKE EXECUTE ON FUNCTION public.gestion_id_escribible(BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.gestion_id_escribible(BIGINT) TO authenticated;

-- ── 3. Las policies de admin exigen gestión no archivada ──────────────
DROP POLICY IF EXISTS periodos_admin_write ON periodos_evaluacion;
CREATE POLICY periodos_admin_write ON periodos_evaluacion
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin() AND public.gestion_id_escribible(gestion_id));

DROP POLICY IF EXISTS criterios_admin_write ON criterios;
CREATE POLICY criterios_admin_write ON criterios
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin() AND public.gestion_id_escribible(gestion_id));

DROP POLICY IF EXISTS rubrica_admin_write ON rubrica;
CREATE POLICY rubrica_admin_write ON rubrica
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin() AND public.gestion_id_escribible(gestion_id));

DROP POLICY IF EXISTS calendario_admin_write ON calendario;
CREATE POLICY calendario_admin_write ON calendario
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin() AND public.gestion_id_escribible(gestion_id));

DROP POLICY IF EXISTS config_admin_write ON config;
CREATE POLICY config_admin_write ON config
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin() AND public.gestion_id_escribible(gestion_id));

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- DOWN (comentado) — deja de nuevo escribible la gestión archivada.
-- ══════════════════════════════════════════════════════════════════════
-- BEGIN;
-- DROP POLICY IF EXISTS periodos_admin_write  ON periodos_evaluacion;
-- CREATE POLICY periodos_admin_write  ON periodos_evaluacion FOR ALL TO authenticated
--   USING (public.is_admin()) WITH CHECK (public.is_admin());
-- -- … ídem para criterios, rubrica, calendario y config.
-- DROP FUNCTION IF EXISTS public.gestion_id_escribible(BIGINT);
-- COMMIT;
