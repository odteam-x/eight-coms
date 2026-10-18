-- ══════════════════════════════════════════════════════════════════════
--  0036 — Vistas de equipos: listado con indicadores, tareas con avance y resultados del equipo
-- ══════════════════════════════════════════════════════════════════════
--
--  Solo LEEN. Existen para que el listado, el detalle y «Mis equipos» no calculen nada en el navegador (tres pantallas,
--  una definición) y para que el visible de cada persona lo decida la base:
--
--  · equipos_resumen(periodo)        : un equipo por fila, con integrantes y el estado de sus tareas.
--                                      Administración: todos · secretaría: los de su distrito · miembro: los suyos.
--  · tareas_equipo_estado(equipo)    : las tareas colectivas con su AVANCE, aportes y si se pueden revisar.
--  · equipo_resultados(equipo)       : la nota del equipo (cada tarea cuenta UNA vez, no una por integrante) y,
--                                      debajo, lo que aporta a cada persona visible.
--
--  AVANCE de una tarea colectiva (cómo se registra y se lee):
--      aprobada o entregada → 100 % (el trabajo está hecho; falta revisar o ya se revisó)
--      anulada              → sin avance (NULL)
--      el resto             → el último % que reportó un integrante en un aporte de tipo «avance» (0 si nadie reportó)
--  El avance reportado nunca sustituye al estado: una tarea no está terminada hasta que se ENTREGA (estado persistido).
--
--  Requiere 0031–0035. Aplicación manual en el SQL Editor. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.tarea_equipo_avance(p_tarea BIGINT)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
           WHEN t.estado IN ('aprobada','entregada') THEN 100
           WHEN t.estado = 'anulada' THEN NULL
           ELSE COALESCE((SELECT a.avance FROM tarea_equipo_aportes a
                           WHERE a.tarea_id = t.id AND a.tipo = 'avance' AND a.avance IS NOT NULL
                           ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 0)
         END
    FROM tareas_equipo t WHERE t.id = p_tarea;
$$;
REVOKE EXECUTE ON FUNCTION public.tarea_equipo_avance(BIGINT) FROM PUBLIC, anon, authenticated;

-- ── 1. Listado ────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.equipos_resumen(UUID);
CREATE FUNCTION public.equipos_resumen(p_periodo UUID DEFAULT NULL)
RETURNS TABLE (
  equipo_id BIGINT, periodo_id UUID, periodo_nombre TEXT, nombre TEXT, descripcion TEXT, estado TEXT, distrito TEXT,
  responsable_id UUID, responsable_nombre TEXT, integrantes INT, soy_integrante BOOLEAN,
  tareas_total INT, tareas_abiertas INT, tareas_por_revisar INT, tareas_vencidas INT, tareas_aprobadas INT,
  avance_promedio NUMERIC, alertas INT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT e.id, e.periodo_id, pe.nombre, e.nombre, e.descripcion, e.estado, e.distrito,
         e.responsable_id, COALESCE(NULLIF(rp.nombre, ''), rp.email),
         (SELECT COUNT(*)::INT FROM equipo_miembros m WHERE m.equipo_id = e.id AND m.hasta IS NULL),
         public.es_integrante_equipo(e.id),
         (SELECT COUNT(*)::INT FROM tareas_equipo t WHERE t.equipo_id = e.id AND t.estado <> 'anulada'),
         (SELECT COUNT(*)::INT FROM tareas_equipo t WHERE t.equipo_id = e.id AND t.estado IN ('asignada','en_curso','bloqueada','devuelta')),
         (SELECT COUNT(*)::INT FROM tareas_equipo t WHERE t.equipo_id = e.id AND t.estado = 'entregada'),
         (SELECT COUNT(*)::INT FROM tareas_equipo t WHERE t.equipo_id = e.id AND t.estado IN ('asignada','en_curso') AND t.entregada_en IS NULL
             AND t.fecha_limite IS NOT NULL AND t.fecha_limite < (NOW() AT TIME ZONE public.zona_periodo(e.periodo_id))::DATE),
         (SELECT COUNT(*)::INT FROM tareas_equipo t WHERE t.equipo_id = e.id AND t.estado = 'aprobada'),
         (SELECT ROUND(AVG(public.tarea_equipo_avance(t.id)), 0) FROM tareas_equipo t WHERE t.equipo_id = e.id AND t.estado <> 'anulada'),
         CASE WHEN public.is_admin() OR public.equipo_de_mi_distrito(e.id) THEN
           (SELECT COUNT(*)::INT FROM equipo_miembros m JOIN profiles pf ON pf.id = m.persona_id
             WHERE m.equipo_id = e.id AND m.hasta IS NULL
               AND (NOT COALESCE(pf.aprobado, true)
                    OR EXISTS (SELECT 1 FROM periodo_participantes pp WHERE pp.periodo_id = e.periodo_id AND pp.user_id = m.persona_id AND NOT pp.activo)
                    OR (e.distrito IS NOT NULL AND pf.distrito IS DISTINCT FROM e.distrito AND NOT m.excepcion)))
         ELSE 0 END,
         e.created_at, e.updated_at
    FROM equipos e
    JOIN periodos_evaluacion pe ON pe.id = e.periodo_id
    LEFT JOIN profiles rp ON rp.id = e.responsable_id
   WHERE (p_periodo IS NULL OR e.periodo_id = p_periodo)
     AND public.equipo_visible(e.id)
   ORDER BY (e.estado = 'archivado'), (e.estado = 'inactivo'), e.nombre;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipos_resumen(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.equipos_resumen(UUID) TO authenticated;

-- ── 2. Tareas colectivas con su avance ────────────────────────────────
--  p_equipo NULL = todas las que la persona puede ver (para «Mis tareas»). Una fila por tarea.
DROP FUNCTION IF EXISTS public.tareas_equipo_estado(BIGINT, UUID);
CREATE FUNCTION public.tareas_equipo_estado(p_equipo BIGINT DEFAULT NULL, p_periodo UUID DEFAULT NULL)
RETURNS TABLE (
  tarea_id BIGINT, equipo_id BIGINT, equipo_nombre TEXT, periodo_id UUID, titulo TEXT, descripcion TEXT, instrucciones TEXT,
  criterios_evaluacion TEXT, criterios TEXT[], prioridad TEXT, estado TEXT, fecha_limite DATE, fecha_limite_original DATE,
  asignada_en TIMESTAMPTZ, responsable_id UUID, responsable_nombre TEXT, avance INT, participantes INT, aportes INT,
  entrega_url TEXT, entrega_nota TEXT, entregada_por UUID, entregada_por_nombre TEXT, entregada_en TIMESTAMPTZ,
  revision_nota TEXT, bloqueo_motivo TEXT, rondas_revision INT, puntos SMALLINT, puntos_original SMALLINT, peso NUMERIC,
  nota_anulada BOOLEAN, aprobada_en TIMESTAMPTZ, vencida BOOLEAN, soy_participante BOOLEAN, puedo_revisar BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT t.id, t.equipo_id, e.nombre, t.periodo_id, t.titulo, t.descripcion, t.instrucciones, t.criterios_evaluacion, t.criterios,
         t.prioridad, t.estado, t.fecha_limite, t.fecha_limite_original, t.asignada_en, t.responsable_id,
         COALESCE(NULLIF(rp.nombre, ''), rp.email), public.tarea_equipo_avance(t.id),
         (SELECT COUNT(*)::INT FROM tarea_equipo_participantes p WHERE p.tarea_id = t.id AND p.hasta IS NULL),
         (SELECT COUNT(*)::INT FROM tarea_equipo_aportes a WHERE a.tarea_id = t.id),
         t.entrega_url, t.entrega_nota, t.entregada_por, COALESCE(NULLIF(ep.nombre, ''), ep.email), t.entregada_en,
         t.revision_nota, t.bloqueo_motivo, t.rondas_revision, t.puntos, t.puntos_original, t.peso,
         (t.nota_anulada_en IS NOT NULL), t.aprobada_en,
         (t.estado IN ('asignada','en_curso') AND t.entregada_en IS NULL AND t.fecha_limite IS NOT NULL
            AND t.fecha_limite < (NOW() AT TIME ZONE public.zona_periodo(t.periodo_id))::DATE),
         public.soy_participante_tarea_equipo(t.id, true), public.puede_revisar_tarea_equipo(t.id)
    FROM tareas_equipo t
    JOIN equipos e ON e.id = t.equipo_id
    LEFT JOIN profiles rp ON rp.id = t.responsable_id
    LEFT JOIN profiles ep ON ep.id = t.entregada_por
   WHERE (p_equipo IS NULL OR t.equipo_id = p_equipo)
     AND (p_periodo IS NULL OR t.periodo_id = p_periodo)
     AND public.tarea_equipo_visible(t.id)
   ORDER BY (t.estado IN ('aprobada','anulada')), t.fecha_limite NULLS LAST, t.id DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_equipo_estado(BIGINT, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tareas_equipo_estado(BIGINT, UUID) TO authenticated;

-- ── 3. Resultados del equipo ──────────────────────────────────────────
--  La fila con persona_id NULL es el EQUIPO: promedio ponderado de sus tareas calificadas, cada tarea UNA vez
--  (peso = peso de la tarea; no se multiplica por integrante ni por el multiplicador de colectivas, que es una
--  regla para el resultado de las PERSONAS). Las demás filas son lo que esas tareas aportan a cada persona visible
--  (con las notas individuales dentro del grupo, si las hubo).
DROP FUNCTION IF EXISTS public.equipo_resultados(BIGINT);
CREATE FUNCTION public.equipo_resultados(p_equipo BIGINT)
RETURNS TABLE (persona_id UUID, nombre TEXT, tareas_cuentan INT, tareas_total INT, nota NUMERIC, con_nota_individual INT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_periodo UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  IF NOT public.equipo_visible(p_equipo) THEN RETURN; END IF;
  SELECT e.periodo_id INTO v_periodo FROM equipos e WHERE e.id = p_equipo;

  RETURN QUERY
  SELECT NULL::UUID, 'Equipo'::TEXT,
         (COUNT(*) FILTER (WHERE t.estado = 'aprobada' AND t.puntos IS NOT NULL AND t.nota_anulada_en IS NULL))::INT,
         (COUNT(*) FILTER (WHERE t.estado <> 'anulada'))::INT,
         ROUND(100 * SUM(t.peso * t.puntos / 10.0) FILTER (WHERE t.estado = 'aprobada' AND t.puntos IS NOT NULL AND t.nota_anulada_en IS NULL)
               / NULLIF(SUM(t.peso) FILTER (WHERE t.estado = 'aprobada' AND t.puntos IS NOT NULL AND t.nota_anulada_en IS NULL), 0), 1),
         0
    FROM tareas_equipo t WHERE t.equipo_id = p_equipo
  UNION ALL
  SELECT i.persona_id, COALESCE(NULLIF(pf.nombre, ''), pf.email),
         (COUNT(*) FILTER (WHERE i.cuenta))::INT,
         (COUNT(*) FILTER (WHERE i.razon NOT IN ('tarea_anulada','no_participa')))::INT,
         ROUND(100 * SUM(i.peso_tarea * COALESCE(i.puntos, 0) / 10.0) FILTER (WHERE i.cuenta)
               / NULLIF(SUM(i.peso_tarea) FILTER (WHERE i.cuenta), 0), 1),
         (COUNT(*) FILTER (WHERE i.cuenta AND i.individual_en_grupo))::INT
    FROM public.calif_items(v_periodo) i
    JOIN profiles pf ON pf.id = i.persona_id
   WHERE i.tipo = 'equipo' AND i.equipo_id = p_equipo AND public.calif_puede_ver(i.persona_id)
   GROUP BY i.persona_id, pf.nombre, pf.email;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipo_resultados(BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.equipo_resultados(BIGINT) TO authenticated;

COMMIT;
