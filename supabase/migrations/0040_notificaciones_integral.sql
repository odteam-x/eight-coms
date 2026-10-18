-- ══════════════════════════════════════════════════════════════════════
--  0040 — Notificaciones integrales: catálogo, preferencias, estado de envío y trazabilidad
-- ══════════════════════════════════════════════════════════════════════
--
--  QUÉ CAMBIA RESPECTO A 0019 / 0022
--    1. CATÁLOGO CENTRAL (`notif_tipos`): un tipo de evento = una fila (categoría, esencial u opcional,
--       quién puede recibirlo, qué datos puede llevar, a qué pantalla lleva según el rol). Reemplaza el
--       CHECK de 0019, que obligaba a un ALTER por cada tipo nuevo.
--    2. CAMPANA Y CORREO SON CANALES DISTINTOS. Antes, quien no tenía correo no recibía tampoco el
--       aviso de la campana. Ahora el aviso se crea siempre; el correo se decide al enviar:
--         · `sin_correo`  → la persona no tiene dirección.
--         · `preferencia` → el aviso es OPCIONAL y la persona desactivó su correo.
--       Los avisos ESENCIALES no se pueden desactivar.
--    3. ESTADO DE ENVÍO (`correo_estado`): pendiente → enviado | omitido | simulado | fallido, con motivo.
--       `simulado` = se ejecutó en modo de prueba y NO salió ningún correo real.
--    4. REINTENTOS con espera creciente (5, 15, 60 y 180 min) y tope de 5; un error permanente
--       (dirección rechazada) no se reintenta. Marcar dos veces el mismo aviso no hace nada la segunda.
--    5. TRAZABILIDAD (`notificaciones_eventos`): cada creación, rechazo, intento y resultado queda
--       registrado (solo lo lee el servidor). `notif_estado_envios()` lo resume para la administración.
--    6. PREFERENCIAS (`notif_preferencias`) por persona y tipo, solo a través de funciones.
--    7. `notif_emitir()`: UNA llamada para emitir un evento a varias personas, sin duplicados, sin avisar
--       al propio autor, con la audiencia validada. Contrato en docs/notificaciones-contrato.md.
--    8. Tipos acordados con la sesión de equipos y calificaciones (renombres con los avisos históricos
--       migrados): nota_publicada→calificacion_nueva, nota_corregida→calificacion_cambiada,
--       tarea_devuelta→correccion_solicitada, plazo_movido→tarea_cambio, entrega_por_revisar→entrega_registrada.
--       Nuevos: equipo_incorporado, equipo_retiro, tarea_colectiva_asignada, observacion_nueva, estado_cambiado.
--    9. Corrige el recordatorio «por vencer»: su clave no distinguía «mañana» de «hoy», así que el de hoy
--       nunca se enviaba.
--
--  SEGURIDAD
--    · Las tablas nuevas no dan permisos a anon/authenticated; solo se accede por funciones SECURITY DEFINER
--      que filtran por auth.uid() (guardia con el sentido correcto, ver 0008) y están revocadas a PUBLIC (0010).
--    · Lo que se guarda en `datos` pasa por la lista blanca del tipo (`claves`): una clave no prevista
--      se descarta y los textos se recortan a 500 caracteres. Nunca puntajes ni notas.
--    · Una destinataria inexistente, sin acceso aprobado, o de un rol que el tipo no admite, se rechaza
--      y queda en el registro.
--
--  Aplicación manual en el SQL Editor, tras 0026 (y 0019/0022). Idempotente. Nada se borra.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Catálogo ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notif_tipos (
  tipo          TEXT PRIMARY KEY,
  categoria     TEXT NOT NULL CHECK (categoria IN ('tareas','equipos','calificaciones','actividades','cuenta')),
  titulo        TEXT NOT NULL,          -- cómo se llama en las preferencias
  descripcion   TEXT NOT NULL,          -- cuándo ocurre
  esencial      BOOLEAN NOT NULL,       -- true = no se puede desactivar el correo
  correo_default BOOLEAN NOT NULL DEFAULT true,
  audiencia     TEXT[] NOT NULL DEFAULT ARRAY['admin','secretario','miembro'],
  claves        TEXT[] NOT NULL DEFAULT '{}',   -- lista blanca de `datos`
  requeridas    TEXT[] NOT NULL DEFAULT '{}',
  ref_tipo      TEXT,                   -- tarea | equipo | evaluacion | actividad | persona | periodo
  destino       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"admin":"tareas","secretario":"trabajos","miembro":"trabajos"}
  orden         SMALLINT NOT NULL DEFAULT 0
);
ALTER TABLE public.notif_tipos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notif_tipos FROM anon, authenticated;

INSERT INTO public.notif_tipos (tipo, categoria, titulo, descripcion, esencial, audiencia, claves, requeridas, ref_tipo, destino, orden) VALUES
 -- Tareas
 ('tarea_asignada','tareas','Tarea asignada','Te asignan una tarea.',true,
   ARRAY['admin','secretario','miembro'], ARRAY['tarea','periodo','asignador','fecha_limite','prioridad','equipo'], ARRAY['tarea'],
   'tarea','{"admin":"tareas","secretario":"trabajos","miembro":"trabajos"}',10),
 ('tarea_colectiva_asignada','tareas','Tarea colectiva asignada','A tu equipo le asignan una tarea.',true,
   ARRAY['admin','secretario','miembro'], ARRAY['tarea','periodo','equipo','asignador','fecha_limite','prioridad','responsable'], ARRAY['tarea','equipo'],
   'tarea','{"admin":"tareas","secretario":"trabajos","miembro":"trabajos"}',11),
 ('tarea_cambio','tareas','Cambios en una tarea','Cambia el responsable, las instrucciones o la fecha límite de una tarea tuya.',true,
   ARRAY['admin','secretario','miembro'], ARRAY['tarea','cambio','antes','ahora','motivo','cambiado_por','fecha_nueva','equipo'], ARRAY['tarea','cambio'],
   'tarea','{"admin":"tareas","secretario":"trabajos","miembro":"trabajos"}',12),
 ('tarea_por_vencer','tareas','Tarea por vencer','Recordatorio: una tarea tuya vence hoy o mañana.',false,
   ARRAY['admin','secretario','miembro'], ARRAY['tarea','cuando','fecha_limite','estado','equipo'], ARRAY['tarea','cuando'],
   'tarea','{"admin":"tareas","secretario":"trabajos","miembro":"trabajos"}',13),
 ('tarea_vencida','tareas','Tarea vencida','Pasó la fecha límite de una tarea tuya sin entregarla.',true,
   ARRAY['admin','secretario','miembro'], ARRAY['tarea','fecha_limite','dias','equipo'], ARRAY['tarea'],
   'tarea','{"admin":"tareas","secretario":"trabajos","miembro":"trabajos"}',14),
 ('entrega_registrada','tareas','Entrega registrada','Alguien entregó una tarea y espera tu revisión.',false,
   ARRAY['admin','secretario','miembro'], ARRAY['tarea','persona','equipo','entregada','a_tiempo'], ARRAY['tarea','persona'],
   'tarea','{"admin":"tareas","secretario":"tareas","miembro":"trabajos"}',15),
 ('correccion_solicitada','tareas','Corrección solicitada','Te devuelven una entrega con observaciones.',true,
   ARRAY['admin','secretario','miembro'], ARRAY['tarea','revisor','observacion','fecha_limite','equipo'], ARRAY['tarea','observacion'],
   'tarea','{"admin":"tareas","secretario":"trabajos","miembro":"trabajos"}',16),
 ('tarea_aprobada','tareas','Tarea aprobada','Aprueban una entrega tuya.',false,
   ARRAY['admin','secretario','miembro'], ARRAY['tarea','revisor','puntos','equipo'], ARRAY['tarea'],
   'tarea','{"admin":"tareas","secretario":"trabajos","miembro":"trabajos"}',17),
 ('tarea_bloqueada','tareas','Tarea bloqueada','Alguien marca una tarea como bloqueada.',false,
   ARRAY['admin','secretario'], ARRAY['tarea','persona','motivo','equipo'], ARRAY['tarea','persona'],
   'tarea','{"admin":"tareas","secretario":"tareas","miembro":"trabajos"}',18),
 -- Equipos
 ('equipo_incorporado','equipos','Incorporación a un equipo','Te incorporan a un equipo.',true,
   ARRAY['admin','secretario','miembro'], ARRAY['equipo','rol_equipo','agregado_por'], ARRAY['equipo'],
   'equipo','{"admin":"inicio","secretario":"inicio","miembro":"inicio"}',20),
 ('equipo_retiro','equipos','Retiro de un equipo','Te retiran de un equipo.',true,
   ARRAY['admin','secretario','miembro'], ARRAY['equipo','retirado_por','motivo'], ARRAY['equipo'],
   'equipo','{"admin":"inicio","secretario":"inicio","miembro":"inicio"}',21),
 -- Calificaciones
 ('calificacion_nueva','calificaciones','Calificación nueva','Publican una calificación o evaluación tuya.',true,
   ARRAY['admin','secretario','miembro'], ARRAY['periodo','actividad','equipo','evaluador'], '{}',
   'evaluacion','{"admin":"evaluar","secretario":"perfil","miembro":"perfil"}',30),
 ('calificacion_cambiada','calificaciones','Calificación modificada','Corrigen una calificación que ya estaba publicada.',true,
   ARRAY['admin','secretario','miembro'], ARRAY['periodo','actividad','equipo','evaluador'], '{}',
   'evaluacion','{"admin":"evaluar","secretario":"perfil","miembro":"perfil"}',31),
 ('observacion_nueva','calificaciones','Observación nueva','Recibes una observación o retroalimentación.',false,
   ARRAY['admin','secretario','miembro'], ARRAY['periodo','actividad','equipo','autor'], '{}',
   'evaluacion','{"admin":"evaluar","secretario":"perfil","miembro":"perfil"}',32),
 ('evaluaciones_sin_publicar','calificaciones','Evaluaciones sin publicar','Se acerca el cierre y faltan evaluaciones por publicar.',false,
   ARRAY['admin'], ARRAY['periodo','cierre','pendientes','sin_evaluar','borradores'], ARRAY['periodo','cierre','pendientes'],
   'periodo','{"admin":"evaluar"}',33),
 -- Actividades
 ('actividad_nueva','actividades','Actividad nueva','Agregan una actividad al calendario que te incluye.',false,
   ARRAY['admin','secretario','miembro'], ARRAY['actividad','fecha','etiqueta'], ARRAY['actividad','fecha'],
   'actividad','{"admin":"agenda","secretario":"calendario","miembro":"calendario"}',40),
 ('actividad_recordatorio','actividades','Actividad de mañana','Recordatorio de una actividad del día siguiente.',false,
   ARRAY['admin','secretario','miembro'], ARRAY['actividad','fecha','etiqueta'], ARRAY['actividad','fecha'],
   'actividad','{"admin":"agenda","secretario":"calendario","miembro":"calendario"}',41),
 ('estado_cambiado','actividades','Cambio de estado','Cambia de forma importante el estado de algo tuyo (por ejemplo, se reabre una tarea).',false,
   ARRAY['admin','secretario','miembro'], ARRAY['objeto','elemento','antes','ahora','cambiado_por','equipo'], ARRAY['elemento'],
   'tarea','{"admin":"tareas","secretario":"trabajos","miembro":"trabajos"}',42),
 -- Cuenta
 ('solicitud_acceso','cuenta','Solicitud de acceso','Alguien se registra y espera tu aprobación.',true,
   ARRAY['admin'], ARRAY['persona','correo'], ARRAY['persona'],
   'persona','{"admin":"usuarios"}',50),
 ('acceso_aprobado','cuenta','Acceso aprobado','Aprueban tu acceso al portal.',true,
   ARRAY['admin','secretario','miembro'], '{}', '{}',
   'persona','{"admin":"overview","secretario":"inicio","miembro":"inicio"}',51)
ON CONFLICT (tipo) DO UPDATE SET
  categoria = EXCLUDED.categoria, titulo = EXCLUDED.titulo, descripcion = EXCLUDED.descripcion,
  esencial = EXCLUDED.esencial, audiencia = EXCLUDED.audiencia, claves = EXCLUDED.claves,
  requeridas = EXCLUDED.requeridas, ref_tipo = EXCLUDED.ref_tipo, destino = EXCLUDED.destino,
  orden = EXCLUDED.orden;
-- (correo_default no se pisa al reaplicar: si la administración lo cambió a mano, se respeta.)

-- ── 2. La cola pasa a usar el catálogo (y se renombran los tipos) ─────
ALTER TABLE public.notificaciones DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;

UPDATE public.notificaciones n SET
  tipo = m.nuevo,
  dedupe_key = CASE WHEN n.dedupe_key LIKE m.viejo || ':%' THEN m.nuevo || substr(n.dedupe_key, length(m.viejo) + 1) ELSE n.dedupe_key END
 FROM (VALUES ('nota_publicada','calificacion_nueva'), ('nota_corregida','calificacion_cambiada'),
              ('tarea_devuelta','correccion_solicitada'), ('plazo_movido','tarea_cambio'),
              ('entrega_por_revisar','entrega_registrada')) AS m(viejo, nuevo)
WHERE n.tipo = m.viejo;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notificaciones_tipo_fk') THEN
    ALTER TABLE public.notificaciones
      ADD CONSTRAINT notificaciones_tipo_fk FOREIGN KEY (tipo) REFERENCES public.notif_tipos(tipo);
  END IF;
END $$;

ALTER TABLE public.notificaciones
  ADD COLUMN IF NOT EXISTS leida_en      TIMESTAMPTZ,      -- ya la crea 0022; aquí por si se aplica sin ella
  ADD COLUMN IF NOT EXISTS ref_tipo      TEXT,
  ADD COLUMN IF NOT EXISTS ref_id        TEXT,
  ADD COLUMN IF NOT EXISTS correo_estado TEXT NOT NULL DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS correo_motivo TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notificaciones_correo_estado_check') THEN
    ALTER TABLE public.notificaciones ADD CONSTRAINT notificaciones_correo_estado_check
      CHECK (correo_estado IN ('pendiente','enviado','omitido','simulado','fallido'));
  END IF;
END $$;

-- Lo que ya existía conserva su significado.
UPDATE public.notificaciones SET correo_estado = 'enviado' WHERE enviada_en IS NOT NULL AND correo_estado = 'pendiente';
UPDATE public.notificaciones SET correo_estado = 'fallido', correo_motivo = COALESCE(ultimo_error, 'Reintentos agotados')
 WHERE enviada_en IS NULL AND intentos >= 5 AND correo_estado = 'pendiente';
UPDATE public.notificaciones n SET
  ref_tipo = COALESCE(n.ref_tipo, t.ref_tipo),
  ref_id   = COALESCE(n.ref_id, NULLIF(split_part(COALESCE(n.dedupe_key, ''), ':', 2), ''))
  FROM public.notif_tipos t WHERE t.tipo = n.tipo AND (n.ref_tipo IS NULL OR n.ref_id IS NULL);

DROP INDEX IF EXISTS public.notificaciones_pendientes_idx;
CREATE INDEX IF NOT EXISTS notificaciones_pendientes_idx
  ON public.notificaciones (enviar_despues) WHERE correo_estado = 'pendiente';
CREATE INDEX IF NOT EXISTS notificaciones_ref_idx ON public.notificaciones (ref_tipo, ref_id);

-- ── 3. Registro de eventos (append-only) y preferencias ───────────────
CREATE TABLE IF NOT EXISTS public.notificaciones_eventos (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notificacion_id BIGINT REFERENCES public.notificaciones(id) ON DELETE CASCADE,
  evento          TEXT NOT NULL CHECK (evento IN
                    ('creado','rechazado','correo_enviado','correo_fallo','correo_omitido','correo_simulado','correo_agotado')),
  intento         INT,
  via             TEXT,
  detalle         TEXT,
  tipo            TEXT,               -- redundante a propósito: un rechazo no tiene fila de notificación
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notificaciones_eventos_notif_idx ON public.notificaciones_eventos (notificacion_id);
CREATE INDEX IF NOT EXISTS notificaciones_eventos_fecha_idx ON public.notificaciones_eventos (creado_en DESC);
ALTER TABLE public.notificaciones_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notificaciones_eventos FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.notif_preferencias (
  persona_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL REFERENCES public.notif_tipos(tipo) ON DELETE CASCADE,
  correo     BOOLEAN NOT NULL,
  actualizada TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persona_id, tipo)
);
ALTER TABLE public.notif_preferencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notif_preferencias FROM anon, authenticated;

-- ── 4. Utilidades ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notif_max_intentos() RETURNS INT
LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;

CREATE OR REPLACE FUNCTION public.notif_fecha_hora(p_ts TIMESTAMPTZ) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(to_char(p_ts AT TIME ZONE public.notif_zona(), 'DD/MM/YYYY HH24:MI'), 'Sin fecha')
$$;

-- Rol funcional de una persona: 'admin' | 'secretario' | 'miembro' (NULL si no existe o no tiene acceso).
CREATE OR REPLACE FUNCTION public.notif_rol_de(p UUID) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN COALESCE(es_admin, false) THEN 'admin'
              WHEN tipo_miembro = 'secretario' THEN 'secretario' ELSE 'miembro' END
    FROM profiles WHERE id = p AND aprobado IS NOT FALSE
$$;

-- Pantalla (pestaña) a la que lleva un tipo para un rol.
CREATE OR REPLACE FUNCTION public.notif_destino(p_tipo TEXT, p_rol TEXT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT t.destino ->> p_rol FROM notif_tipos t WHERE t.tipo = p_tipo),
                  (SELECT t.destino ->> 'miembro' FROM notif_tipos t WHERE t.tipo = p_tipo), 'inicio')
$$;

CREATE OR REPLACE FUNCTION public.notif_log(p_notif BIGINT, p_evento TEXT, p_detalle TEXT DEFAULT NULL,
                                           p_intento INT DEFAULT NULL, p_via TEXT DEFAULT NULL, p_tipo TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO notificaciones_eventos (notificacion_id, evento, intento, via, detalle, tipo)
  VALUES (p_notif, p_evento, p_intento, p_via, left(p_detalle, 500), p_tipo);
EXCEPTION WHEN OTHERS THEN NULL;   -- el registro nunca debe romper una operación
END;
$$;

-- ── 5. Encolar (validado) y emitir ────────────────────────────────────
DROP FUNCTION IF EXISTS public.notif_encolar(UUID, TEXT, JSONB, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.notif_encolar(
  p_dest UUID, p_tipo TEXT, p_datos JSONB, p_dedupe TEXT DEFAULT NULL, p_despues TIMESTAMPTZ DEFAULT NOW(),
  p_ref_tipo TEXT DEFAULT NULL, p_ref_id TEXT DEFAULT NULL
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_t   notif_tipos%ROWTYPE;
  v_rol TEXT;
  v_dat JSONB;
  v_id  BIGINT;
BEGIN
  IF p_dest IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_t FROM notif_tipos WHERE tipo = p_tipo;
  IF NOT FOUND THEN
    PERFORM notif_log(NULL, 'rechazado', 'Tipo desconocido', NULL, NULL, p_tipo);
    RETURN NULL;
  END IF;
  v_rol := notif_rol_de(p_dest);
  IF v_rol IS NULL THEN
    PERFORM notif_log(NULL, 'rechazado', 'Destinataria inexistente o sin acceso aprobado', NULL, NULL, p_tipo);
    RETURN NULL;
  END IF;
  IF NOT (v_rol = ANY (v_t.audiencia)) THEN
    PERFORM notif_log(NULL, 'rechazado', 'Un ' || v_rol || ' no puede recibir este tipo de aviso', NULL, NULL, p_tipo);
    RETURN NULL;
  END IF;

  -- Lista blanca de datos: lo que el tipo no declara no entra, y los textos se recortan.
  SELECT COALESCE(jsonb_object_agg(e.k, CASE WHEN jsonb_typeof(e.v) = 'string' THEN to_jsonb(left(e.v #>> '{}', 500)) ELSE e.v END),
                  '{}'::jsonb)
    INTO v_dat
    FROM jsonb_each(COALESCE(p_datos, '{}'::jsonb)) AS e(k, v)
   WHERE e.k = ANY (v_t.claves) AND jsonb_typeof(e.v) IN ('string', 'number', 'boolean');

  IF EXISTS (SELECT 1 FROM unnest(v_t.requeridas) r WHERE NOT (v_dat ? r) OR btrim(v_dat ->> r) = '') THEN
    PERFORM notif_log(NULL, 'rechazado', 'Faltan datos obligatorios (' || array_to_string(v_t.requeridas, ', ') || ')', NULL, NULL, p_tipo);
    RETURN NULL;
  END IF;

  INSERT INTO notificaciones (destinatario_id, tipo, datos, dedupe_key, enviar_despues, ref_tipo, ref_id)
  VALUES (p_dest, p_tipo, v_dat, p_dedupe, COALESCE(p_despues, NOW()),
          COALESCE(p_ref_tipo, v_t.ref_tipo),
          COALESCE(p_ref_id, NULLIF(split_part(COALESCE(p_dedupe, ''), ':', 2), '')))
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN PERFORM notif_log(v_id, 'creado', NULL, NULL, NULL, p_tipo); END IF;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  PERFORM notif_log(NULL, 'rechazado', SQLERRM, NULL, NULL, p_tipo);
  RETURN NULL;
END;
$$;

-- Emite un hecho a varias personas. Devuelve cuántos avisos NUEVOS se crearon.
CREATE OR REPLACE FUNCTION public.notif_emitir(
  p_tipo TEXT, p_destinatarios UUID[], p_datos JSONB, p_ref_tipo TEXT, p_ref_id TEXT, p_evento TEXT,
  p_actor UUID DEFAULT NULL, p_despues TIMESTAMPTZ DEFAULT NOW()
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d UUID; v INT := 0;
BEGIN
  IF p_ref_id IS NULL OR btrim(p_ref_id) = '' OR p_evento IS NULL OR btrim(p_evento) = '' THEN
    PERFORM notif_log(NULL, 'rechazado', 'notif_emitir sin ref_id o sin evento: no se puede evitar el duplicado', NULL, NULL, p_tipo);
    RETURN 0;
  END IF;
  FOR d IN SELECT DISTINCT x FROM unnest(COALESCE(p_destinatarios, '{}'::uuid[])) AS x
            WHERE x IS NOT NULL AND x IS DISTINCT FROM p_actor
  LOOP
    IF notif_encolar(d, p_tipo, p_datos, p_tipo || ':' || p_ref_id || ':' || p_evento || ':' || d,
                     p_despues, p_ref_tipo, p_ref_id) IS NOT NULL THEN
      v := v + 1;
    END IF;
  END LOOP;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  PERFORM notif_log(NULL, 'rechazado', SQLERRM, NULL, NULL, p_tipo);
  RETURN v;
END;
$$;

-- ── 6. Disparadores con los tipos nuevos ──────────────────────────────
CREATE OR REPLACE FUNCTION public.notif_trg_evaluacion() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_per TEXT; v_ev TEXT; v_hora TEXT := to_char(NOW(), 'YYYYMMDDHH24');
BEGIN
  BEGIN
    SELECT nombre INTO v_per FROM periodos_evaluacion WHERE id = NEW.periodo_id;
    SELECT nombre INTO v_ev FROM profiles WHERE id = COALESCE(NEW.evaluador_id, auth.uid());
    IF NEW.estado = 'publicado' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'publicado') THEN
      PERFORM notif_encolar(NEW.evaluado_id, 'calificacion_nueva', jsonb_build_object('periodo', v_per, 'evaluador', v_ev),
                            'calificacion_nueva:' || NEW.id || ':' || v_hora, NOW(), 'evaluacion', NEW.id::text);
    ELSIF TG_OP = 'UPDATE' AND OLD.estado = 'publicado' AND NEW.estado = 'publicado' THEN
      IF NEW.puntajes IS DISTINCT FROM OLD.puntajes OR NEW.bono_ext IS DISTINCT FROM OLD.bono_ext THEN
        -- 15 minutos de margen: varias correcciones seguidas se avisan una sola vez.
        PERFORM notif_encolar(NEW.evaluado_id, 'calificacion_cambiada', jsonb_build_object('periodo', v_per, 'evaluador', v_ev),
                              'calificacion_cambiada:' || NEW.id || ':' || v_hora, NOW() + INTERVAL '15 minutes', 'evaluacion', NEW.id::text);
      ELSIF NEW.comentarios IS DISTINCT FROM OLD.comentarios THEN
        PERFORM notif_encolar(NEW.evaluado_id, 'observacion_nueva', jsonb_build_object('periodo', v_per, 'autor', v_ev),
                              'observacion_nueva:' || NEW.id || ':' || v_hora, NOW() + INTERVAL '15 minutes', 'evaluacion', NEW.id::text);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notif_trg_tarea() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_per TEXT; v_nom TEXT; v_otro TEXT; v_rev UUID; v_zona TEXT; v_actor UUID := auth.uid();
  v_hora TEXT := to_char(NOW(), 'YYYYMMDDHH24');
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
          'tarea_asignada:' || NEW.id, NOW(), 'tarea', NEW.id::text);
      END IF;
      RETURN NULL;
    END IF;

    SELECT nombre INTO v_otro FROM profiles WHERE id = v_actor;

    IF NEW.estado IS DISTINCT FROM OLD.estado THEN
      IF NEW.estado = 'entregada' AND OLD.estado = 'aprobada' THEN
        -- Reabierta por la administración: la persona se entera de que su tarea vuelve a revisión.
        PERFORM notif_encolar(NEW.asignada_a, 'estado_cambiado', jsonb_build_object(
          'objeto', 'Tarea', 'elemento', NEW.titulo, 'antes', 'Aprobada', 'ahora', 'Por revisar', 'cambiado_por', COALESCE(v_otro, 'La administración')),
          'estado_cambiado:' || NEW.id || ':reabierta:' || extract(epoch FROM NOW())::BIGINT, NOW(), 'tarea', NEW.id::text);
      ELSIF NEW.estado = 'entregada' THEN
        v_zona := public.zona_periodo(NEW.periodo_id);
        FOR v_rev IN SELECT notif_revisores(NEW.asignada_a) LOOP
          PERFORM notif_encolar(v_rev, 'entrega_registrada', jsonb_build_object(
            'tarea', NEW.titulo, 'persona', v_nom,
            'entregada', notif_fecha((NEW.entregada_en AT TIME ZONE v_zona)::DATE),
            'a_tiempo', CASE WHEN NEW.fecha_limite IS NULL THEN 'Sin plazo'
                             WHEN (NEW.entregada_en AT TIME ZONE v_zona)::DATE <= NEW.fecha_limite THEN 'Sí' ELSE 'No' END),
            'entrega_registrada:' || NEW.id || ':' || NEW.rondas_revision || ':' || v_rev, NOW(), 'tarea', NEW.id::text);
        END LOOP;
      ELSIF NEW.estado = 'devuelta' THEN
        PERFORM notif_encolar(NEW.asignada_a, 'correccion_solicitada', jsonb_build_object(
          'tarea', NEW.titulo, 'revisor', COALESCE(v_otro, 'Quien revisa'), 'observacion', NEW.revision_nota,
          'fecha_limite', notif_fecha(NEW.fecha_limite)),
          'correccion_solicitada:' || NEW.id || ':' || NEW.rondas_revision, NOW(), 'tarea', NEW.id::text);
      ELSIF NEW.estado = 'aprobada' THEN
        PERFORM notif_encolar(NEW.asignada_a, 'tarea_aprobada', jsonb_build_object(
          'tarea', NEW.titulo, 'revisor', COALESCE(v_otro, 'Quien revisa'), 'puntos', NEW.puntos),
          'tarea_aprobada:' || NEW.id || ':' || COALESCE(extract(epoch FROM NEW.aprobada_en)::BIGINT, 0), NOW(), 'tarea', NEW.id::text);
      ELSIF NEW.estado = 'bloqueada' THEN
        FOR v_rev IN SELECT notif_revisores(NEW.asignada_a) LOOP
          PERFORM notif_encolar(v_rev, 'tarea_bloqueada', jsonb_build_object(
            'tarea', NEW.titulo, 'persona', v_nom, 'motivo', NEW.bloqueo_motivo),
            'tarea_bloqueada:' || NEW.id || ':' || extract(epoch FROM NOW())::BIGINT || ':' || v_rev, NOW(), 'tarea', NEW.id::text);
        END LOOP;
      END IF;
    END IF;

    -- Cambios que la persona necesita conocer (nunca se avisa a quien los hizo: lo evita el actor).
    IF NEW.origen = 'asignada' AND NEW.asignada_a IS NOT DISTINCT FROM OLD.asignada_a THEN
      IF NEW.fecha_limite IS DISTINCT FROM OLD.fecha_limite THEN
        PERFORM notif_emitir('tarea_cambio', ARRAY[NEW.asignada_a], jsonb_build_object(
          'tarea', NEW.titulo, 'cambio', 'Fecha límite', 'antes', notif_fecha(OLD.fecha_limite), 'ahora', notif_fecha(NEW.fecha_limite),
          'fecha_nueva', notif_fecha(NEW.fecha_limite), 'motivo', current_setting('eight.tarea_motivo', true), 'cambiado_por', v_otro),
          'tarea', NEW.id::text, 'fecha:' || extract(epoch FROM NOW())::BIGINT, v_actor);
      END IF;
      IF NEW.descripcion IS DISTINCT FROM OLD.descripcion OR NEW.titulo IS DISTINCT FROM OLD.titulo THEN
        PERFORM notif_emitir('tarea_cambio', ARRAY[NEW.asignada_a], jsonb_build_object(
          'tarea', NEW.titulo, 'cambio', 'Instrucciones', 'ahora', 'Se actualizó el detalle de la tarea', 'cambiado_por', v_otro),
          'tarea', NEW.id::text, 'instr:' || v_hora, v_actor, NOW() + INTERVAL '10 minutes');
      END IF;
    ELSIF NEW.asignada_a IS DISTINCT FROM OLD.asignada_a THEN
      -- Cambio de responsable: se entera la nueva persona (como asignación) y la que deja de serlo.
      PERFORM notif_emitir('tarea_asignada', ARRAY[NEW.asignada_a], jsonb_build_object(
        'tarea', NEW.titulo, 'periodo', v_per, 'asignador', COALESCE(v_otro, 'La administración'),
        'fecha_limite', notif_fecha(NEW.fecha_limite), 'prioridad', NEW.prioridad),
        'tarea', NEW.id::text, 'resp:' || extract(epoch FROM NOW())::BIGINT, v_actor);
      PERFORM notif_emitir('tarea_cambio', ARRAY[OLD.asignada_a], jsonb_build_object(
        'tarea', NEW.titulo, 'cambio', 'Responsable', 'antes', 'Tú', 'ahora', v_nom, 'cambiado_por', v_otro),
        'tarea', NEW.id::text, 'resp:' || extract(epoch FROM NOW())::BIGINT, v_actor);
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END;
$$;

-- ── 7. Envío: reclamar, marcar, pendientes, mantenimiento (servidor) ──
DROP FUNCTION IF EXISTS public.notif_reclamar(INT);
CREATE OR REPLACE FUNCTION public.notif_reclamar(p_max INT DEFAULT 25)
RETURNS TABLE (id BIGINT, tipo TEXT, datos JSONB, email TEXT, nombre TEXT, es_admin BOOLEAN, tipo_miembro TEXT,
               intento INT, ref_tipo TEXT, ref_id TEXT, destino TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  -- a) Sin dirección de correo: el aviso queda en la campana y el correo se descarta (con motivo).
  WITH x AS (
    UPDATE notificaciones n SET correo_estado = 'omitido', correo_motivo = 'sin_correo'
      FROM profiles p
     WHERE p.id = n.destinatario_id AND n.correo_estado = 'pendiente' AND n.enviar_despues <= NOW()
       AND COALESCE(btrim(p.email), '') = ''
    RETURNING n.id, n.tipo)
  INSERT INTO notificaciones_eventos (notificacion_id, evento, detalle, tipo) SELECT x.id, 'correo_omitido', 'sin_correo', x.tipo FROM x;

  -- b) Aviso opcional y la persona apagó su correo: solo campana. Los esenciales nunca se omiten.
  WITH x AS (
    UPDATE notificaciones n SET correo_estado = 'omitido', correo_motivo = 'preferencia'
      FROM notif_tipos t, notif_preferencias f
     WHERE t.tipo = n.tipo AND NOT t.esencial AND f.persona_id = n.destinatario_id AND f.tipo = n.tipo AND NOT f.correo
       AND n.correo_estado = 'pendiente' AND n.enviar_despues <= NOW()
    RETURNING n.id, n.tipo)
  INSERT INTO notificaciones_eventos (notificacion_id, evento, detalle, tipo) SELECT x.id, 'correo_omitido', 'preferencia', x.tipo FROM x;

  -- c) Un arrendamiento vencido con todos los intentos gastados es un fallo definitivo.
  WITH x AS (
    UPDATE notificaciones n SET correo_estado = 'fallido', correo_motivo = COALESCE(n.ultimo_error, 'Reintentos agotados')
     WHERE n.correo_estado = 'pendiente' AND n.intentos >= public.notif_max_intentos() AND n.enviar_despues <= NOW()
    RETURNING n.id, n.tipo)
  INSERT INTO notificaciones_eventos (notificacion_id, evento, detalle, tipo) SELECT x.id, 'correo_agotado', 'Reintentos agotados', x.tipo FROM x;

  -- d) Reclamar el lote con arrendamiento de 10 minutos (dos ejecuciones no toman la misma fila).
  RETURN QUERY
  WITH tomadas AS (
    SELECT n.id FROM notificaciones n
     WHERE n.correo_estado = 'pendiente' AND n.intentos < public.notif_max_intentos() AND n.enviar_despues <= NOW()
     ORDER BY n.id LIMIT GREATEST(1, LEAST(COALESCE(p_max, 25), 100)) FOR UPDATE SKIP LOCKED
  ), act AS (
    UPDATE notificaciones n SET intentos = n.intentos + 1, enviar_despues = NOW() + INTERVAL '10 minutes'
      FROM tomadas t WHERE n.id = t.id
    RETURNING n.id, n.tipo, n.datos, n.destinatario_id, n.intentos, n.ref_tipo, n.ref_id
  )
  SELECT a.id, a.tipo, a.datos, p.email, p.nombre, COALESCE(p.es_admin, false), COALESCE(p.tipo_miembro, 'miembro'),
         a.intentos, a.ref_tipo, a.ref_id,
         public.notif_destino(a.tipo, public.notif_rol_de(a.destinatario_id))
    FROM act a JOIN profiles p ON p.id = a.destinatario_id;
END;
$$;

DROP FUNCTION IF EXISTS public.notif_marcar(BIGINT, TEXT);
-- p_modo: 'produccion' (salió un correo real) | 'prueba' (NO salió ninguno: queda «simulado»).
CREATE OR REPLACE FUNCTION public.notif_marcar(
  p_id BIGINT, p_error TEXT DEFAULT NULL, p_modo TEXT DEFAULT 'produccion',
  p_permanente BOOLEAN DEFAULT false, p_via TEXT DEFAULT NULL
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n notificaciones%ROWTYPE; v_espera INTERVAL;
BEGIN
  SELECT * INTO n FROM notificaciones WHERE id = p_id AND correo_estado = 'pendiente' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;      -- ya resuelta: marcar dos veces no duplica nada

  IF p_error IS NULL THEN
    IF COALESCE(p_modo, 'produccion') = 'prueba' THEN
      UPDATE notificaciones SET correo_estado = 'simulado', correo_motivo = 'modo_prueba', ultimo_error = NULL WHERE id = p_id;
      PERFORM notif_log(p_id, 'correo_simulado', 'Modo de prueba: no se envió ningún correo real', n.intentos, p_via, n.tipo);
    ELSE
      UPDATE notificaciones SET correo_estado = 'enviado', enviada_en = NOW(), ultimo_error = NULL, correo_motivo = NULL WHERE id = p_id;
      PERFORM notif_log(p_id, 'correo_enviado', NULL, n.intentos, p_via, n.tipo);
    END IF;
    RETURN true;
  END IF;

  IF p_permanente OR n.intentos >= public.notif_max_intentos() THEN
    UPDATE notificaciones SET correo_estado = 'fallido', ultimo_error = left(p_error, 500), correo_motivo = left(p_error, 500) WHERE id = p_id;
    PERFORM notif_log(p_id, 'correo_agotado', p_error, n.intentos, p_via, n.tipo);
  ELSE
    v_espera := (ARRAY[5, 15, 60, 180])[LEAST(GREATEST(n.intentos, 1), 4)] * INTERVAL '1 minute';
    UPDATE notificaciones SET ultimo_error = left(p_error, 500), enviar_despues = NOW() + v_espera WHERE id = p_id;
    PERFORM notif_log(p_id, 'correo_fallo', p_error, n.intentos, p_via, n.tipo);
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.notif_hay_pendientes() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM notificaciones
                  WHERE correo_estado = 'pendiente' AND intentos < public.notif_max_intentos() AND enviar_despues <= NOW())
$$;

CREATE OR REPLACE FUNCTION public.notif_mantenimiento() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v INT;
BEGIN
  DELETE FROM notificaciones_eventos WHERE creado_en < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notif_max_intentos(), public.notif_fecha_hora(TIMESTAMPTZ), public.notif_rol_de(UUID),
  public.notif_destino(TEXT, TEXT), public.notif_log(BIGINT, TEXT, TEXT, INT, TEXT, TEXT),
  public.notif_encolar(UUID, TEXT, JSONB, TEXT, TIMESTAMPTZ, TEXT, TEXT),
  public.notif_emitir(TEXT, UUID[], JSONB, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ),
  public.notif_trg_evaluacion(), public.notif_trg_tarea(),
  public.notif_reclamar(INT), public.notif_marcar(BIGINT, TEXT, TEXT, BOOLEAN, TEXT),
  public.notif_hay_pendientes(), public.notif_mantenimiento() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notif_reclamar(INT), public.notif_marcar(BIGINT, TEXT, TEXT, BOOLEAN, TEXT) TO service_role;

-- ── 8. La campana: lista con categoría y destino, resumen, marcar ─────
DROP FUNCTION IF EXISTS public.mis_notificaciones(INT, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION public.mis_notificaciones(
  p_limite INT DEFAULT 40, p_antes TIMESTAMPTZ DEFAULT NULL, p_categoria TEXT DEFAULT NULL, p_solo_sin_leer BOOLEAN DEFAULT false
) RETURNS TABLE (id BIGINT, tipo TEXT, datos JSONB, ref_id TEXT, creada TIMESTAMPTZ, leida_en TIMESTAMPTZ,
                 categoria TEXT, esencial BOOLEAN, ref_tipo TEXT, destino TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rol TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.'; END IF;
  v_rol := notif_rol_de(auth.uid());
  RETURN QUERY
    SELECT n.id, n.tipo, n.datos,
           COALESCE(n.ref_id, NULLIF(split_part(COALESCE(n.dedupe_key, ''), ':', 2), '')),
           n.enviar_despues, n.leida_en, t.categoria, t.esencial, n.ref_tipo,
           COALESCE(t.destino ->> v_rol, t.destino ->> 'miembro', 'inicio')
      FROM notificaciones n JOIN notif_tipos t ON t.tipo = n.tipo
     WHERE n.destinatario_id = auth.uid()
       AND n.enviar_despues <= NOW()
       AND (p_antes IS NULL OR n.enviar_despues < p_antes)
       AND (p_categoria IS NULL OR t.categoria = p_categoria)
       AND (NOT COALESCE(p_solo_sin_leer, false) OR n.leida_en IS NULL)
     ORDER BY n.enviar_despues DESC, n.id DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limite, 40), 100));
END;
$$;

CREATE OR REPLACE FUNCTION public.notif_resumen() RETURNS TABLE (categoria TEXT, total INT, sin_leer INT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.'; END IF;
  RETURN QUERY
    SELECT t.categoria, COUNT(*)::INT, COUNT(*) FILTER (WHERE n.leida_en IS NULL)::INT
      FROM notificaciones n JOIN notif_tipos t ON t.tipo = n.tipo
     WHERE n.destinatario_id = auth.uid() AND n.enviar_despues <= NOW()
     GROUP BY t.categoria;
END;
$$;

DROP FUNCTION IF EXISTS public.notif_marcar_todas();
CREATE OR REPLACE FUNCTION public.notif_marcar_todas(p_categoria TEXT DEFAULT NULL) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.'; END IF;
  UPDATE notificaciones n SET leida_en = NOW()
   WHERE n.destinatario_id = auth.uid() AND n.leida_en IS NULL AND n.enviar_despues <= NOW()
     AND (p_categoria IS NULL OR EXISTS (SELECT 1 FROM notif_tipos t WHERE t.tipo = n.tipo AND t.categoria = p_categoria));
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END;
$$;

-- ── 9. Preferencias de la persona ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mis_preferencias_notif()
RETURNS TABLE (tipo TEXT, categoria TEXT, titulo TEXT, descripcion TEXT, esencial BOOLEAN, correo BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rol TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.'; END IF;
  v_rol := notif_rol_de(auth.uid());
  RETURN QUERY
    SELECT t.tipo, t.categoria, t.titulo, t.descripcion, t.esencial,
           (t.esencial OR COALESCE(f.correo, t.correo_default))
      FROM notif_tipos t LEFT JOIN notif_preferencias f ON f.tipo = t.tipo AND f.persona_id = auth.uid()
     WHERE v_rol = ANY (t.audiencia)
     ORDER BY t.orden, t.tipo;
END;
$$;

-- p_prefs = {"tarea_por_vencer": false, "actividad_nueva": true}. Todo o nada: un tipo esencial o ajeno
-- a su rol rechaza el conjunto entero (así la pantalla no queda a medias).
CREATE OR REPLACE FUNCTION public.guardar_preferencias_notif(p_prefs JSONB) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r RECORD; t notif_tipos%ROWTYPE; v_rol TEXT; v INT := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.'; END IF;
  IF p_prefs IS NULL OR jsonb_typeof(p_prefs) <> 'object' THEN RAISE EXCEPTION 'Las preferencias deben ser un objeto {tipo: true|false}.'; END IF;
  v_rol := notif_rol_de(auth.uid());
  FOR r IN SELECT key, value FROM jsonb_each(p_prefs) LOOP
    SELECT * INTO t FROM notif_tipos WHERE tipo = r.key;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tipo de aviso desconocido: %.', r.key; END IF;
    IF jsonb_typeof(r.value) <> 'boolean' THEN RAISE EXCEPTION 'El valor de % debe ser verdadero o falso.', r.key; END IF;
    IF v_rol IS NULL OR NOT (v_rol = ANY (t.audiencia)) THEN RAISE EXCEPTION 'El aviso «%» no aplica a tu rol.', t.titulo USING ERRCODE = '42501'; END IF;
    IF t.esencial THEN RAISE EXCEPTION 'El aviso «%» es esencial y no se puede desactivar.', t.titulo USING ERRCODE = '42501'; END IF;
    INSERT INTO notif_preferencias (persona_id, tipo, correo) VALUES (auth.uid(), r.key, (r.value)::text::boolean)
    ON CONFLICT (persona_id, tipo) DO UPDATE SET correo = EXCLUDED.correo, actualizada = NOW();
    v := v + 1;
  END LOOP;
  RETURN v;
END;
$$;

-- ── 10. Estado de los envíos para la administración ───────────────────
CREATE OR REPLACE FUNCTION public.notif_estado_envios(p_dias INT DEFAULT 7)
RETURNS TABLE (tipo TEXT, correo_estado TEXT, motivo TEXT, total INT, ultimo TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere sesion.'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Solo la administración ve el estado de los envíos.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT n.tipo, n.correo_estado, n.correo_motivo, COUNT(*)::INT, MAX(n.created_at)
      FROM notificaciones n
     WHERE n.created_at >= NOW() - (GREATEST(1, LEAST(COALESCE(p_dias, 7), 90)) || ' days')::INTERVAL
     GROUP BY n.tipo, n.correo_estado, n.correo_motivo
     ORDER BY 5 DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mis_notificaciones(INT, TIMESTAMPTZ, TEXT, BOOLEAN), public.notif_resumen(),
  public.notif_marcar_todas(TEXT), public.mis_preferencias_notif(), public.guardar_preferencias_notif(JSONB),
  public.notif_estado_envios(INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mis_notificaciones(INT, TIMESTAMPTZ, TEXT, BOOLEAN), public.notif_resumen(),
  public.notif_marcar_todas(TEXT), public.mis_preferencias_notif(), public.guardar_preferencias_notif(JSONB),
  public.notif_estado_envios(INT) TO authenticated;

-- ── 11. Recordatorio «por vencer»: la clave distingue «mañana» de «hoy» ──
DO $notif$
DECLARE v_def TEXT;
BEGIN
  IF to_regprocedure('public.notif_generar_recordatorios()') IS NOT NULL THEN
    v_def := pg_get_functiondef('public.notif_generar_recordatorios()'::regprocedure);
    IF position('''tarea_por_vencer:'' || r.id || '':'' || r.fecha_limite)' IN v_def) > 0 THEN
      v_def := replace(v_def, '''tarea_por_vencer:'' || r.id || '':'' || r.fecha_limite)',
                              '''tarea_por_vencer:'' || r.id || '':'' || r.fecha_limite || '':'' || CASE WHEN r.fecha_limite = v_hoy THEN ''hoy'' ELSE ''manana'' END)');
      EXECUTE v_def;
    END IF;
  END IF;
END $notif$;

-- ── 12. Programación (solo donde existe pg_cron) ──────────────────────
-- La condición del job pasa a vivir en notif_hay_pendientes(): cambiarla ya no obliga a reprogramar.
-- Se reutiliza el comando que 0019 dejó programado (con su URL y su clave pública) y solo se cambia
-- el WHERE; si el job no existe (0019 sin cron) no se inventa uno.
DO $cron$
DECLARE v_cmd TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'notif_enviar';
    IF v_cmd IS NOT NULL AND position('notif_hay_pendientes' IN v_cmd) = 0 THEN
      v_cmd := regexp_replace(v_cmd, 'WHERE EXISTS \(SELECT 1 FROM public\.notificaciones.*\)', 'WHERE public.notif_hay_pendientes()');
      PERFORM cron.schedule('notif_enviar', '*/5 * * * *', v_cmd);
    END IF;
    PERFORM cron.schedule('notif_mantenimiento', '30 11 * * *', 'SELECT public.notif_mantenimiento()');
  END IF;
END $cron$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (después de aplicar)
-- ══════════════════════════════════════════════════════════════════════
--   SELECT tipo, categoria, esencial FROM notif_tipos ORDER BY orden;                -- 20 tipos
--   SELECT correo_estado, count(*) FROM notificaciones GROUP BY 1;                   -- lo viejo: enviado / pendiente / fallido
--   SELECT * FROM cron.job WHERE jobname LIKE 'notif_%';                              -- notif_enviar y notif_mantenimiento
--   SELECT pg_get_functiondef('public.notif_generar_recordatorios()'::regprocedure) LIKE '%manana%';  -- true
-- DESHACER (comentado; los avisos renombrados conservan su nuevo nombre)
--   ALTER TABLE notificaciones DROP CONSTRAINT notificaciones_tipo_fk;
--   SELECT cron.unschedule('notif_mantenimiento');
--   DROP TABLE notif_preferencias, notificaciones_eventos; DROP TABLE notif_tipos CASCADE;
-- ══════════════════════════════════════════════════════════════════════
