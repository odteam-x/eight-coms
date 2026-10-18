'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
 * EIGHT CREATORS LABs — Distritos: cálculo del ranking acumulado y centro del distrito de la secretaría
 *
 * Un distrito se evalúa por período (PE) con cuatro competencias de 0 a 7 (máx. 28 puntos). Este módulo reúne lo que
 * comparten el admin (core/distritos-admin.js) y la secretaría:
 *
 *   Distritos.consolidar({ periodos, distritos, evals, incluidos })   ranking acumulado: una columna por PE, total, promedio
 *                                                                     sobre 28 y porcentaje; promedio por período y global.
 *   Distritos.montarSecretaria(host, ctx)                             «Resumen» del distrito de la secretaría.
 *
 * REGLAS DEL CÁLCULO (probadas en tools/pruebas/front-distritos.mjs con una tabla real de 10 distritos):
 *   · Solo cuentan las evaluaciones PUBLICADAS. Un borrador no entra ni a promedios ni a posiciones.
 *   · Promedio de un distrito = total ÷ períodos en que fue evaluado (no se castiga a quien no tiene un PE). Se ordena por
 *     promedio; a igualdad, por total y luego por el período más reciente. Los empates COMPARTEN posición (1, 1, 3…).
 *   · Promedio de un período = promedio de los distritos evaluados en él. Global = promedio de TODAS las evaluaciones incluidas.
 *   · Un período sin evaluaciones publicadas no cuenta y se dice así («Sin evaluaciones publicadas»), no se muestra como 0.
 *   Nada de esto escribe en la base: es lectura de evaluaciones_distrito.
 * ═══════════════════════════════════════════════════════════════════════════ */
const Distritos = (() => {
  const MAX = 28;
  const COMP = [
    { k: 'cgo', abbr: 'CGO', label: 'Gestión y Organización' },
    { k: 'cct', abbr: 'CCT', label: 'Creativa y Técnica' },
    { k: 'com', abbr: 'COM', label: 'Comunicativa' },
    { k: 'cee', abbr: 'CEE', label: 'Ejecución Estratégica' },
  ];
  const nomPE = p => p?.pe || p?.nombre || '';
  const aObj = p => { if (p && typeof p === 'object') return p; try { return JSON.parse(p || '{}') || {}; } catch { return {}; } };
  const puntaje = p => { const o = aObj(p); return COMP.reduce((s, c) => s + (Number(o[c.k]) || 0), 0); };
  /** Mismos cortes que el resto del sitio (24 / 17 / 10 sobre 28); sirven también para un promedio con decimales. */
  const nivel = s => s >= 24 ? { c: 'sex', t: 'Excelente' } : s >= 17 ? { c: 'sbu', t: 'Bueno' } : s >= 10 ? { c: 'spr', t: 'En proceso' } : { c: 'sba', t: 'Bajo' };
  const f2 = n => new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const fPct = n => new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n * 100) + ' %';
  const fInt = n => new Intl.NumberFormat('es-CL').format(n);

  /**
   * @param {{periodos: object[], distritos: object[], evals: object[], incluidos?: Set<string>}} a
   *   `incluidos`: ids de PE que entran al ranking; si falta, todos los que tengan evaluaciones publicadas.
   * @returns {{incl: object[], filas: object[], ranking: object[], sinDatos: object[], porPeriodo: object[], global: object}}
   */
  function consolidar({ periodos, distritos, evals, incluidos = null }) {
    const pubs = (evals || []).filter(e => e.estado === 'publicado');
    const conDatos = new Set(pubs.map(e => String(e.periodo_id)));
    const incl = (periodos || []).filter(p => incluidos ? incluidos.has(String(p.id)) && conDatos.has(String(p.id)) : conDatos.has(String(p.id)));
    const idx = new Map(incl.map((p, i) => [String(p.id), i]));
    const celdas = new Map();   // distrito → array alineado con `incl`
    for (const e of pubs) {
      const i = idx.get(String(e.periodo_id)); if (i == null) continue;
      if (!celdas.has(e.distrito_id)) celdas.set(e.distrito_id, incl.map(() => null));
      celdas.get(e.distrito_id)[i] = puntaje(e.puntajes);
    }
    const filas = (distritos || []).map(d => {
      const puntos = celdas.get(d.id) || incl.map(() => null);
      const vals = puntos.filter(v => v != null);
      const n = vals.length, total = vals.reduce((s, v) => s + v, 0);
      const prom = n ? total / n : null;
      let ultimo = null; for (let i = puntos.length - 1; i >= 0; i--) if (puntos[i] != null) { ultimo = puntos[i]; break; }
      return { id: d.id, nombre: d.nombre || d.id, puntos, n, total, prom, pct: prom == null ? null : prom / MAX, ultimo, pos: null };
    });
    const con = filas.filter(f => f.n > 0).sort((a, b) => (b.prom - a.prom) || (b.total - a.total) || ((b.ultimo ?? 0) - (a.ultimo ?? 0)) || a.nombre.localeCompare(b.nombre, 'es'));
    con.forEach((f, i) => { f.pos = i > 0 && Math.abs(f.prom - con[i - 1].prom) < 1e-9 ? con[i - 1].pos : i + 1; });
    const sinDatos = filas.filter(f => f.n === 0).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    // Promedio por período, de TODOS los períodos de la gestión (uno sin datos se dice así en vez de desaparecer)
    const porPeriodo = (periodos || []).map(p => {
      const v = pubs.filter(e => String(e.periodo_id) === String(p.id)).map(e => puntaje(e.puntajes));
      const n = v.length, prom = n ? v.reduce((s, x) => s + x, 0) / n : null;
      return { periodo: p, n, prom, pct: prom == null ? null : prom / MAX, incluido: idx.has(String(p.id)) };
    });
    const todas = pubs.filter(e => idx.has(String(e.periodo_id))).map(e => puntaje(e.puntajes));
    const gProm = todas.length ? todas.reduce((s, x) => s + x, 0) / todas.length : null;
    return { incl, filas, ranking: con, sinDatos, porPeriodo, global: { n: todas.length, prom: gProm, pct: gProm == null ? null : gProm / MAX } };
  }

  /* ── Centro del distrito de la secretaría ───────────────────────────────── */
  let SC = null;

  /** `ctx`: { periodos, distrito, periodo, irA(tab) }. Lee las evaluaciones PUBLICADAS (legibles para toda persona con sesión) y la entrega de
   *  estadísticas del período elegido. Solo se muestra la posición propia: los otros distritos siguen siendo confidenciales. */
  async function montarSecretaria(host, ctx) {
    if (!host) return;
    if (!ctx?.distrito) { host.innerHTML = '<p class="pf-vacio">No tienes un distrito asignado: pide a la administración que te asigne uno.</p>'; return; }
    const n = (SC?.n || 0) + 1;
    SC = { n, host, ctx };
    renderCargando(host);
    const ids = (ctx.periodos || []).map(p => p.id);
    const [ev, est] = await Promise.all([
      API.getEvalDistritosByPeriodos(ids, { soloPublicadas: true }),
      ctx.periodo?.id ? API.getEstadisticasDistrito(ctx.periodo.id, ctx.distrito) : Promise.resolve({ ok: true, disponible: true, data: null }),
    ]);
    if (!SC || SC.n !== n) return;
    if (!ev.ok) { host.innerHTML = '<p class="pf-vacio">No se pudo cargar el resumen del distrito. Inténtalo de nuevo.</p>'; return; }
    const idsD = new Set(ev.data.map(e => e.distrito_id)); idsD.add(ctx.distrito);
    SC.raw = ev.data;
    SC.datos = consolidar({ periodos: ctx.periodos, distritos: [...idsD].map(id => ({ id, nombre: id })), evals: ev.data });
    SC.est = est;
    pintarSecretaria();
  }

  const trend = (puntos, periodos) => {
    const max = MAX;
    return `<div class="dc-trend" role="img" aria-label="Puntaje del distrito por período">${puntos.map((v, i) => `<div class="dc-trend-col">
      <div class="dc-trend-bar${v == null ? ' dc-trend-bar--vacio' : ''}"><span style="--h:${v == null ? 0 : Math.round(v / max * 100)}%"></span></div>
      <b>${v == null ? '—' : v}</b><small>${escHtml(nomPE(periodos[i]))}</small></div>`).join('')}</div>`;
  };

  function filaHistorial(p, e) {
    if (!e) return `<tr><th scope="row">${escHtml(nomPE(p))}</th><td colspan="6" class="dc-mut">Aún sin evaluación publicada</td></tr>`;
    const o = aObj(e.puntajes), tot = puntaje(o), nv = nivel(tot);
    return `<tr><th scope="row">${escHtml(nomPE(p))}</th>${COMP.map(c => `<td data-label="${escHtml(c.abbr)}">${Number(o[c.k]) || 0}</td>`).join('')}<td data-label="Total"><b>${tot}</b><span class="dc-mut"> / ${MAX}</span></td><td data-label="Nivel"><span class="nivel-badge ${nv.c}">${nv.t}</span></td></tr>`;
  }

  function pintarSecretaria() {
    const { host, ctx, datos: D, est } = SC;
    const periodos = ctx.periodos || [];
    const mio = D.filas.find(f => f.id === ctx.distrito);
    const propias = new Map(SC.raw.filter(e => e.distrito_id === ctx.distrito).map(e => [String(e.periodo_id), e]));
    const hay = mio && mio.n > 0, nv = hay ? nivel(mio.prom) : null;
    const cab = hay ? `<div class="dc-hero">
        <div class="dc-hero-pos"><span class="dc-hero-n">#${mio.pos}</span><span class="dc-mut">de ${D.ranking.length} distritos${D.ranking.filter(f => f.pos === mio.pos).length > 1 ? ' · empatado' : ''}</span></div>
        <div class="dc-hero-prom"><span class="dc-hero-n">${f2(mio.prom)}</span><span class="dc-mut">promedio sobre ${MAX} · ${fPct(mio.pct)}</span></div>
        <div class="dc-hero-nv"><span class="nivel-badge ${nv.c}">${nv.t}</span><span class="dc-mut">${mio.n} ${mio.n === 1 ? 'período evaluado' : 'períodos evaluados'}</span></div>
      </div>` : `<div class="dc-hero dc-hero--vacio"><p class="pf-vacio">Tu distrito todavía no tiene una evaluación publicada. Cuando la administración publique una, verás aquí tu posición y tu evolución.</p></div>`;

    // Qué falta: siempre sobre el período elegido arriba
    const pe = ctx.periodo, nombrePE = nomPE(pe);
    const items = [];
    if (pe && est && est.ok && est.disponible !== false) {
      items.push(est.data
        ? { ico: 'check-circle', cls: 'dc-falta--ok', t: `Estadísticas de ${nombrePE} enviadas`, d: 'Puedes corregirlas mientras el período siga abierto.', cta: 'Ver o corregir', acc: 'ir-est' }
        : { ico: 'alert-triangle', cls: 'dc-falta--pend', t: `Falta enviar las estadísticas de Instagram de ${nombrePE}`, d: 'Súbelas con una captura de pantalla como prueba. La administración las usa para evaluar al distrito.', cta: 'Enviar estadísticas', acc: 'ir-est' });
    }
    if (pe) items.push(propias.has(String(pe.id))
      ? { ico: 'check-circle', cls: 'dc-falta--ok', t: `La evaluación de ${nombrePE} ya está publicada`, d: '', cta: '', acc: '' }
      : { ico: 'clock', cls: 'dc-falta--info', t: `La evaluación de ${nombrePE} todavía no está publicada`, d: 'La publica la administración; cuando lo haga la verás aquí.', cta: '', acc: '' });
    const falta = items.length ? `<section class="dc-sec" aria-labelledby="dc-falta-t"><h3 class="pf-h" id="dc-falta-t">Qué falta</h3><div class="dc-faltas">${items.map(i => `<div class="dc-falta ${i.cls}">
      <i data-lucide="${i.ico}" aria-hidden="true"></i><div class="dc-falta-txt"><b>${escHtml(i.t)}</b>${i.d ? `<span>${escHtml(i.d)}</span>` : ''}</div>
      ${i.cta ? `<button type="button" class="btn-out" data-act="dist" data-arg="${i.acc}">${escHtml(i.cta)}</button>` : ''}</div>`).join('')}</div></section>` : '';

    const hist = `<section class="dc-sec" aria-labelledby="dc-hist-t"><h3 class="pf-h" id="dc-hist-t">Tu evolución, período por período</h3>
      ${hay ? trend(mio.puntos, D.incl) : ''}
      <div class="dc-tabla-wrap"><table class="dc-tabla dc-tabla--hist"><caption class="sr-only">Evaluaciones publicadas de tu distrito</caption>
        <thead><tr><th scope="col">Período</th>${COMP.map(c => `<th scope="col" title="${escHtml(c.label)}">${c.abbr}</th>`).join('')}<th scope="col">Total</th><th scope="col">Nivel</th></tr></thead>
        <tbody>${periodos.map(p => filaHistorial(p, propias.get(String(p.id)))).join('')}</tbody></table></div>
      <p class="dc-nota">CGO gestión y organización · CCT creativa y técnica · COM comunicativa · CEE ejecución estratégica. Cada una de 0 a 7. Los otros distritos son confidenciales: aquí solo ves el tuyo.</p></section>`;
    host.innerHTML = `<div class="dc dc--sec">${cab}${falta}${hist}</div>`;
    renderIconos(host);
  }

  function accion(a) {
    if (a === 'ir-est') return SC?.ctx?.irA?.('estadisticas');
  }

  return { MAX, COMP, consolidar, puntaje, nivel, f2, fPct, fInt, nomPE, aObj, trend, montarSecretaria, accion, _SC: () => SC };
})();
