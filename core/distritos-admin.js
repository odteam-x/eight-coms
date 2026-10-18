'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
 * EIGHT CREATORS LABs — Distritos (administración)
 *
 * Pantalla «Distritos»: un ranking ACUMULADO de todos los distritos (una columna por PE, total, promedio sobre 28 y porcentaje),
 * el promedio de cada período y el global, con filtros de pendientes (sin evaluar · en borrador · sin estadísticas) y exportación a CSV.
 * Al abrir un distrito se ve su panel: Resumen · Evaluación · Estadísticas · Personas.
 *
 *   DistritosAdmin.montar(host, getCtx)                              guarda cómo leer el contexto (no consulta nada hasta abrir la pestaña)
 *   DistritosAdmin.abrir()                                           carga y pinta (cada vez que se vuelve a la pestaña)
 *   DistritosAdmin.refrescar()                                       tras guardar una evaluación
 *
 * El cálculo vive en core/distritos.js (consolidar, probado). El formulario de evaluación sigue siendo el de admin.js
 * (loadDistEval / saveDistEval): aquí solo se le da un lugar dentro del panel. Nada de esto escribe en la base.
 * ═══════════════════════════════════════════════════════════════════════════ */
const DistritosAdmin = (() => {
  const { MAX, COMP, consolidar, puntaje, nivel, f2, fPct, nomPE, aObj } = Distritos;
  let A = null;

  const sinEXT = ds => (ds || []).filter(d => d.activo !== false);
  const focoDe = D => D.incl[D.incl.length - 1] || A.periodos.find(p => p.activo) || A.periodos[A.periodos.length - 1] || null;

  /** `getCtx()` devuelve { periodos, distritos, usuarios } vigentes: admin.js reasigna esas listas, así que se leen al abrir, no al montar. */
  function montar(host, getCtx) {
    A = { host, getCtx, periodos: [], distritos: [], usuarios: [], evals: [], est: [], estOk: true, incl: null, q: '', filtro: '', panel: null, cargado: false, n: 0 };
  }

  async function abrir() {
    if (!A?.host) return;
    const n = ++A.n;
    const c = A.getCtx();
    A.periodos = c.periodos || []; A.distritos = sinEXT(c.distritos); A.usuarios = c.usuarios || [];
    if (!A.cargado) renderCargando(A.host);
    const ids = A.periodos.map(p => p.id);
    const [ev, est] = await Promise.all([API.getEvalDistritosByPeriodos(ids), API.getEstadisticasDistritosByPeriodos(ids)]);
    if (!A || A.n !== n) return;
    if (!ev.ok) { A.host.innerHTML = '<p class="pf-vacio">No se pudieron cargar las evaluaciones de los distritos. Inténtalo de nuevo.</p>'; return; }
    A.evals = ev.data; A.est = est.data || []; A.estOk = !!est.ok;   // sin 0043 (o con un error) no se ofrece nada de estadísticas
    A.cargado = true;
    pintar();
    if (A.panel) { if (A.panel.tab === 'evaluacion') { const s = document.getElementById('panel-lateral-sub'); if (s && document.querySelector('.dc-panel')) s.textContent = subPanel(A.panel.id, datos()); } else pintarPanel(); }
  }
  const refrescar = () => abrir();

  /* ── Datos derivados ───────────────────────────────────────────────────── */
  const datos = () => consolidar({ periodos: A.periodos, distritos: A.distritos, evals: A.evals, incluidos: A.incl });
  const evalDe = (peId, dId) => A.evals.find(e => String(e.periodo_id) === String(peId) && e.distrito_id === dId) || null;
  const estDe = (peId, dId) => A.est.find(e => String(e.periodo_id) === String(peId) && e.distrito_id === dId) || null;

  function chipsEstado(f, foco) {
    if (!foco) return '';
    const ev = evalDe(foco.id, f.id), es = estDe(foco.id, f.id);
    const a = !ev ? '<span class="etiqueta etq-gris" title="Sin evaluación">Sin evaluar</span>'
      : ev.estado === 'publicado' ? '<span class="etiqueta etq-verde">Publicada</span>' : '<span class="etiqueta etq-ambar">Borrador</span>';
    const b = !A.estOk ? '' : es ? '<span class="etiqueta etq-azul" title="Estadísticas de Instagram enviadas">IG enviado</span>' : '<span class="etiqueta etq-gris" title="Falta que la secretaría envíe las estadísticas">IG falta</span>';
    return `${a} ${b}`;
  }

  function pasaFiltro(f, foco) {
    if (A.q && !f.nombre.toLowerCase().includes(A.q) && !f.id.toLowerCase().includes(A.q)) return false;
    if (!A.filtro || !foco) return true;
    const ev = evalDe(foco.id, f.id);
    if (A.filtro === 'sin_eval') return !ev || ev.estado !== 'publicado';
    if (A.filtro === 'borrador') return ev?.estado === 'borrador';
    if (A.filtro === 'sin_est') return A.estOk && !estDe(foco.id, f.id);
    return true;
  }

  /* ── Pantalla principal ────────────────────────────────────────────────── */
  function pintar() {
    const D = datos(), foco = focoDe(D);
    const M = A.distritos.filter(d => d.id !== 'EXT').length;
    const mejor = D.ranking[0];
    const enviadas = foco ? A.distritos.filter(d => d.id !== 'EXT' && estDe(foco.id, d.id)).length : 0;
    const kpis = `<div class="dc-kpis">
      <div class="dc-kpi"><span class="dc-kpi-l">Distritos evaluados</span><span class="dc-kpi-v">${D.ranking.length}<small> de ${M}</small></span><span class="dc-kpi-s">con al menos una evaluación publicada</span></div>
      <div class="dc-kpi"><span class="dc-kpi-l">Promedio global</span><span class="dc-kpi-v">${D.global.prom == null ? '—' : f2(D.global.prom)}<small> / ${MAX}</small></span><span class="dc-kpi-s">${D.global.prom == null ? 'Sin evaluaciones publicadas' : `${fPct(D.global.pct)} · ${D.global.n} evaluaciones`}</span></div>
      <div class="dc-kpi"><span class="dc-kpi-l">Mejor distrito</span><span class="dc-kpi-v dc-kpi-v--txt">${mejor ? escHtml(mejor.nombre) : '—'}</span><span class="dc-kpi-s">${mejor ? `${f2(mejor.prom)} de promedio · ${fPct(mejor.pct)}` : 'Aún no hay ranking'}</span></div>
      <div class="dc-kpi"><span class="dc-kpi-l">Estadísticas de Instagram</span><span class="dc-kpi-v">${A.estOk ? enviadas : '—'}<small>${A.estOk ? ` de ${M}` : ''}</small></span><span class="dc-kpi-s">${A.estOk ? `enviadas por las secretarías en ${escHtml(nomPE(foco))}` : 'Aún no activadas en la base (0043)'}</span></div>
    </div>`;

    const chipsPE = A.periodos.map(p => {
      const tiene = A.evals.some(e => e.estado === 'publicado' && String(e.periodo_id) === String(p.id));
      const on = D.incl.some(x => String(x.id) === String(p.id));
      return `<button type="button" class="dc-chip${on ? ' dc-chip--on' : ''}" aria-pressed="${on}" data-act="dist" data-arg="incl" data-arg2="${escHtml(p.id)}"${tiene ? '' : ' disabled'}${tiene ? '' : ' title="Sin evaluaciones publicadas"'}>${escHtml(nomPE(p))}</button>`;
    }).join('');
    const FILTROS = [['', 'Todos'], ['sin_eval', 'Sin evaluar'], ['borrador', 'En borrador']].concat(A.estOk ? [['sin_est', 'Sin estadísticas']] : []);
    const filtros = FILTROS.map(([k, t]) => `<button type="button" class="dc-chip${A.filtro === k ? ' dc-chip--on' : ''}" aria-pressed="${A.filtro === k}" data-act="dist" data-arg="filtro" data-arg2="${k}">${t}</button>`).join('');

    const filas = [...D.ranking, ...D.sinDatos.filter(f => f.id !== 'EXT')].filter(f => pasaFiltro(f, foco));
    const cab = `<tr><th scope="col" class="dc-c-pos">#</th><th scope="col">Distrito</th>${D.incl.map(p => `<th scope="col" class="dc-c-num">${escHtml(nomPE(p))}</th>`).join('')}
      <th scope="col" class="dc-c-num">Total <small>(de ${MAX * D.incl.length})</small></th><th scope="col" class="dc-c-num">Promedio <small>(sobre ${MAX})</small></th><th scope="col">Porcentaje</th><th scope="col">Estado${foco ? ` <small>${escHtml(nomPE(foco))}</small>` : ''}</th></tr>`;
    const cuerpo = filas.map(f => {
      const rc = f.pos === 1 ? 'gold' : f.pos === 2 ? 'silver' : f.pos === 3 ? 'bronze' : '';
      const nv = f.prom == null ? null : nivel(f.prom);
      return `<tr class="dc-fila${f.n ? '' : ' dc-fila--vacia'}" data-act="dist" data-arg="abrir" data-arg2="${escHtml(f.id)}">
        <td class="dc-c-pos" data-label="Posición">${f.pos ? `<span class="rank-num ${rc}">${f.pos}</span>` : '<span class="dc-mut">—</span>'}</td>
        <th scope="row" data-label="Distrito"><button type="button" class="dc-nombre" data-act="dist" data-arg="abrir" data-arg2="${escHtml(f.id)}">${escHtml(f.nombre)}</button></th>
        ${f.puntos.map((v, i) => `<td class="dc-c-num" data-label="${escHtml(nomPE(D.incl[i]))}">${v == null ? '<span class="dc-mut">—</span>' : `<span class="dc-nota-n dc-nv-${nivel(v).c}">${v}</span>`}</td>`).join('')}
        <td class="dc-c-num" data-label="Total">${f.n ? f.total : '<span class="dc-mut">—</span>'}</td>
        <td class="dc-c-num" data-label="Promedio">${f.n ? `<b>${f2(f.prom)}</b>` : '<span class="dc-mut">—</span>'}</td>
        <td data-label="Porcentaje">${f.n ? `<div class="dc-pct"><span>${fPct(f.pct)}</span><i style="--w:${(f.pct * 100).toFixed(2)}%" class="dc-nv-bg-${nv.c}"></i></div>` : '<span class="dc-mut">Sin evaluaciones publicadas</span>'}</td>
        <td class="dc-estado" data-label="Estado">${chipsEstado(f, foco)}</td></tr>`;
    }).join('');
    const tabla = filas.length ? `<div class="dc-tabla-wrap"><table class="dc-tabla dc-tabla--rank"><caption class="sr-only">Promedio por distrito, de mayor a menor</caption><thead>${cab}</thead><tbody>${cuerpo}</tbody></table></div>`
      : `<div class="empty-box"><div class="empty-txt">${A.q ? `Ningún distrito coincide con «${escHtml(A.q)}».` : 'Ningún distrito cumple ese filtro.'}</div></div>`;

    const porPe = D.porPeriodo.map(x => `<li class="dc-pp${x.n ? '' : ' dc-pp--vacio'}"><span class="dc-pp-n">${escHtml(nomPE(x.periodo))}</span>
      ${x.n ? `<span class="dc-pp-bar" aria-hidden="true"><i style="--w:${(x.pct * 100).toFixed(2)}%"></i></span><span class="dc-pp-v"><b>${f2(x.prom)}</b> / ${MAX} <span class="dc-mut">(${fPct(x.pct)}) · ${x.n} ${x.n === 1 ? 'distrito' : 'distritos'}</span></span>`
        : '<span class="dc-pp-v dc-mut">Sin evaluaciones publicadas</span>'}</li>`).join('');

    A.host.innerHTML = `<div class="dc">
      ${kpis}
      <section class="dc-sec" aria-labelledby="dc-rk-t">
        <div class="dc-cab"><h2 class="cuenta-t" id="dc-rk-t">Promedio por distrito <small>(de mayor a menor)</small></h2>
          <button type="button" class="btn-out" data-act="dist" data-arg="csv"><i data-lucide="download" aria-hidden="true"></i>Exportar CSV</button></div>
        <div class="dc-ctl"><div class="dc-ctl-grupo" role="group" aria-label="Períodos incluidos en el ranking"><span class="dc-ctl-l">Períodos</span>${chipsPE}</div>
          <div class="dc-ctl-grupo" role="group" aria-label="Filtrar distritos"><span class="dc-ctl-l">Mostrar</span>${filtros}</div>
          <input class="search-inp dc-buscar" type="search" id="dc-buscar" placeholder="Buscar distrito…" aria-label="Buscar distrito" value="${escHtml(A.q)}" data-input="distBuscar"></div>
        ${tabla}
        <p class="dc-nota">Solo cuentan evaluaciones <b>publicadas</b>. El promedio es el total ÷ los períodos en que el distrito fue evaluado. Los empates comparten posición. Toca un distrito para ver su panel.</p>
      </section>
      <section class="dc-sec" aria-labelledby="dc-pp-t"><h2 class="cuenta-t" id="dc-pp-t">Promedio general por período</h2>
        <ul class="dc-pps">${porPe}</ul>
        <p class="dc-global">Promedio global acumulado: <b>${D.global.prom == null ? '—' : `${f2(D.global.prom)} / ${MAX} puntos (${fPct(D.global.pct)})`}</b></p></section>
    </div>`;
    renderIconos(A.host);
  }

  /* ── Panel de un distrito ──────────────────────────────────────────────── */
  const TABS = [{ k: 'resumen', etiqueta: 'Resumen', icono: 'bar-chart-2' }, { k: 'evaluacion', etiqueta: 'Evaluación', icono: 'clipboard-list' },
    { k: 'estadisticas', etiqueta: 'Estadísticas', icono: 'trending-up' }, { k: 'personas', etiqueta: 'Personas', icono: 'users' }];

  function abrirDistrito(id, tab = 'resumen', peId = null) {
    const d = A.distritos.find(x => x.id === id) || { id, nombre: id };
    const D = datos(), foco = focoDe(D);
    A.panel = { id, tab, peId: peId || foco?.id || null };
    const cuerpo = abrirPanel({ titulo: d.nombre, subtitulo: subPanel(id, D) });
    pintarPanel(true);
  }

  function subPanel(id, D) {
    const f = D.filas.find(x => x.id === id);
    return f && f.n ? `Posición #${f.pos} · promedio ${f2(f.prom)} / ${MAX} · ${fPct(f.pct)}` : 'Sin evaluaciones publicadas todavía';
  }

  function chipsPEPanel(accion) {
    return `<div class="dc-ctl-grupo dc-ctl-grupo--panel" role="group" aria-label="Período"><span class="dc-ctl-l">Período</span>${A.periodos.map(p => {
      const on = String(p.id) === String(A.panel.peId);
      return `<button type="button" class="dc-chip${on ? ' dc-chip--on' : ''}" aria-pressed="${on}" data-act="dist" data-arg="${accion}" data-arg2="${escHtml(p.id)}">${escHtml(nomPE(p))}</button>`;
    }).join('')}</div>`;
  }

  function pintarPanel(forzar = false) {
    if (!A?.panel) return;
    const cuerpo = document.getElementById('panel-lateral-cuerpo');
    // Si la persona abrió otra cosa en el panel (un perfil), un repintado no se lo pisa.
    if (!cuerpo || (!forzar && !cuerpo.querySelector('.dc-panel'))) return;
    const { id, tab } = A.panel, D = datos();
    const f = D.filas.find(x => x.id === id);
    document.getElementById('panel-lateral-sub').textContent = subPanel(id, D);
    cuerpo.innerHTML = `<div class="dc-panel"><div class="dc-panel-seg">${segHTML(TABS, tab, 'distPanelTab', { etiqueta: 'Secciones del distrito', prefijo: 'dp' })}</div><div class="dc-panel-cuerpo" id="dc-panel-cuerpo"></div></div>`;
    renderIconos(cuerpo);
    const c = document.getElementById('dc-panel-cuerpo');
    if (tab === 'resumen') c.innerHTML = tabResumen(id, f, D);
    else if (tab === 'evaluacion') { c.innerHTML = `${chipsPEPanel('pe-eval')}<div id="dist-eval-area"></div>`; if (typeof abrirEvalDistrito === 'function') abrirEvalDistrito(id, A.panel.peId); }
    else if (tab === 'estadisticas') tabEstadisticas(c, id);
    else tabPersonas(c, id);
    renderIconos(c);
  }

  function tabResumen(id, f, D) {
    const hero = f && f.n ? (() => { const nv = nivel(f.prom); return `<div class="dc-hero"><div class="dc-hero-pos"><span class="dc-hero-n">#${f.pos}</span><span class="dc-mut">de ${D.ranking.length} distritos</span></div>
      <div class="dc-hero-prom"><span class="dc-hero-n">${f2(f.prom)}</span><span class="dc-mut">promedio sobre ${MAX} · ${fPct(f.pct)}</span></div>
      <div class="dc-hero-nv"><span class="nivel-badge ${nv.c}">${nv.t}</span><span class="dc-mut">${f.n} ${f.n === 1 ? 'período evaluado' : 'períodos evaluados'}</span></div></div>`; })()
      : '<div class="dc-hero dc-hero--vacio"><p class="pf-vacio">Este distrito todavía no tiene evaluaciones publicadas. Evalúalo en la pestaña «Evaluación».</p></div>';
    const filasH = A.periodos.map(p => {
      const e = evalDe(p.id, id);
      if (!e) return `<tr><th scope="row">${escHtml(nomPE(p))}</th><td colspan="6" class="dc-mut">Sin evaluar</td></tr>`;
      const o = aObj(e.puntajes), tot = puntaje(o), nv = nivel(tot), borr = e.estado !== 'publicado';
      return `<tr${borr ? ' class="dc-borrador"' : ''}><th scope="row">${escHtml(nomPE(p))}${borr ? ' <span class="etiqueta etq-ambar">Borrador</span>' : ''}</th>${COMP.map(c => `<td data-label="${c.abbr}">${Number(o[c.k]) || 0}</td>`).join('')}<td data-label="Total"><b>${tot}</b><span class="dc-mut"> / ${MAX}</span></td><td data-label="Nivel"><span class="nivel-badge ${nv.c}">${nv.t}</span></td></tr>`;
    }).join('');
    return `${hero}
      ${f && f.n ? `<section class="dc-sec"><h3 class="pf-h">Evolución</h3>${Distritos.trend(f.puntos, D.incl)}</section>` : ''}
      <section class="dc-sec"><h3 class="pf-h">Período por período</h3><div class="dc-tabla-wrap"><table class="dc-tabla dc-tabla--hist"><caption class="sr-only">Evaluaciones del distrito</caption>
        <thead><tr><th scope="col">Período</th>${COMP.map(c => `<th scope="col" title="${escHtml(c.label)}">${c.abbr}</th>`).join('')}<th scope="col">Total</th><th scope="col">Nivel</th></tr></thead><tbody>${filasH}</tbody></table></div>
        <p class="dc-nota">CGO gestión y organización · CCT creativa y técnica · COM comunicativa · CEE ejecución estratégica. Cada una de 0 a 7. Los borradores solo los ves tú.</p></section>`;
  }

  function tabEstadisticas(c, id) {
    if (!A.estOk) { c.innerHTML = EstadisticasDistrito.bloqueAdminHTML(null, { disponible: false }); return; }
    const fila = estDe(A.panel.peId, id);
    const hist = A.est.filter(e => e.distrito_id === id).sort((a, b) => String(b.actualizado_en).localeCompare(String(a.actualizado_en)));
    const pe = A.periodos.find(p => String(p.id) === String(A.panel.peId));
    c.innerHTML = `${chipsPEPanel('pe-est')}
      <p class="ed-sub">Estadísticas de Instagram que envió la secretaría para <b>${escHtml(nomPE(pe))}</b>.</p>
      ${EstadisticasDistrito.bloqueAdminHTML(fila, { conBoton: false })}
      ${hist.length ? `<section class="dc-sec"><h3 class="pf-h">Todo lo enviado por este distrito</h3><div class="dc-tabla-wrap"><table class="dc-tabla"><caption class="sr-only">Estadísticas enviadas por período</caption>
        <thead><tr><th scope="col">Período</th>${EstadisticasDistrito.CAMPOS.map(k => `<th scope="col">${escHtml(k.label)}</th>`).join('')}<th scope="col">Enviadas</th></tr></thead>
        <tbody>${hist.map(e => { const p = A.periodos.find(x => String(x.id) === String(e.periodo_id)); return `<tr><th scope="row">${escHtml(nomPE(p))}</th>${EstadisticasDistrito.CAMPOS.map(k => `<td data-label="${escHtml(k.label)}">${escHtml(EstadisticasDistrito.fmt(e[k.k], k))}</td>`).join('')}<td data-label="Enviadas" class="dc-mut">${escHtml(e.subido_por_nombre || '')}</td></tr>`; }).join('')}</tbody></table></div></section>` : ''}`;
    EstadisticasDistrito.recordarFilaAdmin(fila);
    EstadisticasDistrito.animarBloqueAdmin(c);
  }

  function tabPersonas(c, id) {
    const gente = A.usuarios.filter(u => u.distrito === id && !u.es_admin).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    c.innerHTML = gente.length ? `<ul class="dc-gente">${gente.map(u => `<li><button type="button" class="dc-persona" data-act="perfilVer" data-arg="${escHtml(u.id)}" aria-label="Ver el perfil de ${escHtml(u.nombre || 'la persona')}">
      ${typeof Avatar !== 'undefined' ? Avatar.html(u, { tam: 'sm' }) : ''}<span class="dc-persona-t"><b>${escHtml(u.nombre || u.email || '—')}</b><small>${escHtml(u.roles?.nombre || u.rol_nombre || 'Sin rol')}${u.tipo_miembro === 'secretario' ? ' · Secretaría' : ''}</small></span></button></li>`).join('')}</ul>
      <p class="dc-nota">${gente.length} ${gente.length === 1 ? 'persona' : 'personas'} en este distrito. Al abrir un perfil se reemplaza este panel.</p>`
      : '<p class="pf-vacio">Este distrito no tiene personas asignadas.</p>';
  }

  /* ── Acciones ──────────────────────────────────────────────────────────── */
  function csv() {
    const D = datos(), filas = [...D.ranking, ...D.sinDatos.filter(f => f.id !== 'EXT')];
    if (!filas.length) return showToast('No hay datos que exportar.', 'error');
    const e = v => { const t = String(v ?? ''); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const n2 = v => v == null ? '' : String(Math.round(v * 100) / 100).replace('.', ',');
    const cab = ['Posición', 'Distrito', ...D.incl.map(nomPE), `Total (de ${MAX * D.incl.length})`, `Promedio (sobre ${MAX})`, 'Porcentaje'];
    const lineas = filas.map(f => [f.pos ?? '', f.nombre, ...f.puntos.map(v => v ?? ''), f.n ? f.total : '', n2(f.prom), f.pct == null ? '' : n2(f.pct * 100) + '%']);
    const pp = D.porPeriodo.map(x => [`Promedio ${nomPE(x.periodo)}`, '', x.n ? n2(x.prom) : 'Sin evaluaciones publicadas']);
    const txt = '﻿' + [cab, ...lineas, [], ...pp, ['Promedio global acumulado', '', n2(D.global.prom), D.global.pct == null ? '' : n2(D.global.pct * 100) + '%']].map(r => r.map(e).join(';')).join('\n');
    ReporteEquipo.descargar('distritos-ranking-acumulado.csv', txt);
  }

  function accion(a, el) {
    if (!A) return;
    const x = el?.dataset?.arg2;
    if (a === 'abrir') return abrirDistrito(x);
    if (a === 'incl') {
      const D = datos(); const set = new Set(D.incl.map(p => String(p.id)));
      set.has(String(x)) ? set.delete(String(x)) : set.add(String(x));
      A.incl = set; return pintar();
    }
    if (a === 'filtro') { A.filtro = x || ''; return pintar(); }
    if (a === 'csv') return csv();
    if (a === 'pe-eval' || a === 'pe-est') { A.panel.peId = x; return pintarPanel(); }
  }
  function tab(k) { if (A?.panel) { A.panel.tab = k; pintarPanel(); } }
  function buscar(el) { if (!A) return; A.q = (el.value || '').toLowerCase().trim(); const pos = el.selectionStart; pintar(); const n = document.getElementById('dc-buscar'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* tipo search */ } } }

  return { montar, abrir, refrescar, accion, tab, buscar, abrirDistrito };
})();

function distBuscar(el) { DistritosAdmin.buscar(el); }
