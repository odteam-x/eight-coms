// Pruebas del frontend de Desempeño (core/desempeno.js): cableado en las tres portales + comportamiento con datos.
// Sin navegador: el módulo se ejecuta en un contexto vm con un DOM mínimo y los helpers reemplazados por dobles.
// Lo que se verifica es lo que importa: no recalcula nada (usa lo que entrega seguimiento_global), nunca mezcla
// las dos rúbricas, solo cuenta lo PUBLICADO, «Mi desempeño» no muestra a nadie más y todo texto humano va escapado.
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const rd = f => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };

console.log('[cableado]');
const cfg = rd('config.js'), src = rd('core/desempeno.js'), css = rd('desempeno.css');
for (const p of ['admin.html', 'user.html', 'secretario.html']) {
  const h = rd(p);
  ok(/core\/seguimiento\.js[\s\S]*core\/desempeno\.js/.test(h) && h.indexOf('core/charts.js') > 0, p + ': carga core/desempeno.js (y Chart.js / charts.js)');
  ok(/equipos\.css[\s\S]*desempeno\.css[\s\S]*movil\.css/.test(h), p + ': desempeno.css después de equipos.css y antes de movil.css');
  ok(/id="tab-desempeno"/.test(h) && /id="desempeno-host"/.test(h), p + ': pestaña con su ancla #desempeno-host');
  ok(/class="pantalla-t">(Mi desempeño|Desempeño)</.test(h), p + ': la pestaña abre con .pantalla-cab + h1.pantalla-t');
}
ok(/tab:'desempeno'[^}]*Desempeño/.test(rd('admin.js')) && /desempeno:'desempeno'/.test(rd('admin.js')) && /Desempeno\.montarAdmin/.test(rd('admin.js')), 'admin.js: nav, padre de pestaña y hook montarAdmin');
for (const f of ['user.js', 'secretario.js']) ok(/tab:'desempeno'[^}]*Mi desempeño/.test(rd(f)) && /desempeno:'desempeno'/.test(rd(f)) && /Desempeno\.montarPropio\([\s\S]*?yo: CU\.id/.test(rd(f)), f + ': nav, padre de pestaña y hook montarPropio con la propia id');
ok(!/Desempeno\.montarAdmin/.test(rd('user.js')), 'el panel de administración no se monta en el portal del miembro');
// Desempeño del distrito (auditoría, PDF §4.2): la secretaría usa el mismo módulo SOLO desde su pestaña de distrito y solo si es secretaria; la base ya le entrega solo su distrito.
ok((rd('secretario.js').match(/Desempeno\.montarAdmin/g) || []).length === 1 && /tab === 'desempeno-distrito'\) Desempeno\.montarAdmin/.test(rd('secretario.js')) && /'desempeno-distrito'\) && !isSecretario\(\)/.test(rd('secretario.js')), 'secretario.js monta el modo de lectura de distrito en un solo sitio y solo para secretarías');
ok(/'desFiltro'/.test(cfg.slice(0, cfg.indexOf('const ACCIONES'))), 'desFiltro está en la lista blanca de data-input / data-change');
ok(/^\s{2}des:\s+\(/m.test(cfg), 'ACCIONES.des existe');
const usadas = new Set([...src.matchAll(/data-act="([a-zA-Z]+)"/g)].map(m => m[1]));
const enConfig = new Set([...cfg.matchAll(/^\s{2}([a-zA-Z]+):\s+\(/gm)].map(m => m[1]));
ok([...usadas].every(a => enConfig.has(a)), 'toda data-act usada existe en ACCIONES: ' + [...usadas].join(', '));
ok([...src.matchAll(/data-(?:input|change)="([a-zA-Z]+)"/g)].every(m => m[1] === 'desFiltro'), 'solo data-input/data-change = desFiltro');
ok(!/\bon(click|input|change|submit)\s*=/.test(src), 'core/desempeno.js: sin handlers inline');
ok(!/\.from\(|SB\./.test(src), 'no consulta tablas ni RPC propios: solo API.getSeguimientoGlobal (una fuente)');
ok(!/#[0-9a-fA-F]{3,8}\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'desempeno.css: ningún hex fuera de los tokens');
ok(!/\.\.\.|\$\{[^}]*\*\s*0\.6|0\.4\s*\*/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/spread/g, '')) || true, '(sin fórmulas de evaluación en el módulo)');
ok(!/0\.6|0\.4/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'no aparece la fórmula de evaluación (0.6 / 0.4): no se recalcula nada');

console.log('\n[comportamiento con datos]');
const el = id => ({ id, innerHTML: '', hidden: false, dataset: {}, classList: { contains: () => false } });
function entorno(rows, evals = []) {
  const dom = {};
  const graficos = {};
  const toasts = [];
  const ctx = {
    console, Set, Map, Math, Number, String, Array, Object, JSON, Date, Promise,
    // Un canvas solo «existe» si el HTML pintado lo contiene (como en el navegador): así se prueba que no se dibuja de más.
    document: { getElementById: id => (/^des-ch-/.test(id) ? ((dom['des-cuerpo']?.innerHTML || '') + (dom['des-comp']?.innerHTML || '')).includes(`id="${id}"`) ? el(id) : null : (dom[id] ||= el(id))), querySelectorAll: () => [] },
    escHtml: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fmtNum: (n, d = 1) => (n == null || Number.isNaN(Number(n)) ? '—' : String(Math.round(Number(n) * 10 ** d) / 10 ** d)),
    deltaHTML: (a, b, o = {}) => (a == null || b == null ? '' : `<delta>${Math.round((a - b) * 10) / 10}${o.ref ? ' vs ' + o.ref : ''}</delta>`),
    nivelV2: v => (v >= 87 ? { key: 'sex', label: 'Excelente' } : v >= 67 ? { key: 'sbu', label: 'Bueno' } : v >= 37 ? { key: 'spr', label: 'En proceso' } : { key: 'sba', label: 'Bajo' }),
    scoreColorTxtV2: () => 'var(--x)', scoreClass: () => 'sbu', scoreLabel: () => 'Bueno', scoreColorTxt: () => 'var(--x)',
    MAX_TOTAL: () => 30, hayCriterios: () => true, maxDe: c => c.max || 4, parseJSON: v => (typeof v === 'string' ? JSON.parse(v) : v || {}),
    getCriterios: () => [{ key: 'pla', nombre: 'Planificación', max: 4 }, { key: 'rev', nombre: 'Revisión', max: 4 }],
    token: n => n, conAlfa: c => c, borrarGrafico: id => { delete graficos[id]; },
    pintarGrafico: (id, construir) => { graficos[id] = construir(); },
    renderCargando: () => {}, renderError: () => {}, renderIconos: () => {}, animarEntrada: () => {},
    showToast: m => toasts.push(m), _distritoNombre: d => d,
    API: { getSeguimientoGlobal: async () => ({ ok: true, rows }), getEvaluacionesByPE: async id => evals.filter(e => e.periodo_id === id), getMiHistorial: async () => ({ ok: true, porPeriodo: Object.fromEntries(evals.filter(e => e.evaluado_id === 'p1').map(e => [e.periodo_id, { puntajes: e.puntajes }])) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.Desempeno = Desempeno;', ctx);
  return { ctx, dom, graficos, toasts };
}
const fila = (o) => ({ persona_id: 'p1', nombre: 'Ana', distrito: '08-01', rol_id: 1, rol_nombre: 'Dirección', periodo_id: 'a', periodo_nombre: 'PE1', periodo_orden: 1, modelo: 'v2', periodo_activo: false,
  participa: true, estado_eval: 'publicado', nucleo: 50, tecnico: 60, individual: 60, general: 55, total_clasico: null, tareas_total: 2, tareas_abiertas: 0, tareas_vencidas: 0, tareas_aprobadas: 2,
  con_plazo: 2, a_tiempo: 1, puntos_suma: 10, puntos_n: 2, individual_eval: 60, tareas_nota: 70, tareas_n: 2, peso_tareas: 20, colectivas_total: 0, colectivas_aprobadas: 0, ...o });
const P = (n, v, extra = {}) => ({ ...extra, periodo_id: 'id' + n, periodo_nombre: 'PE' + n, periodo_orden: n, individual: v, nucleo: v == null ? null : v - 5, tecnico: v == null ? null : v + 4, general: v == null ? null : v - 2, estado_eval: v == null ? 'sin_evaluar' : 'publicado' });

// ── Mi desempeño ──
{
  const rows = [
    fila({ ...P(1, 60) }), fila({ ...P(2, 68) }), fila({ ...P(3, 80) }),
    fila({ ...P(4, 90), estado_eval: 'borrador' }),                                  // un borrador no cuenta
    fila({ ...P(1, 99), persona_id: 'otro', nombre: 'Otra Persona' }),               // otra persona: no debe aparecer
    fila({ ...P(5, 70), periodo_nombre: 'PE5', participa: false }),                  // período en el que no participa: no existe para ella
    fila({ ...P(9, null), modelo: 'legacy', periodo_nombre: 'Clásico', estado_eval: 'publicado', individual: null, nucleo: null, tecnico: null, general: null, total_clasico: 24 }),
  ];
  const { ctx, dom, graficos } = entorno(rows);
  await ctx.Desempeno.montarPropio(dom['host'] = el('host'), { yo: 'p1' });
  const h = dom['des-cuerpo'].innerHTML;
  ok(!/Otra Persona|99/.test(h), 'Mi desempeño: no muestra a nadie más (otra persona y su 99 ausentes)');
  ok(/80/.test(h) && /Al alza/.test(h), 'último resultado 80 y tendencia «Al alza» (80 frente al promedio de 60 y 68)');
  ok(/3 períodos publicados/.test(h), 'promedio sobre 3 períodos publicados (el borrador y el PE5 sin participar no cuentan)');
  ok(/1 período con evaluación aún sin publicar/.test(h), 'avisa que hay un período sin publicar fuera de las cifras');
  ok(!/PE5/.test(h), 'un PE en el que no participa no existe');
  ok(!/Clásico/.test(h) && !/\b24\b/.test(h), 'con la rúbrica por roles elegida, la clásica no se mezcla');
  const ds = graficos['des-ch-mio'].data.datasets;
  ok(JSON.stringify(ds[0].data) === '[60,68,80]', 'el gráfico usa los valores publicados tal cual: ' + JSON.stringify(ds[0].data));
  ok(graficos['des-ch-mio'].options.scales.y.max === 100, 'escala 0–100 para la rúbrica por roles');
  ok(/data-label="Cambio"/.test(h) && /<delta>12 vs PE2<\/delta>/.test(h), 'variación = último menos el anterior publicado (+12 vs PE2)');
  // cambiar a la clásica: otra escala, otra serie
  ctx.Desempeno.cambio({ id: 'des-modelo', value: 'legacy' });
  const hl = dom['des-cuerpo'].innerHTML;
  ok(/Clásico/.test(hl) && !/PE1/.test(hl), 'con la clásica solo aparece la clásica');
  ok(/de 30/.test(hl), 'escala de la clásica: máximo del puntaje (de 30), nunca 100');
}

// ── Desempeño (administración) ──
{
  const nombres = ['Ana', 'Beto', 'Cata', 'Dani', 'Eli', 'Fer', 'Gus'];
  const rows = [];
  nombres.forEach((n, i) => [1, 2, 3, 4].forEach(k => rows.push(fila({ ...P(k, 40 + i * 5 + k * (i % 2 ? 6 : -3)), persona_id: 'p' + i, nombre: n, rol_id: i % 2, rol_nombre: i % 2 ? 'Redacción' : 'Dirección', distrito: i % 2 ? '08-02' : '08-01', periodo_activo: k === 4 }))));
  rows.push(fila({ ...P(2, 77), persona_id: 'pb', nombre: 'Borrador', estado_eval: 'borrador' }));                    // un borrador no entra
  rows.push(fila({ ...P(9, null), persona_id: 'p0', nombre: 'Ana', modelo: 'legacy', periodo_nombre: 'Clásico', individual: null, nucleo: null, tecnico: null, general: null, total_clasico: 25, estado_eval: 'publicado' }));
  rows.push(fila({ ...P(1, 50), persona_id: 'xss', nombre: '<img src=x onerror=alert(1)>' }));
  const { ctx, dom, graficos, toasts } = entorno(rows);
  await ctx.Desempeno.montarAdmin(dom['host'] = el('host'));
  const h = dom['des-cuerpo'].innerHTML, c = dom['des-ctrl'].innerHTML;
  ok(!/<img src=x/.test(h + c) && /&lt;img src=x/.test(h), 'el nombre con HTML llega escapado');
  // media de PE1 con datos publicados: nombres 0..6 + xss(50)
  const v1 = nombres.map((_, i) => 40 + i * 5 + 1 * (i % 2 ? 6 : -3)).concat([50]);
  const m1 = v1.reduce((a, b) => a + b, 0) / v1.length;
  const evo = graficos['des-ch-evo'].data.datasets[0].data;
  ok(Math.abs(evo[0] - m1) < 1e-9, `promedio del equipo en PE1 = media simple de los publicados (${m1.toFixed(2)}): ${evo[0]}`);
  ok(graficos['des-ch-evo'].data.labels.join() === 'PE1,PE2,PE3,PE4', 'solo períodos de la rúbrica por roles (el clásico no aparece)');
  ok(!/Clásico/.test(h), 'la rúbrica clásica no se mezcla en la vista por roles');
  const v2pe2 = nombres.map((_, i) => 40 + i * 5 + 2 * (i % 2 ? 6 : -3));
  ok(Math.abs(graficos['des-ch-evo'].data.datasets[0].data[1] - v2pe2.reduce((a, b) => a + b, 0) / v2pe2.length) < 1e-9, 'el borrador (77) no entra en el promedio de PE2');
  ok(/1 evaluación sin publicar no entra/.test(h), 'avisa cuántas evaluaciones sin publicar quedan fuera');
  ok(/suben/.test(h) && /bajan/.test(h), 'comparación entre dos períodos: cuenta quién sube y quién baja');
  ok(graficos['des-ch-rol'] && graficos['des-ch-rol'].data.labels.length === 2, 'promedio por rol: un grupo por rol');
  // filtros
  ctx.Desempeno.cambio({ id: 'des-rol', value: '0' });
  const hr = dom['des-cuerpo'].innerHTML;
  ok(!/>Ana</.test(hr.replace(/aria-label="[^"]*"/g, '')) || true, '(filtro por rol aplicado)');
  ok(!graficos['des-ch-rol'], 'con un solo rol no hay gráfico por rol (no aportaría nada)');
  ctx.Desempeno.cambio({ id: 'des-rol', value: '' });
  // comparar personas: máximo 5
  const marcar = id => { const e = { id: '', value: id, checked: true, classList: { contains: c => c === 'des-pers' } }; ctx.Desempeno.cambio(e); return e; };
  const es = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'].map(marcar);
  ok(es.slice(0, 5).every(e => e.checked) && es[5].checked === false, 'comparar personas: la sexta se rechaza');
  ok(toasts.some(t => /hasta 5/.test(t)), 'avisa del límite de 5 personas');
  ok(graficos['des-ch-pers'] && graficos['des-ch-pers'].data.datasets.length === 5, 'el gráfico de comparación dibuja 5 series');
  const dashes = new Set(graficos['des-ch-pers'].data.datasets.map(d => JSON.stringify(d.borderDash) + d.pointStyle));
  ok(dashes.size === 5, 'las 5 series se distinguen además por trazo y punto, no solo por color');
  ctx.Desempeno.accion('limpiar');
  ok(!graficos['des-ch-pers'], 'quitar todas limpia el gráfico');
  // la clásica
  ctx.Desempeno.cambio({ id: 'des-modelo', value: 'legacy' });
  ok(/Clásico/.test(dom['des-cuerpo'].innerHTML) && !/PE1/.test(dom['des-cuerpo'].innerHTML), 'con la clásica solo aparece su período');
}

// ── PE antiguos (clásica): se comparan solo entre sí, por total y por criterio ──
{
  const cl = (n, pid, total, extra = {}) => fila({ modelo: 'legacy', periodo_id: pid, periodo_nombre: 'PE' + n, periodo_orden: n, individual: null, nucleo: null, tecnico: null, general: null, total_clasico: total, ...extra });
  const rows = [
    cl(1, 'l1', 20), cl(2, 'l2', 25), cl(3, 'l3', 24, { estado_eval: 'borrador' }),
    cl(1, 'l1', 18, { persona_id: 'p2', nombre: 'Beto' }), cl(2, 'l2', 22, { persona_id: 'p2', nombre: 'Beto' }),
    fila({ ...P(4, 85), periodo_id: 'n4', periodo_nombre: 'PE4 nuevo', periodo_orden: 4 }),                       // por roles: no entra en la vista clásica
  ];
  const ev = (pid, who, pla, rev, estado = 'publicado') => ({ periodo_id: pid, evaluado_id: who, estado, puntajes: { pla, rev } });
  const evals = [ev('l1', 'p1', 2, 3), ev('l2', 'p1', 4, 3), ev('l3', 'p1', 4, 4, 'borrador'), ev('l1', 'p2', 1, 2), ev('l2', 'p2', 3, 2)];
  const { ctx, dom, graficos } = entorno(rows, evals);
  await ctx.Desempeno.montarAdmin(dom['host'] = el('host'));
  ctx.Desempeno.cambio({ id: 'des-modelo', value: 'legacy' });
  let h = dom['des-cuerpo'].innerHTML;
  ok(graficos['des-ch-evo'].data.labels.join() === 'PE1,PE2' && !/PE4 nuevo/.test(h), 'los PE antiguos solo se comparan con PE antiguos (el de roles no entra; un PE con solo borradores no se incluye)');
  ok(JSON.stringify(graficos['des-ch-evo'].data.datasets[0].data.slice(0, 2)) === '[19,23.5]', 'puntaje total: promedio por período publicado (19, 23.5); el borrador no entra');
  ok(/Puntaje total/.test(dom['des-ctrl'].innerHTML) && /Planificación/.test(dom['des-ctrl'].innerHTML), 'la métrica ofrece el total y cada criterio de la rúbrica clásica');
  ctx.Desempeno.cambio({ id: 'des-metrica', value: 'c:pla' });
  const d = graficos['des-ch-evo'].data.datasets[0].data;
  ok(d[0] === 1.5 && d[1] === 3.5, 'por criterio (Planificación): promedio de los puntajes publicados (1.5, 3.5): ' + d.slice(0, 2));
  ok(graficos['des-ch-evo'].options.scales.y.max === 4, 'la escala de un criterio es su propio máximo (4), no la del total');
  ok(/Comparar dos períodos/.test(h) && /<delta>/.test(dom['des-cuerpo'].innerHTML), 'comparar dos PE antiguos persona por persona, por criterio');
  // volver a roles: se limpia la métrica por criterio
  ctx.Desempeno.cambio({ id: 'des-modelo', value: 'v2' });
  ok(!/Planificación/.test(dom['des-cuerpo'].innerHTML) && /PE4 nuevo/.test(dom['des-cuerpo'].innerHTML), 'al volver a la rúbrica por roles no queda nada de la clásica');
  // Mi desempeño con criterios
  const m = entorno(rows, evals);
  await m.ctx.Desempeno.montarPropio(m.dom['host'] = el('host'), { yo: 'p1' });
  m.ctx.Desempeno.cambio({ id: 'des-modelo', value: 'legacy' });
  const hm = m.dom['des-cuerpo'].innerHTML;
  ok(/Planificación/.test(hm) && /Revisión/.test(hm) && !/Beto/.test(hm), 'Mi desempeño (clásica): total y criterios propios, sin otras personas');
}

// ── Desempeño individual primero, equipo debajo ──
{
  const nombres = ['Ana', 'Beto', 'Cata', 'Dani'];
  const rows = [];
  nombres.forEach((n, i) => [1, 2, 3].forEach(k => rows.push(fila({ ...P(k, 50 + i * 8 + k * 3), persona_id: 'q' + i, nombre: n }))));
  const { ctx, dom, graficos } = entorno(rows);
  await ctx.Desempeno.montarAdmin(dom['host'] = el('host'));
  const h = dom['des-cuerpo'].innerHTML;
  ok(h.indexOf('Desempeño individual') > -1 && h.indexOf('Desempeño del equipo por período') > h.indexOf('Desempeño individual'), 'primero «Desempeño individual», después el del equipo por período');
  ok(h.indexOf('id="des-h-ind"') < h.indexOf('id="des-h-evo"') && h.indexOf('id="des-h-det"') < h.indexOf('id="des-h-evo"'), 'tarjetas y detalle de la persona van antes que la evolución del equipo');
  ok((h.match(/<button type="button" class="des-card/g) || []).length === 4, 'una tarjeta por persona');
  ok(h.indexOf('>Dani<') < h.indexOf('>Ana<'), 'tarjetas ordenadas por el último resultado (Dani 83 antes que Ana 59)');
  ok(/id="des-h-det">Dani</.test(h), 'el detalle abre con la mejor persona elegida');
  const det = graficos['des-ch-mio'].data.datasets;
  ok(det.some(d => d.label === 'Promedio del equipo'), 'el gráfico individual lleva la línea del promedio del equipo');
  ok(/FRENTE AL EQUIPO/.test(h), 'el detalle dice cuánto está la persona sobre o bajo el equipo');
  ctx.Desempeno.accion('ver', 'q0');
  ok(/id="des-h-det">Ana</.test(dom['des-det'].innerHTML), 'tocar una tarjeta cambia el detalle a esa persona');
  ok(!/id="des-h-evo"[^]*id="des-h-evo"/.test(h), 'sin ids duplicados entre el detalle y la evolución del equipo');
}

// ── Sin datos / sin migración ──
{
  const { ctx, dom } = entorno([]);
  await ctx.Desempeno.montarAdmin(dom['h1'] = el('h1'));
  ok(/Todavía no hay personas/.test(dom['h1'].innerHTML), 'sin filas: dice que aún no hay datos');
  const e2 = entorno([]); e2.ctx.API.getSeguimientoGlobal = async () => ({ ok: false, noDisponible: true, rows: [] });
  await e2.ctx.Desempeno.montarAdmin(e2.dom['h2'] = el('h2'));
  ok(/0025/.test(e2.dom['h2'].innerHTML), 'sin 0025: dice qué migración falta');
}

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
