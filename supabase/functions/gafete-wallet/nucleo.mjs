// Núcleo de «gafete-wallet»: arma el pase de Google Wallet y firma el enlace «Añadir a Google Wallet».
// Puro (sin red ni Deno): se prueba en Node (tools/pruebas/wallet.mjs). index.ts solo lo conecta.
export const CLASE = 'eight_gafete';
const enc = new TextEncoder();
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uTxt = s => b64u(enc.encode(s));

/** Config desde las variables de la función. Sin ella la función responde 503 y el portal oculta el botón. */
export function leerConfig(env) {
  const errores = [];
  const issuer = String(env.GOOGLE_WALLET_ISSUER_ID || '').trim();
  if (!/^\d{10,25}$/.test(issuer)) errores.push('GOOGLE_WALLET_ISSUER_ID falta o no es el número de emisor');
  let sa = null;
  try { sa = JSON.parse(env.GOOGLE_WALLET_SA_JSON || ''); } catch (e) { /* se informa abajo */ }
  if (!sa || !sa.client_email || !/BEGIN PRIVATE KEY/.test(sa.private_key || '')) errores.push('GOOGLE_WALLET_SA_JSON falta o no es el JSON de la cuenta de servicio');
  const sitio = String(env.SITIO_URL || 'https://eight-coms.vercel.app').replace(/\/+$/, '');
  if (!/^https:\/\//.test(sitio)) errores.push('SITIO_URL debe ser https');
  return { listo: !errores.length, errores, issuer, sa, sitio };
}

export async function importarClave(pem) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** JWT RS256. */
export async function firmar(payload, clave) {
  const cuerpo = b64uTxt(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64uTxt(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clave, enc.encode(cuerpo));
  return cuerpo + '.' + b64u(sig);
}

const L = (v, max = 60) => ({ defaultValue: { language: 'es', value: String(v ?? '').slice(0, max) } });
const CARGOS = { miembro: 'Miembro', secretaria: 'Secretaría', administracion: 'Administración' };

export const claseId = issuer => `${issuer}.${CLASE}`;
export const claseWallet = issuer => ({ id: claseId(issuer) });

/** `d` es la respuesta de verificar_gafete: lo mismo que verá quien escanee el QR. */
export function objetoWallet({ issuer, token, d, urlQR, logoUrl, heroUrl }) {
  const desde = d.miembro_desde ? new Date(d.miembro_desde).toLocaleDateString('es-DO', { month: 'short', year: 'numeric', timeZone: 'UTC' }).replace('.', '') : '—';
  const mod = (id, header, body) => ({ id, header, body: String(body || '—').slice(0, 40) });
  return {
    id: `${issuer}.${token}`,
    classId: claseId(issuer),
    state: 'ACTIVE',
    hexBackgroundColor: '#002247',
    cardTitle: L('EIGHT Creators · CELIDER 08'),
    header: L(d.nombre, 40),
    subheader: L('Miembro de EIGHT Creators'),
    logo: { sourceUri: { uri: logoUrl }, contentDescription: L('Insignia del Club Escolar R08') },
    heroImage: { sourceUri: { uri: heroUrl }, contentDescription: L('Foto de ' + d.nombre) },
    barcode: { type: 'QR_CODE', value: urlQR, alternateText: 'Verificar gafete' },
    textModulesData: [
      mod('cargo', 'CARGO', CARGOS[d.cargo] || 'Miembro'),
      mod('distrito', 'DISTRITO', d.distrito),
      mod('rol', 'ROL', d.rol),
      mod('desde', 'MIEMBRO DESDE', desde),
    ],
    linksModuleData: { uris: [{ id: 'verificar', uri: urlQR, description: 'Verificar este gafete' }] },
  };
}

/** Enlace «Añadir a Google Wallet» (JWT firmado con la cuenta de servicio; el objeto ya está creado por API). */
export async function enlaceGuardar({ sa, clave, objetoId, ahora = Math.floor(Date.now() / 1000) }) {
  const jwt = await firmar({ iss: sa.client_email, aud: 'google', typ: 'savetowallet', iat: ahora, origins: [], payload: { genericObjects: [{ id: objetoId }] } }, clave);
  return 'https://pay.google.com/gp/v/save/' + jwt;
}

/** Afirmación OAuth de la cuenta de servicio para llamar a la API de Wallet. */
export async function afirmacionAcceso({ sa, clave, ahora = Math.floor(Date.now() / 1000) }) {
  return firmar({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/wallet_object.issuer', aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 }, clave);
}
