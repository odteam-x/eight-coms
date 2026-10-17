-- ══════════════════════════════════════════════════════════════════════
--  0019 — Avisos por correo: cola, disparadores y recordatorios diarios
-- ══════════════════════════════════════════════════════════════════════
--
--  CÓMO FUNCIONA
--    1. Un evento (nota publicada, tarea asignada, entrega, vencimiento…) escribe una fila en
--       `notificaciones`. Los disparadores nunca fallan: si encolar da error, la operación de
--       negocio sigue (un aviso perdido es mejor que una evaluación que no se guarda).
--    2. pg_cron llama cada 5 minutos a la Edge Function «enviar-notificaciones», solo si hay
--       avisos pendientes. La función reclama un lote (notif_reclamar), envía por Gmail SMTP y
--       marca cada fila (notif_marcar). Un fallo se reintenta hasta 5 veces.
--    3. Cada día a las 11:00 UTC (≈ 08:00 en Chile) notif_generar_recordatorios() encola los
--       avisos por fecha: tarea por vencer (mañana y hoy), vencida (1 y 3 días), actividad de
--       mañana y evaluaciones sin publicar 3 días antes de la entrega.
--
--  SIN DUPLICADOS: `dedupe_key` es única; cada aviso lleva una clave que lo identifica.
--  PRIVACIDAD: el correo no lleva notas ni puntajes, solo avisa y enlaza.
--  SEGURIDAD: la tabla no tiene políticas ni permisos para anon/authenticated; solo la tocan las
--  funciones SECURITY DEFINER y la Edge Function (service_role). Las funciones nuevas se revocan a
--  PUBLIC (0010).
--
--  Después de aplicar: desplegar la función y guardar los secretos GMAIL_USER, GMAIL_APP_PASSWORD
--  (docs/configurar-correos.md). Sin secretos los avisos esperan en la cola.
--  Aplicación manual en el SQL Editor, tras 0018. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- ── 1. Cola ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notificaciones (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  destinatario_id UUID   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo            TEXT   NOT NULL CHECK (tipo IN (
                    'nota_publicada','nota_corregida','tarea_asignada','tarea_por_vencer','tarea_vencida',
                    'tarea_devuelta','tarea_aprobada','plazo_movido','entrega_por_revisar','tarea_bloqueada',
                    'solicitud_acceso','acceso_aprobado','actividad_nueva','actividad_recordatorio',
                    'evaluaciones_sin_publicar')),
  datos           JSONB  NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key      TEXT   UNIQUE,
  enviar_despues  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  intentos        INT    NOT NULL DEFAULT 0,
  enviada_en      TIMESTAMPTZ,
  ultimo_error    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notificaciones_pendientes_idx
  ON public.notificaciones (enviar_despues) WHERE enviada_en IS NULL;

ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notificaciones FROM anon, authenticated;

-- ── 2. Utilidades ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notif_fecha(d DATE) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(to_char(d, 'DD/MM/YYYY'), 'Sin fecha') $$;

CREATE OR REPLACE FUNCTION public.notif_zona() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT c.valor FROM config c JOIN gestiones g ON g.id = c.gestion_id
      WHERE g.activa AND c.clave = 'zona_horaria'
        AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = c.valor) LIMIT 1),
    'America/Santiago');
$$;

CREATE OR REPLACE FUNCTION public.notif_encolar(
  p_dest UUID, p_tipo TEXT, p_datos JSONB, p_dedupe TEXT DEFAULT NULL, p_despues TIMESTAMPTZ DEFAULT NOW()
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_dest IS NULL THEN RETURN; END IF;
  -- Solo a personas con correo y no rechazadas; el aviso de acceso aprobado ya ocurre con aprobado = true.
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_dest AND COALESCE(email, '') <> '' AND aprobado IS NOT FALSE)
     AND p_tipo <> 'solicitud_acceso' THEN
    RETURN;
  END IF;
  INSERT INTO notificaciones (destinatario_id, tipo, datos, dedupe_key, enviar_despues)
  VALUES (p_dest, p_tipo, COALESCE(p_datos, '{}'::jsonb), p_dedupe, p_despues)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;

-- Quién revisa a una persona: los administradores y la secretaría de su distrito (nunca ella misma).
CREATE OR REPLACE FUNCTION public.notif_revisores(p_persona UUID) RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT a.id FROM profiles a
   WHERE COALESCE(a.es_admin, false) AND a.id <> p_persona AND a.aprobado IS NOT FALSE
  UNION
  SELECT s.id FROM profiles s JOIN profiles p ON p.id = p_persona
   WHERE s.tipo_miembro = 'secretario' AND NOT COALESCE(s.es_admin, false)
     AND p.distrito IS NOT NULL AND s.distrito = p.distrito
     AND s.id <> p_persona AND s.aprobado IS NOT FALSE;
$$;

-- Destinatarios de una actividad: todo el equipo, o solo un distrito.
CREATE OR REPLACE FUNCTION public.notif_audiencia(p_distrito TEXT, p_excluir UUID DEFAULT NULL) RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT id FROM profiles
   WHERE aprobado IS NOT FALSE AND COALESCE(email, '') <> ''
     AND (p_distrito IS NULL OR distrito = p_distrito)
     AND id IS DISTINCT FROM p_excluir;
$$;

-- ── 3. Disparadores ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notif_trg_evaluacion() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_per TEXT; v_hora TEXT := to_char(NOW(), 'YYYYMMDDHH24');
BEGIN
  BEGIN
    SELECT nombre INTO v_per FROM periodos_evaluacion WHERE id = NEW.periodo_id;
    IF NEW.estado = 'publicado' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'publicado') THEN
      PERFORM notif_encolar(NEW.evaluado_id, 'nota_publicada', jsonb_build_object('periodo', v_per),
                            'nota_publicada:' || NEW.id || ':' || v_hora);
    ELSIF TG_OP = 'UPDATE' AND OLD.estado = 'publicado' AND NEW.estado = 'publicado'
          AND (NEW.puntajes IS DISTINCT FROM OLD.puntajes OR NEW.bono_ext IS DISTINCT FROM OLD.bono_ext
               OR NEW.comentarios IS DISTINCT FROM OLD.comentarios) THEN
      -- 15 minutos de margen: varias correcciones seguidas se avisan una sola vez.
      PERFORM notif_encolar(NEW.evaluado_id, 'nota_corregida', jsonb_build_object('periodo', v_per),
                            'nota_corregida:' || NEW.id || ':' || v_hora, NOW() + INTERVAL '15 minutes');
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notif_trg_tarea() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_per TEXT; v_nom TEXT; v_otro TEXT; v_rev UUID; v_zona TEXT;
BEGIN
  BEGIN
    SELECT nombre INTO v_per FROM periodos_evaluacion WHERE id = NEW.periodo_id;
    SELECT nombre INTO v_nom FROM profiles WHERE id = NEW.asignada_a;

    IF TG_OP = 'INSERT' THEN
      IF NEW.origen = 'asignada' THEN
        SELECT nombre INTO v_otro FROM profiles WHERE id = NEW.asignada_por;
        PERFORM notif_encolar(NEW.asignada_a, 'tarea_asignada', jsonb_build_object(
          'tarea', NEW.titulo, 'periodo', v_per, 'asignador', COALESCE(v_otro, 'La administración'),
          'fecha_limite', notif_fecha(NEW.fecha_limite), 'prioridad', NEW.prioridad),
          'tarea_asignada:' || NEW.id);
      END IF;
      RETURN NULL;
    END IF;

    IF NEW.estado IS DISTINCT FROM OLD.estado THEN
      SELECT nombre INTO v_otro FROM profiles WHERE id = auth.uid();
      IF NEW.estado = 'entregada' THEN
        v_zona := public.zona_periodo(NEW.periodo_id);
        FOR v_rev IN SELECT notif_revisores(NEW.asignada_a) LOOP
          PERFORM notif_encolar(v_rev, 'entrega_por_revisar', jsonb_build_object(
            'tarea', NEW.titulo, 'persona', v_nom,
            'entregada', notif_fecha((NEW.entregada_en AT TIME ZONE v_zona)::DATE),
            'a_tiempo', CASE WHEN NEW.fecha_limite IS NULL THEN 'Sin plazo'
                             WHEN (NEW.entregada_en AT TIME ZONE v_zona)::DATE <= NEW.fecha_limite THEN 'Sí' ELSE 'No' END),
            'entrega_por_revisar:' || NEW.id || ':' || NEW.rondas_revision || ':' || v_rev);
        END LOOP;
      ELSIF NEW.estado = 'devuelta' THEN
        PERFORM notif_encolar(NEW.asignada_a, 'tarea_devuelta', jsonb_build_object(
          'tarea', NEW.titulo, 'revisor', COALESCE(v_otro, 'Quien revisa'), 'observacion', NEW.revision_nota,
          'fecha_limite', notif_fecha(NEW.fecha_limite)),
          'tarea_devuelta:' || NEW.id || ':' || NEW.rondas_revision);
      ELSIF NEW.estado = 'aprobada' THEN
        PERFORM notif_encolar(NEW.asignada_a, 'tarea_aprobada', jsonb_build_object(
          'tarea', NEW.titulo, 'revisor', COALESCE(v_otro, 'Quien revisa'), 'puntos', NEW.puntos),
          'tarea_aprobada:' || NEW.id || ':' || COALESCE(extract(epoch FROM NEW.aprobada_en)::BIGINT, 0));
      ELSIF NEW.estado = 'bloqueada' THEN
        FOR v_rev IN SELECT notif_revisores(NEW.asignada_a) LOOP
          PERFORM notif_encolar(v_rev, 'tarea_bloqueada', jsonb_build_object(
            'tarea', NEW.titulo, 'persona', v_nom, 'motivo', NEW.bloqueo_motivo),
            'tarea_bloqueada:' || NEW.id || ':' || extract(epoch FROM NOW())::BIGINT || ':' || v_rev);
        END LOOP;
      END IF;
    END IF;

    IF NEW.fecha_limite IS DISTINCT FROM OLD.fecha_limite AND NEW.origen = 'asignada' THEN
      PERFORM notif_encolar(NEW.asignada_a, 'plazo_movido', jsonb_build_object(
        'tarea', NEW.titulo, 'fecha_anterior', notif_fecha(OLD.fecha_limite), 'fecha_nueva', notif_fecha(NEW.fecha_limite),
        'motivo', current_setting('eight.tarea_motivo', true)),
        'plazo_movido:' || NEW.id || ':' || extract(epoch FROM NOW())::BIGINT);
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notif_trg_profile() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_adm UUID;
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' AND NEW.aprobado IS FALSE THEN
      FOR v_adm IN SELECT id FROM profiles WHERE COALESCE(es_admin, false) AND aprobado IS NOT FALSE LOOP
        PERFORM notif_encolar(v_adm, 'solicitud_acceso',
          jsonb_build_object('persona', COALESCE(NULLIF(NEW.nombre, ''), 'Alguien'), 'correo', NEW.email),
          'solicitud_acceso:' || NEW.id || ':' || v_adm);
      END LOOP;
    ELSIF TG_OP = 'UPDATE' AND OLD.aprobado IS FALSE AND NEW.aprobado IS TRUE THEN
      PERFORM notif_encolar(NEW.id, 'acceso_aprobado', '{}'::jsonb, 'acceso_aprobado:' || NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notif_trg_actividad() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_etq TEXT; v_pid UUID; v_fecha TEXT;
BEGIN
  BEGIN
    SELECT nombre INTO v_etq FROM etiquetas WHERE id = NEW.etiqueta_id;
    v_fecha := CASE WHEN NEW.fecha_fin IS NULL OR NEW.fecha_fin = NEW.fecha_inicio
                    THEN notif_fecha(NEW.fecha_inicio)
                    ELSE notif_fecha(NEW.fecha_inicio) || ' al ' || notif_fecha(NEW.fecha_fin) END;
    FOR v_pid IN SELECT notif_audiencia(NEW.distrito, NEW.creada_por) LOOP
      PERFORM notif_encolar(v_pid, 'actividad_nueva',
        jsonb_build_object('actividad', NEW.titulo, 'fecha', v_fecha, 'etiqueta', COALESCE(v_etq, 'Actividad')),
        'actividad_nueva:' || NEW.id || ':' || v_pid);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notif_trg_evaluacion(), public.notif_trg_tarea(),
  public.notif_trg_profile(), public.notif_trg_actividad() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notif_encolar(UUID, TEXT, JSONB, TEXT, TIMESTAMPTZ),
  public.notif_revisores(UUID), public.notif_audiencia(TEXT, UUID), public.notif_zona() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notif_evaluacion ON public.evaluaciones;
CREATE TRIGGER notif_evaluacion AFTER INSERT OR UPDATE ON public.evaluaciones
  FOR EACH ROW EXECUTE FUNCTION public.notif_trg_evaluacion();

DROP TRIGGER IF EXISTS notif_tarea ON public.tareas;
CREATE TRIGGER notif_tarea AFTER INSERT OR UPDATE ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION public.notif_trg_tarea();

DROP TRIGGER IF EXISTS notif_profile ON public.profiles;
CREATE TRIGGER notif_profile AFTER INSERT OR UPDATE OF aprobado ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.notif_trg_profile();

DROP TRIGGER IF EXISTS notif_actividad ON public.actividades;
CREATE TRIGGER notif_actividad AFTER INSERT ON public.actividades
  FOR EACH ROW EXECUTE FUNCTION public.notif_trg_actividad();

-- ── 4. Recordatorios por fecha (los llama pg_cron cada día) ───────────
CREATE OR REPLACE FUNCTION public.notif_generar_recordatorios() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_hoy DATE := (NOW() AT TIME ZONE public.notif_zona())::DATE;
  r RECORD; v_pid UUID; v_adm UUID; v_fecha TEXT; v_total INT; v_pub INT; v_bor INT;
BEGIN
  -- Tareas por vencer (hoy y mañana): nunca entregadas, no bloqueadas.
  FOR r IN
    SELECT t.id, t.asignada_a, t.titulo, t.fecha_limite, t.estado
      FROM tareas t JOIN periodos_evaluacion pe ON pe.id = t.periodo_id JOIN gestiones g ON g.id = pe.gestion_id
     WHERE t.entregada_en IS NULL AND t.estado IN ('asignada','en_curso')
       AND t.fecha_limite IN (v_hoy, v_hoy + 1) AND NOT g.archivada
       AND NOT EXISTS (SELECT 1 FROM periodo_participantes pp
                        WHERE pp.periodo_id = t.periodo_id AND pp.user_id = t.asignada_a AND NOT pp.activo)
  LOOP
    PERFORM notif_encolar(r.asignada_a, 'tarea_por_vencer', jsonb_build_object(
      'tarea', r.titulo, 'cuando', CASE WHEN r.fecha_limite = v_hoy THEN 'hoy' ELSE 'mañana' END,
      'fecha_limite', notif_fecha(r.fecha_limite), 'estado', CASE r.estado WHEN 'en_curso' THEN 'En curso' ELSE 'Asignada' END),
      'tarea_por_vencer:' || r.id || ':' || r.fecha_limite);
  END LOOP;

  -- Tareas vencidas: aviso al día siguiente y a los 3 días.
  FOR r IN
    SELECT t.id, t.asignada_a, t.titulo, t.fecha_limite, (v_hoy - t.fecha_limite) AS dias
      FROM tareas t JOIN periodos_evaluacion pe ON pe.id = t.periodo_id JOIN gestiones g ON g.id = pe.gestion_id
     WHERE t.entregada_en IS NULL AND t.estado IN ('asignada','en_curso')
       AND t.fecha_limite IN (v_hoy - 1, v_hoy - 3) AND NOT g.archivada
       AND NOT EXISTS (SELECT 1 FROM periodo_participantes pp
                        WHERE pp.periodo_id = t.periodo_id AND pp.user_id = t.asignada_a AND NOT pp.activo)
  LOOP
    PERFORM notif_encolar(r.asignada_a, 'tarea_vencida', jsonb_build_object(
      'tarea', r.titulo, 'fecha_limite', notif_fecha(r.fecha_limite), 'dias', r.dias),
      'tarea_vencida:' || r.id || ':' || r.dias);
  END LOOP;

  -- Actividades de mañana.
  FOR r IN SELECT a.id, a.titulo, a.distrito, a.fecha_inicio, a.fecha_fin, e.nombre AS etiqueta
             FROM actividades a JOIN gestiones g ON g.id = a.gestion_id LEFT JOIN etiquetas e ON e.id = a.etiqueta_id
            WHERE a.fecha_inicio = v_hoy + 1 AND NOT g.archivada
  LOOP
    v_fecha := CASE WHEN r.fecha_fin IS NULL OR r.fecha_fin = r.fecha_inicio THEN notif_fecha(r.fecha_inicio)
                    ELSE notif_fecha(r.fecha_inicio) || ' al ' || notif_fecha(r.fecha_fin) END;
    FOR v_pid IN SELECT notif_audiencia(r.distrito) LOOP
      PERFORM notif_encolar(v_pid, 'actividad_recordatorio',
        jsonb_build_object('actividad', r.titulo, 'fecha', v_fecha, 'etiqueta', COALESCE(r.etiqueta, 'Actividad')),
        'actividad_recordatorio:' || r.id || ':' || v_pid);
    END LOOP;
  END LOOP;

  -- Evaluaciones sin publicar, 3 días antes de la fecha de entrega del período activo.
  FOR r IN SELECT pe.id, pe.nombre, pe.fecha_entrega FROM periodos_evaluacion pe JOIN gestiones g ON g.id = pe.gestion_id
            WHERE pe.activo AND g.activa AND pe.fecha_entrega = v_hoy + 3
  LOOP
    SELECT COUNT(*) INTO v_total FROM profiles p
     WHERE p.aprobado IS NOT FALSE AND NOT COALESCE(p.es_admin, false)
       AND NOT EXISTS (SELECT 1 FROM periodo_participantes pp WHERE pp.periodo_id = r.id AND pp.user_id = p.id AND NOT pp.activo);
    SELECT COUNT(*) FILTER (WHERE e.estado = 'publicado'), COUNT(*) FILTER (WHERE e.estado <> 'publicado')
      INTO v_pub, v_bor FROM evaluaciones e WHERE e.periodo_id = r.id;
    IF v_total - v_pub > 0 THEN
      FOR v_adm IN SELECT id FROM profiles WHERE COALESCE(es_admin, false) AND aprobado IS NOT FALSE LOOP
        PERFORM notif_encolar(v_adm, 'evaluaciones_sin_publicar', jsonb_build_object(
          'periodo', r.nombre, 'cierre', notif_fecha(r.fecha_entrega), 'pendientes', v_total - v_pub,
          'sin_evaluar', GREATEST(v_total - v_pub - v_bor, 0), 'borradores', v_bor),
          'evaluaciones_sin_publicar:' || r.id || ':' || v_adm);
      END LOOP;
    END IF;
  END LOOP;

  -- Limpieza: avisos enviados hace más de 90 días.
  DELETE FROM notificaciones WHERE created_at < NOW() - INTERVAL '90 days';
  RETURN 1;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notif_generar_recordatorios() FROM PUBLIC, anon, authenticated;

-- ── 5. Envío: reclamar un lote y marcarlo (solo service_role) ─────────
CREATE OR REPLACE FUNCTION public.notif_reclamar(p_max INT DEFAULT 25)
RETURNS TABLE (id BIGINT, tipo TEXT, datos JSONB, email TEXT, nombre TEXT, es_admin BOOLEAN, tipo_miembro TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH tomadas AS (
    SELECT n.id FROM notificaciones n
     WHERE n.enviada_en IS NULL AND n.intentos < 5 AND n.enviar_despues <= NOW()
     ORDER BY n.id LIMIT p_max FOR UPDATE SKIP LOCKED
  ), act AS (
    -- Arrendamiento de 10 minutos: si la función muere a medias, el aviso se reintenta después.
    UPDATE notificaciones n SET intentos = n.intentos + 1, enviar_despues = NOW() + INTERVAL '10 minutes'
      FROM tomadas t WHERE n.id = t.id
    RETURNING n.id, n.tipo, n.datos, n.destinatario_id
  )
  SELECT a.id, a.tipo, a.datos, p.email, p.nombre, COALESCE(p.es_admin, false), COALESCE(p.tipo_miembro, 'miembro')
    FROM act a JOIN profiles p ON p.id = a.destinatario_id;
$$;

CREATE OR REPLACE FUNCTION public.notif_marcar(p_id BIGINT, p_error TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE notificaciones SET
    enviada_en     = CASE WHEN p_error IS NULL THEN NOW() END,
    ultimo_error   = p_error,
    enviar_despues = CASE WHEN p_error IS NULL THEN enviar_despues ELSE NOW() + INTERVAL '15 minutes' END
  WHERE id = p_id;
$$;
REVOKE EXECUTE ON FUNCTION public.notif_reclamar(INT), public.notif_marcar(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.notif_reclamar(INT), public.notif_marcar(BIGINT, TEXT) TO service_role;

-- ── 6. Programación ───────────────────────────────────────────────────
-- La clave anon es pública (va en el sitio); sirve para pasar la verificación de JWT de la función,
-- que además no recibe datos: solo vacía la cola.
SELECT cron.schedule('notif_enviar', '*/5 * * * *', $job$
  SELECT net.http_post(
    url     := 'https://owfmorjlymoxqrzhadnf.supabase.co/functions/v1/enviar-notificaciones',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93Zm1vcmpseW1veHFyemhhZG5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNzA2MzIsImV4cCI6MjA5NzY0NjYzMn0.T6j0MwRW2ast2Szl7AhW0LJRIvX7sNbOYvJ7JSUvHU'),
    body    := '{}'::jsonb)
  WHERE EXISTS (SELECT 1 FROM public.notificaciones
                 WHERE enviada_en IS NULL AND intentos < 5 AND enviar_despues <= NOW())
$job$);

SELECT cron.schedule('notif_recordatorios', '0 11 * * *', 'SELECT public.notif_generar_recordatorios()');

-- ── Deshacer ──────────────────────────────────────────────────────────
-- SELECT cron.unschedule('notif_enviar'); SELECT cron.unschedule('notif_recordatorios');
-- DROP TRIGGER notif_evaluacion ON evaluaciones; DROP TRIGGER notif_tarea ON tareas;
-- DROP TRIGGER notif_profile ON profiles; DROP TRIGGER notif_actividad ON actividades;
-- DROP TABLE notificaciones;  (y las funciones notif_*)
