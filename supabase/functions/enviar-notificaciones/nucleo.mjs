// Núcleo del envío de correos: lógica PURA, sin Deno ni red, para poder probarla en Node (tools/pruebas/correo.mjs).
// index.ts solo la conecta con Supabase y con el proveedor real.
//
// Qué garantiza este archivo:
//   · MODO: «apagado» (por defecto), «prueba» o «produccion». Solo «produccion» manda correo al destinatario real.
//   · Un correo se arma con la plantilla única (plantillas.mjs), con TODO dato escapado, y se valida antes de salir.
//   · Un fallo se clasifica: permanente (no se reintenta) o transitorio (la base reintenta con espera creciente).
//   · Si el correo salió y la confirmación a la base falla, NO se vuelve a marcar como error (eso provocaría un
//     reenvío); además cada correo lleva una clave de idempotencia que el puente de Apps Script respeta.
import { AVISOS, correo } from './plantillas.mjs';

export const MODOS = ['apagado', 'prueba', 'produccion'];
const RE_CORREO = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;
const MAX_ASUNTO = 200;
const MAX_HTML = 120000;

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const vacio = (v) => v == null || String(v).trim() === '';

export function marcadores(texto) {
  return [...String(texto).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
}

/** Rellena {{marcador}}. Un marcador sin dato queda en «—» (solo puede pasar en asunto/párrafos, que usan datos garantizados). */
export function rellenar(texto, datos, escapar) {
  return String(texto).replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => {
    const v = vacio(datos[k]) ? '—' : datos[k];
    return escapar ? esc(v) : String(v);
  });
}

/** Una cabecera de correo no admite saltos de línea (inyección de cabeceras) ni longitudes absurdas. */
export function limpiarAsunto(s) {
  return String(s).replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_ASUNTO);
}

/** HTML + asunto de un aviso. Las filas de detalle cuyo dato no vino se omiten enteras. */
export function armar(tipo, nombre, datos, url, avisos = AVISOS, plantilla = correo) {
  const def = avisos[tipo];
  if (!def) throw Object.assign(new Error(`Tipo de aviso sin plantilla: ${tipo}`), { permanente: true });
  const ctx = { ...datos, nombre: String(nombre || '').trim().split(/\s+/)[0] || 'hola', enlace: url };
  const filas = (def.filas || []).filter(([, v]) => marcadores(v).every((m) => !vacio(ctx[m])));
  const html = rellenar(plantilla({ ...def, filas }), ctx, true);
  return { asunto: limpiarAsunto(rellenar(def.asunto, ctx, false)), html };
}

/** Enlace del correo: portal según el ROL de quien recibe + #ir/<pestaña>[/<objeto>/<id>].
 *  El portal exige sesión y la RLS decide qué se ve: el enlace no concede nada. */
export function urlAviso({ sitio, es_admin, tipo_miembro, destino, ref_tipo, ref_id }) {
  const portal = es_admin ? 'admin.html' : tipo_miembro === 'secretario' ? 'secretario.html' : 'user.html';
  const tab = /^[a-z_]{1,32}$/.test(destino || '') ? destino : 'inicio';
  const ref = /^[a-z_]{1,24}$/.test(ref_tipo || '') && /^[\w-]{1,64}$/.test(String(ref_id ?? '')) ? `/${ref_tipo}/${ref_id}` : '';
  return `${sitio}/${portal}#ir/${tab}${ref}`;
}

/** Lee y valida la configuración. Nunca lanza: devuelve `errores` y `listo`. */
export function leerConfig(env) {
  const get = (k) => String(env[k] ?? '').trim();
  const errores = [];
  const modoPedido = get('CORREO_MODO').toLowerCase();
  let modo = 'apagado';
  if (modoPedido) {
    if (MODOS.includes(modoPedido)) modo = modoPedido;
    else errores.push(`CORREO_MODO «${modoPedido}» no es válido (apagado | prueba | produccion): se queda en «apagado»`);
  }
  const sitio = (get('SITIO_URL') || 'https://eight-coms.vercel.app').replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+$/.test(sitio) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(sitio)) {
    errores.push('SITIO_URL debe ser https://… (o http://localhost en desarrollo)');
  } else if (modo === 'produccion' && !sitio.startsWith('https://')) {
    errores.push('En producción SITIO_URL debe ser https');
  }
  const puenteUrl = get('APPS_SCRIPT_URL'), puenteSecreto = get('APPS_SCRIPT_SECRET');
  const usuario = get('GMAIL_USER'), clave = get('GMAIL_APP_PASSWORD').replace(/\s+/g, '');
  const via = puenteUrl && puenteSecreto ? 'apps-script' : usuario && clave ? 'smtp' : null;
  if (puenteUrl && !puenteSecreto) errores.push('Falta APPS_SCRIPT_SECRET (hay APPS_SCRIPT_URL)');
  if (puenteUrl && !/^https:\/\/script\.google(usercontent)?\.com\//.test(puenteUrl)) errores.push('APPS_SCRIPT_URL debe ser una URL https://script.google.com/…');
  const destinoPrueba = get('CORREO_PRUEBA_DESTINO');
  if (destinoPrueba && !RE_CORREO.test(destinoPrueba)) errores.push('CORREO_PRUEBA_DESTINO no es un correo válido');
  if (modo === 'produccion' && !via) errores.push('Producción necesita un proveedor: APPS_SCRIPT_URL + APPS_SCRIPT_SECRET (o GMAIL_USER + GMAIL_APP_PASSWORD)');
  return {
    modo, sitio, via, puenteUrl, puenteSecreto, usuario, clave,
    destinoPrueba: RE_CORREO.test(destinoPrueba) ? destinoPrueba : '',
    errores,
    // «listo» = la función puede reclamar avisos. Apagado no toca la cola; producción sin proveedor tampoco.
    listo: modo === 'prueba' || (modo === 'produccion' && !!via && errores.length === 0),
  };
}

/** Validación de lo que va a salir. Un fallo aquí es permanente: reintentar no lo arregla. */
export function validarEnvio({ para, asunto, html }) {
  const e = (m) => Object.assign(new Error(m), { permanente: true });
  if (!RE_CORREO.test(String(para || ''))) throw e('Destinatario no válido');
  if (!asunto || asunto.length > MAX_ASUNTO || /[\r\n]/.test(asunto)) throw e('Asunto no válido');
  if (!html || html.length > MAX_HTML) throw e('Contenido no válido');
}

const PERMANENTES = /Destinatario no válido|Asunto no válido|Contenido no válido|No autorizado|Falta la propiedad|Dominio no permitido/i;

/** Proveedor «puente de Apps Script». `clave` viaja como idempotencia: el script no reenvía lo ya enviado. */
export function crearPuente(cfg, fetchFn = fetch) {
  return async function viaPuente({ para, asunto, html, clave }) {
    const r = await fetchFn(cfg.puenteUrl, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secreto: cfg.puenteSecreto, to: para, subject: asunto, html, clave }),
    });
    const texto = await r.text();
    let j;
    try { j = JSON.parse(texto); } catch { throw new Error(`Respuesta inesperada del puente (${r.status}): ${texto.slice(0, 120)}`); }
    if (!j.ok) {
      const msg = j.error || 'El puente rechazó el envío';
      throw Object.assign(new Error(msg), { permanente: PERMANENTES.test(msg) });
    }
    return { duplicado: !!j.duplicado };
  };
}

async function conPool(items, limite, fn) {
  const cola = [...items];
  await Promise.all(Array.from({ length: Math.min(limite, cola.length) }, async () => {
    while (cola.length) await fn(cola.shift());
  }));
}

/**
 * Procesa un lote ya reclamado.
 *   enviar(msg)  → envía por el proveedor (lanza si falla; `permanente` en el error si no vale reintentar)
 *   marcar(id, error, modo, permanente, via) → registra el resultado en la base
 */
export async function procesarLote({ lote, cfg, enviar, marcar, concurrencia = 4, espera = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const res = { enviados: 0, simulados: 0, fallidos: 0, permanentes: 0, sinConfirmar: 0 };
  const modoMarca = cfg.modo === 'prueba' ? 'prueba' : 'produccion';

  async function confirmar(id, via) {
    for (let i = 0; i < 3; i++) {
      try { await marcar(id, null, modoMarca, false, via); return true; }
      catch { await espera(200 * (i + 1)); }
    }
    return false;
  }

  await conPool(lote, concurrencia, async (n) => {
    let salio = false, via = cfg.via || 'sin-proveedor';
    try {
      const url = urlAviso({ sitio: cfg.sitio, es_admin: n.es_admin, tipo_miembro: n.tipo_miembro, destino: n.destino, ref_tipo: n.ref_tipo, ref_id: n.ref_id });
      const { asunto, html } = armar(n.tipo, n.nombre, n.datos || {}, url);
      validarEnvio({ para: n.email, asunto, html });
      if (cfg.modo === 'prueba') {
        via = 'prueba';
        if (cfg.destinoPrueba && enviar) {
          // Nunca al destinatario real: a la dirección de pruebas, con el asunto marcado.
          await enviar({ para: cfg.destinoPrueba, asunto: limpiarAsunto(`[PRUEBA → ${n.email}] ${asunto}`), html, clave: `prueba-${n.id}-${n.intento}` });
          via = `prueba+${cfg.via}`;
        }
      } else {
        await enviar({ para: n.email, asunto, html, clave: `n${n.id}` });
      }
      salio = true;
      if (await confirmar(n.id, via)) { cfg.modo === 'prueba' ? res.simulados++ : res.enviados++; }
      else res.sinConfirmar++;
    } catch (e) {
      if (salio) { res.sinConfirmar++; return; }   // ya salió: marcarlo como error provocaría un reenvío
      const permanente = !!e.permanente;
      res.fallidos++; if (permanente) res.permanentes++;
      try { await marcar(n.id, String(e.message || e).slice(0, 500), modoMarca, permanente, via); } catch { /* la base lo reintentará al vencer el arrendamiento */ }
    }
  });
  return res;
}
