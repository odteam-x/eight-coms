// Edge Function «gafete-wallet»: devuelve el enlace «Añadir a Google Wallet» del gafete de QUIEN LA LLAMA.
//
// Flujo: el portal sube la imagen del pase (avatars/<uid>/wallet-hero.jpg) y llama aquí con la sesión de la persona.
// Aquí se comprueba la sesión, se leen los datos con verificar_gafete (lo mismo que verá quien escanee el QR), se crea o
// actualiza el pase en la API de Google Wallet y se firma el enlace. Nadie obtiene el gafete de otra persona.
//
// Secretos (Edge Functions → Secrets): GOOGLE_WALLET_ISSUER_ID y GOOGLE_WALLET_SA_JSON (el JSON de la cuenta de servicio
// completo). SITIO_URL es opcional (por defecto https://eight-coms.vercel.app). Sin los dos primeros responde 503.
// SUPABASE_URL y SUPABASE_ANON_KEY los inyecta Supabase. Guía de alta de la cuenta: docs/google-wallet.md
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { leerConfig, importarClave, afirmacionAcceso, claseWallet, objetoWallet, enlaceGuardar, claseId } from './nucleo.mjs';

const API = 'https://walletobjects.googleapis.com/walletobjects/v1';
const cors = (sitio: string) => ({
  'Access-Control-Allow-Origin': sitio, 'Vary': 'Origin',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

Deno.serve(async (req) => {
  const cfg = leerConfig(Deno.env.toObject());
  const h = { 'Content-Type': 'application/json', ...cors(cfg.sitio) };
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: h });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (req.method !== 'POST') return json({ ok: false, motivo: 'Usa POST' }, 405);
  if (!cfg.listo) return json({ ok: false, codigo: 'no_configurado', errores: cfg.errores }, 503);

  const auth = req.headers.get('Authorization') || '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u, error: eu } = await sb.auth.getUser();
  if (eu || !u?.user) return json({ ok: false, codigo: 'sin_sesion' }, 401);

  const { data: token, error: et } = await sb.rpc('obtener_gafete', {});
  if (et) return json({ ok: false, codigo: 'gafete', error: et.message }, 403);
  const { data: d, error: ev } = await sb.rpc('verificar_gafete', { p_token: token });
  if (ev || !d?.valido) return json({ ok: false, codigo: 'no_valido' }, 403);

  let v = '';
  try { v = String((await req.json())?.v ?? '').replace(/\D/g, '').slice(0, 14); } catch (_) { /* sin cuerpo */ }
  const heroUrl = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/avatars/${u.user.id}/wallet-hero.jpg${v ? '?v=' + v : ''}`;
  const objeto = objetoWallet({ issuer: cfg.issuer, token, d, urlQR: `${cfg.sitio}/v/${token}`, logoUrl: `${cfg.sitio}/img/wallet/logo-660.png`, heroUrl });

  try {
    const clave = await importarClave(cfg.sa.private_key);
    const tk = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await afirmacionAcceso({ sa: cfg.sa, clave }) }) });
    const tkj = await tk.json();
    if (!tk.ok) return json({ ok: false, codigo: 'google_auth', error: tkj.error_description || tkj.error }, 502);
    const g = (ruta: string, metodo: string, cuerpo?: unknown) => fetch(API + ruta, { method: metodo, headers: { Authorization: 'Bearer ' + tkj.access_token, 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });

    const rc = await g('/genericClass', 'POST', claseWallet(cfg.issuer));
    if (!rc.ok && rc.status !== 409) return json({ ok: false, codigo: 'google_clase', error: (await rc.json())?.error?.message }, 502);
    let ro = await g('/genericObject', 'POST', objeto);
    if (ro.status === 409) ro = await g('/genericObject/' + encodeURIComponent(objeto.id), 'PUT', objeto);
    if (!ro.ok) return json({ ok: false, codigo: 'google_objeto', error: (await ro.json())?.error?.message }, 502);

    return json({ ok: true, url: await enlaceGuardar({ sa: cfg.sa, clave, objetoId: objeto.id }), clase: claseId(cfg.issuer) });
  } catch (e) {
    console.error('gafete-wallet', e);
    return json({ ok: false, codigo: 'error', error: String((e as Error).message || e) }, 500);
  }
});
