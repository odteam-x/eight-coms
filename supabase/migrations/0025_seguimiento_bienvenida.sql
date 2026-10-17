-- ══════════════════════════════════════════════════════════════════════
--  0025 — Seguimiento global de los períodos y asistente de bienvenida
-- ══════════════════════════════════════════════════════════════════════
--
--  1. seguimiento_global(): una fila por persona × período de la gestión, con el estado de su evaluación,
--     su resultado y los hechos de sus tareas. Es lo que alimenta la vista «Seguimiento» (todos los PE
--     agrupados por rol). EL ACCESO LO DECIDE LA BASE:
--          administración  → todas las personas;
--          secretaría      → las de su distrito;
--          miembro         → solo la propia fila (su historial).
--     Sin sesión → error. Nadie puede pedir «más» pasando otro parámetro: no hay parámetro de persona.
--     Qué se muestra de la evaluación también depende de quién mira:
--          · la administración ve borradores (con su puntaje, marcados);
--          · el resto solo ve resultados PUBLICADOS: un borrador aparece como «sin publicar».
--     No calcula nada nuevo: el resultado v2 sale de resultados_periodo() (0015/0023), el clásico es la
--     suma de sus puntajes más el bono (lo mismo que ya hacía la interfaz) y las tareas usan las mismas
--     definiciones de resumen_tareas_periodo() (0016).
--
--  1b. reporte_actividades(): por actividad y por persona, los hechos de las tareas vinculadas a ella (tareas.actividad_id,
--     0021). Con esto el reporte «Por actividad» suma numeradores y denominadores en un solo sitio, con las mismas
--     definiciones que seguimiento_global(). Mismo control de acceso: administración todo; secretaría, las personas de su
--     distrito; miembro, solo lo suyo. Una actividad visible sin tareas sale con una fila sin persona (todo en 0).
--
--  2. bienvenida_estado: dónde va cada persona en el asistente de bienvenida (pasos hechos, paso actual,
--     omitido, terminado). Se guarda con bienvenida_guardar(), que fija el perfil según el rol funcional REAL
--     de quien llama. Hay DOS recorridos y la fila dice cuál le toca a cada persona (`origen`):
--        · 'nuevo'     — quien llega después de esta migración: la bienvenida completa (se abre sola);
--        · 'existente' — quien ya usaba el portal: «Novedades», solo lo que cambió (se abre sola una vez, sin
--                        obligar: puede dejarla para después y retomarla desde Inicio o Mi cuenta).
--
--  Requiere 0015 y 0016; reporte_actividades() necesita además 0021 (tareas.actividad_id) y 0024 (alcance de actividades).
--  Aplicación manual en el SQL Editor, tras 0024. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Seguimiento global ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.seguimiento_global(BIGINT);
CREATE FUNCTION public.seguimiento_global(p_gestion BIGINT DEFAULT NULL)
RETURNS TABLE (
  persona_id UUID, nombre TEXT, distrito TEXT, rol_id BIGINT, rol_nombre TEXT,
  periodo_id UUID, periodo_nombre TEXT, periodo_orden INT, modelo TEXT, periodo_activo BOOLEAN,
  participa BOOLEAN, estado_eval TEXT,
  nucleo NUMERIC, tecnico NUMERIC, individual NUMERIC, general NUMERIC, total_clasico NUMERIC,
  tareas_total INT, tareas_abiertas INT, tareas_vencidas INT, tareas_aprobadas INT,
  con_plazo INT, a_tiempo INT, puntos_suma INT, puntos_n INT
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
    SELECT per.id AS periodo_id, r.evaluado_id, r.rol_id, r.nucleo, r.tecnico, r.individual, r.general, r.estado
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
           COUNT(*)::INT AS total,
           COUNT(*) FILTER (WHERE t.estado IN ('asignada','en_curso','devuelta','bloqueada'))::INT AS abiertas,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NULL AND t.estado IN ('asignada','en_curso')
                              AND t.fecha_limite IS NOT NULL
                              AND t.fecha_limite < (NOW() AT TIME ZONE public.zona_periodo(t.periodo_id))::DATE)::INT AS vencidas,
           COUNT(*) FILTER (WHERE t.estado = 'aprobada')::INT AS aprobadas,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NOT NULL AND t.fecha_limite IS NOT NULL)::INT AS con_plazo,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NOT NULL AND t.fecha_limite IS NOT NULL
                              AND (t.entregada_en AT TIME ZONE public.zona_periodo(t.periodo_id))::DATE <= t.fecha_limite)::INT AS a_tiempo,
           COALESCE(SUM(t.puntos) FILTER (WHERE t.estado = 'aprobada' AND t.puntos IS NOT NULL), 0)::INT AS puntos_suma,
           COUNT(*) FILTER (WHERE t.estado = 'aprobada' AND t.puntos IS NOT NULL)::INT AS puntos_n
      FROM tareas t JOIN per ON per.id = t.periodo_id
     WHERE t.asignada_a IN (SELECT q.id FROM quienes q)
     GROUP BY t.periodo_id, t.asignada_a
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
         COALESCE(tk.con_plazo, 0), COALESCE(tk.a_tiempo, 0), COALESCE(tk.puntos_suma, 0), COALESCE(tk.puntos_n, 0)
    FROM quienes q
    CROSS JOIN per
    LEFT JOIN v2 ON v2.periodo_id = per.id AND v2.evaluado_id = q.id
    LEFT JOIN cl ON cl.periodo_id = per.id AND cl.evaluado_id = q.id
    LEFT JOIN tk ON tk.periodo_id = per.id AND tk.asignada_a = q.id
    LEFT JOIN roles ro ON ro.id = COALESCE(v2.rol_id, q.rol_id)
   ORDER BY ro.nombre NULLS LAST, q.nombre, per.orden;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.seguimiento_global(BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.seguimiento_global(BIGINT) TO authenticated;

-- ── 1b. Reporte por actividad ─────────────────────────────────────────
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
           COUNT(*) FILTER (WHERE t.origen = 'asignada')::INT AS asignadas,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NOT NULL)::INT AS entregadas,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NOT NULL AND t.fecha_limite IS NOT NULL)::INT AS con_plazo,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NOT NULL AND t.fecha_limite IS NOT NULL
                              AND (t.entregada_en AT TIME ZONE public.zona_periodo(t.periodo_id))::DATE <= t.fecha_limite)::INT AS a_tiempo,
           COUNT(*) FILTER (WHERE t.estado = 'aprobada')::INT AS aprobadas,
           COUNT(*) FILTER (WHERE t.origen = 'asignada' AND t.entregada_en IS NULL AND t.estado IN ('asignada','en_curso')
                              AND t.fecha_limite IS NOT NULL
                              AND t.fecha_limite < (NOW() AT TIME ZONE public.zona_periodo(t.periodo_id))::DATE)::INT AS vencidas,
           COALESCE(SUM(t.puntos) FILTER (WHERE t.estado = 'aprobada' AND t.puntos IS NOT NULL), 0)::INT AS puntos_suma,
           COUNT(*) FILTER (WHERE t.estado = 'aprobada' AND t.puntos IS NOT NULL)::INT AS puntos_n
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

-- ── 2. Asistente de bienvenida ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bienvenida_estado (
  persona_id    UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  perfil        TEXT NOT NULL CHECK (perfil IN ('miembro','secretario','admin')),
  origen        TEXT NOT NULL DEFAULT 'nuevo' CHECK (origen IN ('nuevo','existente')),
  version       SMALLINT NOT NULL DEFAULT 1,
  pasos_hechos  TEXT[] NOT NULL DEFAULT '{}',
  paso_actual   TEXT,
  omitida       BOOLEAN NOT NULL DEFAULT false,
  completada_en TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.bienvenida_estado ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bienvenida_leer ON public.bienvenida_estado;
CREATE POLICY bienvenida_leer ON public.bienvenida_estado FOR SELECT TO authenticated
  USING (persona_id = auth.uid() OR public.is_admin());
REVOKE ALL ON public.bienvenida_estado FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.bienvenida_estado FROM authenticated;

--  Guarda el avance de quien llama. El perfil del asistente sale de su rol funcional REAL, no de lo que diga el cliente.
CREATE OR REPLACE FUNCTION public.bienvenida_guardar(
  p_pasos TEXT[], p_actual TEXT DEFAULT NULL, p_omitir BOOLEAN DEFAULT false, p_terminar BOOLEAN DEFAULT false
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_perfil TEXT;
  v_pasos TEXT[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  v_perfil := CASE WHEN public.is_admin() THEN 'admin' WHEN public.is_secretario() THEN 'secretario' ELSE 'miembro' END;
  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_pasos FROM unnest(COALESCE(p_pasos, '{}')) AS x;
  IF array_length(v_pasos, 1) > 20 OR EXISTS (SELECT 1 FROM unnest(v_pasos) AS x WHERE x !~ '^[a-z0-9_-]{1,40}$') THEN
    RAISE EXCEPTION 'Pasos no validos.' USING ERRCODE = '23514';
  END IF;
  IF p_actual IS NOT NULL AND p_actual !~ '^[a-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Paso no valido.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO bienvenida_estado (persona_id, perfil, pasos_hechos, paso_actual, omitida, completada_en)
  VALUES (v_uid, v_perfil, v_pasos, p_actual, COALESCE(p_omitir, false), CASE WHEN p_terminar THEN NOW() END)
  ON CONFLICT (persona_id) DO UPDATE SET
    perfil        = EXCLUDED.perfil,
    pasos_hechos  = EXCLUDED.pasos_hechos,
    paso_actual   = EXCLUDED.paso_actual,
    omitida       = EXCLUDED.omitida,
    completada_en = CASE WHEN p_terminar THEN COALESCE(bienvenida_estado.completada_en, NOW()) ELSE bienvenida_estado.completada_en END,
    updated_at    = NOW();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bienvenida_guardar(TEXT[], TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bienvenida_guardar(TEXT[], TEXT, BOOLEAN, BOOLEAN) TO authenticated;

--  Volver a empezar: borra el avance de quien llama (no el de nadie más).
CREATE OR REPLACE FUNCTION public.bienvenida_reiniciar() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  DELETE FROM bienvenida_estado WHERE persona_id = auth.uid();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bienvenida_reiniciar() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bienvenida_reiniciar() TO authenticated;

--  Quien ya existía cuando se aplica esta migración recibe el recorrido de «Novedades» (origen = 'existente'),
--  no la bienvenida de quien llega por primera vez. Si la tabla ya existía de antes, se agrega la columna.
ALTER TABLE public.bienvenida_estado ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'nuevo';
INSERT INTO public.bienvenida_estado (persona_id, perfil, origen, omitida)
SELECT p.id,
       CASE WHEN COALESCE(p.es_admin, false) THEN 'admin' WHEN p.tipo_miembro = 'secretario' THEN 'secretario' ELSE 'miembro' END,
       'existente', false
  FROM public.profiles p
ON CONFLICT (persona_id) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (después de aplicar)
-- ══════════════════════════════════════════════════════════════════════
--   SELECT count(*) FROM bienvenida_estado WHERE origen = 'existente';   -- = personas que ya existían
--   -- Con sesión de una persona miembro, seguimiento_global() devuelve solo sus filas.
-- ══════════════════════════════════════════════════════════════════════
-- DESHACER (comentado)
-- DROP FUNCTION seguimiento_global(BIGINT); DROP FUNCTION reporte_actividades(BIGINT); DROP FUNCTION bienvenida_guardar(TEXT[],TEXT,BOOLEAN,BOOLEAN);
-- DROP FUNCTION bienvenida_reiniciar(); DROP TABLE bienvenida_estado;
