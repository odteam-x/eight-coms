// Pruebas de core/cierre.js: las dos listas de verificación (solo lectura) y su regla de «omitir lo que no se pudo comprobar».
import fs from 'node:fs';
import vm from 'node:vm';
const ROOT = new URL('../../', import.meta.url);
const src = fs.readFileSync(new URL('core/cierre.js', ROOT), 'utf8');
const ctx = { window: {}, escHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') };
vm.createContext(ctx); vm.runInContext(src, ctx); vm.runInContext('globalThis.Cierre = Cierre', ctx);
const C = ctx.Cierre;
let n = 0, mal = 0;
const ok = (c, t) => { n++; if (c) console.log('  ✓ ' + t); else { mal++; console.log('  ✗ ' + t); } };
const por = (l, id) => l.find(f => f.id === id);

const pe = { id: 'p1', nombre: 'PE2', fecha_inicio: '2026-10-26', fecha_fin_trabajo: '2026-11-20', fecha_entrega: '2026-11-25', fecha_jornada: '2026-12-03' };
const users = [
  { id: 'a', aprobado: true, rol_id: 1, distrito: '08-01' }, { id: 'b', aprobado: true, rol_id: 2, distrito: '08-02' },
  { id: 'c', aprobado: true, rol_id: null, distrito: null }, { id: 'adm', es_admin: true, aprobado: true }, { id: 'p', aprobado: false },
];
console.log('[cierre del período]');
let l = C.cierre({ pe, users, inactivos: new Set(), v2: true, reglas: { confirmado: false }, porRevisar: 2, evaluaciones: [{ evaluado_id: 'a', estado: 'publicado' }, { evaluado_id: 'b', estado: 'borrador' }],
  distritos: [{ id: '08-01' }, { id: '08-02' }], estadisticas: [{ distrito_id: '08-01' }], evalsDistrito: [{ distrito_id: '08-01', estado: 'publicado' }] });
ok(por(l, 'fechas').ok === true, 'fechas completas → listo');
ok(por(l, 'reglas').ok === false, 'reglas sin confirmar → pendiente');
ok(por(l, 'revisar').ok === false && /2 entregas esperan/.test(por(l, 'revisar').detalle), 'entregas por revisar: 2 → pendiente y lo dice');
ok(por(l, 'evaluaciones').ok === false && /2 de 3/.test(por(l, 'evaluaciones').detalle), 'evaluaciones: 2 de 3 personas sin publicar (la administración y la no aprobada no cuentan)');
ok(por(l, 'estadisticas').ok === false && /1 de 2/.test(por(l, 'estadisticas').detalle), 'estadísticas: falta 1 de 2 distritos');
ok(por(l, 'eval-distritos').ok === false, 'evaluación de distrito: falta uno');
ok(l.every(f => f.tab && f.cta), 'cada fila lleva su destino y su botón');
const inactivos = new Set(['c']);
l = C.cierre({ pe, users, inactivos, v2: true, reglas: { confirmado: true }, porRevisar: 0, evaluaciones: [{ evaluado_id: 'a', estado: 'publicado' }, { evaluado_id: 'b', estado: 'publicado' }], distritos: [], estadisticas: [], evalsDistrito: [] });
ok(l.every(f => f.ok), 'todo en regla (y quien no participa no cuenta) → todo listo');
ok(!por(l, 'estadisticas'), 'sin distritos no se afirma nada de estadísticas');
l = C.cierre({ pe, users, inactivos, v2: true, reglas: null, porRevisar: null, evaluaciones: [], distritos: [{ id: 'x' }], estadisticas: null, evalsDistrito: null });
ok(!por(l, 'reglas') && !por(l, 'revisar') && !por(l, 'estadisticas') && !por(l, 'eval-distritos'), 'lo que no se pudo comprobar se OMITE (no se afirma)');
l = C.cierre({ pe: { ...pe, fecha_jornada: null, fecha_entrega: null }, users, inactivos, v2: false, evaluaciones: [] });
ok(por(l, 'fechas').ok === false && /Faltan 2/.test(por(l, 'fechas').detalle), 'faltan 2 fechas');
ok(!por(l, 'reglas') && !por(l, 'revisar'), 'período clásico: sin reglas de tareas ni entregas');
ok(C.cierre({ users }).length === 0, 'sin período no hay lista');

console.log('\n[preparar la evaluación]');
const roles = [{ id: 1, nombre: 'Fotografía' }, { id: 2, nombre: 'Redacción' }];
l = C.preparar({ pe, users, roles, v2: true, reglas: { confirmado: true }, perfilVigente: r => (r === 1 ? { id: 'pf' } : null) });
ok(por(l, 'rol').ok === false && /1 persona aprobada no tiene rol/.test(por(l, 'rol').detalle), 'una persona sin rol');
ok(por(l, 'distrito').ok === false, 'una persona sin distrito');
ok(por(l, 'perfiles').ok === false && /Redacción/.test(por(l, 'perfiles').detalle) && !/Fotografía/.test(por(l, 'perfiles').detalle), 'Redacción no tiene perfil vigente; Fotografía sí');
ok(por(l, 'reglas').ok === true, 'reglas confirmadas');
l = C.preparar({ pe, users: users.filter(u => u.id === 'a'), roles, v2: true, reglas: { confirmado: true }, perfilVigente: () => ({}) });
ok(l.every(f => f.ok), 'todo preparado → todo listo');
ok(C.resumen(l).ok === C.resumen(l).total, 'resumen: todos listos');

console.log('\n[pintado]');
const h = C.html(C.cierre({ pe, users, inactivos: new Set(), v2: false, evaluaciones: [] }), { titulo: 'Cierre de <PE2>', plegable: true });
ok(/Cierre de &lt;PE2&gt;/.test(h) && !/<PE2>/.test(h), 'el título pasa por escHtml');
ok(/data-act="tabSinBtn"/.test(h) && /class="cr-det"/.test(h), 'botón por acción y detalle plegable');
ok(!/border-left/.test((fs.readFileSync(new URL('vidrio.css', ROOT), 'utf8').split('/* 41.')[1] || '')), 'los estilos no usan barra de acento en un borde');
ok(C.html([], {}) === '', 'lista vacía → nada que pintar');
console.log('\n' + (n - mal) + ' correctas, ' + mal + ' fallidas'); process.exit(mal ? 1 : 0);
