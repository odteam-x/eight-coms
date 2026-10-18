// Pruebas del frontend del reporte general (core/reporte-general.js): cableado, seguridad del marcado y la
// aritmética de consolidar / filtrar / ordenar / CSV con números inventados cuyo resultado se puede comprobar a mano.
// La prueba contra la base real (que los totales del front coincidan con las funciones SQL) está en sql-0050.mjs.
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = DIR + '../../';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const leer = f => fs.readFileSync(ROOT + f, 'utf8');

console.log('[archivos y cableado]');
for (const f of ['core/reporte-general.js', 'reporte-general.css', 'supabase/migrations/0050_reporte_general_pe.sql', 'tools/pruebas/sql-0050.mjs', 'tools/pruebas/ui/fake-extra-reporte-general.js'])
  ok(fs.existsSync(ROOT + f), 'existe ' + f);
const js = leer('core/reporte-general.js'), cfg = leer('config.js'), adm = leer('admin.html'), rep = leer('admin-reportes.js');
const acciones = new Set([...cfg.matchAll(/\n\s{2}([a-zA-Z0-9]+):\s/g)].map(m => m[1]));
const simples = new Set([...cfg.match(/_ACCIONES_SIMPLES = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([A-Za-z0-9]+)'/g)].map(m => m[1]));
for (const f of ['core/reporte-general.js', 'admin-reportes.js']) {
  const t = leer(f);
  ok(!/\son[a-z]+\s*=\s*["']/i.test(t.replace(/data-on[a-z]+/g, '')), f + ': sin handlers inline');
  const act = [...new Set([...t.matchAll(/data-act="([A-Za-z0-9]+)"/g)].map(m => m[1]))].filter(a => a !== 'fn');
  const faltan = act.filter(a => !acciones.has(a));
  ok(!faltan.length, f + ': todas sus data-act están en ACCIONES' + (faltan.length ? ' (faltan: ' + faltan.join(', ') + ')' : ''));
  const sim = [...new Set([...t.matchAll(/data-(?:change|input)="([A-Za-z0-9]+)"/g)].map(m => m[1]))];
  const noPerm = sim.filter(a => !simples.has(a));
  ok(!noPerm.length, f + ': sus data-change / data-input están en la lista blanca' + (noPerm.length ? ' (faltan: ' + noPerm.join(', ') + ')' : ''));
}
ok(/function rgFiltro\b/.test(js), 'existe la función global rgFiltro() de la lista blanca');
ok(/#rep-modo|id="rep-modo"/.test(adm) && /id="rg-host"/.test(adm) && /id="rep-detalle"/.test(adm), 'admin.html: hosts del selector de modo, del resumen y del reporte detallado');
ok(/core\/reporte-general\.js/.test(adm) && /reporte-general\.css/.test(adm), 'admin.html carga el módulo y su hoja');
ok(adm.indexOf('reporte-equipo.js') < adm.indexOf('reporte-general.js') && adm.indexOf('reporte-general.js') < adm.indexOf('admin-reportes.js'), 'orden de carga: reporte-equipo → reporte-general → admin-reportes');
ok(adm.indexOf('evolucion.css') < adm.indexOf('reporte-general.css') && adm.indexOf('reporte-general.css') < adm.indexOf('movil.css'), 'la hoja carga después de evolucion.css y antes de movil.css');
ok(/Reportes\.setModo|setModo/.test(rep) && /ReporteGeneral\.montar/.test(rep) && /ReporteGeneral\.csv/.test(rep), 'admin-reportes: modo general (montar, CSV) conectado');
const css = leer('reporte-general.css');
ok(!/#[0-9a-fA-F]{3,8}\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'reporte-general.css: ningún hex fuera de :root (solo tokens)');
ok(!/!important/.test(css), 'reporte-general.css: sin !important');
ok(!/font-size:\s*[0-9.]+(rem|px)/.test(css), 'reporte-general.css: sin tamaños de letra sueltos (solo --fs-*)');
ok(!/fetch\(|XMLHttpRequest|\.from\(['"]/.test(js), 'el módulo no consulta tablas: solo llama a la función reporte_general_pe y a seguimiento_global');
ok(!/jsonb|\bSUM\(|AVG\(/.test(js), 'el módulo no trae su propia fórmula SQL');

// ── La lógica, en un contexto sin DOM ──
const ctx = { escHtml, console, document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] }, window: {},
  renderIconos() {}, renderCargando() {}, renderError() {}, showToast() {}, fechaCortaISO: f => String(f).slice(5, 10), ReporteEquipo: { descargar() {}, imprimir() {} } };
vm.createContext(ctx);
vm.runInContext(js + ';globalThis.__R = ReporteGeneral;', ctx);
const R = ctx.__R;

const fila = (o = {}) => ({
  periodo_id: o.id || 'p', periodo_nombre: o.nombre || 'PE', descripcion: '', orden: o.orden || 1, modelo: 'v2', activo: false, estado_pe: 'cerrado', vista: 'todo',
  fecha_inicio: null, fecha_entrega: null, personas: 10, participan: 10, no_participan: 0, eval_publicadas: 0, eval_no_publicadas: 0, eval_sin_evaluar: 10,
  n_resultados: 0, suma_resultado: 0, n_nucleo: 0, suma_nucleo: 0, n_tecnico: 0, suma_tecnico: 0,
  tareas_aplican: true, tareas_total: 0, tareas_asignadas: 0, tareas_propias: 0, tareas_abiertas: 0, tareas_en_revision: 0, tareas_aprobadas: 0,
  tareas_devueltas: 0, tareas_bloqueadas: 0, tareas_vencidas: 0, tareas_entregadas: 0, con_plazo: 0, a_tiempo: 0, puntos_suma: 0, puntos_n: 0,
  actividades_con_tareas: 0, tareas_en_actividades: 0, tareas_en_actividades_aprobadas: 0, por_distrito: [], por_rol: [],
  g_personas: 10, g_participan_alguno: 10, g_con_publicada: 6, generado_en: '2026-10-17T12:00:00Z', ...o,
});

console.log('\n[totales, promedios y porcentajes: la diferencia importa]');
// PE «A»: 2 resultados que promedian 50. PE «B»: 8 que promedian 90. Promedio simple de promedios = 70; el correcto (ponderado) = 82.
const A = fila({ id: 'A', nombre: 'PE A', orden: 1, participan: 2, personas: 10, eval_publicadas: 1, n_resultados: 2, suma_resultado: 100, tareas_total: 10, tareas_aprobadas: 4, tareas_abiertas: 6, tareas_vencidas: 2, tareas_entregadas: 4, con_plazo: 4, a_tiempo: 1 });
const B = fila({ id: 'B', nombre: 'PE B', orden: 2, participan: 8, personas: 10, eval_publicadas: 8, n_resultados: 8, suma_resultado: 720, tareas_total: 30, tareas_aprobadas: 30, tareas_vencidas: 0, tareas_entregadas: 30, con_plazo: 20, a_tiempo: 20 });
let c = R.consolidar([A, B]);
ok(c.v2.n === 10 && c.v2.suma === 820 && c.v2.promedio === 82, `promedio PONDERADO por resultados: (100+720)/(2+8) = 82, no el promedio simple 70 (${c.v2.promedio})`);
ok(c.publicadas === 9 && c.participaciones === 10, 'evaluaciones: Σ publicadas 9 ÷ Σ participan 10');
ok(Math.round(c.publicadas / c.participaciones * 100) === 90, 'porcentaje global = 90 % (Σ÷Σ); promediar los porcentajes (50 % y 100 %) habría dado 75 %');
ok(c.tareas.total === 40 && c.tareas.aprobadas === 34 && c.tareas.vencidas === 2, 'tareas: totales sumados (40 / 34 aprobadas / 2 vencidas)');
ok(c.tareas.aTiempo === 21 && c.tareas.conPlazo === 24, 'a tiempo: Σ21 ÷ Σ24 (87,5 %), no el promedio de 25 % y 100 %');
ok(c.personas === 10, 'personas: las 10 distintas de la base, NO 10 + 10 por estar en dos PE');
ok(c.participanAlguno === 10 && R.consolidar([A], { completo: false }).participanAlguno === null, '«participan en algún PE» solo se muestra si están todos los PE (con un subconjunto no es calculable)');
ok(c.tareas.peConVencidas === 1 && c.pe === 2, 'un PE con vencidas de dos; total de PE = 2');

console.log('\n[dos escalas no se mezclan; lo que no aplica no es cero]');
const L = fila({ id: 'L', nombre: 'PE clásico', orden: 3, modelo: 'legacy', tareas_aplican: false, n_resultados: 3, suma_resultado: 66, eval_publicadas: 3, tareas_total: 0 });
c = R.consolidar([A, B, L]);
ok(c.v2.promedio === 82 && c.v2.n === 10, 'el promedio de la rúbrica por roles NO incluye el PE clásico');
ok(c.clasico.n === 3 && c.clasico.promedio === 22 && c.peClasicos === 1, 'la clásica tiene su propio promedio (66/3 = 22) y su propia cuenta');
ok(c.tareas.aplican === 2 && c.tareas.total === 40, 'los PE clásicos no entran en los totales de tareas');
ok(R.consolidar([L]).v2.promedio === null && R.consolidar([fila()]).v2.promedio === null, 'sin resultados: promedio null (la pantalla pone «—», nunca 0)');
ok(R.consolidar([]).personas === null && R.consolidar([]).pe === 0, 'sin PE: nada que mostrar y personas null');

console.log('\n[PE sin datos]');
const vacio = fila({ id: 'V', nombre: 'PE vacío', orden: 4, personas: 0, participan: 0, eval_sin_evaluar: 0 });
ok(R.sinDatos(vacio) && !R.sinDatos(A) && R.sinDatos(fila()), 'sinDatos: ni evaluaciones (ni borrador) ni tareas');
ok(!R.sinDatos(fila({ eval_no_publicadas: 1 })) && !R.sinDatos(fila({ tareas_total: 1 })), 'un borrador o una sola tarea ya es actividad');
c = R.consolidar([A, B, vacio]);
ok(c.peSinDatos === 1 && c.pe === 3 && c.tareas.total === 40, 'el PE vacío cuenta como PE, aporta 0 y se señala «sin datos»');

console.log('\n[filtros y orden]');
const todos = [A, B, L, vacio, fila({ id: 'Z', nombre: 'Período cerrado', orden: 5, estado_pe: 'activo', eval_no_publicadas: 2 })];
ok(R.filtrar(todos, { q: 'periodo' }).length === 1, 'búsqueda sin tildes: «periodo» encuentra «Período cerrado»');
ok(R.filtrar(todos, { q: 'pe a' }).map(r => r.periodo_id).join() === 'A', 'búsqueda por nombre, sin importar mayúsculas');
ok(R.filtrar(todos, { estado: 'activo' }).length === 1 && R.filtrar(todos, { modelo: 'legacy' }).map(r => r.periodo_id).join() === 'L' && R.filtrar(todos, { modelo: 'v2' }).length === 4, 'estado y rúbrica');
ok(R.filtrar(todos, { ver: 'vencidas' }).map(r => r.periodo_id).join() === 'A', 'solo los que tienen tareas vencidas');
ok(R.filtrar(todos, { ver: 'sin_datos' }).map(r => r.periodo_id).sort().join() === 'V', 'solo los PE sin datos');
ok(R.filtrar(todos, { ver: 'por_publicar' }).map(r => r.periodo_id).sort().join() === 'A,B,L,Z', 'por publicar: los que tienen borradores o personas sin evaluar (no el PE vacío)');
ok(R.filtrar(todos, {}).length === 5, 'sin filtros: el conjunto completo');
ok(R.filtrar(todos, { q: 'zzz' }).length === 0, 'sin coincidencias: lista vacía (la pantalla ofrece quitar filtros)');
ok(R.consolidar(R.filtrar(todos, { modelo: 'v2' })).v2.n === 10, 'los totales se recalculan sobre lo filtrado');
ok(R.ordenar(todos, 'promedio').map(r => r.periodo_id).slice(0, 3).join() === 'B,A,L', 'ordenar por promedio: rúbrica por roles de mayor a menor, luego la clásica (otra escala, no se compara), y los sin resultado al final');
ok(R.ordenar(todos, 'cronologico').map(r => r.periodo_id).join() === 'A,B,L,V,Z', 'orden cronológico = orden de los PE');
ok(R.ordenar(todos, 'vencidas')[0].periodo_id === 'A', 'ordenar por tareas vencidas');
ok(todos[0].periodo_id === 'A', 'ordenar no modifica el arreglo original');

console.log('\n[CSV: mismas filas, numerador y denominador, sin fórmulas]');
const csv = R.csvTexto([A, B, L], { filtros: 'ninguno', generado: '17 oct' });
const lineas = csv.replace(/^﻿/, '').split('\n');
const celdas = l => l.split(';');
ok(celdas(lineas[0]).length === celdas(lineas[1]).length && celdas(lineas[0]).length === celdas(lineas[4]).length, 'cabecera, filas y total tienen el mismo número de columnas');
ok(lineas[1].startsWith('PE A;Por roles;') && lineas[3].startsWith('PE clásico;Clásica;'), 'una fila por PE, con su rúbrica');
const h = celdas(lineas[0]), tot = celdas(lineas[4]);
ok(tot[0].startsWith('TOTAL (3 PE)') && tot[h.indexOf('Tareas')] === '40' && tot[h.indexOf('Vencidas')] === '2', 'fila TOTAL: 3 PE, 40 tareas, 2 vencidas');
ok(tot[h.indexOf('Resultados publicados (n)')] === '10' && tot[h.indexOf('Promedio')] === '82', 'el promedio total del CSV es el ponderado (82), solo de la rúbrica por roles');
ok(celdas(lineas[1])[h.indexOf('Evaluaciones publicadas')] === '1' && celdas(lineas[1])[h.indexOf('Participan')] === '2', 'numerador (publicadas) y denominador (participan) en columnas separadas');
ok(celdas(lineas[3])[h.indexOf('Tareas aplican')] === 'no', 'el PE clásico dice que las tareas no aplican');
ok(csv.includes('Alcance;Toda la gestión') && csv.includes('Datos al;17 oct'), 'alcance, filtros y hora de los datos al pie');
const mala = R.csvTexto([fila({ nombre: '=HYPERLINK("http://x")' }), fila({ nombre: '@SUM(1)' })]);
ok(!/\n=HYPERLINK|\n@SUM/.test(mala) && mala.includes("'=HYPERLINK") && mala.includes("'@SUM"), 'una celda de texto que empieza con = o @ se neutraliza (no se ejecuta como fórmula)');
ok(R.csvTexto([fila({ nombre: 'con;punto y coma' })]).includes('"con;punto y coma"'), 'los separadores dentro de una celda se entrecomillan');
ok(R.csvTexto([fila({ vista: 'distrito' })]).includes('Alcance;Solo mi distrito') && R.csvTexto([fila({ vista: 'propio' })]).includes('Solo mis datos'), 'el CSV dice el alcance que tenía quien lo bajó (distrito / solo lo propio)');

console.log('\n[fase 2: tareas colectivas, equipos y anuladas]');
// Dos PE; cada uno con 4 tareas individuales y 3 colectivas (una por tarea, no por integrante).
const E1 = fila({ id: 'E1', nombre: 'PE equipos 1', orden: 1, tareas_total: 4, tareas_abiertas: 2, tareas_aprobadas: 2, tareas_vencidas: 1, colectivas_total: 3, colectivas_abiertas: 1, colectivas_en_revision: 1, colectivas_aprobadas: 1, colectivas_vencidas: 1,
  colectivas_con_plazo: 2, colectivas_a_tiempo: 2, con_plazo: 2, a_tiempo: 1, equipos_total: 2, equipos_activos: 2, equipos_integrantes: 4, tareas_anuladas: 1, colectivas_anuladas: 1 });
const E2 = fila({ id: 'E2', nombre: 'PE equipos 2', orden: 2, tareas_total: 1, tareas_aprobadas: 1, colectivas_total: 0, equipos_total: 0 });
c = R.consolidar([E1, E2]);
ok(c.tareas.total === 8 && c.tareas.individuales === 5 && c.tareas.colectivas === 3, 'tareas = individuales (5) + colectivas (3, una por tarea) = 8');
ok(c.tareas.aprobadas === 4 && c.tareas.enRevision === 1 && c.tareas.abiertas === 3 && c.tareas.aprobadas + c.tareas.enRevision + c.tareas.abiertas === c.tareas.total, 'aprobadas 4 + en revisión 1 + abiertas 3 = 8: cada tarea en un solo grupo');
ok(c.tareas.vencidas === 2 && c.tareas.conPlazo === 4 && c.tareas.aTiempo === 3, 'vencidas y entregas a tiempo incluyen las colectivas (3 de 4 a tiempo)');
ok(c.tareas.anuladas === 2 && c.equipos === 2 && c.equiposActivos === 2, 'anuladas aparte (2, no suman al total) y 2 equipos');
ok(R.sinDatos(fila({ equipos_total: 0 })) && !R.sinDatos(fila({ colectivas_total: 1 })) && !R.sinDatos(fila({ equipos_total: 1 })), 'un PE con solo un equipo o solo una colectiva ya no es «sin datos»');
ok(R.filtrar([fila({ id: 'K', colectivas_vencidas: 1 }), fila({ id: 'J' })], { ver: 'vencidas' }).map(r => r.periodo_id).join() === 'K', 'el filtro «con tareas vencidas» también ve las colectivas vencidas');
const csv2 = R.csvTexto([E1, E2]);
const l2 = csv2.replace(/^﻿/, '').split('\n'), h2 = l2[0].split(';');
ok(h2.length === l2[1].split(';').length && h2.length === l2[3].split(';').length, 'CSV ampliado: cabecera, filas y total con el mismo número de columnas');
ok(l2[1].split(';')[h2.indexOf('Tareas')] === '7' && l2[1].split(';')[h2.indexOf('Colectivas')] === '3' && l2[1].split(';')[h2.indexOf('Anuladas (no cuentan)')] === '2', 'CSV: Tareas = 4 + 3, colectivas 3, anuladas 2 aparte');
ok(l2[3].split(';')[h2.indexOf('Tareas')] === '8' && l2[3].split(';')[h2.indexOf('Equipos')] === '2', 'CSV: fila TOTAL con 8 tareas y 2 equipos');
ok(R.consolidar([fila({ tareas_total: 3 })]).tareas.total === 3 && R.consolidar([fila({ tareas_total: 3 })]).tareas.colectivas === 0, 'con la versión 0050 (sin columnas de colectivas) el consolidado sigue funcionando');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
