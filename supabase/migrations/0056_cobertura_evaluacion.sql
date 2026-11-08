-- ══════════════════════════════════════════════════════════════════════
--  0056 — Cobertura de una evaluación: cuántos criterios se puntuaron de los que aplicaban (hallazgo H-05; PDF §6.3)
-- ══════════════════════════════════════════════════════════════════════
--
--  PROBLEMA
--  En la rúbrica por roles un criterio sin puntuar se EXCLUYE del cálculo (regla de negocio, correcta): el núcleo es la
--  media de lo puntuado y el técnico se pondera solo con lo puntuado. Pero eso renormaliza en silencio y nadie veía
--  «cuántos criterios aplicaban y cuántos se puntuaron». El PDF pide mostrar la cobertura.
--
--  QUÉ HACE
--  `evaluacion_cobertura(periodo, persona)` (SECURITY DEFINER, solo lectura) devuelve, para UNA evaluación:
--    núcleo aplicables/puntuados · técnicos aplicables/puntuados · peso técnico total y peso puntuado.
--  «Aplicable» = criterio de ESCALA vigente que es del núcleo o está en el perfil de la evaluación (el mismo criterio que
--  usa resultados_periodo()). «Puntuado» = su clave está en `evaluaciones.puntajes`.
--  Mismos permisos que resultados_periodo(): administración todo (también borradores); secretaría su distrito y miembro
--  lo suyo, ambos solo de evaluaciones PUBLICADAS. Sin sesión: error.
--
--  QUÉ NO CAMBIA: resultados_periodo() ni ninguna otra función, tabla o política (NO cambia su firma: la leen ~10
--  consumidores). No altera ningún resultado.
--
--  APLICAR después de 0035 (necesita 0015, 0020, 0023). Idempotente. Reversa al final.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.evaluacion_cobertura(p_periodo UUID, p_persona UUID)
RETURNS TABLE (
  nucleo_aplicables  INT,
  nucleo_puntuados   INT,
  tecnico_aplicables INT,
  tecnico_puntuados  INT,
  peso_tecnico       NUMERIC,     -- suma de pesos de los técnicos aplicables (100 en un perfil completo)
  peso_puntuado      NUMERIC,     -- suma de pesos de los técnicos puntuados
  estado             TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_admin   BOOLEAN;
  v_gestion BIGINT;
  e         public.evaluaciones%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  v_admin := public.is_admin();
  IF NOT (v_admin OR p_persona = auth.uid()
          OR (public.is_secretario() AND p_persona IN (SELECT public.get_district_member_ids()))) THEN
    RETURN;     -- sin permiso para esa persona: nada (igual que una persona sin evaluación)
  END IF;

  SELECT * INTO e FROM public.evaluaciones WHERE periodo_id = p_periodo AND evaluado_id = p_persona;
  IF NOT FOUND OR e.modelo <> 'v2' OR e.perfil_id IS NULL THEN RETURN; END IF;
  IF e.estado <> 'publicado' AND NOT v_admin THEN RETURN; END IF;

  SELECT p.gestion_id INTO v_gestion FROM public.periodos_evaluacion p WHERE p.id = p_periodo;

  RETURN QUERY
  WITH apl AS (
    SELECT c.key, c.tipo, pc.peso
      FROM public.criterios_v2 c
      LEFT JOIN public.perfil_criterios pc ON pc.perfil_id = e.perfil_id AND pc.criterio_key = c.key
     WHERE c.gestion_id = v_gestion AND c.activo AND COALESCE(c.tipo_campo, 'escala') = 'escala'
       AND (c.tipo = 'nucleo' OR pc.criterio_key IS NOT NULL)
  )
  SELECT
    (COUNT(*) FILTER (WHERE a.tipo = 'nucleo'))::INT,
    (COUNT(*) FILTER (WHERE a.tipo = 'nucleo' AND e.puntajes ? a.key))::INT,
    (COUNT(*) FILTER (WHERE a.tipo <> 'nucleo'))::INT,
    (COUNT(*) FILTER (WHERE a.tipo <> 'nucleo' AND e.puntajes ? a.key))::INT,
    COALESCE(SUM(a.peso) FILTER (WHERE a.tipo <> 'nucleo'), 0)::NUMERIC,
    COALESCE(SUM(a.peso) FILTER (WHERE a.tipo <> 'nucleo' AND e.puntajes ? a.key), 0)::NUMERIC,
    e.estado
  FROM apl a;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.evaluacion_cobertura(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.evaluacion_cobertura(UUID, UUID) TO authenticated;

-- ── REVERSA ───────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.evaluacion_cobertura(UUID, UUID);
