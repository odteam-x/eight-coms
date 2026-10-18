// Edge Function «enviar-notificaciones»: vacía la cola `notificaciones` y manda cada aviso por correo.
//
// La invoca pg_cron (migraciones 0019/0040) cada 5 minutos, solo si hay avisos pendientes (notif_hay_pendientes).
// La lógica (plantillas, validación, modos, reintentos) vive en nucleo.mjs y se prueba en Node; aquí solo se conecta.
//
// ── MODO (variable CORREO_MODO) ─────────────────────────────────────────────────────────────────────────
//   apagado    (por defecto, también si la variable falta) NO toca la cola: responde 503 y los avisos esperan.
//   prueba     reclama el lote, arma y valida cada correo y lo marca «simulado»: NO sale nada al destinatario real.
//              Si defines CORREO_PRUEBA_DESTINO (y un proveedor) cada correo se manda SOLO a esa dirección,
//              con el asunto «[PRUEBA → real@…]».
//   produccion manda al destinatario real. Exige proveedor configurado y SITIO_URL https.
//
// ── PROVEEDOR (en este orden de preferencia) ────────────────────────────────────────────────────────────
//   1. Puente de Google Apps Script (supabase/apps-script/Code.gs): APPS_SCRIPT_URL + APPS_SCRIPT_SECRET.
//   2. Gmail SMTP: GMAIL_USER + GMAIL_APP_PASSWORD (Google puede bloquearlo por IP).
// Todo son secretos de la función (Edge Functions → Secrets): nada de esto va al repositorio ni al navegador.
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase. SITIO_URL es opcional.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { leerConfig, crearPuente, procesarLote } from './nucleo.mjs';

const LOTE = 25;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, motivo: 'Usa POST' }, 405);
  const cfg = leerConfig(Deno.env.toObject());
  if (cfg.errores.length) console.warn('Configuración de correo:', cfg.errores.join(' | '));
  if (!cfg.listo) {
    return json({
      ok: false, modo: cfg.modo, errores: cfg.errores,
      motivo: cfg.modo === 'apagado'
        ? 'Correo apagado: define CORREO_MODO = prueba o produccion (docs/configurar-correos.md). La cola queda intacta.'
        : 'Configuración incompleta: la cola queda intacta.',
    }, 503);
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: lote, error } = await sb.rpc('notif_reclamar', { p_max: LOTE });
  if (error) return json({ ok: false, error: error.message }, 500);
  if (!lote?.length) return json({ ok: true, modo: cfg.modo, enviados: 0 });

  let enviar: ((m: { para: string; asunto: string; html: string; clave: string }) => Promise<unknown>) | null = null;
  let smtp: SMTPClient | null = null;
  if (cfg.via === 'apps-script') enviar = crearPuente(cfg);
  else if (cfg.via === 'smtp') {
    smtp = new SMTPClient({ connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: cfg.usuario, password: cfg.clave } } });
    enviar = ({ para, asunto, html }) => smtp!.send({ from: `EIGHT CREATORS LABs <${cfg.usuario}>`, to: para, subject: asunto, content: 'Abre este correo en un lector que muestre HTML.', html });
  }

  try {
    const r = await procesarLote({
      lote, cfg, enviar: enviar as never,
      concurrencia: cfg.via === 'smtp' ? 1 : 4,   // una conexión SMTP no se comparte entre envíos simultáneos
      marcar: async (id: number, err: string | null, modo: string, permanente: boolean, via: string) => {
        const { error: e } = await sb.rpc('notif_marcar', { p_id: id, p_error: err, p_modo: modo, p_permanente: permanente, p_via: via });
        if (e) throw new Error(e.message);
      },
    });
    return json({ ok: true, modo: cfg.modo, via: cfg.via, ...r });
  } finally {
    try { await smtp?.close(); } catch { /* ya cerrado */ }
  }
});
