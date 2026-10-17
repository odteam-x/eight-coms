'use strict';
/**
 * EIGHT CREATORS LABs — Seguimiento global de los períodos
 * ─────────────────────────────────────────────────────────
 * Todas las personas × todos los períodos de la gestión, agrupadas por rol: en cada período, en qué
 * estado va su evaluación, su resultado y los hechos de sus tareas. Sirve para ver de un vistazo quién
 * está al día, quién arrastra pendientes y cómo evolucionó cada rol.
 *
 * QUIÉN VE QUÉ lo decide la base (seguimiento_global(), migración 0025), no esta pantalla:
 *    administración → todas · secretaría → su distrito · miembro → su propio historial.
 * Aquí no se filtra por seguridad, solo se ordena lo que llega. Los borradores solo los ve la administración.
 *
 * NO CALCULA RESULTADOS. El resultado de la rúbrica por roles es el de resultados_periodo(); el de la clásica,
 * la suma de sus puntajes más el bono, como siempre. Dos escalas distintas nunca se promedian ni se comparan.
 *
 * MÉTRICAS (cada una dice su numerador y su denominador, también en pantalla):
 *   · Evaluaciones publicadas = personas con evaluación PUBLICADA ÷ personas que participan, en los períodos
 *     ya en juego (el activo, o uno que ya tiene alguna evaluación).
 *   · Entregas a tiempo       = tareas asignadas entregadas dentro del plazo ÷ tareas asignadas entregadas con plazo
 *     (se mide sobre la PRIMERA entrega; igual que en la evidencia de Evaluar).
 *   · Tareas vencidas         = tareas asignadas, nunca entregadas, con plazo ya pasado (no cuenta lo bloqueado).
 *
 * Todo texto humano pasa por escHtml. Depende de: config.js, core/render.js, core/rubrica.js, core/ui.js, api.js.
 */
const Seguimiento = (() => {
  let S = null;
  const ESTADO = {
    publicado:    { txt: 'Publicada',    cls: 'etq-verde' },
    borrador:     { txt: 'Borrador',     cls: 'etq-ambar' },
    sin_publicar: { txt: 'Sin publicar', cls: 'etq-ambar' },
    sin_evaluar:  { txt: 'Sin evaluar',  cls: 'etq-gris' },
  };

  const periodosDe = rows => {
    const m = new Map();
    for (const r of rows) if (!m.has(r.periodo_id)) m.set(r.periodo_id, { id: r.periodo_id, nombre: r.periodo_nombre, orden: r.periodo_orden, modelo: r.modelo, activo: r.periodo_activo });
    return [...m.values()].sort((a, b) => a.orden - b.orden);
  };
  /** Períodos «en juego»: el activo o uno que ya tiene alguna evaluación (en cualquier estado). */
  const enJuego = (rows, periodos) => new Set(periodos.filter(p => p.activo || rows.some(r => r.periodo_id === p.id && r.estado_eval !== 'sin_evaluar')).map(p => p.id));

  /** Valor y nivel de una celda publicada; null si no hay resultado visible. */
  function resultado(r) {
    if (r.modelo === 'v2') {
      if (r.individual == null) return null;
      const n = nivelV2(r.individual);
      return { txt: fmtNum(r.individual, 1), de: 'de 100', clase: n.key, label: n.label, color: scoreColorTxtV2(r.individual) };
    }
    if (r.total_clasico == null) return null;
    const max = typeof hayCriterios === 'function' && hayCriterios() ? MAX_TOTAL() : null;
    return { txt: fmtNum(r.total_clasico, 1), de: max ? 'de ' + max : '', clase: scoreClass(r.total_clasico), label: scoreLabel(r.total_clasico), color: scoreColorTxt(r.total_clasico) };
  }

  function tareasHTML(r) {
    if (!r.tareas_total) return '';
    // Solo números enteros de la base: no hay texto humano aquí.
    const partes = [`${Number(r.tareas_total)} tarea${r.tareas_total === 1 ? '' : 's'}`];
    if (r.con_plazo) partes.push(`${Number(r.a_tiempo)} de ${Number(r.con_plazo)} a tiempo`);
    if (r.tareas_vencidas) partes.push(`<span class="seg-venc">${Number(r.tareas_vencidas)} vencida${r.tareas_vencidas === 1 ? '' : 's'}</span>`);
    return `<small class="seg-tk">${partes.join(' · ')}</small>`;
  }

  function celdaHTML(r) {
    if (!r.participa) return '<span class="etiqueta etq-gris">No participa</span>';
    const e = ESTADO[r.estado_eval] || ESTADO.sin_evaluar;
    const res = (r.estado_eval === 'publicado' || r.estado_eval === 'borrador') ? resultado(r) : null;
    const valor = res ? `<span class="seg-val"><b style="color:${res.color}">${escHtml(res.txt)}</b>${res.de ? `<small>${escHtml(res.de)}</small>` : ''}</span><span class="nivel-badge ${escHtml(res.clase)}">${escHtml(res.label)}</span>` : '';
    return `${valor}${r.estado_eval === 'publicado' ? '' : `<span class="etiqueta ${e.cls}">${escHtml(e.txt)}</span>`}${tareasHTML(r)}`;
  }

  /* ── Resumen con numerador y denominador ─────────────────────────────── */
  function metricas(rows, periodos) {
    const juego = enJuego(rows, periodos);
    const base = rows.filter(r => juego.has(r.periodo_id) && r.participa);
    const pub = base.filter(r => r.estado_eval === 'publicado').length;
    const conPlazo = rows.reduce((a, r) => a + r.con_plazo, 0), aTiempo = rows.reduce((a, r) => a + r.a_tiempo, 0);
    const venc = rows.reduce((a, r) => a + r.tareas_vencidas, 0);
    const conVenc = new Set(rows.filter(r => r.tareas_vencidas > 0).map(r => r.persona_id)).size;
    return { pub, total: base.length, aTiempo, conPlazo, venc, conVenc, juego };
  }
  const pct = (n, d) => d ? Math.round(n / d * 100) + ' %' : '—';

  function kpisHTML(m) {
    const k = (val, lbl, sub) => `<div class="kpi"><div class="kpi__val">${val}</div><div class="kpi__lbl">${escHtml(lbl)}</div><div class="seg-kpi-sub">${escHtml(sub)}</div></div>`;
    return `<div class="kpi-row seg-kpis">
      ${k(pct(m.pub, m.total), 'EVALUACIONES PUBLICADAS', `${m.pub} de ${m.total} personas-período`)}
      ${k(pct(m.aTiempo, m.conPlazo), 'ENTREGAS A TIEMPO', `${m.aTiempo} de ${m.conPlazo} entregas con plazo`)}
      ${k(m.venc, 'TAREAS VENCIDAS', m.venc ? `en ${m.conVenc} persona${m.conVenc === 1 ? '' : 's'}` : 'sin entregas atrasadas')}
    </div>
    <details class="seg-como"><summary>¿Cómo se calcula?</summary>
      <ul class="rol-lista">
        <li><b>Evaluaciones publicadas</b>: personas con la evaluación publicada ÷ personas que participan, en los períodos ya en juego (el activo o uno con alguna evaluación). Un borrador no cuenta.</li>
        <li><b>Entregas a tiempo</b>: tareas asignadas entregadas dentro del plazo ÷ tareas asignadas entregadas que tenían plazo. Se mide sobre la primera entrega.</li>
        <li><b>Tareas vencidas</b>: tareas asignadas nunca entregadas cuyo plazo ya pasó. Lo bloqueado no cuenta.</li>
        <li>Los resultados de la rúbrica por roles y los de la clásica están en escalas distintas: nunca se promedian ni se comparan.</li>
      </ul></details>`;
  }

  /* ── Pantalla global (administración y secretaría) ──────────────────── */
  function pintar() {
    const host = S.host;
    const { rows } = S;
    const periodos = periodosDe(rows);
    const q = (S.q || '').toLowerCase().trim();
    const juego = enJuego(rows, periodos);
    const pendiente = pid => rows.some(r => r.persona_id === pid && r.participa && ((juego.has(r.periodo_id) && r.estado_eval !== 'publicado') || r.tareas_vencidas > 0));
    const visibles = rows.filter(r => (!q || (r.nombre || '').toLowerCase().includes(q))
      && (!S.distrito || r.distrito === S.distrito) && (!S.rol || String(r.rol_id ?? '') === S.rol)
      && (!S.pendientes || pendiente(r.persona_id)));
    const m = metricas(visibles, periodos);

    const roles = new Map();
    for (const r of visibles) {
      const k = r.rol_nombre || 'Sin rol';
      if (!roles.has(k)) roles.set(k, new Map());
      const g = roles.get(k);
      if (!g.has(r.persona_id)) g.set(r.persona_id, { nombre: r.nombre, distrito: r.distrito, id: r.persona_id, porPeriodo: new Map() });
      g.get(r.persona_id).porPeriodo.set(r.periodo_id, r);
    }

    const tabla = (rol, personas) => {
      const lista = [...personas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      const filas = lista.map(p => {
        const celdas = periodos.map(per => { const r = p.porPeriodo.get(per.id); return `<td data-label="${escHtml(per.nombre)}" class="seg-celda">${r ? celdaHTML(r) : '—'}</td>`; }).join('');
        return `<tr><th scope="row" class="seg-persona"><button type="button" class="seg-nombre" data-act="perfilVer" data-arg="${escHtml(p.id)}" aria-label="Ver el perfil de ${escHtml(p.nombre)}">${escHtml(p.nombre)}</button>${p.distrito ? `<small>${escHtml(p.distrito)}</small>` : ''}</th>${celdas}</tr>`;
      }).join('');
      const bm = metricas([...personas.values()].flatMap(p => [...p.porPeriodo.values()]), periodos);
      return acordeonHTML({
        id: 'seg-rol-' + rol, abierto: true,
        titulo: `${escHtml(rol)} <span class="seg-n">${lista.length} persona${lista.length === 1 ? '' : 's'}</span>`,
        resumen: `${bm.pub} de ${bm.total} evaluaciones publicadas${bm.venc ? ` · ${bm.venc} tarea${bm.venc === 1 ? '' : 's'} vencida${bm.venc === 1 ? '' : 's'}` : ''}`,
        extra: 'seg-grupo',
        cuerpo: `<div class="seg-tabla-wrap"><table class="seg-tabla">
          <caption class="sr-only">Seguimiento de ${escHtml(rol)} por período</caption>
          <thead><tr><th scope="col">Persona</th>${periodos.map(p => `<th scope="col">${escHtml(p.nombre)}${p.activo ? ' <span class="etiqueta etq-azul">Activo</span>' : ''}<small>${p.modelo === 'v2' ? 'Rúbrica por roles' : 'Rúbrica clásica'}</small></th>`).join('')}</tr></thead>
          <tbody>${filas}</tbody></table></div>`,
      });
    };

    const distritos = [...new Set(rows.map(r => r.distrito).filter(Boolean))].sort();
    const rolesOpt = [...new Map(rows.map(r => [String(r.rol_id ?? ''), r.rol_nombre || 'Sin rol'])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
    const orden = [...roles.keys()].sort((a, b) => a === 'Sin rol' ? 1 : b === 'Sin rol' ? -1 : a.localeCompare(b, 'es'));
    const controles = document.getElementById('seg-controles');
    if (controles && !controles.dataset.listo) {
      controles.dataset.listo = '1';
      controles.innerHTML = `
        <input class="search-inp" id="seg-q" type="search" aria-label="Buscar persona" placeholder="Buscar persona…" data-input="segBuscar" value="${escHtml(S.q || '')}">
        ${S.modo === 'admin' && distritos.length > 1 ? `<select class="cfg-inp cfg-select" id="seg-distrito" aria-label="Filtrar por distrito" data-change="segFiltro"><option value="">Todos los distritos</option>${distritos.map(d => `<option value="${escHtml(d)}">${escHtml(typeof _distritoNombre === 'function' ? _distritoNombre(d) : d)}</option>`).join('')}</select>` : ''}
        ${rolesOpt.length > 1 ? `<select class="cfg-inp cfg-select" id="seg-rol" aria-label="Filtrar por rol" data-change="segFiltro"><option value="">Todos los roles</option>${rolesOpt.map(([id, n]) => `<option value="${escHtml(id)}">${escHtml(n)}</option>`).join('')}</select>` : ''}
        <label class="tk-check seg-pend"><input type="checkbox" id="seg-pend" data-change="segFiltro"><span>Solo con pendientes</span></label>`;
    }
    host.innerHTML = `${kpisHTML(m)}
      ${orden.length ? orden.map(r => tabla(r, roles.get(r))).join('') : '<div class="empty-box"><div class="empty-txt">Nadie coincide con los filtros.</div></div>'}`;
    if (typeof renderIconos === 'function') renderIconos(host);
    if (typeof animarEntrada === 'function') animarEntrada(host);
  }

  async function montar(host, { modo = 'admin' } = {}) {
    if (!host) return;
    renderCargando(host);
    const res = await API.getSeguimientoGlobal();
    if (!res.ok) {
      if (res.noDisponible) host.innerHTML = '<div class="empty-box"><div class="empty-txt">El seguimiento global necesita la migración 0025 en la base de datos. Aplícala en Supabase y recarga.</div></div>';
      else renderError(host, res.error, () => montar(host, { modo }));
      return;
    }
    const previo = S && S.host === host ? S : null;
    S = { host, modo, rows: res.rows, q: previo?.q || '', distrito: previo?.distrito || '', rol: previo?.rol || '', pendientes: !!previo?.pendientes };
    if (!res.rows.length) { host.innerHTML = '<div class="empty-box"><div class="empty-txt">Todavía no hay personas ni períodos que seguir en esta gestión.</div></div>'; return; }
    const c = document.getElementById('seg-controles'); if (c) { c.dataset.listo = ''; }
    pintar();
  }

  function leerFiltros() {
    if (!S) return;
    S.q = document.getElementById('seg-q')?.value || '';
    S.distrito = document.getElementById('seg-distrito')?.value || '';
    S.rol = document.getElementById('seg-rol')?.value || '';
    S.pendientes = !!document.getElementById('seg-pend')?.checked;
    pintar();
  }

  /* ── Historial de UNA persona (dentro de su perfil → Evolución) ─────── */
  let _cache = null;
  async function filasPersona(personaId) {
    if (!_cache || Date.now() - _cache.t > 60000) { const r = await API.getSeguimientoGlobal(); _cache = { t: Date.now(), r }; }
    if (!_cache.r.ok) return _cache.r;
    return { ok: true, rows: _cache.r.rows.filter(r => r.persona_id === personaId).sort((a, b) => a.periodo_orden - b.periodo_orden) };
  }
  function personaHTML(rows, titulo = 'Todos los períodos') {
    if (!rows.length) return '';
    const filas = rows.map(r => `<tr><th scope="row">${escHtml(r.periodo_nombre)}${r.periodo_activo ? ' <span class="etiqueta etq-azul">Activo</span>' : ''}<small>${r.modelo === 'v2' ? 'Rúbrica por roles' : 'Rúbrica clásica'}</small></th>
      <td data-label="Evaluación" class="seg-celda">${celdaHTML(r)}</td></tr>`).join('');
    return `<section class="pf-card pf-card--ancha seg-persona-card" aria-label="${escHtml(titulo)}">
      <h3 class="pf-h">${escHtml(titulo)} <small>estado de la evaluación y tareas de cada uno</small></h3>
      <div class="seg-tabla-wrap"><table class="seg-tabla seg-tabla--persona">
        <caption class="sr-only">${escHtml(titulo)}</caption>
        <thead><tr><th scope="col">Período</th><th scope="col">Evaluación y tareas</th></tr></thead><tbody>${filas}</tbody></table></div>
    </section>`;
  }
  async function persona(host, personaId) {
    if (!host) return;
    const r = await filasPersona(personaId);
    host.innerHTML = r.ok ? personaHTML(r.rows) : '';
  }
  const invalidar = () => { _cache = null; };

  return { montar, leerFiltros, persona, personaHTML, invalidar, metricas, celdaHTML };
})();

/** data-input / data-change de los filtros del seguimiento (lista blanca en config.js). */
function segBuscar() { Seguimiento.leerFiltros(); }
function segFiltro() { Seguimiento.leerFiltros(); }
