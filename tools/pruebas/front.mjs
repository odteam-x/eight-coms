import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = DIR + '../../';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };

// ── core/rubrica.js en un contexto con stubs mínimos ──
const store = { criteriosV2: [], perfiles: [], periodos: [] };
const ctx = {
  escHtml: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  Store: { get: k => store[k], periodos: () => store.periodos },
  setEl: () => {}, renderVacio: () => {}, document: { getElementById: () => null },
  API: {}, console,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(ROOT + 'core/rubrica.js', 'utf8') + `
;globalThis.__x = { nivelV2, fmtV2, pctPuntajeV2, rangoPuntajeV2, ESCALA_NUCLEO_V2, perfilVigenteDe, criteriosAplicables, resultadoV2HTML, rankingV2HTML, esPeriodoV2, clavesAplicables };`, ctx);
const X = ctx.__x;

console.log('[niveles y formato]');
ok(X.nivelV2(87).label === 'Excelente' && X.nivelV2(86.9).label === 'Bueno', '87 = Excelente, 86.9 = Bueno');
ok(X.nivelV2(67).label === 'Bueno' && X.nivelV2(66.9).label === 'En Proceso', '67 = Bueno');
ok(X.nivelV2(37).label === 'En Proceso' && X.nivelV2(36.9).label === 'Bajo', '37 = En Proceso');
ok(X.fmtV2(87.5) === '87.5' && X.fmtV2(50) === '50' && X.fmtV2(null) === '—' && X.fmtV2(33.333) === '33.3', 'formato de números');
ok(X.pctPuntajeV2(1) === 0 && X.pctPuntajeV2(5) === 100 && X.pctPuntajeV2(3) === 50, 'barra 1–5 → 0–100 %');
// Puntos por peso (0023): cada criterio puntúa en SU rango
const rc = X.rangoPuntajeV2({ tipo: 'tecnico', peso: 30 }, 'cinco'), rp = X.rangoPuntajeV2({ tipo: 'tecnico', peso: 30 }, 'pesos'), rn = X.rangoPuntajeV2({ tipo: 'nucleo' }, 'pesos');
ok(rc.min === 1 && rc.max === 5, 'escala «cinco»: 1 a 5 sin importar el peso');
ok(rp.min === 0 && rp.max === 30, 'escala «pesos»: técnico de 0 a su peso (30)');
ok(rn.min === 0 && rn.max === 10 && X.ESCALA_NUCLEO_V2 === 10, 'escala «pesos»: núcleo de 0 a 10');
ok(X.pctPuntajeV2(15, rp) === 50 && X.pctPuntajeV2(0, rp) === 0 && X.pctPuntajeV2(30, rp) === 100, 'barra en «pesos»: 15 de 30 = 50 %, 0 = 0 %, 30 = 100 %');
ok(X.pctPuntajeV2(9, { min: 0, max: 10 }) === 90 && X.pctPuntajeV2(5, { min: 0, max: 0 }) === 0, 'sin rango válido la barra queda vacía (no divide por cero)');
ok(X.rangoPuntajeV2({ tipo: 'tecnico', peso: 30 }, undefined).max === 5, 'sin escala informada (datos anteriores a 0023) se lee como 1 a 5');

console.log('\n[perfil vigente y criterios aplicables]');
const cat = [
  ...['plazos', 'respuesta', 'colaboracion', 'iniciativa', 'calidad'].map((k, i) => ({ key: k, nombre: k, tipo: 'nucleo', orden: i + 1, activo: true, desc_1: 'a', desc_3: 'b', desc_5: 'c' })),
  ...['encuadre', 'tecnico', 'diseno', 'marca', 'edicion'].map((k, i) => ({ key: k, nombre: k, tipo: 'tecnico', orden: i + 6, activo: true, desc_1: 'a', desc_3: 'b', desc_5: 'c' })),
];
const periodos = ['p1', 'p2', 'p3'].map(id => ({ id }));
const perfiles = [
  { id: 1, rol_id: 7, version: 1, vigente_desde_periodo: null, perfil_criterios: [{ criterio_key: 'encuadre', peso: 60 }, { criterio_key: 'tecnico', peso: 40 }] },
  { id: 2, rol_id: 7, version: 2, vigente_desde_periodo: 'p3', perfil_criterios: [{ criterio_key: 'encuadre', peso: 50 }, { criterio_key: 'diseno', peso: 50 }] },
];
ok(X.perfilVigenteDe(7, 'p1', perfiles, periodos).version === 1, 'PE1 usa v1');
ok(X.perfilVigenteDe(7, 'p2', perfiles, periodos).version === 1, 'PE2 usa v1 (la v2 entra en PE3)');
ok(X.perfilVigenteDe(7, 'p3', perfiles, periodos).version === 2, 'PE3 usa v2');
ok(X.perfilVigenteDe(99, 'p1', perfiles, periodos) === null, 'rol sin perfil → null');
const ap = X.criteriosAplicables(perfiles[0], cat);
ok(ap.nucleo.length === 5 && ap.tecnicos.length === 2, 'núcleo 5 + técnicos del perfil');
ok(ap.tecnicos[0].key === 'encuadre' && ap.tecnicos[0].peso === 60, 'técnicos ordenados por peso');
ok(ap.fuera.map(c => c.key).sort().join() === 'diseno,edicion,marca', 'los que no aplican quedan fuera');
ok(X.clavesAplicables(perfiles[0], cat).length === 7, '7 claves puntuables (5 + 2)');

console.log('\n[HTML]');
store.criteriosV2 = cat; store.perfiles = perfiles; store.periodos = periodos;
const fila = { evaluado_id: 'u1', nombre: 'Ana <b>', distrito: '08-01', rol_nombre: 'Fotografía', n_rol: 3, rol_pequeno: true, nucleo: 75, tecnico: 80, individual: 78, percentil: null, general: 78 };
const html = X.resultadoV2HTML({ fila, puntajes: { plazos: 4, encuadre: 5 }, comentarios: { plazos: '<script>x</script>' }, perfil: perfiles[0] });
ok(html.includes('Regla de roles pequeños'), 'muestra la regla de roles pequeños');
ok(!html.includes('<script>'), 'comentarios escapados (sin <script>)');
ok(html.includes('No se te evalúan estos 3 criterios'), 'lista los criterios que no aplican');
ok((html.match(/class="cbar"/g) || []).length === 7, '7 barras (5 núcleo + 2 técnicos)');
const filaG = { ...fila, rol_pequeno: false, n_rol: 6, percentil: 62.5 };
ok(X.resultadoV2HTML({ fila: filaG, perfil: perfiles[0] }).includes('percentil <strong>62.5</strong>'), 'rol normal: muestra el percentil');

const rows = [
  { evaluado_id: 'a', nombre: 'A', rol_nombre: 'Foto', distrito: '08-01', estado: 'publicado', nucleo: 50, tecnico: 50, individual: 50, percentil: 100, general: 80, n_rol: 5, rol_pequeno: false },
  { evaluado_id: 'b', nombre: 'B <i>', rol_nombre: 'Foto', distrito: '08-02', estado: 'borrador', nucleo: 90, tecnico: 90, individual: 90, percentil: 0, general: 36, n_rol: 5, rol_pequeno: false },
  { evaluado_id: 'c', nombre: 'C', rol_nombre: 'Redacción', distrito: null, estado: 'publicado', nucleo: 60, tecnico: 70, individual: 66, percentil: null, general: 66, n_rol: 2, rol_pequeno: true },
];
const rk = X.rankingV2HTML(rows, { resaltarId: 'c' });
const pos = (txt, nombre) => txt.search(new RegExp('v2-nom">' + nombre + '\\s*(?:<|&)'));
const generalTbl = rk.slice(0, rk.indexOf('Ranking dentro de cada rol'));
ok(pos(generalTbl, 'A') >= 0 && pos(generalTbl, 'A') < pos(generalTbl, 'C') && pos(generalTbl, 'C') < pos(generalTbl, 'B'), 'ranking general ordenado por general (A 80 > C 66 > B 36)');
ok(rk.includes('v2-yo'), 'resalta a la persona logueada');
ok(rk.includes('B &lt;i&gt;'), 'nombres escapados');
ok(rk.includes('borrador') && rk.includes('Rol con menos de 4 personas'), 'marca borradores y la nota de rol pequeño');
ok(rk.includes('Ranking dentro de cada rol') && rk.includes('Redacción') && rk.includes('Foto'), 'ranking por rol presente');
const iFoto = rk.indexOf('<summary>Foto');
const porRolFoto = rk.slice(iFoto, rk.indexOf('</details>', iFoto));
ok(pos(porRolFoto, 'B') >= 0 && pos(porRolFoto, 'B') < pos(porRolFoto, 'A'), 'dentro del rol se ordena por individual (B 90 > A 50)');
ok(X.rankingV2HTML([]).includes('Aún no hay'), 'vacío con mensaje');

// ── ids que usa el JS nuevo deben existir en admin.html ──
console.log('\n[ids de admin.html]');
const html2 = fs.readFileSync(ROOT + 'admin.html', 'utf8');
for (const id of ['mpe-modelo', 'mpe-modelo-field', 'catalogo-v2', 'modal-perfil',
  'modal-perfil-title', 'mpf-rol', 'mpf-desde', 'mpf-desde-field', 'mpf-pesos', 'mpf-suma', 'mpf-estado', 'mpf-err', 'rpt-body', 'ov-body']) {
  ok(html2.includes(`id="${id}"`), `#${id}`);
}
// acciones usadas en el HTML nuevo deben estar en la lista blanca
const cfg = fs.readFileSync(ROOT + 'config.js', 'utf8');
for (const a of ['showPerfilModal', 'savePerfil', 'actualizarSumaPerfil', 'cambiarRolPerfil'])
  ok(new RegExp(`_ACCIONES_SIMPLES = new Set\\([\\s\\S]*'${a}'[\\s\\S]*?\\]\\)`).test(cfg), `lista blanca: ${a}`);
for (const a of ['puntajeV2', 'modalPerfil']) ok(cfg.includes(`${a}:`), `ACCIONES.${a}`);

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
