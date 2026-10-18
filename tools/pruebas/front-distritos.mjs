// Pruebas del apartado Distritos (core/distritos.js, core/distritos-admin.js) y de la regla «un PE en el que no participaste no existe para ti».
// El cálculo del ranking acumulado se prueba con la TABLA REAL de referencia (10 distritos × PE1, PE2, PE4; PE3 sin evaluaciones publicadas):
// si estos números cambian, la pantalla del admin ya no dice lo mismo que la tabla que se tomó de modelo.
// El comportamiento en pantalla se ve en el simulador (`npm run ui`: admin → Distritos; secretaría → Distrito → Resumen).
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const rd = f => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };
const cerca = (a, b, e = 0.005) => a != null && Math.abs(a - b) < e;

const ctx = vm.createContext({ console, Intl });
vm.runInContext(rd('config.js').match(/function escHtml\(s\) \{[\s\S]*?\n\}/)[0] + '\n' + rd('core/distritos.js') + '\nthis.D = Distritos;', ctx);
const D = ctx.D;

// ── La tabla de referencia ─────────────────────────────────────────────────
const PES = [{ id: 'p1', pe: 'PE1' }, { id: 'p2', pe: 'PE2' }, { id: 'p3', pe: 'PE3' }, { id: 'p4', pe: 'PE4' }];
const T = { '08-05': [25, 21, 23], '08-08': [24, 17, 28], '08-09': [18, 25, 21], '08-10': [23, 19, 22], '08-01': [19, 15, 24], '08-06': [19, 21, 18],
  '08-04': [23, 18, 16], '08-03': [25, 15, 14], '08-02': [21, 13, 12], '08-07': [9, 11, 12] };   // columnas: PE1, PE2, PE4
const pj = t => { const b = Math.floor(t / 4), r = t - b * 4; return { cgo: b + (r > 0), cct: b + (r > 1), com: b + (r > 2), cee: b }; };
const evals = [];
for (const [d, v] of Object.entries(T)) [['p1', v[0]], ['p2', v[1]], ['p4', v[2]]].forEach(([p, t]) => evals.push({ periodo_id: p, distrito_id: d, puntajes: pj(t), estado: 'publicado' }));
const distritos = Object.keys(T).map(id => ({ id, nombre: 'Distrito ' + id }));
const R = D.consolidar({ periodos: PES, distritos, evals });
const por = id => R.filas.find(f => f.id === id);

console.log('[las competencias suman el puntaje]');
ok(D.puntaje({ cgo: 7, cct: 6, com: 5, cee: 4 }) === 22 && D.puntaje('{"cgo":3,"cct":3,"com":3,"cee":3}') === 12 && D.puntaje(null) === 0, 'puntaje: suma de las 4 competencias (objeto, JSON o vacío)');
ok(D.nivel(24).t === 'Excelente' && D.nivel(23.99).t === 'Bueno' && D.nivel(17).t === 'Bueno' && D.nivel(10).t === 'En proceso' && D.nivel(9.9).t === 'Bajo', 'niveles sobre 28: 24 / 17 / 10 (valen también para un promedio con decimales)');

console.log('\n[ranking acumulado = la tabla de referencia]');
ok(R.incl.map(p => p.pe).join() === 'PE1,PE2,PE4', 'PE3 (sin evaluaciones publicadas) no entra a las columnas: PE1, PE2, PE4');
const esperado = [['08-05', 69, 23.00, 82.14], ['08-08', 69, 23.00, 82.14], ['08-09', 64, 21.33, 76.19], ['08-10', 64, 21.33, 76.19], ['08-01', 58, 19.33, 69.05], ['08-06', 58, 19.33, 69.05],
  ['08-04', 57, 19.00, 67.86], ['08-03', 54, 18.00, 64.29], ['08-02', 46, 15.33, 54.76], ['08-07', 32, 10.67, 38.10]];
for (const [id, total, prom, pct] of esperado) { const f = por(id); ok(f.total === total && cerca(f.prom, prom) && cerca(f.pct * 100, pct), `${id}: total ${total}, promedio ${prom.toFixed(2)}, ${pct} %`); }
ok(R.ranking.map(f => f.id).sort().join() === Object.keys(T).sort().join() && R.ranking.length === 10, 'los 10 distritos están en el ranking');
ok(R.ranking.map(f => f.pos).join() === '1,1,3,3,5,5,7,8,9,10', 'los empates comparten posición: 1,1,3,3,5,5,7,8,9,10');
ok(['08-05', '08-08'].includes(R.ranking[0].id) && ['08-05', '08-08'].includes(R.ranking[1].id), 'los dos primeros son 08-05 y 08-08 (69 puntos)');
ok(R.ranking[0].id === '08-08', 'a igualdad de promedio y total manda el período más reciente (08-08 sacó 28 en PE4)');
ok(R.ranking.at(-1).id === '08-07' && R.ranking.at(-1).pos === 10, 'el último es 08-07');
ok(por('08-05').puntos.join() === '25,21,23', 'las celdas por PE quedan alineadas con las columnas');

console.log('\n[promedio por período y global]');
const pp = Object.fromEntries(R.porPeriodo.map(x => [x.periodo.pe, x]));
ok(cerca(pp.PE1.prom, 20.60) && cerca(pp.PE1.pct * 100, 73.57), 'PE1: 20,60 / 28 (73,57 %)');
ok(cerca(pp.PE2.prom, 17.50) && cerca(pp.PE2.pct * 100, 62.50), 'PE2: 17,50 / 28 (62,50 %)');
ok(pp.PE3.n === 0 && pp.PE3.prom === null && pp.PE3.incluido === false, 'PE3: «Sin evaluaciones publicadas» (no es un 0)');
ok(cerca(pp.PE4.prom, 19.00) && cerca(pp.PE4.pct * 100, 67.86), 'PE4: 19,00 / 28 (67,86 %)');
ok(R.global.n === 30 && cerca(R.global.prom, 19.03) && cerca(R.global.pct * 100, 67.98), 'global acumulado: 19,03 / 28 (67,98 %) sobre 30 evaluaciones');

console.log('\n[reglas]');
const conBorrador = D.consolidar({ periodos: PES, distritos, evals: [...evals, { periodo_id: 'p3', distrito_id: '08-05', puntajes: pj(28), estado: 'borrador' }] });
ok(conBorrador.incl.length === 3 && conBorrador.porPeriodo[2].n === 0 && conBorrador.global.n === 30, 'un BORRADOR no cuenta: ni abre una columna, ni mueve promedios');
const sub = D.consolidar({ periodos: PES, distritos, evals, incluidos: new Set(['p1', 'p2']) });
ok(sub.incl.length === 2 && por('08-05') && sub.filas.find(f => f.id === '08-05').total === 46 && cerca(sub.global.prom, 19.05), 'elegir solo PE1 y PE2 recalcula todo (08-05: 46; global 19,05)');
const falta = D.consolidar({ periodos: PES, distritos: [...distritos, { id: '08-11', nombre: 'Distrito 08-11' }], evals: [...evals, { periodo_id: 'p1', distrito_id: '08-11', puntajes: pj(20), estado: 'publicado' }] });
const f11 = falta.filas.find(f => f.id === '08-11');
ok(f11.n === 1 && f11.total === 20 && cerca(f11.prom, 20), 'un distrito evaluado en un solo PE se promedia sobre ese PE (no se castiga por los que no tiene)');
ok(falta.sinDatos.length === 0 && D.consolidar({ periodos: PES, distritos: [...distritos, { id: 'X', nombre: 'X' }], evals }).sinDatos.map(f => f.id).join() === 'X', 'un distrito sin ninguna evaluación va aparte (sin posición), no con 0');
ok(D.consolidar({ periodos: PES, distritos, evals: [] }).ranking.length === 0 && D.consolidar({ periodos: PES, distritos, evals: [] }).global.prom === null, 'sin evaluaciones no se inventa nada');

console.log('\n[cableado]');
const adm = rd('admin.html'), sec = rd('secretario.html');
ok(/id="tab-distritos"[\s\S]*id="distritos-host"/.test(adm) && !/dist-eval-select|id="dist-ranking"|dist-pe-btns/.test(adm), 'admin.html: la pestaña es un solo contenedor; ya no están el desplegable ni la lista vieja');
ok(/core\/estadisticas-distrito\.js[\s\S]*core\/distritos\.js[\s\S]*core\/distritos-admin\.js/.test(adm), 'admin.html: estadisticas-distrito → distritos → distritos-admin (orden de carga)');
ok(/estadisticas-distrito\.css[\s\S]*distritos\.css[\s\S]*movil\.css/.test(adm) && /estadisticas-distrito\.css[\s\S]*distritos\.css[\s\S]*movil\.css/.test(sec), 'las dos páginas cargan distritos.css antes de movil.css');
ok(/core\/estadisticas-distrito\.js[\s\S]*core\/distritos\.js/.test(sec) && !/distritos-admin/.test(sec), 'secretario.html carga distritos.js y NO el módulo del admin');
ok(/id="dist-panel-resumen"[\s\S]*id="dist-resumen-cuerpo"/.test(sec) && !/dist-calificacion|dist-cal-body/.test(sec), 'secretario.html: panel «Resumen» y sin el bloque de calificación que reemplaza');
const cfg = rd('config.js'), lista = cfg.slice(0, cfg.indexOf('const ACCIONES'));
ok(/^\s{2}dist:\s/m.test(cfg) && /^\s{2}distPanelTab:\s/m.test(cfg) && lista.includes("'distBuscar'"), 'ACCIONES.dist, ACCIONES.distPanelTab y distBuscar en la lista blanca');
ok(!/onDistSelectChange|buscarDistritos|selectDistPE|elegirDistrito|renderDistritoRanking/.test(rd('admin.js') + cfg), 'no quedan restos del apartado viejo en admin.js ni en config.js');
const mod = rd('core/distritos.js') + rd('core/distritos-admin.js');
const usadas = new Set([...mod.matchAll(/data-act="([a-zA-Z]+)"/g)].map(m => m[1]));
ok([...usadas].every(a => new RegExp(`^\\s{2}${a}:|^\\s{2}perfilVer:`, 'm').test(cfg)), 'toda data-act usada existe en ACCIONES: ' + [...usadas].join(', '));
ok(!/\son(click|input|change|submit)\s*=/.test(mod), 'sin handlers en línea (CSP)');
ok(/escHtml\(f\.nombre\)/.test(mod) && !/\$\{[a-z]+\.nombre\}/.test(mod) && !/\$\{u\.(nombre|email)\}/.test(mod), 'el nombre de distritos y personas siempre pasa por escHtml (nunca ${x.nombre} directo)');
const secJs = rd('secretario.js');
ok(/let _distritoTab = 'resumen'/.test(secJs) && /k: 'resumen'/.test(secJs) && /Distritos\.montarSecretaria/.test(secJs), 'secretario.js: «Resumen» es la primera sección y abre por defecto');
const css = rd('distritos.css').replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'distritos.css: ningún hex (solo tokens)');
ok(/@media \(max-width: 767px\)/.test(css) && /attr\(data-label\)/.test(css), 'distritos.css: en celular la tabla pasa a tarjetas con su etiqueta');
ok(/prefers-reduced-motion/.test(css), 'respeta prefers-reduced-motion');

console.log('\n[un PE en el que no participaste no existe para ti]');
const api = rd('api.js');
const gc = api.slice(api.indexOf('async getContexto('), api.indexOf('async getContexto(') + 6000);
ok(/periodo_participantes[\s\S]{0,120}\.eq\('user_id', profile\.id\)[\s\S]{0,40}\.eq\('activo', false\)/.test(gc), 'getContexto lee las filas «no participa» de la propia persona');
ok(/if \(!profile\.es_admin\)/.test(gc), 'solo para miembros y secretarías: la administración ve todos los PE');
ok(/periodosRaw = periodosRaw\.filter\(p => !no\.has\(String\(p\.id\)\)\)/.test(gc), 'esos PE se sacan de la lista antes de que llegue a ningún selector');
ok(/calRaw\.filter\(c => !peFuera\.has\('PE' \+ c\.numero\)\)/.test(gc), 'y sus fechas se sacan del calendario');
ok(/catch \{ \/\* se muestran todos \*\/ \}/.test(gc), 'si la consulta falla se muestran todos (mejor un PE de más que dejar a alguien sin ninguno)');
ok(/async getPeriodosSinParticipar\(/.test(api), 'API.getPeriodosSinParticipar(persona)');
const per = rd('core/perfil.js'), pe = rd('core/perfil-pe.js');
ok(/getPeriodosSinParticipar\(persona\.id\)/.test(per) && /periodos,\s*serie: \[\]/.test(per), 'el perfil filtra por la persona que se mira (también cuando la ve su secretaría o el admin)');
ok(!/Store\.periodos\(\)/.test(per.replace(/const periodos = \(Store\.periodos\(\) \|\| \[\]\)\.filter/, '').replace(/inst\.periodos \|\| Store\.periodos\(\) \|\| \[\]/g, '')), 'el perfil ya no lee la lista global de PE salvo para filtrarla');
ok(/inst\.periodos \|\| Store\.periodos\(\)/.test(pe), 'la pestaña «Períodos» usa la lista de la persona');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
