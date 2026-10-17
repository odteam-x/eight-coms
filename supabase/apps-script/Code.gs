/**
 * Puente de correo de EIGHT CREATORS LABs.
 *
 * Recibe un POST de la Edge Function «enviar-notificaciones» y envía el correo DESDE tu cuenta de
 * Google (la que despliega este script). No usa contraseñas ni SMTP, así que Google no bloquea
 * por IP. Límite diario de Google: ~100 destinatarios (cuenta personal) o ~1500 (Workspace).
 *
 * Pasos (docs/configurar-correos.md):
 *   1. script.google.com → Nuevo proyecto → pega este archivo.
 *   2. Configuración del proyecto → Propiedades del script → añade  SECRETO = (una clave larga al azar).
 *   3. Implementar → Nueva implementación → Tipo: Aplicación web → Ejecutar como: Yo →
 *      Quién tiene acceso: Cualquier persona → Implementar → autoriza permisos → copia la URL (/exec).
 *   4. En Supabase (Edge Functions → Secrets): APPS_SCRIPT_URL = esa URL, APPS_SCRIPT_SECRET = la misma clave.
 */
var NOMBRE_REMITENTE = 'EIGHT CREATORS LABs';
var MAX_ASUNTO = 200;
var MAX_HTML = 120000;

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var esperado = PropertiesService.getScriptProperties().getProperty('SECRETO');
    if (!esperado) return responder({ ok: false, error: 'Falta la propiedad SECRETO en el script' });

    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.secreto !== esperado) return responder({ ok: false, error: 'No autorizado' });

    var para = String(d.to || '').trim();
    var asunto = String(d.subject || '').trim();
    var html = String(d.html || '');
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(para)) return responder({ ok: false, error: 'Destinatario no válido' });
    if (!asunto || asunto.length > MAX_ASUNTO) return responder({ ok: false, error: 'Asunto no válido' });
    if (!html || html.length > MAX_HTML) return responder({ ok: false, error: 'Contenido no válido' });

    MailApp.sendEmail({
      to: para,
      subject: asunto,
      htmlBody: html,
      body: 'Abre este correo en un lector que muestre HTML.',
      name: NOMBRE_REMITENTE
    });
    return responder({ ok: true, restantes: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return responder({ ok: false, error: String(err && err.message ? err.message : err).slice(0, 300) });
  }
}

/** Opcional: ejecútala una vez a mano para que Google te pida los permisos de envío. */
function probarPermisos() {
  MailApp.getRemainingDailyQuota();
}
