-- ══════════════════════════════════════════════════════════════════════
--  0051 — Reporte general: equipos, tareas colectivas y la nota de tareas integrada (fase 2 de 0050)
-- ══════════════════════════════════════════════════════════════════════
--
--  Redefine reporte_general_pe() (0050) para leer lo que añadieron 0031–0036, SIN recalcular nada:
--     · el resultado de cada persona (suma_resultado, n_resultados…) sigue saliendo de seguimiento_global() →
--       resultados_periodo(), que desde 0035 YA incluye la nota de tareas (individual = evaluación + tareas);
--       por eso el reporte cambia solo cuando la fórmula del PE cambia. Se agrega, para entender el origen:
--       cuántas personas tienen nota de tareas (n_nota_tareas, suma_nota_tareas) y la regla del PE
--       (peso_tareas_regla, regla_confirmada: leída de periodo_calif_config, no recalculada);
--     · tareas individuales: ya NO cuentan las anuladas (misma definición que seguimiento_global desde 0035);
--       se informan aparte (tareas_anuladas);
--     · EQUIPOS: los que equipo_visible() deja ver a quien llama, los activos y las personas DISTINTAS vigentes
--       dentro del alcance (una persona en dos equipos cuenta una vez);
--     · TAREAS COLECTIVAS: UNA fila por tarea de equipo (tareas_equipo), NUNCA una por integrante. Se informan
--       separadas de las individuales (colectivas_*); el front las suma para el total de «unidades de tarea» y
--       lo dice. Las anuladas quedan fuera de todo conteo y se informan aparte.
--
--  ALCANCE de equipos y colectivas: los equipos que equipo_visible() deja ver (administración: todos; secretaría:
--  los de su distrito o con integrantes suyos; miembro: los propios). Con un filtro de distrito o de rol solo
--  entran los equipos con al menos un integrante vigente dentro de ese filtro; y las personas que se cuentan son
--  solo las del alcance, nunca las de otro distrito que compartan el equipo.
--
--  Requiere 0050 y 0031–0036. Aplicación manual en el SQL Editor. Idempotente. Solo lee.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.reporte_general_pe(BIGINT, TEXT, BIGINT);
CREATE FUNCTION public.reporte_general_pe(
  p_gestion  BIGINT DEFAULT NULL,
  p_distrito TEXT   DEFAULT NULL,
  p_rol      BIGINT DEFAULT NULL
)
RETURNS TABLE (
  periodo_id UUID, periodo_nombre TEXT, descripcion TEXT, orden INT, modelo TEXT, activo BOOLEAN,
  fecha_inicio DATE, fecha_fin_trabajo DATE, fecha_entrega DATE, fecha_jornada DATE, estado_pe TEXT,
  vista TEXT,
  personas INT, participan INT, no_participan INT,
  eval_publicadas INT, eval_no_publicadas INT, eval_sin_evaluar INT,
  n_resultados INT, suma_resultado NUMERIC,
  n_nucleo INT, suma_nucleo NUMERIC, n_tecnico INT, suma_tecnico NUMERIC,
  tareas_aplican BOOLEAN,
  tareas_total INT, tareas_asignadas INT, tareas_propias INT,
  tareas_abiertas INT, tareas_en_revision INT, tareas_aprobadas INT,
  tareas_devueltas INT, tareas_bloqueadas INT, tareas_vencidas INT,
  tareas_entregadas INT, con_plazo INT, a_tiempo INT, puntos_suma INT, puntos_n INT,
  actividades_con_tareas INT, tareas_en_actividades INT, tareas_en_actividades_aprobadas INT,
  -- 0051
  tareas_anuladas INT,
  colectivas_total INT, colectivas_abiertas INT, colectivas_en_revision INT, colectivas_aprobadas INT,
  colectivas_vencidas INT, colectivas_anuladas INT, colectivas_con_plazo INT, colectivas_a_tiempo INT,
  equipos_total INT, equipos_activos INT, equipos_integrantes INT,
  n_nota_tareas INT, suma_nota_tareas NUMERIC, peso_tareas_regla NUMERIC, regla_confirmada BOOLEAN,
  por_distrito JSONB, por_rol JSONB,
  g_personas INT, g_participan_alguno INT, g_con_publicada INT,
  generado_en TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
#variable_conflict use_column
DECLARE
  v_admin BOOLEAN; v_sec BOOLEAN; v_gestion BIGINT; v_vista TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501';
  END IF;
  v_admin := public.is_admin();
  v_sec   := public.is_secretario();
  v_gestion := COALESCE(p_gestion, (SELECT g.id FROM gestiones g WHERE g.activa ORDER BY g.id DESC LIMIT 1));
  IF v_gestion IS NULL THEN RETURN; END IF;
  v_vista := CASE WHEN v_admin THEN 'todo' WHEN v_sec THEN 'distrito' ELSE 'propio' END;

  RETURN QUERY
  WITH per AS (
    SELECT pe.id, pe.nombre, pe.descripcion, pe.modelo, COALESCE(pe.activo, false) AS activo,
           pe.fecha_inicio, pe.fecha_fin_trabajo, pe.fecha_entrega, pe.fecha_jornada,
           (ROW_NUMBER() OVER (ORDER BY pe.created_at, pe.id))::INT AS orden,
           (NOW() AT TIME ZONE public.zona_periodo(pe.id))::DATE AS hoy,
           COALESCE(pe.fecha_jornada, pe.fecha_entrega, pe.fecha_fin_trabajo, pe.fecha_inicio) AS fin
      FROM periodos_evaluacion pe WHERE pe.gestion_id = v_gestion
  ),
  s AS (
    SELECT sg.*
      FROM public.seguimiento_global(v_gestion) sg
     WHERE (p_distrito IS NULL OR sg.distrito = p_distrito OR (p_distrito = '' AND sg.distrito IS NULL))
       AND (p_rol IS NULL OR sg.rol_id = p_rol)
  ),
  quienes AS (SELECT DISTINCT s.persona_id FROM s),
  ag AS (
    SELECT s.periodo_id,
           COUNT(*)::INT AS personas,
           COUNT(*) FILTER (WHERE s.participa)::INT AS participan,
           COUNT(*) FILTER (WHERE NOT s.participa)::INT AS no_participan,
           COUNT(*) FILTER (WHERE s.participa AND s.estado_eval = 'publicado')::INT AS publicadas,
           COUNT(*) FILTER (WHERE s.participa AND s.estado_eval IN ('borrador','sin_publicar'))::INT AS no_publicadas,
           COUNT(*) FILTER (WHERE s.participa AND s.estado_eval = 'sin_evaluar')::INT AS sin_evaluar,
           COUNT(*) FILTER (WHERE s.participa AND s.estado_eval = 'publicado'
                              AND (CASE WHEN s.modelo = 'v2' THEN s.individual ELSE s.total_clasico END) IS NOT NULL)::INT AS n_res,
           COALESCE(SUM(CASE WHEN s.modelo = 'v2' THEN s.individual ELSE s.total_clasico END)
                    FILTER (WHERE s.participa AND s.estado_eval = 'publicado'), 0) AS suma_res,
           COUNT(*) FILTER (WHERE s.participa AND s.estado_eval = 'publicado' AND s.nucleo IS NOT NULL)::INT AS n_nuc,
           COALESCE(SUM(s.nucleo)  FILTER (WHERE s.participa AND s.estado_eval = 'publicado'), 0) AS suma_nuc,
           COUNT(*) FILTER (WHERE s.participa AND s.estado_eval = 'publicado' AND s.tecnico IS NOT NULL)::INT AS n_tec,
           COALESCE(SUM(s.tecnico) FILTER (WHERE s.participa AND s.estado_eval = 'publicado'), 0) AS suma_tec,
           COUNT(*) FILTER (WHERE s.participa AND s.estado_eval = 'publicado' AND s.tareas_nota IS NOT NULL)::INT AS n_nota,
           COALESCE(SUM(s.tareas_nota) FILTER (WHERE s.participa AND s.estado_eval = 'publicado'), 0) AS suma_nota,
           SUM(s.tareas_total)::INT AS t_total, SUM(s.tareas_abiertas)::INT AS t_abiertas,
           SUM(s.tareas_vencidas)::INT AS t_vencidas, SUM(s.tareas_aprobadas)::INT AS t_aprobadas,
           SUM(s.con_plazo)::INT AS t_con_plazo, SUM(s.a_tiempo)::INT AS t_a_tiempo,
           SUM(s.puntos_suma)::INT AS t_puntos_suma, SUM(s.puntos_n)::INT AS t_puntos_n
      FROM s GROUP BY s.periodo_id
  ),
  -- Tareas individuales: lo que seguimiento_global() no desglosa. Las anuladas se informan aparte.
  tk AS (
    SELECT t.periodo_id,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.estado <> 'anulada')::INT AS asignadas,
           COUNT(*) FILTER (WHERE t.origen = 'propia' AND t.estado <> 'anulada')::INT AS propias,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.estado <> 'anulada' AND t.entregada_en IS NOT NULL)::INT AS entregadas,
           COUNT(*) FILTER (WHERE t.estado = 'entregada')::INT AS en_revision,
           COUNT(*) FILTER (WHERE t.estado = 'devuelta')::INT AS devueltas,
           COUNT(*) FILTER (WHERE t.estado = 'bloqueada')::INT AS bloqueadas,
           COUNT(*) FILTER (WHERE t.estado = 'anulada')::INT AS anuladas,
           COUNT(DISTINCT t.actividad_id) FILTER (WHERE t.estado <> 'anulada')::INT AS actividades,
           COUNT(*) FILTER (WHERE t.actividad_id IS NOT NULL AND t.estado <> 'anulada')::INT AS en_actividades,
           COUNT(*) FILTER (WHERE t.actividad_id IS NOT NULL AND t.estado = 'aprobada')::INT AS en_actividades_aprobadas
      FROM tareas t JOIN per ON per.id = t.periodo_id
     WHERE t.asignada_a IN (SELECT q.persona_id FROM quienes q)
     GROUP BY t.periodo_id
  ),
  -- Equipos que quien llama puede ver (y, con filtro, los que tienen a alguien del filtro).
  eq AS (
    SELECT e.id, e.periodo_id, e.estado
      FROM equipos e JOIN per ON per.id = e.periodo_id
     WHERE public.equipo_visible(e.id)
       AND ((p_distrito IS NULL AND p_rol IS NULL)
            OR EXISTS (SELECT 1 FROM equipo_miembros m
                        WHERE m.equipo_id = e.id AND m.hasta IS NULL AND m.persona_id IN (SELECT q.persona_id FROM quienes q)))
  ),
  eqa AS (
    SELECT eq.periodo_id, COUNT(*)::INT AS total, COUNT(*) FILTER (WHERE eq.estado = 'activo')::INT AS activos,
           (SELECT COUNT(DISTINCT m.persona_id)::INT FROM equipo_miembros m JOIN eq e2 ON e2.id = m.equipo_id
             WHERE e2.periodo_id = eq.periodo_id AND m.hasta IS NULL AND m.persona_id IN (SELECT q.persona_id FROM quienes q)) AS integrantes
      FROM eq GROUP BY eq.periodo_id
  ),
  -- Tareas colectivas: UNA fila por tarea, sin multiplicar por integrante.
  tc AS (
    SELECT t.periodo_id,
           COUNT(*) FILTER (WHERE t.estado <> 'anulada')::INT AS total,
           COUNT(*) FILTER (WHERE t.estado IN ('asignada','en_curso','devuelta','bloqueada'))::INT AS abiertas,
           COUNT(*) FILTER (WHERE t.estado = 'entregada')::INT AS en_revision,
           COUNT(*) FILTER (WHERE t.estado = 'aprobada')::INT AS aprobadas,
           COUNT(*) FILTER (WHERE t.estado IN ('asignada','en_curso') AND t.entregada_en IS NULL AND t.fecha_limite IS NOT NULL
                              AND t.fecha_limite < (NOW() AT TIME ZONE public.zona_periodo(t.periodo_id))::DATE)::INT AS vencidas,
           COUNT(*) FILTER (WHERE t.estado = 'anulada')::INT AS anuladas,
           COUNT(*) FILTER (WHERE t.estado <> 'anulada' AND t.entregada_en IS NOT NULL AND t.fecha_limite IS NOT NULL)::INT AS con_plazo,
           COUNT(*) FILTER (WHERE t.estado <> 'anulada' AND t.entregada_en IS NOT NULL AND t.fecha_limite IS NOT NULL
                              AND (t.entregada_en AT TIME ZONE public.zona_periodo(t.periodo_id))::DATE <= t.fecha_limite)::INT AS a_tiempo
      FROM tareas_equipo t JOIN eq ON eq.id = t.equipo_id
     GROUP BY t.periodo_id
  )
  SELECT per.id, per.nombre, per.descripcion, per.orden, per.modelo, per.activo,
         per.fecha_inicio, per.fecha_fin_trabajo, per.fecha_entrega, per.fecha_jornada,
         CASE WHEN per.activo THEN 'activo'
              WHEN per.fecha_inicio IS NOT NULL AND per.fecha_inicio > per.hoy THEN 'proximo'
              WHEN per.fin IS NOT NULL AND per.fin < per.hoy THEN 'cerrado'
              WHEN per.fecha_inicio IS NULL AND per.fin IS NULL THEN 'sin_fechas'
              ELSE 'inactivo' END,
         v_vista,
         COALESCE(ag.personas, 0), COALESCE(ag.participan, 0), COALESCE(ag.no_participan, 0),
         COALESCE(ag.publicadas, 0), COALESCE(ag.no_publicadas, 0), COALESCE(ag.sin_evaluar, 0),
         COALESCE(ag.n_res, 0), COALESCE(ag.suma_res, 0),
         COALESCE(ag.n_nuc, 0), COALESCE(ag.suma_nuc, 0), COALESCE(ag.n_tec, 0), COALESCE(ag.suma_tec, 0),
         (per.modelo = 'v2'),
         COALESCE(ag.t_total, 0), COALESCE(tk.asignadas, 0), COALESCE(tk.propias, 0),
         COALESCE(ag.t_abiertas, 0), COALESCE(tk.en_revision, 0), COALESCE(ag.t_aprobadas, 0),
         COALESCE(tk.devueltas, 0), COALESCE(tk.bloqueadas, 0), COALESCE(ag.t_vencidas, 0),
         COALESCE(tk.entregadas, 0), COALESCE(ag.t_con_plazo, 0), COALESCE(ag.t_a_tiempo, 0),
         COALESCE(ag.t_puntos_suma, 0), COALESCE(ag.t_puntos_n, 0),
         COALESCE(tk.actividades, 0), COALESCE(tk.en_actividades, 0), COALESCE(tk.en_actividades_aprobadas, 0),
         COALESCE(tk.anuladas, 0),
         COALESCE(tc.total, 0), COALESCE(tc.abiertas, 0), COALESCE(tc.en_revision, 0), COALESCE(tc.aprobadas, 0),
         COALESCE(tc.vencidas, 0), COALESCE(tc.anuladas, 0), COALESCE(tc.con_plazo, 0), COALESCE(tc.a_tiempo, 0),
         COALESCE(eqa.total, 0), COALESCE(eqa.activos, 0), COALESCE(eqa.integrantes, 0),
         COALESCE(ag.n_nota, 0), COALESCE(ag.suma_nota, 0), cfg.peso_tareas, cfg.confirmado,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('distrito', x.d, 'personas', x.n, 'participan', x.np, 'publicadas', x.nb) ORDER BY x.d)
                     FROM (SELECT COALESCE(s.distrito, '') AS d, COUNT(*)::INT AS n,
                                  (COUNT(*) FILTER (WHERE s.participa))::INT AS np,
                                  (COUNT(*) FILTER (WHERE s.participa AND s.estado_eval = 'publicado'))::INT AS nb
                             FROM s WHERE s.periodo_id = per.id GROUP BY 1) x), '[]'::jsonb),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('rol_id', x.r, 'rol', x.rn, 'personas', x.n, 'participan', x.np, 'publicadas', x.nb) ORDER BY x.rn NULLS LAST)
                     FROM (SELECT s.rol_id AS r, COALESCE(s.rol_nombre, '') AS rn, COUNT(*)::INT AS n,
                                  (COUNT(*) FILTER (WHERE s.participa))::INT AS np,
                                  (COUNT(*) FILTER (WHERE s.participa AND s.estado_eval = 'publicado'))::INT AS nb
                             FROM s WHERE s.periodo_id = per.id GROUP BY 1, 2) x), '[]'::jsonb),
         (SELECT COUNT(*)::INT FROM quienes),
         (SELECT COUNT(DISTINCT s.persona_id)::INT FROM s WHERE s.participa),
         (SELECT COUNT(DISTINCT s.persona_id)::INT FROM s WHERE s.participa AND s.estado_eval = 'publicado'),
         NOW()
    FROM per
    LEFT JOIN ag  ON ag.periodo_id  = per.id
    LEFT JOIN tk  ON tk.periodo_id  = per.id
    LEFT JOIN tc  ON tc.periodo_id  = per.id
    LEFT JOIN eqa ON eqa.periodo_id = per.id
    LEFT JOIN periodo_calif_config cfg ON cfg.periodo_id = per.id
   ORDER BY per.orden;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reporte_general_pe(BIGINT, TEXT, BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reporte_general_pe(BIGINT, TEXT, BIGINT) TO authenticated;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- DESHACER: volver a aplicar 0050 (recrea la versión sin equipos).
-- ══════════════════════════════════════════════════════════════════════
