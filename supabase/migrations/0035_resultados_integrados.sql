-- ══════════════════════════════════════════════════════════════════════
--  0035 — La nota de tareas entra en la evaluación (resultados_periodo y quienes leen de él)
-- ══════════════════════════════════════════════════════════════════════
--
--  ESTA ES LA CORRECCIÓN DE FONDO (causa raíz en docs/auditoria-equipos-calificaciones.md)
--    Hasta 0033 los puntos de las tareas se guardaban pero NINGUNA función los leía: resultados_periodo() (la fuente
--    de la que beben el perfil, el panel, los reportes, el ranking y el seguimiento) solo conocía las puntuaciones que
--    escribe la persona que evalúa. Aquí se cierra el circuito:
--
--      nota_tareas   = calif_puntaje()                           (0034: ponderada, con reglas por PE)
--      individual    = (1 − w) · (0.6·técnico + 0.4·núcleo)   +  w · nota_tareas
--      general       = (1 − w) · (0.4·núcleo + 0.6·percentil) +  w · nota_tareas
--      w             = peso_tareas del PE / 100, solo si la persona tiene nota_tareas (si no, w = 0: no se le resta ni se
--                      le inventa nada por no tener tareas calificadas)
--
--    · El percentil sigue calculándose sobre el técnico (comparar a la gente del mismo rol por su trabajo técnico).
--    · Con peso_tareas = 0 (los PE que ya existían al aplicar 0033) el resultado es EXACTAMENTE el de antes.
--    · Las columnas nuevas separan lo que viene de la evaluación (`individual_eval`, `general_eval`) de lo que viene de
--      las tareas (`tareas`, `tareas_n`, `peso_tareas`), para que ninguna pantalla tenga que recalcular nada.
--    · Se calcula al consultar (sin caché): una nota nueva, corregida o anulada cambia el resultado en todas las
--      pantallas a la vez.
--
--  QUIENES LEEN DE AQUÍ (todos reciben ya la nota integrada, sin cambiar su código de cálculo):
--      perfil · panel del admin · reportes · ranking · seguimiento_global() (se recrea aquí y añade columnas de tareas)
--
--  Además, para que no haya números distintos en dos lugares:
--      · seguimiento_global(), reporte_actividades() y resumen_tareas_periodo() dejan fuera las tareas anuladas y las
--        notas anuladas (antes una anulada hubiera contado como asignada o sumado puntos).
--      · seguimiento_global() añade tareas_nota, tareas_n, peso_tareas, individual_eval y las colectivas del equipo.
--
--  Mismas reglas de visibilidad y guardia que antes (IF auth.uid() IS NULL THEN RAISE). Requiere 0015, 0023, 0025, 0034.
--  Aplicación manual en el SQL Editor. Idempotente. NO TOCA datos.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. resultados_periodo ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.resultados_periodo(UUID, BOOLEAN);
CREATE FUNCTION public.resultados_periodo(
  p_periodo    UUID,
  p_borradores BOOLEAN DEFAULT false
) RETURNS TABLE (
  evaluado_id UUID,
  nombre      TEXT,
  distrito    TEXT,
  rol_id      BIGINT,
  rol_nombre  TEXT,
  perfil_id   BIGINT,
  estado      TEXT,
  nucleo      NUMERIC,
  tecnico     NUMERIC,
  individual  NUMERIC,
  percentil   NUMERIC,
  general     NUMERIC,
  n_rol       INT,
  rol_pequeno BOOLEAN,
  escala      TEXT,
  -- 0035: la nota de tareas integrada (ver 0034). individual y general YA la incluyen.
  individual_eval NUMERIC,     -- 0.6·técnico + 0.4·núcleo: solo la evaluación (sin tareas)
  general_eval    NUMERIC,     -- 0.4·núcleo + 0.6·percentil: solo la evaluación (sin tareas)
  tareas          NUMERIC,     -- nota de tareas 0–100 (NULL si no hay suficientes tareas calificadas)
  tareas_n        INT,         -- tareas que cuentan
  peso_tareas     NUMERIC      -- % del resultado que aportan las tareas A ESTA PERSONA (0 si tareas es NULL)
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_admin   BOOLEAN;
  v_gestion BIGINT;
  v_peso    NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501';
  END IF;
  v_admin := public.is_admin();

  SELECT p.gestion_id INTO v_gestion FROM periodos_evaluacion p
   WHERE p.id = p_periodo AND p.modelo = 'v2';
  IF v_gestion IS NULL THEN
    RETURN;   -- período inexistente o legacy: sin resultados v2
  END IF;
  SELECT c.peso_tareas INTO v_peso FROM public.calif_config(p_periodo) c;

  RETURN QUERY
  WITH base AS (
    SELECT e.evaluado_id, e.perfil_id, e.puntajes, e.estado, e.escala,
           pr.rol_id, ro.nombre AS rol_nombre, pf.nombre, pf.distrito
      FROM evaluaciones e
      JOIN perfiles_rol pr ON pr.id = e.perfil_id
      JOIN roles        ro ON ro.id = pr.rol_id
      JOIN profiles     pf ON pf.id = e.evaluado_id
     WHERE e.periodo_id = p_periodo
       AND e.modelo = 'v2'
       AND (e.estado = 'publicado' OR (v_admin AND p_borradores))
  ),
  nuc AS (
    SELECT b.evaluado_id, AVG(CASE b.escala WHEN 'cinco' THEN (v.value::NUMERIC - 1) / 4 * 100 ELSE v.value::NUMERIC / 10 * 100 END) AS nucleo
      FROM base b
      CROSS JOIN LATERAL jsonb_each_text(b.puntajes) v(key, value)
      JOIN criterios_v2 c ON c.gestion_id = v_gestion AND c.key = v.key AND c.tipo = 'nucleo'
     GROUP BY b.evaluado_id
  ),
  tec AS (
    SELECT b.evaluado_id,
           SUM(pc.peso * (CASE b.escala WHEN 'cinco' THEN (v.value::NUMERIC - 1) / 4 * 100 ELSE v.value::NUMERIC / pc.peso * 100 END)) / NULLIF(SUM(pc.peso), 0) AS tecnico
      FROM base b
      CROSS JOIN LATERAL jsonb_each_text(b.puntajes) v(key, value)
      JOIN perfil_criterios pc ON pc.perfil_id = b.perfil_id AND pc.criterio_key = v.key
     GROUP BY b.evaluado_id
  ),
  junto AS (
    SELECT b.*, n.nucleo, t.tecnico,
           COUNT(*) OVER (PARTITION BY b.rol_id)                  AS n_rol,
           RANK()   OVER (PARTITION BY b.rol_id ORDER BY t.tecnico) AS pos_min,
           COUNT(*) OVER (PARTITION BY b.rol_id, t.tecnico)       AS empates
      FROM base b
      LEFT JOIN nuc n ON n.evaluado_id = b.evaluado_id
      LEFT JOIN tec t ON t.evaluado_id = b.evaluado_id
  ),
  calc AS (
    SELECT j.*,
           (j.n_rol < 4) AS rol_pequeno,
           CASE WHEN j.n_rol >= 4 AND j.tecnico IS NOT NULL
                THEN ((j.pos_min + (j.empates - 1) / 2.0) - 1) / (j.n_rol - 1) * 100
           END AS percentil
      FROM junto j
  ),
  -- Peso con que las tareas entran en CADA persona: el del PE, solo si ella tiene nota de tareas.
  mix AS (
    SELECT c.*, tp.nota AS t_nota, tp.n_cuentan AS t_n,
           CASE WHEN tp.nota IS NOT NULL THEN v_peso / 100 ELSE 0 END AS w
      FROM calc c
      LEFT JOIN public.calif_puntaje(p_periodo) tp ON tp.persona_id = c.evaluado_id
  )
  SELECT c.evaluado_id, c.nombre, c.distrito, c.rol_id, c.rol_nombre, c.perfil_id, c.estado,
         ROUND(c.nucleo, 1),
         ROUND(c.tecnico, 1),
         ROUND((1 - c.w) * (0.6 * c.tecnico + 0.4 * c.nucleo) + c.w * COALESCE(c.t_nota, 0), 1),
         ROUND(c.percentil, 1),
         ROUND((1 - c.w) * (0.4 * c.nucleo + 0.6 * COALESCE(c.percentil, c.tecnico)) + c.w * COALESCE(c.t_nota, 0), 1),
         c.n_rol::INT,
         c.rol_pequeno,
         c.escala,
         ROUND(0.6 * c.tecnico + 0.4 * c.nucleo, 1),
         ROUND(0.4 * c.nucleo + 0.6 * COALESCE(c.percentil, c.tecnico), 1),
         c.t_nota,
         COALESCE(c.t_n, 0)::INT,
         ROUND(c.w * 100, 2)
    FROM mix c
   WHERE v_admin
      OR c.evaluado_id = auth.uid()
      OR (public.is_secretario() AND c.evaluado_id IN (SELECT public.get_district_member_ids()));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.resultados_periodo(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resultados_periodo(UUID, BOOLEAN) TO authenticated;

-- ── 2. seguimiento_global ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.seguimiento_global(BIGINT);
CREATE FUNCTION public.seguimiento_global(p_gestion BIGINT DEFAULT NULL)
RETURNS TABLE (
  persona_id UUID, nombre TEXT, distrito TEXT, rol_id BIGINT, rol_nombre TEXT,
  periodo_id UUID, periodo_nombre TEXT, periodo_orden INT, modelo TEXT, periodo_activo BOOLEAN,
  participa BOOLEAN, estado_eval TEXT,
  nucleo NUMERIC, tecnico NUMERIC, individual NUMERIC, general NUMERIC, total_clasico NUMERIC,
  tareas_total INT, tareas_abiertas INT, tareas_vencidas INT, tareas_aprobadas INT,
  con_plazo INT, a_tiempo INT, puntos_suma INT, puntos_n INT,
  -- 0035: la nota de tareas integrada y las tareas colectivas del equipo
  individual_eval NUMERIC, tareas_nota NUMERIC, tareas_n INT, peso_tareas NUMERIC, colectivas_total INT, colectivas_aprobadas INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_admin BOOLEAN; v_sec BOOLEAN; v_gestion BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501';
  END IF;
  v_admin := public.is_admin();
  v_sec   := public.is_secretario();
  v_gestion := COALESCE(p_gestion, (SELECT g.id FROM gestiones g WHERE g.activa ORDER BY g.id DESC LIMIT 1));
  IF v_gestion IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH per AS (
    SELECT pe.id, pe.nombre, pe.modelo, COALESCE(pe.activo, false) AS activo,
           (ROW_NUMBER() OVER (ORDER BY pe.created_at, pe.id))::INT AS orden
      FROM periodos_evaluacion pe WHERE pe.gestion_id = v_gestion
  ),
  quienes AS (
    SELECT pf.id, COALESCE(NULLIF(pf.nombre, ''), pf.email) AS nombre, pf.distrito, pf.rol_id::BIGINT AS rol_id
      FROM profiles pf
     WHERE NOT COALESCE(pf.es_admin, false) AND pf.aprobado IS NOT FALSE
       AND (v_admin
            OR pf.id = auth.uid()
            OR (v_sec AND pf.id IN (SELECT public.get_district_member_ids())))
  ),
  v2 AS (
    SELECT per.id AS periodo_id, r.evaluado_id, r.rol_id, r.nucleo, r.tecnico, r.individual, r.general, r.estado,
           r.individual_eval, r.tareas, r.tareas_n, r.peso_tareas
      FROM per
      CROSS JOIN LATERAL public.resultados_periodo(per.id, v_admin) r
     WHERE per.modelo = 'v2'
  ),
  cl AS (
    SELECT e.periodo_id, e.evaluado_id, e.estado,
           (COALESCE((SELECT SUM(x.value::NUMERIC) FROM jsonb_each_text(e.puntajes) x WHERE x.value ~ '^-?[0-9]+(\.[0-9]+)?$'), 0)
            + COALESCE(e.bono_ext, 0)) AS total
      FROM evaluaciones e JOIN per ON per.id = e.periodo_id
     WHERE per.modelo <> 'v2'
       AND e.evaluado_id IN (SELECT q.id FROM quienes q)
  ),
  tk AS (
    SELECT t.periodo_id, t.asignada_a,
           COUNT(*) FILTER (WHERE t.estado <> 'anulada')::INT AS total,
           COUNT(*) FILTER (WHERE t.estado IN ('asignada','en_curso','devuelta','bloqueada'))::INT AS abiertas,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NULL AND t.estado IN ('asignada','en_curso')
                              AND t.fecha_limite IS NOT NULL
                              AND t.fecha_limite < (NOW() AT TIME ZONE public.zona_periodo(t.periodo_id))::DATE)::INT AS vencidas,
           COUNT(*) FILTER (WHERE t.estado = 'aprobada')::INT AS aprobadas,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NOT NULL AND t.fecha_limite IS NOT NULL)::INT AS con_plazo,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NOT NULL AND t.fecha_limite IS NOT NULL
                              AND (t.entregada_en AT TIME ZONE public.zona_periodo(t.periodo_id))::DATE <= t.fecha_limite)::INT AS a_tiempo,
           COALESCE(SUM(t.puntos) FILTER (WHERE t.estado = 'aprobada' AND t.puntos IS NOT NULL AND t.nota_anulada_en IS NULL), 0)::INT AS puntos_suma,
           COUNT(*) FILTER (WHERE t.estado = 'aprobada' AND t.puntos IS NOT NULL AND t.nota_anulada_en IS NULL)::INT AS puntos_n
      FROM tareas t JOIN per ON per.id = t.periodo_id
     WHERE t.asignada_a IN (SELECT q.id FROM quienes q)
     GROUP BY t.periodo_id, t.asignada_a
  ),
  -- Tareas colectivas (0032): una fila por persona y PE. Una tarea del equipo cuenta UNA vez para cada integrante.
  tc AS (
    SELECT t.periodo_id, p.persona_id AS persona,
           COUNT(*) FILTER (WHERE t.estado <> 'anulada' AND (p.hasta IS NULL OR t.estado = 'aprobada'))::INT AS total,
           COUNT(*) FILTER (WHERE t.estado = 'aprobada')::INT AS aprobadas
      FROM tareas_equipo t
      JOIN tarea_equipo_participantes p ON p.tarea_id = t.id
      JOIN per ON per.id = t.periodo_id
     WHERE p.persona_id IN (SELECT q.id FROM quienes q)
     GROUP BY t.periodo_id, p.persona_id
  )
  SELECT q.id, q.nombre, q.distrito, COALESCE(v2.rol_id, q.rol_id), ro.nombre,
         per.id, per.nombre, per.orden, per.modelo, per.activo,
         NOT EXISTS (SELECT 1 FROM periodo_participantes pp WHERE pp.periodo_id = per.id AND pp.user_id = q.id AND NOT pp.activo),
         CASE
           WHEN per.modelo = 'v2' THEN
             CASE WHEN v2.evaluado_id IS NOT NULL THEN v2.estado
                  WHEN v_admin AND EXISTS (SELECT 1 FROM evaluaciones e WHERE e.periodo_id = per.id AND e.evaluado_id = q.id) THEN 'borrador'
                  WHEN EXISTS (SELECT 1 FROM evaluaciones e WHERE e.periodo_id = per.id AND e.evaluado_id = q.id) THEN 'sin_publicar'
                  ELSE 'sin_evaluar' END
           ELSE
             CASE WHEN cl.estado = 'publicado' THEN 'publicado'
                  WHEN cl.estado IS NOT NULL AND v_admin THEN 'borrador'
                  WHEN cl.estado IS NOT NULL THEN 'sin_publicar'
                  ELSE 'sin_evaluar' END
         END,
         v2.nucleo, v2.tecnico, v2.individual, v2.general,
         CASE WHEN cl.estado = 'publicado' OR (v_admin AND cl.estado IS NOT NULL) THEN cl.total END,
         COALESCE(tk.total, 0), COALESCE(tk.abiertas, 0), COALESCE(tk.vencidas, 0), COALESCE(tk.aprobadas, 0),
         COALESCE(tk.con_plazo, 0), COALESCE(tk.a_tiempo, 0), COALESCE(tk.puntos_suma, 0), COALESCE(tk.puntos_n, 0),
         v2.individual_eval, v2.tareas, COALESCE(v2.tareas_n, 0), v2.peso_tareas,
         COALESCE(tc.total, 0), COALESCE(tc.aprobadas, 0)
    FROM quienes q
    CROSS JOIN per
    LEFT JOIN v2 ON v2.periodo_id = per.id AND v2.evaluado_id = q.id
    LEFT JOIN cl ON cl.periodo_id = per.id AND cl.evaluado_id = q.id
    LEFT JOIN tk ON tk.periodo_id = per.id AND tk.asignada_a = q.id
    LEFT JOIN tc ON tc.periodo_id = per.id AND tc.persona = q.id
    LEFT JOIN roles ro ON ro.id = COALESCE(v2.rol_id, q.rol_id)
   ORDER BY ro.nombre NULLS LAST, q.nombre, per.orden;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.seguimiento_global(BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.seguimiento_global(BIGINT) TO authenticated;

-- ── 3. reporte_actividades ────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.reporte_actividades(BIGINT);
CREATE FUNCTION public.reporte_actividades(p_gestion BIGINT DEFAULT NULL)
RETURNS TABLE (
  actividad_id BIGINT, titulo TEXT, fecha_inicio DATE, fecha_fin DATE, alcance TEXT, etiqueta TEXT,
  persona_id UUID, nombre TEXT, distrito TEXT, rol_nombre TEXT,
  asignadas INT, entregadas INT, con_plazo INT, a_tiempo INT, aprobadas INT, vencidas INT, puntos_suma INT, puntos_n INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_admin BOOLEAN; v_sec BOOLEAN; v_gestion BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501';
  END IF;
  v_admin := public.is_admin();
  v_sec   := public.is_secretario();
  v_gestion := COALESCE(p_gestion, (SELECT g.id FROM gestiones g WHERE g.activa ORDER BY g.id DESC LIMIT 1));
  IF v_gestion IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH quienes AS (
    SELECT pf.id, COALESCE(NULLIF(pf.nombre, ''), pf.email) AS nombre, pf.distrito, pf.rol_id
      FROM profiles pf
     WHERE NOT COALESCE(pf.es_admin, false) AND pf.aprobado IS NOT FALSE
       AND (v_admin OR pf.id = auth.uid() OR (v_sec AND pf.id IN (SELECT public.get_district_member_ids())))
  ),
  tk AS (
    SELECT t.actividad_id AS aid, t.asignada_a,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.estado <> 'anulada')::INT AS asignadas,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NOT NULL)::INT AS entregadas,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NOT NULL AND t.fecha_limite IS NOT NULL)::INT AS con_plazo,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NOT NULL AND t.fecha_limite IS NOT NULL
                              AND (t.entregada_en AT TIME ZONE public.zona_periodo(t.periodo_id))::DATE <= t.fecha_limite)::INT AS a_tiempo,
           COUNT(*) FILTER (WHERE t.estado = 'aprobada')::INT AS aprobadas,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NULL AND t.estado IN ('asignada','en_curso')
                              AND t.fecha_limite IS NOT NULL
                              AND t.fecha_limite < (NOW() AT TIME ZONE public.zona_periodo(t.periodo_id))::DATE)::INT AS vencidas,
           COALESCE(SUM(t.puntos) FILTER (WHERE t.estado = 'aprobada' AND t.puntos IS NOT NULL AND t.nota_anulada_en IS NULL), 0)::INT AS puntos_suma,
           COUNT(*) FILTER (WHERE t.estado = 'aprobada' AND t.puntos IS NOT NULL AND t.nota_anulada_en IS NULL)::INT AS puntos_n
      FROM tareas t JOIN periodos_evaluacion pe ON pe.id = t.periodo_id
     WHERE t.actividad_id IS NOT NULL AND pe.gestion_id = v_gestion
       AND t.asignada_a IN (SELECT q.id FROM quienes q)
     GROUP BY t.actividad_id, t.asignada_a
  ),
  visibles AS (
    SELECT a.id, a.titulo, a.fecha_inicio, a.fecha_fin, a.alcance, e.nombre AS etiqueta
      FROM actividades a LEFT JOIN etiquetas e ON e.id = a.etiqueta_id
     WHERE a.gestion_id = v_gestion
       AND (v_admin
            OR EXISTS (SELECT 1 FROM tk WHERE tk.aid = a.id)
            OR (v_sec AND (a.alcance = 'equipo' OR a.distrito = public.mi_distrito() OR a.creada_por = auth.uid())))
  )
  SELECT v.id, v.titulo, v.fecha_inicio, v.fecha_fin, v.alcance, v.etiqueta,
         q.id, q.nombre, q.distrito, ro.nombre,
         COALESCE(tk.asignadas, 0), COALESCE(tk.entregadas, 0), COALESCE(tk.con_plazo, 0), COALESCE(tk.a_tiempo, 0),
         COALESCE(tk.aprobadas, 0), COALESCE(tk.vencidas, 0), COALESCE(tk.puntos_suma, 0), COALESCE(tk.puntos_n, 0)
    FROM visibles v
    LEFT JOIN tk ON tk.aid = v.id
    LEFT JOIN quienes q ON q.id = tk.asignada_a
    LEFT JOIN roles ro ON ro.id = q.rol_id
   ORDER BY v.fecha_inicio DESC, v.id, q.nombre;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reporte_actividades(BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reporte_actividades(BIGINT) TO authenticated;

-- ── 4. resumen_tareas_periodo (sin anuladas) ──────────────────────────
CREATE OR REPLACE FUNCTION public.resumen_tareas_periodo(p_periodo UUID)
RETURNS TABLE (
  user_id             UUID,
  asignadas           INT,
  entregadas          INT,
  con_plazo           INT,
  a_tiempo            INT,
  vencidas_abiertas   INT,
  devoluciones        INT,
  bloqueadas          INT,
  propias_aprobadas   INT,
  prorrogas           INT,
  abiertas            INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_admin BOOLEAN;
  v_zona  TEXT;
  v_hoy   DATE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501';
  END IF;
  v_admin := public.is_admin();
  v_zona  := public.zona_periodo(p_periodo);
  v_hoy   := (NOW() AT TIME ZONE v_zona)::DATE;

  RETURN QUERY
  SELECT t.asignada_a,
         COUNT(*) FILTER (WHERE t.origen = 'asignada')::INT,
         COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NOT NULL)::INT,
         COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NOT NULL AND t.fecha_limite IS NOT NULL)::INT,
         COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NOT NULL AND t.fecha_limite IS NOT NULL
                            AND (t.entregada_en AT TIME ZONE v_zona)::DATE <= t.fecha_limite)::INT,
         -- Vencida = nunca entregada. Una tarea devuelta ya se entregó (a tiempo o no
         -- según su primera entrega): lo que falta es la corrección, no el plazo.
         COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NULL
                            AND t.estado IN ('asignada','en_curso')
                            AND t.fecha_limite IS NOT NULL AND t.fecha_limite < v_hoy)::INT,
         COALESCE(SUM(t.rondas_revision) FILTER (WHERE t.origen = 'asignada'), 0)::INT,
         COUNT(*) FILTER (WHERE t.estado = 'bloqueada')::INT,
         COUNT(*) FILTER (WHERE t.origen = 'propia' AND t.estado = 'aprobada')::INT,
         (SELECT COUNT(*) FROM tarea_eventos e JOIN tareas tt ON tt.id = e.tarea_id
           WHERE tt.asignada_a = t.asignada_a AND tt.periodo_id = p_periodo
             AND tt.origen = 'asignada' AND e.tipo = 'prorroga')::INT,
         COUNT(*) FILTER (WHERE t.estado IN ('asignada','en_curso','devuelta','bloqueada'))::INT
    FROM tareas t
   WHERE t.periodo_id = p_periodo
     AND t.estado <> 'anulada'
     AND (v_admin
          OR t.asignada_a = auth.uid()
          OR (public.is_secretario() AND t.asignada_a IN (SELECT public.get_district_member_ids())))
   GROUP BY t.asignada_a;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.resumen_tareas_periodo(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resumen_tareas_periodo(UUID) TO authenticated;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- ══════════════════════════════════════════════════════════════════════
--   Con peso_tareas = 0 el resultado es el de antes:
--     SELECT individual, individual_eval, tareas, peso_tareas FROM resultados_periodo('<periodo>', true);   -- individual = individual_eval
-- ══════════════════════════════════════════════════════════════════════
