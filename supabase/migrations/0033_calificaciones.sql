-- ══════════════════════════════════════════════════════════════════════
--  0033 — Calificaciones de tareas: peso, anulación, justificación, historial y reglas por PE
-- ══════════════════════════════════════════════════════════════════════
--
--  CAUSA RAÍZ QUE ESTA SERIE CORRIGE (ver docs/auditoria-equipos-calificaciones.md)
--    0017 guardaba los puntos 0–10 de cada tarea aprobada y declaraba, por diseño, que «no entran solos en ninguna
--    fórmula de resultados_periodo()». Ninguna función, vista ni pantalla los llevaba a la evaluación: el dato
--    existía pero estaba desconectado. 0034 define el cálculo; 0035 lo integra en resultados_periodo(), de donde
--    leen el perfil, el panel, los reportes y el seguimiento. Esta migración pone la base:
--
--  1. TAREAS INDIVIDUALES (`tareas`): columnas `peso` (ponderación de la tarea; la fija quien asigna/revisa),
--     `puntos_original` (la nota con que se aprobó), anulación de la NOTA (la tarea sigue aprobada pero deja de
--     contar; conserva el motivo) y estado `anulada` (la tarea entera queda fuera de todo cómputo).
--     Los puntos YA NO se corrigen por UPDATE directo: solo con corregir_nota_tarea() y su justificación.
--
--  2. HISTORIAL (`calificaciones_historial`, append-only, solo lo escriben triggers): cada nota original, corrección,
--     anulación, restauración o reapertura, con quién, cuándo, por qué y qué ponderaciones regían en ese momento.
--     Una tarea con historial no se puede borrar.
--
--  3. FUNCIONES CON JUSTIFICACIÓN (solo administración): corregir_nota_tarea, anular_nota_tarea, restaurar_nota_tarea.
--     La nota individual dentro de un grupo (nota_individual_equipo) la ponen quien revisa la tarea o la administración;
--     por defecto cada integrante recibe la nota del grupo (no se inventan diferencias sin evidencia).
--
--  4. REGLAS DE CALIFICACIÓN POR PE (`periodo_calif_config`): cuánto pesan las tareas en el resultado, cómo se
--     ponderan las individuales frente a las colectivas, cuántas tareas calificadas hacen falta y cómo se tratan las
--     vencidas. Las edita SOLO la administración, con motivo si ya hay evaluaciones publicadas, y cada cambio queda en
--     `periodo_calif_config_hist`. Valores iniciales (documentados, provisionales, SIN CONFIRMAR hasta que la
--     administración los guarde):
--         · PE ya existentes:  peso_tareas = 0  → los resultados publicados NO cambian al aplicar esta migración.
--         · PE nuevos:         peso_tareas = 20 → provisional; la pantalla avisa «sin confirmar».
--         · todas las ponderaciones relativas = 1; mínimo de tareas = 1; vencidas NO cuentan como cero.
--
--  PUNTOS DE EMISIÓN DE AVISOS (los conecta la sesión de notificaciones; aquí NO se emite nada):
--    calificacion_nueva     → fila accion = 'calificada' en calificaciones_historial
--    calificacion_cambiada  → filas 'corregida', 'anulada', 'restaurada', 'reabierta', 'tarea_anulada', 'individual', 'individual_retirada'
--
--  Requiere 0016, 0017, 0031, 0032. Aplicación manual en el SQL Editor. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Columnas en tareas individuales ────────────────────────────────
ALTER TABLE public.tareas
  ADD COLUMN IF NOT EXISTS peso                NUMERIC(5,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS puntos_original     SMALLINT,
  ADD COLUMN IF NOT EXISTS nota_anulada_en     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nota_anulada_por    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nota_anulada_motivo TEXT,
  ADD COLUMN IF NOT EXISTS anulada_en          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anulada_por         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS anulacion_motivo    TEXT;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tareas_peso_chk') THEN
    ALTER TABLE public.tareas ADD CONSTRAINT tareas_peso_chk CHECK (peso > 0 AND peso <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tareas_puntos_original_chk') THEN
    ALTER TABLE public.tareas ADD CONSTRAINT tareas_puntos_original_chk CHECK (puntos_original IS NULL OR puntos_original BETWEEN 0 AND 10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tareas_motivos_chk') THEN
    ALTER TABLE public.tareas ADD CONSTRAINT tareas_motivos_chk CHECK (
      (nota_anulada_motivo IS NULL OR char_length(nota_anulada_motivo) <= 500)
      AND (anulacion_motivo IS NULL OR char_length(anulacion_motivo) <= 500));
  END IF;
END $chk$;

--  El estado gana «anulada».
ALTER TABLE public.tareas DROP CONSTRAINT IF EXISTS tareas_estado_check;
ALTER TABLE public.tareas ADD CONSTRAINT tareas_estado_check
  CHECK (estado IN ('asignada','en_curso','bloqueada','entregada','devuelta','aprobada','anulada'));

--  Las tareas aprobadas ANTES de esta migración conservan sus puntos como nota original (no se inventa nada).
UPDATE public.tareas SET puntos_original = puntos WHERE puntos IS NOT NULL AND puntos_original IS NULL AND estado = 'aprobada';

--  Matriz de transiciones de 0016 + «anulada» (quien revisa anula lo no aprobado; la administración, lo que sea).
CREATE OR REPLACE FUNCTION public.tarea_transicion_valida(p_rol TEXT, p_de TEXT, p_a TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_rol
    WHEN 'admin' THEN p_de <> p_a
    WHEN 'asignado' THEN
         (p_de = 'asignada' AND p_a IN ('en_curso','entregada','bloqueada'))
      OR (p_de = 'en_curso' AND p_a IN ('entregada','bloqueada'))
      OR (p_de = 'devuelta' AND p_a IN ('en_curso','entregada','bloqueada'))
      OR (p_de = 'bloqueada' AND p_a = 'en_curso')
    WHEN 'revisor' THEN
         (p_de = 'entregada' AND p_a IN ('aprobada','devuelta'))
      OR (p_de IN ('asignada','en_curso','devuelta') AND p_a = 'bloqueada')
      OR (p_de = 'bloqueada' AND p_a = 'en_curso')
      OR (p_de IN ('asignada','en_curso','bloqueada','entregada','devuelta') AND p_a = 'anulada')
    ELSE false
  END;
$$;


-- ── 2. Reglas de la nota (reemplaza tareas_puntos_validar de 0017; sigue corriendo al final: «zz_») ──
CREATE OR REPLACE FUNCTION public.tareas_puntos_validar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_rpc   BOOLEAN := COALESCE(current_setting('eight.nota_rpc', true), '') = '1';
  v_admin BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.puntos := NULL; NEW.puntos_original := NULL;                       -- una tarea nueva nunca nace puntuada
    NEW.nota_anulada_en := NULL; NEW.nota_anulada_por := NULL; NEW.nota_anulada_motivo := NULL;
    NEW.anulada_en := NULL; NEW.anulada_por := NULL; NEW.anulacion_motivo := NULL;
    -- El peso solo lo da quien asigna a otra persona; en una tarea propia vale 1 (no se infla el propio promedio).
    IF NEW.origen = 'propia' THEN NEW.peso := 1; END IF;
    RETURN NEW;
  END IF;

  v_admin := public.is_admin();
  IF OLD.estado = 'anulada' AND NOT v_admin THEN
    RAISE EXCEPTION 'Una tarea anulada no se modifica.' USING ERRCODE = '42501';
  END IF;

  -- Lo que fija el servidor.
  IF NOT v_rpc THEN NEW.puntos_original := OLD.puntos_original; END IF;
  NEW.anulada_en := OLD.anulada_en; NEW.anulada_por := OLD.anulada_por;
  IF NOT v_rpc THEN
    NEW.nota_anulada_en := OLD.nota_anulada_en; NEW.nota_anulada_por := OLD.nota_anulada_por; NEW.nota_anulada_motivo := OLD.nota_anulada_motivo;
  END IF;

  -- Peso: lo cambia quien revisa a la persona (o la administración); nunca la propia persona.
  IF NEW.peso IS DISTINCT FROM OLD.peso AND NOT (v_admin OR public.puede_revisar_tarea(OLD.asignada_a)) THEN
    RAISE EXCEPTION 'Solo quien revisa cambia el peso de una tarea.' USING ERRCODE = '42501';
  END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NEW.estado = 'aprobada' THEN
      IF NEW.puntos IS NULL THEN
        RAISE EXCEPTION 'Al aprobar una tarea asigna sus puntos (de 0 a 10).' USING ERRCODE = '23514';
      END IF;
      NEW.puntos_original := NEW.puntos;
      NEW.nota_anulada_en := NULL; NEW.nota_anulada_por := NULL; NEW.nota_anulada_motivo := NULL;
    ELSIF NEW.estado = 'anulada' THEN
      IF char_length(COALESCE(btrim(NEW.anulacion_motivo), '')) < 5 THEN
        RAISE EXCEPTION 'Anular una tarea necesita un motivo (minimo 5 caracteres).' USING ERRCODE = '23514';
      END IF;
      NEW.anulada_en := NOW(); NEW.anulada_por := auth.uid();
      NEW.puntos := OLD.puntos;                  -- la nota que tuviera se conserva (historia); una anulada no cuenta (0034)
    ELSE
      IF NEW.puntos IS NOT NULL AND NEW.puntos IS DISTINCT FROM OLD.puntos THEN
        RAISE EXCEPTION 'Los puntos se asignan al aprobar la tarea.' USING ERRCODE = '42501';
      END IF;
      NEW.puntos := NULL; NEW.puntos_original := NULL;    -- reabrir la nota la borra; el historial la conserva
      NEW.nota_anulada_en := NULL; NEW.nota_anulada_por := NULL; NEW.nota_anulada_motivo := NULL;
    END IF;
    IF OLD.estado = 'anulada' THEN
      NEW.anulada_en := NULL; NEW.anulada_por := NULL; NEW.anulacion_motivo := NULL;
    END IF;
  ELSE
    NEW.anulacion_motivo := OLD.anulacion_motivo;      -- el motivo de anulación solo viaja con la transición
    IF NEW.estado = 'aprobada' THEN
      IF NEW.puntos IS DISTINCT FROM OLD.puntos AND NOT v_rpc THEN
        RAISE EXCEPTION 'Los puntos de una tarea aprobada se corrigen con justificacion (corregir_nota_tarea), solo la administracion.' USING ERRCODE = '42501';
      END IF;
      IF NEW.puntos IS NULL AND OLD.puntos IS NOT NULL THEN
        RAISE EXCEPTION 'Una tarea aprobada necesita sus puntos.' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.puntos IS DISTINCT FROM OLD.puntos THEN
      RAISE EXCEPTION 'Los puntos se asignan al aprobar la tarea.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_puntos_validar() FROM PUBLIC, anon, authenticated;

--  El historial de estados de la tarea guarda también el motivo de la anulación.
CREATE OR REPLACE FUNCTION public.tareas_registrar_evento()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO tarea_eventos (tarea_id, actor_id, tipo, a, motivo)
    VALUES (NEW.id, auth.uid(), 'creada', NEW.estado, NEW.origen);
    RETURN NULL;
  END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    INSERT INTO tarea_eventos (tarea_id, actor_id, tipo, de, a, motivo)
    VALUES (NEW.id, auth.uid(), 'estado', OLD.estado, NEW.estado,
            CASE NEW.estado
              WHEN 'devuelta'   THEN NEW.revision_nota
              WHEN 'bloqueada'  THEN NEW.bloqueo_motivo
              WHEN 'entregada'  THEN COALESCE(NULLIF(btrim(NEW.entrega_nota), ''), NEW.entrega_url)
              WHEN 'anulada'    THEN NEW.anulacion_motivo
              ELSE NULL END);
  END IF;

  IF NEW.fecha_limite IS DISTINCT FROM OLD.fecha_limite THEN
    INSERT INTO tarea_eventos (tarea_id, actor_id, tipo, de, a, motivo)
    VALUES (NEW.id, auth.uid(), 'prorroga', OLD.fecha_limite::TEXT, NEW.fecha_limite::TEXT,
            current_setting('eight.tarea_motivo', true));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_registrar_evento() FROM PUBLIC, anon, authenticated;


-- ── 3. Reglas de calificación por PE ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.periodo_calif_config (
  periodo_id         UUID PRIMARY KEY REFERENCES public.periodos_evaluacion(id) ON DELETE CASCADE,
  peso_tareas        NUMERIC(5,2) NOT NULL DEFAULT 0   CHECK (peso_tareas BETWEEN 0 AND 100),   -- % del resultado que viene de las tareas
  mult_individual    NUMERIC(5,2) NOT NULL DEFAULT 1   CHECK (mult_individual > 0 AND mult_individual <= 100),
  mult_colectiva     NUMERIC(5,2) NOT NULL DEFAULT 1   CHECK (mult_colectiva > 0 AND mult_colectiva <= 100),
  minimo_tareas      INT          NOT NULL DEFAULT 1   CHECK (minimo_tareas BETWEEN 1 AND 50),
  contar_propias     BOOLEAN      NOT NULL DEFAULT true,
  vencidas_como_cero BOOLEAN      NOT NULL DEFAULT false,
  confirmado         BOOLEAN      NOT NULL DEFAULT false,
  actualizado_por    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.periodo_calif_config_hist (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  periodo_id UUID NOT NULL REFERENCES public.periodos_evaluacion(id) ON DELETE CASCADE,
  actor_id   UUID,
  antes      JSONB,
  despues    JSONB NOT NULL,
  motivo     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS periodo_calif_config_hist_idx ON public.periodo_calif_config_hist (periodo_id, created_at DESC);

--  PE v2 que ya existen: peso 0 (nada cambia hasta que la administración lo decida), sin confirmar.
INSERT INTO public.periodo_calif_config (periodo_id, peso_tareas, confirmado)
SELECT id, 0, false FROM public.periodos_evaluacion WHERE modelo = 'v2'
ON CONFLICT (periodo_id) DO NOTHING;

--  PE v2 nuevos: nacen con las reglas iniciales PROVISIONALES (peso_tareas = 20, sin confirmar).
CREATE OR REPLACE FUNCTION public.periodo_calif_config_inicial()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.modelo = 'v2' THEN
    INSERT INTO periodo_calif_config (periodo_id, peso_tareas, confirmado) VALUES (NEW.id, 20, false)
    ON CONFLICT (periodo_id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.periodo_calif_config_inicial() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS periodo_calif_config_inicial ON public.periodos_evaluacion;
CREATE TRIGGER periodo_calif_config_inicial AFTER INSERT OR UPDATE OF modelo ON public.periodos_evaluacion
  FOR EACH ROW EXECUTE FUNCTION public.periodo_calif_config_inicial();

--  Configuración vigente (con valores por defecto si el PE no tiene fila: peso 0).
CREATE OR REPLACE FUNCTION public.calif_config(p_periodo UUID)
RETURNS TABLE (peso_tareas NUMERIC, mult_individual NUMERIC, mult_colectiva NUMERIC, minimo_tareas INT,
               contar_propias BOOLEAN, vencidas_como_cero BOOLEAN, confirmado BOOLEAN, definida BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(c.peso_tareas, 0), COALESCE(c.mult_individual, 1), COALESCE(c.mult_colectiva, 1),
         COALESCE(c.minimo_tareas, 1), COALESCE(c.contar_propias, true), COALESCE(c.vencidas_como_cero, false),
         COALESCE(c.confirmado, false), c.periodo_id IS NOT NULL
    FROM (SELECT 1) x LEFT JOIN periodo_calif_config c ON c.periodo_id = p_periodo
   WHERE auth.uid() IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.calif_config(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.calif_config(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.calif_config_guardar(
  p_periodo UUID, p_peso_tareas NUMERIC, p_mult_individual NUMERIC DEFAULT 1, p_mult_colectiva NUMERIC DEFAULT 1,
  p_minimo_tareas INT DEFAULT 1, p_contar_propias BOOLEAN DEFAULT true, p_vencidas_como_cero BOOLEAN DEFAULT false,
  p_motivo TEXT DEFAULT NULL
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
                                    vencidas_como_cero, confirmado, actualizado_por, actualizado_en)
  VALUES (p_periodo, p_peso_tareas, p_mult_individual, p_mult_colectiva, p_minimo_tareas, COALESCE(p_contar_propias, true),
          COALESCE(p_vencidas_como_cero, false), true, auth.uid(), NOW())
  ON CONFLICT (periodo_id) DO UPDATE SET
    peso_tareas = EXCLUDED.peso_tareas, mult_individual = EXCLUDED.mult_individual, mult_colectiva = EXCLUDED.mult_colectiva,
    minimo_tareas = EXCLUDED.minimo_tareas, contar_propias = EXCLUDED.contar_propias,
    vencidas_como_cero = EXCLUDED.vencidas_como_cero, confirmado = true,
    actualizado_por = auth.uid(), actualizado_en = NOW();
  SELECT to_jsonb(c) - 'actualizado_por' - 'actualizado_en' INTO v_despues FROM periodo_calif_config c WHERE c.periodo_id = p_periodo;
  INSERT INTO periodo_calif_config_hist (periodo_id, actor_id, antes, despues, motivo)
  VALUES (p_periodo, auth.uid(), v_antes, v_despues, NULLIF(btrim(COALESCE(p_motivo, '')), ''));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.calif_config_guardar(UUID, NUMERIC, NUMERIC, NUMERIC, INT, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.calif_config_guardar(UUID, NUMERIC, NUMERIC, NUMERIC, INT, BOOLEAN, BOOLEAN, TEXT) TO authenticated;

ALTER TABLE public.periodo_calif_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.periodo_calif_config_hist ENABLE ROW LEVEL SECURITY;
--  Las reglas no son secretas: cualquier persona con sesión puede leerlas (así entiende cómo se calcula su resultado).
DROP POLICY IF EXISTS periodo_calif_config_select ON public.periodo_calif_config;
CREATE POLICY periodo_calif_config_select ON public.periodo_calif_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS periodo_calif_config_hist_select ON public.periodo_calif_config_hist;
CREATE POLICY periodo_calif_config_hist_select ON public.periodo_calif_config_hist FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.periodo_calif_config, public.periodo_calif_config_hist FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.periodo_calif_config, public.periodo_calif_config_hist FROM anon, authenticated;


-- ── 4. Historial de calificaciones ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calificaciones_historial (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tarea_tipo      TEXT   NOT NULL CHECK (tarea_tipo IN ('individual','equipo')),
  tarea_id        BIGINT NOT NULL,
  periodo_id      UUID   NOT NULL REFERENCES public.periodos_evaluacion(id) ON DELETE CASCADE,
  -- individual: la persona evaluada. equipo: NULL = nota del grupo; con valor = nota individual dentro del grupo.
  persona_id      UUID,
  accion          TEXT   NOT NULL CHECK (accion IN ('calificada','corregida','anulada','restaurada','reabierta','tarea_anulada','individual','individual_retirada')),
  puntos_anterior SMALLINT,
  puntos_nuevo    SMALLINT,
  motivo          TEXT,
  actor_id        UUID,
  contexto        JSONB  NOT NULL DEFAULT '{}'::jsonb,       -- peso de la tarea y reglas del PE vigentes en ese momento
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS calif_hist_tarea_idx ON public.calificaciones_historial (tarea_tipo, tarea_id, created_at);
CREATE INDEX IF NOT EXISTS calif_hist_persona_idx ON public.calificaciones_historial (persona_id, periodo_id);

ALTER TABLE public.calificaciones_historial ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calif_hist_select ON public.calificaciones_historial;
CREATE POLICY calif_hist_select ON public.calificaciones_historial FOR SELECT TO authenticated
  USING (public.is_admin()
         OR (tarea_tipo = 'individual' AND (persona_id = auth.uid()
               OR (public.is_secretario() AND persona_id IN (SELECT public.get_district_member_ids()))))
         OR (tarea_tipo = 'equipo' AND (
               (persona_id IS NULL AND public.tarea_equipo_visible(tarea_id))
               OR persona_id = auth.uid()
               OR public.puede_revisar_tarea_equipo(tarea_id))));
REVOKE ALL ON public.calificaciones_historial FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.calificaciones_historial FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.calif_historial_registrar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tipo   TEXT := CASE TG_TABLE_NAME WHEN 'tareas' THEN 'individual' ELSE 'equipo' END;
  v_persona UUID;
  v_accion TEXT; v_ant SMALLINT; v_nue SMALLINT; v_mot TEXT;
  v_cfg    RECORD;
BEGIN
  v_persona := CASE v_tipo WHEN 'individual' THEN (to_jsonb(NEW) ->> 'asignada_a')::UUID ELSE NULL END;
  IF NEW.estado = 'aprobada' AND OLD.estado IS DISTINCT FROM 'aprobada' THEN
    v_accion := 'calificada'; v_ant := NULL; v_nue := NEW.puntos;
  ELSIF NEW.estado = 'aprobada' AND OLD.estado = 'aprobada' AND NEW.puntos IS DISTINCT FROM OLD.puntos THEN
    v_accion := CASE WHEN OLD.puntos IS NULL THEN 'calificada' ELSE 'corregida' END;
    v_ant := OLD.puntos; v_nue := NEW.puntos; v_mot := NULLIF(current_setting('eight.nota_motivo', true), '');
  ELSIF NEW.estado = 'aprobada' AND OLD.estado = 'aprobada' AND NEW.nota_anulada_en IS NOT NULL AND OLD.nota_anulada_en IS NULL THEN
    v_accion := 'anulada'; v_ant := NEW.puntos; v_nue := NEW.puntos; v_mot := NEW.nota_anulada_motivo;
  ELSIF NEW.estado = 'aprobada' AND OLD.estado = 'aprobada' AND NEW.nota_anulada_en IS NULL AND OLD.nota_anulada_en IS NOT NULL THEN
    v_accion := 'restaurada'; v_ant := NEW.puntos; v_nue := NEW.puntos; v_mot := NULLIF(current_setting('eight.nota_motivo', true), '');
  ELSIF OLD.estado = 'aprobada' AND NEW.estado = 'anulada' THEN
    v_accion := 'tarea_anulada'; v_ant := OLD.puntos; v_nue := OLD.puntos; v_mot := NEW.anulacion_motivo;
  ELSIF OLD.estado = 'aprobada' AND NEW.estado <> 'aprobada' THEN
    v_accion := 'reabierta'; v_ant := OLD.puntos; v_nue := NULL;
  ELSE
    RETURN NULL;
  END IF;

  SELECT * INTO v_cfg FROM public.calif_config(NEW.periodo_id);
  INSERT INTO calificaciones_historial (tarea_tipo, tarea_id, periodo_id, persona_id, accion, puntos_anterior, puntos_nuevo, motivo, actor_id, contexto)
  VALUES (v_tipo, NEW.id, NEW.periodo_id, v_persona, v_accion, v_ant, v_nue, v_mot, auth.uid(),
          jsonb_build_object('titulo', NEW.titulo, 'peso_tarea', NEW.peso,
                             'peso_tareas_pct', v_cfg.peso_tareas, 'mult_individual', v_cfg.mult_individual, 'mult_colectiva', v_cfg.mult_colectiva,
                             'equipo_id', to_jsonb(NEW) -> 'equipo_id'));
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.calif_historial_registrar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS calif_historial_tareas ON public.tareas;
CREATE TRIGGER calif_historial_tareas AFTER UPDATE ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION public.calif_historial_registrar();
DROP TRIGGER IF EXISTS calif_historial_tareas_equipo ON public.tareas_equipo;
CREATE TRIGGER calif_historial_tareas_equipo AFTER UPDATE ON public.tareas_equipo
  FOR EACH ROW EXECUTE FUNCTION public.calif_historial_registrar();

--  Una tarea con historial de calificaciones no se borra: se anula.
CREATE OR REPLACE FUNCTION public.tarea_no_borrar_con_notas()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM calificaciones_historial h
              WHERE h.tarea_tipo = CASE TG_TABLE_NAME WHEN 'tareas' THEN 'individual' ELSE 'equipo' END AND h.tarea_id = OLD.id) THEN
    RAISE EXCEPTION 'Esta tarea tiene historial de calificaciones: no se borra, se anula.' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tarea_no_borrar_con_notas() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tarea_no_borrar_con_notas ON public.tareas;
CREATE TRIGGER tarea_no_borrar_con_notas BEFORE DELETE ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION public.tarea_no_borrar_con_notas();
DROP TRIGGER IF EXISTS tarea_no_borrar_con_notas ON public.tareas_equipo;
CREATE TRIGGER tarea_no_borrar_con_notas BEFORE DELETE ON public.tareas_equipo
  FOR EACH ROW EXECUTE FUNCTION public.tarea_no_borrar_con_notas();


-- ── 5. Funciones de nota con justificación ────────────────────────────
--  Una sola entrada para los dos tipos de tarea. Solo la administración corrige, anula o restaura.
CREATE OR REPLACE FUNCTION public.calif_actuar(p_accion TEXT, p_tipo TEXT, p_id BIGINT, p_puntos INT, p_motivo TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_estado TEXT; v_puntos SMALLINT; v_anulada TIMESTAMPTZ; v_periodo UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo la administracion corrige, anula o restaura una calificacion.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo NOT IN ('individual','equipo') THEN RAISE EXCEPTION 'Tipo de tarea desconocido.' USING ERRCODE = '22023'; END IF;
  IF char_length(COALESCE(btrim(p_motivo), '')) < 5 THEN
    RAISE EXCEPTION 'Toda modificacion de una calificacion necesita su justificacion (minimo 5 caracteres).' USING ERRCODE = '23514';
  END IF;

  IF p_tipo = 'individual' THEN
    SELECT estado, puntos, nota_anulada_en, periodo_id INTO v_estado, v_puntos, v_anulada, v_periodo FROM tareas WHERE id = p_id FOR UPDATE;
  ELSE
    SELECT estado, puntos, nota_anulada_en, periodo_id INTO v_estado, v_puntos, v_anulada, v_periodo FROM tareas_equipo WHERE id = p_id FOR UPDATE;
  END IF;
  IF v_estado IS NULL THEN RAISE EXCEPTION 'No existe esa tarea.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.gestion_escribible(v_periodo) THEN
    RAISE EXCEPTION 'Esta gestion esta archivada: solo lectura.' USING ERRCODE = '42501';
  END IF;
  IF v_estado <> 'aprobada' THEN
    RAISE EXCEPTION 'Solo una tarea aprobada tiene calificacion que modificar.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('eight.nota_rpc', '1', true);
  PERFORM set_config('eight.nota_motivo', btrim(p_motivo), true);
  IF p_accion = 'corregir' THEN
    IF p_puntos IS NULL OR p_puntos < 0 OR p_puntos > 10 THEN
      RAISE EXCEPTION 'Los puntos van de 0 a 10.' USING ERRCODE = '23514';
    END IF;
    IF v_anulada IS NOT NULL THEN
      RAISE EXCEPTION 'La calificacion esta anulada: restaurala antes de corregirla.' USING ERRCODE = '23514';
    END IF;
    IF p_puntos IS NOT DISTINCT FROM v_puntos THEN
      RAISE EXCEPTION 'Indica unos puntos distintos a los actuales.' USING ERRCODE = '22023';
    END IF;
    IF p_tipo = 'individual' THEN
      UPDATE tareas SET puntos = p_puntos, puntos_original = COALESCE(puntos_original, p_puntos) WHERE id = p_id;
    ELSE
      UPDATE tareas_equipo SET puntos = p_puntos WHERE id = p_id;
    END IF;
  ELSIF p_accion = 'anular' THEN
    IF v_puntos IS NULL THEN RAISE EXCEPTION 'Esa tarea no tiene calificacion que anular.' USING ERRCODE = '23514'; END IF;
    IF v_anulada IS NOT NULL THEN RAISE EXCEPTION 'La calificacion ya esta anulada.' USING ERRCODE = '23514'; END IF;
    IF p_tipo = 'individual' THEN
      UPDATE tareas SET nota_anulada_en = NOW(), nota_anulada_por = auth.uid(), nota_anulada_motivo = btrim(p_motivo) WHERE id = p_id;
    ELSE
      UPDATE tareas_equipo SET nota_anulada_en = NOW(), nota_anulada_por = auth.uid(), nota_anulada_motivo = btrim(p_motivo) WHERE id = p_id;
    END IF;
  ELSIF p_accion = 'restaurar' THEN
    IF v_anulada IS NULL THEN RAISE EXCEPTION 'La calificacion no esta anulada.' USING ERRCODE = '23514'; END IF;
    IF p_tipo = 'individual' THEN
      UPDATE tareas SET nota_anulada_en = NULL, nota_anulada_por = NULL, nota_anulada_motivo = NULL WHERE id = p_id;
    ELSE
      UPDATE tareas_equipo SET nota_anulada_en = NULL, nota_anulada_por = NULL, nota_anulada_motivo = NULL WHERE id = p_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Accion desconocida.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('eight.nota_rpc', '', true);
  PERFORM set_config('eight.nota_motivo', '', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.calif_actuar(TEXT, TEXT, BIGINT, INT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.corregir_nota_tarea(p_tipo TEXT, p_id BIGINT, p_puntos INT, p_motivo TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT public.calif_actuar('corregir', p_tipo, p_id, p_puntos, p_motivo) $$;
CREATE OR REPLACE FUNCTION public.anular_nota_tarea(p_tipo TEXT, p_id BIGINT, p_motivo TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT public.calif_actuar('anular', p_tipo, p_id, NULL, p_motivo) $$;
CREATE OR REPLACE FUNCTION public.restaurar_nota_tarea(p_tipo TEXT, p_id BIGINT, p_motivo TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT public.calif_actuar('restaurar', p_tipo, p_id, NULL, p_motivo) $$;
REVOKE EXECUTE ON FUNCTION public.corregir_nota_tarea(TEXT, BIGINT, INT, TEXT), public.anular_nota_tarea(TEXT, BIGINT, TEXT),
  public.restaurar_nota_tarea(TEXT, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.corregir_nota_tarea(TEXT, BIGINT, INT, TEXT), public.anular_nota_tarea(TEXT, BIGINT, TEXT),
  public.restaurar_nota_tarea(TEXT, BIGINT, TEXT) TO authenticated;

--  Nota individual dentro de un grupo. NULL en p_puntos = vuelve a valer la nota del grupo. Exige evidencia escrita
--  (el motivo): no se inventan diferencias de rendimiento.
CREATE OR REPLACE FUNCTION public.nota_individual_equipo(p_tarea BIGINT, p_persona UUID, p_puntos INT, p_motivo TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  t tareas_equipo%ROWTYPE; pa tarea_equipo_participantes%ROWTYPE; v_ant SMALLINT; v_cfg RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM tareas_equipo WHERE id = p_tarea FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe esa tarea.' USING ERRCODE = 'P0002'; END IF;
  IF NOT (public.is_admin() OR public.puede_revisar_tarea_equipo(p_tarea)) THEN
    RAISE EXCEPTION 'No puedes calificar a las personas de esta tarea.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.gestion_escribible(t.periodo_id) THEN
    RAISE EXCEPTION 'Esta gestion esta archivada: solo lectura.' USING ERRCODE = '42501';
  END IF;
  IF t.estado <> 'aprobada' THEN
    RAISE EXCEPTION 'La nota individual se pone cuando la tarea ya esta aprobada.' USING ERRCODE = '23514';
  END IF;
  IF char_length(COALESCE(btrim(p_motivo), '')) < 10 THEN
    RAISE EXCEPTION 'Una nota individual distinta a la del grupo necesita su evidencia o motivo (minimo 10 caracteres).' USING ERRCODE = '23514';
  END IF;
  IF p_puntos IS NOT NULL AND (p_puntos < 0 OR p_puntos > 10) THEN
    RAISE EXCEPTION 'Los puntos van de 0 a 10.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO pa FROM tarea_equipo_participantes WHERE tarea_id = p_tarea AND persona_id = p_persona FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa persona no participa en la tarea.' USING ERRCODE = '23514'; END IF;
  v_ant := pa.puntos_individual;
  IF p_puntos IS NOT DISTINCT FROM v_ant THEN RAISE EXCEPTION 'No hay cambio que registrar.' USING ERRCODE = '22023'; END IF;
  UPDATE tarea_equipo_participantes
     SET puntos_individual = p_puntos,
         individual_motivo = CASE WHEN p_puntos IS NULL THEN NULL ELSE btrim(p_motivo) END,
         individual_por = auth.uid(), individual_en = NOW()
   WHERE tarea_id = p_tarea AND persona_id = p_persona;
  SELECT * INTO v_cfg FROM public.calif_config(t.periodo_id);
  INSERT INTO calificaciones_historial (tarea_tipo, tarea_id, periodo_id, persona_id, accion, puntos_anterior, puntos_nuevo, motivo, actor_id, contexto)
  VALUES ('equipo', p_tarea, t.periodo_id, p_persona, CASE WHEN p_puntos IS NULL THEN 'individual_retirada' ELSE 'individual' END,
          COALESCE(v_ant, t.puntos), p_puntos, btrim(p_motivo), auth.uid(),
          jsonb_build_object('titulo', t.titulo, 'peso_tarea', t.peso, 'nota_grupo', t.puntos, 'equipo_id', t.equipo_id,
                             'peso_tareas_pct', v_cfg.peso_tareas, 'mult_colectiva', v_cfg.mult_colectiva));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.nota_individual_equipo(BIGINT, UUID, INT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.nota_individual_equipo(BIGINT, UUID, INT, TEXT) TO authenticated;

COMMIT;


-- ══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- ══════════════════════════════════════════════════════════════════════
--   SELECT periodo_id, peso_tareas, confirmado FROM periodo_calif_config;    -- los PE existentes en 0 y sin confirmar
--   SET ROLE anon; SELECT count(*) FROM calificaciones_historial;           -- permiso denegado
-- DOWN (comentado): conservar el historial; no hay reversa automática de las columnas porque los datos de nota dependen de ellas.
-- ══════════════════════════════════════════════════════════════════════
