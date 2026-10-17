// Edge Function «auth-correo»: Send Email Hook de Supabase Auth.
//
// Supabase Auth llama aquí en vez de usar su SMTP. Verificamos la firma del webhook, armamos el correo con
// las plantillas del sitio (plantillas.mjs, copia de enviar-notificaciones) y lo enviamos por el puente de
// Google Apps Script (mismos secretos que «enviar-notificaciones»).
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

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const falla = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { http_code: status, message } }), { status, headers: { 'Content-Type': 'application/json' } });

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

  try {
    for (const x of destinos) {
      const url = `${SUPA}/auth/v1/verify?token=${encodeURIComponent(x.hash)}&type=${encodeURIComponent(d.email_action_type)}&redirect_to=${encodeURIComponent(d.redirect_to || d.site_url || '')}`;
      const poner = (t: string, escapar: boolean) => t
        .replaceAll('{{ .ConfirmationURL }}', escapar ? esc(url) : url)
        .replaceAll('{{ .Email }}', escapar ? esc(user.email) : user.email)
        .replaceAll('{{ .NewEmail }}', escapar ? esc(user.new_email) : String(user.new_email ?? ''))
        .replaceAll('{{ .Token }}', escapar ? esc(x.token) : String(x.token ?? ''));
      await enviar(x.para, poner(def.asunto, false), poner(correo(def), true));
    }
  } catch (e) {
    return falla(500, `No se pudo enviar el correo: ${(e as Error).message}`);
  }
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
});
