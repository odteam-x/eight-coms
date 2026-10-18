-- ══════════════════════════════════════════════════════════════════════
--  0041 — Avisos de equipos, tareas colectivas y calificaciones (conecta 0031–0036 con 0040)
-- ══════════════════════════════════════════════════════════════════════
--
--  Los avisos se disparan con un trigger AFTER INSERT sobre las tablas de EVENTOS de 0031–0036 (append-only,
--  id estable): `equipo_eventos`, `tarea_equipo_eventos` y `calificaciones_historial`. Cada hecho tiene su id,
--  que es la clave de deduplicación (`tipo:ref:evento:destinatario`). Documento de la sesión de equipos:
--  docs/equipos-puntos-de-emision.md. Los disparadores NUNCA hacen fallar la operación de negocio.
--
--  AUDIENCIA (solo involucrados y autorizados; el actor no se avisa a sí mismo):
--    · equipo_incorporado / equipo_retiro → la persona incorporada / retirada (retiro voluntario: no se avisa).
--    · tarea_colectiva_asignada, tarea_cambio, correccion_solicitada, observacion_nueva, estado_cambiado →
--      `tarea_equipo_participantes` VIGENTES (hasta IS NULL), no el equipo actual: quien ya salió no es audiencia.
--    · entrega_registrada, tarea_bloqueada → administración + secretaría del distrito del equipo + responsable.
--    · calificacion_nueva / calificacion_cambiada → la persona (tarea individual o nota individual dentro de un
--      grupo) o los participantes vigentes (nota del grupo). NUNCA llevan puntos ni motivo: solo avisan y enlazan.
--    · Una tarea individual aprobada ya avisa con `tarea_aprobada` (0040): su «calificada» no genera otro aviso.
--      Una tarea de equipo aprobada avisa con `calificacion_nueva` (no con `tarea_aprobada`).
--    · tarea_por_vencer / tarea_vencida de equipo: función diaria `notif_recordatorios_equipos()` (pg_cron).
--
--  Aplicación manual en el SQL Editor, tras 0040 (y 0031–0036). Idempotente. Si 0031–0036 no están, no hace nada.
-- ══════════════════════════════════════════════════════════════════════

DO $m41$
BEGIN
  IF to_regclass('public.equipo_eventos') IS NULL OR to_regclass('public.tarea_equipo_eventos') IS NULL
     OR to_regclass('public.calificaciones_historial') IS NULL THEN
    RAISE NOTICE '0041: faltan 0031–0036; no se instala nada (aplícalas primero y vuelve a correr 0041).';
    RETURN;
  END IF;

  -- ── Pantallas de destino de los tipos de equipo (miembro/secretaría: Entregas; administración: Equipos) ──
  UPDATE public.notif_tipos SET destino = '{"admin":"equipos","secretario":"trabajos","miembro":"trabajos"}'::jsonb
   WHERE tipo IN ('equipo_incorporado', 'equipo_retiro');

  -- ── Utilidades ────────────────────────────────────────────────────
  EXECUTE $f$
  CREATE OR REPLACE FUNCTION public.notif_nombre(p UUID) RETURNS TEXT
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $b$
    SELECT NULLIF(btrim(nombre), '') FROM profiles WHERE id = p
  $b$ $f$;

  EXECUTE $f$
  CREATE OR REPLACE FUNCTION public.notif_participantes_tarea_equipo(p_tarea BIGINT) RETURNS UUID[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $b$
    SELECT COALESCE(array_agg(persona_id), '{}'::uuid[]) FROM tarea_equipo_participantes WHERE tarea_id = p_tarea AND hasta IS NULL
  $b$ $f$;

  -- Quien revisa una tarea de equipo: administración, secretaría del distrito del equipo y quien le hace seguimiento.
  EXECUTE $f$
  CREATE OR REPLACE FUNCTION public.notif_revisores_tarea_equipo(p_tarea BIGINT) RETURNS UUID[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $b$
    SELECT COALESCE(array_agg(DISTINCT x), '{}'::uuid[]) FROM (
      SELECT a.id AS x FROM profiles a WHERE COALESCE(a.es_admin, false) AND a.aprobado IS NOT FALSE
      UNION
      SELECT s.id FROM profiles s JOIN tareas_equipo t ON t.id = p_tarea JOIN equipos e ON e.id = t.equipo_id
       WHERE s.tipo_miembro = 'secretario' AND NOT COALESCE(s.es_admin, false) AND e.distrito IS NOT NULL
         AND s.distrito = e.distrito AND s.aprobado IS NOT FALSE
      UNION
      SELECT t.responsable_id FROM tareas_equipo t WHERE t.id = p_tarea AND t.responsable_id IS NOT NULL
    ) q
  $b$ $f$;

  -- ── 1. Equipos ─────────────────────────────────────────────────────
  EXECUTE $f$
  CREATE OR REPLACE FUNCTION public.notif_trg_equipo_evento() RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $b$
  DECLARE v_eq equipos%ROWTYPE; v_actor TEXT; v_ev TEXT := 'e' || NEW.id; v_aud UUID[];
  BEGIN
    BEGIN
      SELECT * INTO v_eq FROM equipos WHERE id = NEW.equipo_id;
      v_actor := public.notif_nombre(NEW.actor_id);
      IF NEW.tipo = 'miembro_alta' AND NEW.persona_id IS NOT NULL THEN
        PERFORM notif_emitir('equipo_incorporado', ARRAY[NEW.persona_id],
          jsonb_build_object('equipo', v_eq.nombre, 'agregado_por', v_actor),
          'equipo', NEW.equipo_id::text, v_ev, NEW.actor_id);
      ELSIF NEW.tipo = 'miembro_baja' AND NEW.persona_id IS NOT NULL THEN
        -- Si la persona se retiró sola, el actor es ella y notif_emitir no la avisa.
        PERFORM notif_emitir('equipo_retiro', ARRAY[NEW.persona_id],
          jsonb_build_object('equipo', v_eq.nombre, 'retirado_por', v_actor, 'motivo', NEW.motivo),
          'equipo', NEW.equipo_id::text, v_ev, NEW.actor_id);
      ELSIF NEW.tipo = 'estado' THEN
        SELECT COALESCE(array_agg(persona_id), '{}'::uuid[]) INTO v_aud FROM equipo_miembros WHERE equipo_id = NEW.equipo_id AND hasta IS NULL;
        PERFORM notif_emitir('estado_cambiado', v_aud,
          jsonb_build_object('objeto', 'Equipo', 'elemento', v_eq.nombre, 'antes', NEW.detalle ->> 'de', 'ahora', NEW.detalle ->> 'a',
                             'cambiado_por', v_actor),
          'equipo', NEW.equipo_id::text, v_ev, NEW.actor_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN NULL;
  END;
  $b$ $f$;

  -- ── 2. Tareas colectivas ───────────────────────────────────────────
  EXECUTE $f$
  CREATE OR REPLACE FUNCTION public.notif_trg_tarea_equipo_evento() RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $b$
  DECLARE
    t tareas_equipo%ROWTYPE; v_eq TEXT; v_per TEXT; v_actor TEXT; v_ev TEXT := 'e' || NEW.id;
    v_part UUID[]; v_zona TEXT; v_nota TEXT; v_cambio TEXT;
  BEGIN
    BEGIN
      SELECT * INTO t FROM tareas_equipo WHERE id = NEW.tarea_id;
      SELECT nombre INTO v_eq FROM equipos WHERE id = t.equipo_id;
      v_actor := public.notif_nombre(NEW.actor_id);
      v_part := public.notif_participantes_tarea_equipo(NEW.tarea_id);

      IF NEW.tipo = 'creada' THEN
        SELECT nombre INTO v_per FROM periodos_evaluacion WHERE id = t.periodo_id;
        PERFORM notif_emitir('tarea_colectiva_asignada', v_part,
          jsonb_build_object('tarea', t.titulo, 'periodo', v_per, 'equipo', v_eq, 'asignador', public.notif_nombre(COALESCE(t.asignada_por, NEW.actor_id)),
                             'fecha_limite', notif_fecha(t.fecha_limite), 'prioridad', t.prioridad, 'responsable', public.notif_nombre(t.responsable_id)),
          'tarea_equipo', NEW.tarea_id::text, v_ev, NEW.actor_id);

      ELSIF NEW.tipo IN ('responsable', 'instrucciones', 'prorroga', 'contenido') THEN
        v_cambio := CASE NEW.tipo WHEN 'responsable' THEN 'Responsable' WHEN 'instrucciones' THEN 'Instrucciones'
                                  WHEN 'prorroga' THEN 'Fecha límite' ELSE 'Contenido' END;
        IF NEW.tipo = 'responsable' AND NEW.persona_id IS NOT NULL THEN v_part := v_part || NEW.persona_id; END IF;
        PERFORM notif_emitir('tarea_cambio', v_part,
          jsonb_build_object('tarea', t.titulo, 'equipo', v_eq, 'cambio', v_cambio, 'cambiado_por', v_actor,
            'antes', CASE NEW.tipo WHEN 'prorroga' THEN notif_fecha(NULLIF(NEW.de, '')::date) END,
            'ahora', CASE NEW.tipo WHEN 'prorroga' THEN notif_fecha(NULLIF(NEW.a, '')::date)
                                   WHEN 'responsable' THEN public.notif_nombre(NEW.persona_id)
                                   WHEN 'instrucciones' THEN 'Se actualizaron las instrucciones'
                                   ELSE NEW.motivo END,
            'motivo', CASE WHEN NEW.tipo = 'prorroga' THEN NEW.motivo END),
          'tarea_equipo', NEW.tarea_id::text, v_ev, NEW.actor_id);

      ELSIF NEW.tipo = 'estado' THEN
        IF NEW.a = 'entregada' AND COALESCE(NEW.de, '') <> 'aprobada' THEN
          v_zona := public.zona_periodo(t.periodo_id);
          PERFORM notif_emitir('entrega_registrada', public.notif_revisores_tarea_equipo(NEW.tarea_id),
            jsonb_build_object('tarea', t.titulo, 'equipo', v_eq, 'persona', COALESCE(v_actor, v_eq),
                               'entregada', notif_fecha((t.entregada_en AT TIME ZONE v_zona)::DATE),
                               'a_tiempo', CASE WHEN t.fecha_limite IS NULL THEN 'Sin plazo'
                                                WHEN (t.entregada_en AT TIME ZONE v_zona)::DATE <= t.fecha_limite THEN 'Sí' ELSE 'No' END),
            'tarea_equipo', NEW.tarea_id::text, 'ronda' || t.rondas_revision, NEW.actor_id);
        ELSIF NEW.a = 'devuelta' THEN
          v_nota := COALESCE(NULLIF(btrim(NEW.motivo), ''), t.revision_nota);
          PERFORM notif_emitir('correccion_solicitada', v_part,
            jsonb_build_object('tarea', t.titulo, 'equipo', v_eq, 'revisor', v_actor, 'observacion', v_nota, 'fecha_limite', notif_fecha(t.fecha_limite)),
            'tarea_equipo', NEW.tarea_id::text, 'ronda' || t.rondas_revision, NEW.actor_id);
        ELSIF NEW.a = 'bloqueada' THEN
          PERFORM notif_emitir('tarea_bloqueada', public.notif_revisores_tarea_equipo(NEW.tarea_id),
            jsonb_build_object('tarea', t.titulo, 'equipo', v_eq, 'persona', COALESCE(v_actor, v_eq), 'motivo', COALESCE(NEW.motivo, t.bloqueo_motivo)),
            'tarea_equipo', NEW.tarea_id::text, v_ev, NEW.actor_id);
        ELSIF NEW.a = 'anulada' OR NEW.de = 'aprobada' THEN
          -- La aprobación avisa como calificación; aquí solo lo que cambia el estado de forma importante.
          PERFORM notif_emitir('estado_cambiado', v_part,
            jsonb_build_object('objeto', 'Tarea de equipo', 'elemento', t.titulo, 'equipo', v_eq, 'antes', NEW.de, 'ahora', NEW.a, 'cambiado_por', v_actor),
            'tarea_equipo', NEW.tarea_id::text, v_ev, NEW.actor_id);
        END IF;

      ELSIF NEW.tipo = 'aporte' AND NEW.a = 'comentario' THEN
        -- Un comentario de un integrante lo ve también quien revisa; uno de quien revisa, el grupo. Sin el texto.
        PERFORM notif_emitir('observacion_nueva',
          v_part || CASE WHEN NEW.actor_id = ANY (v_part) THEN public.notif_revisores_tarea_equipo(NEW.tarea_id) ELSE '{}'::uuid[] END,
          jsonb_build_object('actividad', t.titulo, 'equipo', v_eq, 'autor', v_actor),
          'tarea_equipo', NEW.tarea_id::text, v_ev, NEW.actor_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN NULL;
  END;
  $b$ $f$;

  -- ── 3. Calificaciones ──────────────────────────────────────────────
  EXECUTE $f$
  CREATE OR REPLACE FUNCTION public.notif_trg_calificacion() RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $b$
  DECLARE v_tipo TEXT; v_aud UUID[]; v_tit TEXT; v_eq TEXT; v_per TEXT;
  BEGIN
    BEGIN
      -- Una tarea individual aprobada ya avisa con tarea_aprobada (0040): no se duplica.
      IF NEW.tarea_tipo = 'individual' AND NEW.accion = 'calificada' THEN RETURN NULL; END IF;
      v_tipo := CASE WHEN NEW.accion = 'calificada' THEN 'calificacion_nueva' ELSE 'calificacion_cambiada' END;
      SELECT nombre INTO v_per FROM periodos_evaluacion WHERE id = NEW.periodo_id;
      IF NEW.tarea_tipo = 'individual' THEN
        SELECT titulo INTO v_tit FROM tareas WHERE id = NEW.tarea_id;
        v_aud := ARRAY[NEW.persona_id];
      ELSE
        SELECT t.titulo, e.nombre INTO v_tit, v_eq FROM tareas_equipo t JOIN equipos e ON e.id = t.equipo_id WHERE t.id = NEW.tarea_id;
        v_aud := CASE WHEN NEW.persona_id IS NOT NULL THEN ARRAY[NEW.persona_id]
                      ELSE public.notif_participantes_tarea_equipo(NEW.tarea_id) END;
      END IF;
      PERFORM notif_emitir(v_tipo, v_aud,
        jsonb_build_object('periodo', v_per, 'actividad', v_tit, 'equipo', v_eq, 'evaluador', public.notif_nombre(NEW.actor_id)),
        CASE NEW.tarea_tipo WHEN 'equipo' THEN 'tarea_equipo' ELSE 'tarea' END, NEW.tarea_id::text, 'h' || NEW.id, NEW.actor_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN NULL;
  END;
  $b$ $f$;

  -- ── 4. Recordatorios por fecha de las tareas de equipo (diario) ────
  EXECUTE $f$
  CREATE OR REPLACE FUNCTION public.notif_recordatorios_equipos() RETURNS INTEGER
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $b$
  DECLARE r RECORD; v_hoy DATE; v_n INT := 0; v_aud UUID[];
  BEGIN
    FOR r IN SELECT t.id, t.titulo, t.fecha_limite, t.estado, t.periodo_id, t.responsable_id, e.nombre AS equipo
               FROM tareas_equipo t JOIN equipos e ON e.id = t.equipo_id
               JOIN periodos_evaluacion pe ON pe.id = t.periodo_id JOIN gestiones g ON g.id = pe.gestion_id
              WHERE t.fecha_limite IS NOT NULL AND t.entregada_en IS NULL AND t.estado IN ('asignada','en_curso','devuelta') AND NOT g.archivada
    LOOP
      v_hoy := (NOW() AT TIME ZONE public.zona_periodo(r.periodo_id))::DATE;
      v_aud := public.notif_participantes_tarea_equipo(r.id);
      IF r.fecha_limite IN (v_hoy, v_hoy + 1) THEN
        v_n := v_n + notif_emitir('tarea_por_vencer', v_aud,
          jsonb_build_object('tarea', r.titulo, 'equipo', r.equipo, 'cuando', CASE WHEN r.fecha_limite = v_hoy THEN 'hoy' ELSE 'mañana' END,
                             'fecha_limite', notif_fecha(r.fecha_limite), 'estado', CASE r.estado WHEN 'en_curso' THEN 'En curso' WHEN 'devuelta' THEN 'Devuelta' ELSE 'Asignada' END),
          'tarea_equipo', r.id::text, r.fecha_limite || ':' || CASE WHEN r.fecha_limite = v_hoy THEN 'hoy' ELSE 'manana' END, NULL);
      ELSIF r.estado IN ('asignada','en_curso') AND r.fecha_limite IN (v_hoy - 1, v_hoy - 3) THEN
        v_n := v_n + notif_emitir('tarea_vencida', CASE WHEN r.responsable_id IS NOT NULL THEN v_aud || r.responsable_id ELSE v_aud END,
          jsonb_build_object('tarea', r.titulo, 'equipo', r.equipo, 'fecha_limite', notif_fecha(r.fecha_limite), 'dias', v_hoy - r.fecha_limite),
          'tarea_equipo', r.id::text, r.fecha_limite || ':d' || (v_hoy - r.fecha_limite), NULL);
      END IF;
    END LOOP;
    RETURN v_n;
  END;
  $b$ $f$;

  REVOKE EXECUTE ON FUNCTION public.notif_nombre(UUID), public.notif_participantes_tarea_equipo(BIGINT), public.notif_revisores_tarea_equipo(BIGINT),
    public.notif_trg_equipo_evento(), public.notif_trg_tarea_equipo_evento(), public.notif_trg_calificacion(),
    public.notif_recordatorios_equipos() FROM PUBLIC, anon, authenticated;

  DROP TRIGGER IF EXISTS zz_notif_equipo_evento ON public.equipo_eventos;
  CREATE TRIGGER zz_notif_equipo_evento AFTER INSERT ON public.equipo_eventos FOR EACH ROW EXECUTE FUNCTION public.notif_trg_equipo_evento();
  DROP TRIGGER IF EXISTS zz_notif_tarea_equipo_evento ON public.tarea_equipo_eventos;
  CREATE TRIGGER zz_notif_tarea_equipo_evento AFTER INSERT ON public.tarea_equipo_eventos FOR EACH ROW EXECUTE FUNCTION public.notif_trg_tarea_equipo_evento();
  DROP TRIGGER IF EXISTS zz_notif_calificacion ON public.calificaciones_historial;
  CREATE TRIGGER zz_notif_calificacion AFTER INSERT ON public.calificaciones_historial FOR EACH ROW EXECUTE FUNCTION public.notif_trg_calificacion();

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('notif_recordatorios_equipos', '5 11 * * *', 'SELECT public.notif_recordatorios_equipos()');
  END IF;
END
$m41$;

-- Deshacer (comentado):
--   DROP TRIGGER zz_notif_equipo_evento ON equipo_eventos; DROP TRIGGER zz_notif_tarea_equipo_evento ON tarea_equipo_eventos;
--   DROP TRIGGER zz_notif_calificacion ON calificaciones_historial; SELECT cron.unschedule('notif_recordatorios_equipos');
