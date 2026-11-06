// Tablero «Qué me toca» (core/pendientes.js): agrupación por estado y fecha, textos de plazo, filtros y cableado.
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const leer = f => fs.readFileSync(path.join(R, f), 'utf8');
let ok = 0, mal = 0; const t = (n, c) => { if (c) { ok++; console.log('  ✓ ' + n); } else { mal++; console.log('  ✗ ' + n); } };

const ctx = vm.createContext({ escHtml: s => String(s), renderIconos() {}, showToast() {}, window: { matchMedia: () => ({ matches: false }) }, document: {}, API: {}, Tareas: { ESTADOS: { asignada: { txt: 'Asignada' }, devuelta: { txt: 'Devuelta' } } }, console });
vm.runInContext(leer('core/pendientes.js') + '\nthis.P = Pendientes;', ctx);
const P = ctx.P;
const dia = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const T = (estado, n) => ({ estado, fecha: n == null ? null : dia(n) });

console.log('[agrupación]');
t('devuelta → por corregir (aunque esté vencida)', P.grupoDe(T('devuelta', -3)) === 'corregir');
t('abierta con fecha pasada → vencidas', P.grupoDe(T('en_curso', -1)) === 'vencidas');
t('hoy y 7 días → esta semana', P.grupoDe(T('asignada', 0)) === 'semana' && P.grupoDe(T('asignada', 7)) === 'semana');
t('8 días o sin fecha → más adelante', P.grupoDe(T('asignada', 8)) === 'despues' && P.grupoDe(T('asignada', null)) === 'despues');
t('bloqueada NO es vencida (está esperando a otra persona)', P.grupoDe(T('bloqueada', -5)) === 'pausa');
t('entregada → en revisión', P.grupoDe(T('entregada', -5)) === 'revision');

console.log('[plazo dicho como persona]');
t('vencida hace 2 días', P.cuando(T('asignada', -2)).txt === 'Vencida hace 2 días' && P.cuando(T('asignada', -2)).cls === 'vencida');
t('hoy / mañana son «pronto»', P.cuando(T('asignada', 0)).txt === 'Vence hoy' && P.cuando(T('asignada', 1)).txt === 'Vence mañana' && P.cuando(T('asignada', 1)).cls === 'pronto');
t('en 4 días', P.cuando(T('asignada', 4)).txt === 'En 4 días');
t('sin fecha', P.cuando(T('asignada', null)).txt === 'Sin fecha límite');

console.log('[filtros]');
t('«vencidas» incluye una devuelta ya vencida', P.pasa('vencidas', T('devuelta', -1)) === true);
t('«vencidas» no incluye bloqueadas ni entregadas', !P.pasa('vencidas', T('bloqueada', -1)) && !P.pasa('vencidas', T('entregada', -1)));
t('«semana» incluye 0..7', P.pasa('semana', T('asignada', 0)) && P.pasa('semana', T('asignada', 7)) && !P.pasa('semana', T('asignada', 8)) && !P.pasa('semana', T('asignada', -1)));

console.log('[normalizar]');
const n = P.normalizar([{ id: 'a', titulo: 'x', estado: 'asignada', fecha_limite: dia(2) }, { id: 'b', titulo: 'y', estado: 'aprobada' }], [{ id: 'c', titulo: 'z', estado: 'en_curso', fecha_limite: dia(3), equipo_nombre: 'Foto', soy_participante: true }, { id: 'd', titulo: 'w', estado: 'asignada', soy_participante: false }]);
t('solo abiertas/entregadas; las aprobadas no', n.length === 2);
t('de equipo solo si soy participante', n.some(x => x.tipo === 'e' && x.id === 'c') && !n.some(x => x.id === 'd'));

console.log('[cableado]');
for (const h of ['user.html', 'secretario.html']) {
  const s = leer(h);
  t(h + ': carga pendientes.js y pendientes.css', s.includes('core/pendientes.js') && s.includes('pendientes.css') && s.includes('id="pendientes-host"'));
  t(h + ': pendientes.js va después de tareas.js y equipos.js', s.indexOf('core/pendientes.js') > s.indexOf('core/equipos.js') && s.indexOf('core/equipos.js') > s.indexOf('core/tareas.js'));
}
t('el detalle de tareas va en un <details id=pd-detalle> en las dos páginas', leer('user.html').includes('id="pd-detalle"') && leer('secretario.html').includes('id="pd-detalle"') && leer('core/pendientes.js').includes("getElementById('pd-detalle')"));
t('ACCIONES.pd registrada', /pd:\s+\(a, el\) => Pendientes\.accion/.test(leer('config.js')));
t('las tarjetas de equipo llevan data-tarea-eq (destino del salto)', leer('core/equipos.js').includes('data-tarea-eq='));
t('pendientes.css: sin colores hex', !/#[0-9a-fA-F]{3,8}\b/.test(leer('pendientes.css').replace(/\/\*[\s\S]*?\*\//g, '')));
t('pendientes.js: nada de onclick ni handlers inline', !/\bon(click|input|change)=/.test(leer('core/pendientes.js')));
console.log(`\n${ok} correctas, ${mal} fallidas`); process.exit(mal ? 1 : 0);
