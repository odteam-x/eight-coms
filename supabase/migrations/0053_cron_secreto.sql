-- 0053 — La tarea programada de envío de correos manda un secreto propio (cabecera x-cron-secret).
--
-- POR QUÉ. 0019 programó net.http_post a la función enviar-notificaciones con la clave anon en Authorization. La clave anon es pública
-- (va en config.js): sirve para pasar la verificación de JWT de Supabase pero no identifica a nadie, así que cualquiera podía invocar la
-- función. La función ahora exige además CRON_SECRET (nucleo.mjs → llamadaAutorizada) y esta migración hace que el job lo envíe.
--
-- ORDEN (importa; si se aplica en otro orden los correos dejan de salir hasta completar los tres pasos):
--   1. Genera un secreto largo al azar (≥ 32 caracteres).
--   2. Supabase → Edge Functions → Secrets:  CRON_SECRET = ese valor   (y vuelve a desplegar enviar-notificaciones).
--   3. Supabase → Vault: crea un secreto llamado  cron_secret  con el MISMO valor
--        select vault.create_secret('<el valor>', 'cron_secret');
--   4. Ejecuta esta migración.
-- El valor no vive en el repositorio ni en el comando del job: el job lo lee de Vault en cada ejecución.
--
-- Idempotente: si el job ya manda la cabecera, no hace nada. Si no hay pg_cron (entornos de prueba), no hace nada.

DO $m$
DECLARE v_cmd TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE '0053: sin pg_cron, no hay job que actualizar.';
    RETURN;
  END IF;
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'notif_enviar';
  IF v_cmd IS NULL THEN
    RAISE NOTICE '0053: no existe el job notif_enviar (0019 sin cron); nada que hacer.';
    RETURN;
  END IF;
  IF position('x-cron-secret' IN v_cmd) > 0 THEN
    RAISE NOTICE '0053: el job ya envía x-cron-secret.';
    RETURN;
  END IF;
  IF position('jsonb_build_object(''Content-Type'', ''application/json'',' IN v_cmd) = 0 THEN
    RAISE EXCEPTION '0053: el comando del job no tiene la forma esperada; no se modifica nada. Revisa cron.job.';
  END IF;
  v_cmd := replace(v_cmd,
    'jsonb_build_object(''Content-Type'', ''application/json'',',
    'jsonb_build_object(''Content-Type'', ''application/json'', ''x-cron-secret'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''cron_secret'' LIMIT 1),');
  PERFORM cron.schedule('notif_enviar', '*/5 * * * *', v_cmd);
END
$m$;
