-- ══════════════════════════════════════════════════════════════════════
--  0042 — Correo: los avisos OPCIONALES salen apagados por defecto; los ESENCIALES siguen encendidos
-- ══════════════════════════════════════════════════════════════════════
--
--  POR QUÉ. Con ~25 personas, un aviso opcional («por vencer», «entrega registrada», «tarea aprobada», «actividad
--  nueva»…) multiplica los correos: una tarea para todo el equipo + la nota publicada ya son ~50 correos, y la cuenta
--  que envía (Gmail personal por Apps Script) tiene un tope de unos 100 destinatarios por día. La campana no tiene
--  tope: el aviso opcional SIGUE llegando ahí; solo deja de ir por correo salvo que la persona lo encienda.
--
--  QUÉ CAMBIA.
--    1. notif_tipos.correo_default = false para todo tipo opcional (esencial = false). Los esenciales siguen saliendo
--       siempre por correo y no se pueden apagar (lo impone guardar_preferencias_notif, sin cambios).
--    2. notif_reclamar() ahora RESPETA correo_default: un aviso opcional sin preferencia explícita de la persona se
--       decide por correo_default (antes solo se omitía si la persona lo había apagado ella misma, y correo_default
--       solo cambiaba lo que mostraba la pantalla de preferencias: mostraba «apagado» pero el correo salía igual).
--       Una persona que enciende un opcional (preferencia correo = true) lo recibe; una que lo apaga, no.
--       Motivo del descarte: 'preferencia' (el mismo de siempre; en «Estado de los correos» se ve igual).
--
--  NO CAMBIA: los avisos de la campana, las preferencias ya guardadas, la cola ni ningún aviso ya enviado.
--  Los avisos opcionales que estén PENDIENTES en el momento de aplicar esta migración se omiten al próximo reclamo.
--
--  Requiere 0040. Aplicación manual en el SQL Editor. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.notif_tipos SET correo_default = false WHERE NOT esencial AND correo_default;

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

  -- b) Aviso opcional que la persona no quiere por correo: solo campana. Decide su preferencia y, si no tiene,
  --    correo_default del tipo. Los esenciales nunca se omiten.
  WITH x AS (
    UPDATE notificaciones n SET correo_estado = 'omitido', correo_motivo = 'preferencia'
      FROM notif_tipos t
     WHERE t.tipo = n.tipo AND NOT t.esencial
       AND NOT COALESCE((SELECT f.correo FROM notif_preferencias f WHERE f.persona_id = n.destinatario_id AND f.tipo = n.tipo), t.correo_default)
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
REVOKE EXECUTE ON FUNCTION public.notif_reclamar(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notif_reclamar(INT) TO service_role;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- DESHACER: UPDATE notif_tipos SET correo_default = true WHERE NOT esencial;  y volver a aplicar 0040 (recrea notif_reclamar).
-- ══════════════════════════════════════════════════════════════════════
