// Pruebas de la pantalla Auditoría (core/auditoria.js): se pinta con la API simulada; todo texto de la base se escapa;
// sin la migración 0055 lo dice; filtros, páginas y que sea solo lectura y solo del administrador.
import fs from 'node:fs';
import vm from 'node:vm';
const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rd = f => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };

const llamadas = [];
let respuesta = { ok: true, rows: [], total: 0 };
const cuerpo = { innerHTML: '' }, host = { innerHTML: '' };
const els = { 'aud-cuerpo': cuerpo };
const ctx = vm.createContext({
  console, Intl, setTimeout, clearTimeout, Date,
  document: { getElementById: id => els[id] || null },
  renderCargando: c => { c.innerHTML = '<cargando>'; }, renderError: (c, m) => { c.innerHTML = '<error>' + m; }, renderIconos: () => {},
  API: { getAuditoria: async a => { llamadas.push(a); return respuesta; } },
});
vm.runInContext(rd('config.js').match(/function escHtml\(s\) \{[\s\S]*?\n\}/)[0] + '\n' + rd('core/auditoria.js') + '\nglobalThis.__A = Auditoria; globalThis.__f = audFiltro;', ctx);
const A = ctx.__A;
const esp = () => new Promise(r => setTimeout(r, 30));

const fila = (o = {}) => ({ total: 120, creado_en: '2026-11-07T16:57:57Z', origen: 'Evaluaciones', accion: 'evaluacion_rectificada', actor_id: 'u1', actor_nombre: 'Admin General',
  objeto: 'Evaluación de Ana · PE2', resumen: 'Versión 2', motivo: 'Error de digitación', detalle: { antes: { puntajes: { a: 3 } }, despues: { puntajes: { a: 4 } } }, ...o });

console.log('[lista]');
respuesta = { ok: true, rows: [fila(), fila({ accion: 'persona_cambio', origen: 'Personas', actor_nombre: null, actor_id: null, motivo: null, detalle: null })], total: 120 };
A.montar(host); await esp();
const h = cuerpo.innerHTML;
ok(/Evaluación rectificada/.test(h) && /Cambió una persona/.test(h), 'las acciones salen en palabras, no como código');
ok(/Admin General/.test(h) && /Sin sesión \(mantenimiento\)/.test(h), 'quién; sin responsable se dice «sin sesión (mantenimiento)»');
ok(/Error de digitación/.test(h) && /Ver valores/.test(h) && /puntajes: a: 3/.test(h), 'motivo y valores anterior y nuevo');
ok(/Página 1 de 3 · 120 registros/.test(h), 'dice la página y el total (50 por página)');
ok(/data-act="aud" data-arg="ant" disabled/.test(h) && !/data-arg="sig" disabled/.test(h), 'en la primera página «Anterior» está deshabilitado');
ok(llamadas[0].limite === 50 && llamadas[0].offset === 0 && llamadas[0].origen === null, 'primera consulta: 50 filas desde 0, sin filtros');

console.log('\n[escape]');
respuesta = { ok: true, rows: [fila({ objeto: '<img src=x onerror=alert(1)>', motivo: '<script>alert(2)</script>', actor_nombre: '"><b>x</b>', resumen: '<i>r</i>', detalle: { antes: '<u>a</u>' } })], total: 1 };
A.montar(host); await esp();
ok(!/<img|<script|<b>x|<i>r|<u>a/.test(cuerpo.innerHTML) && /&lt;img/.test(cuerpo.innerHTML), 'objeto, motivo, responsable, resumen y valores se escapan');

console.log('\n[páginas y filtros]');
respuesta = { ok: true, rows: [fila()], total: 120 };
A.montar(host); await esp();
A.accion('sig'); await esp();
ok(llamadas.at(-1).offset === 50, '«Siguiente» pide desde la fila 50');
A.accion('sig'); await esp(); A.accion('ant'); await esp();
ok(llamadas.at(-1).offset === 50, '«Anterior» vuelve una página');
ctx.__f({ id: 'aud-origen', value: 'Tareas' }); await esp();
ok(llamadas.at(-1).origen === 'Tareas' && llamadas.at(-1).offset === 0, 'cambiar el origen filtra y vuelve a la página 1');
ctx.__f({ id: 'aud-desde', value: '2026-11-01' }); ctx.__f({ id: 'aud-hasta', value: '2026-11-07' }); await esp();
const ult = llamadas.at(-1);
ok(ult.desde === '2026-11-01T00:00:00' && ult.hasta === '2026-11-08T00:00:00', '«Hasta» incluye todo ese día (hasta el día siguiente a las 00:00)');
ctx.__f({ id: 'aud-q', value: ' digitación ' }); await new Promise(r => setTimeout(r, 400));
ok(llamadas.at(-1).buscar === 'digitación', 'el buscador espera a que se deje de escribir y recorta espacios');

console.log('\n[estados]');
respuesta = { ok: true, rows: [], total: 0 };
A.montar({ innerHTML: '' }); await esp();   // otro contenedor = filtros en blanco (el mismo contenedor los recuerda)
ok(/Todavía no hay acciones registradas/.test(cuerpo.innerHTML), 'sin registros: lo dice (sin filtros)');
ctx.__f({ id: 'aud-origen', value: 'Equipos' }); await esp();
ok(/No hay registros con esos filtros/.test(cuerpo.innerHTML), '...y con filtros dice que no hay con esos filtros');
respuesta = { ok: false, noDisponible: true, error: 'x' };
A.montar(host); await esp();
ok(/migración 0055/.test(cuerpo.innerHTML), 'sin 0055 dice qué migración falta (no finge que no hay nada)');
respuesta = { ok: false, error: 'falló la red' };
A.montar(host); await esp();
ok(/<error>falló la red/.test(cuerpo.innerHTML), 'un error de red se muestra como error con reintento');

console.log('\n[cableado y solo lectura]');
const adm = rd('admin.js'), cfg = rd('config.js'), html = rd('admin.html'), au = rd('core/auditoria.js');
ok(/tab:'auditoria'[^}]*Auditoría/.test(adm) && /auditoria:'auditoria'/.test(adm) && /Auditoria\.montar\(document\.getElementById\('auditoria-host'\)\)/.test(adm), 'admin.js: menú, pestaña padre y montaje');
ok(/id="tab-auditoria"/.test(html) && /core\/auditoria\.js/.test(html), 'admin.html: pestaña y script');
ok(!/auditoria/i.test(rd('user.html') + rd('secretario.html') + rd('user.js') + rd('secretario.js')), 'ni el miembro ni la secretaría la cargan ni la nombran');
ok(/'audFiltro'/.test(cfg) && /aud: +\(a\) +=> Auditoria\.accion\(a\)/.test(cfg), 'acciones registradas en config.js (lista blanca)');
ok(!/onclick|\.insert\(|\.update\(|\.delete\(|upsert/.test(au) && !/SB\./.test(au), 'solo lectura: sin onclick, sin escrituras ni consultas propias');
ok(/auditoria_listar/.test(rd('api.js')) && /getAuditoria/.test(rd('api.js')), 'API.getAuditoria llama a auditoria_listar');
ok(!/#[0-9a-fA-F]{3,8}\b/.test(rd('evolucion.css').slice(rd('evolucion.css').indexOf('Auditoría (core/auditoria.js)'))), 'estilos con tokens, sin hex');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
