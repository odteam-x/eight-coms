'use strict';
/**
 * EIGHT CREATORS LABs — Reporte entre períodos y por actividad
 * ─────────────────────────────────────────────────────────────
 * Dos cortes que el reporte de un solo período no da:
 *   · ENTRE PERÍODOS  — cada período de la gestión: cuántas evaluaciones se publicaron, el promedio y los hechos
 *                       de las tareas; y, por rol, cómo se movió el promedio de un período a otro.
 *   · POR ACTIVIDAD   — las tareas vinculadas a cada actividad: cuántas se asignaron, entregaron, aprobaron…
 *
 * Lo usan la administración (como secciones del constructor de Reportes) y la secretaría (su pestaña «Reportes»,
 * que solo recibe a las personas de su distrito: lo decide la base en seguimiento_global() y reporte_actividades(),
 * migración 0025). Aquí no se calcula ningún resultado oficial: se SUMAN y se DIVIDEN hechos ya contados por la base.
 *
 * DEFINICIONES (cada cifra de pantalla dice su numerador y su denominador):
 *   · Evaluaciones publicadas = personas con evaluación publicada ÷ personas que participan en ese período.
 *   · Promedio                = media de los resultados publicados. La rúbrica por roles (0–100) y la clásica (otra
 *                               escala) van en columnas distintas y NUNCA se promedian entre sí.
 *   · Entregas a tiempo       = tareas asignadas entregadas dentro del plazo ÷ tareas asignadas entregadas con plazo
 *                               (primera entrega).
 *   · Entregadas              = tareas asignadas entregadas ÷ tareas asignadas.
 *   · Aprobadas               = tareas aprobadas ÷ tareas asignadas entregadas.   (una propia aprobada no suma a asignadas)
 *   · Vencidas                = tareas asignadas nunca entregadas con el plazo pasado (lo bloqueado no cuenta).
 * Un denominador en 0 se muestra «—», nunca 0 %.
 *
 * Todo texto humano pasa por escHtml. Depende de: config.js, core/render.js, core/rubrica.js, core/ui.js, api.js.
 */
const ReporteEquipo = (() => {
  const f1 = n => n == null ? '—' : (Math.round(n * 10) / 10).toString().replace('.', ',');
  const prom = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const frac = (n, d) => d ? `${n} de ${d}` : '—';
  const pct = (n, d) => d ? Math.round(n / d * 100) + ' %' : '—';
  const suma = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const maxClasico = () => (typeof hayCriterios === 'function' && hayCriterios() ? MAX_TOTAL() : null);
  const fechaCorta = f => (typeof fechaCortaISO === 'function' ? fechaCortaISO(String(f).slice(0, 10)) : String(f).slice(0, 10));

  /* ── Entre períodos ─────────────────────────────────────────────────── */
  function porPeriodo(rows) {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.periodo_id)) m.set(r.periodo_id, { id: r.periodo_id, nombre: r.periodo_nombre, orden: r.periodo_orden, modelo: r.modelo, activo: r.periodo_activo, filas: [] });
      m.get(r.periodo_id).filas.push(r);
    }
    return [...m.values()].sort((a, b) => a.orden - b.orden).map(p => {
      const part = p.filas.filter(r => r.participa);
      const pub = part.filter(r => r.estado_eval === 'publicado');
      const valores = pub.map(r => p.modelo === 'v2' ? r.individual : r.total_clasico).filter(v => v != null).map(Number);
      return { ...p, participan: part.length, publicadas: pub.length, promedio: prom(valores), n: valores.length,
        con_plazo: suma(p.filas, 'con_plazo'), a_tiempo: suma(p.filas, 'a_tiempo'), vencidas: suma(p.filas, 'tareas_vencidas'), tareas: suma(p.filas, 'tareas_total') };
    });
  }

  function periodosHTML(rows) {
    const ps = porPeriodo(rows);
    if (!ps.length) return '<p class="cfg-hint">No hay períodos con datos para mostrar.</p>';
    const clasico = maxClasico();
    const tabla = `<div class="seg-tabla-wrap"><table class="seg-tabla req-tabla">
      <caption class="sr-only">Resumen por período</caption>
      <thead><tr><th scope="col">Período</th><th scope="col">Evaluaciones publicadas</th><th scope="col">Promedio</th><th scope="col">Entregas a tiempo</th><th scope="col">Tareas vencidas</th></tr></thead>
      <tbody>${ps.map(p => `<tr>
        <th scope="row">${escHtml(p.nombre)}${p.activo ? ' <span class="etiqueta etq-azul">Activo</span>' : ''}<small>${p.modelo === 'v2' ? 'Rúbrica por roles' : 'Rúbrica clásica'}</small></th>
        <td data-label="Publicadas"><b>${escHtml(pct(p.publicadas, p.participan))}</b><small>${escHtml(frac(p.publicadas, p.participan))} personas</small></td>
        <td data-label="Promedio">${p.promedio == null ? '—' : `<b>${escHtml(f1(p.promedio))}</b><small>${p.modelo === 'v2' ? 'sobre 100' : (clasico ? 'sobre ' + clasico : 'escala clásica')} · ${p.n} resultado${p.n === 1 ? '' : 's'}</small>`}</td>
        <td data-label="A tiempo"><b>${escHtml(pct(p.a_tiempo, p.con_plazo))}</b><small>${escHtml(frac(p.a_tiempo, p.con_plazo))} entregas con plazo</small></td>
        <td data-label="Vencidas"><b>${p.vencidas}</b><small>de ${p.tareas} tarea${p.tareas === 1 ? '' : 's'}</small></td></tr>`).join('')}</tbody></table></div>`;

    // Por rol y período (solo rúbrica por roles: la clásica es otra escala y no se mezcla).
    const v2 = ps.filter(p => p.modelo === 'v2');
    let roles = '';
    if (v2.length) {
      const nombres = [...new Set(rows.filter(r => r.modelo === 'v2' && r.estado_eval === 'publicado').map(r => r.rol_nombre || 'Sin rol'))].sort((a, b) => a.localeCompare(b, 'es'));
      if (nombres.length) {
        roles = `<h4 class="req-sub">Promedio por rol <small>rúbrica por roles, sobre 100</small></h4><div class="seg-tabla-wrap"><table class="seg-tabla req-tabla">
          <caption class="sr-only">Promedio individual por rol y período</caption>
          <thead><tr><th scope="col">Rol</th>${v2.map(p => `<th scope="col">${escHtml(p.nombre)}</th>`).join('')}</tr></thead>
          <tbody>${nombres.map(n => `<tr><th scope="row">${escHtml(n)}</th>${v2.map(p => {
            const vs = rows.filter(r => r.periodo_id === p.id && (r.rol_nombre || 'Sin rol') === n && r.estado_eval === 'publicado' && r.individual != null).map(r => Number(r.individual));
            return `<td data-label="${escHtml(p.nombre)}">${vs.length ? `<b>${escHtml(f1(prom(vs)))}</b><small>${vs.length} persona${vs.length === 1 ? '' : 's'}</small>` : '—'}</td>`;
          }).join('')}</tr>`).join('')}</tbody></table></div>`;
      }
    }
    return tabla + roles;
  }

  /* ── Por actividad ──────────────────────────────────────────────────── */
  function porActividad(rows) {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.actividad_id)) m.set(r.actividad_id, { id: r.actividad_id, titulo: r.titulo, inicio: r.fecha_inicio, fin: r.fecha_fin, alcance: r.alcance, etiqueta: r.etiqueta, filas: [] });
      if (r.persona_id) m.get(r.actividad_id).filas.push(r);
    }
    return [...m.values()].sort((a, b) => String(b.inicio).localeCompare(String(a.inicio))).map(a => ({
      ...a, personas: new Set(a.filas.map(r => r.persona_id)).size, asignadas: suma(a.filas, 'asignadas'), entregadas: suma(a.filas, 'entregadas'),
      con_plazo: suma(a.filas, 'con_plazo'), a_tiempo: suma(a.filas, 'a_tiempo'), aprobadas: suma(a.filas, 'aprobadas'), vencidas: suma(a.filas, 'vencidas'),
      puntos_suma: suma(a.filas, 'puntos_suma'), puntos_n: suma(a.filas, 'puntos_n'),
    }));
  }

  function actividadesHTML(rows) {
    const as = porActividad(rows);
    if (!as.length) return '<p class="cfg-hint">No hay actividades con tareas vinculadas para mostrar.</p>';
    const alc = a => a.alcance === 'seleccion' ? 'Personas elegidas' : a.alcance === 'distrito' ? 'Un distrito' : 'Todo el equipo';
    return `<div class="seg-tabla-wrap"><table class="seg-tabla req-tabla">
      <caption class="sr-only">Tareas por actividad</caption>
      <thead><tr><th scope="col">Actividad</th><th scope="col">Personas</th><th scope="col">Entregadas</th><th scope="col">A tiempo</th><th scope="col">Aprobadas</th><th scope="col">Vencidas</th><th scope="col">Puntos</th></tr></thead>
      <tbody>${as.map(a => `<tr>
        <th scope="row">${escHtml(a.titulo)}<small>${escHtml(fechaCorta(a.inicio))}${a.etiqueta ? ' · ' + escHtml(a.etiqueta) : ''} · ${escHtml(alc(a))}</small></th>
        <td data-label="Personas">${a.personas || '—'}</td>
        ${a.asignadas || a.filas.length ? `
        <td data-label="Entregadas"><b>${escHtml(pct(a.entregadas, a.asignadas))}</b><small>${escHtml(frac(a.entregadas, a.asignadas))} asignadas</small></td>
        <td data-label="A tiempo"><b>${escHtml(pct(a.a_tiempo, a.con_plazo))}</b><small>${escHtml(frac(a.a_tiempo, a.con_plazo))} con plazo</small></td>
        <td data-label="Aprobadas"><b>${escHtml(pct(a.aprobadas, a.entregadas))}</b><small>${escHtml(frac(a.aprobadas, a.entregadas))} entregadas</small></td>
        <td data-label="Vencidas"><b>${a.vencidas}</b></td>
        <td data-label="Puntos">${a.puntos_n ? `<b>${escHtml(f1(a.puntos_suma / a.puntos_n))}</b><small>promedio de ${a.puntos_n} aprobada${a.puntos_n === 1 ? '' : 's'}</small>` : '—'}</td>`
        : '<td colspan="5" data-label="Tareas"><small>Sin tareas vinculadas todavía.</small></td>'}</tr>`).join('')}</tbody></table></div>`;
  }

  /** Las definiciones, en palabras, para el pie de la hoja. */
  const DEFINICIONES = `<ul class="rol-lista">
    <li><b>Evaluaciones publicadas</b>: personas con la evaluación publicada ÷ personas que participan en ese período.</li>
    <li><b>Promedio</b>: media de los resultados publicados. La rúbrica por roles (sobre 100) y la clásica no se promedian entre sí.</li>
    <li><b>Entregadas</b>: tareas asignadas entregadas ÷ tareas asignadas. <b>A tiempo</b>: entregadas dentro del plazo ÷ entregadas con plazo (primera entrega). <b>Aprobadas</b>: aprobadas ÷ entregadas.</li>
    <li><b>Vencidas</b>: tareas asignadas nunca entregadas con el plazo ya pasado; lo bloqueado no cuenta. Una cifra sin denominador se muestra «—».</li></ul>`;

  /* ── CSV (numerador y denominador en columnas separadas) ────────────── */
  const csvEsc = v => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csvTexto = (cab, filas) => '﻿' + [cab, ...filas].map(r => r.map(csvEsc).join(';')).join('\n');
  function csvPeriodos(rows) {
    return csvTexto(['Período', 'Rúbrica', 'Personas que participan', 'Evaluaciones publicadas', 'Promedio', 'Resultados en el promedio', 'Entregas con plazo', 'Entregas a tiempo', 'Tareas', 'Tareas vencidas'],
      porPeriodo(rows).map(p => [p.nombre, p.modelo === 'v2' ? 'Por roles' : 'Clásica', p.participan, p.publicadas, f1(p.promedio), p.n, p.con_plazo, p.a_tiempo, p.tareas, p.vencidas]));
  }
  function csvActividades(rows) {
    return csvTexto(['Actividad', 'Fecha', 'Tipo', 'Alcance', 'Personas', 'Tareas asignadas', 'Entregadas', 'Entregas con plazo', 'A tiempo', 'Aprobadas', 'Vencidas', 'Puntos (suma)', 'Tareas puntuadas'],
      porActividad(rows).map(a => [a.titulo, String(a.inicio).slice(0, 10), a.etiqueta || '', a.alcance, a.personas, a.asignadas, a.entregadas, a.con_plazo, a.a_tiempo, a.aprobadas, a.vencidas, a.puntos_suma, a.puntos_n]));
  }
  function descargar(nombre, texto) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
    a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /** PDF por impresión, con el tema claro; se restaura el del usuario al terminar. */
  function imprimir() {
    const r = document.documentElement, previo = r.getAttribute('data-theme');
    r.setAttribute('data-theme', 'light'); document.body.classList.add('imprimiendo-reporte');
    const fin = () => { document.body.classList.remove('imprimiendo-reporte'); previo ? r.setAttribute('data-theme', previo) : r.removeAttribute('data-theme'); window.removeEventListener('afterprint', fin); };
    window.addEventListener('afterprint', fin);
    setTimeout(() => window.print(), 80);
  }

  /* ── Pestaña «Reportes» de la secretaría ────────────────────────────── */
  let S = null;
  async function montar(host) {
    if (!host) return;
    renderCargando(host);
    const [seg, act] = await Promise.all([API.getSeguimientoGlobal(), API.getReporteActividades()]);
    if (!seg.ok) {
      if (seg.noDisponible) host.innerHTML = '<div class="empty-box"><div class="empty-txt">Los reportes entre períodos necesitan la migración 0025 en la base de datos.</div></div>';
      else renderError(host, seg.error, () => montar(host));
      return;
    }
    S = { seg: seg.rows, act: act.ok ? act.rows : null, actError: act.ok ? null : (act.noDisponible ? 'Los reportes por actividad necesitan las migraciones 0021, 0024 y 0025.' : act.error) };
    const m = Seguimiento.metricas(S.seg, [...new Map(S.seg.map(r => [r.periodo_id, { id: r.periodo_id, activo: r.periodo_activo }])).values()]);
    host.innerHTML = `
      <article class="rpt-hoja req-hoja" aria-label="Vista previa del reporte">
        <header class="rpt-hoja-cab">
          <picture><source srcset="logo.webp 1x, logo@2x.webp 2x" type="image/webp"><img src="logo.png" alt="" class="rpt-logo" width="64" height="64"></picture>
          <div class="rpt-hoja-t"><span>EIGHT CREATORS LABs · CELIDER 08 Santiago</span><h2>Reporte del distrito</h2><p>Todos los períodos de la gestión y las actividades con tareas</p></div>
          <div class="rpt-hoja-f"><span>Generado el</span><b>${escHtml(new Date().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }))}</b></div>
        </header>
        <section class="req-sec"><h3 class="rpt-sec-t">Entre períodos</h3>
          <p class="rpt-sec-d">${escHtml(`${m.pub} de ${m.total} evaluaciones publicadas en los períodos en juego · ${m.aTiempo} de ${m.conPlazo} entregas a tiempo · ${m.venc} tarea${m.venc === 1 ? '' : 's'} vencida${m.venc === 1 ? '' : 's'}.`)}</p>
          ${periodosHTML(S.seg)}</section>
        <section class="req-sec"><h3 class="rpt-sec-t">Por actividad</h3>
          ${S.act ? actividadesHTML(S.act) : `<p class="cfg-hint">${escHtml(S.actError || '')}</p>`}</section>
        <section class="req-sec req-def"><h3 class="rpt-sec-t">Cómo se calcula</h3>${DEFINICIONES}</section>
      </article>`;
    if (typeof renderIconos === 'function') renderIconos(host);
  }
  function csv(que) {
    if (!S) return;
    if (que === 'actividades') { if (!S.act?.length) return showToast('No hay actividades que exportar.', 'error'); descargar('reporte-actividades.csv', csvActividades(S.act)); }
    else { if (!S.seg.length) return showToast('No hay datos que exportar.', 'error'); descargar('reporte-periodos.csv', csvPeriodos(S.seg)); }
  }

  return { montar, csv, imprimir, periodosHTML, actividadesHTML, csvPeriodos, csvActividades, descargar, porPeriodo, porActividad, DEFINICIONES };
})();
