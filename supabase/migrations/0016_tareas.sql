-- ══════════════════════════════════════════════════════════════════════
--  0016 — Tareas asignables, con evidencia para evaluar
-- ══════════════════════════════════════════════════════════════════════
--
--  POR QUÉ
--  Hoy `trabajos_entregados` es texto que cada miembro se autodeclara: nadie
--  lo asigna, no tiene fecha límite ni estado, y no se conecta con la nota.
--  El evaluador juzga plazos, calidad e iniciativa de memoria. Las tareas
--  dan el hecho: qué se pidió, para cuándo, cuándo se entregó, cuántas veces
--  volvió, cuántas se hicieron por iniciativa propia.
--
--  CÓMO SE REPARTE EL PODER (lo impone la base, no el cliente)
--    · Admin       : asigna a cualquiera, revisa y puede corregir.
--    · Secretario  : asigna y revisa SOLO a miembros de su distrito, y nunca
--                    sus propias tareas (no se aprueba a sí mismo).
--    · Miembro     : ve las suyas; crea las suyas (`origen = 'propia'`); las
--                    mueve hasta «entregada». No aprueba, no devuelve, no
--                    toca la fecha límite de lo que le asignaron.
--  El estado, las marcas de tiempo y el contador de devoluciones los fija un
--  trigger. El cliente puede mandar lo que quiera: se sobrescribe.
--
--  EQUIDAD
--    · La fecha límite solo cambia por prorrogar_tarea(), con motivo, y queda
--      en el historial. `fecha_limite_original` no cambia nunca.
--    · «bloqueada» (esperando a un tercero) exige motivo y no cuenta como
--      atraso.
--    · Las tareas propias solo cuentan como iniciativa cuando alguien que no
--      es el autor las aprueba: no se infla el contador creando tareas.
--    · «A tiempo» se mide en la zona horaria de la gestión (config
--      `zona_horaria`, por defecto America/Santiago), no en UTC.
--
--  `tarea_eventos` es un historial append-only que solo escriben triggers.
--
--  GUARDIAS: sin sesión se deniega (nunca `auth.uid() IS NOT NULL AND ...`,
--  ver 0008). Las funciones nuevas se revocan a PUBLIC (0010). Escritura
--  gateada por gestion_escribible(periodo_id): una gestión archivada es solo
--  lectura.
--
--  SOLO PARA PERÍODOS NUEVOS (con la rúbrica por roles, `modelo = 'v2'`).
--  Los períodos anteriores siguen con `trabajos_entregados` tal cual: esta
--  migración NO la toca ni copia sus filas a tareas. Una tarea en un período
--  que no es v2 la rechaza el trigger.
--
--  Aplicación manual en el SQL Editor, en orden, tras 0015. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Tablas ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tareas (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  periodo_id            UUID   NOT NULL REFERENCES public.periodos_evaluacion(id) ON DELETE CASCADE,
  titulo                TEXT   NOT NULL CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 160),
  descripcion           TEXT   NOT NULL DEFAULT '' CHECK (char_length(descripcion) <= 4000),
  asignada_a            UUID   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  asignada_por          UUID   REFERENCES public.profiles(id) ON DELETE SET NULL,
  origen                TEXT   NOT NULL DEFAULT 'asignada' CHECK (origen IN ('asignada','propia')),
  -- Claves del catálogo v2 que esta tarea evidencia (opcional, orientativo).
  criterios             TEXT[] NOT NULL DEFAULT '{}',
  prioridad             TEXT   NOT NULL DEFAULT 'normal' CHECK (prioridad IN ('baja','normal','alta')),
  fecha_limite          DATE,
  fecha_limite_original DATE,
  estado                TEXT   NOT NULL DEFAULT 'asignada'
                        CHECK (estado IN ('asignada','en_curso','bloqueada','entregada','devuelta','aprobada')),
  entrega_url           TEXT   CHECK (entrega_url IS NULL OR (char_length(entrega_url) <= 2000
                                       AND entrega_url ~* '^https?://[^[:space:]]+$')),
  entrega_nota          TEXT   CHECK (entrega_nota IS NULL OR char_length(entrega_nota) <= 2000),
  revision_nota         TEXT   CHECK (revision_nota IS NULL OR char_length(revision_nota) <= 2000),
  bloqueo_motivo        TEXT   CHECK (bloqueo_motivo IS NULL OR char_length(bloqueo_motivo) <= 500),
  entregada_en          TIMESTAMPTZ,
  aprobada_en           TIMESTAMPTZ,
  rondas_revision       INT    NOT NULL DEFAULT 0 CHECK (rondas_revision >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tareas_periodo_asignada_idx ON public.tareas (periodo_id, asignada_a);
CREATE INDEX IF NOT EXISTS tareas_asignada_idx         ON public.tareas (asignada_a);

CREATE TABLE IF NOT EXISTS public.tarea_eventos (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tarea_id   BIGINT NOT NULL REFERENCES public.tareas(id) ON DELETE CASCADE,
  actor_id   UUID,
  tipo       TEXT   NOT NULL CHECK (tipo IN ('creada','estado','prorroga')),
  de         TEXT,
  a          TEXT,
  motivo     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tarea_eventos_tarea_idx ON public.tarea_eventos (tarea_id, created_at);


-- ── 2. Quién puede revisar ────────────────────────────────────────────
--  Admin, o el secretario del distrito de la persona. Nadie revisa lo suyo
--  (salvo el admin, que no se evalúa).
CREATE OR REPLACE FUNCTION public.puede_revisar_tarea(p_asignada_a UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_admin()
      OR (public.is_secretario()
          AND p_asignada_a IS DISTINCT FROM auth.uid()
          AND p_asignada_a IN (SELECT public.get_district_member_ids()));
$$;
REVOKE EXECUTE ON FUNCTION public.puede_revisar_tarea(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puede_revisar_tarea(UUID) TO authenticated;

--  Zona horaria de la gestión del período (config `zona_horaria`). Se valida
--  contra pg_timezone_names: un valor inválido haría fallar cada consulta.
CREATE OR REPLACE FUNCTION public.zona_periodo(p_periodo UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT c.valor FROM config c
       JOIN periodos_evaluacion p ON p.gestion_id = c.gestion_id
      WHERE p.id = p_periodo AND c.clave = 'zona_horaria'
        AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = c.valor)),
    'America/Santiago');
$$;
REVOKE EXECUTE ON FUNCTION public.zona_periodo(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.zona_periodo(UUID) TO authenticated;


-- ── 3. Matriz de transiciones ─────────────────────────────────────────
--  p_rol: 'asignado' | 'revisor' | 'admin'
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
    ELSE false
  END;
$$;


-- ── 4. INSERT: el servidor decide quién es quién ──────────────────────
CREATE OR REPLACE FUNCTION public.tareas_validar_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_gest  BIGINT;
  v_malas TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.gestion_escribible(NEW.periodo_id) THEN
    RAISE EXCEPTION 'Esta gestion esta archivada: solo lectura.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT modelo FROM periodos_evaluacion WHERE id = NEW.periodo_id) IS DISTINCT FROM 'v2' THEN
    RAISE EXCEPTION 'Las tareas solo existen en periodos con la rubrica por roles; los anteriores conservan su evaluacion original.'
      USING ERRCODE = '42501';
  END IF;

  -- Quién crea y para quién.
  IF public.is_admin() THEN
    NULL;
  ELSIF public.is_secretario() THEN
    IF NEW.asignada_a <> v_uid AND NEW.asignada_a NOT IN (SELECT public.get_district_member_ids()) THEN
      RAISE EXCEPTION 'Solo puedes asignar tareas a miembros de tu distrito.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.asignada_a <> v_uid THEN
      RAISE EXCEPTION 'Solo puedes crear tareas para ti.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Una tarea para uno mismo es siempre «propia», la haya marcado como la haya marcado.
  NEW.origen       := CASE WHEN NEW.asignada_a = v_uid THEN 'propia' ELSE 'asignada' END;
  NEW.asignada_por := v_uid;

  IF EXISTS (SELECT 1 FROM periodo_participantes
              WHERE periodo_id = NEW.periodo_id AND user_id = NEW.asignada_a AND NOT activo) THEN
    RAISE EXCEPTION 'Esa persona esta marcada como inactiva en este periodo.' USING ERRCODE = '23514';
  END IF;

  -- Todo lo demás arranca de cero: lo fija el servidor.
  NEW.estado                := 'asignada';
  NEW.fecha_limite_original := NEW.fecha_limite;
  NEW.entrega_url := NULL; NEW.entrega_nota := NULL; NEW.revision_nota := NULL; NEW.bloqueo_motivo := NULL;
  NEW.entregada_en := NULL; NEW.aprobada_en := NULL; NEW.rondas_revision := 0;
  NEW.titulo := btrim(NEW.titulo);

  -- Criterios: solo claves del catálogo v2 de la gestión del período.
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
REVOKE EXECUTE ON FUNCTION public.tareas_validar_insert() FROM PUBLIC, anon, authenticated;


-- ── 5. UPDATE: transiciones y campos según quién actúa ────────────────
CREATE OR REPLACE FUNCTION public.tareas_validar_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_admin    BOOLEAN;
  v_revisor  BOOLEAN;
  v_asignado BOOLEAN;
  v_rol      TEXT;
  v_rpc      BOOLEAN := COALESCE(current_setting('eight.tarea_rpc', true), '') = '1';
  v_edita    BOOLEAN;
  v_pub      BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.gestion_escribible(OLD.periodo_id) THEN
    RAISE EXCEPTION 'Esta gestion esta archivada: solo lectura.' USING ERRCODE = '42501';
  END IF;

  v_admin    := public.is_admin();
  v_revisor  := public.puede_revisar_tarea(OLD.asignada_a);
  v_asignado := OLD.asignada_a = v_uid;
  IF NOT (v_admin OR v_revisor OR v_asignado) THEN
    RAISE EXCEPTION 'No tienes acceso a esta tarea.' USING ERRCODE = '42501';
  END IF;
  v_rol := CASE WHEN v_admin THEN 'admin' WHEN v_revisor THEN 'revisor' ELSE 'asignado' END;

  -- Una tarea aprobada es historia: solo el admin la toca (y la reabre).
  IF OLD.estado = 'aprobada' AND NOT v_admin THEN
    RAISE EXCEPTION 'Una tarea aprobada no se modifica.' USING ERRCODE = '42501';
  END IF;

  -- Inmutables, para todos.
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.periodo_id IS DISTINCT FROM OLD.periodo_id
     OR NEW.asignada_a IS DISTINCT FROM OLD.asignada_a
     OR NEW.asignada_por IS DISTINCT FROM OLD.asignada_por
     OR NEW.origen IS DISTINCT FROM OLD.origen
     OR NEW.fecha_limite_original IS DISTINCT FROM OLD.fecha_limite_original
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Esos campos de la tarea no se pueden cambiar.' USING ERRCODE = '42501';
  END IF;

  -- Lo que fija el servidor: se parte de lo que había.
  NEW.entregada_en    := OLD.entregada_en;
  NEW.aprobada_en     := OLD.aprobada_en;
  NEW.rondas_revision := OLD.rondas_revision;

  -- Título, descripción, prioridad y criterios: quien revisa, o el autor de
  -- su propia tarea mientras siga abierta.
  v_edita := v_admin OR v_revisor
          OR (v_asignado AND OLD.origen = 'propia' AND OLD.estado <> 'aprobada');
  IF NOT v_edita AND (NEW.titulo IS DISTINCT FROM OLD.titulo
                      OR NEW.descripcion IS DISTINCT FROM OLD.descripcion
                      OR NEW.prioridad IS DISTINCT FROM OLD.prioridad
                      OR NEW.criterios IS DISTINCT FROM OLD.criterios) THEN
    RAISE EXCEPTION 'No puedes editar el contenido de una tarea que te asignaron.' USING ERRCODE = '42501';
  END IF;
  NEW.titulo := btrim(NEW.titulo);

  -- La fecha límite solo se mueve por prorrogar_tarea() (con motivo).
  IF NEW.fecha_limite IS DISTINCT FROM OLD.fecha_limite AND NOT v_rpc THEN
    RAISE EXCEPTION 'La fecha limite solo cambia prorrogando la tarea, con un motivo.' USING ERRCODE = '42501';
  END IF;

  -- Entrega: la hace quien la recibió (o el admin); la revisión, quien revisa.
  IF NEW.entrega_url IS DISTINCT FROM OLD.entrega_url OR NEW.entrega_nota IS DISTINCT FROM OLD.entrega_nota THEN
    IF NOT (v_asignado OR v_admin) THEN
      RAISE EXCEPTION 'Solo quien recibe la tarea registra la entrega.' USING ERRCODE = '42501';
    END IF;
    -- La entrega solo se escribe AL entregar. Cambiarla después, sin pasar por
    -- el historial, haría que quien revisa apruebe algo distinto de lo entregado.
    IF NOT v_admin AND NOT (NEW.estado = 'entregada' AND OLD.estado <> 'entregada') THEN
      RAISE EXCEPTION 'La entrega solo se registra al entregar la tarea.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.revision_nota IS DISTINCT FROM OLD.revision_nota AND NOT (v_revisor OR v_admin) THEN
    RAISE EXCEPTION 'Solo quien revisa deja notas de revision.' USING ERRCODE = '42501';
  END IF;

  -- Transiciones.
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    -- Quien es a la vez receptor y revisor (el admin) usa la matriz amplia;
    -- un receptor normal, solo la suya.
    IF NOT public.tarea_transicion_valida(v_rol, OLD.estado, NEW.estado) THEN
      RAISE EXCEPTION 'Transicion no permitida: % → %.', OLD.estado, NEW.estado USING ERRCODE = '42501';
    END IF;

    -- Una tarea propia no la aprueba su autor: ya lo impide puede_revisar_tarea
    -- (nadie revisa lo suyo), y el admin no se evalúa.

    IF NEW.estado = 'entregada' THEN
      IF COALESCE(btrim(NEW.entrega_url), '') = '' AND char_length(COALESCE(btrim(NEW.entrega_nota), '')) < 3 THEN
        RAISE EXCEPTION 'Para entregar, indica un enlace o escribe una nota de la entrega.' USING ERRCODE = '23514';
      END IF;
      -- La PRIMERA entrega es la que mide el plazo. Si volviera a contar la
      -- última, quien entregó en fecha y luego corrigió una observación
      -- quedaría como tardío por lo que tardó el revisor en devolverla.
      NEW.entregada_en := COALESCE(OLD.entregada_en, NOW());
      NEW.revision_nota := OLD.revision_nota;       -- se conserva para ver qué se corrigió
    ELSIF NEW.estado = 'devuelta' THEN
      IF char_length(COALESCE(btrim(NEW.revision_nota), '')) < 3 THEN
        RAISE EXCEPTION 'Al devolver una tarea explica que hay que corregir.' USING ERRCODE = '23514';
      END IF;
      NEW.rondas_revision := OLD.rondas_revision + 1;
    ELSIF NEW.estado = 'aprobada' THEN
      NEW.aprobada_en := NOW();
    ELSIF NEW.estado = 'bloqueada' THEN
      IF char_length(COALESCE(btrim(NEW.bloqueo_motivo), '')) < 3 THEN
        RAISE EXCEPTION 'Una tarea bloqueada necesita un motivo.' USING ERRCODE = '23514';
      END IF;
    END IF;

    IF OLD.estado = 'bloqueada' THEN NEW.bloqueo_motivo := NULL; END IF;
    IF OLD.estado = 'aprobada' THEN NEW.aprobada_en := NULL; END IF;       -- reabierta por el admin
  ELSE
    -- Sin cambio de estado, un bloqueo no se reescribe a escondidas.
    IF NEW.bloqueo_motivo IS DISTINCT FROM OLD.bloqueo_motivo THEN
      NEW.bloqueo_motivo := OLD.bloqueo_motivo;
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tareas_validar_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tareas_validar_insert ON public.tareas;
CREATE TRIGGER tareas_validar_insert
  BEFORE INSERT ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION public.tareas_validar_insert();

DROP TRIGGER IF EXISTS tareas_validar_update ON public.tareas;
CREATE TRIGGER tareas_validar_update
  BEFORE UPDATE ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION public.tareas_validar_update();


-- ── 6. Historial append-only ──────────────────────────────────────────
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

DROP TRIGGER IF EXISTS tareas_registrar_evento ON public.tareas;
CREATE TRIGGER tareas_registrar_evento
  AFTER INSERT OR UPDATE ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION public.tareas_registrar_evento();


-- ── 7. Prórroga con motivo ────────────────────────────────────────────
--  El trigger de UPDATE vuelve a comprobar permisos; esto solo le dice que
--  el cambio de fecha viene por la vía legítima.
CREATE OR REPLACE FUNCTION public.prorrogar_tarea(p_id BIGINT, p_nueva DATE, p_motivo TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  t tareas%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM tareas WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe esa tarea.' USING ERRCODE = 'P0002';
  END IF;
  -- Quien revisa, o el autor de su propia tarea. Nunca el receptor de una
  -- tarea asignada: no se prorroga a sí mismo lo que le pidieron.
  IF NOT (public.puede_revisar_tarea(t.asignada_a) OR (t.asignada_a = auth.uid() AND t.origen = 'propia')) THEN
    RAISE EXCEPTION 'No puedes cambiar la fecha limite de esta tarea.' USING ERRCODE = '42501';
  END IF;
  IF t.estado IN ('entregada','aprobada') THEN
    RAISE EXCEPTION 'La tarea ya esta entregada.' USING ERRCODE = '23514';
  END IF;
  IF p_nueva IS NULL OR p_nueva IS NOT DISTINCT FROM t.fecha_limite THEN
    RAISE EXCEPTION 'Indica una fecha distinta a la actual.' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(btrim(p_motivo), '')) < 5 THEN
    RAISE EXCEPTION 'La prorroga necesita un motivo (minimo 5 caracteres).' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('eight.tarea_rpc', '1', true);
  PERFORM set_config('eight.tarea_motivo', btrim(p_motivo), true);
  UPDATE tareas SET fecha_limite = p_nueva WHERE id = p_id;
  PERFORM set_config('eight.tarea_rpc', '', true);
  PERFORM set_config('eight.tarea_motivo', '', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prorrogar_tarea(BIGINT, DATE, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.prorrogar_tarea(BIGINT, DATE, TEXT) TO authenticated;


-- ── 8. RLS ────────────────────────────────────────────────────────────
ALTER TABLE public.tareas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarea_eventos ENABLE ROW LEVEL SECURITY;

--  Quién ve una tarea: su receptor, el admin y el secretario de su distrito.
DROP POLICY IF EXISTS tareas_select ON public.tareas;
CREATE POLICY tareas_select ON public.tareas
  FOR SELECT TO authenticated
  USING (asignada_a = auth.uid()
         OR public.is_admin()
         OR (public.is_secretario() AND asignada_a IN (SELECT public.get_district_member_ids())));

--  Los límites finos (a quién, desde qué estado) están en los triggers; la
--  policy es la primera puerta.
DROP POLICY IF EXISTS tareas_insert ON public.tareas;
CREATE POLICY tareas_insert ON public.tareas
  FOR INSERT TO authenticated
  WITH CHECK ((asignada_a = auth.uid()
               OR public.is_admin()
               OR (public.is_secretario() AND asignada_a IN (SELECT public.get_district_member_ids())))
              AND public.gestion_escribible(periodo_id));

DROP POLICY IF EXISTS tareas_update ON public.tareas;
CREATE POLICY tareas_update ON public.tareas
  FOR UPDATE TO authenticated
  USING (asignada_a = auth.uid()
         OR public.is_admin()
         OR (public.is_secretario() AND asignada_a IN (SELECT public.get_district_member_ids())))
  WITH CHECK (public.gestion_escribible(periodo_id));

--  Borrar: el admin, o quien la creó mientras nadie la ha tocado.
DROP POLICY IF EXISTS tareas_delete ON public.tareas;
CREATE POLICY tareas_delete ON public.tareas
  FOR DELETE TO authenticated
  USING (public.is_admin()
         OR (asignada_por = auth.uid() AND estado = 'asignada' AND public.gestion_escribible(periodo_id)));

DROP POLICY IF EXISTS tarea_eventos_select ON public.tarea_eventos;
CREATE POLICY tarea_eventos_select ON public.tarea_eventos
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tareas t WHERE t.id = tarea_id));   -- la RLS de tareas filtra

REVOKE ALL ON public.tareas, public.tarea_eventos FROM anon;
--  Nadie escribe el historial desde el cliente: solo el trigger.
REVOKE INSERT, UPDATE, DELETE ON public.tarea_eventos FROM anon, authenticated;


-- ── 9. Evidencia para evaluar ─────────────────────────────────────────
--  Una fila por persona con tareas en el período. Devuelve lo que el
--  llamante puede ver (admin: todo; secretario: su distrito; miembro: lo
--  suyo). No puntúa: son los hechos que el evaluador interpreta.
--
--    entregadas      : con al menos una entrega (aunque luego se devolviera)
--    a_tiempo        : con plazo y PRIMERA entrega el día del plazo o antes (en
--                      la zona de la gestión): corregir una observación no
--                      convierte en tardía una entrega que llegó a tiempo
--    vencidas_abiertas: nunca entregadas, con plazo pasado y no bloqueadas
--    devoluciones    : veces que se devolvió por correcciones
--    propias_aprobadas: iniciativa que otra persona validó
--    prorrogas       : cuántas veces se movió un plazo (con motivo)
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
-- Las tareas solo caben en períodos v2 (esto debe fallar en un período anterior):
--   INSERT INTO tareas (periodo_id, titulo, asignada_a) SELECT id, 'x', (SELECT id FROM profiles LIMIT 1)
--     FROM periodos_evaluacion WHERE modelo = 'legacy' LIMIT 1;   -- (sin sesión falla antes: es lo esperado)
-- Sin sesión nada es legible:
--   SET ROLE anon; SELECT count(*) FROM tareas; RESET ROLE;
-- Zona horaria de la gestión (si no es America/Santiago, fíjala):
--   INSERT INTO config (gestion_id, clave, valor)
--   SELECT id, 'zona_horaria', 'America/Santo_Domingo' FROM gestiones WHERE activa
--   ON CONFLICT (gestion_id, clave) DO UPDATE SET valor = EXCLUDED.valor;


-- ══════════════════════════════════════════════════════════════════════
-- DOWN (comentado)
-- ══════════════════════════════════════════════════════════════════════
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.resumen_tareas_periodo(UUID);
-- DROP FUNCTION IF EXISTS public.prorrogar_tarea(BIGINT, DATE, TEXT);
-- DROP TABLE IF EXISTS public.tarea_eventos, public.tareas CASCADE;
-- DROP FUNCTION IF EXISTS public.tareas_validar_insert(), public.tareas_validar_update(),
--   public.tareas_registrar_evento(), public.tarea_transicion_valida(TEXT, TEXT, TEXT),
--   public.puede_revisar_tarea(UUID), public.zona_periodo(UUID);
-- COMMIT;
