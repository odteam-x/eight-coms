-- ══════════════════════════════════════════════════════════════════════
--  0034 — Cálculo de la nota de tareas (una sola definición, en la base)
-- ══════════════════════════════════════════════════════════════════════
--
--  QUÉ HACE
--    Convierte las tareas aprobadas de una persona en UNA cifra de 0 a 100 («nota de tareas») con reglas explícitas,
--    configurables por PE (periodo_calif_config, 0033), y explica cada pieza. 0035 la integra en resultados_periodo(),
--    de donde leen perfil, panel, reportes y seguimiento: no hay segunda fórmula en ninguna pantalla.
--
--  LA FÓRMULA (reproducible a mano)
--      Para cada tarea que CUENTA de la persona:
--          peso_efectivo = peso de la tarea  ×  multiplicador de su tipo (individual o colectiva)
--          fracción      = puntos / 10
--      nota_tareas = 100 × Σ(peso_efectivo × fracción) / Σ(peso_efectivo)       ← promedio PONDERADO, no total/n
--      Si la persona tiene menos tareas que cuentan que `minimo_tareas`, la nota queda en NULL («no suficiente»):
--      nunca se rellena con 0 ni con el promedio de otras personas.
--
--  QUÉ CUENTA (y por qué lo demás no)
--      · aprobada, con puntos y con la nota vigente (no anulada)            → cuenta
--      · aprobada por la propia persona como iniciativa ('propia')          → cuenta solo si contar_propias
--      · entregada (esperando revisión), en curso, devuelta, bloqueada      → NO cuenta: aún no se evaluó (no es un 0)
--      · asignada/en curso y VENCIDA sin entregar                           → NO cuenta, salvo vencidas_como_cero
--                                                                             (regla institucional, apagada por defecto): entonces vale 0
--      · anulada (la tarea) o con la NOTA anulada                            → NO cuenta, y no entra en el denominador
--      · tarea aprobada antes de 0017, sin puntos                           → NO cuenta (no se inventan puntos)
--
--  TAREAS COLECTIVAS
--      · Cada integrante que cuenta recibe la nota del grupo UNA vez por tarea: la tarea aporta una fila a su cálculo
--        (no se «reparte» ni se multiplica por integrante). Origen = «grupal», y el detalle dice de qué equipo.
--      · Si la administración o quien revisa puso una nota INDIVIDUAL dentro del grupo (con evidencia, 0033), esa
--        reemplaza a la del grupo SOLO para esa persona y se muestra aparte («individual en el grupo»).
--      · Quién cuenta: quien participaba al aprobarse la tarea, o dejó al menos un aporte (si salió antes). Quien entra
--        después de aprobada no cuenta. Todo sale de tarea_equipo_participantes (con fechas), nada se borra.
--      · El resultado global del PE NO duplica la nota: una tarea del grupo es una tarea para cada persona, no N tareas
--        para el equipo; resultado_equipo() (0036) cuenta cada tarea una vez.
--
--  CUÁNDO SE ACTUALIZA: al consultar. Nada se guarda aparte (ni caché ni tabla de totales): crear, corregir o anular una
--  nota cambia el siguiente resultado de inmediato y en todas las pantallas, sin tareas de recálculo que puedan fallar,
--  duplicarse o quedar a medias.
--
--  Dos funciones internas (sin acceso desde el cliente) y dos públicas con la visibilidad impuesta aquí:
--      calif_items(periodo)             — cada pieza candidata, con si cuenta y por qué
--      calif_puntaje(periodo)           — la nota por persona
--      tareas_calificacion_detalle()    — el desglose (la persona, su secretaría o la administración)
--      tareas_calificacion_resumen()    — una fila por persona (admin: todas; secretaría: su distrito; miembro: la suya)
--
--  Requiere 0016, 0017, 0031, 0032, 0033. Solo lee. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Piezas candidatas ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.calif_items(UUID);
CREATE FUNCTION public.calif_items(p_periodo UUID)
RETURNS TABLE (
  persona_id UUID, tipo TEXT, tarea_id BIGINT, titulo TEXT, equipo_id BIGINT, equipo_nombre TEXT,
  estado TEXT, origen TEXT, puntos SMALLINT, nota_grupo SMALLINT, individual_en_grupo BOOLEAN,
  peso_tarea NUMERIC, peso_efectivo NUMERIC, cuenta BOOLEAN, razon TEXT,
  fecha_limite DATE, aprobada_en TIMESTAMPTZ, vencida BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  cfg   RECORD;
  v_hoy DATE;
BEGIN
  IF (SELECT modelo FROM periodos_evaluacion WHERE id = p_periodo) IS DISTINCT FROM 'v2' THEN RETURN; END IF;
  SELECT * INTO cfg FROM public.calif_config(p_periodo);
  v_hoy := (NOW() AT TIME ZONE public.zona_periodo(p_periodo))::DATE;

  RETURN QUERY
  WITH ind AS (
    SELECT t.asignada_a AS persona, t.id, t.titulo, t.estado, t.origen, t.puntos, t.peso, t.nota_anulada_en, t.fecha_limite,
           t.aprobada_en, t.entregada_en,
           (t.estado IN ('asignada','en_curso') AND t.entregada_en IS NULL AND t.fecha_limite IS NOT NULL AND t.fecha_limite < v_hoy) AS venc
      FROM tareas t WHERE t.periodo_id = p_periodo
  ),
  col AS (
    SELECT p.persona_id AS persona, t.id, t.titulo, t.estado, t.puntos AS nota_grupo, p.puntos_individual, t.peso, t.nota_anulada_en,
           t.fecha_limite, t.aprobada_en, t.equipo_id, e.nombre AS equipo,
           (t.estado IN ('asignada','en_curso') AND t.entregada_en IS NULL AND t.fecha_limite IS NOT NULL AND t.fecha_limite < v_hoy) AS venc,
           -- Cuenta quien participaba al aprobarse, o aportó algo aunque haya salido antes.
           CASE WHEN t.estado = 'aprobada' THEN
                  ((p.desde <= t.aprobada_en AND (p.hasta IS NULL OR p.hasta > t.aprobada_en))
                   OR EXISTS (SELECT 1 FROM tarea_equipo_aportes a WHERE a.tarea_id = t.id AND a.persona_id = p.persona_id))
                ELSE (p.hasta IS NULL) END AS participa
      FROM tareas_equipo t
      JOIN equipos e ON e.id = t.equipo_id
      JOIN tarea_equipo_participantes p ON p.tarea_id = t.id
     WHERE t.periodo_id = p_periodo
  )
  SELECT i.persona, 'individual'::TEXT, i.id, i.titulo, NULL::BIGINT, NULL::TEXT, i.estado, i.origen,
         i.puntos, NULL::SMALLINT, false,
         i.peso, i.peso * cfg.mult_individual,
         CASE WHEN i.estado = 'aprobada' THEN (i.puntos IS NOT NULL AND i.nota_anulada_en IS NULL AND (i.origen = 'asignada' OR cfg.contar_propias))
              WHEN i.venc THEN cfg.vencidas_como_cero
              ELSE false END,
         CASE WHEN i.estado = 'anulada' THEN 'tarea_anulada'
              WHEN i.estado = 'aprobada' AND i.nota_anulada_en IS NOT NULL THEN 'nota_anulada'
              WHEN i.estado = 'aprobada' AND i.puntos IS NULL THEN 'sin_puntos'
              WHEN i.estado = 'aprobada' AND i.origen = 'propia' AND NOT cfg.contar_propias THEN 'propia_excluida'
              WHEN i.estado = 'aprobada' THEN 'calificada'
              WHEN i.venc AND cfg.vencidas_como_cero THEN 'vencida_como_cero'
              WHEN i.venc THEN 'vencida'
              WHEN i.estado = 'entregada' THEN 'pendiente_de_evaluacion'
              WHEN i.estado = 'bloqueada' THEN 'bloqueada'
              WHEN i.estado = 'devuelta' THEN 'devuelta'
              ELSE 'en_curso' END,
         i.fecha_limite, i.aprobada_en, i.venc
    FROM ind i
  UNION ALL
  SELECT c.persona, 'equipo'::TEXT, c.id, c.titulo, c.equipo_id, c.equipo, c.estado, 'grupal'::TEXT,
         COALESCE(c.puntos_individual, c.nota_grupo) , c.nota_grupo, c.puntos_individual IS NOT NULL,
         c.peso, c.peso * cfg.mult_colectiva,
         CASE WHEN c.estado = 'aprobada' THEN (c.participa AND COALESCE(c.puntos_individual, c.nota_grupo) IS NOT NULL AND c.nota_anulada_en IS NULL)
              WHEN c.venc THEN (c.participa AND cfg.vencidas_como_cero)
              ELSE false END,
         CASE WHEN c.estado = 'anulada' THEN 'tarea_anulada'
              WHEN c.estado = 'aprobada' AND NOT c.participa THEN 'no_participo'
              WHEN c.estado = 'aprobada' AND c.nota_anulada_en IS NOT NULL THEN 'nota_anulada'
              WHEN c.estado = 'aprobada' AND COALESCE(c.puntos_individual, c.nota_grupo) IS NULL THEN 'sin_puntos'
              WHEN c.estado = 'aprobada' THEN CASE WHEN c.puntos_individual IS NOT NULL THEN 'individual_en_grupo' ELSE 'nota_del_grupo' END
              WHEN NOT c.participa THEN 'no_participa'
              WHEN c.venc AND cfg.vencidas_como_cero THEN 'vencida_como_cero'
              WHEN c.venc THEN 'vencida'
              WHEN c.estado = 'entregada' THEN 'pendiente_de_evaluacion'
              WHEN c.estado = 'bloqueada' THEN 'bloqueada'
              WHEN c.estado = 'devuelta' THEN 'devuelta'
              ELSE 'en_curso' END,
         c.fecha_limite, c.aprobada_en, c.venc
    FROM col c
   WHERE c.participa OR c.estado IN ('aprobada','anulada');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.calif_items(UUID) FROM PUBLIC, anon, authenticated;


-- ── 2. La nota por persona ────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.calif_puntaje(UUID);
CREATE FUNCTION public.calif_puntaje(p_periodo UUID)
RETURNS TABLE (
  persona_id UUID, nota NUMERIC, n_cuentan INT, n_individuales INT, n_colectivas INT, suma_pesos NUMERIC,
  n_pendientes INT, n_abiertas INT, n_vencidas INT, n_anuladas INT, suficiente BOOLEAN, minimo INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH cfg AS (SELECT * FROM public.calif_config(p_periodo)),
  it AS (SELECT * FROM public.calif_items(p_periodo))
  SELECT i.persona_id,
         CASE WHEN COUNT(*) FILTER (WHERE i.cuenta) >= (SELECT minimo_tareas FROM cfg)
              THEN ROUND(100 * SUM(i.peso_efectivo * COALESCE(i.puntos, 0) / 10.0) FILTER (WHERE i.cuenta)
                              / NULLIF(SUM(i.peso_efectivo) FILTER (WHERE i.cuenta), 0), 1) END,
         (COUNT(*) FILTER (WHERE i.cuenta))::INT,
         (COUNT(*) FILTER (WHERE i.cuenta AND i.tipo = 'individual'))::INT,
         (COUNT(*) FILTER (WHERE i.cuenta AND i.tipo = 'equipo'))::INT,
         COALESCE(SUM(i.peso_efectivo) FILTER (WHERE i.cuenta), 0),
         (COUNT(*) FILTER (WHERE i.razon = 'pendiente_de_evaluacion'))::INT,
         (COUNT(*) FILTER (WHERE i.razon IN ('en_curso','devuelta','bloqueada')))::INT,
         (COUNT(*) FILTER (WHERE i.razon IN ('vencida','vencida_como_cero')))::INT,
         (COUNT(*) FILTER (WHERE i.razon IN ('tarea_anulada','nota_anulada')))::INT,
         COUNT(*) FILTER (WHERE i.cuenta) >= (SELECT minimo_tareas FROM cfg),
         (SELECT minimo_tareas FROM cfg)
    FROM it i
   GROUP BY i.persona_id;
$$;
REVOKE EXECUTE ON FUNCTION public.calif_puntaje(UUID) FROM PUBLIC, anon, authenticated;


-- ── 3. Visibilidad ────────────────────────────────────────────────────
--  Quién ve la calificación de quién: la propia persona, su secretaría (distrito) y la administración.
CREATE OR REPLACE FUNCTION public.calif_puede_ver(p_persona UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_admin() OR p_persona = auth.uid()
    OR (public.is_secretario() AND p_persona IN (SELECT public.get_district_member_ids())));
$$;
REVOKE EXECUTE ON FUNCTION public.calif_puede_ver(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.calif_puede_ver(UUID) TO authenticated;

--  Desglose de UNA persona en un PE: cada pieza, si cuenta, su peso y cuánto aporta a su nota de tareas.
--    aporte_pct    : % del componente de tareas que sale de esa pieza (suma 100 entre las que cuentan)
--    aporte_puntos : puntos (sobre 100) que esa pieza pone en la nota de tareas
CREATE OR REPLACE FUNCTION public.tareas_calificacion_detalle(p_periodo UUID, p_persona UUID DEFAULT NULL)
RETURNS TABLE (
  tipo TEXT, tarea_id BIGINT, titulo TEXT, equipo_id BIGINT, equipo_nombre TEXT, estado TEXT, origen TEXT,
  puntos SMALLINT, nota_grupo SMALLINT, individual_en_grupo BOOLEAN, peso_tarea NUMERIC, peso_efectivo NUMERIC,
  cuenta BOOLEAN, razon TEXT, aporte_pct NUMERIC, aporte_puntos NUMERIC, fecha_limite DATE, aprobada_en TIMESTAMPTZ, vencida BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_p UUID := COALESCE(p_persona, auth.uid());
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  IF NOT public.calif_puede_ver(v_p) THEN RETURN; END IF;
  RETURN QUERY
  WITH it AS (SELECT * FROM public.calif_items(p_periodo) i WHERE i.persona_id = v_p),
       tot AS (SELECT NULLIF(SUM(x.peso_efectivo) FILTER (WHERE x.cuenta), 0) AS s FROM it x)
  SELECT i.tipo, i.tarea_id, i.titulo, i.equipo_id, i.equipo_nombre, i.estado, i.origen, i.puntos, i.nota_grupo,
         i.individual_en_grupo, i.peso_tarea, i.peso_efectivo, i.cuenta, i.razon,
         CASE WHEN i.cuenta THEN ROUND(100 * i.peso_efectivo / (SELECT s FROM tot), 1) END,
         CASE WHEN i.cuenta THEN ROUND(100 * i.peso_efectivo * COALESCE(i.puntos, 0) / 10.0 / (SELECT s FROM tot), 1) END,
         i.fecha_limite, i.aprobada_en, i.vencida
    FROM it i
   ORDER BY i.cuenta DESC, i.aprobada_en DESC NULLS LAST, i.fecha_limite NULLS LAST, i.tarea_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_calificacion_detalle(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tareas_calificacion_detalle(UUID, UUID) TO authenticated;

--  Una fila por persona visible (con su nota de tareas y los conteos). Es lo que lee Evaluar, Reportes y Seguimiento.
CREATE OR REPLACE FUNCTION public.tareas_calificacion_resumen(p_periodo UUID)
RETURNS TABLE (
  persona_id UUID, nota NUMERIC, n_cuentan INT, n_individuales INT, n_colectivas INT, suma_pesos NUMERIC,
  n_pendientes INT, n_abiertas INT, n_vencidas INT, n_anuladas INT, suficiente BOOLEAN, minimo INT,
  peso_tareas NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_peso NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  SELECT c.peso_tareas INTO v_peso FROM public.calif_config(p_periodo) c;
  RETURN QUERY
  SELECT s.persona_id, s.nota, s.n_cuentan, s.n_individuales, s.n_colectivas, s.suma_pesos, s.n_pendientes, s.n_abiertas,
         s.n_vencidas, s.n_anuladas, s.suficiente, s.minimo, v_peso
    FROM public.calif_puntaje(p_periodo) s
   WHERE public.calif_puede_ver(s.persona_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_calificacion_resumen(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tareas_calificacion_resumen(UUID) TO authenticated;

COMMIT;
