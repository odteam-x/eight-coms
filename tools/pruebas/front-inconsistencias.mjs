// Pruebas del detector de inconsistencias de datos del Panel (core/personas.js · detectarInconsistencias; admin-personas.js).
import fs from 'node:fs';
import vm from 'node:vm';
const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rd = f => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };

const ctx = vm.createContext({ console, Intl, Fondo: { clase: () => 1 }, Avatar: {} });
vm.runInContext(rd('config.js').match(/function escHtml\(s\) \{[\s\S]*?\n\}/)[0] + '\n' + rd('core/personas.js') + '\nglobalThis.__D = detectarInconsistencias;', ctx);
const D = ctx.__D;
const u = (id, o = {}) => ({ id, nombre: id.toUpperCase(), es_admin: false, aprobado: true, rol_id: 1, distrito: '08-01', ...o });
const pe = (o = {}) => ({ nombre: 'PE2', activo: true, fecha_inicio: '2026-11-01', fecha_entrega: '2026-11-20', ...o });
const k = r => r.map(x => x.k).join(',');

console.log('[sin nada raro]');
ok(D({ users: [u('a'), u('b'), u('adm', { es_admin: true, rol_id: null, distrito: null })], evaluaciones: [{ evaluado_id: 'a', estado: 'publicado' }], periodo: pe() }).length === 0,
  'datos coherentes: ningún aviso (una administradora sin rol ni distrito es normal)');
ok(D().length === 0 && D({ users: null }).length === 0, 'sin datos: sin errores');

console.log('\n[personas a las que les falta un dato]');
let r = D({ users: [u('a', { rol_id: null }), u('b', { distrito: null }), u('c', { aprobado: false, rol_id: null }), u('d')], periodo: pe() });
ok(k(r) === 'sin_rol,sin_distrito', 'sin rol y sin distrito, cada aviso aparte');
ok(r[0].n === 1 && r[0].nombres[0] === 'A' && r[0].filtro === 'sin_rol', 'una persona con acceso pendiente no cuenta (aún no se evalúa), y el aviso lleva al filtro de Personas');

console.log('\n[contradicciones con la evaluación]');
r = D({ users: [u('a'), u('b'), u('adm', { es_admin: true }), u('p', { aprobado: false })],
  evaluaciones: [{ evaluado_id: 'a', estado: 'publicado' }, { evaluado_id: 'b', estado: 'borrador' }, { evaluado_id: 'adm', estado: 'publicado' }, { evaluado_id: 'p', estado: 'borrador' }],
  inactivos: new Set(['a', 'b']), periodo: pe() });
ok(r.find(x => x.k === 'eval_no_participa')?.n === 1, 'solo una evaluación PUBLICADA de alguien que «no participa» (un borrador no es contradicción)');
ok(r.find(x => x.k === 'eval_sin_acceso')?.n === 2, 'evaluaciones de una administradora y de alguien sin acceso aprobado');
ok(r.every(x => x.tab), 'cada aviso dice a dónde ir');

console.log('\n[período activo]');
ok(D({ users: [], periodo: pe({ fecha_entrega: null }) }).some(x => x.k === 'pe_sin_fechas' && /PE2/.test(x.txt)), 'el período activo sin fecha de entrega se avisa');
ok(D({ users: [], periodo: pe({ activo: false, fecha_inicio: null }) }).length === 0, 'un período que no está activo no se avisa');

console.log('\n[presentación]');
const src = rd('admin-personas.js');
ok(/detectarInconsistencias\(\{ users: _users, evaluaciones: evs, inactivos, periodo: pe \}\)/.test(src), 'el Panel lo calcula con los datos que ya cargó (sin consultas nuevas)');
// El componente compacto (0.2 de «Requiere atención») arma el destino con accion(), que escapa filtro/tab; los datos pasan por ella.
ok(/escHtml\(d\.txt\)/.test(src) && /escHtml\(d\.nombres\.slice\(0, \d\)\.join\(', '\)\)/.test(src)
  && /const accion = \(i\) => `data-act="\$\{i\.filtro \? 'personasFiltro' : 'tabSinBtn'\}" data-arg="\$\{escHtml\(i\.filtro \|\| i\.tab\)\}"`/.test(src)
  && /\$\{accion\(d\)\}/.test(src), 'texto, nombres y destino se escapan');
ok(/no corrigen ni cambian ninguna nota/.test(src), 'dice que solo avisa: no corrige nada');
const x = D({ users: [u('a', { rol_id: null, nombre: '<img src=x onerror=1>' })] });
ok(x[0].nombres[0] === '<img src=x onerror=1>', 'el detector devuelve el texto tal cual: es el que pinta quien lo escapa (escHtml) — aquí queda cubierto por la aserción anterior');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
