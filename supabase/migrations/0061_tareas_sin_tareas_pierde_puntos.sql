-- ══════════════════════════════════════════════════════════════════════
--  0061 — Tareas: opción «sin tareas calificadas, se pierden los puntos de tareas»
-- ══════════════════════════════════════════════════════════════════════
--
--  PEDIDO. Las tareas son un apartado del resultado con su propio peso (peso_tareas, p. ej. 15 puntos de 100). Hasta ahora, quien no
--  tenía tareas calificadas que contaran conservaba su evaluación al 100 % (el peso no se aplicaba). La administración quiere que ese
--  apartado se PIERDA: sin tareas calificadas, la nota de tareas es 0 y el peso sigue aplicando.
--
--  QUÉ HACE. Regla nueva por PE: `periodo_calif_config.sin_tareas_pierde_puntos` (DEFAULT false: NADA cambia hasta que la administración
--  la active). Con la regla activa, la persona evaluada que no tenga nota de tareas (ninguna tarea que cuente, o menos que
--  `minimo_tareas`) recibe nota de tareas 0 con el peso completo:
--      individual = (1 − w)·(0.6·técnico + 0.4·núcleo) + w·0        w = peso_tareas / 100
--  `resultados_periodo()` devuelve entonces tareas = 0 y peso_tareas = w para esa persona. Solo afecta a personas con evaluación.
--  Con la regla apagada el resultado es EXACTAMENTE el de antes (prueba de paridad en sql-0061.mjs).
--
--  QUÉ CAMBIA. `calif_config()` devuelve una columna más; `calif_config_guardar()` recibe un parámetro más (al final, con DEFAULT, así
--  que los clientes anteriores siguen funcionando) y se retira la versión de 8 parámetros; `resultados_periodo()` se recrea con el cambio.
--  Cambiar la regla con evaluaciones publicadas exige motivo (ya lo exige calif_config_guardar) y queda en el historial.
--
--  Aplicar DESPUÉS de 0035 (y de 0053–0060). Idempotente. Reversa al final.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.periodo_calif_config ADD COLUMN IF NOT EXISTS sin_tareas_pierde_puntos BOOLEAN NOT NULL DEFAULT false;

-- ── 1. calif_config (una columna más) ─────────────────────────────────
DROP FUNCTION IF EXISTS public.calif_config(UUID);
CREATE FUNCTION public.calif_config(p_periodo UUID)
RETURNS TABLE (peso_tareas NUMERIC, mult_individual NUMERIC, mult_colectiva NUMERIC, minimo_tareas INT,
               contar_propias BOOLEAN, vencidas_como_cero BOOLEAN, confirmado BOOLEAN, definida BOOLEAN, sin_tareas_pierde_puntos BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(c.peso_tareas, 0), COALESCE(c.mult_individual, 1), COALESCE(c.mult_colectiva, 1),
         COALESCE(c.minimo_tareas, 1), COALESCE(c.contar_propias, true), COALESCE(c.vencidas_como_cero, false),
         COALESCE(c.confirmado, false), c.periodo_id IS NOT NULL, COALESCE(c.sin_tareas_pierde_puntos, false)
    FROM (SELECT 1) x LEFT JOIN periodo_calif_config c ON c.periodo_id = p_periodo
   WHERE auth.uid() IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.calif_config(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.calif_config(UUID) TO authenticated;

-- ── 2. calif_config_guardar (un parámetro más, al final) ──────────────
DROP FUNCTION IF EXISTS public.calif_config_guardar(UUID, NUMERIC, NUMERIC, NUMERIC, INT, BOOLEAN, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.calif_config_guardar(UUID, NUMERIC, NUMERIC, NUMERIC, INT, BOOLEAN, BOOLEAN, TEXT, BOOLEAN);
CREATE FUNCTION public.calif_config_guardar(
  p_periodo UUID, p_peso_tareas NUMERIC, p_mult_individual NUMERIC DEFAULT 1, p_mult_colectiva NUMERIC DEFAULT 1,
  p_minimo_tareas INT DEFAULT 1, p_contar_propias BOOLEAN DEFAULT true, p_vencidas_como_cero BOOLEAN DEFAULT false,
  p_motivo TEXT DEFAULT NULL, p_sin_tareas_pierde_puntos BOOLEAN DEFAULT false
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_antes JSONB; v_despues JSONB; v_pub BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo la administracion define las reglas de calificacion.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT modelo FROM periodos_evaluacion WHERE id = p_periodo) IS DISTINCT FROM 'v2' THEN
    RAISE EXCEPTION 'Las reglas de tareas solo existen en PE con la rubrica por roles.' USING ERRCODE = '23514';
  END IF;
  IF NOT public.gestion_escribible(p_periodo) THEN
    RAISE EXCEPTION 'Esta gestion esta archivada: solo lectura.' USING ERRCODE = '42501';
  END IF;
  IF p_peso_tareas IS NULL OR p_peso_tareas < 0 OR p_peso_tareas > 100 THEN
    RAISE EXCEPTION 'El peso de las tareas va de 0 a 100 %%.' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_mult_individual, 0) <= 0 OR COALESCE(p_mult_colectiva, 0) <= 0 THEN
    RAISE EXCEPTION 'Las ponderaciones relativas deben ser mayores que 0.' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_minimo_tareas, 0) < 1 THEN
    RAISE EXCEPTION 'El minimo de tareas calificadas es 1 o mas.' USING ERRCODE = '23514';
  END IF;
  v_pub := EXISTS (SELECT 1 FROM evaluaciones WHERE periodo_id = p_periodo AND estado = 'publicado');
  IF v_pub AND char_length(COALESCE(btrim(p_motivo), '')) < 5 THEN
    RAISE EXCEPTION 'Ya hay evaluaciones publicadas: cambiar las reglas cambia sus resultados; explica el motivo (minimo 5 caracteres).' USING ERRCODE = '23514';
  END IF;

  SELECT to_jsonb(c) - 'actualizado_por' - 'actualizado_en' INTO v_antes FROM periodo_calif_config c WHERE c.periodo_id = p_periodo;
  INSERT INTO periodo_calif_config (periodo_id, peso_tareas, mult_individual, mult_colectiva, minimo_tareas, contar_propias,
                                    vencidas_como_cero, sin_tareas_pierde_puntos, confirmado, actualizado_por, actualizado_en)
  VALUES (p_periodo, p_peso_tareas, p_mult_individual, p_mult_colectiva, p_minimo_tareas, COALESCE(p_contar_propias, true),
          COALESCE(p_vencidas_como_cero, false), COALESCE(p_sin_tareas_pierde_puntos, false), true, auth.uid(), NOW())
  ON CONFLICT (periodo_id) DO UPDATE SET
    peso_tareas = EXCLUDED.peso_tareas, mult_individual = EXCLUDED.mult_individual, mult_colectiva = EXCLUDED.mult_colectiva,
    minimo_tareas = EXCLUDED.minimo_tareas, contar_propias = EXCLUDED.contar_propias,
    vencidas_como_cero = EXCLUDED.vencidas_como_cero, sin_tareas_pierde_puntos = EXCLUDED.sin_tareas_pierde_puntos, confirmado = true,
    actualizado_por = auth.uid(), actualizado_en = NOW();
  SELECT to_jsonb(c) - 'actualizado_por' - 'actualizado_en' INTO v_despues FROM periodo_calif_config c WHERE c.periodo_id = p_periodo;
  INSERT INTO periodo_calif_config_hist (periodo_id, actor_id, antes, despues, motivo)
  VALUES (p_periodo, auth.uid(), v_antes, v_despues, NULLIF(btrim(COALESCE(p_motivo, '')), ''));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.calif_config_guardar(UUID, NUMERIC, NUMERIC, NUMERIC, INT, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.calif_config_guardar(UUID, NUMERIC, NUMERIC, NUMERIC, INT, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) TO authenticated;

-- ── 3. resultados_periodo (misma definición que 0035, con la regla) ───
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
  tareas          NUMERIC,     -- nota de tareas 0–100 (NULL si no hay suficientes y la regla no las cuenta como 0; 0 si sin_tareas_pierde_puntos)
  tareas_n        INT,         -- tareas que cuentan
  peso_tareas     NUMERIC      -- % del resultado que aportan las tareas A ESTA PERSONA (0 si tareas es NULL)
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_admin   BOOLEAN;
  v_gestion BIGINT;
  v_peso    NUMERIC;
  v_pierde  BOOLEAN;
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
  SELECT c.peso_tareas, c.sin_tareas_pierde_puntos INTO v_peso, v_pierde FROM public.calif_config(p_periodo) c;

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
           CASE WHEN tp.nota IS NOT NULL OR COALESCE(v_pierde, false) THEN v_peso / 100 ELSE 0 END AS w
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
         CASE WHEN c.w > 0 THEN COALESCE(c.t_nota, 0) ELSE c.t_nota END,
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

-- ── REVERSA ───────────────────────────────────────────────────────────
-- 1) UPDATE public.periodo_calif_config SET sin_tareas_pierde_puntos = false;   (los resultados vuelven a los de antes)
-- 2) Para volver a las funciones de 0033/0035 sin la regla: DROP de calif_config(UUID), calif_config_guardar(... 9 parámetros),
--    resultados_periodo(UUID, BOOLEAN) y reaplicar 0033 (secciones 3) y 0035 (sección 1). La columna puede quedarse (inofensiva).
