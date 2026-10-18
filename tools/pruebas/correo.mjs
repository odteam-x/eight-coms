// Pruebas del envío de correo: núcleo puro (supabase/functions/enviar-notificaciones/nucleo.mjs) y su integración
// con la base real (PGlite): notif_reclamar / notif_marcar de 0040. NINGÚN correo sale de verdad: el proveedor es
// un doble de prueba que registra lo que recibiría. Esto prueba la LÓGICA de envío, no la entrega real por Gmail.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const R = DIR + '../../supabase/migrations/';
const FN = '../../supabase/functions/enviar-notificaciones/';
const N = await import(FN + 'nucleo.mjs');
const { AVISOS, correo } = await import(FN + 'plantillas.mjs');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };
const rechaza = async (f, patron, m) => { try { await f(); ok(false, m + ' (NO lanzó)'); } catch (e) { ok(!patron || new RegExp(patron, 'i').test(e.message), m + ' → ' + e.message.slice(0, 70)); } };

// ───────────────────────── configuración ─────────────────────────
console.log('[configuración: por defecto NO se envía nada]');
let c = N.leerConfig({});
ok(c.modo === 'apagado' && c.listo === false, 'sin CORREO_MODO el modo es «apagado» y no reclama nada');
c = N.leerConfig({ APPS_SCRIPT_URL: 'https://script.google.com/macros/s/x/exec', APPS_SCRIPT_SECRET: 's'.repeat(30) });
ok(c.modo === 'apagado' && !c.listo && c.via === 'apps-script', 'con proveedor configurado pero sin CORREO_MODO tampoco envía (nada por accidente)');
c = N.leerConfig({ CORREO_MODO: 'prod' });
ok(c.modo === 'apagado' && c.errores.some(e => /no es válido/.test(e)), 'un modo mal escrito cae a «apagado» y lo dice');
c = N.leerConfig({ CORREO_MODO: 'prueba' });
ok(c.listo && c.modo === 'prueba' && c.via === null, 'prueba funciona sin proveedor (solo simula)');
c = N.leerConfig({ CORREO_MODO: 'produccion' });
ok(!c.listo && c.errores.some(e => /proveedor/.test(e)), 'producción sin proveedor: no listo, con el motivo');
c = N.leerConfig({ CORREO_MODO: 'produccion', APPS_SCRIPT_URL: 'https://script.google.com/macros/s/x/exec', APPS_SCRIPT_SECRET: 'abc' });
ok(c.listo && c.via === 'apps-script' && c.errores.length === 0, 'producción con el puente: listo');
c = N.leerConfig({ CORREO_MODO: 'produccion', GMAIL_USER: 'a@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' });
ok(c.listo && c.via === 'smtp' && c.clave === 'abcdefghijklmnop', 'producción con SMTP: listo (la contraseña de aplicación se limpia de espacios)');
c = N.leerConfig({ CORREO_MODO: 'produccion', APPS_SCRIPT_URL: 'https://evil.example.com/x', APPS_SCRIPT_SECRET: 'abc' });
ok(!c.listo && c.errores.some(e => /script\.google\.com/.test(e)), 'el puente solo acepta URLs de script.google.com');
c = N.leerConfig({ CORREO_MODO: 'produccion', APPS_SCRIPT_URL: 'https://script.google.com/macros/s/x/exec' });
ok(!c.listo && c.errores.some(e => /APPS_SCRIPT_SECRET/.test(e)), 'URL del puente sin secreto: error claro');
c = N.leerConfig({ CORREO_MODO: 'produccion', SITIO_URL: 'http://eight-coms.vercel.app', APPS_SCRIPT_URL: 'https://script.google.com/macros/s/x/exec', APPS_SCRIPT_SECRET: 'abc' });
ok(!c.listo && c.errores.some(e => /SITIO_URL/.test(e)), 'SITIO_URL http no se admite en producción (los enlaces del correo deben ser https)');
c = N.leerConfig({ CORREO_MODO: 'prueba', SITIO_URL: 'http://localhost:3000/' });
ok(c.listo && c.sitio === 'http://localhost:3000', 'localhost sí vale en pruebas (se quita la barra final)');
c = N.leerConfig({ CORREO_MODO: 'prueba', CORREO_PRUEBA_DESTINO: 'no-es-correo' });
ok(c.destinoPrueba === '' && c.errores.some(e => /CORREO_PRUEBA_DESTINO/.test(e)), 'un destino de prueba inválido se ignora y se avisa');

// ───────────────────────── plantillas ─────────────────────────
console.log('\n[plantillas: escape, filas opcionales, cabeceras]');
const url = N.urlAviso({ sitio: 'https://eight-coms.vercel.app', es_admin: false, tipo_miembro: 'miembro', destino: 'trabajos', ref_tipo: 'tarea', ref_id: '12' });
ok(url === 'https://eight-coms.vercel.app/user.html#ir/trabajos/tarea/12', 'enlace: portal del rol + #ir/pestaña/objeto/id → ' + url);
ok(N.urlAviso({ sitio: 'https://s', es_admin: true, destino: 'tareas', ref_tipo: 'tarea', ref_id: '7' }).startsWith('https://s/admin.html#ir/tareas'), 'la administración va a admin.html');
ok(N.urlAviso({ sitio: 'https://s', es_admin: false, tipo_miembro: 'secretario', destino: 'tareas' }) === 'https://s/secretario.html#ir/tareas', 'la secretaría va a secretario.html; sin objeto, solo la pestaña');
ok(N.urlAviso({ sitio: 'https://s', destino: '"><script>', ref_tipo: 'tarea', ref_id: '1"><b>' }) === 'https://s/user.html#ir/inicio', 'un destino o un id con caracteres raros se descartan (el enlace no se puede contaminar)');
let r = N.armar('tarea_asignada', 'Ana María Pérez', { tarea: '<img src=x onerror=alert(1)>', asignador: 'Sec1', fecha_limite: '25/10/2026' }, url);
ok(!r.html.includes('<img src=x') && r.html.includes('&lt;img src=x'), 'un título con HTML llega escapado al correo');
ok(r.html.includes('Hola Ana,') , 'el saludo usa el nombre de pila de quien recibe');
ok(!r.html.includes('{{') && !r.html.includes('Prioridad'), 'sin marcadores sueltos; la fila «Prioridad» (sin dato) se omite entera');
ok(r.html.includes('Asignada por') && r.html.includes('25/10/2026'), 'las filas con dato se muestran');
ok(r.html.includes(`href="${url}"`) && r.html.includes('eight-coms.vercel.app'), 'el botón lleva el enlace a la pantalla del portal');
r = N.armar('tarea_asignada', 'X', { tarea: 'Normal\r\nBcc: espia@x.com', nombre: 'Falso' }, url);
ok(!/[\r\n]/.test(r.asunto) && r.html.includes('Hola X,'), 'un salto de línea en el título no inyecta cabeceras y un dato «nombre» no pisa el saludo');
r = N.armar('calificacion_nueva', 'Ana', { periodo: 'PE1', puntajes: { pla: 4 }, nota: 7 }, url);
ok(!r.html.includes('[object Object]') && !r.html.includes('puntajes') && !r.html.includes('"pla"'), 'el correo de calificación no puede llevar puntajes aunque se los pasen');
await rechaza(async () => N.armar('inventado', 'X', {}, url), 'sin plantilla', 'un tipo sin plantilla falla (permanente)');
try { N.armar('inventado', 'X', {}, url); } catch (e) { ok(e.permanente === true, '… y se marca permanente (no se reintenta)'); }

const m40 = fs.readFileSync(R + '0040_notificaciones_integral.sql', 'utf8');
const ejemplo = { tarea: 'Reel', persona: 'Beto', elemento: 'Reel', cambio: 'Fecha límite', observacion: 'Falta audio', periodo: 'PE1', cierre: '30/10/2026', pendientes: 3, equipo: 'Foto', cuando: 'hoy', actividad: 'Taller', fecha: '02/11/2026' };

// ───────────────────────── base de datos ─────────────────────────
const db = new PGlite();
const q = async s => (await db.query(s)).rows;
const as = async (uid, role = 'authenticated') => { await db.exec('RESET ROLE'); await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid ?? ''}',false)`); await db.exec(`SET ROLE ${role}`); };
const root = async () => { await db.exec('RESET ROLE'); await db.exec(`SELECT set_config('request.jwt.claim.sub','',false)`); };
const uid = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const ADMIN = uid(90), SEC1 = uid(91), M1 = uid(1), M2 = uid(2), M3 = uid(3), M4 = uid(4);
const m19 = fs.readFileSync(R + '0019_notificaciones.sql', 'utf8');
const fn19 = nombre => { const ini = m19.indexOf(`CREATE OR REPLACE FUNCTION public.${nombre}(`); const a = m19.indexOf('$$', ini), b = m19.indexOf('$$', a + 2); return m19.slice(ini, m19.indexOf(';', b) + 1); };
await db.exec(fs.readFileSync(DIR + 'stub.sql', 'utf8'));
await db.exec(`
  CREATE ROLE service_role NOLOGIN; GRANT USAGE ON SCHEMA public TO service_role;
  ALTER TABLE public.profiles ADD COLUMN aprobado BOOLEAN DEFAULT true;
  CREATE TABLE public.config (gestion_id BIGINT, clave TEXT, valor TEXT, PRIMARY KEY (gestion_id, clave));
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
  INSERT INTO profiles(id,nombre,email,es_admin) VALUES ('${ADMIN}','Admin','admin@x.cl',true);
  INSERT INTO profiles(id,nombre,email,tipo_miembro,distrito) VALUES ('${SEC1}','Sec1','s1@x.cl','secretario','08-01');
  INSERT INTO profiles(id,nombre,email,distrito) VALUES ('${M1}','Ana Pérez','m1@x.cl','08-01'),('${M2}','Beto','m2@x.cl','08-01'),('${M3}','Carla','m3@x.cl','08-01'),('${M4}','Dani','m4@x.cl','08-01');`);
await db.exec(m19.match(/CREATE TABLE IF NOT EXISTS public\.notificaciones \([\s\S]*?\n\);/)[0] + `ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.notificaciones FROM anon, authenticated;`);
for (const f of ['notif_fecha', 'notif_zona', 'notif_encolar', 'notif_reclamar', 'notif_marcar']) await db.exec(fn19(f));
await db.exec(m40);
const cat = await q(`SELECT tipo, claves, requeridas FROM notif_tipos ORDER BY tipo`);

console.log('\n[el catálogo (SQL) y las plantillas (JS) no se pueden desincronizar]');
ok(cat.every(t => AVISOS[t.tipo]) && Object.keys(AVISOS).every(k => cat.some(t => t.tipo === k)), `los ${cat.length} tipos del catálogo tienen plantilla y no sobra ninguna`);
for (const t of cat) {
  const def = AVISOS[t.tipo];
  const usados = new Set([...N.marcadores(def.asunto), ...N.marcadores(def.preheader), ...def.parrafos.flatMap(N.marcadores)]);
  const sueltos = [...usados].filter(m => !['nombre', 'enlace'].includes(m) && !t.requeridas.includes(m));
  ok(sueltos.length === 0, `${t.tipo}: asunto/preheader/párrafos solo usan datos garantizados${sueltos.length ? ' — SUELTOS: ' + sueltos.join(',') : ''}`);
  const filas = (def.filas || []).flatMap(([, v]) => N.marcadores(v));
  const ajenos = filas.filter(m => !t.claves.includes(m));
  ok(ajenos.length === 0, `${t.tipo}: toda fila usa una clave de la lista blanca${ajenos.length ? ' — AJENAS: ' + ajenos.join(',') : ''}`);
  const dat = Object.fromEntries(t.claves.map(k => [k, ejemplo[k] ?? 'dato-' + k]));
  const out = N.armar(t.tipo, 'Ana Pérez', dat, url);
  if (/\{\{|undefined|\[object/.test(out.html + out.asunto)) ok(false, `${t.tipo}: queda un marcador sin resolver`);
}
ok(cat.length === 20, 'el catálogo y las plantillas siguen siendo 20');

// ───────────────────────── doble de proveedor ─────────────────────────
const nuevoProveedor = ({ fallaCon = {}, dormir = 0 } = {}) => {
  const enviados = [];
  const enviar = async (m) => {
    if (dormir) await new Promise(r => setTimeout(r, dormir));
    for (const [dir, err] of Object.entries(fallaCon)) if (m.para === dir) throw err;
    enviados.push(m);
    return {};
  };
  return { enviar, enviados };
};
const marcarDB = async (id, err, modo, perm, via) => { await db.query(`SELECT notif_marcar($1,$2,$3,$4,$5)`, [id, err, modo, perm, via]); };
const lote = async (max = 25) => { await as(null, 'service_role'); const l = (await db.query(`SELECT * FROM notif_reclamar(${max})`)).rows; await root(); return l; };
const sembrar = async (d, t, datos, k, ref = null) => (await q(`SELECT notif_encolar('${d}','${t}','${JSON.stringify(datos)}'::jsonb,'${k}', now(), NULL, ${ref ? `'${ref}'` : 'NULL'}) id`))[0].id;
const estado = async id => (await q(`SELECT correo_estado, correo_motivo, intentos, enviada_en, extract(epoch FROM enviar_despues - now())/60 AS espera FROM notificaciones WHERE id=${id}`))[0];
const cfgProd = { modo: 'produccion', sitio: 'https://eight-coms.vercel.app', via: 'apps-script' };
const cfgPrueba = { modo: 'prueba', sitio: 'https://eight-coms.vercel.app', via: 'apps-script', destinoPrueba: '' };

console.log('\n[modo prueba: NUNCA sale un correo al destinatario real]');
await root();
const p1 = await sembrar(M1, 'tarea_asignada', { tarea: 'Prueba 1' }, 'pr1');
const p2 = await sembrar(M2, 'tarea_asignada', { tarea: 'Prueba 2' }, 'pr2');
let prov = nuevoProveedor();
let res = await N.procesarLote({ lote: await lote(), cfg: cfgPrueba, enviar: prov.enviar, marcar: marcarDB });
ok(prov.enviados.length === 0, 'en prueba sin destino de pruebas, el proveedor no recibe NADA');
ok(res.simulados === 2 && res.enviados === 0, 'se cuentan como simulados, no como enviados');
ok((await estado(p1)).correo_estado === 'simulado' && (await estado(p1)).enviada_en === null, 'en la base quedan «simulado», sin fecha de envío');
const p3 = await sembrar(M3, 'tarea_asignada', { tarea: 'Prueba 3' }, 'pr3');
prov = nuevoProveedor();
await N.procesarLote({ lote: await lote(), cfg: { ...cfgPrueba, destinoPrueba: 'qa@mio.cl' }, enviar: prov.enviar, marcar: marcarDB });
ok(prov.enviados.length === 1 && prov.enviados[0].para === 'qa@mio.cl' && prov.enviados[0].asunto.startsWith('[PRUEBA → m3@x.cl]'), 'con destino de pruebas, sale SOLO a esa dirección y el asunto dice a quién habría ido');
ok(!prov.enviados.some(m => /@x\.cl$/.test(m.para)), 'ningún mensaje a un destinatario real');
ok((await estado(p3)).correo_estado === 'simulado', '… y sigue contando como simulado');
const p4 = await sembrar(M4, 'tarea_asignada', { tarea: 'Prueba 4' }, 'pr4');
prov = nuevoProveedor();
await N.procesarLote({ lote: await lote(), cfg: { ...cfgPrueba, destinoPrueba: 'qa@mio.cl' }, enviar: null, marcar: marcarDB });
ok((await estado(p4)).correo_estado === 'simulado', 'destino de pruebas pero sin proveedor: se simula sin romper');

console.log('\n[producción: envío real, una vez, y registro del resultado]');
const a = await sembrar(M1, 'tarea_asignada', { tarea: 'Real A', asignador: 'Sec1' }, 'pd1', '55');
const b = await sembrar(M2, 'correccion_solicitada', { tarea: 'Real B', observacion: 'Falta audio' }, 'pd2', '56');
const e = await sembrar(ADMIN, 'solicitud_acceso', { persona: 'Nueva' }, 'pd3', '57');
prov = nuevoProveedor();
const l1 = await lote();
res = await N.procesarLote({ lote: l1, cfg: cfgProd, enviar: prov.enviar, marcar: marcarDB });
ok(res.enviados === 3 && prov.enviados.length === 3, 'se enviaron los 3, cada uno una vez');
ok(prov.enviados.find(m => m.para === 'admin@x.cl').html.includes('/admin.html#ir/usuarios/persona/'), 'el enlace de la administración va a admin.html#ir/usuarios');
ok(prov.enviados.find(m => m.para === 'm2@x.cl').html.includes('/user.html#ir/trabajos/tarea/'), 'el del miembro, a user.html#ir/trabajos/tarea/<id>');
ok(prov.enviados.every(m => /^n\d+$/.test(m.clave)), 'cada envío lleva su clave de idempotencia (n<id>)');
ok((await estado(a)).correo_estado === 'enviado' && (await estado(a)).enviada_en !== null, 'en la base: «enviado» con fecha');
prov = nuevoProveedor();
res = await N.procesarLote({ lote: await lote(), cfg: cfgProd, enviar: prov.enviar, marcar: marcarDB });
ok(prov.enviados.length === 0 && res.enviados === 0, 'una segunda pasada NO reenvía nada (sin duplicados)');

console.log('\n[errores de envío]');
const t1 = await sembrar(M1, 'tarea_asignada', { tarea: 'Transitorio' }, 'er1');
const t2 = await sembrar(M2, 'tarea_asignada', { tarea: 'Permanente' }, 'er2');
const t3 = await sembrar(M3, 'tarea_asignada', { tarea: 'Sano' }, 'er3');
prov = nuevoProveedor({ fallaCon: { 'm1@x.cl': new Error('Service invoked too many times for one day: email'), 'm2@x.cl': Object.assign(new Error('Destinatario no válido'), { permanente: true }) } });
res = await N.procesarLote({ lote: await lote(), cfg: cfgProd, enviar: prov.enviar, marcar: marcarDB });
ok(res.enviados === 1 && res.fallidos === 2 && res.permanentes === 1, 'un fallo no frena al resto: 1 enviado, 2 fallidos (1 permanente)');
let s1 = await estado(t1), s2 = await estado(t2);
ok(s1.correo_estado === 'pendiente' && s1.espera > 3 && /too many/.test((await q(`SELECT ultimo_error FROM notificaciones WHERE id=${t1}`))[0].ultimo_error), 'el transitorio queda pendiente, con espera (≈5 min) y su error guardado');
ok(s2.correo_estado === 'fallido', 'el permanente queda «fallido» de inmediato');
ok((await estado(t3)).correo_estado === 'enviado', 'el sano salió');
prov = nuevoProveedor();
await N.procesarLote({ lote: await lote(), cfg: cfgProd, enviar: prov.enviar, marcar: marcarDB });
ok(prov.enviados.length === 0, 'mientras dura la espera no se reintenta (ni el permanente jamás)');
await db.exec(`UPDATE notificaciones SET enviar_despues = now() WHERE id=${t1}`);
prov = nuevoProveedor();
await N.procesarLote({ lote: await lote(), cfg: cfgProd, enviar: prov.enviar, marcar: marcarDB });
ok(prov.enviados.length === 1 && prov.enviados[0].para === 'm1@x.cl' && (await estado(t1)).correo_estado === 'enviado', 'vencida la espera, el transitorio se reintenta y sale');

console.log('\n[validación antes de enviar]');
await db.exec(`UPDATE profiles SET email='no es un correo' WHERE id='${M4}'`);
const v1 = await sembrar(M4, 'tarea_asignada', { tarea: 'Dirección rota' }, 'va1');
prov = nuevoProveedor();
res = await N.procesarLote({ lote: await lote(), cfg: cfgProd, enviar: prov.enviar, marcar: marcarDB });
ok(prov.enviados.length === 0 && (await estado(v1)).correo_estado === 'fallido' && /no válido/.test((await estado(v1)).correo_motivo), 'una dirección inválida no llega al proveedor: queda «fallido» (permanente)');

console.log('\n[el correo salió pero la base no confirma: jamás se marca como error]');
const w1 = await sembrar(M2, 'tarea_asignada', { tarea: 'Sin confirmar' }, 'cf1');
prov = nuevoProveedor();
const llamadas = [];
res = await N.procesarLote({
  lote: await lote(), cfg: cfgProd, enviar: prov.enviar, espera: async () => {},
  marcar: async (id, err, modo, perm, via) => { llamadas.push({ id, err }); if (!err) throw new Error('red caída'); await marcarDB(id, err, modo, perm, via); },
});
ok(prov.enviados.length === 1 && res.sinConfirmar === 1 && res.fallidos === 0, 'se cuenta como «sin confirmar», no como fallido');
ok(llamadas.every(x => x.err === null), 'nunca se llamó a marcar con un error (eso habría programado un reenvío)');
ok(llamadas.length === 3, 'sí se reintentó 3 veces confirmar el éxito');
await root();
await db.exec(`UPDATE notificaciones SET enviar_despues = now() WHERE id=${w1}`);
prov = nuevoProveedor();
await N.procesarLote({ lote: await lote(), cfg: cfgProd, enviar: prov.enviar, marcar: marcarDB });
ok(prov.enviados.length === 1 && prov.enviados[0].clave === `n${w1}`, 'al vencer el arrendamiento se reenvía con la MISMA clave de idempotencia (el puente lo descarta como duplicado)');

console.log('\n[dos ejecuciones a la vez no duplican]');
const ids = [];
for (let i = 0; i < 6; i++) ids.push(await sembrar(M1, 'tarea_asignada', { tarea: 'Carrera ' + i }, 'ca' + i));
prov = nuevoProveedor({ dormir: 15 });
const [r1, r2] = await Promise.all([
  (async () => N.procesarLote({ lote: await lote(4), cfg: cfgProd, enviar: prov.enviar, marcar: marcarDB }))(),
  (async () => N.procesarLote({ lote: await lote(4), cfg: cfgProd, enviar: prov.enviar, marcar: marcarDB }))(),
]);
const porClave = {}; prov.enviados.forEach(m => porClave[m.clave] = (porClave[m.clave] || 0) + 1);
ok(prov.enviados.length === 6 && Object.values(porClave).every(n => n === 1), 'dos ejecuciones simultáneas enviaron los 6 avisos, cada uno exactamente una vez');

console.log('\n[preferencias]');
await root();
await db.exec(`UPDATE profiles SET email='m4@x.cl' WHERE id='${M4}'`);
await as(M1);
await db.exec(`SELECT guardar_preferencias_notif('{"tarea_por_vencer": false}')`);
await root();
const o1 = await sembrar(M1, 'tarea_por_vencer', { tarea: 'Opcional apagada', cuando: 'hoy' }, 'pf1');
const o2 = await sembrar(M1, 'tarea_vencida', { tarea: 'Esencial' }, 'pf2');
const o3 = await sembrar(M2, 'tarea_por_vencer', { tarea: 'Opcional de otra persona', cuando: 'mañana' }, 'pf3');
prov = nuevoProveedor();
await N.procesarLote({ lote: await lote(), cfg: cfgProd, enviar: prov.enviar, marcar: marcarDB });
ok(prov.enviados.map(m => m.para).sort().join() === 'm1@x.cl,m2@x.cl' && prov.enviados.length === 2, 'sale el esencial de M1 y el opcional de M2; el opcional apagado de M1 no');
ok((await estado(o1)).correo_estado === 'omitido' && (await estado(o1)).correo_motivo === 'preferencia', 'el omitido queda «omitido / preferencia» (y sigue en su campana)');
await as(M1);
ok((await q(`SELECT count(*)::int n FROM mis_notificaciones() WHERE tipo='tarea_por_vencer'`))[0].n === 1, 'el aviso omitido por preferencia SÍ aparece en la campana');
await root();

console.log('\n[puente de Apps Script]');
const cfgP = { puenteUrl: 'https://script.google.com/macros/s/x/exec', puenteSecreto: 'sec' };
let pedido;
const fake = (cuerpo, status = 200) => async (u, init) => { pedido = { u, init }; return { status, text: async () => cuerpo }; };
let puente = N.crearPuente(cfgP, fake('{"ok":true}'));
await puente({ para: 'a@x.cl', asunto: 'A', html: '<p>x</p>', clave: 'n1' });
const body = JSON.parse(pedido.init.body);
ok(body.secreto === 'sec' && body.to === 'a@x.cl' && body.clave === 'n1' && pedido.init.method === 'POST', 'el puente recibe secreto, destinatario, asunto, html y clave');
ok(!pedido.u.includes('sec') && !JSON.stringify(pedido.init.headers).includes('sec'), 'el secreto va en el cuerpo, no en la URL ni en cabeceras');
ok((await N.crearPuente(cfgP, fake('{"ok":true,"duplicado":true}'))({ para: 'a@x.cl', asunto: 'A', html: 'x', clave: 'n1' })).duplicado === true, 'un «duplicado» del puente se trata como éxito');
await rechaza(() => N.crearPuente(cfgP, fake('{"ok":false,"error":"Destinatario no válido"}'))({}), 'no válido', 'el puente rechaza una dirección');
try { await N.crearPuente(cfgP, fake('{"ok":false,"error":"Destinatario no válido"}'))({}); } catch (x) { ok(x.permanente === true, '… y es permanente'); }
try { await N.crearPuente(cfgP, fake('{"ok":false,"error":"Service invoked too many times"}'))({}); } catch (x) { ok(x.permanente === false, 'la cuota diaria agotada es transitoria (se reintenta)'); }
try { await N.crearPuente(cfgP, fake('<html>login de Google</html>', 200))({}); } catch (x) { ok(x.permanente === undefined && /inesperada/.test(x.message), 'una respuesta que no es JSON (p. ej. pide iniciar sesión) es un fallo transitorio con motivo claro'); }

console.log('\n[la campana (front) conoce todos los tipos del catálogo]');
const nf = fs.readFileSync(DIR + '../../core/notificaciones.js', 'utf8');
ok(cat.every(t => new RegExp('\\b' + t.tipo + ':\\s*\\{').test(nf)), 'core/notificaciones.js tiene icono y texto para los ' + cat.length + ' tipos (ninguno cae en «Aviso» genérico)');
for (const viejo of ['nota_publicada', 'nota_corregida', 'tarea_devuelta', 'plazo_movido', 'entrega_por_revisar']) ok(new RegExp(viejo + ':\\s*[\'"]').test(nf), 'y entiende el nombre anterior «' + viejo + '» (base sin 0040)');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
