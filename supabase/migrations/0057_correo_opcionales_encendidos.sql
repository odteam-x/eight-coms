-- ══════════════════════════════════════════════════════════════════════
--  0057 — Correo: los avisos OPCIONALES vuelven a salir ENCENDIDOS por defecto; cada persona los apaga a mano
-- ══════════════════════════════════════════════════════════════════════
--
--  DECISIÓN DEL DUEÑO DEL PROYECTO (noviembre 2026): las notificaciones están activas para todas las personas y quien no las
--  quiera las desactiva manualmente en Mi cuenta → Preferencias. Revierte el valor por defecto que fijó 0042.
--
--  QUÉ CAMBIA.
--    · notif_tipos.correo_default = true para todo tipo opcional (los esenciales ya lo eran y no se pueden apagar).
--    · notif_reclamar() no se toca: ya decide por la preferencia de la persona y, si no hay, por correo_default (0042).
--
--  NO CAMBIA: las preferencias ya guardadas (quien APAGÓ un opcional sigue sin recibirlo; quien lo encendió, lo recibe),
--  la campana, la cola ni ningún aviso ya enviado. Los avisos opcionales que estén pendientes se enviarán.
--
--  ⚠ VOLUMEN. Con ~25 personas, una tarea de equipo + la nota publicada ya son ~50 correos. El remitente actual (Gmail
--  personal por Apps Script) tiene un tope de ~100 destinatarios al día: si se supera, los correos reintentan (5/15/60/180 min,
--  máx. 5) y luego quedan como «fallido» en «Estado de los correos». La campana no tiene tope. Si el volumen crece, usar un
--  proveedor transaccional (docs/configurar-correos.md) o volver a poner correo_default = false en los tipos más ruidosos.
--
--  Requiere 0040 y 0042. Aplicación manual en el SQL Editor. Idempotente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;
UPDATE public.notif_tipos SET correo_default = true WHERE NOT esencial AND NOT correo_default;
COMMIT;
