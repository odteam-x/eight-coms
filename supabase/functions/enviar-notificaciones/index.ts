// Edge Function «enviar-notificaciones»: vacía la cola `notificaciones` y manda cada aviso por Gmail SMTP.
//
// La invoca pg_cron (migración 0019) cada 5 minutos, solo si hay avisos pendientes.
// Secretos (Edge Functions → Secrets): GMAIL_USER, GMAIL_APP_PASSWORD y, opcional, SITIO_URL.
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
//
// Sin los secretos no toca la cola: responde 503 y los avisos esperan. Cada lote se «reclama» en la
// base (notif_reclamar) con un arrendamiento de 10 minutos, así dos ejecuciones no envían el mismo correo.
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
async function armar(tipo: string, nombre: string, datos: Record<string, unknown>, url: string) {
  const def = (AVISOS as Record<string, any>)[tipo];
  if (!def) throw new Error(`Tipo de aviso desconocido: ${tipo}`);
  const ctx = { ...datos, nombre: String(nombre || '').split(' ')[0] || 'hola', enlace: url };
  const html = rellenar(correo(def), ctx, true);
  return { asunto: rellenar(def.asunto, ctx, false), html };
}

Deno.serve(async () => {
  const usuario = Deno.env.get('GMAIL_USER');
  const clave = Deno.env.get('GMAIL_APP_PASSWORD');
  if (!usuario || !clave) {
    return new Response(JSON.stringify({ ok: false, motivo: 'Faltan los secretos GMAIL_USER y GMAIL_APP_PASSWORD' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: lote, error } = await sb.rpc('notif_reclamar', { p_max: LOTE });
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  if (!lote?.length) return new Response(JSON.stringify({ ok: true, enviados: 0 }), { headers: { 'Content-Type': 'application/json' } });

  const smtp = new SMTPClient({ connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: usuario, password: clave } } });
  let enviados = 0, fallidos = 0;
  try {
    for (const n of lote) {
      try {
        const { asunto, html } = await armar(n.tipo, n.nombre, n.datos || {}, enlace(n.tipo, n));
        await smtp.send({ from: `EIGHT CREATORS LABs <${usuario}>`, to: n.email, subject: asunto, content: 'Abre este correo en un lector que muestre HTML.', html });
        await sb.rpc('notif_marcar', { p_id: n.id, p_error: null });
        enviados++;
      } catch (e) {
        fallidos++;
        await sb.rpc('notif_marcar', { p_id: n.id, p_error: String((e as Error).message || e).slice(0, 500) });
      }
    }
  } finally {
    try { await smtp.close(); } catch { /* ya cerrado */ }
  }
  return new Response(JSON.stringify({ ok: true, enviados, fallidos }), { headers: { 'Content-Type': 'application/json' } });
});
