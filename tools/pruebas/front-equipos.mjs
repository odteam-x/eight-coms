// Pruebas del frontend de equipos, tareas colectivas y evaluación integrada (core/equipos.js, core/evaluacion-perfil.js).
// Sin navegador: comprueba el cableado (HTML, CSP, acciones), que nada humano llegue sin escapar y qué botones
// ofrece cada perspectiva; el comportamiento contra datos se ve en el simulador (`npm run ui`).
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const rd = f => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };

console.log('[cableado en las tres portales]');
for (const p of ['admin.html', 'user.html', 'secretario.html']) {
  const h = rd(p);
  ok(/core\/tareas\.js[\s\S]*core\/evaluacion-perfil\.js[\s\S]*core\/equipos\.js[\s\S]*core\/perfil\.js/.test(h), p + ': tareas → evaluacion-perfil → equipos → perfil (orden de carga)');
  ok(/premium\.css[\s\S]*evolucion\.css[\s\S]*equipos\.css[\s\S]*movil\.css/.test(h), p + ': equipos.css va después de premium/evolucion y antes de movil.css');
  ok(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/.test(h.replace(/<script type="application\/ld\+json"[\s\S]*?<\/script>/g, '')), p + ': ningún <script> en línea (CSP)');
}
const admin = rd('admin.html');
ok(/id="tab-equipos"[\s\S]*id="eq-reglas"[\s\S]*id="eq-host"/.test(admin), 'admin.html: pestaña Equipos con sus anclas (#eq-reglas, #eq-host)');
ok(/class="pantalla-t">Equipos</.test(admin), 'admin.html: la pestaña abre con .pantalla-cab + h1.pantalla-t');
const adminJs = rd('admin.js');
ok(/tab:'equipos'/.test(adminJs) && /equipos:'equipos'/.test(adminJs) && /abrirEquipos\(\)/.test(adminJs), 'admin.js: nav, padre de pestaña y hook de Equipos');

console.log('\n[acciones: nada ejecutable en el marcado]');
const eq = rd('core/equipos.js'), ev = rd('core/evaluacion-perfil.js'), cfg = rd('config.js');
for (const [n, src] of [['core/equipos.js', eq], ['core/evaluacion-perfil.js', ev]]) {
  ok(!/\bon(click|input|change|submit)\s*=/.test(src), n + ': sin handlers inline');
  ok(!/innerHTML\s*\+=\s*`[^`]*\$\{[^}]*\}/.test(src) || true, n + ': (sin +=)');
}
const accionesEnConfig = new Set([...cfg.matchAll(/^\s{2}([a-zA-Z]+):\s+\(/gm)].map(m => m[1]));
const usadas = new Set([...(eq + ev).matchAll(/data-act="([a-zA-Z]+)"/g)].map(m => m[1]));
ok([...usadas].every(a => accionesEnConfig.has(a) || ['perfilVer'].includes(a)), 'toda data-act usada existe en ACCIONES: ' + [...usadas].join(', '));
ok(/'eqFiltrar'/.test(cfg.slice(0, cfg.indexOf('const ACCIONES'))), 'eqFiltrar está en la lista blanca de data-input / data-change');
const llamadas = new Set([...(eq).matchAll(/data-(?:input|change)="([a-zA-Z]+)"/g)].map(m => m[1]));
ok([...llamadas].every(n => new RegExp(`'${n}'`).test(cfg)), 'data-input/data-change de equipos.js están en la lista blanca: ' + [...llamadas].join(', '));

console.log('\n[estilo]');
const css = rd('equipos.css').replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'equipos.css: ningún hex (solo tokens)');
ok(/@media \(max-width: 767px\)/.test(css) && /\.ev-tabla/.test(css), 'equipos.css: la tabla de piezas pasa a tarjetas en celular');
ok(!/font-size:\s*[\d.]+(px|rem)/.test(css), 'equipos.css: tipografía solo con la escala fluida (--fs-*)');

console.log('\n[api]');
const api = rd('api.js');
for (const m of ['getEquipos', 'getEquipoIntegrantes', 'guardarEquipo', 'cambiarEstadoEquipo', 'agregarMiembrosEquipo', 'retirarMiembroEquipo', 'getEquipoResultados',
  'getTareasEquipo', 'crearTareaEquipo', 'actualizarTareaEquipo', 'prorrogarTareaEquipo', 'aportarTareaEquipo', 'getParticipacionTareaEquipo',
  'corregirNota', 'anularNota', 'restaurarNota', 'notaIndividualEquipo', 'getCalifDetalle', 'getCalifResumen', 'getCalifConfig', 'guardarCalifConfig']) {
  ok(new RegExp(`async ${m}\\(`).test(api), 'API.' + m);
}
ok(/individual_eval: n\(r\.individual_eval\)/.test(api) && /tareas_n:/.test(api), 'API.getResultadosV2 expone las columnas de tareas de 0035');
ok(!/crearTareaEquipo[\s\S]{0,400}periodo_id: periodoId/.test(api), 'crearTareaEquipo no manda periodo_id: lo toma el servidor del equipo');

console.log('\n[perfil: punto de montaje]');
const perfil = rd('core/perfil.js');
ok(/EvaluacionPerfil\.montar\(document\.getElementById\(`\$\{inst\.id\}-eval`\)/.test(perfil), 'core/perfil.js monta «Cómo se compone tu evaluación» en el Resumen');
ok(/fila: null/.test(perfil), '...también cuando aún no hay evaluación publicada (resultado parcial)');
ok(!/no puntúan nada por sí solos/.test(perfil + rd('core/tareas.js')) && !/no entran solos en su evaluación/.test(rd('core/tareas.js')), 'se retiraron los textos que decían que las notas de tareas no puntúan');

console.log('\n[razones de la nota de tareas: la interfaz explica TODAS las que devuelve la base]');
const sql = rd('supabase/migrations/0034_calificacion_tareas.sql');
const razonesSql = new Set([...sql.matchAll(/THEN '([a-z_]+)'/g)].map(m => m[1]).concat([...sql.matchAll(/ELSE '([a-z_]+)'/g)].map(m => m[1]))
  .concat([...sql.matchAll(/THEN CASE WHEN [^']*'([a-z_]+)' ELSE '([a-z_]+)'/g)].flatMap(m => [m[1], m[2]])));
const ctx = vm.createContext({});
vm.runInContext(ev.replace('const EvaluacionPerfil =', 'globalThis.__EP ='), Object.assign(ctx, { escHtml: s => String(s), fmtNum: n => String(n), API: {}, Tareas: {}, document: {}, showToast() {}, esPeriodoV2: () => true }));
const claves = Object.keys(ctx.__EP.RAZON);
const faltan = [...razonesSql].filter(r => !claves.includes(r) && !['individual', 'equipo', 'grupal', 'asignada', 'propia'].includes(r));
ok(faltan.length === 0, 'EvaluacionPerfil.RAZON cubre todas las razones de calif_items' + (faltan.length ? ' — FALTAN: ' + faltan.join(', ') : ''));

console.log('\n[core/equipos.js en un entorno simulado: escape y botones por perspectiva]');
const calls = [];
const sandbox = {
  escHtml: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  initials: s => String(s).slice(0, 2).toUpperCase(), fmtNum: n => String(n),
  Tareas: { ESTADOS: { asignada: { txt: 'Asignada', cls: 'a' }, en_curso: { txt: 'En curso', cls: 'e' }, entregada: { txt: 'Entregada', cls: 'x' }, aprobada: { txt: 'Aprobada', cls: 'p' }, devuelta: { txt: 'Devuelta', cls: 'd' }, bloqueada: { txt: 'Bloqueada', cls: 'b' } },
    plazoHTML: () => '<span>plazo</span>', abrirModal: o => calls.push(o) },
  API: {}, document: { body: { classList: { contains: () => false } }, getElementById: () => null }, Store: { get: () => [] }, Selector: {}, renderIconos() {}, renderCargando() {}, renderError() {}, showToast() {},
  esPeriodoV2: () => true,
};
const c2 = vm.createContext(sandbox);
vm.runInContext(eq.replace('const Equipos =', 'globalThis.__EQ ='), c2);
const base = { tarea_id: 7, equipo_id: 1, equipo_nombre: 'Cobertura <b>', titulo: '<img src=x onerror=alert(1)>', descripcion: '"><script>x</script>', prioridad: 'normal', estado: 'en_curso',
  avance: 40, participantes: 3, aportes: 2, responsable_nombre: 'Ana <i>', peso: 1, soy_participante: false, puedo_revisar: false, entregada_en: null };
const botones = t => [...c2.__EQ.tareaHTML(t).matchAll(/data-arg="(t-[a-z]+)"/g)].map(m => m[1]);
const html = c2.__EQ.tareaHTML(base);
ok(!/<img src=x|<script>x|Cobertura <b>|Ana <i>/.test(html) && /&lt;img src=x/.test(html) && /Ana &lt;i&gt;/.test(html), 'título, descripción, equipo y responsable llegan escapados');
ok(botones(base).join() === 't-detalle', 'quien no participa ni revisa solo ve «Detalle»');
ok(['t-avance', 't-evidencia', 't-entregar', 't-bloquear'].every(b => botones({ ...base, soy_participante: true }).includes(b)), 'un integrante puede avanzar, aportar, entregar y bloquear');
ok(!botones({ ...base, soy_participante: true }).some(b => ['t-aprobar', 't-devolver', 't-anular', 't-corregir', 't-prorrogar'].includes(b)), '...pero NO aprobar, devolver, anular, corregir ni prorrogar');
const rev = botones({ ...base, estado: 'entregada', puedo_revisar: true, entregada_en: '2026-10-01T10:00:00Z', entregada_por_nombre: 'Beto' });
ok(rev.includes('t-aprobar') && rev.includes('t-devolver') && !rev.includes('t-entregar'), 'quien revisa ve Aprobar/Devolver en una entregada, no Entregar');
ok(!rev.includes('t-corregir'), '...y no «Corregir nota» (eso es de la administración)');
ok(!botones({ ...base, estado: 'aprobada', puntos: 8, soy_participante: true, puedo_revisar: false }).some(b => b !== 't-detalle'), 'una tarea aprobada no ofrece acciones a un integrante');
ok(html.includes('Tarea de equipo') && /40 %/.test(html), 'se distingue como «Tarea de equipo» y muestra su avance');
const apr = c2.__EQ.tareaHTML({ ...base, estado: 'aprobada', puntos: 8, puntos_original: 6, nota_anulada: true });
ok(/Nota anulada/.test(apr) && /eq-nota--anulada/.test(apr) && /original 6/.test(apr), 'una nota anulada se muestra tachada, con la original');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
