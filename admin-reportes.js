'use strict';
/**
 * EIGHT CREATORS LABs — Reportes (administración)
 * ───────────────────────────────────────────────
 * Un constructor, no un documento fijo: se elige el período, el alcance
 * (todo el equipo, un distrito, un rol o una persona) y las secciones que
 * entran. La hoja de la derecha es lo que se imprime (PDF por impresión) y los
 * mismos datos salen en CSV. Funciona con los dos modelos de rúbrica: lee los
 * resultados ya calculados (rúbrica por roles, en la base) o la fórmula clásica
 * a través de PanelAdmin.datos(); aquí no se calcula ningún puntaje oficial.
 * Dos modos (E.modo): «general» (por defecto) = el resumen de TODOS los PE en una sola pantalla
 * (core/reporte-general.js, migración 0050); «detalle» = este constructor, para un PE. Desde la fila de un PE
 * del resumen se abre su reporte completo (verPE). CSV e impresión siguen el modo activo.
 * Depende de: admin.js (globals), admin-panel.js (PanelAdmin), core/rubrica.js, core/reporte-general.js.
 */
const Reportes = (() => {
  const SECCIONES = [
    { k: 'resumen',  t: 'Resumen',           ico: 'file-text' },
    { k: 'ranking',  t: 'Ranking',           ico: 'trophy' },
    { k: 'rol',      t: 'Por rol',           ico: 'users-round' },
    { k: 'criterio', t: 'Por competencia',   ico: 'bar-chart-2' },
    { k: 'personas', t: 'Detalle por persona', ico: 'user' },
    { k: 'tareas',   t: 'Evidencia de tareas', ico: 'list-checks', v2: true },
    { k: 'periodos', t: 'Entre períodos',    ico: 'trending-up' },
    { k: 'actividad', t: 'Por actividad',    ico: 'calendar-days' },
    { k: 'sin',      t: 'Sin evaluar',       ico: 'user-x' },
  ];
  const E = { modo: 'general', periodoId: null, alcance: 'todo', valor: '', sec: new Set(['resumen', 'ranking', 'rol', 'criterio', 'sin']) };
  let _d = null;           // datos del período
  let _tareas = {};        // por persona, solo períodos por roles
  let _sinEv = [];
  let _seg = null, _act = null;   // seguimiento_global y reporte_actividades (0025); null = no disponible

  const NIV = { sex: 'Excelente', sbu: 'Bueno', spr: 'En proceso', sba: 'Bajo' };
  const f1 = n => n == null ? '—' : (Math.round(n * 10) / 10).toString().replace('.', ',');
  const prom = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const fechaLarga = d => d.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
  const periodoSel = () => _periodos.find(p => String(p.id) === String(E.periodoId));

  const MODOS = [
    { k: 'general', etiqueta: 'Todos los PE', icono: 'layout-grid' },
    { k: 'detalle', etiqueta: 'Un PE en detalle', icono: 'file-text' },
  ];
  function pintarModo() {
    const host = document.getElementById('rep-modo'); if (!host) return;
    host.innerHTML = segHTML(MODOS, E.modo, 'repModo', { etiqueta: 'Tipo de reporte', prefijo: 'rep-modo' });
    renderIconos(host);
    const g = E.modo === 'general';
    document.getElementById('rg-host').hidden = !g;
    document.getElementById('rep-detalle').hidden = g;
    const ayuda = document.getElementById('rep-ayuda');
    if (ayuda) ayuda.textContent = g
      ? 'El estado de todos los Puntos de Encuentro en una sola pantalla. Abre una fila para ver de dónde sale cada cifra.'
      : 'Elige el período, el alcance y las secciones. La hoja de abajo es lo que se imprime.';
  }

  async function abrir() {
    pintarModo();
    if (E.modo === 'general') {
      await ReporteGeneral.montar(document.getElementById('rg-host'), { distritos: _distritos, roles: _roles, abrirPE: verPE });
      return;
    }
    if (!_periodos.length) { document.getElementById('rpt-body').innerHTML = '<div class="empty-box"><div class="empty-txt">Crea un período para generar reportes.</div></div>'; return; }
    if (!E.periodoId) E.periodoId = (_periodos.find(p => p.activo) || _periodos[0]).id;
    pintarControles();
    await cargar();
  }
  /** Cambia entre el resumen de todos los PE y el reporte de uno. */
  function setModo(k) { if (k !== 'general' && k !== 'detalle') return; E.modo = k; abrir(); }
  /** Desde una fila del resumen: el reporte completo de ese PE. */
  function verPE(id) { E.modo = 'detalle'; E.periodoId = id; E.valor = ''; abrir(); window.scrollTo?.({ top: 0 }); }

  function pintarControles() {
    const host = document.getElementById('rep-controles'); if (!host) return;
    const p = periodoSel();
    const secs = SECCIONES.filter(s => !s.v2 || (p && esPeriodoV2(p)));
    host.innerHTML = `
      <div class="rep-fila">
        <span class="eval-pe-lbl">Período</span>
        <div class="eval-pe-btns">${_periodos.map(x => `<button type="button" class="pb${String(x.id) === String(E.periodoId) ? ' active' : ''}" data-act="repPeriodo" data-arg="${escHtml(x.id)}">${escHtml(x.nombre)}</button>`).join('')}</div>
      </div>
      <div class="rep-fila rep-filtros">
        <label class="rep-campo"><span>Alcance</span>
          <select class="cfg-inp cfg-select" id="rep-alcance" data-change="repCambio" aria-label="Alcance del reporte">
            <option value="todo"${E.alcance === 'todo' ? ' selected' : ''}>Todo el equipo</option>
            <option value="distrito"${E.alcance === 'distrito' ? ' selected' : ''}>Un distrito</option>
            <option value="rol"${E.alcance === 'rol' ? ' selected' : ''}>Un rol</option>
            <option value="persona"${E.alcance === 'persona' ? ' selected' : ''}>Una persona</option>
          </select></label>
        <label class="rep-campo" id="rep-valor-wrap"${E.alcance === 'todo' ? ' hidden' : ''}><span>Cuál</span>
          <select class="cfg-inp cfg-select" id="rep-valor" data-change="repCambio" aria-label="Elegir ${escHtml(E.alcance)}">${opcionesValor()}</select></label>
      </div>
      <div class="rep-fila"><span class="eval-pe-lbl">Incluir</span>
        <div class="eval-chips">${secs.map(s => `<button type="button" class="eval-chip${E.sec.has(s.k) ? ' on' : ''}" data-act="repSeccion" data-arg="${s.k}" aria-pressed="${E.sec.has(s.k)}"><i data-lucide="${s.ico}"></i>${escHtml(s.t)}</button>`).join('')}</div>
      </div>`;
    renderIconos(host);
  }

  function opcionesValor() {
    const filas = _d?.filas || [];
    let ops = [];
    if (E.alcance === 'distrito') ops = [...new Set(filas.map(f => f.distrito))].sort();
    if (E.alcance === 'rol') ops = [...new Set(filas.map(f => f.rolNombre))].sort();
    if (E.alcance === 'persona') ops = [...filas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(f => f.id);
    if (!ops.includes(E.valor)) E.valor = ops[0] || '';
    return ops.map(o => `<option value="${escHtml(o)}"${o === E.valor ? ' selected' : ''}>${escHtml(E.alcance === 'persona' ? (filas.find(f => f.id === o)?.nombre || o) : o)}</option>`).join('');
  }

  async function cargar() {
    const body = document.getElementById('rpt-body');
    body.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';
    const p = periodoSel();
    PanelAdmin.invalidar(p.id);
    _d = await PanelAdmin.datos(p);
    _tareas = {};
    if (esPeriodoV2(p)) {
      const rt = await API.getResumenTareas(p.id);
      if (rt.ok) _tareas = rt.porUsuario;
    }
    const part = await API.getParticipantes(p.id).catch(() => []);
    const inact = new Set((part || []).filter(r => !r.activo).map(r => r.user_id));
    const conRes = new Set(_d.filas.map(f => f.id));
    _sinEv = _users.filter(u => !u.es_admin && u.aprobado !== false && !inact.has(u.id) && !conRes.has(u.id));
    // Cortes entre períodos y por actividad: dependen de la migración 0025 (y 0021/0024); sin ellas, su sección lo explica.
    const [sg, ac] = await Promise.all([API.getSeguimientoGlobal(), API.getReporteActividades()]);
    _seg = sg.ok ? sg.rows : null; _act = ac.ok ? ac.rows : null;
    pintarControles();
    pintar();
  }

  function filtradas() {
    let f = _d.filas;
    if (E.alcance === 'distrito') f = f.filter(x => x.distrito === E.valor);
    if (E.alcance === 'rol') f = f.filter(x => x.rolNombre === E.valor);
    if (E.alcance === 'persona') f = f.filter(x => x.id === E.valor);
    return [...f].sort((a, b) => b.score - a.score);
  }

  /** Filas de seguimiento / actividad dentro del alcance elegido (la base ya entregó solo lo que esta persona puede ver). */
  function dentroDelAlcance(rows) {
    if (E.alcance === 'todo') return rows;
    const dNom = d => (typeof _distritoNombre === 'function' ? _distritoNombre(d) : d) || 'Sin distrito';
    return rows.filter(r => r.persona_id && (E.alcance === 'persona' ? r.persona_id === E.valor
      : E.alcance === 'rol' ? (r.rol_nombre || 'Sin rol') === E.valor : dNom(r.distrito) === E.valor));
  }
  const NOTA_0025 = 'Este corte necesita la migración 0025 (y las 0021 y 0024 para las actividades) en la base de datos.';
  function secPeriodos() {
    if (!_seg) return bloque('Entre períodos', `<p class="cfg-hint">${escHtml(NOTA_0025)}</p>`);
    return bloque('Entre períodos', `${ReporteEquipo.periodosHTML(dentroDelAlcance(_seg))}
      <div class="no-print req-acc"><button type="button" class="btn--texto" data-act="repCsvPeriodos"><i data-lucide="download"></i>Descargar este cuadro (CSV)</button></div>
      <details class="seg-como"><summary>¿Cómo se calcula?</summary>${ReporteEquipo.DEFINICIONES}</details>`,
      'Cada período de la gestión; los de rúbrica por roles y los de la clásica no se promedian entre sí.');
  }
  function secActividad() {
    if (!_act) return bloque('Por actividad', `<p class="cfg-hint">${escHtml(NOTA_0025)}</p>`);
    return bloque('Por actividad', `${ReporteEquipo.actividadesHTML(dentroDelAlcance(_act))}
      <div class="no-print req-acc"><button type="button" class="btn--texto" data-act="repCsvActividad"><i data-lucide="download"></i>Descargar este cuadro (CSV)</button></div>`,
      'Las tareas vinculadas a cada actividad: cuántas se asignaron, entregaron, aprobaron y cuántas están vencidas.');
  }

  const nivelK = s => nivelV2(s).key;
  const nivelPill = s => `<span class="nivel-badge ${nivelK(s)}">${NIV[nivelK(s)]}</span>`;
  const bloque = (t, cuerpo, d) => `<section class="rpt-sec"><h3 class="rpt-sec-t">${escHtml(t)}</h3>${d ? `<p class="rpt-sec-d">${escHtml(d)}</p>` : ''}${cuerpo}</section>`;

  function secResumen(fs) {
    const v = fs.map(x => x.score), m = prom(v);
    const dist = { sex: 0, sbu: 0, spr: 0, sba: 0 }; fs.forEach(x => dist[nivelK(x.score)]++);
    const tot = fs.length || 1;
    const frase = fs.length
      ? `${fs.length} persona${fs.length === 1 ? '' : 's'} con resultado. El promedio es ${f1(m)} sobre 100 y el mejor resultado, ${f1(Math.max(...v))}. ${dist.sex + dist.sbu} de ${fs.length} están en nivel Bueno o Excelente${dist.sba ? `; ${dist.sba} necesitan apoyo (nivel Bajo)` : ''}.`
      : 'Todavía no hay resultados publicados con estos filtros.';
    return bloque('Resumen', `
      <div class="rpt-kpis">
        <div><b>${fs.length}</b><span>Con resultado</span></div><div><b>${f1(m)}</b><span>Promedio</span></div>
        <div><b>${fs.length ? f1(Math.max(...v)) : '—'}</b><span>Mejor</span></div><div><b>${_sinEv.length}</b><span>Sin evaluar</span></div>
      </div>
      <div class="rpt-niveles" role="img" aria-label="${Object.keys(NIV).map(k => `${NIV[k]} ${dist[k]}`).join(', ')}">${Object.keys(NIV).map(k => dist[k] ? `<i style="flex:${dist[k]};background:var(--${k})" title="${NIV[k]}: ${dist[k]}"></i>` : '').join('')}</div>
      <div class="rpt-niveles-leyenda">${Object.keys(NIV).map(k => `<span class="etiqueta" style="--etq:var(--${k})">${NIV[k]} <b>${dist[k]}</b></span>`).join('')}</div>
      <p class="rpt-frase">${escHtml(frase)}</p>`);
  }

  function secRanking(fs) {
    if (!fs.length) return '';
    const v2 = _d.v2;
    return bloque('Ranking', `<div class="rpt-tabla"><table><thead><tr><th>#</th><th>Persona</th><th>Rol</th><th>Distrito</th>${v2 ? '<th>Comunes</th><th>Del rol</th>' : ''}<th>Total</th><th>Nivel</th></tr></thead><tbody>
      ${fs.map((x, i) => `<tr><td>${i + 1}</td><th scope="row">${escHtml(x.nombre)}</th><td>${escHtml(x.rolNombre)}</td><td>${escHtml(x.distrito)}</td>${v2 ? `<td>${f1(x.nucleo)}</td><td>${f1(x.tecnico)}</td>` : ''}<td><b>${f1(x.score)}</b></td><td>${nivelPill(x.score)}</td></tr>`).join('')}
      </tbody></table></div>`, 'De mayor a menor resultado, sobre 100.');
  }

  function secRol(fs) {
    const g = {}; fs.forEach(x => (g[x.rolNombre] ||= []).push(x.score));
    const l = Object.entries(g).map(([n, v]) => ({ n, c: v.length, m: prom(v), x: Math.max(...v), y: Math.min(...v) })).sort((a, b) => b.m - a.m);
    if (!l.length) return '';
    return bloque('Por rol', `<div class="rpt-tabla"><table><thead><tr><th>Rol</th><th>Personas</th><th>Promedio</th><th>Mejor</th><th>Más bajo</th></tr></thead><tbody>
      ${l.map(r => `<tr><th scope="row">${escHtml(r.n)}</th><td>${r.c}</td><td><b>${f1(r.m)}</b></td><td>${f1(r.x)}</td><td>${f1(r.y)}</td></tr>`).join('')}</tbody></table></div>`, 'Cada rol se compara solo consigo mismo; con pocas personas el promedio es orientativo.');
  }

  function secCriterio(fs) {
    const k = {}; fs.forEach(x => Object.entries(x.comp).forEach(([key, c]) => (k[key] ||= { n: c.nombre, v: [] }).v.push(c.v)));
    const l = Object.values(k).map(c => ({ n: c.n, m: prom(c.v) })).sort((a, b) => b.m - a.m);
    if (!l.length) return '';
    return bloque(_d.v2 ? 'Por competencia común' : 'Por criterio', `<div class="rpt-barras">${l.map(c => `<div class="rpt-barra"><span>${escHtml(c.n)}</span><div class="barra-track"><div class="barra-fill" style="width:${Math.round(c.m)}%"></div></div><b>${f1(c.m)}</b></div>`).join('')}</div>`, 'Promedio del grupo en cada una, de 0 a 100.');
  }

  function secPersonas(fs) {
    if (!fs.length) return '';
    return bloque('Detalle por persona', `<div class="rpt-personas">${fs.map(x => {
      const cs = Object.values(x.comp).sort((a, b) => b.v - a.v);
      return `<article class="rpt-persona"><header><div><strong>${escHtml(x.nombre)}</strong><small>${escHtml(x.rolNombre)} · ${escHtml(x.distrito)}</small></div><div class="rpt-persona-r"><b>${f1(x.score)}</b>${nivelPill(x.score)}</div></header>
        ${cs.length ? `<p><span class="rpt-fuerte">Más fuerte:</span> ${escHtml(cs[0].nombre)} (${Math.round(cs[0].v)}) · <span class="rpt-debil">Más margen:</span> ${escHtml(cs[cs.length - 1].nombre)} (${Math.round(cs[cs.length - 1].v)})</p>` : ''}</article>`;
    }).join('')}</div>`);
  }

  function secTareas(fs) {
    const ids = new Set(fs.map(x => x.id));
    const l = Object.entries(_tareas).filter(([id]) => ids.has(id)).map(([id, r]) => ({ n: fs.find(x => x.id === id)?.nombre || '—', r }));
    if (!l.length) return '';
    return bloque('Evidencia de tareas', `<div class="rpt-tabla"><table><thead><tr><th>Persona</th><th>Asignadas</th><th>Entregadas</th><th>A tiempo</th><th>Vencidas</th><th>Devoluciones</th></tr></thead><tbody>
      ${l.map(x => `<tr><th scope="row">${escHtml(x.n)}</th><td>${x.r.asignadas ?? 0}</td><td>${x.r.entregadas ?? 0}</td><td>${x.r.a_tiempo ?? 0}</td><td>${x.r.vencidas_abiertas ?? 0}</td><td>${x.r.devoluciones ?? 0}</td></tr>`).join('')}</tbody></table></div>`, 'Hechos para quien evalúa: no puntúan por sí solos.');
  }

  function secSin() {
    let l = _sinEv;
    if (E.alcance === 'distrito') l = l.filter(u => ((_distritos.find(d => String(d.id) === String(u.distrito)) || {}).nombre || 'Sin distrito') === E.valor);
    if (E.alcance === 'rol') l = l.filter(u => (u.roles?.nombre || 'Sin rol') === E.valor);
    if (E.alcance === 'persona' || !l.length) return '';
    return bloque('Sin evaluar', `<ul class="rpt-sin">${l.map(u => `<li>${escHtml(u.nombre)}<small>${escHtml(u.roles?.nombre || 'Sin rol')}</small></li>`).join('')}</ul>`);
  }

  function pintar() {
    const body = document.getElementById('rpt-body'); if (!body || !_d) return;
    const p = periodoSel();
    const fs = filtradas();
    const alc = E.alcance === 'todo' ? 'Todo el equipo' : E.alcance === 'persona' ? (_d.filas.find(f => f.id === E.valor)?.nombre || '') : `${E.alcance === 'rol' ? 'Rol' : 'Distrito'}: ${E.valor}`;
    const orden = ['resumen', 'ranking', 'rol', 'criterio', 'personas', 'tareas', 'periodos', 'actividad', 'sin'];
    const fn = { resumen: secResumen, ranking: secRanking, rol: secRol, criterio: secCriterio, personas: secPersonas, tareas: secTareas, periodos: secPeriodos, actividad: secActividad, sin: secSin };
    body.innerHTML = `
      <article class="rpt-hoja" aria-label="Vista previa del reporte">
        <header class="rpt-hoja-cab">
          <picture><source srcset="logo.webp 1x, logo@2x.webp 2x" type="image/webp"><img src="logo.png" alt="" class="rpt-logo" width="64" height="64"></picture>
          <div class="rpt-hoja-t"><span>EIGHT CREATORS LABs · CELIDER 08 Santiago</span><h2>Reporte de evaluaciones</h2><p>${escHtml(p.nombre)}${p.descripcion ? ' · ' + escHtml(p.descripcion) : ''} · ${escHtml(alc)}</p></div>
          <div class="rpt-hoja-f"><span>Generado el</span><b>${fechaLarga(new Date())}</b></div>
        </header>
        ${orden.filter(k => E.sec.has(k) && (k !== 'tareas' || _d.v2)).map(k => fn[k](fs)).join('') || '<p class="cfg-hint">Elige al menos una sección.</p>'}
        <footer class="rpt-hoja-pie">Los resultados de la rúbrica por roles se calculan en la base de datos; este reporte solo los presenta.</footer>
      </article>`;
    renderIconos(body);
  }

  const csvEsc = v => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function csv() {
    if (E.modo === 'general') { ReporteGeneral.csv(); return; }
    const fs = filtradas(); if (!fs.length) { showToast('No hay resultados que exportar con esos filtros.', 'error'); return; }
    const cab = ['Posición', 'Persona', 'Rol', 'Distrito', ..._d.v2 ? ['Competencias comunes', 'Competencias del rol'] : [], 'Total sobre 100', 'Nivel'];
    const filas = fs.map((x, i) => [i + 1, x.nombre, x.rolNombre, x.distrito, ..._d.v2 ? [f1(x.nucleo), f1(x.tecnico)] : [], f1(x.score), NIV[nivelK(x.score)]]);
    const texto = '﻿' + [cab, ...filas].map(r => r.map(csvEsc).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
    a.download = `reporte-${(periodoSel()?.nombre || 'periodo').replace(/\s+/g, '-')}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /** PDF por impresión: se imprime con el tema claro y se restaura el del usuario. */
  function pdf() {
    if (E.modo === 'general') { ReporteGeneral.imprimir(); return; }
    const r = document.documentElement, previo = r.getAttribute('data-theme');
    r.setAttribute('data-theme', 'light'); document.body.classList.add('imprimiendo-reporte');
    const fin = () => { document.body.classList.remove('imprimiendo-reporte'); previo ? r.setAttribute('data-theme', previo) : r.removeAttribute('data-theme'); window.removeEventListener('afterprint', fin); };
    window.addEventListener('afterprint', fin);
    setTimeout(() => window.print(), 80);
  }

  function setPeriodo(id) { E.periodoId = id; E.valor = ''; cargar(); }
  function toggleSeccion(k) { E.sec.has(k) ? E.sec.delete(k) : E.sec.add(k); pintarControles(); pintar(); }
  function cambio(el) {
    if (el?.id === 'rep-alcance') { E.alcance = el.value; E.valor = ''; }
    else if (el?.id === 'rep-valor') { E.valor = el.value; }
    pintarControles(); pintar();
  }
  const csvPeriodos = () => { if (_seg) ReporteEquipo.descargar('reporte-periodos.csv', ReporteEquipo.csvPeriodos(dentroDelAlcance(_seg))); };
  const csvActividad = () => { if (_act) ReporteEquipo.descargar('reporte-actividades.csv', ReporteEquipo.csvActividades(dentroDelAlcance(_act))); };
  return { abrir, setModo, verPE, setPeriodo, toggleSeccion, cambio, csv, pdf, csvPeriodos, csvActividad };
})();

/** data-change="repCambio" (lista blanca de config.js) */
function repCambio(el) { Reportes.cambio(el); }
