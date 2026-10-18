-- ══════════════════════════════════════════════════════════════════════
--  0031 — Equipos de trabajo por PE
-- ══════════════════════════════════════════════════════════════════════
--
--  QUÉ ES UN EQUIPO
--    Un grupo de personas que trabaja junto DURANTE UN PE (periodo_id). Solo existen en períodos nuevos
--    (rúbrica por roles, modelo 'v2'): son los únicos que admiten tareas, y las tareas colectivas (0032)
--    cuelgan de un equipo. Los períodos anteriores no se tocan.
--
--  QUIÉN HACE QUÉ (lo impone la base, no el cliente)
--    · Administración : crea, edita, cambia el estado y compone los equipos. Es la única que escribe.
--    · Secretaría     : LEE los equipos de su distrito (los que tienen su distrito como ámbito o a alguien de su
--                       distrito como integrante) y su historial. No los administra.
--    · Miembro        : LEE los equipos a los que pertenece (o perteneció) y a sus integrantes actuales.
--    Ninguna escritura directa: todo pasa por funciones que validan y dejan rastro en `equipo_eventos`.
--
--  REGLAS DE PERTENENCIA
--    · Una persona no puede estar dos veces ACTIVA en el mismo equipo (índice único parcial). Reincorporar a
--      quien salió crea una fila NUEVA: la historia de la anterior queda intacta.
--    · Elegible = perfil aprobado, que no sea administración y que no esté marcada como inactiva en el PE
--      (periodo_participantes). Nadie se salta eso, ni la administración.
--    · Ámbito: si el equipo declara un `distrito`, sus integrantes son de ese distrito. La administración
--      puede hacer UNA EXCEPCIÓN explícita (`p_excepcion` + motivo) y queda marcada en la fila.
--
--  SI LA PERSONA CAMBIA DE DISTRITO O DEJA DE PARTICIPAR EN EL PE
--    Política: NUNCA se cambia ni se borra una relación en silencio. El cambio se registra como una alerta en
--    el historial del equipo (tipo 'alerta') y equipo_integrantes() la muestra mientras siga vigente; la
--    administración decide si la retira (con motivo) o la deja con excepción. Lo ya hecho (tareas, notas) no se
--    reescribe.
--
--  NO SE BORRA: no hay DELETE. Un equipo se archiva. Un integrante se retira (`hasta`).
--
--  GUARDIAS: sin sesión se deniega; el guardia de administración es `IF NOT public.is_admin()` (ver 0008).
--  Funciones revocadas a PUBLIC (0010). Escritura gateada por gestion_escribible(periodo).
--
--  PUNTOS DE EMISIÓN DE AVISOS (los conecta la sesión de notificaciones; aquí NO se emite nada):
--    equipo_incorporado  → fila 'miembro_alta' en equipo_eventos (persona_id = quien entra)
--    equipo_retiro       → fila 'miembro_baja' en equipo_eventos
--
--  Requiere 0015 (modelo v2) y 0018 (mi_distrito). Aplicación manual en el SQL Editor. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Tablas ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.equipos (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  periodo_id     UUID   NOT NULL REFERENCES public.periodos_evaluacion(id) ON DELETE RESTRICT,
  nombre         TEXT   NOT NULL CHECK (char_length(btrim(nombre)) BETWEEN 2 AND 80),
  descripcion    TEXT   NOT NULL DEFAULT '' CHECK (char_length(descripcion) <= 1000),
  responsable_id UUID   REFERENCES public.profiles(id) ON DELETE SET NULL,
  distrito       TEXT   CHECK (distrito IS NULL OR char_length(btrim(distrito)) BETWEEN 1 AND 60),
  estado         TEXT   NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','inactivo','archivado')),
  creado_por     UUID   REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- El nombre es único dentro del PE entre los equipos vivos (uno archivado libera el nombre).
CREATE UNIQUE INDEX IF NOT EXISTS equipos_nombre_uq
  ON public.equipos (periodo_id, lower(btrim(nombre))) WHERE estado <> 'archivado';
CREATE INDEX IF NOT EXISTS equipos_periodo_idx ON public.equipos (periodo_id);

CREATE TABLE IF NOT EXISTS public.equipo_miembros (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipo_id        BIGINT NOT NULL REFERENCES public.equipos(id) ON DELETE RESTRICT,
  persona_id       UUID   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  desde            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hasta            TIMESTAMPTZ,
  agregado_por     UUID   REFERENCES public.profiles(id) ON DELETE SET NULL,
  retirado_por     UUID   REFERENCES public.profiles(id) ON DELETE SET NULL,
  motivo_retiro    TEXT   CHECK (motivo_retiro IS NULL OR char_length(motivo_retiro) <= 500),
  excepcion        BOOLEAN NOT NULL DEFAULT false,
  excepcion_motivo TEXT   CHECK (excepcion_motivo IS NULL OR char_length(excepcion_motivo) <= 500),
  CHECK (hasta IS NULL OR hasta >= desde),
  CHECK (NOT excepcion OR char_length(COALESCE(btrim(excepcion_motivo), '')) >= 5)
);
--  Una sola fila VIGENTE por persona y equipo: aquí está la regla «no repetir integrantes».
CREATE UNIQUE INDEX IF NOT EXISTS equipo_miembros_vigente_uq
  ON public.equipo_miembros (equipo_id, persona_id) WHERE hasta IS NULL;
CREATE INDEX IF NOT EXISTS equipo_miembros_persona_idx ON public.equipo_miembros (persona_id);
CREATE INDEX IF NOT EXISTS equipo_miembros_equipo_idx  ON public.equipo_miembros (equipo_id);

CREATE TABLE IF NOT EXISTS public.equipo_eventos (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipo_id  BIGINT NOT NULL REFERENCES public.equipos(id) ON DELETE RESTRICT,
  actor_id   UUID,
  tipo       TEXT   NOT NULL CHECK (tipo IN ('creado','editado','estado','responsable','ambito','miembro_alta','miembro_baja','alerta')),
  persona_id UUID,
  detalle    JSONB  NOT NULL DEFAULT '{}'::jsonb,
  motivo     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS equipo_eventos_equipo_idx ON public.equipo_eventos (equipo_id, created_at DESC);


-- ── 2. Ayudantes de visibilidad (SECURITY DEFINER: así las políticas de las tres tablas no se llaman en círculo) ──
CREATE OR REPLACE FUNCTION public.es_integrante_equipo(p_equipo BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM equipo_miembros m
                  WHERE m.equipo_id = p_equipo AND m.persona_id = auth.uid() AND m.hasta IS NULL);
$$;
CREATE OR REPLACE FUNCTION public.fue_integrante_equipo(p_equipo BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM equipo_miembros m WHERE m.equipo_id = p_equipo AND m.persona_id = auth.uid());
$$;
--  La secretaría ve un equipo si su distrito es su ámbito o si alguien de su distrito es (o fue) integrante.
CREATE OR REPLACE FUNCTION public.equipo_de_mi_distrito(p_equipo BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_secretario() AND (
    EXISTS (SELECT 1 FROM equipos e WHERE e.id = p_equipo AND e.distrito IS NOT NULL AND e.distrito = public.mi_distrito())
    OR EXISTS (SELECT 1 FROM equipo_miembros m
                WHERE m.equipo_id = p_equipo AND m.persona_id IN (SELECT public.get_district_member_ids())));
$$;
CREATE OR REPLACE FUNCTION public.equipo_visible(p_equipo BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_admin()
    OR public.fue_integrante_equipo(p_equipo)
    OR EXISTS (SELECT 1 FROM equipos e WHERE e.id = p_equipo AND e.responsable_id = auth.uid())
    OR public.equipo_de_mi_distrito(p_equipo));
$$;
REVOKE EXECUTE ON FUNCTION public.es_integrante_equipo(BIGINT), public.fue_integrante_equipo(BIGINT),
  public.equipo_de_mi_distrito(BIGINT), public.equipo_visible(BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.es_integrante_equipo(BIGINT), public.fue_integrante_equipo(BIGINT),
  public.equipo_de_mi_distrito(BIGINT), public.equipo_visible(BIGINT) TO authenticated;


-- ── 3. RLS: lectura según rol; ninguna escritura directa ──────────────
ALTER TABLE public.equipos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipo_miembros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipo_eventos  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipos_select ON public.equipos;
CREATE POLICY equipos_select ON public.equipos FOR SELECT TO authenticated
  USING (public.equipo_visible(id));

DROP POLICY IF EXISTS equipo_miembros_select ON public.equipo_miembros;
CREATE POLICY equipo_miembros_select ON public.equipo_miembros FOR SELECT TO authenticated
  USING (public.is_admin()
         OR persona_id = auth.uid()
         OR (hasta IS NULL AND public.es_integrante_equipo(equipo_id))
         OR (public.is_secretario() AND persona_id IN (SELECT public.get_district_member_ids())));

DROP POLICY IF EXISTS equipo_eventos_select ON public.equipo_eventos;
CREATE POLICY equipo_eventos_select ON public.equipo_eventos FOR SELECT TO authenticated
  USING (public.is_admin() OR public.equipo_de_mi_distrito(equipo_id));

REVOKE ALL ON public.equipos, public.equipo_miembros, public.equipo_eventos FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.equipos, public.equipo_miembros, public.equipo_eventos FROM anon, authenticated;


-- ── 4. Elegibilidad ───────────────────────────────────────────────────
--  NULL = elegible; si no, el motivo. Nadie la salta (la excepción solo cubre el ámbito de distrito).
CREATE OR REPLACE FUNCTION public.persona_elegible_equipo(p_persona UUID, p_periodo UUID, p_distrito TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  pf profiles%ROWTYPE;
BEGIN
  SELECT * INTO pf FROM profiles WHERE id = p_persona;
  IF NOT FOUND THEN RETURN 'no_existe'; END IF;
  IF COALESCE(pf.es_admin, false) THEN RETURN 'administracion'; END IF;
  IF pf.aprobado IS FALSE THEN RETURN 'sin_aprobar'; END IF;
  IF EXISTS (SELECT 1 FROM periodo_participantes pp
              WHERE pp.periodo_id = p_periodo AND pp.user_id = p_persona AND NOT pp.activo) THEN
    RETURN 'no_participa';
  END IF;
  IF p_distrito IS NOT NULL AND pf.distrito IS DISTINCT FROM p_distrito THEN RETURN 'otro_distrito'; END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.persona_elegible_equipo(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.persona_elegible_equipo(UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.equipo_evento(p_equipo BIGINT, p_tipo TEXT, p_persona UUID, p_detalle JSONB, p_motivo TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO equipo_eventos (equipo_id, actor_id, tipo, persona_id, detalle, motivo)
  VALUES (p_equipo, auth.uid(), p_tipo, p_persona, COALESCE(p_detalle, '{}'::jsonb), p_motivo);
$$;
REVOKE EXECUTE ON FUNCTION public.equipo_evento(BIGINT, TEXT, UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;


-- ── 5. Crear y editar ─────────────────────────────────────────────────
--  p_id NULL = crear. El PE no cambia nunca después de crear (mover un equipo de PE reescribiría su historia:
--  se archiva y se crea otro).
CREATE OR REPLACE FUNCTION public.equipo_guardar(
  p_id          BIGINT,
  p_periodo     UUID,
  p_nombre      TEXT,
  p_descripcion TEXT DEFAULT '',
  p_responsable UUID DEFAULT NULL,
  p_distrito    TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  e        equipos%ROWTYPE;
  v_nombre TEXT := btrim(COALESCE(p_nombre, ''));
  v_dist   TEXT := NULLIF(btrim(COALESCE(p_distrito, '')), '');
  v_id     BIGINT;
  v_cambio JSONB := '{}'::jsonb;
  v_motivo TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo la administracion gestiona equipos.' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_nombre) < 2 OR char_length(v_nombre) > 80 THEN
    RAISE EXCEPTION 'El nombre del equipo debe tener entre 2 y 80 caracteres.' USING ERRCODE = '23514';
  END IF;
  IF char_length(COALESCE(p_descripcion, '')) > 1000 THEN
    RAISE EXCEPTION 'La descripcion no puede pasar de 1000 caracteres.' USING ERRCODE = '23514';
  END IF;

  IF p_id IS NULL THEN
    -- PE válido: existe, es de rúbrica por roles y su gestión admite escritura.
    IF p_periodo IS NULL OR NOT EXISTS (SELECT 1 FROM periodos_evaluacion WHERE id = p_periodo) THEN
      RAISE EXCEPTION 'Elige un PE existente para el equipo.' USING ERRCODE = '23514';
    END IF;
    IF (SELECT modelo FROM periodos_evaluacion WHERE id = p_periodo) IS DISTINCT FROM 'v2' THEN
      RAISE EXCEPTION 'Los equipos solo existen en PE con la rubrica por roles; los anteriores conservan su evaluacion original.'
        USING ERRCODE = '23514';
    END IF;
    IF NOT public.gestion_escribible(p_periodo) THEN
      RAISE EXCEPTION 'Esta gestion esta archivada: solo lectura.' USING ERRCODE = '42501';
    END IF;
    IF p_responsable IS NOT NULL AND public.persona_elegible_equipo(p_responsable, p_periodo, NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'La persona responsable no es elegible (debe tener acceso aprobado, no ser administracion y participar en el PE).'
        USING ERRCODE = '23514';
    END IF;
    BEGIN
      INSERT INTO equipos (periodo_id, nombre, descripcion, responsable_id, distrito, creado_por)
      VALUES (p_periodo, v_nombre, COALESCE(p_descripcion, ''), p_responsable, v_dist, auth.uid())
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Ya hay un equipo con ese nombre en este PE.' USING ERRCODE = '23505';
    END;
    PERFORM public.equipo_evento(v_id, 'creado', NULL,
      jsonb_build_object('nombre', v_nombre, 'responsable', p_responsable, 'distrito', v_dist), NULL);
    RETURN v_id;
  END IF;

  SELECT * INTO e FROM equipos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe ese equipo.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.gestion_escribible(e.periodo_id) THEN
    RAISE EXCEPTION 'Esta gestion esta archivada: solo lectura.' USING ERRCODE = '42501';
  END IF;
  IF e.estado = 'archivado' THEN
    RAISE EXCEPTION 'Un equipo archivado no se edita; restauralo primero.' USING ERRCODE = '23514';
  END IF;
  IF p_periodo IS NOT NULL AND p_periodo IS DISTINCT FROM e.periodo_id THEN
    RAISE EXCEPTION 'Un equipo no cambia de PE: archivalo y crea otro.' USING ERRCODE = '23514';
  END IF;
  IF p_responsable IS NOT NULL AND p_responsable IS DISTINCT FROM e.responsable_id
     AND public.persona_elegible_equipo(p_responsable, e.periodo_id, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'La persona responsable no es elegible (debe tener acceso aprobado, no ser administracion y participar en el PE).'
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    UPDATE equipos SET nombre = v_nombre, descripcion = COALESCE(p_descripcion, ''),
           responsable_id = p_responsable, distrito = v_dist, updated_at = NOW()
     WHERE id = p_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya hay un equipo con ese nombre en este PE.' USING ERRCODE = '23505';
  END;

  IF v_nombre IS DISTINCT FROM e.nombre OR COALESCE(p_descripcion, '') IS DISTINCT FROM e.descripcion THEN
    PERFORM public.equipo_evento(p_id, 'editado', NULL,
      jsonb_build_object('nombre', jsonb_build_object('de', e.nombre, 'a', v_nombre),
                         'descripcion_cambio', COALESCE(p_descripcion, '') IS DISTINCT FROM e.descripcion), NULL);
  END IF;
  IF p_responsable IS DISTINCT FROM e.responsable_id THEN
    PERFORM public.equipo_evento(p_id, 'responsable', p_responsable,
      jsonb_build_object('de', e.responsable_id, 'a', p_responsable), NULL);
  END IF;
  IF v_dist IS DISTINCT FROM e.distrito THEN
    PERFORM public.equipo_evento(p_id, 'ambito', NULL, jsonb_build_object('de', e.distrito, 'a', v_dist), NULL);
  END IF;
  RETURN p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipo_guardar(BIGINT, UUID, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.equipo_guardar(BIGINT, UUID, TEXT, TEXT, UUID, TEXT) TO authenticated;


-- ── 6. Estado: activo · inactivo · archivado ──────────────────────────
--  Archivar exige que no queden tareas colectivas abiertas (0032). Si 0032 aún no está, no hay nada que mirar.
CREATE OR REPLACE FUNCTION public.equipo_cambiar_estado(p_equipo BIGINT, p_estado TEXT, p_motivo TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  e       equipos%ROWTYPE;
  v_abier INT := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo la administracion gestiona equipos.' USING ERRCODE = '42501';
  END IF;
  IF p_estado NOT IN ('activo','inactivo','archivado') THEN
    RAISE EXCEPTION 'Estado de equipo desconocido.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO e FROM equipos WHERE id = p_equipo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe ese equipo.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.gestion_escribible(e.periodo_id) THEN
    RAISE EXCEPTION 'Esta gestion esta archivada: solo lectura.' USING ERRCODE = '42501';
  END IF;
  IF e.estado = p_estado THEN RETURN; END IF;
  IF e.estado = 'archivado' AND p_estado = 'activo' THEN
    RAISE EXCEPTION 'Un equipo archivado vuelve primero a inactivo.' USING ERRCODE = '23514';
  END IF;
  IF p_estado = 'archivado' THEN
    IF to_regclass('public.tareas_equipo') IS NOT NULL THEN
      EXECUTE 'SELECT COUNT(*) FROM public.tareas_equipo WHERE equipo_id = $1 AND estado IN (''asignada'',''en_curso'',''bloqueada'',''entregada'',''devuelta'')'
        INTO v_abier USING p_equipo;
    END IF;
    IF v_abier > 0 THEN
      RAISE EXCEPTION 'No se puede archivar: tiene % tarea(s) colectiva(s) abierta(s). Cierralas o anulalas antes.', v_abier
        USING ERRCODE = '23514';
    END IF;
    IF char_length(COALESCE(btrim(p_motivo), '')) < 5 THEN
      RAISE EXCEPTION 'Archivar un equipo necesita un motivo (minimo 5 caracteres).' USING ERRCODE = '23514';
    END IF;
  END IF;
  UPDATE equipos SET estado = p_estado, updated_at = NOW() WHERE id = p_equipo;
  PERFORM public.equipo_evento(p_equipo, 'estado', NULL, jsonb_build_object('de', e.estado, 'a', p_estado), NULLIF(btrim(COALESCE(p_motivo, '')), ''));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipo_cambiar_estado(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.equipo_cambiar_estado(BIGINT, TEXT, TEXT) TO authenticated;


-- ── 7. Integrantes ────────────────────────────────────────────────────
--  Agrega varias personas de una vez. NO falla por una: devuelve a quién agregó y a quién omitió y por qué
--  (ya integrante, no elegible, fuera del ámbito sin excepción). Así repetir la llamada no duplica nada.
CREATE OR REPLACE FUNCTION public.equipo_agregar_miembros(
  p_equipo    BIGINT,
  p_personas  UUID[],
  p_excepcion BOOLEAN DEFAULT false,
  p_motivo    TEXT    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  e        equipos%ROWTYPE;
  v_p      UUID;
  v_razon  TEXT;
  v_ag     UUID[] := '{}';
  v_om     JSONB  := '[]'::jsonb;
  v_exc    BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo la administracion gestiona equipos.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM equipos WHERE id = p_equipo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe ese equipo.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.gestion_escribible(e.periodo_id) THEN
    RAISE EXCEPTION 'Esta gestion esta archivada: solo lectura.' USING ERRCODE = '42501';
  END IF;
  IF e.estado <> 'activo' THEN
    RAISE EXCEPTION 'Solo se agregan integrantes a un equipo activo.' USING ERRCODE = '23514';
  END IF;
  IF p_personas IS NULL OR array_length(p_personas, 1) IS NULL THEN
    RAISE EXCEPTION 'Elige al menos una persona.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_excepcion, false) AND char_length(COALESCE(btrim(p_motivo), '')) < 5 THEN
    RAISE EXCEPTION 'Una excepcion de ambito necesita un motivo (minimo 5 caracteres).' USING ERRCODE = '23514';
  END IF;

  FOR v_p IN SELECT DISTINCT x FROM unnest(p_personas) x WHERE x IS NOT NULL LOOP
    IF EXISTS (SELECT 1 FROM equipo_miembros m WHERE m.equipo_id = p_equipo AND m.persona_id = v_p AND m.hasta IS NULL) THEN
      v_om := v_om || jsonb_build_object('persona', v_p, 'razon', 'ya_integrante');
      CONTINUE;
    END IF;
    v_razon := public.persona_elegible_equipo(v_p, e.periodo_id, e.distrito);
    v_exc := false;
    IF v_razon = 'otro_distrito' AND COALESCE(p_excepcion, false) THEN
      -- La excepción solo cubre el ámbito; lo demás (aprobación, participación) se comprueba aparte.
      v_razon := public.persona_elegible_equipo(v_p, e.periodo_id, NULL);
      v_exc := v_razon IS NULL;
    END IF;
    IF v_razon IS NOT NULL THEN
      v_om := v_om || jsonb_build_object('persona', v_p, 'razon', v_razon);
      CONTINUE;
    END IF;
    INSERT INTO equipo_miembros (equipo_id, persona_id, agregado_por, excepcion, excepcion_motivo)
    VALUES (p_equipo, v_p, auth.uid(), v_exc, CASE WHEN v_exc THEN btrim(p_motivo) END);
    v_ag := v_ag || v_p;
    PERFORM public.equipo_evento(p_equipo, 'miembro_alta', v_p,
      jsonb_build_object('excepcion', v_exc), CASE WHEN v_exc THEN btrim(p_motivo) END);
  END LOOP;

  UPDATE equipos SET updated_at = NOW() WHERE id = p_equipo;
  -- Las tareas colectivas abiertas del equipo suman a la persona nueva (0032 define la política exacta).
  IF to_regprocedure('public.tarea_equipo_alta_integrante(bigint,uuid)') IS NOT NULL THEN
    FOREACH v_p IN ARRAY v_ag LOOP
      EXECUTE 'SELECT public.tarea_equipo_alta_integrante($1, $2)' USING p_equipo, v_p;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('agregados', to_jsonb(v_ag), 'omitidos', v_om);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipo_agregar_miembros(BIGINT, UUID[], BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.equipo_agregar_miembros(BIGINT, UUID[], BOOLEAN, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.equipo_retirar_miembro(p_equipo BIGINT, p_persona UUID, p_motivo TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  e equipos%ROWTYPE;
  m equipo_miembros%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo la administracion gestiona equipos.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM equipos WHERE id = p_equipo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe ese equipo.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.gestion_escribible(e.periodo_id) THEN
    RAISE EXCEPTION 'Esta gestion esta archivada: solo lectura.' USING ERRCODE = '42501';
  END IF;
  IF char_length(COALESCE(btrim(p_motivo), '')) < 5 THEN
    RAISE EXCEPTION 'Retirar a alguien necesita un motivo (minimo 5 caracteres).' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO m FROM equipo_miembros WHERE equipo_id = p_equipo AND persona_id = p_persona AND hasta IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa persona no es integrante vigente del equipo.' USING ERRCODE = '23514';
  END IF;
  UPDATE equipo_miembros SET hasta = NOW(), retirado_por = auth.uid(), motivo_retiro = btrim(p_motivo) WHERE id = m.id;
  IF e.responsable_id = p_persona THEN
    UPDATE equipos SET responsable_id = NULL WHERE id = p_equipo;
    PERFORM public.equipo_evento(p_equipo, 'responsable', NULL,
      jsonb_build_object('de', p_persona, 'a', NULL, 'causa', 'salio_del_equipo'), NULL);
  END IF;
  UPDATE equipos SET updated_at = NOW() WHERE id = p_equipo;
  PERFORM public.equipo_evento(p_equipo, 'miembro_baja', p_persona, '{}'::jsonb, btrim(p_motivo));
  IF to_regprocedure('public.tarea_equipo_baja_integrante(bigint,uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT public.tarea_equipo_baja_integrante($1, $2)' USING p_equipo, p_persona;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipo_retirar_miembro(BIGINT, UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.equipo_retirar_miembro(BIGINT, UUID, TEXT) TO authenticated;


-- ── 8. Integrantes con su alerta vigente ──────────────────────────────
--  Lo que ve cada quien: administración, todo (incluidas bajas y alertas); integrante, la lista vigente sin
--  datos de gestión; secretaría, solo las personas de su distrito, con su alerta.
CREATE OR REPLACE FUNCTION public.equipo_integrantes(p_equipo BIGINT, p_incluir_bajas BOOLEAN DEFAULT false)
RETURNS TABLE (
  persona_id UUID, nombre TEXT, distrito TEXT, rol_id BIGINT, rol_nombre TEXT, tipo_miembro TEXT,
  desde TIMESTAMPTZ, hasta TIMESTAMPTZ, motivo_retiro TEXT, excepcion BOOLEAN, excepcion_motivo TEXT,
  es_responsable BOOLEAN, alerta TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_admin BOOLEAN; v_sec BOOLEAN; v_integrante BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  IF NOT public.equipo_visible(p_equipo) THEN RETURN; END IF;
  v_admin := public.is_admin();
  v_sec   := public.is_secretario();
  v_integrante := public.es_integrante_equipo(p_equipo);

  RETURN QUERY
  SELECT m.persona_id, COALESCE(NULLIF(pf.nombre, ''), pf.email), pf.distrito, pf.rol_id::BIGINT, ro.nombre, pf.tipo_miembro,
         m.desde, m.hasta,
         CASE WHEN v_admin OR v_sec THEN m.motivo_retiro END,
         CASE WHEN v_admin OR v_sec THEN m.excepcion ELSE false END,
         CASE WHEN v_admin OR v_sec THEN m.excepcion_motivo END,
         (e.responsable_id = m.persona_id),
         CASE WHEN m.hasta IS NOT NULL OR NOT (v_admin OR v_sec) THEN NULL
              WHEN NOT COALESCE(pf.aprobado, true) THEN 'sin_aprobar'
              WHEN EXISTS (SELECT 1 FROM periodo_participantes pp
                            WHERE pp.periodo_id = e.periodo_id AND pp.user_id = m.persona_id AND NOT pp.activo) THEN 'no_participa'
              WHEN e.distrito IS NOT NULL AND pf.distrito IS DISTINCT FROM e.distrito AND NOT m.excepcion THEN 'otro_distrito'
              END
    FROM equipo_miembros m
    JOIN equipos  e  ON e.id = m.equipo_id
    JOIN profiles pf ON pf.id = m.persona_id
    LEFT JOIN roles ro ON ro.id = pf.rol_id
   WHERE m.equipo_id = p_equipo
     AND (p_incluir_bajas OR m.hasta IS NULL)
     AND (v_admin
          OR m.persona_id = auth.uid()
          OR (m.hasta IS NULL AND v_integrante)
          OR (v_sec AND m.persona_id IN (SELECT public.get_district_member_ids())))
     AND (m.hasta IS NULL OR v_admin OR v_sec OR m.persona_id = auth.uid())
   ORDER BY (m.hasta IS NOT NULL), COALESCE(NULLIF(pf.nombre, ''), pf.email);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipo_integrantes(BIGINT, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.equipo_integrantes(BIGINT, BOOLEAN) TO authenticated;


-- ── 9. Alertas de ámbito (nunca cambian nada, solo avisan) ────────────
CREATE OR REPLACE FUNCTION public.equipos_alerta_distrito()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.distrito IS DISTINCT FROM OLD.distrito THEN
    INSERT INTO equipo_eventos (equipo_id, actor_id, tipo, persona_id, detalle)
    SELECT m.equipo_id, auth.uid(), 'alerta', NEW.id,
           jsonb_build_object('causa', 'cambio_distrito', 'de', OLD.distrito, 'a', NEW.distrito, 'ambito_equipo', e.distrito)
      FROM equipo_miembros m JOIN equipos e ON e.id = m.equipo_id
     WHERE m.persona_id = NEW.id AND m.hasta IS NULL AND e.estado <> 'archivado';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipos_alerta_distrito() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS equipos_alerta_distrito ON public.profiles;
CREATE TRIGGER equipos_alerta_distrito
  AFTER UPDATE OF distrito ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.equipos_alerta_distrito();

CREATE OR REPLACE FUNCTION public.equipos_alerta_participacion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT NEW.activo AND (TG_OP = 'INSERT' OR OLD.activo) THEN
    INSERT INTO equipo_eventos (equipo_id, actor_id, tipo, persona_id, detalle)
    SELECT m.equipo_id, auth.uid(), 'alerta', NEW.user_id, jsonb_build_object('causa', 'deja_de_participar')
      FROM equipo_miembros m JOIN equipos e ON e.id = m.equipo_id
     WHERE m.persona_id = NEW.user_id AND m.hasta IS NULL AND e.periodo_id = NEW.periodo_id AND e.estado <> 'archivado';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipos_alerta_participacion() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS equipos_alerta_participacion ON public.periodo_participantes;
CREATE TRIGGER equipos_alerta_participacion
  AFTER INSERT OR UPDATE OF activo ON public.periodo_participantes
  FOR EACH ROW EXECUTE FUNCTION public.equipos_alerta_participacion();

COMMIT;


-- ══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- ══════════════════════════════════════════════════════════════════════
--   SET ROLE anon; SELECT count(*) FROM equipos;           -- permiso denegado
--   Un miembro no escribe: INSERT INTO equipos ... → permiso denegado (sin grants de escritura).
-- DOWN (comentado)
-- ══════════════════════════════════════════════════════════════════════
-- BEGIN;
-- DROP TRIGGER IF EXISTS equipos_alerta_participacion ON public.periodo_participantes;
-- DROP TRIGGER IF EXISTS equipos_alerta_distrito ON public.profiles;
-- DROP FUNCTION IF EXISTS public.equipos_alerta_participacion(), public.equipos_alerta_distrito(),
--   public.equipo_integrantes(BIGINT, BOOLEAN), public.equipo_retirar_miembro(BIGINT, UUID, TEXT),
--   public.equipo_agregar_miembros(BIGINT, UUID[], BOOLEAN, TEXT), public.equipo_cambiar_estado(BIGINT, TEXT, TEXT),
--   public.equipo_guardar(BIGINT, UUID, TEXT, TEXT, UUID, TEXT), public.equipo_evento(BIGINT, TEXT, UUID, JSONB, TEXT),
--   public.persona_elegible_equipo(UUID, UUID, TEXT), public.equipo_visible(BIGINT), public.equipo_de_mi_distrito(BIGINT),
--   public.fue_integrante_equipo(BIGINT), public.es_integrante_equipo(BIGINT);
-- DROP TABLE IF EXISTS public.equipo_eventos, public.equipo_miembros, public.equipos CASCADE;
-- COMMIT;
