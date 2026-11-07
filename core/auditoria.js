'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
 * EIGHT CREATORS LABs — Auditoría (solo administración)
 *
 * Registro global de acciones sensibles: quién cambió qué, cuándo, por qué y los valores anterior y nuevo. Es SOLO
 * LECTURA: todo sale de `auditoria_listar()` (migración 0055), que une los historiales que ya existían (tareas,
 * equipos, notas, reglas del PE, evaluaciones 0053, estadísticas 0054) con el registro nuevo (personas, períodos,
 * gestiones, evaluaciones de distrito). La base decide quién puede leerlo; aquí no se calcula nada.
 *
 *   Auditoria.montar(host)    pinta filtros (origen, búsqueda, fechas), la lista paginada y el detalle de cada fila.
 *
 * Todo texto que viene de la base pasa por escHtml. El detalle (antes/después) se muestra como pares clave → valor
 * en texto, nunca como HTML. Acciones: ACCIONES.aud y el data-change/data-input `audFiltro` (lista blanca).
 * Depende de: config.js (escHtml, renderIconos), core/render.js (estados), core/ui.js (acordeonHTML).
 * ═══════════════════════════════════════════════════════════════════════════ */
const Auditoria = (() => {
  const POR_PAGINA = 50;
  const ORIGENES = ['Personas', 'Períodos', 'Gestiones', 'Distritos', 'Evaluaciones', 'Notas de tareas', 'Reglas del PE',
    'Tareas', 'Tareas de equipo', 'Equipos', 'Estadísticas de Instagram'];
  /** Las acciones de la base, en palabras. Lo que no esté aquí se muestra tal cual (nunca se oculta). */
  const ACCIONES_TXT = {
    persona_cambio: 'Cambió una persona', persona_borrada: 'Se eliminó una persona',
    periodo_creado: 'Período creado', periodo_borrado: 'Período eliminado', periodo_activado: 'Período activado', periodo_desactivado: 'Período desactivado',
    gestion_creada: 'Gestión creada', gestion_abierta: 'Gestión abierta', gestion_archivada: 'Gestión archivada', gestion_cambio: 'Cambió una gestión',
    distrito_borrador: 'Evaluación de distrito (borrador)', distrito_publicado: 'Evaluación de distrito publicada', distrito_estado: 'Cambió el estado',
    distrito_corregido: 'Evaluación de distrito corregida', distrito_borrado: 'Evaluación de distrito eliminada',
    evaluacion_publicada: 'Evaluación publicada', evaluacion_rectificada: 'Evaluación rectificada', evaluacion_retirada: 'Evaluación retirada a borrador',
    reglas_cambiadas: 'Reglas cambiadas', estadisticas_corregida: 'Cifras corregidas', estadisticas_borrada: 'Entrega eliminada',
    creada: 'Creada', estado: 'Cambió de estado', prorroga: 'Prórroga', calificada: 'Calificada', corregida: 'Nota corregida', anulada: 'Anulada',
    restaurada: 'Restaurada', reabierta: 'Reabierta',
  };
  const accionTxt = a => ACCIONES_TXT[a] || String(a || '').replace(/_/g, ' ');
  let S = null;

  const fechaHora = iso => {
    const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace('.', '');
  };
  const vacio = txt => `<div class="empty-box"><div class="empty-txt">${escHtml(txt)}</div></div>`;

  /** Valor de un detalle en una línea de texto (objeto → «clave: valor · …»). Siempre texto; escHtml lo escapa luego. */
  function plano(v) {
    if (v == null) return '—';
    if (typeof v === 'object') {
      return Object.entries(v).filter(([, x]) => x != null && x !== '' && !(typeof x === 'object' && !Object.keys(x).length))
        .map(([k, x]) => `${k}: ${typeof x === 'object' ? plano(x) : x}`).join(' · ') || '—';
    }
    return String(v);
  }
  function detalleHTML(d) {
    if (!d || typeof d !== 'object') return '';
    const filas = [];
    for (const [k, v] of Object.entries(d)) {
      if (v == null || (typeof v === 'object' && !Object.keys(v).length)) continue;
      filas.push(`<li><b>${escHtml(k.replace(/_/g, ' '))}:</b> ${escHtml(plano(v))}</li>`);
    }
    return filas.length ? `<ul class="aud-detalle">${filas.join('')}</ul>` : '';
  }

  function filtrosHTML() {
    const f = S.f;
    return `<div class="filtros-fila aud-filtros" id="aud-ctrl">
      <label class="eq-f"><span>Origen</span><select class="cfg-inp cfg-select" id="aud-origen" data-change="audFiltro">
        <option value="">Todos</option>${ORIGENES.map(o => `<option value="${escHtml(o)}"${o === f.origen ? ' selected' : ''}>${escHtml(o)}</option>`).join('')}</select></label>
      <label class="eq-f"><span>Desde</span><input class="cfg-inp" id="aud-desde" type="date" data-change="audFiltro" value="${escHtml(f.desde)}"></label>
      <label class="eq-f"><span>Hasta</span><input class="cfg-inp" id="aud-hasta" type="date" data-change="audFiltro" value="${escHtml(f.hasta)}"></label>
      <label class="eq-f eq-f--busca"><span>Buscar</span><input class="search-inp" id="aud-q" type="search" placeholder="Persona, acción, motivo…" data-input="audFiltro" value="${escHtml(f.q)}"></label>
      <button type="button" class="btn--secundario" id="aud-csv" data-act="aud" data-arg="csv"><i data-lucide="download" aria-hidden="true"></i>Descargar CSV</button>
    </div>`;
  }

  function listaHTML(r) {
    if (!r.rows.length) return vacio(S.f.origen || S.f.q || S.f.desde || S.f.hasta
      ? 'No hay registros con esos filtros.' : 'Todavía no hay acciones registradas. Aparecerán aquí a medida que se hagan cambios.');
    const filas = r.rows.map(x => `<tr>
      <td class="aud-cuando" data-label="Cuándo"><time datetime="${escHtml(x.creado_en)}">${escHtml(fechaHora(x.creado_en))}</time></td>
      <td data-label="Origen"><span class="etiqueta etq-gris">${escHtml(x.origen)}</span></td>
      <td data-label="Qué pasó"><b>${escHtml(accionTxt(x.accion))}</b><small>${escHtml(x.objeto || '')}</small>${x.resumen ? `<small>${escHtml(x.resumen)}</small>` : ''}</td>
      <td data-label="Quién">${escHtml(x.actor_nombre || (x.actor_id ? 'Administración' : 'Sin sesión (mantenimiento)'))}</td>
      <td data-label="Motivo">${x.motivo ? escHtml(x.motivo) : '<span class="aud-mut">—</span>'}${detalleHTML(x.detalle) ? `<details class="aud-det"><summary>Ver valores</summary>${detalleHTML(x.detalle)}</details>` : ''}</td>
    </tr>`).join('');
    const total = Number(r.total), pag = S.pagina, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    return `<div class="seg-tabla-wrap"><table class="seg-tabla aud-tabla">
      <caption class="sr-only">Registro de acciones</caption>
      <thead><tr><th scope="col">Cuándo</th><th scope="col">Origen</th><th scope="col">Qué pasó</th><th scope="col">Quién</th><th scope="col">Motivo y valores</th></tr></thead>
      <tbody>${filas}</tbody></table></div>
      <nav class="aud-pag" aria-label="Páginas del registro">
        <button type="button" class="btn--secundario" data-act="aud" data-arg="ant"${pag <= 1 ? ' disabled' : ''}>Anterior</button>
        <span>Página ${pag} de ${paginas} · ${total} registro${total === 1 ? '' : 's'}</span>
        <button type="button" class="btn--secundario" data-act="aud" data-arg="sig"${pag >= paginas ? ' disabled' : ''}>Siguiente</button>
      </nav>`;
  }

  async function cargar() {
    const cuerpo = document.getElementById('aud-cuerpo'); if (!cuerpo) return;
    const n = ++S.n;
    renderCargando(cuerpo);
    const f = S.f;
    const r = await API.getAuditoria({
      desde: f.desde ? f.desde + 'T00:00:00' : null,
      hasta: f.hasta ? new Date(Date.parse(f.hasta + 'T00:00:00') + 86400000).toISOString().slice(0, 10) + 'T00:00:00' : null,   // «hasta» incluye ese día
      origen: f.origen || null, buscar: f.q || null, limite: POR_PAGINA, offset: (S.pagina - 1) * POR_PAGINA,
    });
    if (!S || n !== S.n) return;   // llegó tarde: ya hay otra consulta
    if (!r.ok) {
      if (r.noDisponible) cuerpo.innerHTML = vacio('La auditoría necesita la migración 0055 en la base de datos. Aplícala en Supabase y recarga.');
      else renderError(cuerpo, r.error, cargar);
      return;
    }
    cuerpo.innerHTML = listaHTML(r);
    renderIconos(cuerpo);
  }

  function montar(host) {
    if (!host) return;
    S = { host, f: S?.host === host ? S.f : { origen: '', q: '', desde: '', hasta: '' }, pagina: 1, n: S?.n || 0 };
    host.innerHTML = `${filtrosHTML()}<div id="aud-cuerpo" aria-live="polite"></div>`;
    cargar();
  }

  let _t = null;
  /** Filtros: los selectores y fechas aplican al instante; el buscador espera a que se deje de escribir. */
  function filtro(el) {
    if (!S) return;
    const id = el?.id;
    if (id === 'aud-origen') S.f.origen = el.value;
    else if (id === 'aud-desde') S.f.desde = el.value;
    else if (id === 'aud-hasta') S.f.hasta = el.value;
    else if (id === 'aud-q') S.f.q = el.value.trim();
    S.pagina = 1;
    clearTimeout(_t);
    _t = setTimeout(cargar, id === 'aud-q' ? 300 : 0);
  }
  function accion(a) {
    if (!S) return;
    if (a === 'csv') { csv(); return; }
    if (a === 'sig') S.pagina++; else if (a === 'ant') S.pagina = Math.max(1, S.pagina - 1);
    cargar();
  }

  /* ── CSV: las mismas filas que la pantalla (con los filtros activos), de 200 en 200, hasta TOPE ── */
  const TOPE = 5000;
  const csvEsc = v => {
    let t = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+([.,]\d+)?$/.test(t)) t = "'" + t;   // una celda de texto no puede ejecutarse como fórmula
    return /[",;\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  function csvTexto(rows, meta = {}) {
    const cab = ['Fecha', 'Origen', 'Acción', 'Código de acción', 'Quién', 'Objeto', 'Resumen', 'Motivo', 'Valores'];
    const fila = x => [fechaHora(x.creado_en), x.origen, accionTxt(x.accion), x.accion, x.actor_nombre || (x.actor_id ? 'Administración' : 'Sin sesión (mantenimiento)'),
      x.objeto, x.resumen, x.motivo, x.detalle ? plano(x.detalle) : ''];
    const pie = [['Filtros', meta.filtros || 'ninguno'], ['Generado', meta.generado || ''], ['Registros', String(rows.length) + (meta.truncado ? ' (se cortó en ' + TOPE + '; afina los filtros)' : '')]];
    return '﻿' + [cab, ...rows.map(fila), [], ...pie].map(r => r.map(csvEsc).join(';')).join('\n');
  }
  const filtrosTexto = () => [S.f.origen && 'origen: ' + S.f.origen, S.f.desde && 'desde ' + S.f.desde, S.f.hasta && 'hasta ' + S.f.hasta, S.f.q && 'búsqueda: ' + S.f.q].filter(Boolean).join(' · ');
  async function csv() {
    const btn = document.getElementById('aud-csv'); if (btn) btn.disabled = true;
    const f = S.f; const filas = []; let truncado = false;
    try {
      for (let off = 0; ; off += 200) {
        const r = await API.getAuditoria({
          desde: f.desde ? f.desde + 'T00:00:00' : null,
          hasta: f.hasta ? new Date(Date.parse(f.hasta + 'T00:00:00') + 86400000).toISOString().slice(0, 10) + 'T00:00:00' : null,
          origen: f.origen || null, buscar: f.q || null, limite: 200, offset: off });
        if (!r.ok) { showToast('No se pudo exportar: ' + (r.error || 'error'), 'error'); return; }
        filas.push(...r.rows);
        if (r.rows.length < 200 || off + 200 >= Number(r.total)) break;
        if (filas.length >= TOPE) { truncado = true; break; }
      }
      ReporteEquipo.descargar('auditoria.csv', csvTexto(filas, { filtros: filtrosTexto(), generado: fechaHora(new Date().toISOString()), truncado }));
      showToast(`Exportados ${filas.length} registros`, 'ok');
    } finally { if (btn) btn.disabled = false; }
  }

  return { montar, filtro, accion, csvTexto, ACCIONES_TXT, ORIGENES };
})();

/* Global de la lista blanca de config.js (data-change / data-input). */
function audFiltro(el) { Auditoria.filtro(el); }
