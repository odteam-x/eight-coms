-- ══════════════════════════════════════════════════════════════════════
--  0032 — Tareas colectivas: una tarea para un equipo completo
-- ══════════════════════════════════════════════════════════════════════
--
--  DISEÑO (por qué una tabla nueva y no copias de `tareas`)
--    Una tarea colectiva es UNA sola fila (`tareas_equipo`), compartida por todo el equipo. NO se crea una copia
--    por integrante: sería N estados que se contradicen, N entregas del mismo trabajo y N notas iguales. Las
--    personas se relacionan con la tarea por `tarea_equipo_participantes` (quién la ve y quién cuenta), y lo que
--    hace cada una queda en `tarea_equipo_aportes` (autoría real: la fija el servidor, nunca el cliente).
--    `tareas` (individuales, 0016) no cambia: sus triggers, políticas y pantallas siguen igual.
--
--  QUIÉN HACE QUÉ (lo imponen los triggers y las políticas, no el cliente)
--    · Administración : asigna a cualquier equipo, revisa, ajusta y reabre.
--    · Secretaría     : asigna y revisa SOLO las tareas de equipos cuyo ámbito (`equipos.distrito`) es su distrito, y
--                       nunca una tarea en la que ella participa. Los equipos sin distrito (transversales) son de la
--                       administración. (Decisión provisional y documentada: ver CLAUDE.md.)
--    · Integrante     : ve la tarea desde su cuenta, la mueve hasta «entregada», aporta avances y evidencias. No
--                       aprueba, no devuelve, no toca plazo ni contenido.
--
--  ESTADOS: asignada → en_curso → entregada → aprobada | devuelta, más bloqueada (espera a un tercero; exige motivo;
--  no cuenta como atraso) y anulada (la deja fuera de todo cómputo; exige motivo; solo la administración la reabre).
--  Una tarea se completa SOLO por una transición persistida con reglas verificables; abrir una pantalla o marcar algo
--  en el navegador no cambia nada.
--
--  ENTREGA: la registra cualquier integrante vigente; queda quién entregó (`entregada_por`), cuándo y con qué
--  enlace/nota. Archivos: el sistema no almacena archivos de tareas; la evidencia es un enlace http(s) y/o una nota.
--  La PRIMERA entrega mide el plazo (como en 0016).
--
--  ALTAS Y BAJAS DE INTEGRANTES (política):
--    · Al crear la tarea, participan quienes son integrantes vigentes del equipo en ese momento.
--    · Quien entra al equipo después se suma a las tareas todavía ABIERTAS (asignada, en_curso, bloqueada,
--      devuelta); no a las entregadas ni cerradas.
--    · Quien sale pierde la participación en lo abierto o entregado; lo aprobado/anulado no cambia. Para efectos de la
--      nota, cuenta quien participaba al aprobarse O dejó al menos un aporte (0034). Nada se borra.
--
--  PUNTOS: 0–10, obligatorios al aprobar, fijados por quien aprueba. Las correcciones, anulaciones y la nota
--  individual dentro del grupo van por funciones con justificación (0033).
--
--  PUNTOS DE EMISIÓN DE AVISOS (los conecta la sesión de notificaciones; aquí NO se emite nada):
--    tarea_colectiva_asignada → fila 'creada' en tarea_equipo_eventos (los destinatarios son tarea_equipo_participantes)
--    tarea_cambio             → filas 'responsable', 'instrucciones', 'prorroga' en tarea_equipo_eventos
--    entrega_registrada       → fila 'estado' con a = 'entregada' (actor = quien entregó)
--    correccion_solicitada    → fila 'estado' con a = 'devuelta' (motivo = observación)
--    observacion_nueva        → fila 'aporte' con tipo 'comentario' en tarea_equipo_eventos
--    estado_cambiado          → cualquier fila 'estado'
--    tarea_por_vencer/vencida → por tiempo: tareas_equipo WHERE estado IN ('asignada','en_curso','devuelta') y fecha_limite
--
--  GUARDIAS: sin sesión se deniega (nunca `auth.uid() IS NOT NULL AND ...`, ver 0008); funciones revocadas a PUBLIC (0010);
--  escritura gateada por gestion_escribible(periodo_id). Solo PE v2 (lo hereda del equipo).
--
--  Requiere 0016 y 0031. Aplicación manual en el SQL Editor. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Tablas ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tareas_equipo (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipo_id             BIGINT NOT NULL REFERENCES public.equipos(id) ON DELETE RESTRICT,
  periodo_id            UUID   NOT NULL REFERENCES public.periodos_evaluacion(id) ON DELETE RESTRICT,
  titulo                TEXT   NOT NULL CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 160),
  descripcion           TEXT   NOT NULL DEFAULT '' CHECK (char_length(descripcion) <= 4000),
  instrucciones         TEXT   NOT NULL DEFAULT '' CHECK (char_length(instrucciones) <= 4000),
  criterios_evaluacion  TEXT   NOT NULL DEFAULT '' CHECK (char_length(criterios_evaluacion) <= 2000),
  criterios             TEXT[] NOT NULL DEFAULT '{}',          -- claves del catálogo v2 que evidencia (orientativo)
  prioridad             TEXT   NOT NULL DEFAULT 'normal' CHECK (prioridad IN ('baja','normal','alta')),
  responsable_id        UUID   REFERENCES public.profiles(id) ON DELETE SET NULL,   -- seguimiento
  asignada_por          UUID   REFERENCES public.profiles(id) ON DELETE SET NULL,
  asignada_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_limite          DATE,
  fecha_limite_original DATE,
  estado                TEXT   NOT NULL DEFAULT 'asignada'
                        CHECK (estado IN ('asignada','en_curso','bloqueada','entregada','devuelta','aprobada','anulada')),
  entrega_url           TEXT   CHECK (entrega_url IS NULL OR (char_length(entrega_url) <= 2000
                                       AND entrega_url ~* '^https?://[^[:space:]]+$')),
  entrega_nota          TEXT   CHECK (entrega_nota IS NULL OR char_length(entrega_nota) <= 2000),
  entregada_por         UUID   REFERENCES public.profiles(id) ON DELETE SET NULL,
  entregada_en          TIMESTAMPTZ,
  revision_nota         TEXT   CHECK (revision_nota IS NULL OR char_length(revision_nota) <= 2000),
  bloqueo_motivo        TEXT   CHECK (bloqueo_motivo IS NULL OR char_length(bloqueo_motivo) <= 500),
  rondas_revision       INT    NOT NULL DEFAULT 0 CHECK (rondas_revision >= 0),
  aprobada_en           TIMESTAMPTZ,
  aprobada_por          UUID   REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Nota del grupo (0–10) y cómo pesa esta tarea frente a otras (ponderación, la fija quien asigna/revisa).
  puntos                SMALLINT CHECK (puntos IS NULL OR puntos BETWEEN 0 AND 10),
  puntos_original       SMALLINT CHECK (puntos_original IS NULL OR puntos_original BETWEEN 0 AND 10),
  peso                  NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK (peso > 0 AND peso <= 100),
  nota_anulada_en       TIMESTAMPTZ,
  nota_anulada_por      UUID   REFERENCES public.profiles(id) ON DELETE SET NULL,
  nota_anulada_motivo   TEXT   CHECK (nota_anulada_motivo IS NULL OR char_length(nota_anulada_motivo) <= 500),
  anulada_en            TIMESTAMPTZ,
  anulada_por           UUID   REFERENCES public.profiles(id) ON DELETE SET NULL,
  anulacion_motivo      TEXT   CHECK (anulacion_motivo IS NULL OR char_length(anulacion_motivo) <= 500),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tareas_equipo_equipo_idx  ON public.tareas_equipo (equipo_id);
CREATE INDEX IF NOT EXISTS tareas_equipo_periodo_idx ON public.tareas_equipo (periodo_id);

CREATE TABLE IF NOT EXISTS public.tarea_equipo_participantes (
  tarea_id          BIGINT NOT NULL REFERENCES public.tareas_equipo(id) ON DELETE CASCADE,
  persona_id        UUID   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  desde             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hasta             TIMESTAMPTZ,
  -- Nota individual dentro del grupo (0033). NULL = vale la nota del grupo. Solo con evidencia y justificación.
  puntos_individual SMALLINT CHECK (puntos_individual IS NULL OR puntos_individual BETWEEN 0 AND 10),
  individual_motivo TEXT   CHECK (individual_motivo IS NULL OR char_length(individual_motivo) <= 500),
  individual_por    UUID   REFERENCES public.profiles(id) ON DELETE SET NULL,
  individual_en     TIMESTAMPTZ,
  PRIMARY KEY (tarea_id, persona_id),
  CHECK (hasta IS NULL OR hasta >= desde)
);
CREATE INDEX IF NOT EXISTS tarea_equipo_part_persona_idx ON public.tarea_equipo_participantes (persona_id);

CREATE TABLE IF NOT EXISTS public.tarea_equipo_aportes (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tarea_id   BIGINT NOT NULL REFERENCES public.tareas_equipo(id) ON DELETE CASCADE,
  persona_id UUID   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,   -- la fija el servidor = quien llama
  tipo       TEXT   NOT NULL CHECK (tipo IN ('avance','evidencia','comentario')),
  nota       TEXT   CHECK (nota IS NULL OR char_length(nota) <= 2000),
  url        TEXT   CHECK (url IS NULL OR (char_length(url) <= 2000 AND url ~* '^https?://[^[:space:]]+$')),
  avance     SMALLINT CHECK (avance IS NULL OR avance BETWEEN 0 AND 100),         -- % que reporta quien aporta
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (COALESCE(btrim(nota), '') <> '' OR COALESCE(btrim(url), '') <> '' OR avance IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS tarea_equipo_aportes_tarea_idx ON public.tarea_equipo_aportes (tarea_id, created_at);

CREATE TABLE IF NOT EXISTS public.tarea_equipo_eventos (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tarea_id   BIGINT NOT NULL REFERENCES public.tareas_equipo(id) ON DELETE CASCADE,
  actor_id   UUID,
  tipo       TEXT   NOT NULL CHECK (tipo IN ('creada','estado','prorroga','responsable','instrucciones','contenido',
                                              'participante_alta','participante_baja','aporte')),
  persona_id UUID,
  de         TEXT,
  a          TEXT,
  motivo     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tarea_equipo_eventos_tarea_idx ON public.tarea_equipo_eventos (tarea_id, created_at);


-- ── 2. Ayudantes de permisos (SECURITY DEFINER: evitan políticas circulares) ──
CREATE OR REPLACE FUNCTION public.soy_participante_tarea_equipo(p_tarea BIGINT, p_solo_vigente BOOLEAN DEFAULT true)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM tarea_equipo_participantes p
                  WHERE p.tarea_id = p_tarea AND p.persona_id = auth.uid()
                    AND (NOT p_solo_vigente OR p.hasta IS NULL));
$$;

--  Revisa (asigna, aprueba, devuelve): la administración, o la secretaría del distrito AMBITO del equipo, si no
--  participa en la tarea (nadie revisa lo suyo).
CREATE OR REPLACE FUNCTION public.puede_revisar_tarea_equipo(p_tarea BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_admin()
    OR (public.is_secretario()
        AND EXISTS (SELECT 1 FROM tareas_equipo t JOIN equipos e ON e.id = t.equipo_id
                     WHERE t.id = p_tarea AND e.distrito IS NOT NULL AND e.distrito = public.mi_distrito())
        AND NOT EXISTS (SELECT 1 FROM tarea_equipo_participantes p WHERE p.tarea_id = p_tarea AND p.persona_id = auth.uid())));
$$;

CREATE OR REPLACE FUNCTION public.puede_asignar_a_equipo(p_equipo BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_admin()
    OR (public.is_secretario()
        AND EXISTS (SELECT 1 FROM equipos e WHERE e.id = p_equipo AND e.distrito IS NOT NULL AND e.distrito = public.mi_distrito())
        AND NOT EXISTS (SELECT 1 FROM equipo_miembros m WHERE m.equipo_id = p_equipo AND m.persona_id = auth.uid() AND m.hasta IS NULL)));
$$;

CREATE OR REPLACE FUNCTION public.tarea_equipo_visible(p_tarea BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_admin()
    OR public.soy_participante_tarea_equipo(p_tarea, false)
    OR EXISTS (SELECT 1 FROM tareas_equipo t WHERE t.id = p_tarea AND t.responsable_id = auth.uid())
    OR EXISTS (SELECT 1 FROM tareas_equipo t WHERE t.id = p_tarea AND public.equipo_de_mi_distrito(t.equipo_id)));
$$;
REVOKE EXECUTE ON FUNCTION public.soy_participante_tarea_equipo(BIGINT, BOOLEAN), public.puede_revisar_tarea_equipo(BIGINT),
  public.puede_asignar_a_equipo(BIGINT), public.tarea_equipo_visible(BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.soy_participante_tarea_equipo(BIGINT, BOOLEAN), public.puede_revisar_tarea_equipo(BIGINT),
  public.puede_asignar_a_equipo(BIGINT), public.tarea_equipo_visible(BIGINT) TO authenticated;


-- ── 3. Matriz de transiciones ─────────────────────────────────────────
--  p_rol: 'asignado' (integrante) | 'revisor' | 'admin'. Es la de 0016 más «anulada».
CREATE OR REPLACE FUNCTION public.tarea_equipo_transicion_valida(p_rol TEXT, p_de TEXT, p_a TEXT)
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


-- ── 4. INSERT: el servidor decide quién es quién ──────────────────────
CREATE OR REPLACE FUNCTION public.tareas_equipo_validar_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_eq    equipos%ROWTYPE;
  v_gest  BIGINT;
  v_malas TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_eq FROM equipos WHERE id = NEW.equipo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe ese equipo.' USING ERRCODE = 'P0002'; END IF;
  NEW.periodo_id := v_eq.periodo_id;                    -- el PE es el del equipo; lo que mande el cliente se ignora
  IF NOT public.gestion_escribible(NEW.periodo_id) THEN
    RAISE EXCEPTION 'Esta gestion esta archivada: solo lectura.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT modelo FROM periodos_evaluacion WHERE id = NEW.periodo_id) IS DISTINCT FROM 'v2' THEN
    RAISE EXCEPTION 'Las tareas solo existen en periodos con la rubrica por roles.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.puede_asignar_a_equipo(NEW.equipo_id) THEN
    RAISE EXCEPTION 'No puedes asignar tareas a este equipo.' USING ERRCODE = '42501';
  END IF;
  IF v_eq.estado <> 'activo' THEN
    RAISE EXCEPTION 'Solo se asignan tareas a un equipo activo.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM equipo_miembros WHERE equipo_id = NEW.equipo_id AND hasta IS NULL) THEN
    RAISE EXCEPTION 'El equipo no tiene integrantes vigentes.' USING ERRCODE = '23514';
  END IF;
  IF NEW.responsable_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM equipo_miembros WHERE equipo_id = NEW.equipo_id AND persona_id = NEW.responsable_id AND hasta IS NULL) THEN
    RAISE EXCEPTION 'La persona responsable del seguimiento debe ser integrante vigente del equipo.' USING ERRCODE = '23514';
  END IF;

  NEW.asignada_por := v_uid;
  NEW.asignada_en  := NOW();
  NEW.estado       := 'asignada';
  NEW.fecha_limite_original := NEW.fecha_limite;
  NEW.titulo := btrim(NEW.titulo);
  NEW.entrega_url := NULL; NEW.entrega_nota := NULL; NEW.entregada_por := NULL; NEW.entregada_en := NULL;
  NEW.revision_nota := NULL; NEW.bloqueo_motivo := NULL; NEW.rondas_revision := 0;
  NEW.aprobada_en := NULL; NEW.aprobada_por := NULL;
  NEW.puntos := NULL; NEW.puntos_original := NULL;
  NEW.nota_anulada_en := NULL; NEW.nota_anulada_por := NULL; NEW.nota_anulada_motivo := NULL;
  NEW.anulada_en := NULL; NEW.anulada_por := NULL; NEW.anulacion_motivo := NULL;

  SELECT gestion_id INTO v_gest FROM periodos_evaluacion WHERE id = NEW.periodo_id;
  SELECT string_agg(k, ', ') INTO v_malas
    FROM unnest(NEW.criterios) AS k
   WHERE NOT EXISTS (SELECT 1 FROM criterios_v2 c WHERE c.gestion_id = v_gest AND c.key = k);
  IF v_malas IS NOT NULL THEN
    RAISE EXCEPTION 'Criterios desconocidos: %.', v_malas USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_equipo_validar_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tareas_equipo_validar_insert ON public.tareas_equipo;
CREATE TRIGGER tareas_equipo_validar_insert BEFORE INSERT ON public.tareas_equipo
  FOR EACH ROW EXECUTE FUNCTION public.tareas_equipo_validar_insert();

--  Quienes son integrantes vigentes al crear la tarea, participan. Una sola vez, en la misma transacción.
CREATE OR REPLACE FUNCTION public.tareas_equipo_participantes_inicial()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO tarea_equipo_participantes (tarea_id, persona_id, desde)
  SELECT NEW.id, m.persona_id, NEW.asignada_en FROM equipo_miembros m
   WHERE m.equipo_id = NEW.equipo_id AND m.hasta IS NULL
  ON CONFLICT (tarea_id, persona_id) DO NOTHING;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_equipo_participantes_inicial() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tareas_equipo_participantes_inicial ON public.tareas_equipo;
CREATE TRIGGER tareas_equipo_participantes_inicial AFTER INSERT ON public.tareas_equipo
  FOR EACH ROW EXECUTE FUNCTION public.tareas_equipo_participantes_inicial();


-- ── 5. UPDATE: transiciones, campos y nota según quién actúa ──────────
CREATE OR REPLACE FUNCTION public.tareas_equipo_validar_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_admin    BOOLEAN;
  v_revisor  BOOLEAN;
  v_part     BOOLEAN;
  v_rol      TEXT;
  v_rpc      BOOLEAN := COALESCE(current_setting('eight.teq_rpc', true), '') = '1';
  v_nota_rpc BOOLEAN := COALESCE(current_setting('eight.nota_rpc', true), '') = '1';
  v_contenido BOOLEAN;
  v_malas    TEXT;
  v_gest     BIGINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  IF NOT public.gestion_escribible(OLD.periodo_id) THEN
    RAISE EXCEPTION 'Esta gestion esta archivada: solo lectura.' USING ERRCODE = '42501';
  END IF;

  v_admin   := public.is_admin();
  v_revisor := public.puede_revisar_tarea_equipo(OLD.id);
  v_part    := public.soy_participante_tarea_equipo(OLD.id, true);
  IF NOT (v_admin OR v_revisor OR v_part) THEN
    RAISE EXCEPTION 'No tienes acceso a esta tarea.' USING ERRCODE = '42501';
  END IF;
  v_rol := CASE WHEN v_admin THEN 'admin' WHEN v_revisor THEN 'revisor' ELSE 'asignado' END;

  IF OLD.estado IN ('aprobada','anulada') AND NOT v_admin THEN
    RAISE EXCEPTION 'Una tarea % no se modifica.', OLD.estado USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.equipo_id IS DISTINCT FROM OLD.equipo_id
     OR NEW.periodo_id IS DISTINCT FROM OLD.periodo_id OR NEW.asignada_por IS DISTINCT FROM OLD.asignada_por
     OR NEW.asignada_en IS DISTINCT FROM OLD.asignada_en
     OR NEW.fecha_limite_original IS DISTINCT FROM OLD.fecha_limite_original
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Esos campos de la tarea no se pueden cambiar.' USING ERRCODE = '42501';
  END IF;

  -- Lo que fija el servidor: se parte de lo que había.
  NEW.entregada_en := OLD.entregada_en;   NEW.entregada_por := OLD.entregada_por;
  NEW.aprobada_en := OLD.aprobada_en;     NEW.aprobada_por := OLD.aprobada_por;
  NEW.rondas_revision := OLD.rondas_revision;
  NEW.puntos_original := OLD.puntos_original;
  IF NOT v_nota_rpc THEN     -- la anulación de la nota solo la mueven las funciones de 0033
    NEW.nota_anulada_en := OLD.nota_anulada_en; NEW.nota_anulada_por := OLD.nota_anulada_por; NEW.nota_anulada_motivo := OLD.nota_anulada_motivo;
  END IF;
  NEW.anulada_en := OLD.anulada_en;       NEW.anulada_por := OLD.anulada_por;

  -- Contenido (título, textos, criterios, prioridad, responsable, peso): quien revisa. El peso de una tarea ya
  -- aprobada, además, solo lo cambia la administración (cambia el resultado de las personas).
  v_contenido := NEW.titulo IS DISTINCT FROM OLD.titulo OR NEW.descripcion IS DISTINCT FROM OLD.descripcion
              OR NEW.instrucciones IS DISTINCT FROM OLD.instrucciones OR NEW.criterios_evaluacion IS DISTINCT FROM OLD.criterios_evaluacion
              OR NEW.criterios IS DISTINCT FROM OLD.criterios OR NEW.prioridad IS DISTINCT FROM OLD.prioridad
              OR NEW.responsable_id IS DISTINCT FROM OLD.responsable_id OR NEW.peso IS DISTINCT FROM OLD.peso;
  IF v_contenido AND NOT (v_admin OR v_revisor) THEN
    RAISE EXCEPTION 'No puedes editar el contenido de una tarea que le asignaron al equipo.' USING ERRCODE = '42501';
  END IF;
  IF NEW.peso IS DISTINCT FROM OLD.peso AND OLD.estado = 'aprobada' AND NOT v_admin THEN
    RAISE EXCEPTION 'El peso de una tarea aprobada solo lo cambia la administracion.' USING ERRCODE = '42501';
  END IF;
  NEW.titulo := btrim(NEW.titulo);
  IF NEW.responsable_id IS DISTINCT FROM OLD.responsable_id AND NEW.responsable_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM tarea_equipo_participantes WHERE tarea_id = OLD.id AND persona_id = NEW.responsable_id AND hasta IS NULL) THEN
    RAISE EXCEPTION 'La persona responsable del seguimiento debe participar en la tarea.' USING ERRCODE = '23514';
  END IF;
  IF NEW.criterios IS DISTINCT FROM OLD.criterios THEN
    SELECT gestion_id INTO v_gest FROM periodos_evaluacion WHERE id = OLD.periodo_id;
    SELECT string_agg(k, ', ') INTO v_malas FROM unnest(NEW.criterios) AS k
     WHERE NOT EXISTS (SELECT 1 FROM criterios_v2 c WHERE c.gestion_id = v_gest AND c.key = k);
    IF v_malas IS NOT NULL THEN RAISE EXCEPTION 'Criterios desconocidos: %.', v_malas USING ERRCODE = '23514'; END IF;
  END IF;

  -- La fecha límite solo se mueve por tarea_equipo_prorrogar() (con motivo).
  IF NEW.fecha_limite IS DISTINCT FROM OLD.fecha_limite AND NOT v_rpc THEN
    RAISE EXCEPTION 'La fecha limite solo cambia prorrogando la tarea, con un motivo.' USING ERRCODE = '42501';
  END IF;

  -- Entrega: la hace un integrante vigente (o la administración); la revisión, quien revisa.
  IF NEW.entrega_url IS DISTINCT FROM OLD.entrega_url OR NEW.entrega_nota IS DISTINCT FROM OLD.entrega_nota THEN
    IF NOT (v_part OR v_admin) THEN
      RAISE EXCEPTION 'Solo un integrante del equipo registra la entrega.' USING ERRCODE = '42501';
    END IF;
    IF NOT v_admin AND NOT (NEW.estado = 'entregada' AND OLD.estado <> 'entregada') THEN
      RAISE EXCEPTION 'La entrega solo se registra al entregar la tarea.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.revision_nota IS DISTINCT FROM OLD.revision_nota AND NOT (v_revisor OR v_admin) THEN
    RAISE EXCEPTION 'Solo quien revisa deja notas de revision.' USING ERRCODE = '42501';
  END IF;

  -- Transiciones.
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NOT public.tarea_equipo_transicion_valida(v_rol, OLD.estado, NEW.estado) THEN
      RAISE EXCEPTION 'Transicion no permitida: % → %.', OLD.estado, NEW.estado USING ERRCODE = '42501';
    END IF;
    IF NEW.estado = 'anulada' THEN NEW.puntos := OLD.puntos; END IF;    -- anular conserva la nota tal como estaba
    IF NEW.estado = 'entregada' THEN
      IF COALESCE(btrim(NEW.entrega_url), '') = '' AND char_length(COALESCE(btrim(NEW.entrega_nota), '')) < 3 THEN
        RAISE EXCEPTION 'Para entregar, indica un enlace o escribe una nota de la entrega.' USING ERRCODE = '23514';
      END IF;
      NEW.entregada_en  := COALESCE(OLD.entregada_en, NOW());       -- la PRIMERA entrega mide el plazo
      NEW.entregada_por := v_uid;                                   -- quién entregó: la fija el servidor
      NEW.revision_nota := OLD.revision_nota;
    ELSIF NEW.estado = 'devuelta' THEN
      IF char_length(COALESCE(btrim(NEW.revision_nota), '')) < 3 THEN
        RAISE EXCEPTION 'Al devolver una tarea explica que hay que corregir.' USING ERRCODE = '23514';
      END IF;
      NEW.rondas_revision := OLD.rondas_revision + 1;
    ELSIF NEW.estado = 'aprobada' THEN
      NEW.aprobada_en := NOW();
      NEW.aprobada_por := v_uid;
      IF NEW.puntos IS NULL THEN
        RAISE EXCEPTION 'Al aprobar una tarea asigna sus puntos (de 0 a 10).' USING ERRCODE = '23514';
      END IF;
      NEW.puntos_original := NEW.puntos;
    ELSIF NEW.estado = 'bloqueada' THEN
      IF char_length(COALESCE(btrim(NEW.bloqueo_motivo), '')) < 3 THEN
        RAISE EXCEPTION 'Una tarea bloqueada necesita un motivo.' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.estado = 'anulada' THEN
      IF char_length(COALESCE(btrim(NEW.anulacion_motivo), '')) < 5 THEN
        RAISE EXCEPTION 'Anular una tarea necesita un motivo (minimo 5 caracteres).' USING ERRCODE = '23514';
      END IF;
      NEW.anulada_en := NOW(); NEW.anulada_por := v_uid;
      -- La nota que tuviera se CONSERVA (historia), pero una tarea anulada no cuenta (0034).
    END IF;

    IF OLD.estado = 'bloqueada' THEN NEW.bloqueo_motivo := NULL; END IF;
    IF OLD.estado = 'anulada' THEN
      NEW.anulada_en := NULL; NEW.anulada_por := NULL; NEW.anulacion_motivo := NULL;     -- la reabre la administración
    END IF;
    IF OLD.estado = 'aprobada' THEN
      NEW.aprobada_en := NULL; NEW.aprobada_por := NULL;                                  -- reabierta por la administración
    END IF;
    -- Puntos: solo viven con «aprobada» (y se conservan al anular). Reabrir los borra; la historia queda en 0033.
    IF NEW.estado NOT IN ('aprobada','anulada') THEN
      NEW.puntos := NULL; NEW.puntos_original := NULL;
      NEW.nota_anulada_en := NULL; NEW.nota_anulada_por := NULL; NEW.nota_anulada_motivo := NULL;
    END IF;
  ELSE
    IF NEW.bloqueo_motivo IS DISTINCT FROM OLD.bloqueo_motivo THEN NEW.bloqueo_motivo := OLD.bloqueo_motivo; END IF;
    NEW.anulacion_motivo := OLD.anulacion_motivo;       -- el motivo de anulación solo viaja con la transición
    -- Sin cambio de estado los puntos no se tocan por UPDATE directo: se corrigen con la función de 0033.
    IF NEW.puntos IS DISTINCT FROM OLD.puntos AND NOT v_nota_rpc THEN
      RAISE EXCEPTION 'Los puntos se asignan al aprobar; para corregirlos usa la correccion con justificacion.' USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_equipo_validar_update() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tareas_equipo_validar_update ON public.tareas_equipo;
CREATE TRIGGER tareas_equipo_validar_update BEFORE UPDATE ON public.tareas_equipo
  FOR EACH ROW EXECUTE FUNCTION public.tareas_equipo_validar_update();


-- ── 6. Historial append-only ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tareas_equipo_registrar_evento()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_cambios TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO tarea_equipo_eventos (tarea_id, actor_id, tipo, a, motivo) VALUES (NEW.id, auth.uid(), 'creada', NEW.estado, NEW.titulo);
    RETURN NULL;
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    INSERT INTO tarea_equipo_eventos (tarea_id, actor_id, tipo, de, a, motivo)
    VALUES (NEW.id, auth.uid(), 'estado', OLD.estado, NEW.estado,
            CASE NEW.estado
              WHEN 'devuelta'  THEN NEW.revision_nota
              WHEN 'bloqueada' THEN NEW.bloqueo_motivo
              WHEN 'entregada' THEN COALESCE(NULLIF(btrim(NEW.entrega_nota), ''), NEW.entrega_url)
              WHEN 'anulada'   THEN NEW.anulacion_motivo
              ELSE NULL END);
  END IF;
  IF NEW.fecha_limite IS DISTINCT FROM OLD.fecha_limite THEN
    INSERT INTO tarea_equipo_eventos (tarea_id, actor_id, tipo, de, a, motivo)
    VALUES (NEW.id, auth.uid(), 'prorroga', OLD.fecha_limite::TEXT, NEW.fecha_limite::TEXT, current_setting('eight.teq_motivo', true));
  END IF;
  IF NEW.responsable_id IS DISTINCT FROM OLD.responsable_id THEN
    INSERT INTO tarea_equipo_eventos (tarea_id, actor_id, tipo, persona_id, de, a)
    VALUES (NEW.id, auth.uid(), 'responsable', NEW.responsable_id, OLD.responsable_id::TEXT, NEW.responsable_id::TEXT);
  END IF;
  IF NEW.instrucciones IS DISTINCT FROM OLD.instrucciones OR NEW.criterios_evaluacion IS DISTINCT FROM OLD.criterios_evaluacion THEN
    INSERT INTO tarea_equipo_eventos (tarea_id, actor_id, tipo, motivo) VALUES (NEW.id, auth.uid(), 'instrucciones', NULL);
  END IF;
  v_cambios := ARRAY[]::TEXT[];
  IF NEW.titulo IS DISTINCT FROM OLD.titulo THEN v_cambios := v_cambios || 'titulo'; END IF;
  IF NEW.descripcion IS DISTINCT FROM OLD.descripcion THEN v_cambios := v_cambios || 'descripcion'; END IF;
  IF NEW.prioridad IS DISTINCT FROM OLD.prioridad THEN v_cambios := v_cambios || 'prioridad'; END IF;
  IF NEW.criterios IS DISTINCT FROM OLD.criterios THEN v_cambios := v_cambios || 'criterios'; END IF;
  IF NEW.peso IS DISTINCT FROM OLD.peso THEN v_cambios := v_cambios || ('peso ' || OLD.peso || ' → ' || NEW.peso); END IF;
  IF array_length(v_cambios, 1) > 0 THEN
    INSERT INTO tarea_equipo_eventos (tarea_id, actor_id, tipo, motivo) VALUES (NEW.id, auth.uid(), 'contenido', array_to_string(v_cambios, ', '));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_equipo_registrar_evento() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tareas_equipo_registrar_evento ON public.tareas_equipo;
CREATE TRIGGER tareas_equipo_registrar_evento AFTER INSERT OR UPDATE ON public.tareas_equipo
  FOR EACH ROW EXECUTE FUNCTION public.tareas_equipo_registrar_evento();


-- ── 7. Prórroga, aportes y altas/bajas de integrantes ─────────────────
CREATE OR REPLACE FUNCTION public.tarea_equipo_prorrogar(p_id BIGINT, p_nueva DATE, p_motivo TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  t tareas_equipo%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM tareas_equipo WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe esa tarea.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.puede_revisar_tarea_equipo(p_id) THEN
    RAISE EXCEPTION 'No puedes cambiar la fecha limite de esta tarea.' USING ERRCODE = '42501';
  END IF;
  IF t.estado IN ('entregada','aprobada','anulada') THEN
    RAISE EXCEPTION 'La tarea ya esta entregada o cerrada.' USING ERRCODE = '23514';
  END IF;
  IF p_nueva IS NULL OR p_nueva IS NOT DISTINCT FROM t.fecha_limite THEN
    RAISE EXCEPTION 'Indica una fecha distinta a la actual.' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(btrim(p_motivo), '')) < 5 THEN
    RAISE EXCEPTION 'La prorroga necesita un motivo (minimo 5 caracteres).' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('eight.teq_rpc', '1', true);
  PERFORM set_config('eight.teq_motivo', btrim(p_motivo), true);
  UPDATE tareas_equipo SET fecha_limite = p_nueva WHERE id = p_id;
  PERFORM set_config('eight.teq_rpc', '', true);
  PERFORM set_config('eight.teq_motivo', '', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tarea_equipo_prorrogar(BIGINT, DATE, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tarea_equipo_prorrogar(BIGINT, DATE, TEXT) TO authenticated;

--  Un aporte lo escribe SIEMPRE quien llama: no se puede atribuir a otra persona. Los integrantes vigentes aportan
--  avances, evidencias y comentarios; quien revisa solo deja comentarios (observaciones).
CREATE OR REPLACE FUNCTION public.tarea_equipo_aportar(
  p_tarea  BIGINT,
  p_tipo   TEXT,
  p_nota   TEXT    DEFAULT NULL,
  p_url    TEXT    DEFAULT NULL,
  p_avance INT     DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  t tareas_equipo%ROWTYPE;
  v_part BOOLEAN; v_rev BOOLEAN; v_id BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM tareas_equipo WHERE id = p_tarea;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe esa tarea.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.gestion_escribible(t.periodo_id) THEN
    RAISE EXCEPTION 'Esta gestion esta archivada: solo lectura.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo NOT IN ('avance','evidencia','comentario') THEN
    RAISE EXCEPTION 'Tipo de aporte desconocido.' USING ERRCODE = '22023';
  END IF;
  v_part := public.soy_participante_tarea_equipo(p_tarea, true);
  v_rev  := public.puede_revisar_tarea_equipo(p_tarea);
  IF NOT (v_part OR v_rev) THEN
    RAISE EXCEPTION 'No tienes acceso a esta tarea.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_part AND p_tipo <> 'comentario' THEN
    RAISE EXCEPTION 'Quien revisa deja comentarios; los avances y evidencias los aportan los integrantes.' USING ERRCODE = '42501';
  END IF;
  IF t.estado IN ('aprobada','anulada') THEN
    RAISE EXCEPTION 'La tarea ya esta cerrada.' USING ERRCODE = '23514';
  END IF;
  IF p_tipo = 'avance' AND p_avance IS NULL THEN
    RAISE EXCEPTION 'Un avance necesita su porcentaje (0 a 100).' USING ERRCODE = '23514';
  END IF;
  IF p_tipo <> 'avance' AND p_avance IS NOT NULL THEN p_avance := NULL; END IF;
  INSERT INTO tarea_equipo_aportes (tarea_id, persona_id, tipo, nota, url, avance)
  VALUES (p_tarea, auth.uid(), p_tipo, NULLIF(btrim(COALESCE(p_nota, '')), ''), NULLIF(btrim(COALESCE(p_url, '')), ''), p_avance)
  RETURNING id INTO v_id;
  INSERT INTO tarea_equipo_eventos (tarea_id, actor_id, tipo, persona_id, a, motivo)
  VALUES (p_tarea, auth.uid(), 'aporte', auth.uid(), p_tipo, LEFT(COALESCE(NULLIF(btrim(p_nota), ''), p_url, p_avance::TEXT || '%'), 200));
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tarea_equipo_aportar(BIGINT, TEXT, TEXT, TEXT, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tarea_equipo_aportar(BIGINT, TEXT, TEXT, TEXT, INT) TO authenticated;

--  Las llama equipo_agregar_miembros / equipo_retirar_miembro (0031). No son para el cliente.
CREATE OR REPLACE FUNCTION public.tarea_equipo_alta_integrante(p_equipo BIGINT, p_persona UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO tarea_equipo_eventos (tarea_id, actor_id, tipo, persona_id, a)
  SELECT t.id, auth.uid(), 'participante_alta', p_persona, 'abierta'
    FROM tareas_equipo t
   WHERE t.equipo_id = p_equipo AND t.estado IN ('asignada','en_curso','bloqueada','devuelta')
     AND NOT EXISTS (SELECT 1 FROM tarea_equipo_participantes p WHERE p.tarea_id = t.id AND p.persona_id = p_persona AND p.hasta IS NULL);
  INSERT INTO tarea_equipo_participantes (tarea_id, persona_id, desde)
  SELECT t.id, p_persona, NOW() FROM tareas_equipo t
   WHERE t.equipo_id = p_equipo AND t.estado IN ('asignada','en_curso','bloqueada','devuelta')
  ON CONFLICT (tarea_id, persona_id) DO UPDATE SET hasta = NULL, desde = NOW()
    WHERE tarea_equipo_participantes.hasta IS NOT NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.tarea_equipo_baja_integrante(p_equipo BIGINT, p_persona UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO tarea_equipo_eventos (tarea_id, actor_id, tipo, persona_id, a)
  SELECT t.id, auth.uid(), 'participante_baja', p_persona, t.estado
    FROM tareas_equipo t JOIN tarea_equipo_participantes p ON p.tarea_id = t.id AND p.persona_id = p_persona AND p.hasta IS NULL
   WHERE t.equipo_id = p_equipo AND t.estado IN ('asignada','en_curso','bloqueada','devuelta','entregada');
  UPDATE tarea_equipo_participantes p SET hasta = NOW()
    FROM tareas_equipo t
   WHERE p.tarea_id = t.id AND t.equipo_id = p_equipo AND p.persona_id = p_persona AND p.hasta IS NULL
     AND t.estado IN ('asignada','en_curso','bloqueada','devuelta','entregada');
  -- Si era quien daba seguimiento, la tarea queda sin responsable (se registra como cambio de responsable).
  UPDATE tareas_equipo t SET responsable_id = NULL
   WHERE t.equipo_id = p_equipo AND t.responsable_id = p_persona AND t.estado IN ('asignada','en_curso','bloqueada','devuelta','entregada');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tarea_equipo_alta_integrante(BIGINT, UUID), public.tarea_equipo_baja_integrante(BIGINT, UUID)
  FROM PUBLIC, anon, authenticated;


-- ── 8. Participación de cada integrante (progreso individual) ─────────
--  Quién participa, cuánto aportó y si entregó. La nota individual dentro del grupo solo la ve su dueña, la
--  administración y la secretaría que revisa.
CREATE OR REPLACE FUNCTION public.tarea_equipo_participacion(p_tarea BIGINT)
RETURNS TABLE (
  persona_id UUID, nombre TEXT, desde TIMESTAMPTZ, hasta TIMESTAMPTZ,
  aportes INT, ultimo_aporte TIMESTAMPTZ, entrego BOOLEAN, es_responsable BOOLEAN,
  puntos_individual SMALLINT, individual_motivo TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_rev BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  IF NOT public.tarea_equipo_visible(p_tarea) THEN RETURN; END IF;
  v_rev := public.puede_revisar_tarea_equipo(p_tarea);
  RETURN QUERY
  SELECT p.persona_id, COALESCE(NULLIF(pf.nombre, ''), pf.email), p.desde, p.hasta,
         (SELECT COUNT(*)::INT FROM tarea_equipo_aportes a WHERE a.tarea_id = p.tarea_id AND a.persona_id = p.persona_id),
         (SELECT MAX(a.created_at) FROM tarea_equipo_aportes a WHERE a.tarea_id = p.tarea_id AND a.persona_id = p.persona_id),
         (t.entregada_por = p.persona_id),
         (t.responsable_id = p.persona_id),
         CASE WHEN v_rev OR p.persona_id = auth.uid() THEN p.puntos_individual END,
         CASE WHEN v_rev OR p.persona_id = auth.uid() THEN p.individual_motivo END
    FROM tarea_equipo_participantes p
    JOIN tareas_equipo t ON t.id = p.tarea_id
    JOIN profiles pf ON pf.id = p.persona_id
   WHERE p.tarea_id = p_tarea
     AND (p.hasta IS NULL OR v_rev OR p.persona_id = auth.uid() OR EXISTS (
            SELECT 1 FROM tarea_equipo_aportes a WHERE a.tarea_id = p.tarea_id AND a.persona_id = p.persona_id))
   ORDER BY (p.hasta IS NOT NULL), COALESCE(NULLIF(pf.nombre, ''), pf.email);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tarea_equipo_participacion(BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tarea_equipo_participacion(BIGINT) TO authenticated;


-- ── 9. RLS ────────────────────────────────────────────────────────────
ALTER TABLE public.tareas_equipo               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarea_equipo_participantes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarea_equipo_aportes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarea_equipo_eventos        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tareas_equipo_select ON public.tareas_equipo;
CREATE POLICY tareas_equipo_select ON public.tareas_equipo FOR SELECT TO authenticated
  USING (public.tarea_equipo_visible(id));

DROP POLICY IF EXISTS tareas_equipo_insert ON public.tareas_equipo;
CREATE POLICY tareas_equipo_insert ON public.tareas_equipo FOR INSERT TO authenticated
  WITH CHECK (public.puede_asignar_a_equipo(equipo_id) AND public.gestion_escribible(periodo_id));

DROP POLICY IF EXISTS tareas_equipo_update ON public.tareas_equipo;
CREATE POLICY tareas_equipo_update ON public.tareas_equipo FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.puede_revisar_tarea_equipo(id) OR public.soy_participante_tarea_equipo(id, true))
  WITH CHECK (public.gestion_escribible(periodo_id));

--  Borrar: solo la administración y solo mientras nadie la ha tocado (sin aportes, aún «asignada»).
DROP POLICY IF EXISTS tareas_equipo_delete ON public.tareas_equipo;
CREATE POLICY tareas_equipo_delete ON public.tareas_equipo FOR DELETE TO authenticated
  USING (public.is_admin() AND estado = 'asignada' AND public.gestion_escribible(periodo_id)
         AND NOT EXISTS (SELECT 1 FROM tarea_equipo_aportes a WHERE a.tarea_id = tareas_equipo.id));

DROP POLICY IF EXISTS tarea_equipo_part_select ON public.tarea_equipo_participantes;
CREATE POLICY tarea_equipo_part_select ON public.tarea_equipo_participantes FOR SELECT TO authenticated
  USING (public.is_admin() OR persona_id = auth.uid() OR public.puede_revisar_tarea_equipo(tarea_id));

DROP POLICY IF EXISTS tarea_equipo_aportes_select ON public.tarea_equipo_aportes;
CREATE POLICY tarea_equipo_aportes_select ON public.tarea_equipo_aportes FOR SELECT TO authenticated
  USING (public.is_admin() OR public.soy_participante_tarea_equipo(tarea_id, false) OR public.puede_revisar_tarea_equipo(tarea_id));

DROP POLICY IF EXISTS tarea_equipo_eventos_select ON public.tarea_equipo_eventos;
CREATE POLICY tarea_equipo_eventos_select ON public.tarea_equipo_eventos FOR SELECT TO authenticated
  USING (public.is_admin() OR public.soy_participante_tarea_equipo(tarea_id, false) OR public.puede_revisar_tarea_equipo(tarea_id));

REVOKE ALL ON public.tareas_equipo, public.tarea_equipo_participantes, public.tarea_equipo_aportes, public.tarea_equipo_eventos FROM anon;
--  Participantes, aportes y eventos: nadie escribe desde el cliente. Solo las funciones y los triggers.
REVOKE INSERT, UPDATE, DELETE ON public.tarea_equipo_participantes, public.tarea_equipo_aportes, public.tarea_equipo_eventos
  FROM anon, authenticated;

COMMIT;


-- ══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- ══════════════════════════════════════════════════════════════════════
--   Una tarea colectiva solo en un PE v2 y equipo activo (esto debe fallar con un equipo inactivo).
--   SET ROLE anon; SELECT count(*) FROM tareas_equipo;   -- permiso denegado
-- DOWN (comentado)
-- ══════════════════════════════════════════════════════════════════════
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.tarea_equipo_participacion(BIGINT), public.tarea_equipo_baja_integrante(BIGINT, UUID),
--   public.tarea_equipo_alta_integrante(BIGINT, UUID), public.tarea_equipo_aportar(BIGINT, TEXT, TEXT, TEXT, INT),
--   public.tarea_equipo_prorrogar(BIGINT, DATE, TEXT), public.tarea_equipo_transicion_valida(TEXT, TEXT, TEXT),
--   public.tarea_equipo_visible(BIGINT), public.puede_asignar_a_equipo(BIGINT), public.puede_revisar_tarea_equipo(BIGINT),
--   public.soy_participante_tarea_equipo(BIGINT, BOOLEAN);
-- DROP TABLE IF EXISTS public.tarea_equipo_eventos, public.tarea_equipo_aportes, public.tarea_equipo_participantes, public.tareas_equipo CASCADE;
-- COMMIT;
