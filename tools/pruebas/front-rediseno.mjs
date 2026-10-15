import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = DIR + '../../';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };

const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── core/ui.js: primitivas de presentación, en un contexto con stubs ──
const ctx = {
  escHtml, renderIconos: () => {}, openModal: () => {}, closeModal: () => {}, console,
  window: { matchMedia: () => ({ matches: false }) }, document: { addEventListener: () => {} },
  performance: { now: () => 0 }, requestAnimationFrame: () => {},
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(ROOT + 'core/ui.js', 'utf8') + `
;globalThis.__u = { anilloHTML, deltaHTML, fmtNum, segHTML, textoDias, diasDesdeHoy, proximosHitos, lineaTiempoHTML, esqueletoHTML };`, ctx);
const U = ctx.__u;

console.log('[core/ui.js]');
ok(U.fmtNum(87.456) === '87.5' && U.fmtNum(null) === '—' && U.fmtNum(50, 0) === '50', 'fmtNum');
ok(U.anilloHTML({ valor: 70 }).includes('--p:0.7000') && !U.anilloHTML({ valor: 70 }).includes('anillo--vacio'), 'anillo: 70/100 = 0.7');
ok(U.anilloHTML({ valor: null }).includes('anillo--vacio') && U.anilloHTML({ valor: null }).includes('—'), 'anillo vacío sin dato');
ok(U.anilloHTML({ valor: 500, max: 100 }).includes('--p:1.0000'), 'anillo: el valor no pasa de 1');
ok(U.deltaHTML(70, 60).includes('delta--sube') && U.deltaHTML(60, 70).includes('delta--baja') && U.deltaHTML(5, 5).includes('delta--igual'), 'variación: sube / baja / igual');
ok(U.deltaHTML(null, 5) === '' && U.deltaHTML(5, undefined) === '', 'variación sin dato previo no pinta nada');
ok(!U.deltaHTML(70, 60, { ref: '<b>x</b>' }).includes('<b>x</b>'), 'variación: la referencia va escapada');
const seg = U.segHTML([{ k: 'a', etiqueta: '<i>' }], 'a', 'perfilTab');
ok(seg.includes('aria-selected="true"') && !seg.includes('<i>'), 'pestañas segmentadas: aria y escape');
ok(U.textoDias(0) === 'hoy' && U.textoDias(1) === 'mañana' && U.textoDias(5) === 'en 5 días' && U.textoDias(-3) === 'hace 3 días', 'textoDias');
const iso = d => { const x = new Date(); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const hitos = U.proximosHitos([{ pe: 'PE1', entrega: iso(-2), jornada: iso(10) }, { pe: 'PE2', inicio: iso(3) }]);
ok(hitos.length === 2 && hitos[0].pe === 'PE2' && hitos[0].dias === 3, 'próximos hitos: solo futuros, el más cercano primero');
ok(U.lineaTiempoHTML([{ pe: '<PE>', nombre: 'x', inicio: iso(1) }]).includes('&lt;PE&gt;'), 'línea de tiempo: escapa el período');
ok(U.esqueletoHTML('perfil').includes('aria-busy="true"'), 'esqueleto avisa que está cargando');

// ── archivos, acciones y marcado ──
console.log('\n[archivos y acciones]');
for (const f of ['core/perfil.js', 'core/inicio.js', 'core/personas.js', 'core/ui.js', 'perfil.css', 'inicio.css', 'admin-personas.js'])
  ok(fs.existsSync(ROOT + f), f);
const cfg = fs.readFileSync(ROOT + 'config.js', 'utf8');
for (const a of ['perfilTab', 'perfilVer', 'cambiarAvatar', 'distritoTab', 'personasVista', 'evaluarDesdePerfil', 'gestionAprobar', 'gestionParticipante', 'borrarDesdePerfil'])
  ok(new RegExp(`\\n\\s+${a}:`).test(cfg), `ACCIONES.${a}`);

console.log('\n[marcado de los portales]');
const portales = {
  'user.html': ['inicio-host', 'perfil-host', 'tab-trabajos', 'linea-tiempo'],
  'secretario.html': ['inicio-host', 'perfil-host', 'tab-distrito', 'distrito-seg', 'distrito-members', 'ranking-dist-body', 'tab-tareas', 'tareas-lista', 'linea-tiempo'],
  'admin.html': ['ov-atencion', 'personas-seg', 'personas-cards', 'usuarios-list'],
};
for (const [f, ids] of Object.entries(portales)) {
  const h = fs.readFileSync(ROOT + f, 'utf8');
  for (const id of ids) ok(h.includes(`id="${id}"`), `${f} #${id}`);
  ok(!/\son[a-z]+\s*=/i.test(h.replace(/data-on[a-z]+/g, '')), `${f}: sin handlers inline`);
  ok(/core\/ui\.js/.test(h) && /perfil\.css/.test(h), `${f}: carga core/ui.js y perfil.css`);
}

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
