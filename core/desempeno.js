'use strict';
/**
 * EIGHT CREATORS LABs — Desempeño
 * ───────────────────────────────
 * Dos lecturas de lo que YA está en la base, sin tablas nuevas, sin registro paralelo y sin fórmulas propias:
 *
 *   · montarAdmin(host)       — pestaña «Desempeño» de la administración. ARRIBA, cada persona: tarjetas con su
 *                               último resultado y tendencia, el detalle de la persona elegida frente al promedio
 *                               del equipo, comparar varias personas a la vez y comparar dos períodos persona por
 *                               persona. ABAJO, el equipo por período (KPIs, evolución, promedio por rol).
 *                               Filtros: rúbrica, métrica, rol, distrito, períodos y búsqueda.
 *   · montarPropio(host, {yo}) — «Mi desempeño» (miembros y secretarías): solo la propia trayectoria.
 *
 * FUENTE ÚNICA: API.getSeguimientoGlobal() → seguimiento_global() (0025/0035), que a su vez lee
 * resultados_periodo(). Aquí solo se agrupa, se resta y se dibuja. El resultado, el núcleo, el técnico, el
 * general y la nota de tareas son los que calcula la base; ninguno se recalcula en este archivo.
 *
 * QUIÉN VE QUÉ lo decide la base: administración todas las personas; secretaría su distrito; miembro solo su
 * fila. «Mi desempeño» además filtra por la propia persona_id (una secretaría recibe más filas de las que
 * muestra esta pantalla). Aquí no se filtra por seguridad.
 *
 * REGLAS DE LECTURA
 *   · Solo cuentan las evaluaciones PUBLICADAS (un borrador no es un resultado). Se dice cuántas quedan fuera.
 *   · La rúbrica por roles (0–100) y la clásica (otra escala) NUNCA se mezclan: un selector las separa y cada
 *     una dibuja y promedia por su lado. Los PE antiguos (clásica) se comparan solo entre sí: por puntaje total
 *     y por cada uno de sus criterios (los puntajes publicados que ya guarda `evaluaciones`, leídos tal cual).
 *   · Un PE en el que la persona no participa no existe para ella.
 *   · Promedio del equipo = media simple de los resultados publicados de ese período (cada persona una vez).
 *   · Variación = último valor menos el del período anterior con dato; nunca se interpola un hueco.
 *   · Tendencia (solo «Mi desempeño»): último valor frente al promedio de los anteriores; «estable» dentro de
 *     ±3 % de la escala.
 *
 * Todo texto humano pasa por escHtml. Depende de: config.js, core/render.js, core/rubrica.js, core/ui.js,
 * core/charts.js, api.js.
 */
const Desempeno = (() => {
  const MAX_PERSONAS = 5;
  const METRICAS = [
    { k: 'individual',  l: 'Resultado individual' },
    { k: 'nucleo',      l: 'Núcleo (competencias comunes)' },
    { k: 'tecnico',     l: 'Técnico (competencias del rol)' },
    { k: 'general',     l: 'General (con percentil)' },
    { k: 'tareas_nota', l: 'Nota de tareas' },
  ];
  // Cinco series distinguibles sin salir de la paleta: además del color cambian el trazo y la forma del punto.
  const COLOR_SERIE = ['--data', '--cyan-200', '--marca', '--action', '--txt-2'];
  const DASH = [[], [7, 4], [2, 3], [10, 3, 2, 3], [4, 4]];
  const PUNTO = ['circle', 'rectRot', 'triangle', 'rect', 'crossRot'];
  let S = null;

  const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const fmt = (v, d = 1) => (v == null ? '—' : fmtNum(v, d));
  const media = vs => (vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null);
  const ID = { evo: 'des-ch-evo', rol: 'des-ch-rol', pers: 'des-ch-pers', mio: 'des-ch-mio' };

  /* ── Lectura de filas ─────────────────────────────────────────────────── */
  /** Métricas de cada estructura: por roles (columnas de la base) o clásica (total + un criterio por columna). */
  // Los criterios de la clásica salen del Store del portal; el panel de administración puede abrir esta pestaña antes de que el
  // Store los tenga, así que si faltan se piden una vez a la API existente (filas crudas: nombre = label).
  const criteriosClasica = () => {
    const del = typeof getCriterios === 'function' ? getCriterios() : [];
    return (del.length ? del : (S?.crits || [])).map(c => ({ ...c, nombre: c.nombre || c.label || c.key }));
  };
  const metricasDe = () => (S.modelo === 'v2' ? METRICAS
    : [{ k: 'total_clasico', l: 'Puntaje total' }, ...criteriosClasica().map(c => ({ k: 'c:' + c.key, l: c.nombre }))]);
  const metricaDe = () => S.metrica;
  const criterioDe = k => criteriosClasica().find(c => 'c:' + c.key === k);
  /** Puntaje de un criterio de la clásica: el publicado de `evaluaciones`, leído por (período, persona). */
  const puntajeClasico = (r, k) => { const v = S.pun?.get(r.periodo_id + '|' + r.persona_id)?.[k.slice(2)]; return v == null || v === '' ? null : num(v); };
  /** Valor publicado de una fila, o null (sin evaluación, borrador, no participa o de otra rúbrica). */
  function valor(r, m = metricaDe()) {
    if (!r || !r.participa || r.estado_eval !== 'publicado' || r.modelo !== S.modelo) return null;
    if (typeof m === 'string' && m.startsWith('c:')) return puntajeClasico(r, m);
    return num(r[m]);
  }
  const maxEscala = () => {
    if (S.modelo === 'v2') return 100;
    const c = criterioDe(S.metrica);
    if (c) return maxDe(c);
    return typeof hayCriterios === 'function' && hayCriterios() ? MAX_TOTAL() : null;
  };
  const etiquetaMetrica = () => (metricasDe().find(x => x.k === S.metrica) || { l: 'Puntaje total (clásica)' }).l;
  const deEscala = () => { const m = maxEscala(); return m ? ` de ${m}` : ''; };

  function periodosDe(rows, modelo) {
    const m = new Map();
    for (const r of rows) if (r.modelo === modelo && r.participa && !m.has(r.periodo_id)) m.set(r.periodo_id, { id: r.periodo_id, nombre: r.periodo_nombre, orden: r.periodo_orden, activo: !!r.periodo_activo });
    return [...m.values()].sort((a, b) => a.orden - b.orden);
  }
  const hayPublicada = (rows, perId) => rows.some(r => r.periodo_id === perId && r.estado_eval === 'publicado' && r.participa && (num(r.individual) != null || num(r.total_clasico) != null));

  /** Filas de la rúbrica elegida, ya filtradas por rol y distrito (los filtros solo existen en el modo admin). */
  const filas = () => S.rows.filter(r => r.modelo === S.modelo && r.participa
    && (!S.rol || String(r.rol_id ?? '') === S.rol) && (!S.distrito || r.distrito === S.distrito));
  const periodosSel = () => S.periodos.filter(p => S.per.has(p.id));

  function personasDe(rs) {
    const m = new Map();
    for (const r of rs) {
      if (!m.has(r.persona_id)) m.set(r.persona_id, { id: r.persona_id, nombre: r.nombre || '—', rol: r.rol_nombre || 'Sin rol', distrito: r.distrito, porPer: new Map() });
      m.get(r.persona_id).porPer.set(r.periodo_id, r);
    }
    return m;
  }
  function estadistica(perId, rs) {
    const delPer = rs.filter(r => r.periodo_id === perId);
    const vals = delPer.map(r => valor(r)).filter(v => v != null);
    return { n: vals.length, part: delPer.length, media: media(vals), min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null,
      fuera: delPer.filter(r => r.estado_eval === 'borrador' || r.estado_eval === 'sin_publicar').length };
  }
  /** Último y anterior períodos (entre los elegidos) que tienen al menos un resultado publicado. */
  function ultimoYPrevio(est) {
    const con = est.filter(e => e.n);
    return { ult: con[con.length - 1] || null, prev: con[con.length - 2] || null };
  }

  const nivelDe = v => (S.modelo === 'v2'
    ? { clase: nivelV2(v).key, label: nivelV2(v).label, color: scoreColorTxtV2(v) }
    : { clase: scoreClass(v), label: scoreLabel(v), color: scoreColorTxt(v) });
  const valorHTML = (v, conNivel = false) => {
    if (v == null) return '<span class="des-nd" aria-label="Sin dato">—</span>';
    const n = conNivel && (S.modelo === 'v2' ? S.metrica === 'individual' || S.metrica === 'general' : S.metrica === 'total_clasico') ? nivelDe(v) : null;
    return `<span class="seg-val"><b${n ? ` style="color:${n.color}"` : ''}>${escHtml(fmt(v))}</b></span>${n ? `<span class="nivel-badge ${escHtml(n.clase)}">${escHtml(n.label)}</span>` : ''}`;
  };

  const principal = () => (S.modelo === 'v2' ? 'individual' : 'total_clasico');
  /** Ejecuta fn con la métrica principal (resultado individual / puntaje total) aunque el filtro muestre un criterio. */
  const conPrincipal = fn => { const m = S.metrica; S.metrica = principal(); try { return fn(); } finally { S.metrica = m; } };
  /** Promedio del grupo (con los filtros de rol y distrito) por período, en la métrica principal: la vara con la que se mira a cada persona. */
  function mediasEquipo(rs) {
    const m = new Map();
    for (const p of S.periodos) {
      const v = rs.filter(r => r.periodo_id === p.id).map(r => valor(r, principal())).filter(x => x != null);
      if (v.length) m.set(p.id, media(v));
    }
    return m;
  }

  /* ── Piezas de presentación ───────────────────────────────────────────── */
  const kpi = (val, lbl, sub, extra = '') => `<div class="kpi"><div class="kpi__val">${val}</div><div class="kpi__lbl">${escHtml(lbl)}</div><div class="seg-kpi-sub">${escHtml(sub)}${extra ? ` ${extra}` : ''}</div></div>`;
  const vacio = txt => `<div class="empty-box"><div class="empty-txt">${escHtml(txt)}</div></div>`;
  const grafico = (id, titulo, alt) => `<div class="chart-wrap"><canvas id="${id}" role="img" aria-label="${escHtml(titulo)}" aria-describedby="${id}-alt"></canvas></div>
    <p class="chart-alt" id="${id}-alt">${escHtml(alt)}</p>`;
  const escalaY = () => { const mx = maxEscala(); return { y: { min: 0, ...(mx ? { max: mx } : {}), ticks: { stepSize: mx === 100 ? 25 : undefined } } }; };
  const estiloLinea = (i, color, extra = {}) => ({ borderColor: color, backgroundColor: color, pointBackgroundColor: color, pointBorderColor: token('--bg', '#061326'),
    pointBorderWidth: 2, pointRadius: 5, pointHoverRadius: 7, borderWidth: 2, tension: .3, spanGaps: true, borderDash: DASH[i % DASH.length], pointStyle: PUNTO[i % PUNTO.length], ...extra });
  const limpiarGraficos = () => Object.values(ID).forEach(borrarGrafico);

  /* ══════════════════════════════════════════════════════════════════════
     ADMINISTRACIÓN
     ══════════════════════════════════════════════════════════════════════ */
  function controlesAdmin() {
    const host = document.getElementById('des-ctrl');
    if (!host) return;
    const modelos = [...new Set(S.rows.map(r => r.modelo))];
    const roles = [...new Map(S.rows.map(r => [String(r.rol_id ?? ''), r.rol_nombre || 'Sin rol'])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
    const distritos = [...new Set(S.rows.map(r => r.distrito).filter(Boolean))].sort();
    const opt = (v, t, sel) => `<option value="${escHtml(v)}"${sel ? ' selected' : ''}>${escHtml(t)}</option>`;
    host.innerHTML = `
      ${modelos.length > 1 ? `<label class="eq-f"><span>Rúbrica</span><select class="cfg-inp cfg-select" id="des-modelo" data-change="desFiltro">${opt('v2', 'Por roles (períodos nuevos)', S.modelo === 'v2')}${opt('legacy', 'Clásica (períodos antiguos)', S.modelo !== 'v2')}</select></label>` : ''}
      <label class="eq-f"><span>Métrica</span><select class="cfg-inp cfg-select" id="des-metrica" data-change="desFiltro">${metricasDe().map(m => opt(m.k, m.l, m.k === S.metrica)).join('')}</select></label>
      ${roles.length > 1 ? `<label class="eq-f"><span>Rol</span><select class="cfg-inp cfg-select" id="des-rol" data-change="desFiltro">${opt('', 'Todos los roles', !S.rol)}${roles.map(([id, n]) => opt(id, n, id === S.rol)).join('')}</select></label>` : ''}
      ${distritos.length > 1 ? `<label class="eq-f"><span>Distrito</span><select class="cfg-inp cfg-select" id="des-distrito" data-change="desFiltro">${opt('', 'Todos los distritos', !S.distrito)}${distritos.map(d => opt(d, typeof _distritoNombre === 'function' ? _distritoNombre(d) : d, d === S.distrito)).join('')}</select></label>` : ''}
      <label class="eq-f eq-f--busca"><span>Buscar persona</span><input class="search-inp" id="des-q" type="search" placeholder="Buscar persona…" data-input="desFiltro" value="${escHtml(S.q)}"></label>
      ${modelos.length > 1 ? `<p class="des-nota des-ayuda">Cada estructura de evaluación se compara solo con los períodos que usan la misma estructura: elige arriba cuál ver.</p>` : ''}
      <fieldset class="des-periodos"><legend>Períodos incluidos</legend>
        ${S.periodos.map(p => `<label class="tk-check"><input type="checkbox" class="des-per" value="${escHtml(p.id)}" data-change="desFiltro"${S.per.has(p.id) ? ' checked' : ''}><span>${escHtml(p.nombre)}${p.activo ? ' · activo' : ''}</span></label>`).join('') || '<span class="des-nd">Sin períodos con esta rúbrica.</span>'}
      </fieldset>`;
  }

  function seccionKpisAdmin(rs, est) {
    const { ult, prev } = ultimoYPrevio(est);
    if (!ult) return vacio('Todavía no hay evaluaciones publicadas con estos filtros.');
    const pers = personasDe(rs);
    let suben = 0, bajan = 0, iguales = 0;
    if (prev) for (const p of pers.values()) {
      const a = valor(p.porPer.get(ult.p.id)), b = valor(p.porPer.get(prev.p.id));
      if (a == null || b == null) continue;
      const d = Math.round((a - b) * 10) / 10;
      if (d > 0) suben++; else if (d < 0) bajan++; else iguales++;
    }
    const sel = new Set(est.map(e => e.p.id));
    const conPlazo = rs.filter(r => sel.has(r.periodo_id)).reduce((a, r) => a + (Number(r.con_plazo) || 0), 0);
    const aTiempo = rs.filter(r => sel.has(r.periodo_id)).reduce((a, r) => a + (Number(r.a_tiempo) || 0), 0);
    return `<div class="kpi-row seg-kpis">
      ${kpi(escHtml(fmt(ult.media)), 'PROMEDIO DEL EQUIPO', `${ult.p.nombre} · ${etiquetaMetrica()}${deEscala()}`, prev ? deltaHTML(ult.media, prev.media, { decimales: 1, ref: prev.p.nombre }) : '')}
      ${kpi(ult.part ? Math.round(ult.n / ult.part * 100) + ' %' : '—', 'EVALUADAS Y PUBLICADAS', `${ult.n} de ${ult.part} personas en ${ult.p.nombre}`)}
      ${kpi(prev ? `${suben} ↑ · ${bajan} ↓` : '—', 'QUIÉNES SUBEN Y BAJAN', prev ? `${iguales} sin cambio, de ${suben + bajan + iguales} con dato en ambos períodos` : 'Hace falta un período anterior con datos')}
      ${kpi(conPlazo ? Math.round(aTiempo / conPlazo * 100) + ' %' : '—', 'ENTREGAS A TIEMPO', `${aTiempo} de ${conPlazo} entregas con plazo, en los períodos elegidos`)}
    </div>`;
  }

  function seccionEvolucion(est) {
    const conDato = est.filter(e => e.n);
    if (conDato.length < 1) return '';
    const alt = est.map(e => `${e.p.nombre}: ${e.n ? `promedio ${fmt(e.media)}, mínimo ${fmt(e.min)}, máximo ${fmt(e.max)}` : 'sin resultados publicados'}`).join('. ') + '.';
    const filasT = est.map((e, i) => {
      const previo = est.slice(0, i).reverse().find(x => x.n);
      return `<tr><th scope="row">${escHtml(e.p.nombre)}${e.p.activo ? ' <span class="etiqueta etq-azul">Activo</span>' : ''}</th>
        <td data-label="Promedio" class="seg-celda">${valorHTML(e.media)}</td>
        <td data-label="Mínimo" class="seg-celda">${valorHTML(e.min)}</td>
        <td data-label="Máximo" class="seg-celda">${valorHTML(e.max)}</td>
        <td data-label="Evaluadas" class="seg-celda">${e.n} de ${e.part}${e.fuera ? `<small class="seg-tk">${e.fuera} sin publicar</small>` : ''}</td>
        <td data-label="Cambio" class="seg-celda">${e.n && previo ? deltaHTML(e.media, previo.media, { decimales: 1, ref: previo.p.nombre }) : '<span class="des-nd">—</span>'}</td></tr>`;
    }).join('');
    return `<section class="pf-card pf-card--ancha" aria-labelledby="des-h-evo">
      <h2 class="pf-h" id="des-h-evo">Evolución del equipo <small>${escHtml(etiquetaMetrica())}${escHtml(deEscala())}: promedio, mínimo y máximo por período</small></h2>
      ${conDato.length >= 2 ? grafico(ID.evo, 'Evolución del equipo por período', alt) : '<p class="pf-vacio">La línea aparece cuando hay dos períodos con resultados publicados.</p>'}
      <div class="seg-tabla-wrap"><table class="seg-tabla seg-tabla--persona">
        <caption class="sr-only">Resumen del equipo por período</caption>
        <thead><tr><th scope="col">Período</th><th scope="col">Promedio</th><th scope="col">Mínimo</th><th scope="col">Máximo</th><th scope="col">Evaluadas</th><th scope="col">Cambio</th></tr></thead>
        <tbody>${filasT}</tbody></table></div>
    </section>`;
  }

  function pintarEvolucion(est) {
    if (!document.getElementById(ID.evo)) return;
    pintarGrafico(ID.evo, () => ({
      type: 'line',
      data: { labels: est.map(e => e.p.nombre), datasets: [
        { label: 'Promedio', data: est.map(e => (e.n ? e.media : null)), ...estiloLinea(0, token('--data'), { fill: true, backgroundColor: conAlfa(token('--data'), .12) }) },
        { label: 'Máximo',   data: est.map(e => (e.n ? e.max : null)),   ...estiloLinea(1, token('--cyan-200')) },
        { label: 'Mínimo',   data: est.map(e => (e.n ? e.min : null)),   ...estiloLinea(2, token('--marca')) },
      ] },
      options: { plugins: { legend: { display: true } }, scales: escalaY() },
    }));
  }

  /* — Comparar dos períodos, persona por persona — */
  function seccionComparar(rs) {
    const conDato = S.periodos.filter(p => hayPublicada(rs, p.id));
    if (conDato.length < 2) return `<section class="pf-card pf-card--ancha" aria-labelledby="des-h-cmp"><h2 class="pf-h" id="des-h-cmp">Comparar dos períodos</h2><p class="pf-vacio">Hacen falta al menos dos períodos con resultados publicados.</p></section>`;
    if (!conDato.some(p => p.id === S.cmpA)) S.cmpA = conDato[conDato.length - 2].id;
    if (!conDato.some(p => p.id === S.cmpB)) S.cmpB = conDato[conDato.length - 1].id;
    const A = conDato.find(p => p.id === S.cmpA), B = conDato.find(p => p.id === S.cmpB);
    const pers = [...personasDe(rs).values()].map(p => {
      const a = valor(p.porPer.get(A.id)), b = valor(p.porPer.get(B.id));
      return { ...p, a, b, d: a != null && b != null ? Math.round((b - a) * 10) / 10 : null };
    }).filter(p => p.a != null || p.b != null).sort((x, y) => (y.d ?? -1e9) - (x.d ?? -1e9) || x.nombre.localeCompare(y.nombre, 'es'));
    const ambos = pers.filter(p => p.d != null);
    const suben = ambos.filter(p => p.d > 0).length, bajan = ambos.filter(p => p.d < 0).length;
    const sel = id => conDato.map(p => `<option value="${escHtml(p.id)}"${p.id === id ? ' selected' : ''}>${escHtml(p.nombre)}</option>`).join('');
    const filasT = pers.map(p => `<tr><th scope="row" class="seg-persona"><button type="button" class="seg-nombre" data-act="perfilVer" data-arg="${escHtml(p.id)}" aria-label="Ver el perfil de ${escHtml(p.nombre)}">${escHtml(p.nombre)}</button><small>${escHtml(p.rol)}</small></th>
      <td data-label="${escHtml(A.nombre)}" class="seg-celda">${valorHTML(p.a)}</td>
      <td data-label="${escHtml(B.nombre)}" class="seg-celda">${valorHTML(p.b)}</td>
      <td data-label="Cambio" class="seg-celda">${p.d != null ? deltaHTML(p.b, p.a, { decimales: 1, ref: A.nombre }) : '<span class="des-nd">Sin dato en ambos</span>'}</td></tr>`).join('');
    return `<section class="pf-card pf-card--ancha" aria-labelledby="des-h-cmp">
      <h2 class="pf-h" id="des-h-cmp">Comparar dos períodos <small>quién subió y quién bajó</small></h2>
      <div class="filtros-fila des-par">
        <label class="eq-f"><span>Desde</span><select class="cfg-inp cfg-select" id="des-cmpA" data-change="desFiltro">${sel(S.cmpA)}</select></label>
        <label class="eq-f"><span>Hasta</span><select class="cfg-inp cfg-select" id="des-cmpB" data-change="desFiltro">${sel(S.cmpB)}</select></label>
      </div>
      ${A.id === B.id ? '<p class="pf-vacio">Elige dos períodos distintos.</p>' : `<p class="des-resumen">${suben} suben · ${bajan} bajan · ${ambos.length - suben - bajan} sin cambio, de ${ambos.length} personas con dato en ambos.</p>
      <div class="seg-tabla-wrap"><table class="seg-tabla seg-tabla--persona">
        <caption class="sr-only">Comparación de ${escHtml(A.nombre)} con ${escHtml(B.nombre)}</caption>
        <thead><tr><th scope="col">Persona</th><th scope="col">${escHtml(A.nombre)}</th><th scope="col">${escHtml(B.nombre)}</th><th scope="col">Cambio</th></tr></thead>
        <tbody>${filasT}</tbody></table></div>`}
    </section>`;
  }

  /* — Promedio por rol, un grupo de barras por período — */
  function seccionPorRol(rs, est) {
    const roles = [...new Set(rs.map(r => r.rol_nombre || 'Sin rol'))].sort((a, b) => a.localeCompare(b, 'es'));
    const con = est.filter(e => e.n);
    if (roles.length < 2 || !con.length) return '';
    const dato = (e, rol) => media(rs.filter(r => r.periodo_id === e.p.id && (r.rol_nombre || 'Sin rol') === rol).map(r => valor(r)).filter(v => v != null));
    const alt = roles.map(rol => `${rol}: ${con.map(e => `${e.p.nombre} ${fmt(dato(e, rol))}`).join(', ')}`).join('. ') + '.';
    return `<section class="pf-card pf-card--ancha" aria-labelledby="des-h-rol">
      <h2 class="pf-h" id="des-h-rol">Promedio por rol <small>sirve para calibrar: ¿un rol sale sistemáticamente más alto?</small></h2>
      ${grafico(ID.rol, 'Promedio por rol y período', alt)}
    </section>`;
  }
  function pintarPorRol(rs, est) {
    if (!document.getElementById(ID.rol)) return;
    const roles = [...new Set(rs.map(r => r.rol_nombre || 'Sin rol'))].sort((a, b) => a.localeCompare(b, 'es'));
    const con = est.filter(e => e.n);
    pintarGrafico(ID.rol, () => {
      const c = token('--data');
      return {
        type: 'bar',
        data: { labels: roles, datasets: con.map((e, k) => ({
          label: e.p.nombre,
          data: roles.map(rol => media(rs.filter(r => r.periodo_id === e.p.id && (r.rol_nombre || 'Sin rol') === rol).map(r => valor(r)).filter(v => v != null))),
          // Rampa de luminosidad del mismo color de dato: los períodos más recientes, más intensos.
          backgroundColor: conAlfa(c, con.length === 1 ? 1 : .3 + .7 * k / (con.length - 1)), borderColor: c, borderWidth: 1, borderRadius: 4,
        })) },
        options: { plugins: { legend: { display: true } }, scales: escalaY() },
      };
    });
  }

  /* — Desempeño individual: una tarjeta por persona y el detalle de la elegida — */
  function chispa(vals) {
    const pts = vals.map((v, i) => ({ v, i })).filter(x => x.v != null);
    if (pts.length < 2) return '';
    const mx = S.modelo === 'v2' ? 100 : (typeof hayCriterios === 'function' && hayCriterios() ? MAX_TOTAL() : Math.max(...pts.map(x => x.v), 1));
    const n = vals.length;
    const xy = pts.map(x => `${(4 + (n === 1 ? 0 : x.i / (n - 1)) * 92).toFixed(1)},${(26 - Math.max(0, Math.min(1, x.v / mx)) * 22).toFixed(1)}`).join(' ');
    return `<svg class="des-chispa" viewBox="0 0 100 30" aria-hidden="true" focusable="false"><polyline points="${xy}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }
  function tarjetaPersona(p, est) {
    const vals = est.map(e => valor(p.porPer.get(e.p.id), principal()));
    const con = vals.map((v, i) => ({ v, i })).filter(x => x.v != null);
    const u = con[con.length - 1], a = con[con.length - 2];
    const nv = u ? nivelDe(u.v) : null, on = p.id === S.sel;
    return `<li><button type="button" class="des-card${on ? ' des-card--on' : ''}" data-act="des" data-arg="ver" data-arg2="${escHtml(p.id)}" aria-pressed="${on}">
      <span class="des-card-n">${escHtml(p.nombre)}</span>
      <span class="des-card-s">${escHtml(p.rol)}${p.distrito ? ' · ' + escHtml(p.distrito) : ''}</span>
      <span class="des-card-v">${u ? `<b style="color:${nv.color}">${escHtml(fmt(u.v))}</b><span class="nivel-badge ${escHtml(nv.clase)}">${escHtml(nv.label)}</span>` : '<span class="des-nd">Sin resultado publicado</span>'}</span>
      <span class="des-card-p">${u ? `${escHtml(est[u.i].p.nombre)}${a ? ' ' + deltaHTML(u.v, a.v, { decimales: 1, ref: est[a.i].p.nombre }) : ''}` : ''}</span>
      ${chispa(vals)}</button></li>`;
  }
  /** Personas visibles (filtros + búsqueda), de mayor a menor resultado en el último período con dato. */
  function listaPersonas(rs, est) {
    const q = S.q.toLowerCase().trim();
    const { ult } = ultimoYPrevio(est);
    return [...personasDe(rs).values()].filter(p => !q || p.nombre.toLowerCase().includes(q))
      .map(p => ({ ...p, u: ult ? valor(p.porPer.get(ult.p.id), principal()) : null }))
      .sort((x, y) => (y.u ?? -1) - (x.u ?? -1) || x.nombre.localeCompare(y.nombre, 'es'));
  }
  function seccionIndividual(rs, est, lista) {
    if (!lista.length) return `<section class="pf-card pf-card--ancha" aria-labelledby="des-h-ind"><h2 class="pf-h" id="des-h-ind">Cada persona</h2>${vacio('Nadie coincide con los filtros.')}</section>`;
    return `<section class="pf-card pf-card--ancha" aria-labelledby="des-h-ind">
      <h2 class="pf-h" id="des-h-ind">Cada persona <small>${escHtml(etiquetaPrincipal())} · toca una tarjeta para ver su detalle</small></h2>
      <ul class="des-cards">${lista.map(p => tarjetaPersona(p, est)).join('')}</ul>
    </section>
    <div id="des-det">${detallePersona(rs, est)}</div>`;
  }
  const etiquetaPrincipal = () => (S.modelo === 'v2' ? 'Resultado individual (0–100)' : 'Puntaje total (rúbrica clásica)');
  function detallePersona(rs, est) {
    const p = personasDe(rs).get(S.sel);
    if (!p) return '';
    const ids = new Set(est.map(e => e.p.id));
    const fs = [...p.porPer.values()].filter(r => ids.has(r.periodo_id)).sort((a, b) => a.periodo_orden - b.periodo_orden);
    const o = { nombre: p.nombre, equipo: mediasEquipo(rs) };
    S.det = { fs, o };
    return `<div class="des-det-cab"><div><h2 class="pf-h" id="des-h-det">${escHtml(p.nombre)}</h2>
      <p class="des-det-s">${escHtml(p.rol)}${p.distrito ? ' · ' + escHtml(p.distrito) : ''} — frente al promedio del equipo${S.rol || S.distrito ? ' (con los filtros aplicados)' : ''}</p></div>
      <button type="button" class="btn--secundario" data-act="perfilVer" data-arg="${escHtml(p.id)}">Ver perfil completo</button></div>
      ${conPrincipal(() => seccionKpisPropio(fs, o) + seccionEvolucionPropia(fs, o))}`;
  }
  function repintarDetalle() {
    const el = document.getElementById('des-det');
    if (!el) return;
    borrarGrafico(ID.mio);
    el.innerHTML = detallePersona(S.rs, S.est);
    if (S.det) pintarEvolucionPropia(S.det.fs, S.det.o);
    document.querySelectorAll('.des-card').forEach(b => { const on = b.dataset.arg2 === S.sel; b.classList.toggle('des-card--on', on); b.setAttribute('aria-pressed', String(on)); });
    if (typeof renderIconos === 'function') renderIconos(el);
  }

  /* — Comparar varias personas a la vez — */
  function seccionPersonas(rs, est) {
    const pers = [...personasDe(rs).values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const elegidas = [...S.personas].map(id => pers.find(p => p.id === id)).filter(Boolean);
    S.personas = new Set(elegidas.map(p => p.id));
    return `<section class="pf-card pf-card--ancha" aria-labelledby="des-h-pers">
      <h2 class="pf-h" id="des-h-pers">Comparar personas <small>hasta ${MAX_PERSONAS} a la vez, a lo largo de los períodos elegidos</small></h2>
      <div class="des-elegir">
        <div class="des-lista-wrap">
          <label class="eq-f"><span>Buscar en la lista</span><input class="search-inp" id="des-q-pers" type="search" placeholder="Nombre…" data-input="desFiltro" autocomplete="off"></label>
          <ul class="des-lista" id="des-lista" aria-label="Personas para comparar">
            ${pers.map(p => `<li data-nombre="${escHtml(p.nombre.toLowerCase())}"><label class="tk-check"><input type="checkbox" class="des-pers" value="${escHtml(p.id)}" data-change="desFiltro"${S.personas.has(p.id) ? ' checked' : ''}><span>${escHtml(p.nombre)} <small class="des-rol">${escHtml(p.rol)}</small></span></label></li>`).join('')}
          </ul>
        </div>
        <div class="des-comp" id="des-comp">${cuerpoPersonas(elegidas, est)}</div>
      </div>
    </section>`;
  }
  function cuerpoPersonas(elegidas, est) {
    const chips = elegidas.length ? `<div class="chip-row des-chips">${elegidas.map((p, i) => `<span class="des-chip des-chip--${i}">${escHtml(p.nombre)}<button type="button" class="btn--icono" data-act="des" data-arg="quitar" data-arg2="${escHtml(p.id)}" aria-label="Quitar a ${escHtml(p.nombre)}"><i data-lucide="x" aria-hidden="true"></i></button></span>`).join('')}
      <button type="button" class="btn--texto" data-act="des" data-arg="limpiar">Quitar todas</button></div>` : '';
    if (!elegidas.length) return '<p class="pf-vacio">Marca a las personas que quieras comparar en la lista.</p>';
    if (!est.length) return `${chips}<p class="pf-vacio">Elige al menos un período.</p>`;
    const alt = elegidas.map(p => `${p.nombre}: ${est.map(e => `${e.p.nombre} ${fmt(valor(p.porPer.get(e.p.id)))}`).join(', ')}`).join('. ') + '.';
    const filasT = elegidas.map(p => {
      const vals = est.map(e => valor(p.porPer.get(e.p.id)));
      const con = vals.map((v, i) => ({ v, i })).filter(x => x.v != null);
      const u = con[con.length - 1], a = con[con.length - 2];
      return `<tr><th scope="row" class="seg-persona"><button type="button" class="seg-nombre" data-act="perfilVer" data-arg="${escHtml(p.id)}" aria-label="Ver el perfil de ${escHtml(p.nombre)}">${escHtml(p.nombre)}</button><small>${escHtml(p.rol)}</small></th>
        ${est.map((e, i) => `<td data-label="${escHtml(e.p.nombre)}" class="seg-celda">${valorHTML(vals[i])}</td>`).join('')}
        <td data-label="Cambio" class="seg-celda">${u && a ? deltaHTML(u.v, a.v, { decimales: 1, ref: est[a.i].p.nombre }) : '<span class="des-nd">—</span>'}</td></tr>`;
    }).join('');
    return `${chips}${grafico(ID.pers, 'Comparación de personas por período', alt)}
      <div class="seg-tabla-wrap"><table class="seg-tabla seg-tabla--persona">
        <caption class="sr-only">Comparación de personas por período</caption>
        <thead><tr><th scope="col">Persona</th>${est.map(e => `<th scope="col">${escHtml(e.p.nombre)}</th>`).join('')}<th scope="col">Cambio</th></tr></thead>
        <tbody>${filasT}</tbody></table></div>`;
  }
  function pintarPersonas(elegidas, est) {
    if (!document.getElementById(ID.pers)) return;
    pintarGrafico(ID.pers, () => ({
      type: 'line',
      data: { labels: est.map(e => e.p.nombre), datasets: elegidas.map((p, i) => ({
        label: p.nombre, data: est.map(e => valor(p.porPer.get(e.p.id))), ...estiloLinea(i, token(COLOR_SERIE[i % COLOR_SERIE.length])),
      })) },
      options: { plugins: { legend: { display: true } }, scales: escalaY() },
    }));
  }

  /* — Todas las personas — */
  function seccionTodas(rs, est) {
    const q = S.q.toLowerCase().trim();
    const { ult, prev } = ultimoYPrevio(est);
    const pers = [...personasDe(rs).values()].filter(p => !q || p.nombre.toLowerCase().includes(q)).map(p => {
      const vals = est.map(e => valor(p.porPer.get(e.p.id)));
      const u = ult ? valor(p.porPer.get(ult.p.id)) : null, a = prev ? valor(p.porPer.get(prev.p.id)) : null;
      return { ...p, vals, u, a };
    }).sort((x, y) => (y.u ?? -1) - (x.u ?? -1) || x.nombre.localeCompare(y.nombre, 'es'));
    const filasT = pers.map(p => `<tr><th scope="row" class="seg-persona"><button type="button" class="seg-nombre" data-act="perfilVer" data-arg="${escHtml(p.id)}" aria-label="Ver el perfil de ${escHtml(p.nombre)}">${escHtml(p.nombre)}</button><small>${escHtml(p.rol)}${p.distrito ? ' · ' + escHtml(p.distrito) : ''}</small></th>
      ${est.map((e, i) => `<td data-label="${escHtml(e.p.nombre)}" class="seg-celda">${valorHTML(p.vals[i], i === est.length - 1)}</td>`).join('')}
      <td data-label="Cambio" class="seg-celda">${p.u != null && p.a != null ? deltaHTML(p.u, p.a, { decimales: 1, ref: prev.p.nombre }) : '<span class="des-nd">—</span>'}</td></tr>`).join('');
    return `<section class="pf-card pf-card--ancha" aria-labelledby="des-h-todas">
      <h2 class="pf-h" id="des-h-todas">Todas las personas <small>ordenadas por ${ult ? escHtml(ult.p.nombre) : 'el último período'}; cada nombre abre su perfil</small></h2>
      ${pers.length ? `<div class="seg-tabla-wrap"><table class="seg-tabla">
        <caption class="sr-only">Resultados de todas las personas por período</caption>
        <thead><tr><th scope="col">Persona</th>${est.map(e => `<th scope="col">${escHtml(e.p.nombre)}</th>`).join('')}<th scope="col">Cambio</th></tr></thead>
        <tbody>${filasT}</tbody></table></div>` : vacio('Nadie coincide con los filtros.')}
    </section>`;
  }

  function pintarAdmin() {
    limpiarGraficos();
    const cuerpo = document.getElementById('des-cuerpo');
    if (!cuerpo) return;
    const rs = filas();
    const est = periodosSel().map(p => ({ p, ...estadistica(p.id, rs) }));
    S.est = est; S.rs = rs; S.det = null;
    const fuera = est.reduce((a, e) => a + e.fuera, 0);
    const lista = listaPersonas(rs, est);
    if (!lista.some(p => p.id === S.sel)) S.sel = lista[0]?.id || null;
    cuerpo.innerHTML = `${fuera ? `<p class="des-nota">${fuera} evaluación${fuera === 1 ? '' : 'es'} sin publicar no ${fuera === 1 ? 'entra' : 'entran'} en estas cifras: solo cuentan los resultados publicados.</p>` : ''}
      <h2 class="des-grupo-t">Desempeño individual</h2>
      ${seccionIndividual(rs, est, lista)}
      ${seccionPersonas(rs, est)}
      ${seccionComparar(rs)}
      ${seccionTodas(rs, est)}
      <h2 class="des-grupo-t">Desempeño del equipo por período</h2>
      ${seccionKpisAdmin(rs, est)}
      ${seccionEvolucion(est)}
      ${seccionPorRol(rs, est)}
      <details class="seg-como"><summary>¿Cómo se calcula?</summary><ul class="rol-lista">
        <li><b>Fuente</b>: los mismos resultados del Seguimiento y del perfil de cada persona; aquí no se recalcula nada.</li>
        <li><b>Promedio del equipo</b>: media simple de los resultados publicados del período, una vez por persona.</li>
        <li><b>Cambio</b>: último valor menos el del período anterior con dato. Un hueco no se rellena.</li>
        <li><b>Rúbricas</b>: la de roles (0–100) y la clásica están en escalas distintas; se eligen por separado y nunca se mezclan.</li>
        <li><b>Quién cuenta</b>: solo evaluaciones publicadas y solo personas que participan en ese período.</li>
      </ul></details>`;
    const elegidas = [...S.personas].map(id => personasDe(rs).get(id)).filter(Boolean);
    pintarEvolucion(est); pintarPorRol(rs, est); pintarPersonas(elegidas, est);
    if (S.det) pintarEvolucionPropia(S.det.fs, S.det.o);
    if (typeof renderIconos === 'function') renderIconos(cuerpo);
    if (typeof animarEntrada === 'function') animarEntrada(cuerpo);
  }
  /** Solo el bloque de comparar personas (al marcar o quitar a alguien): conserva el foco y el scroll de la lista. */
  function repintarPersonas() {
    const rs = S.rs, est = S.est, el = document.getElementById('des-comp');
    if (!el) return;
    borrarGrafico(ID.pers);
    const pers = personasDe(rs);
    const elegidas = [...S.personas].map(id => pers.get(id)).filter(Boolean);
    el.innerHTML = cuerpoPersonas(elegidas, est);
    pintarPersonas(elegidas, est);
    if (typeof renderIconos === 'function') renderIconos(el);
  }

  async function montarAdmin(host) {
    if (!host) return;
    renderCargando(host);
    const res = await API.getSeguimientoGlobal();
    if (!res.ok) {
      if (res.noDisponible) host.innerHTML = vacio('Desempeño necesita la migración 0025 en la base de datos. Aplícala en Supabase y recarga.');
      else renderError(host, res.error, () => montarAdmin(host));
      return;
    }
    if (!res.rows.length) { host.innerHTML = vacio('Todavía no hay personas ni períodos en esta gestión.'); return; }
    const previo = S && S.host === host && S.modo === 'admin' ? S : null;
    const rows = res.rows;
    const modelo = previo?.modelo && rows.some(r => r.modelo === previo.modelo) ? previo.modelo : (rows.some(r => r.modelo === 'v2') ? 'v2' : 'legacy');
    S = { host, modo: 'admin', rows, modelo, pun: new Map(), metrica: previo && previo.modelo === modelo ? previo.metrica : (modelo === 'v2' ? 'individual' : 'total_clasico'), rol: previo?.rol || '', distrito: previo?.distrito || '', q: previo?.q || '',
      personas: new Set(previo?.personas || []), sel: previo?.sel || null, cmpA: previo?.cmpA || null, cmpB: previo?.cmpB || null, per: new Set(), periodos: [] };
    prepararPeriodos(previo);
    await cargarPuntajesAdmin(rows);
    host.innerHTML = `<div class="filtros-fila des-ctrl" id="des-ctrl"></div><div id="des-cuerpo"></div>`;
    controlesAdmin();
    pintarAdmin();
  }
  /** Puntajes publicados por criterio de los PE clásicos (los mismos de `evaluaciones`; una consulta por período antiguo). */
  async function cargarPuntajesAdmin(rows) {
    S.pun = new Map();
    const ids = [...new Set(rows.filter(r => r.modelo !== 'v2').map(r => r.periodo_id))];
    if (!ids.length || typeof API.getEvaluacionesByPE !== 'function') return;
    S.crits = S.crits || [];
    if (!criteriosClasica().length && typeof API.getCriterios === 'function') S.crits = await Promise.resolve(API.getCriterios(true)).catch(() => []);
    const listas = await Promise.all(ids.map(id => Promise.resolve(API.getEvaluacionesByPE(id)).catch(() => [])));
    listas.forEach((ev, i) => (ev || []).filter(e => e.estado === 'publicado').forEach(e => S.pun.set(ids[i] + '|' + e.evaluado_id, typeof parseJSON === 'function' ? parseJSON(e.puntajes) : (e.puntajes || {}))));
  }
  /** Períodos de la rúbrica elegida; por defecto, todos los que ya tienen algún resultado publicado. */
  function prepararPeriodos(previo) {
    S.periodos = periodosDe(S.rows, S.modelo);
    const validos = new Set(S.periodos.map(p => p.id));
    const guardados = previo && previo.modelo === S.modelo ? [...previo.per].filter(id => validos.has(id)) : [];
    S.per = new Set(guardados.length ? guardados : S.periodos.filter(p => hayPublicada(S.rows, p.id)).map(p => p.id));
  }

  /* ══════════════════════════════════════════════════════════════════════
     MI DESEMPEÑO (solo la propia trayectoria)
     ══════════════════════════════════════════════════════════════════════ */
  const columnasPropias = () => (S.modelo === 'v2' ? COLUMNAS_V2 : metricasDe());
  const COLUMNAS_V2 = [
    { k: 'individual',  l: 'Individual' }, { k: 'nucleo', l: 'Núcleo' }, { k: 'tecnico', l: 'Técnico' },
    { k: 'general',     l: 'General' },    { k: 'tareas_nota', l: 'Nota de tareas' },
  ];
  /** Mis filas de la rúbrica elegida, en orden, de períodos en los que participo. */
  const misFilas = () => S.rows.filter(r => r.persona_id === S.yo && r.modelo === S.modelo && r.participa).sort((a, b) => a.periodo_orden - b.periodo_orden);
  const publicadas = fs => fs.filter(r => r.estado_eval === 'publicado' && valor(r, S.modelo === 'v2' ? 'individual' : 'total_clasico') != null);

  function tendencia(vals) {
    if (vals.length < 2) return null;
    const ult = vals[vals.length - 1], antes = media(vals.slice(0, -1));
    const mx = maxEscala() || Math.max(...vals, 1);
    const d = ult - antes, umbral = mx * 0.03;
    return d > umbral ? { k: 'sube', t: 'Al alza', d } : d < -umbral ? { k: 'baja', t: 'A la baja', d } : { k: 'igual', t: 'Estable', d };
  }

  function seccionKpisPropio(fs, o = {}) {
    const de = !!o.nombre;                                  // vista de una persona elegida por la administración
    const pub = publicadas(fs);
    const m = S.modelo === 'v2' ? 'individual' : 'total_clasico';
    if (!pub.length) return vacio(de ? 'Esta persona todavía no tiene evaluaciones publicadas con esta rúbrica.' : 'Todavía no tienes evaluaciones publicadas con esta rúbrica. Cuando se publique la primera, aquí aparecerá tu trayectoria.');
    const vals = pub.map(r => valor(r, m));
    const u = pub[pub.length - 1], a = pub[pub.length - 2];
    const mejor = pub.reduce((b, r) => (valor(r, m) > valor(b, m) ? r : b), pub[0]);
    const tend = tendencia(vals);
    const conPlazo = fs.reduce((x, r) => x + (Number(r.con_plazo) || 0), 0), aTiempo = fs.reduce((x, r) => x + (Number(r.a_tiempo) || 0), 0);
    const nv = nivelDe(vals[vals.length - 1]);
    const eq = o.equipo ? o.equipo.get(u.periodo_id) : null;
    const dif = eq != null ? Math.round((vals[vals.length - 1] - eq) * 10) / 10 : null;
    return `<div class="kpi-row seg-kpis">
      ${kpi(`<span style="color:${nv.color}">${escHtml(fmt(vals[vals.length - 1]))}</span>`, (de ? 'ÚLTIMO RESULTADO' : 'TU ÚLTIMO RESULTADO'), `${u.periodo_nombre}${deEscala()} · ${nv.label}`, a ? deltaHTML(valor(u, m), valor(a, m), { decimales: 1, ref: a.periodo_nombre }) : '')}
      ${kpi(escHtml(fmt(media(vals))), (de ? 'PROMEDIO' : 'TU PROMEDIO'), `${pub.length} período${pub.length === 1 ? '' : 's'} publicado${pub.length === 1 ? '' : 's'}`)}
      ${kpi(escHtml(fmt(valor(mejor, m))), (de ? 'MEJOR PERÍODO' : 'TU MEJOR PERÍODO'), mejor.periodo_nombre)}
      ${kpi(tend ? escHtml(tend.t) : '—', 'TENDENCIA', tend ? `Último resultado frente al promedio de los ${vals.length - 1} anterior${vals.length - 1 === 1 ? '' : 'es'}` : 'Hacen falta dos períodos publicados')}
      ${kpi(conPlazo ? Math.round(aTiempo / conPlazo * 100) + ' %' : '—', 'ENTREGAS A TIEMPO', `${aTiempo} de ${conPlazo} entregas con plazo`)}
      ${dif != null ? kpi(escHtml((dif > 0 ? '+' : dif < 0 ? '−' : '') + fmt(Math.abs(dif))), 'FRENTE AL EQUIPO', `Promedio del equipo en ${u.periodo_nombre}: ${fmt(eq)}`) : ''}
    </div>`;
  }

  function celdaPropia(r, k) {
    if (r.estado_eval !== 'publicado') return '<span class="des-nd">—</span>';
    const v = k.startsWith('c:') ? puntajeClasico(r, k) : num(r[k]);
    if (v == null) return '<span class="des-nd">—</span>';
    const nv = k === 'individual' || k === 'total_clasico' ? nivelDe(v) : null;
    return `<span class="seg-val"><b${nv ? ` style="color:${nv.color}"` : ''}>${escHtml(fmt(v))}</b></span>${nv ? `<span class="nivel-badge ${escHtml(nv.clase)}">${escHtml(nv.label)}</span>` : ''}`;
  }
  function celdasEquipo(r, m, equipo) {
    const eq = equipo.get(r.periodo_id), v = r.estado_eval === 'publicado' ? valor(r, m) : null;
    return `<td data-label="Promedio del equipo" class="seg-celda">${valorHTMLPropio(eq ?? null)}</td>
      <td data-label="Frente al equipo" class="seg-celda">${v != null && eq != null ? deltaHTML(v, eq, { decimales: 1, ref: 'el equipo' }) : '<span class="des-nd">—</span>'}</td>`;
  }
  function seccionEvolucionPropia(fs, o = {}) {
    const de = !!o.nombre;
    const pub = publicadas(fs);
    const cols = columnasPropias();
    const alt = fs.map(r => `${r.periodo_nombre}: ${r.estado_eval === 'publicado' ? (S.modelo === 'v2' ? `individual ${fmt(num(r.individual))}, núcleo ${fmt(num(r.nucleo))}, técnico ${fmt(num(r.tecnico))}` : `${fmt(num(r.total_clasico))}${deEscala()}`) : 'sin publicar'}`).join('. ') + '.';
    const filasT = fs.map((r, i) => {
      const previo = fs.slice(0, i).reverse().find(x => x.estado_eval === 'publicado' && valor(x, S.modelo === 'v2' ? 'individual' : 'total_clasico') != null);
      const m = S.modelo === 'v2' ? 'individual' : 'total_clasico';
      const aTiempo = r.con_plazo ? `${Number(r.a_tiempo)} de ${Number(r.con_plazo)} a tiempo` : (r.tareas_total ? `${Number(r.tareas_total)} tarea${r.tareas_total === 1 ? '' : 's'}` : '—');
      return `<tr><th scope="row">${escHtml(r.periodo_nombre)}${r.periodo_activo ? ' <span class="etiqueta etq-azul">Activo</span>' : ''}</th>
        ${cols.map(c => `<td data-label="${escHtml(c.l)}" class="seg-celda">${celdaPropia(r, c.k)}</td>`).join('')}
        <td data-label="Tareas" class="seg-celda">${escHtml(aTiempo)}</td>
        <td data-label="Cambio" class="seg-celda">${r.estado_eval !== 'publicado' ? '<span class="etiqueta etq-gris">Sin publicar</span>' : (previo ? deltaHTML(valor(r, m), valor(previo, m), { decimales: 1, ref: previo.periodo_nombre }) : '<span class="des-nd">—</span>')}</td>${o.equipo ? celdasEquipo(r, m, o.equipo) : ''}</tr>`;
    }).join('');
    return `<section class="pf-card pf-card--ancha" aria-labelledby="${de ? 'des-h-pev' : 'des-h-evo'}">
      <h2 class="pf-h" id="${de ? 'des-h-pev' : 'des-h-evo'}">${de ? 'Evolución' : 'Tu evolución'} <small>${S.modelo === 'v2' ? 'escala 0–100' : 'puntaje total de la rúbrica clásica'}</small></h2>
      ${pub.length >= 2 ? grafico(ID.mio, de ? 'Evolución de ' + o.nombre : 'Tu evolución por período', alt) : `<p class="pf-vacio">La línea aparece cuando ${de ? 'haya' : 'tengas'} dos períodos publicados.</p>`}
      <div class="seg-tabla-wrap"><table class="seg-tabla seg-tabla--persona">
        <caption class="sr-only">${de ? 'Resultados por período' : 'Tus resultados por período'}</caption>
        <thead><tr><th scope="col">Período</th>${cols.map(c => `<th scope="col">${escHtml(c.l)}</th>`).join('')}<th scope="col">Tareas</th><th scope="col">Cambio</th>${o.equipo ? '<th scope="col">Promedio del equipo</th><th scope="col">Frente al equipo</th>' : ''}</tr></thead>
        <tbody>${filasT}</tbody></table></div>
    </section>`;
  }
  function pintarEvolucionPropia(fs, o = {}) {
    if (!document.getElementById(ID.mio)) return;
    const pub = publicadas(fs);
    const esc = conPrincipal(escalaY);
    pintarGrafico(ID.mio, () => {
      const serie = (label, k, i) => ({ label, data: pub.map(r => num(r[k])), ...estiloLinea(i, token(COLOR_SERIE[i])) });
      const ds = S.modelo === 'v2'
        ? [{ ...serie('Individual', 'individual', 0), fill: true, backgroundColor: conAlfa(token('--data'), .12) }, serie('Núcleo', 'nucleo', 1), serie('Técnico', 'tecnico', 2)]
        : [{ ...serie('Puntaje total', 'total_clasico', 0), fill: true, backgroundColor: conAlfa(token('--data'), .12) }];
      if (o.equipo) ds.push({ label: 'Promedio del equipo', data: pub.map(r => o.equipo.get(r.periodo_id) ?? null), ...estiloLinea(4, token('--txt-2')), borderDash: [4, 4] });
      return { type: 'line', data: { labels: pub.map(r => r.periodo_nombre), datasets: ds },
        options: { plugins: { legend: { display: ds.length > 1 } }, scales: esc } };
    });
  }

  /* — Comparar dos de mis períodos — */
  function seccionCompararPropia(fs) {
    const pub = fs.filter(r => r.estado_eval === 'publicado');
    if (pub.length < 2) return '';
    if (!pub.some(r => r.periodo_id === S.cmpA)) S.cmpA = pub[pub.length - 2].periodo_id;
    if (!pub.some(r => r.periodo_id === S.cmpB)) S.cmpB = pub[pub.length - 1].periodo_id;
    const A = pub.find(r => r.periodo_id === S.cmpA), B = pub.find(r => r.periodo_id === S.cmpB);
    const sel = id => pub.map(r => `<option value="${escHtml(r.periodo_id)}"${r.periodo_id === id ? ' selected' : ''}>${escHtml(r.periodo_nombre)}</option>`).join('');
    const cols = columnasPropias();
    const filasT = cols.map(c => {
      const a = c.k.startsWith('c:') ? puntajeClasico(A, c.k) : num(A[c.k]), b = c.k.startsWith('c:') ? puntajeClasico(B, c.k) : num(B[c.k]);
      return `<tr><th scope="row">${escHtml(c.l)}</th><td data-label="${escHtml(A.periodo_nombre)}" class="seg-celda">${valorHTMLPropio(a)}</td><td data-label="${escHtml(B.periodo_nombre)}" class="seg-celda">${valorHTMLPropio(b)}</td>
        <td data-label="Cambio" class="seg-celda">${a != null && b != null ? deltaHTML(b, a, { decimales: 1, ref: A.periodo_nombre }) : '<span class="des-nd">—</span>'}</td></tr>`;
    }).join('');
    return `<section class="pf-card pf-card--ancha" aria-labelledby="des-h-cmp">
      <h2 class="pf-h" id="des-h-cmp">Comparar dos de tus períodos</h2>
      <div class="filtros-fila des-par">
        <label class="eq-f"><span>Desde</span><select class="cfg-inp cfg-select" id="des-cmpA" data-change="desFiltro">${sel(S.cmpA)}</select></label>
        <label class="eq-f"><span>Hasta</span><select class="cfg-inp cfg-select" id="des-cmpB" data-change="desFiltro">${sel(S.cmpB)}</select></label>
      </div>
      ${A.periodo_id === B.periodo_id ? '<p class="pf-vacio">Elige dos períodos distintos.</p>' : `<div class="seg-tabla-wrap"><table class="seg-tabla seg-tabla--persona">
        <caption class="sr-only">Comparación de ${escHtml(A.periodo_nombre)} con ${escHtml(B.periodo_nombre)}</caption>
        <thead><tr><th scope="col">Medida</th><th scope="col">${escHtml(A.periodo_nombre)}</th><th scope="col">${escHtml(B.periodo_nombre)}</th><th scope="col">Cambio</th></tr></thead>
        <tbody>${filasT}</tbody></table></div>`}
    </section>`;
  }
  const valorHTMLPropio = v => (v == null ? '<span class="des-nd">—</span>' : `<span class="seg-val"><b>${escHtml(fmt(v))}</b></span>`);

  function pintarPropio() {
    limpiarGraficos();
    const cuerpo = document.getElementById('des-cuerpo');
    if (!cuerpo) return;
    const fs = misFilas();
    if (!fs.length) { cuerpo.innerHTML = vacio('Todavía no participas en ningún período con esta rúbrica.'); return; }
    const sinPublicar = fs.filter(r => r.estado_eval !== 'publicado' && r.estado_eval !== 'sin_evaluar').length;
    cuerpo.innerHTML = `${seccionKpisPropio(fs)}
      ${sinPublicar ? `<p class="des-nota">${sinPublicar} período${sinPublicar === 1 ? '' : 's'} con evaluación aún sin publicar: no ${sinPublicar === 1 ? 'entra' : 'entran'} en estas cifras.</p>` : ''}
      ${seccionEvolucionPropia(fs)}
      ${seccionCompararPropia(fs)}
      <p class="des-nota">Aquí ves solo tu propia trayectoria. Los resultados de otras personas no se muestran.</p>
      <details class="seg-como"><summary>¿Cómo se calcula?</summary><ul class="rol-lista">
        <li><b>Fuente</b>: los mismos resultados publicados de tu perfil; esta pantalla no recalcula nada.</li>
        <li><b>Promedio</b>: media simple de tus períodos publicados con esta rúbrica.</li>
        <li><b>Tendencia</b>: tu último resultado frente al promedio de los anteriores; «estable» dentro de ±3 % de la escala.</li>
        <li><b>Cambio</b>: respecto al período publicado anterior; un período sin publicar no se interpola.</li>
        <li><b>Rúbricas</b>: la de roles (0–100) y la clásica están en escalas distintas; nunca se comparan entre sí.</li>
      </ul></details>`;
    pintarEvolucionPropia(fs);
    if (typeof renderIconos === 'function') renderIconos(cuerpo);
    if (typeof animarEntrada === 'function') animarEntrada(cuerpo);
  }
  function controlesPropio() {
    const host = document.getElementById('des-ctrl');
    if (!host) return;
    const modelos = [...new Set(S.rows.filter(r => r.persona_id === S.yo && r.participa).map(r => r.modelo))];
    const opt = (v, t, sel) => `<option value="${escHtml(v)}"${sel ? ' selected' : ''}>${escHtml(t)}</option>`;
    host.innerHTML = modelos.length > 1
      ? `<label class="eq-f"><span>Rúbrica</span><select class="cfg-inp cfg-select" id="des-modelo" data-change="desFiltro">${opt('v2', 'Por roles (períodos nuevos)', S.modelo === 'v2')}${opt('legacy', 'Clásica (períodos antiguos)', S.modelo !== 'v2')}</select></label><p class="des-nota des-ayuda">Cada estructura de evaluación se compara solo con los períodos que usan la misma estructura.</p>` : '';
    host.hidden = !modelos.length || modelos.length < 2;
  }

  async function montarPropio(host, { yo } = {}) {
    if (!host) return;
    renderCargando(host);
    const res = await API.getSeguimientoGlobal();
    if (!res.ok) {
      if (res.noDisponible) host.innerHTML = vacio('Tu desempeño necesita una actualización de la base de datos que aún no está aplicada.');
      else renderError(host, res.error, () => montarPropio(host, { yo }));
      return;
    }
    const mios = res.rows.filter(r => r.persona_id === yo && r.participa);
    if (!mios.length) { host.innerHTML = vacio('Todavía no participas en ningún período. Cuando entres a uno, aquí verás tu trayectoria.'); return; }
    const previo = S && S.host === host && S.modo === 'propio' ? S : null;
    const modelo = previo?.modelo && mios.some(r => r.modelo === previo.modelo) ? previo.modelo : (mios.some(r => r.modelo === 'v2') ? 'v2' : 'legacy');
    S = { host, modo: 'propio', rows: mios, yo, modelo, pun: new Map(), metrica: modelo === 'v2' ? 'individual' : 'total_clasico', rol: '', distrito: '', q: '', personas: new Set(), per: new Set(), periodos: [], cmpA: previo?.cmpA || null, cmpB: previo?.cmpB || null };
    if (mios.some(r => r.modelo !== 'v2') && typeof API.getMiHistorial === 'function') {   // mis puntajes publicados por criterio (clásica)
      const h = await Promise.resolve(API.getMiHistorial()).catch(() => null);
      if (h && h.ok) for (const [pid, v] of Object.entries(h.porPeriodo || {})) S.pun.set(pid + '|' + yo, v.puntajes || {});
    }
    host.innerHTML = `<div class="filtros-fila des-ctrl" id="des-ctrl"></div><div id="des-cuerpo"></div>`;
    controlesPropio();
    pintarPropio();
  }

  /* ══════════════════════════════════════════════════════════════════════
     EVENTOS (data-change / data-input / data-act, sin handlers en el marcado)
     ══════════════════════════════════════════════════════════════════════ */
  function cambio(el) {
    if (!S || !el) return;
    const id = el.id || '';
    if (id === 'des-q-pers') {                                  // filtra la lista sin repintar nada
      const q = el.value.toLowerCase().trim();
      document.querySelectorAll('#des-lista li').forEach(li => { li.hidden = !!q && !li.dataset.nombre.includes(q); });
      return;
    }
    if (id === 'des-modelo') {
      S.modelo = el.value === 'legacy' ? 'legacy' : 'v2'; S.metrica = S.modelo === 'v2' ? 'individual' : 'total_clasico'; S.personas = new Set(); S.cmpA = S.cmpB = null;
      if (S.modo === 'admin') { prepararPeriodos(null); controlesAdmin(); pintarAdmin(); } else pintarPropio();
      return;
    }
    if (id === 'des-metrica') { S.metrica = metricasDe().some(m => m.k === el.value) ? el.value : metricasDe()[0].k; return pintarAdmin(); }
    if (id === 'des-rol') { S.rol = el.value; return pintarAdmin(); }
    if (id === 'des-distrito') { S.distrito = el.value; return pintarAdmin(); }
    if (id === 'des-q') { S.q = el.value; return pintarAdmin(); }
    if (id === 'des-cmpA') { S.cmpA = el.value; return S.modo === 'admin' ? pintarAdmin() : pintarPropio(); }
    if (id === 'des-cmpB') { S.cmpB = el.value; return S.modo === 'admin' ? pintarAdmin() : pintarPropio(); }
    if (el.classList.contains('des-per')) {
      if (el.checked) S.per.add(el.value); else S.per.delete(el.value);
      return pintarAdmin();
    }
    if (el.classList.contains('des-pers')) {
      if (el.checked && S.personas.size >= MAX_PERSONAS) {
        el.checked = false;
        if (typeof showToast === 'function') showToast(`Puedes comparar hasta ${MAX_PERSONAS} personas a la vez.`, 'info');
        return;
      }
      if (el.checked) S.personas.add(el.value); else S.personas.delete(el.value);
      return repintarPersonas();
    }
  }
  function accion(a, arg2) {
    if (!S) return;
    if (a === 'ver') { S.sel = arg2; return repintarDetalle(); }
    if (a === 'quitar') S.personas.delete(arg2);
    else if (a === 'limpiar') S.personas.clear();
    else return;
    document.querySelectorAll('#des-lista .des-pers').forEach(c => { c.checked = S.personas.has(c.value); });
    repintarPersonas();
  }

  return { montarAdmin, montarPropio, cambio, accion };
})();

/** data-input / data-change de Desempeño (lista blanca en config.js). Recibe (elemento, evento). */
function desFiltro(el) { Desempeno.cambio(el); }
