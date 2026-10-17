-- ══════════════════════════════════════════════════════════════════════
--  0024 — Actividades: «Para quién» con equipos y personas
-- ══════════════════════════════════════════════════════════════════════
--
--  HASTA AHORA una actividad era «de todo el equipo» o «de un distrito» (columna `distrito`).
--  Ahora tiene un ALCANCE explícito:
--
--      equipo     todas las personas de la gestión (solo la administración)
--      distrito   un distrito entero (la administración, o la secretaría de ese distrito)
--      seleccion  un conjunto de personas concretas (`actividad_destinatarios`). Elegir un equipo
--                 en la pantalla agrega a sus miembros de ese momento; quien entre después no se suma solo.
--
--  VISIBILIDAD (la impone la base, no el cliente)
--      · la administración ve todo;
--      · «equipo» lo ve cualquier persona autenticada; «distrito», quien es de ese distrito;
--      · «seleccion» lo ven sus destinatarias, quien la creó, la administración y la secretaría del
--        distrito dueño (o de alguna destinataria). Nadie más: ni el resto del distrito.
--  ESCRITURA
--      · la administración escribe todo;
--      · la secretaría solo actividades de SU distrito y, si son «seleccion», solo con personas de su distrito;
--      · nadie escribe en una gestión archivada.
--      Los destinatarios no se escriben suelto: se guardan con guardar_actividad(), que valida y reemplaza
--      la lista junto con la actividad en una sola operación.
--  AVISOS (0019)
--      El aviso «actividad nueva» y el recordatorio de la víspera llegan solo a quien corresponde según
--      el alcance. Si 0019 no está aplicada, esa parte se omite sin error.
--
--  NO SE PIERDE NADA: cada actividad existente pasa a «equipo» (si no tenía distrito) o «distrito»
--  (si lo tenía), exactamente lo que ya significaba.
--
--  Requiere 0018 (y 0019 para los avisos). Aplicación manual en el SQL Editor. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Alcance ────────────────────────────────────────────────────────
ALTER TABLE public.actividades ADD COLUMN IF NOT EXISTS alcance TEXT NOT NULL DEFAULT 'equipo';

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actividades_alcance_chk') THEN
    ALTER TABLE public.actividades ADD CONSTRAINT actividades_alcance_chk CHECK (alcance IN ('equipo','distrito','seleccion'));
  END IF;
END $chk$;

--  Lo que ya existía conserva su significado.
--  (sin el trigger de reglas: en el SQL Editor no hay sesión y rechazaría el UPDATE; no cambia ningún dato más)
ALTER TABLE public.actividades DISABLE TRIGGER actividades_fijar;
UPDATE public.actividades SET alcance = 'distrito' WHERE alcance = 'equipo' AND distrito IS NOT NULL;
ALTER TABLE public.actividades ENABLE TRIGGER actividades_fijar;

-- ── 2. Destinatarias ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.actividad_destinatarios (
  actividad_id BIGINT NOT NULL REFERENCES public.actividades(id) ON DELETE CASCADE,
  persona_id   UUID   NOT NULL REFERENCES public.profiles(id)    ON DELETE CASCADE,
  PRIMARY KEY (actividad_id, persona_id)
);
CREATE INDEX IF NOT EXISTS actividad_destinatarios_persona_idx ON public.actividad_destinatarios (persona_id);

--  Ayudantes SECURITY DEFINER: las políticas de `actividades` y de `actividad_destinatarios` se miran
--  entre sí; consultar la otra tabla desde una función evita la recursión de políticas.
CREATE OR REPLACE FUNCTION public.act_soy_destinataria(p_actividad BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM actividad_destinatarios WHERE actividad_id = p_actividad AND persona_id = auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.act_destinataria_de_mi_distrito(p_actividad BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_secretario() AND EXISTS (
    SELECT 1 FROM actividad_destinatarios d
     WHERE d.actividad_id = p_actividad AND d.persona_id IN (SELECT public.get_district_member_ids()));
$$;
CREATE OR REPLACE FUNCTION public.act_creada_por_mi(p_actividad BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM actividades WHERE id = p_actividad AND creada_por = auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public.act_soy_destinataria(BIGINT), public.act_destinataria_de_mi_distrito(BIGINT),
                           public.act_creada_por_mi(BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.act_soy_destinataria(BIGINT), public.act_destinataria_de_mi_distrito(BIGINT),
                           public.act_creada_por_mi(BIGINT) TO authenticated;

ALTER TABLE public.actividad_destinatarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS act_dest_leer ON public.actividad_destinatarios;
CREATE POLICY act_dest_leer ON public.actividad_destinatarios FOR SELECT TO authenticated
  USING (public.is_admin() OR persona_id = auth.uid()
         OR (public.is_secretario() AND persona_id IN (SELECT public.get_district_member_ids()))
         OR public.act_creada_por_mi(actividad_id));
REVOKE ALL ON public.actividad_destinatarios FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.actividad_destinatarios FROM authenticated;

-- ── 3. Reglas del servidor (reemplaza el trigger de 0018, conserva todo lo anterior) ──
CREATE OR REPLACE FUNCTION public.actividades_fijar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.creada_por := auth.uid();
  ELSE
    NEW.gestion_id := OLD.gestion_id;
    NEW.creada_por := OLD.creada_por;
  END IF;
  NEW.updated_at := now();
  IF NEW.etiqueta_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM etiquetas e WHERE e.id = NEW.etiqueta_id AND e.gestion_id = NEW.gestion_id) THEN
    RAISE EXCEPTION 'La etiqueta no pertenece a esta gestión.' USING ERRCODE = '23514';
  END IF;

  -- Coherencia alcance ↔ distrito. Un cliente anterior a 0024 manda `distrito` sin alcance: se interpreta igual.
  IF NEW.alcance = 'equipo' AND NEW.distrito IS NOT NULL THEN NEW.alcance := 'distrito'; END IF;
  IF NEW.alcance = 'distrito' AND NEW.distrito IS NULL THEN
    RAISE EXCEPTION 'Una actividad de distrito necesita el distrito.' USING ERRCODE = '23514';
  END IF;

  IF NOT public.is_admin() THEN
    -- La secretaría es dueña de lo de su distrito; lo «seleccion» de una secretaría queda anclado a su distrito.
    IF NEW.alcance = 'seleccion' AND NEW.distrito IS NULL THEN NEW.distrito := public.mi_distrito(); END IF;
    IF NEW.alcance = 'equipo' OR NEW.distrito IS NULL OR NEW.distrito IS DISTINCT FROM public.mi_distrito() THEN
      RAISE EXCEPTION 'Solo la administración crea actividades para todo el equipo; tú, para tu distrito.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.actividades_fijar() FROM PUBLIC, anon, authenticated;

-- ── 4. Visibilidad ────────────────────────────────────────────────────
DROP POLICY IF EXISTS actividades_leer ON public.actividades;
CREATE POLICY actividades_leer ON public.actividades FOR SELECT TO authenticated
  USING (public.is_admin()
         OR alcance = 'equipo'
         OR (alcance = 'distrito' AND distrito = public.mi_distrito())
         OR (alcance = 'seleccion' AND (creada_por = auth.uid()
                                        OR public.act_soy_destinataria(id)
                                        OR (public.is_secretario() AND distrito IS NOT NULL AND distrito = public.mi_distrito())
                                        OR public.act_destinataria_de_mi_distrito(id))));
--  actividades_admin y actividades_secretaria (0018) siguen igual: escritura de la administración y, para la
--  secretaría, solo filas con su distrito. La política de lectura de la secretaría (FOR ALL) cubre lo suyo.

-- ── 5. Guardado atómico ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guardar_actividad(
  p_id BIGINT, p_gestion BIGINT, p_titulo TEXT, p_descripcion TEXT, p_etiqueta BIGINT,
  p_inicio DATE, p_fin DATE, p_alcance TEXT, p_distrito TEXT, p_personas UUID[]
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_admin BOOLEAN; v_sec BOOLEAN; v_mi TEXT;
  v_id BIGINT; v_gestion BIGINT; v_personas UUID[]; v_antes UUID[]; v_nuevas UUID[];
  v_row actividades%ROWTYPE; v_pid UUID; v_etq TEXT; v_fecha TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.' USING ERRCODE = '42501'; END IF;
  v_admin := public.is_admin(); v_sec := public.is_secretario(); v_mi := public.mi_distrito();
  IF NOT (v_admin OR v_sec) THEN RAISE EXCEPTION 'Solo la administracion y las secretarias crean actividades.' USING ERRCODE = '42501'; END IF;
  IF p_alcance NOT IN ('equipo','distrito','seleccion') THEN RAISE EXCEPTION 'Alcance no valido.' USING ERRCODE = '23514'; END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_row FROM actividades WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'La actividad no existe.' USING ERRCODE = '23514'; END IF;
    IF NOT (v_admin OR (v_sec AND v_row.distrito IS NOT NULL AND v_row.distrito = v_mi)) THEN
      RAISE EXCEPTION 'No puedes editar esta actividad.' USING ERRCODE = '42501';
    END IF;
    v_gestion := v_row.gestion_id;
  ELSE
    v_gestion := p_gestion;
  END IF;
  IF v_gestion IS NULL OR NOT public.gestion_id_escribible(v_gestion) THEN
    RAISE EXCEPTION 'Esta gestion esta archivada o no existe: solo lectura.' USING ERRCODE = '42501';
  END IF;

  -- Personas: sin repetidos, que existan y estén aprobadas.
  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_personas FROM unnest(COALESCE(p_personas, '{}')) AS x;
  IF p_alcance = 'seleccion' THEN
    IF COALESCE(array_length(v_personas, 1), 0) = 0 THEN RAISE EXCEPTION 'Elige al menos una persona.' USING ERRCODE = '23514'; END IF;
    IF array_length(v_personas, 1) > 500 THEN RAISE EXCEPTION 'Demasiadas personas en una sola actividad.' USING ERRCODE = '23514'; END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_personas) AS x WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = x AND p.aprobado IS NOT FALSE)) THEN
      RAISE EXCEPTION 'Alguna persona elegida no existe o no tiene acceso aprobado.' USING ERRCODE = '23514';
    END IF;
    IF NOT v_admin AND EXISTS (SELECT 1 FROM unnest(v_personas) AS x WHERE x NOT IN (SELECT public.get_district_member_ids())) THEN
      RAISE EXCEPTION 'Solo puedes elegir personas de tu distrito.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_alcance = 'equipo' AND NOT v_admin THEN
    RAISE EXCEPTION 'Solo la administracion crea actividades para todo el equipo.' USING ERRCODE = '42501';
  END IF;
  IF p_alcance = 'distrito' AND NOT v_admin AND p_distrito IS DISTINCT FROM v_mi THEN
    RAISE EXCEPTION 'Solo puedes crear actividades de tu distrito.' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO actividades (gestion_id, titulo, descripcion, etiqueta_id, fecha_inicio, fecha_fin, alcance, distrito)
    VALUES (v_gestion, p_titulo, COALESCE(p_descripcion, ''), p_etiqueta, p_inicio, p_fin, p_alcance,
            CASE p_alcance WHEN 'equipo' THEN NULL WHEN 'distrito' THEN p_distrito ELSE (CASE WHEN v_admin THEN NULL ELSE v_mi END) END)
    RETURNING id INTO v_id;
    v_antes := '{}';
  ELSE
    v_id := p_id;
    SELECT COALESCE(array_agg(persona_id), '{}') INTO v_antes FROM actividad_destinatarios WHERE actividad_id = v_id;
    UPDATE actividades SET titulo = p_titulo, descripcion = COALESCE(p_descripcion, ''), etiqueta_id = p_etiqueta,
           fecha_inicio = p_inicio, fecha_fin = p_fin, alcance = p_alcance,
           distrito = CASE p_alcance WHEN 'equipo' THEN NULL WHEN 'distrito' THEN p_distrito
                                     ELSE (CASE WHEN v_admin THEN v_row.distrito ELSE v_mi END) END
     WHERE id = v_id;
  END IF;

  DELETE FROM actividad_destinatarios WHERE actividad_id = v_id;
  IF p_alcance = 'seleccion' THEN
    INSERT INTO actividad_destinatarios (actividad_id, persona_id) SELECT v_id, x FROM unnest(v_personas) AS x;
    -- Aviso a quien se suma (en una creación, a todas). Si 0019 no está, no pasa nada.
    SELECT COALESCE(array_agg(x), '{}') INTO v_nuevas FROM unnest(v_personas) AS x WHERE NOT (x = ANY (v_antes)) AND x <> v_uid;
    BEGIN
      SELECT nombre INTO v_etq FROM etiquetas WHERE id = p_etiqueta;
      v_fecha := CASE WHEN p_fin IS NULL OR p_fin = p_inicio THEN to_char(p_inicio, 'DD/MM/YYYY')
                      ELSE to_char(p_inicio, 'DD/MM/YYYY') || ' al ' || to_char(p_fin, 'DD/MM/YYYY') END;
      FOREACH v_pid IN ARRAY v_nuevas LOOP
        PERFORM public.notif_encolar(v_pid, 'actividad_nueva',
          jsonb_build_object('actividad', p_titulo, 'fecha', v_fecha, 'etiqueta', COALESCE(v_etq, 'Actividad')),
          'actividad_nueva:' || v_id || ':' || v_pid);
      END LOOP;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guardar_actividad(BIGINT, BIGINT, TEXT, TEXT, BIGINT, DATE, DATE, TEXT, TEXT, UUID[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.guardar_actividad(BIGINT, BIGINT, TEXT, TEXT, BIGINT, DATE, DATE, TEXT, TEXT, UUID[]) TO authenticated;

-- ── 6. Avisos (0019): solo a quien corresponde ────────────────────────
--  Audiencia de una actividad según su alcance. plpgsql (se resuelve al ejecutar) para no exigir 0019 al crearla.
CREATE OR REPLACE FUNCTION public.notif_audiencia_actividad(p_actividad BIGINT, p_excluir UUID DEFAULT NULL)
RETURNS SETOF UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a actividades%ROWTYPE;
BEGIN
  SELECT * INTO a FROM actividades WHERE id = p_actividad;
  IF NOT FOUND THEN RETURN; END IF;
  IF a.alcance = 'seleccion' THEN
    RETURN QUERY SELECT p.id FROM actividad_destinatarios d JOIN profiles p ON p.id = d.persona_id
                  WHERE d.actividad_id = a.id AND p.aprobado IS NOT FALSE AND COALESCE(p.email, '') <> ''
                    AND p.id IS DISTINCT FROM p_excluir;
  ELSE
    RETURN QUERY SELECT public.notif_audiencia(CASE WHEN a.alcance = 'distrito' THEN a.distrito ELSE NULL END, p_excluir);
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notif_audiencia_actividad(BIGINT, UUID) FROM PUBLIC, anon, authenticated;

DO $notif$
DECLARE v_def TEXT;
BEGIN
  IF to_regprocedure('public.notif_trg_actividad()') IS NULL THEN RETURN; END IF;

  -- (a) El aviso de «actividad nueva» al crearla: una «seleccion» lo envía guardar_actividad() cuando ya
  --     tiene destinatarias; aquí, que aún no las tiene, se omite. Equipo y distrito, como antes.
  v_def := pg_get_functiondef('public.notif_trg_actividad()'::regprocedure);
  IF position('NEW.alcance' IN v_def) = 0 THEN
    v_def := replace(v_def, 'FOR v_pid IN SELECT notif_audiencia(NEW.distrito, NEW.creada_por) LOOP',
                            'IF NEW.alcance = ''seleccion'' THEN RETURN NULL; END IF;' || E'\n    ' ||
                            'FOR v_pid IN SELECT notif_audiencia(NEW.distrito, NEW.creada_por) LOOP');
    EXECUTE v_def;
  END IF;

  -- (b) El recordatorio de la víspera: su audiencia sale del alcance de cada actividad.
  IF to_regprocedure('public.notif_generar_recordatorios()') IS NOT NULL THEN
    v_def := pg_get_functiondef('public.notif_generar_recordatorios()'::regprocedure);
    IF position('notif_audiencia(r.distrito)' IN v_def) > 0 THEN
      v_def := replace(v_def, 'notif_audiencia(r.distrito)', 'notif_audiencia_actividad(r.id)');
      EXECUTE v_def;
    END IF;
  END IF;
END $notif$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (después de aplicar)
-- ══════════════════════════════════════════════════════════════════════
--   SELECT alcance, count(*) FROM actividades GROUP BY 1;     -- equipo / distrito según lo que ya había
--   SELECT pg_get_functiondef('public.notif_generar_recordatorios()'::regprocedure) LIKE '%notif_audiencia_actividad%';  -- true
-- ══════════════════════════════════════════════════════════════════════
-- DESHACER (comentado; las actividades «seleccion» quedan con alcance 'seleccion' hasta que se reasignen)
-- DROP FUNCTION guardar_actividad(BIGINT,BIGINT,TEXT,TEXT,BIGINT,DATE,DATE,TEXT,TEXT,UUID[]);
-- DROP POLICY actividades_leer ON actividades;
-- CREATE POLICY actividades_leer ON actividades FOR SELECT TO authenticated USING (is_admin() OR distrito IS NULL OR distrito = mi_distrito());
-- DROP TABLE actividad_destinatarios; ALTER TABLE actividades DROP COLUMN alcance;
