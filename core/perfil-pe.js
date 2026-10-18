'use strict';
/**
 * EIGHT CREATORS LABs — Los PE (períodos) de una persona
 * ───────────────────────────────────────────────────────
 * Pestaña «Períodos» del perfil: una tarjeta por PE con lo que importa de la persona en ese período, en el orden
 * en que se lee. Es PRESENTACIÓN: nada se calcula ni se guarda aquí.
 *
 *   cabecera      nombre del PE, fechas, fase (Activo / Cerrado / Próximo) y la rúbrica que usa
 *   datos         participación · rol en el período · equipo (si existe)
 *   evaluación    resultado y nivel ya calculados (los entrega seguimiento_global(), migración 0025), o el estado
 *   indicadores   tareas asignadas · entregadas a tiempo · vencidas · aprobadas (mismas definiciones de 0016)
 *   actividades   las actividades del calendario a las que están vinculadas sus tareas (tareas.actividad_id, 0021)
 *   acción        «Ver detalle»: abre ese PE en Resumen
 *
 * QUIÉN VE QUÉ lo decide la base (RLS): seguimiento_global() devuelve la fila propia al miembro, las del distrito a
 * la secretaría y todas a la administración; las tareas llegan igual. Aquí no se filtra nada «por si acaso».
 *
 * DEGRADA SIN LO QUE FALTE:
 *   · sin 0025 (seguimiento_global) → la tarjeta usa lo que el perfil ya cargó (resultado y nivel del período) y
 *     omite participación e indicadores, sin inventar ceros;
 *   · período clásico → dice que no usa tareas asignables, en vez de mostrar «0 tareas»;
 *   · sin actividades vinculadas → ese bloque no se pinta.
 *
 * EQUIPO: lo construye el módulo de equipos. `PerfilPE.equipoDe(fn)` registra la función
 *   fn({ persona, periodo, fila }) → { nombre, detalle? } | null   (puede ser async)
 * y la tarjeta muestra «Equipo» solo cuando devuelve algo. Si la fila de seguimiento trae `equipo_nombre`, se usa.
 *
 * Todo texto humano (nombres de PE, rol, actividad, equipo) pasa por escHtml.
 * Depende de: config.js, core/render.js, core/rubrica.js, core/ui.js, core/seguimiento.js, api.js.
 */
const PerfilPE = (() => {
  let _equipoFn = null;
  const _actCache = { t: 0, r: null };

  const EVAL = {
    publicado:    { txt: 'Evaluación publicada', cls: 'etq-verde' },
    borrador:     { txt: 'Borrador sin publicar', cls: 'etq-ambar' },
    sin_publicar: { txt: 'Sin publicar',          cls: 'etq-ambar' },
    sin_evaluar:  { txt: 'Sin evaluar todavía',   cls: 'etq-gris' },
  };

  const _hoy = () => { const h = new Date(); return h.getFullYear() + '-' + String(h.getMonth() + 1).padStart(2, '0') + '-' + String(h.getDate()).padStart(2, '0'); };
  const _fin = p => p.jornada || p.entrega || p.finTrabajo || null;

  /** Fase del período. Sin fechas y sin marca de activo no se afirma nada. */
  function fase(p) {
    if (p.activo) return { txt: 'Activo', cls: 'etq-azul' };
    const hoy = _hoy(), fin = _fin(p);
    if (fin && fin < hoy) return { txt: 'Cerrado', cls: 'etq-gris' };
    if (p.inicio && p.inicio > hoy) return { txt: 'Próximo', cls: 'etq-cian' };
    return null;
  }

  function fechas(p) {
    const fin = _fin(p);
    if (p.inicio && fin && typeof fechaCortaISO === 'function') return `${fechaCortaISO(p.inicio)} – ${fechaCortaISO(fin)}`;
    return p.inicio && typeof fechaCortaISO === 'function' ? `Desde el ${fechaCortaISO(p.inicio)}` : 'Sin fechas definidas';
  }

  async function _actividades() {
    if (_actCache.r && Date.now() - _actCache.t < 60000) return _actCache.r;
    const r = await API.getActividades().catch(() => ({ ok: false, disponible: false, rows: [] }));
    _actCache.t = Date.now(); _actCache.r = r;
    return r;
  }

  /**
   * Reúne todo lo que las tarjetas necesitan. Cada fuente que falla se omite por separado: una tarjeta sin
   * indicadores es mejor que una pestaña en blanco.
   */
  async function cargar({ persona, serie, periodos }) {
    const seg = (typeof Seguimiento !== 'undefined' && Seguimiento.filasPersona)
      ? await Seguimiento.filasPersona(persona.id).catch(() => ({ ok: false })) : { ok: false };
    const filas = new Map(seg.ok ? seg.rows.map(r => [String(r.periodo_id), r]) : []);

    // Actividades: por las tareas de la persona en los períodos v2 (los clásicos no tienen tareas).
    const v2 = periodos.filter(p => esPeriodoV2(p));
    const [tareasPorPeriodo, acts] = await Promise.all([
      Promise.all(v2.map(p => API.getTareas({ periodoId: p.id, userId: persona.id }).then(r => [String(p.id), r.ok ? r.tareas : []]).catch(() => [String(p.id), []]))),
      _actividades(),
    ]);
    const nombreAct = new Map((acts.rows || []).map(a => [String(a.id), a.titulo]));
    const actividades = new Map(tareasPorPeriodo.map(([pid, ts]) => {
      const cuenta = new Map();
      for (const t of ts) if (t.actividad_id != null && nombreAct.has(String(t.actividad_id))) cuenta.set(String(t.actividad_id), (cuenta.get(String(t.actividad_id)) || 0) + 1);
      return [pid, [...cuenta.entries()].map(([id, n]) => ({ titulo: nombreAct.get(id), tareas: n }))];
    }));

    const equipos = new Map();
    for (const p of periodos) {
      const fila = filas.get(String(p.id)) || null;
      let eq = fila?.equipo_nombre ? { nombre: fila.equipo_nombre } : null;
      if (!eq && _equipoFn) { try { eq = await _equipoFn({ persona, periodo: p, fila }); } catch { eq = null; } }
      if (eq?.nombre) equipos.set(String(p.id), eq);
    }
    return { filas, actividades, equipos, haySeguimiento: seg.ok, serie };
  }

  const _dato = (lbl, valor, extra = '') => `<div class="pe-dato"${extra}><dt>${escHtml(lbl)}</dt><dd>${valor}</dd></div>`;

  function _evalHTML(p, item, fila) {
    const v2 = esPeriodoV2(p);
    let res = null;
    if (fila && (fila.estado_eval === 'publicado' || fila.estado_eval === 'borrador')) res = Seguimiento.resultado(fila);
    else if (!fila && item) {
      if (v2 && item.fila?.individual != null) { const n = nivelV2(item.fila.individual); res = { txt: fmtNum(item.fila.individual, 1), de: 'de 100', clase: n.key, label: n.label, color: scoreColorTxtV2(item.fila.individual) }; }
      else if (!v2 && item.row) res = { txt: fmtNum(item.total, 1), de: 'de ' + MAX_TOTAL(), clase: scoreClass(item.total), label: scoreLabel(item.total), color: scoreColorTxt(item.total) };
    }
    const estado = fila ? (EVAL[fila.estado_eval] || EVAL.sin_evaluar) : (res ? EVAL.publicado : EVAL.sin_evaluar);
    if (!res) return `<div class="pe-eval pe-eval--vacia"><span class="etiqueta ${estado.cls}">${escHtml(estado.txt)}</span></div>`;
    return `<div class="pe-eval">
      <div class="pe-puntaje"><b style="color:${res.color}">${escHtml(res.txt)}</b>${res.de ? `<small>${escHtml(res.de)}</small>` : ''}</div>
      <span class="nivel-badge ${escHtml(res.clase)}">${escHtml(res.label)}</span>
      ${fila && fila.estado_eval !== 'publicado' ? `<span class="etiqueta ${estado.cls}">${escHtml(estado.txt)}</span>` : ''}
    </div>`;
  }

  function _indicadoresHTML(p, fila) {
    if (!esPeriodoV2(p)) return `<p class="pe-aviso">Este período usa la rúbrica clásica: no tiene tareas asignables.</p>`;
    if (!fila) return '';
    if (!fila.tareas_total) return `<p class="pe-aviso">Sin tareas asignadas en este período.</p>`;
    const t = (val, lbl, aviso) => `<div class="pe-ind${aviso ? ' pe-ind--aviso' : ''}"><div class="pe-ind-v">${val}</div><div class="pe-ind-l">${escHtml(lbl)}</div></div>`;
    return `<div class="pe-inds">
      ${t(Number(fila.tareas_total), 'Tareas asignadas')}
      ${t(fila.con_plazo ? `${Number(fila.a_tiempo)}<small> de ${Number(fila.con_plazo)}</small>` : '—', 'Entregadas a tiempo')}
      ${t(Number(fila.tareas_aprobadas), 'Aprobadas')}
      ${t(Number(fila.tareas_vencidas), 'Vencidas', fila.tareas_vencidas > 0)}
    </div>`;
  }

  function _actividadesHTML(lista) {
    if (!lista?.length) return '';
    const vis = lista.slice(0, 3);
    return `<div class="pe-act">
      <h5 class="pe-sub">Actividades relacionadas</h5>
      <ul class="pe-act-lista">${vis.map(a => `<li><span>${escHtml(a.titulo)}</span><small>${a.tareas} tarea${a.tareas === 1 ? '' : 's'}</small></li>`).join('')}</ul>
      ${lista.length > vis.length ? `<p class="pe-mas">y ${lista.length - vis.length} más</p>` : ''}
    </div>`;
  }

  function tarjetaHTML({ p, item, fila, actividades, equipo, actual }) {
    const f = fase(p);
    const v2 = esPeriodoV2(p);
    const nombre = p.nombre && p.nombre !== p.pe ? p.nombre : '';
    const participa = fila ? (fila.participa ? 'Participa' : 'No participa') : '';
    const rol = fila?.rol_nombre || (item?.fila?.rol_nombre) || '';
    const datos = [
      participa ? _dato('Participación', `<span class="etiqueta ${fila.participa ? 'etq-verde' : 'etq-gris'}">${participa}</span>`) : '',
      rol && (!fila || fila.participa) ? _dato('Rol en el período', escHtml(rol)) : '',
      equipo ? _dato('Equipo', `${escHtml(equipo.nombre)}${equipo.detalle ? `<small>${escHtml(equipo.detalle)}</small>` : ''}`, ' data-slot="equipo"') : '',
    ].join('');
    const noParticipa = fila && !fila.participa;
    return `
      <li class="pe-card${p.activo ? ' pe-card--activo' : ''}${noParticipa ? ' pe-card--ausente' : ''}"${actual ? ' aria-current="true"' : ''}>
        <header class="pe-cab">
          <div class="pe-titulo">
            <h4 class="pe-nombre">${escHtml(p.pe)}${nombre ? `<span>${escHtml(nombre)}</span>` : ''}</h4>
            <p class="pe-fechas">${escHtml(fechas(p))}</p>
          </div>
          <div class="pe-chips">
            ${f ? `<span class="etiqueta ${f.cls}">${f.txt}</span>` : ''}
            <span class="etiqueta etq-gris">${v2 ? 'Rúbrica por roles' : 'Rúbrica clásica'}</span>
          </div>
        </header>
        ${datos ? `<dl class="pe-datos">${datos}</dl>` : ''}
        ${noParticipa ? '<p class="pe-aviso">No forma parte de este período: no se evalúa ni se le asignan tareas.</p>' : `
        ${_evalHTML(p, item, fila)}
        ${_indicadoresHTML(p, fila)}
        ${_actividadesHTML(actividades)}`}
        <footer class="pe-pie">
          <button type="button" class="btn--secundario pe-ver" data-act="perfilPeriodo" data-arg="${escHtml(p.pe)}" aria-label="Ver el detalle de ${escHtml(p.pe)}">
            Ver detalle<i data-lucide="arrow-right" aria-hidden="true"></i>
          </button>
        </footer>
      </li>`;
  }

  /**
   * Pinta la pestaña. `inst` es la instancia de Perfil (persona, serie, periodo). Devuelve nada: escribe en `cuerpo`.
   * `vigente()` dice si el panel sigue siendo el que está a la vista (otro cambio de pestaña lo invalida).
   */
  async function pintar(inst, cuerpo, vigente = () => true) {
    const periodos = (Store.periodos() || []).slice();
    if (!periodos.length) { renderVacio(cuerpo, 'Todavía no hay períodos creados.'); return; }
    renderCargando(cuerpo);
    const d = await cargar({ persona: inst.persona, serie: inst.serie, periodos });
    if (!vigente()) return;
    const quien = inst.modo === 'propio' ? 'tu participación' : 'su participación';
    // El activo primero (es lo que se busca casi siempre) y después del más reciente al más antiguo.
    const orden = [...periodos].reverse().sort((x, y) => (y.activo ? 1 : 0) - (x.activo ? 1 : 0));
    const lista = orden.map(p => tarjetaHTML({
      p, item: inst.serie.find(i => String(i.periodo.id) === String(p.id)) || null, fila: d.filas.get(String(p.id)) || null,
      actividades: d.actividades.get(String(p.id)) || [], equipo: d.equipos.get(String(p.id)) || null,
      actual: String(p.id) === String(inst.periodo.id),
    }));
    cuerpo.innerHTML = `
      <p class="pe-intro">Cada tarjeta resume ${quien} en un PE. «Ver detalle» abre ese período en el resumen del perfil.</p>
      ${d.haySeguimiento ? '' : '<p class="pf-nota" role="status">La participación y los indicadores de tareas necesitan la migración 0025; mientras tanto se muestra solo el resultado de cada período.</p>'}
      <ul class="pe-lista">${lista.join('')}</ul>`;
    renderIconos(cuerpo);
  }

  /** Registra cómo se obtiene el equipo de una persona en un período (módulo de equipos). */
  function equipoDe(fn) { _equipoFn = typeof fn === 'function' ? fn : null; }
  const invalidar = () => { _actCache.r = null; };

  return { pintar, tarjetaHTML, fase, fechas, equipoDe, invalidar };
})();
