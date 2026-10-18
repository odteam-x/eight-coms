-- ══════════════════════════════════════════════════════════════════════
--  0050 — Reporte general consolidado de todos los Períodos de Evaluación (PE)
-- ══════════════════════════════════════════════════════════════════════
--
--  QUÉ HACE
--  reporte_general_pe(): UNA fila por período (PE) de la gestión, con los totales que la administración
--  necesita para ver el estado general sin entrar PE por PE: personas y participación, evaluaciones
--  (publicadas / no publicadas / sin evaluar), resultados, tareas (asignadas, abiertas, en revisión,
--  aprobadas, vencidas, a tiempo), actividades con tareas y la distribución por distrito y por rol.
--
--  NO HAY FÓRMULA NUEVA
--  Es una función de SOLO LECTURA que COMPONE funciones que ya son la fuente de verdad:
--     · personas, participación, estado y resultado de cada evaluación, y los hechos de las tareas
--       (vencidas, a tiempo, con plazo, aprobadas, puntos)  →  seguimiento_global()  (0025), que a su vez
--       lee resultados_periodo() (0015/0023) para la rúbrica por roles y la suma clásica para la clásica;
--     · lo que seguimiento_global() no desglosa (tareas por estado, propias vs asignadas, vínculo con
--       actividades) se CUENTA aquí directamente sobre `tareas`, con las mismas personas y las mismas
--       definiciones que resumen_tareas_periodo() (0016). Son conteos, no puntajes.
--  Si la fórmula de la evaluación cambia (resultados_periodo), este reporte cambia con ella sin tocarlo.
--
--  QUIÉN VE QUÉ  (lo decide la base; aquí no se agrega ni se quita nada)
--     administración → todas las personas · secretaría → las de su distrito · miembro → solo la suya.
--  Se hereda de seguimiento_global(): las personas que llegan a las cuentas son exactamente las que esa
--  función entrega a quien llama, así que ni la consulta ni el CSV pueden mostrar más de lo permitido.
--  Sin sesión → error. Los borradores solo cuentan como «no publicadas»; nunca aportan puntaje.
--
--  TOTALES, PROMEDIOS Y PORCENTAJES
--  La función devuelve CONTEOS y, para los promedios, la SUMA y la CANTIDAD (n) de los resultados.
--  Con eso el cliente puede agregar varios PE sin sumar porcentajes ni promediar promedios: el promedio
--  global es Σ suma ÷ Σ n (ponderado por resultados), y la rúbrica por roles (0–100) y la clásica (otra
--  escala) NO se mezclan nunca: cada una lleva su propia suma y su propia n por fila (`modelo`).
--  Las personas NO se suman entre PE (una persona está en varios): las cifras «de la gestión» (g_*) se
--  cuentan UNA vez por persona distinta.
--
--  FILTROS  (se recalculan en la base, no en la pantalla)
--     p_distrito → solo las personas de ese distrito ('' = personas sin distrito);
--     p_rol      → solo las personas de ese rol (el rol de su evaluación v2 o, si no hay, el de su perfil).
--  Un PE sin personas dentro del filtro NO desaparece: sale con todo en 0. Un filtro nunca amplía lo
--  que quien llama podría ver.
--
--  Requiere 0021 (tareas.actividad_id) y 0025 (seguimiento_global). Aplicación manual en el SQL Editor,
--  tras 0026/0030. Idempotente. Solo lee: no modifica ninguna tabla.
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
  -- personas y participación (una persona = una vez por PE)
  personas INT, participan INT, no_participan INT,
  -- evaluaciones de las personas que participan
  eval_publicadas INT, eval_no_publicadas INT, eval_sin_evaluar INT,
  -- resultados publicados: promedio = suma ÷ n (rúbrica por roles 0–100; clásica en su propia escala)
  n_resultados INT, suma_resultado NUMERIC,
  n_nucleo INT, suma_nucleo NUMERIC, n_tecnico INT, suma_tecnico NUMERIC,
  -- tareas (todas las tareas de las personas del alcance en ese PE)
  tareas_aplican BOOLEAN,
  tareas_total INT, tareas_asignadas INT, tareas_propias INT,
  tareas_abiertas INT, tareas_en_revision INT, tareas_aprobadas INT,
  tareas_devueltas INT, tareas_bloqueadas INT, tareas_vencidas INT,
  tareas_entregadas INT, con_plazo INT, a_tiempo INT, puntos_suma INT, puntos_n INT,
  -- actividades
  actividades_con_tareas INT, tareas_en_actividades INT, tareas_en_actividades_aprobadas INT,
  -- distribución
  por_distrito JSONB, por_rol JSONB,
  -- cifras de la gestión (iguales en todas las filas): cada persona se cuenta UNA vez
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
  -- Las personas y sus hechos: EXACTAMENTE lo que seguimiento_global() entrega a quien llama, filtrado.
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
           SUM(s.tareas_total)::INT AS t_total, SUM(s.tareas_abiertas)::INT AS t_abiertas,
           SUM(s.tareas_vencidas)::INT AS t_vencidas, SUM(s.tareas_aprobadas)::INT AS t_aprobadas,
           SUM(s.con_plazo)::INT AS t_con_plazo, SUM(s.a_tiempo)::INT AS t_a_tiempo,
           SUM(s.puntos_suma)::INT AS t_puntos_suma, SUM(s.puntos_n)::INT AS t_puntos_n
      FROM s GROUP BY s.periodo_id
  ),
  -- Lo que seguimiento_global() no desglosa: conteos por estado y por origen, sobre las MISMAS personas.
  tk AS (
    SELECT t.periodo_id,
           COUNT(*) FILTER (WHERE t.origen = 'asignada')::INT AS asignadas,
           COUNT(*) FILTER (WHERE t.origen = 'propia')::INT AS propias,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NOT NULL)::INT AS entregadas,
           COUNT(*) FILTER (WHERE t.estado = 'entregada')::INT AS en_revision,
           COUNT(*) FILTER (WHERE t.estado = 'devuelta')::INT AS devueltas,
           COUNT(*) FILTER (WHERE t.estado = 'bloqueada')::INT AS bloqueadas,
           COUNT(DISTINCT t.actividad_id)::INT AS actividades,
           COUNT(*) FILTER (WHERE t.actividad_id IS NOT NULL)::INT AS en_actividades,
           COUNT(*) FILTER (WHERE t.actividad_id IS NOT NULL AND t.estado = 'aprobada')::INT AS en_actividades_aprobadas
      FROM tareas t JOIN per ON per.id = t.periodo_id
     WHERE t.asignada_a IN (SELECT q.persona_id FROM quienes q)
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
    LEFT JOIN ag ON ag.periodo_id = per.id
    LEFT JOIN tk ON tk.periodo_id = per.id
   ORDER BY per.orden;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reporte_general_pe(BIGINT, TEXT, BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reporte_general_pe(BIGINT, TEXT, BIGINT) TO authenticated;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (después de aplicar, con la sesión de la administración)
-- ══════════════════════════════════════════════════════════════════════
--   SELECT periodo_nombre, estado_pe, personas, participan, eval_publicadas, tareas_total FROM reporte_general_pe();
--   -- Una fila por período de la gestión activa, también los que no tienen datos.
--   -- Con una secretaría o un miembro, `personas` es su distrito / solo ella o él.
-- ══════════════════════════════════════════════════════════════════════
-- DESHACER (comentado)
-- DROP FUNCTION IF EXISTS public.reporte_general_pe(BIGINT, TEXT, BIGINT);
