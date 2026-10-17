// Edge Function «enviar-notificaciones»: vacía la cola `notificaciones` y manda cada aviso por correo.
//
// La invoca pg_cron (migración 0019) cada 5 minutos, solo si hay avisos pendientes.
// Dos vías de envío, en este orden de preferencia:
//   1. Puente de Google Apps Script (supabase/apps-script/Code.gs): secretos APPS_SCRIPT_URL y
//      APPS_SCRIPT_SECRET. Envía desde tu cuenta de Google, sin contraseña SMTP.
//   2. Gmail SMTP: secretos GMAIL_USER y GMAIL_APP_PASSWORD (Google puede bloquearlo por IP).
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase. SITIO_URL es opcional.
//
// Sin ninguna vía configurada no toca la cola: responde 503 y los avisos esperan. Cada lote se
// «reclama» en la base (notif_reclamar) con un arrendamiento de 10 minutos, así dos ejecuciones no
// envían el mismo correo.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { AVISOS, correo } from './plantillas.mjs';

const SITIO = (Deno.env.get('SITIO_URL') || 'https://eight-coms.vercel.app').replace(/\/$/, '');
const LOTE = 25;

const esc = (v: unknown) => String(v ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Rellena {{marcador}} con valores ya escapados. Un marcador sin dato queda en «—». */
function rellenar(texto: string, datos: Record<string, unknown>, escapar: boolean) {
  return texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => {
    const v = datos[k] == null || datos[k] === '' ? '—' : datos[k];
    return escapar ? esc(v) : String(v);
  });
}

/** Cada tipo lleva a la pantalla donde se resuelve. */
function enlace(tipo: string, p: { es_admin: boolean; tipo_miembro: string }) {
  const portal = p.es_admin ? 'admin.html' : p.tipo_miembro === 'secretario' ? 'secretario.html' : 'user.html';
  const hash = p.es_admin
    ? ({ tarea_asignada: 'tareas', entrega_por_revisar: 'tareas', tarea_bloqueada: 'tareas', solicitud_acceso: 'usuarios', evaluaciones_sin_publicar: 'evaluar', actividad_nueva: 'calendario', actividad_recordatorio: 'calendario' } as Record<string, string>)[tipo]
    : ({ nota_publicada: 'perfil', nota_corregida: 'perfil', actividad_nueva: 'calendario', actividad_recordatorio: 'calendario', entrega_por_revisar: 'tareas' } as Record<string, string>)[tipo] ?? 'trabajos';
  if (tipo === 'acceso_aprobado') return `${SITIO}/index.html`;
  return `${SITIO}/${portal}#${hash || ''}`;
}

/** HTML de un aviso: la misma plantilla del sitio (plantillas.mjs) con los datos puestos. */
function armar(tipo: string, nombre: string, datos: Record<string, unknown>, url: string) {
  const def = (AVISOS as Record<string, any>)[tipo];
  if (!def) throw new Error(`Tipo de aviso desconocido: ${tipo}`);
  const ctx = { ...datos, nombre: String(nombre || '').split(' ')[0] || 'hola', enlace: url };
  const html = rellenar(correo(def), ctx, true);
  return { asunto: rellenar(def.asunto, ctx, false), html };
}

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async () => {
  const puenteUrl = (Deno.env.get('APPS_SCRIPT_URL') || '').trim();
  const puenteSecreto = (Deno.env.get('APPS_SCRIPT_SECRET') || '').trim();
  const usuario = (Deno.env.get('GMAIL_USER') || '').trim();
  const clave = (Deno.env.get('GMAIL_APP_PASSWORD') || '').replace(/\s+/g, '');
  const usaPuente = !!(puenteUrl && puenteSecreto);
  if (!usaPuente && (!usuario || !clave)) {
    return json({ ok: false, motivo: 'Configura APPS_SCRIPT_URL y APPS_SCRIPT_SECRET (o GMAIL_USER y GMAIL_APP_PASSWORD)' }, 503);
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: lote, error } = await sb.rpc('notif_reclamar', { p_max: LOTE });
  if (error) return json({ ok: false, error: error.message }, 500);
  if (!lote?.length) return json({ ok: true, enviados: 0 });

  async function viaPuente(para: string, asunto: string, html: string) {
    const r = await fetch(puenteUrl, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secreto: puenteSecreto, to: para, subject: asunto, html }),
    });
    const texto = await r.text();
    let j: { ok?: boolean; error?: string };
    try { j = JSON.parse(texto); } catch { throw new Error(`Respuesta inesperada del puente (${r.status}): ${texto.slice(0, 120)}`); }
    if (!j.ok) throw new Error(j.error || 'El puente rechazó el envío');
  }

  const smtp = usaPuente ? null : new SMTPClient({ connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: usuario, password: clave } } });
  let enviados = 0, fallidos = 0;
  try {
    for (const n of lote) {
      try {
        const { asunto, html } = armar(n.tipo, n.nombre, n.datos || {}, enlace(n.tipo, n));
        if (usaPuente) await viaPuente(n.email, asunto, html);
        else await smtp!.send({ from: `EIGHT CREATORS LABs <${usuario}>`, to: n.email, subject: asunto, content: 'Abre este correo en un lector que muestre HTML.', html });
        await sb.rpc('notif_marcar', { p_id: n.id, p_error: null });
        enviados++;
      } catch (e) {
        fallidos++;
        await sb.rpc('notif_marcar', { p_id: n.id, p_error: String((e as Error).message || e).slice(0, 500) });
      }
    }
  } finally {
    try { await smtp?.close(); } catch { /* ya cerrado */ }
  }
  return json({ ok: true, via: usaPuente ? 'apps-script' : 'smtp', enviados, fallidos });
});
