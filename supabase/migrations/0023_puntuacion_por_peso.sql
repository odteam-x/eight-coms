-- ══════════════════════════════════════════════════════════════════════
--  0023 — Puntuación por peso: cada criterio puntúa de 0 a su propio peso
-- ══════════════════════════════════════════════════════════════════════
--
--  QUÉ CAMBIA (rúbrica por roles, v2)
--    Antes todos los criterios puntuaban de 1 a 5 y el peso solo ponderaba. Ahora, en las evaluaciones
--    NUEVAS, la persona que evalúa mueve una barra de 0 hasta el PESO del criterio:
--      · Técnico con peso 30  → se puntúa de 0 a 30. Si se puntúan todos, los pesos suman 100 y el técnico
--        es la suma de puntos (0–100). Si alguno no aplica o es opcional y queda sin puntuar, queda fuera del
--        cálculo (nunca vale 0): técnico = Σ puntos · 100 / Σ pesos de los puntuados.
--      · Núcleo → 0 a 10 por criterio; todos pesan igual (promedio de puntos/10).
--    Individual = 0.6·Técnico + 0.4·Núcleo, percentil y general: igual que en 0015. Solo cambia de dónde sale
--    cada 0–100.
--
--  HISTORIA PRESERVADA (nada se reescribe)
--    · `evaluaciones.escala`: 'cinco' (la de siempre, 1–5) o 'pesos' (la nueva). Las evaluaciones que existen al
--      aplicar esta migración quedan en 'cinco' y se calculan EXACTAMENTE como antes; una evaluación ya empezada
--      en 'cinco' se sigue guardando en 'cinco'. Solo las que se crean desde ahora son 'pesos'.
--    · La escala la fija el servidor en el primer guardado (como el perfil): lo que mande el cliente se ignora.
--    · Un período puede mezclar evaluaciones de las dos escalas: el cálculo normaliza cada una a 0–100 antes
--      de comparar (percentil incluido).
--
--  VALIDACIÓN EN LA BASE
--    'pesos': entero de 0 a su peso (técnico, según el perfil de ESA evaluación) o de 0 a 10 (núcleo).
--    'cinco': entero de 1 a 5, como antes. Publicar exige lo mismo que antes (obligatorios puntuados).
--
--  resultados_periodo() gana la columna `escala` (se recrea: cambia su tipo de retorno). Mismas reglas de
--  visibilidad y guardia (IF auth.uid() IS NULL THEN RAISE).
--  Aplicación manual en el SQL Editor, tras 0020. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.evaluaciones ADD COLUMN IF NOT EXISTS escala TEXT NOT NULL DEFAULT 'cinco';   -- lo existente = 'cinco'
ALTER TABLE public.evaluaciones ALTER COLUMN escala SET DEFAULT 'pesos';                         -- lo nuevo = 'pesos'
DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evaluaciones_escala_chk') THEN
    ALTER TABLE public.evaluaciones ADD CONSTRAINT evaluaciones_escala_chk CHECK (escala IN ('cinco', 'pesos'));
  END IF;
END
$chk$;

-- ── Validación (la de 0020 + escala) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.evaluaciones_validar_modelo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_modelo  TEXT;
  v_gestion BIGINT;
  v_rol     BIGINT;
  v_clave   TEXT;
  v_val     JSONB;
  v_num     NUMERIC;
  v_faltan  TEXT;
  v_faltan2 TEXT;
  v_c       RECORD;
  v_viejo   JSONB;
  v_tipo    TEXT;
  v_max     INT;
BEGIN
  SELECT modelo, gestion_id INTO v_modelo, v_gestion
    FROM periodos_evaluacion WHERE id = NEW.periodo_id;
  NEW.modelo := COALESCE(v_modelo, 'legacy');

  IF NEW.modelo <> 'v2' THEN
    NEW.escala := 'cinco';   -- sin significado fuera de v2
    NEW.perfil_id := NULL;
    NEW.respuestas := '{}'::jsonb;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.bono_ext, 0) <> 0 THEN
    RAISE EXCEPTION 'La rubrica v2 no tiene bono.' USING ERRCODE = '23514';
  END IF;

  -- Escala: la fija el servidor en el primer guardado y no cambia. Lo guardado antes de 0023 sigue siendo 'cinco'
  -- (1 a 5); lo nuevo es 'pesos' (cada criterio puntúa de 0 a su propio peso). Lo que mande el cliente se ignora.
  IF TG_OP = 'UPDATE' THEN NEW.escala := OLD.escala; ELSE NEW.escala := 'pesos'; END IF;

  -- Perfil: se fija en el primer guardado y no cambia.
  IF TG_OP = 'UPDATE' AND OLD.perfil_id IS NOT NULL THEN
    NEW.perfil_id := OLD.perfil_id;
  ELSE
    SELECT rol_id INTO v_rol FROM profiles WHERE id = NEW.evaluado_id;
    IF v_rol IS NULL THEN
      RAISE EXCEPTION 'La persona evaluada no tiene un rol asignado.' USING ERRCODE = '23514';
    END IF;
    NEW.perfil_id := public.perfil_vigente(v_rol, NEW.periodo_id);
    IF NEW.perfil_id IS NULL THEN
      RAISE EXCEPTION 'No hay un perfil de evaluacion vigente para ese rol en este periodo.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF jsonb_typeof(NEW.puntajes) <> 'object' THEN
    RAISE EXCEPTION 'puntajes debe ser un objeto.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(COALESCE(NEW.respuestas, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'respuestas debe ser un objeto.' USING ERRCODE = '23514';
  END IF;
  NEW.respuestas := COALESCE(NEW.respuestas, '{}'::jsonb);

  -- Puntajes: solo criterios de escala del nucleo o del perfil. Los desactivados despues siguen
  -- valiendo si ya estaban en la evaluacion (historia), pero no se agregan a una nueva.
  FOR v_clave, v_val IN SELECT key, value FROM jsonb_each(NEW.puntajes) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM criterios_v2 c
       WHERE c.gestion_id = v_gestion AND c.key = v_clave AND c.tipo_campo = 'escala'
         AND (c.activo OR (TG_OP = 'UPDATE' AND OLD.puntajes ? v_clave))
         AND (c.tipo = 'nucleo'
              OR v_clave IN (SELECT criterio_key FROM perfil_criterios WHERE perfil_id = NEW.perfil_id))
    ) THEN
      RAISE EXCEPTION 'El criterio "%" no aplica a este perfil.', v_clave USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(v_val) <> 'number' THEN
      RAISE EXCEPTION 'El puntaje de "%" debe ser un numero.', v_clave USING ERRCODE = '23514';
    END IF;
    v_num := (v_val #>> '{}')::NUMERIC;
    IF v_num <> trunc(v_num) THEN
      RAISE EXCEPTION 'El puntaje de "%" debe ser un numero entero.', v_clave USING ERRCODE = '23514';
    END IF;
    IF NEW.escala = 'cinco' THEN
      IF v_num < 1 OR v_num > 5 THEN
        RAISE EXCEPTION 'El puntaje de "%" debe ser un entero de 1 a 5.', v_clave USING ERRCODE = '23514';
      END IF;
    ELSE
      -- Nucleo: 0 a 10 (todos pesan igual). Tecnico: 0 a su peso en el perfil de la evaluacion.
      SELECT c.tipo INTO v_tipo FROM criterios_v2 c WHERE c.gestion_id = v_gestion AND c.key = v_clave;
      IF v_tipo = 'nucleo' THEN
        v_max := 10;
      ELSE
        SELECT pc.peso INTO v_max FROM perfil_criterios pc WHERE pc.perfil_id = NEW.perfil_id AND pc.criterio_key = v_clave;
      END IF;
      IF v_num < 0 OR v_num > COALESCE(v_max, 0) THEN
        RAISE EXCEPTION 'El puntaje de "%" debe ser un entero de 0 a %.', v_clave, COALESCE(v_max, 0) USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;

  -- Respuestas: campos de registro del catalogo, con el tipo que declaran.
  FOR v_clave, v_val IN SELECT key, value FROM jsonb_each(NEW.respuestas) LOOP
    SELECT * INTO v_c FROM criterios_v2 c
     WHERE c.gestion_id = v_gestion AND c.key = v_clave AND c.tipo_campo <> 'escala'
       AND (c.activo OR (TG_OP = 'UPDATE' AND OLD.respuestas ? v_clave));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El campo "%" no aplica a esta evaluacion.', v_clave USING ERRCODE = '23514';
    END IF;
    IF v_c.tipo_campo = 'si_no' THEN
      IF jsonb_typeof(v_val) <> 'boolean' THEN
        RAISE EXCEPTION 'La respuesta de "%" debe ser si o no.', v_c.nombre USING ERRCODE = '23514';
      END IF;
    ELSIF v_c.tipo_campo = 'opcion' THEN
      IF jsonb_typeof(v_val) <> 'string' OR NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_c.opciones) o WHERE o = v_val) THEN
        RAISE EXCEPTION 'La respuesta de "%" debe ser una de sus opciones.', v_c.nombre USING ERRCODE = '23514';
      END IF;
    ELSE
      IF jsonb_typeof(v_val) <> 'string' OR btrim(v_val #>> '{}') = '' OR char_length(v_val #>> '{}') > 1000 THEN
        RAISE EXCEPTION 'La respuesta de "%" debe ser un texto de hasta 1000 caracteres.', v_c.nombre USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;

  IF NEW.estado = 'publicado' THEN
    -- Solo lo obligatorio y vigente: lo opcional sin responder se omite (no vale 0).
    SELECT string_agg(c.nombre, ', ' ORDER BY c.orden) INTO v_faltan
      FROM criterios_v2 c
     WHERE c.gestion_id = v_gestion AND c.activo AND c.obligatorio AND c.tipo_campo = 'escala'
       AND (c.tipo = 'nucleo'
            OR c.key IN (SELECT criterio_key FROM perfil_criterios WHERE perfil_id = NEW.perfil_id))
       AND NOT (NEW.puntajes ? c.key);
    SELECT string_agg(c.nombre, ', ' ORDER BY c.orden) INTO v_faltan2
      FROM criterios_v2 c
     WHERE c.gestion_id = v_gestion AND c.activo AND c.obligatorio AND c.tipo_campo <> 'escala'
       AND NOT (NEW.respuestas ? c.key);
    IF v_faltan IS NOT NULL OR v_faltan2 IS NOT NULL THEN
      RAISE EXCEPTION 'No se puede publicar: faltan por puntuar: %. Faltan por completar: %.',
        COALESCE(v_faltan, 'nada'), COALESCE(v_faltan2, 'nada') USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.evaluaciones_validar_modelo() FROM PUBLIC, anon, authenticated;

-- ── Resultados: normaliza cada escala a 0–100 ──────────────────────────
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
  escala      TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_admin   BOOLEAN;
  v_gestion BIGINT;
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
  )
  SELECT c.evaluado_id, c.nombre, c.distrito, c.rol_id, c.rol_nombre, c.perfil_id, c.estado,
         ROUND(c.nucleo, 1),
         ROUND(c.tecnico, 1),
         ROUND(0.6 * c.tecnico + 0.4 * c.nucleo, 1),
         ROUND(c.percentil, 1),
         ROUND(0.4 * c.nucleo + 0.6 * COALESCE(c.percentil, c.tecnico), 1),
         c.n_rol::INT,
         c.rol_pequeno,
         c.escala
    FROM calc c
   WHERE v_admin
      OR c.evaluado_id = auth.uid()
      OR (public.is_secretario() AND c.evaluado_id IN (SELECT public.get_district_member_ids()));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.resultados_periodo(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resultados_periodo(UUID, BOOLEAN) TO authenticated;

COMMIT;

-- ── Reversa manual (solo si ninguna evaluación 'pesos' existe todavía) ──
-- 1. Reaplicar evaluaciones_validar_modelo() de 0020 y resultados_periodo() de 0015.
-- 2. ALTER TABLE public.evaluaciones DROP CONSTRAINT evaluaciones_escala_chk, DROP COLUMN escala;
