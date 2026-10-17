'use strict';
/**
 * EIGHT CREATORS LABs — Panel de la administración
 * ────────────────────────────────────────────────
 * Cada gráfico responde una pregunta (ver docs/estudio-uiux-evaluacion.md):
 *   ¿cómo va el avance?           → anillo + embudo
 *   ¿cómo se distribuye el equipo? → histograma por nivel
 *   ¿hay diferencias?              → barras por rol / por distrito (calibración)
 *   ¿qué tan equilibrado es?       → radar de competencias
 *   ¿estamos mejorando?            → línea entre períodos
 *   ¿dónde está fuerte o débil?    → mapa de calor persona × competencia
 * Sirve a los dos modelos: la rúbrica por roles (1–5, calculada en la base) y la
 * clásica (0–4 + bono), llevadas a 0–100 SOLO para dibujar. Los niveles son los
 * de NIVELES_V2 (87/67/37), equivalentes a los 26/20/11 de 30 de la clásica.
 * No calcula puntajes oficiales: lee resultados_periodo() (v2) o la fórmula
 * existente (clásica).
 * Depende de: admin.js (globals), core/charts.js, core/rubrica.js, core/ui.js.
 */
const PanelAdmin = (() => {
  const _cache = new Map();   // periodoId -> datos (para la tendencia)
  let _ctx = null;            // datos del período en pantalla
  let _vistaCmp = 'rol';

  const NIV = { sex: 'Excelente', sbu: 'Bueno', spr: 'En proceso', sba: 'Bajo' };
  const nivelKey = s => nivelV2(s).key;

  /** Normaliza un período a filas {id, nombre, rolId, rolNombre, distrito, score, est, comp:{key:{nombre,valor100}}}. */
  async function datos(p) {
    if (_cache.has(p.id)) return _cache.get(p.id);
    const v2 = esPeriodoV2(p);
    const evs = await API.getEvaluacionesByPE(p.id);
    const pub = (evs || []).filter(e => e.estado === 'publicado');
    let filas = [];
    if (v2) {
      const res = await API.getResultadosV2(p.id);
      const porId = Object.fromEntries((res.rows || []).map(r => [r.evaluado_id, r]));
      const nucleo = _criteriosV2.filter(c => c.tipo === 'nucleo' && tipoCampoDe(c) === 'escala');   // los campos de registro no puntúan
      filas = pub.map(e => {
        const r = porId[e.evaluado_id]; if (!r) return null;
        const pj = parseJSON(e.puntajes);
        const comp = {};
        nucleo.forEach(c => { if (pj[c.key] != null) comp[c.key] = { nombre: c.nombre, v: (Number(pj[c.key]) - 1) / 4 * 100 }; });
        return { id: e.evaluado_id, score: Number(r.individual ?? 0), rolNombre: r.rol_nombre || '', comp, nucleo: r.nucleo, tecnico: r.tecnico };
      }).filter(Boolean);
    } else {
      const crit = getCriterios();
      const MAX = crit.length * 4 + 2;
      filas = pub.map(e => {
        const pj = parseJSON(e.puntajes);
        const comp = {};
        crit.forEach(c => { if (pj[c.key] != null) comp[c.key] = { nombre: c.label, v: Number(pj[c.key]) / 4 * 100 }; });
        return { id: e.evaluado_id, score: calcScorePuntajes(e.puntajes, e.bono_ext) / MAX * 100, comp };
      });
    }
    filas.forEach(f => {
      const u = _users.find(x => x.id === f.id) || {};
      f.nombre = u.nombre || '—';
      f.rolId = u.rol_id; f.rolNombre = f.rolNombre || u.roles?.nombre || 'Sin rol';
      f.distrito = (_distritos.find(d => String(d.id) === String(u.distrito)) || {}).nombre || 'Sin distrito';
    });
    const out = { periodo: p, v2, evs: evs || [], filas };
    _cache.set(p.id, out);
    return out;
  }

  const prom = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const f1 = n => n == null ? '—' : (Math.round(n * 10) / 10).toString().replace('.', ',');
  const tarjeta = (cls, tit, desc, cuerpo) => `<section class="tarjeta panel-t ${cls}" aria-label="${escHtml(tit)}">
    <div class="panel-t-cab"><h3 class="panel-t-h">${escHtml(tit)}</h3>${desc ? `<p class="panel-t-d">${escHtml(desc)}</p>` : ''}</div>${cuerpo}</section>`;

  async function montar(el, periodo) {
    el.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';
    const d = await datos(periodo);
    _ctx = d;
    const part = await API.getParticipantes(periodo.id).catch(() => []);
    const inactivos = new Set((part || []).filter(r => !r.activo).map(r => r.user_id));
    const evaluables = _users.filter(u => !u.es_admin && u.aprobado !== false && !inactivos.has(u.id));
    const borr = d.evs.filter(e => e.estado === 'borrador' && !inactivos.has(e.evaluado_id)).length;
    const pubN = d.filas.length;
    const pend = Math.max(0, evaluables.length - pubN - borr);
    const media = prom(d.filas.map(f => f.score));
    const mejor = d.filas.length ? Math.max(...d.filas.map(f => f.score)) : null;
    const pctPub = evaluables.length ? pubN / evaluables.length * 100 : 0;

    const dist = { sex: 0, sbu: 0, spr: 0, sba: 0 };
    d.filas.forEach(f => { dist[nivelKey(f.score)]++; });

    const kpi = (n, l, s) => `<div class="tarjeta tarjeta--kpi"><span class="kpi-num">${n}</span><span class="kpi-etq">${escHtml(l)}</span>${s ? `<span class="kpi-sub">${s}</span>` : ''}</div>`;
    el.innerHTML = `
      <div class="panel-kpis">
        ${kpi(`${pubN}<small>/${evaluables.length}</small>`, 'Evaluaciones publicadas', borr ? `${borr} en borrador` : '')}
        ${kpi(f1(media), 'Promedio del equipo', 'sobre 100')}
        ${kpi(f1(mejor), 'Mejor resultado', 'sobre 100')}
        ${kpi(String(pend), 'Sin evaluar', pend ? 'pendientes de puntuar' : 'todo puntuado')}
      </div>
      <div class="panel-grid">
        ${tarjeta('panel-t--avance', 'Avance del período', 'Cuántas personas ya tienen su resultado publicado.', `
          <div class="avance">
            ${anilloHTML({ valor: pctPub, max: 100, color: 'var(--data)', etiqueta: `${Math.round(pctPub)} % publicado`, decimales: 0 })}
            <ul class="avance-lista">
              <li><span class="punto" style="--etq:var(--etq-verde)"></span><b>${pubN}</b> publicadas</li>
              <li><span class="punto" style="--etq:var(--etq-ambar)"></span><b>${borr}</b> en borrador</li>
              <li><span class="punto" style="--etq:var(--etq-gris)"></span><b>${pend}</b> sin evaluar</li>
            </ul>
          </div>`)}
        ${tarjeta('', 'Distribución por nivel', 'Cuántas personas hay en cada nivel de resultado.', `
          <div class="chart-wrap" style="height:230px"><canvas id="pn-dist" aria-labelledby="pn-dist-alt"></canvas></div>
          <p class="chart-alt" id="pn-dist-alt">${Object.keys(NIV).map(k => `${NIV[k]}: ${dist[k]}`).join(' · ')}.</p>`)}
        ${tarjeta('panel-t--ancha', 'Comparación', 'Para calibrar: ¿el equipo se mide parecido entre roles y distritos?', `
          <div class="panel-seg" id="pn-cmp-seg"></div>
          <div class="chart-wrap" style="height:280px"><canvas id="pn-cmp" aria-labelledby="pn-cmp-alt"></canvas></div>
          <p class="chart-alt" id="pn-cmp-alt"></p>`)}
        ${tarjeta('', d.v2 ? 'Competencias comunes' : 'Criterios', 'Promedio del equipo en cada una, de 0 a 100.', `
          <div class="chart-wrap" style="height:300px"><canvas id="pn-radar" aria-labelledby="pn-radar-alt"></canvas></div>
          <p class="chart-alt" id="pn-radar-alt"></p>`)}
        ${tarjeta('', '¿Estamos mejorando?', 'Promedio del equipo en cada período con resultados.', `
          <div class="chart-wrap" style="height:300px"><canvas id="pn-tend" aria-labelledby="pn-tend-alt"></canvas></div>
          <p class="chart-alt" id="pn-tend-alt">Calculando…</p>`)}
        ${tarjeta('panel-t--ancha', 'Mapa de calor', `Cada fila es una persona y cada columna, una ${d.v2 ? 'competencia común' : 'criterio'}. El color es el nivel.`, mapaCalor(d))}
        ${tarjeta('panel-t--ancha', 'Los mejores resultados', '', ranking(d))}
      </div>`;
    renderIconos(el);
    dibujar(d, dist);
    tendencia();
  }

  function dibujar(d, dist) {
    if (typeof pintarGrafico !== 'function') return;
    const nivC = k => token('--' + k);
    pintarGrafico('pn-dist', () => ({
      type: 'bar',
      data: { labels: Object.values(NIV), datasets: [{ data: Object.keys(NIV).map(k => dist[k]), backgroundColor: Object.keys(NIV).map(nivC), borderRadius: 10, maxBarThickness: 64 }] },
      options: { plugins: { legend: { display: false } }, interaction: { mode: 'nearest', intersect: true }, scales: { y: { ticks: { precision: 0 } } } },
    }));
    comparacion();
    // Radar
    const claves = {};
    d.filas.forEach(f => Object.entries(f.comp).forEach(([k, c]) => { (claves[k] ||= { nombre: c.nombre, vals: [] }).vals.push(c.v); }));
    const ejes = Object.values(claves);
    const alt = document.getElementById('pn-radar-alt');
    if (alt) alt.textContent = ejes.length ? ejes.map(e => `${e.nombre}: ${f1(prom(e.vals))}`).join(' · ') + '.' : 'Sin datos todavía.';
    if (ejes.length >= 3) {
      pintarGrafico('pn-radar', () => ({
        type: 'radar',
        data: { labels: ejes.map(e => e.nombre), datasets: [{ label: 'Promedio del equipo', data: ejes.map(e => Math.round(prom(e.vals))), borderColor: token('--data'), backgroundColor: conAlfa(token('--data'), .22), pointBackgroundColor: token('--data') }] },
        options: { plugins: { legend: { display: false } }, scales: { r: { min: 0, max: 100, ticks: { display: false, stepSize: 25 }, grid: { color: token('--border') }, angleLines: { color: token('--border') }, pointLabels: { color: token('--txt-2'), font: { family: 'Barlow, system-ui, sans-serif', size: 12 } } } } },
      }));
    } else {
      const w = document.getElementById('pn-radar')?.closest('.chart-wrap'); if (w) w.innerHTML = '<p class="chart-fallback">Hacen falta al menos tres competencias con datos.</p>';
    }
  }

  function comparacion() {
    if (!_ctx) return;
    const seg = document.getElementById('pn-cmp-seg');
    if (seg) { seg.innerHTML = segHTML([{ k: 'rol', etiqueta: 'Por rol' }, { k: 'distrito', etiqueta: 'Por distrito' }], _vistaCmp, 'panelCmp', { etiqueta: 'Comparar por', prefijo: 'pcmp' }); }
    const grupos = {};
    _ctx.filas.forEach(f => { const k = _vistaCmp === 'rol' ? f.rolNombre : f.distrito; (grupos[k] ||= []).push(f.score); });
    const lista = Object.entries(grupos).map(([n, v]) => ({ n, m: prom(v), c: v.length })).sort((a, b) => b.m - a.m);
    const alt = document.getElementById('pn-cmp-alt');
    if (alt) alt.textContent = lista.length ? lista.map(g => `${g.n}: ${f1(g.m)} (${g.c} persona${g.c === 1 ? '' : 's'})`).join(' · ') + '.' : 'Sin datos todavía.';
    if (!lista.length) return;
    pintarGrafico('pn-cmp', () => ({
      type: 'bar',
      data: { labels: lista.map(g => `${g.n} (${g.c})`), datasets: [{ data: lista.map(g => Math.round(g.m * 10) / 10), backgroundColor: lista.map(g => token('--' + nivelKey(g.m))), borderRadius: 10, maxBarThickness: 34 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, interaction: { mode: 'nearest', intersect: true }, scales: { x: { min: 0, max: 100, beginAtZero: true }, y: { beginAtZero: false } } },
    }));
  }

  async function tendencia() {
    const alt = document.getElementById('pn-tend-alt');
    const ps = [..._periodos].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es', { numeric: true }));   // del más antiguo al más reciente
    const pts = [];
    for (const p of ps) {
      try { const d = await datos(p); if (d.filas.length) pts.push({ n: p.nombre, m: prom(d.filas.map(f => f.score)), x: Math.max(...d.filas.map(f => f.score)) }); } catch { /* ese período no se dibuja */ }
    }
    if (!document.getElementById('pn-tend')) return;
    if (pts.length < 2) {
      const w = document.getElementById('pn-tend').closest('.chart-wrap'); if (w) w.innerHTML = '<p class="chart-fallback">Hace falta más de un período con resultados para ver la tendencia.</p>';
      if (alt) alt.textContent = pts.length ? `Solo hay resultados en ${pts[0].n}.` : 'Sin resultados todavía.';
      return;
    }
    if (alt) alt.textContent = pts.map(p => `${p.n}: promedio ${f1(p.m)}, mejor ${f1(p.x)}`).join(' · ') + '.';
    pintarGrafico('pn-tend', () => ({
      type: 'line',
      data: { labels: pts.map(p => p.n), datasets: [
        { label: 'Promedio', data: pts.map(p => Math.round(p.m * 10) / 10), borderColor: token('--data'), backgroundColor: conAlfa(token('--data'), .18), fill: true, tension: .3, pointRadius: 5 },
        { label: 'Mejor', data: pts.map(p => Math.round(p.x * 10) / 10), borderColor: token('--cyan-200'), borderDash: [6, 5], tension: .3, pointRadius: 4, fill: false },
      ] },
      options: { scales: { y: { min: 0, max: 100 } } },
    }));
  }

  function mapaCalor(d) {
    if (!d.filas.length) return '<p class="cfg-hint">Aún no hay evaluaciones publicadas en este período.</p>';
    const ejes = []; d.filas.forEach(f => Object.entries(f.comp).forEach(([k, c]) => { if (!ejes.some(e => e.k === k)) ejes.push({ k, n: c.nombre }); }));
    const filas = [...d.filas].sort((a, b) => b.score - a.score).slice(0, 40);
    return `<div class="mc-wrap"><table class="mc" aria-label="Mapa de calor de competencias por persona">
      <thead><tr><th scope="col">Persona</th>${ejes.map(e => `<th scope="col"><span>${escHtml(e.n)}</span></th>`).join('')}<th scope="col">Total</th></tr></thead>
      <tbody>${filas.map(f => `<tr><th scope="row">${escHtml(f.nombre)}<small>${escHtml(f.rolNombre)}</small></th>${ejes.map(e => {
        const v = f.comp[e.k]?.v;
        return v == null ? '<td class="mc-vacio">—</td>' : `<td class="mc-${nivelKey(v)}" title="${escHtml(e.n)}: ${NIV[nivelKey(v)]}">${Math.round(v)}</td>`;
      }).join('')}<td class="mc-total">${f1(f.score)}</td></tr>`).join('')}</tbody></table></div>
      <div class="mc-leyenda">${Object.keys(NIV).map(k => `<span class="etiqueta" style="--etq:var(--${k})">${NIV[k]}</span>`).join('')}</div>`;
  }

  function ranking(d) {
    if (!d.filas.length) return '<p class="cfg-hint">Aún no hay resultados publicados.</p>';
    const top = [...d.filas].sort((a, b) => b.score - a.score).slice(0, 10);
    return `<div class="lista-aj">${top.map((f, i) => `
      <button type="button" class="fila-aj" data-act="perfilVer" data-arg="${escHtml(f.id)}">
        <span class="fila-aj-med">${medallaHTML(i + 1)}</span>
        <div class="fila-aj-txt"><div class="fila-aj-t">${escHtml(f.nombre)}</div><div class="fila-aj-d">${escHtml(f.rolNombre)} · ${escHtml(f.distrito)}</div></div>
        <span class="fila-aj-ind">${f1(f.score)}</span>
        <span class="nivel-badge ${nivelKey(f.score)}">${NIV[nivelKey(f.score)]}</span>
      </button>`).join('')}</div>`;
  }

  /** Después de guardar o publicar una evaluación el panel debe leer de nuevo. */
  function invalidar(id) { if (id) _cache.delete(id); else _cache.clear(); }
  function setVista(v) { _vistaCmp = v; comparacion(); }
  return { montar, invalidar, setVista, datos };
})();
