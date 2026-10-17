// Edge Function «auth-correo»: Send Email Hook de Supabase Auth.
//
// Supabase Auth llama aquí en vez de usar su SMTP. Verificamos la firma del webhook, armamos el correo con
// las plantillas del sitio (plantillas.mjs, copia de enviar-notificaciones) y lo enviamos por el puente de
// Google Apps Script (mismos secretos que «enviar-notificaciones»).
//
// ⚠️ Auth da solo 5 segundos al hook (después responde `hook_timeout` y la persona no recibe nada). El
// puente de Apps Script tarda entre 4 y 8 s, así que NO se espera aquí: se valida la firma, se arman los
// correos, se contesta 200 enseguida y el envío (con reintentos) sigue en segundo plano con
// EdgeRuntime.waitUntil. Si el envío fallara tres veces queda en el log de la función; la persona puede
// pedir otro enlace desde «Reenviar confirmación» / «Olvidé mi contraseña».
//
// Secretos (Edge Functions → Secrets): SEND_EMAIL_HOOK_SECRET (el «v1,whsec_…» que genera el panel al
// activar el hook), APPS_SCRIPT_URL, APPS_SCRIPT_SECRET.
// Panel → Authentication → Auth Hooks → Send Email → HTTPS → esta URL. Con el hook activo, el SMTP y las
// plantillas del panel dejan de usarse para esos correos.
import { Webhook } from 'npm:standardwebhooks@1.0.0';
import { AUTH, correo } from './plantillas.mjs';

const SUPA = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
const puenteUrl = (Deno.env.get('APPS_SCRIPT_URL') || '').trim();
const puenteSecreto = (Deno.env.get('APPS_SCRIPT_SECRET') || '').trim();
const hookSecret = (Deno.env.get('SEND_EMAIL_HOOK_SECRET') || '').trim().replace(/^v1,whsec_/, '');

const TIPOS: Record<string, string> = {
  signup: 'confirmacion', invite: 'invitacion', magiclink: 'enlace_magico',
  recovery: 'recuperacion', email_change: 'cambio_correo', reauthentication: 'reautenticacion',
};

const INTENTOS = 3;
const ESPERA_MS = 1500;

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const falla = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { http_code: status, message } }), { status, headers: { 'Content-Type': 'application/json' } });
const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function enviar(para: string, asunto: string, html: string) {
  const r = await fetch(puenteUrl, {
    method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secreto: puenteSecreto, to: para, subject: asunto, html }),
  });
  const texto = await r.text();
  let j: { ok?: boolean; error?: string };
  try { j = JSON.parse(texto); } catch { throw new Error(`Respuesta inesperada del puente (${r.status})`); }
  if (!j.ok) throw new Error(j.error || 'El puente rechazó el envío');
}

/** Un correo, con reintentos: el puente de Apps Script falla de vez en cuando por cuota o por arranque en frío. */
async function enviarConReintentos(c: { para: string; asunto: string; html: string }) {
  let ultimo = '';
  for (let i = 1; i <= INTENTOS; i++) {
    try {
      await enviar(c.para, c.asunto, c.html);
      console.log(`auth-correo: enviado a ${c.para} (intento ${i})`);
      return;
    } catch (e) {
      ultimo = (e as Error).message;
      console.error(`auth-correo: intento ${i}/${INTENTOS} a ${c.para} falló: ${ultimo}`);
      if (i < INTENTOS) await dormir(ESPERA_MS * i);
    }
  }
  console.error(`auth-correo: NO se pudo enviar a ${c.para} tras ${INTENTOS} intentos: ${ultimo}`);
}

Deno.serve(async (req) => {
  if (!hookSecret || !puenteUrl || !puenteSecreto) return falla(503, 'Faltan secretos del hook o del puente');

  const cuerpo = await req.text();
  let datos: any;
  try {
    datos = new Webhook(hookSecret).verify(cuerpo, Object.fromEntries(req.headers));
  } catch {
    return falla(401, 'Firma no válida');
  }

  const { user, email_data: d } = datos;
  const clave = TIPOS[d?.email_action_type];
  if (!user || !d || !clave) return falla(400, `Tipo de correo no soportado: ${d?.email_action_type}`);
  const def = (AUTH as Record<string, any>)[clave];

  // Un correo por destinatario: el cambio de correo seguro manda uno al actual y otro al nuevo.
  const destinos = d.email_action_type === 'email_change'
    ? [{ para: user.email, hash: d.token_hash, token: d.token }, { para: user.new_email, hash: d.token_hash_new, token: d.token_new }].filter((x) => x.para && x.hash)
    : [{ para: user.email, hash: d.token_hash, token: d.token }];

  // Se arma todo ahora (es rápido y valida las plantillas); solo el envío va a segundo plano.
  let correos: { para: string; asunto: string; html: string }[];
  try {
    correos = destinos.map((x) => {
      const url = `${SUPA}/auth/v1/verify?token=${encodeURIComponent(x.hash)}&type=${encodeURIComponent(d.email_action_type)}&redirect_to=${encodeURIComponent(d.redirect_to || d.site_url || '')}`;
      const poner = (t: string, escapar: boolean) => t
        .replaceAll('{{ .ConfirmationURL }}', escapar ? esc(url) : url)
        .replaceAll('{{ .Email }}', escapar ? esc(user.email) : user.email)
        .replaceAll('{{ .NewEmail }}', escapar ? esc(user.new_email) : String(user.new_email ?? ''))
        .replaceAll('{{ .Token }}', escapar ? esc(x.token) : String(x.token ?? ''));
      return { para: x.para, asunto: poner(def.asunto, false), html: poner(correo(def), true) };
    });
  } catch (e) {
    return falla(500, `No se pudo preparar el correo: ${(e as Error).message}`);
  }

  const trabajo = (async () => { for (const c of correos) await enviarConReintentos(c); })();
  // @ts-ignore EdgeRuntime existe en el entorno de Supabase Edge Functions
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(trabajo);
  else await trabajo;

  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
});
