'use strict';
/**
 * EIGHT CREATORS LABs — Tareas: presentación y flujo compartidos (migración 0016)
 * ──────────────────────────────────────────────────────────────────────────────
 * Las reglas viven en la base (triggers de `tareas`): quién puede pasar de qué
 * estado a cuál, quién fija las fechas, qué se registra en el historial. Este
 * módulo solo ofrece los botones que ESA persona puede usar y muestra el error
 * de la base tal cual si algo se intenta fuera de regla.
 *
 * Una misma lista sirve a tres perspectivas:
 *   · miembro   : sus tareas. Crea las suyas («iniciativa propia»), las mueve
 *                 hasta «entregada». No aprueba.
 *   · revisor   : admin o secretario. Asigna, aprueba, devuelve, prorroga.
 *                 Un secretario no revisa las suyas (están en su «Entregas»).
 *
 * Depende de: config.js (escHtml), core/render.js (openModal, closeModal,
 * showToast, renderCargando/renderVacio/renderError), core/store.js, api.js.
 */
const Tareas = (() => {

  const ESTADOS = {
    asignada:  { txt: 'Asignada',   cls: 'asignada'  },
    en_curso:  { txt: 'En curso',   cls: 'en-curso'  },
    bloqueada: { txt: 'Bloqueada',  cls: 'bloqueada' },
    entregada: { txt: 'Entregada',  cls: 'entregada' },
    devuelta:  { txt: 'Devuelta',   cls: 'devuelta'  },
    aprobada:  { txt: 'Aprobada',   cls: 'aprobada'  },
  };
  const PRIORIDAD = { alta: 'Alta', normal: 'Normal', baja: 'Baja' };
  const ABIERTAS  = ['asignada', 'en_curso', 'devuelta', 'bloqueada'];

  /** Un contexto por contenedor: la página del secretario monta dos listas. */
  const ctxs = new Map();

  /** Nombres de los roles (0021: cada tarea puede llevar el rol con el que se hace). Se piden una sola vez por página. */
  const rolesNom = new Map();
  let rolesPedidos = false;
  async function cargarRoles() {
    if (rolesPedidos) return;
    rolesPedidos = true;
    try { (await API.getRoles(false)).forEach(r => rolesNom.set(Number(r.id), r.nombre)); } catch { rolesPedidos = false; }
  }

  /* ── Fechas (sin desfase de zona: se parten a mano, como mesDe en config.js) ── */
  const fechaCorta = iso => {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return '';
    return new Date(y, m - 1, d).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
  };
  const diasHasta = iso => {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    return Math.round((new Date(y, m - 1, d) - hoy) / 86400000);
  };
  const fechaHora = ts => ts
    ? new Date(ts).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  function plazoHTML(t) {
    if (!t.fecha_limite) return '<span class="tk-plazo">Sin fecha límite</span>';
    const prorrogada = t.fecha_limite_original && t.fecha_limite_original !== t.fecha_limite
      ? ` <span class="tk-prorroga" title="Fecha original: ${escHtml(fechaCorta(t.fecha_limite_original))}">prorrogada</span>` : '';
    if (t.estado === 'aprobada' || t.estado === 'entregada') {
      return `<span class="tk-plazo">Plazo ${escHtml(fechaCorta(t.fecha_limite))}${t.entregada_en ? ' · entregada ' + escHtml(fechaCorta(t.entregada_en)) : ''}${prorrogada}</span>`;
    }
    if (t.estado === 'bloqueada') {
      return `<span class="tk-plazo">Plazo ${escHtml(fechaCorta(t.fecha_limite))} · en pausa${prorrogada}</span>`;
    }
    const n = diasHasta(t.fecha_limite);
    const txt = n < 0 ? `Vencida hace ${-n} día${n === -1 ? '' : 's'}` : n === 0 ? 'Vence hoy' : `Vence en ${n} día${n === 1 ? '' : 's'}`;
    return `<span class="tk-plazo${n < 0 ? ' tk-plazo--vencida' : ''}">${txt} (${escHtml(fechaCorta(t.fecha_limite))})${prorrogada}</span>`;
  }

  /* ── Qué botones ve cada quien ──────────────────────────────────────── */
  /** En una gestión archivada la base rechaza toda escritura; no se ofrecen botones. */
  const soloLectura = () => document.body.classList.contains('gestion-archivada');

  function accionesDe(t, c) {
    if (soloLectura()) return [{ a: 'historial', txt: 'Historial', primario: false }];
    const receptor = t.asignada_a === c.yo;
    const revisor  = c.revisor && (c.esAdmin || !receptor);
    const out = [];
    const b = (a, txt, primario) => out.push({ a, txt, primario: !!primario });

    if (receptor && !(revisor && c.esAdmin)) {
      if (t.estado === 'asignada')  { b('empezar', 'Empezar'); b('entregar', 'Entregar', true); b('bloquear', 'Bloquear'); }
      if (t.estado === 'en_curso')  { b('entregar', 'Entregar', true); b('bloquear', 'Bloquear'); }
      if (t.estado === 'devuelta')  { b('entregar', 'Entregar corregida', true); b('empezar', 'Retomar'); b('bloquear', 'Bloquear'); }
      if (t.estado === 'bloqueada') { b('desbloquear', 'Desbloquear', true); }
      if (t.origen === 'propia' && t.estado !== 'aprobada') b('editar', 'Editar');
      if (t.origen === 'propia' && !['entregada', 'aprobada'].includes(t.estado)) b('prorrogar', 'Mover plazo');
    }
    if (revisor) {
      if (t.estado === 'entregada') { b('aprobar', 'Aprobar', true); b('devolver', 'Devolver'); }
      if (t.estado === 'bloqueada') b('desbloquear', 'Desbloquear');
      if (t.estado === 'aprobada' && c.esAdmin) b('reabrir', 'Reabrir');
      if (!['entregada', 'aprobada'].includes(t.estado)) b('prorrogar', 'Prorrogar');
      if (t.estado !== 'aprobada') b('editar', 'Editar');
    }
    if (c.esAdmin || (t.asignada_por === c.yo && t.estado === 'asignada')) b('borrar', 'Borrar');
    b('historial', 'Historial');
    return out;
  }

  function tarjetaHTML(t, c) {
    const est = ESTADOS[t.estado] || ESTADOS.asignada;
    const nombre = c.personas.get(t.asignada_a)?.nombre;
    // Para quien revisa, «entregada» significa «te toca a ti».
    const estTxt = c.revisor && t.estado === 'entregada' && t.asignada_a !== c.yo ? 'Por revisar' : est.txt;
    const acciones = accionesDe(t, c);
    const crit = (t.criterios || []).map(k => c.catalogo.get(k)).filter(Boolean);

    return `
      <article class="tk-card tk-card--${est.cls}" data-tarea="${t.id}" aria-label="${escHtml(t.titulo)}">
        <header class="tk-head">
          <h4 class="tk-titulo">${escHtml(t.titulo)}</h4>
          <span class="tk-pill tk-pill--${est.cls}">${escHtml(estTxt)}${t.estado === 'aprobada' && t.puntos != null ? ` · ${t.puntos}/10` : ''}</span>
        </header>
        <div class="tk-meta">
          ${c.revisor && nombre ? `<span class="tk-persona">${escHtml(nombre)}</span>` : ''}
          ${t.rol_id != null && rolesNom.has(Number(t.rol_id)) ? `<span class="tk-tag" title="Rol con el que se hace este trabajo">Rol: ${escHtml(rolesNom.get(Number(t.rol_id)))}</span>` : ''}
          ${t.rol_excepcion ? '<span class="tk-tag tk-tag--alta" title="La administración asignó un rol que la persona no tiene habilitado">Excepción de rol</span>' : ''}
          ${t.origen === 'propia' ? '<span class="tk-tag" title="La creó la propia persona. Cuenta como iniciativa cuando otra persona la aprueba.">Iniciativa propia</span>' : ''}
          ${t.prioridad !== 'normal' ? `<span class="tk-tag tk-tag--${t.prioridad}">Prioridad ${PRIORIDAD[t.prioridad].toLowerCase()}</span>` : ''}
          ${plazoHTML(t)}
        </div>
        ${t.descripcion ? `<p class="tk-desc">${escHtml(t.descripcion)}</p>` : ''}
        ${crit.length ? `<p class="tk-crit">Evidencia: ${escHtml(crit.join(' · '))}</p>` : ''}
        ${t.estado === 'devuelta' && t.revision_nota ? `<div class="tk-aviso tk-aviso--devuelta" role="note"><strong>Corregir:</strong> ${escHtml(t.revision_nota)}</div>` : ''}
        ${t.estado === 'bloqueada' && t.bloqueo_motivo ? `<div class="tk-aviso" role="note"><strong>En pausa:</strong> ${escHtml(t.bloqueo_motivo)}</div>` : ''}
        ${(t.entrega_url || t.entrega_nota) && t.estado !== 'asignada' && t.estado !== 'en_curso' ? `
          <div class="tk-entrega">
            ${t.entrega_url ? `<a href="${escHtml(t.entrega_url)}" target="_blank" rel="noopener noreferrer">Ver entrega</a>` : ''}
            ${t.entrega_nota ? `<span>${escHtml(t.entrega_nota)}</span>` : ''}
          </div>` : ''}
        <div class="tk-acciones">
          ${acciones.map(x => `<button type="button" class="tk-btn${x.primario ? ' tk-btn--main' : ''}"
            data-act="tkAccion" data-arg="${x.a}" data-arg2="${t.id}">${x.txt}</button>`).join('')}
        </div>
      </article>`;
  }

  /* ── Lista, filtros y agrupación ────────────────────────────────────── */
  const FILTROS = [
    ['todas', 'Todas'], ['porRevisar', 'Por revisar'], ['abiertas', 'Abiertas'],
    ['vencidas', 'Vencidas'], ['aprobadas', 'Aprobadas'],
  ];
  const pasaFiltro = (t, f) => ({
    todas:      () => true,
    porRevisar: () => t.estado === 'entregada',
    abiertas:   () => ABIERTAS.includes(t.estado),
    vencidas:   () => ['asignada', 'en_curso', 'devuelta'].includes(t.estado) && t.fecha_limite && diasHasta(t.fecha_limite) < 0,
    aprobadas:  () => t.estado === 'aprobada',
  }[f] || (() => true))();

  const ordenar = lista => [...lista].sort((a, b) => {
    const peso = t => (t.estado === 'devuelta' ? 0 : ['asignada', 'en_curso'].includes(t.estado) ? 1 : t.estado === 'bloqueada' ? 2 : t.estado === 'entregada' ? 3 : 4);
    return peso(a) - peso(b)
      || String(a.fecha_limite || '9999').localeCompare(String(b.fecha_limite || '9999'));
  });

  function render(c) {
    const el = c.el;
    // En la lista de revisión no entran las tareas del propio secretario.
    const base = c.revisor && !c.esAdmin ? c.tareas.filter(t => t.asignada_a !== c.yo) : c.tareas;
    const lista = ordenar(base.filter(t => pasaFiltro(t, c.filtro) && (!c.persona || t.asignada_a === c.persona)));

    const porRevisar = base.filter(t => t.estado === 'entregada').length;
    const barra = `
      <div class="tk-barra">
        <div class="tk-filtros" role="group" aria-label="Filtrar tareas">
          ${(c.revisor ? FILTROS : FILTROS.filter(([k]) => k !== 'porRevisar')).map(([k, l]) => `
            <button type="button" class="tk-chip${c.filtro === k ? ' tk-chip--on' : ''}" aria-pressed="${c.filtro === k}"
              data-act="tkFiltro" data-arg="${k}">${l}${k === 'porRevisar' && porRevisar ? ` <b>${porRevisar}</b>` : ''}</button>`).join('')}
        </div>
        ${c.revisor ? `
          <select class="cfg-inp cfg-select tk-persona-sel" aria-label="Filtrar por persona" data-change="tkFiltroPersona">
            <option value="">Todas las personas</option>
            ${[...c.personas.values()].filter(p => p.id !== c.yo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
              .map(p => `<option value="${escHtml(p.id)}"${c.persona === p.id ? ' selected' : ''}>${escHtml(p.nombre)}</option>`).join('')}
          </select>` : ''}
        ${c.puedeCrear ? `<button type="button" class="btn-save tk-nueva" data-act="tkAccion" data-arg="nueva">${c.revisor ? '+ Nueva tarea' : '+ Mi iniciativa'}</button>` : ''}
      </div>`;

    el.dataset.tk = c.id;
    el.innerHTML = barra + (lista.length
      ? `<div class="tk-lista">${lista.map(t => tarjetaHTML(t, c)).join('')}</div>`
      : `<div class="empty-box"><div class="empty-txt">${
          c.tareas.length ? 'Ninguna tarea coincide con el filtro.'
          : c.revisor ? 'Todavía no hay tareas en este período. Crea la primera con «Nueva tarea».'
          : 'No tienes tareas en este período. Cuando te asignen una, aparecerá aquí.'}</div></div>`);
  }

  /* ── Carga ──────────────────────────────────────────────────────────── */
  async function cargar(c) {
    // Contexto sin lista (crear una tarea desde otra sección): no hay nada que repintar.
    if (!c.el) return { ok: true };
    renderCargando(c.el);
    c._abort?.abort();
    const ctrl = c._abort = new AbortController();
    const [res] = await Promise.all([API.getTareas({ periodoId: c.periodoId, userId: c.soloPersona || (c.revisor ? null : c.yo), signal: ctrl.signal }), cargarRoles()]);
    if (res.aborted) return;
    if (!res.ok) {
      if (res.noDisponible) c.onNoDisponible?.();
      else renderError(c.el, res.error, () => cargar(c));
      return res;
    }
    c.tareas = res.tareas;
    render(c);
    return res;
  }

  /**
   * Monta una lista de tareas en `el`.
   *   yo           : id del usuario en sesión
   *   revisor      : true si asigna/aprueba (admin o secretario)
   *   esAdmin      : true si es admin (puede reabrir, borrar y revisar lo suyo)
   *   personas     : [{ id, nombre }] a quién se puede asignar (revisor)
   *   onCambio     : se llama tras cada cambio guardado
   *   onNoDisponible: la migración 0016 no está aplicada
   */
  async function montar({ id, el, periodoId, yo, revisor = false, esAdmin = false, personas = [], onCambio, onNoDisponible, soloPersona = null }) {
    const c = {
      id, el, periodoId, yo, revisor, esAdmin, onCambio, onNoDisponible, soloPersona, paraId: soloPersona,
      puedeCrear: !soloLectura(), filtro: revisor ? 'porRevisar' : 'todas', persona: '',
      personas: new Map(personas.map(p => [p.id, p])),
      catalogo: new Map((Store.get('criteriosV2') || []).map(k => [k.key, k.nombre])),
      tareas: [],
    };
    // Vista de UNA persona: se parte de todas sus tareas.
    if (soloPersona) c.filtro = 'todas';
    // Si no hay nada por revisar, partir de «Abiertas» y no de una lista vacía.
    ctxs.set(id, c);
    const res = await cargar(c);
    if (res?.ok && c.revisor && !soloPersona && !c.tareas.some(t => t.estado === 'entregada')) { c.filtro = 'abiertas'; render(c); }
    return c;
  }

  /**
   * Abre «Nueva tarea» sin tener la lista en pantalla: se usa desde el perfil de
   * una persona, el buscador o el calendario.
   */
  function nueva({ periodoId, yo, revisor = false, esAdmin = false, personas = [], paraId = null, fecha = '', onCambio, periodos = [] }) {
    const c = {
      id: 'rapida', el: null, periodoId, periodos, yo, revisor, esAdmin, onCambio, paraId, fechaIni: fecha, puedeCrear: true, filtro: 'todas', persona: '',
      personas: new Map(personas.map(p => [p.id, p])),
      catalogo: new Map((Store.get('criteriosV2') || []).map(k => [k.key, k.nombre])),
      tareas: [],
    };
    modalNueva(c);
  }

  const recargar = id => { const c = ctxs.get(id); return c ? cargar(c) : null; };

  /* ── Modal único ────────────────────────────────────────────────────── */
  let _modal = null;

  function asegurarModal() {
    if (document.getElementById('tk-modal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="tk-overlay" id="tk-modal" style="display:none" data-act="cerrarModalFondo" data-arg="tk-modal">
        <div class="tk-box">
          <div class="modal-title" id="tk-modal-title"></div>
          <div id="tk-modal-cuerpo"></div>
          <div class="tk-err" id="tk-modal-err" role="alert"></div>
          <div class="tk-modal-acciones">
            <button type="button" class="btn-save" id="tk-modal-ok" data-act="tkConfirmar"></button>
            <button type="button" class="tk-btn" data-act="cerrarModal" data-arg="tk-modal">Cancelar</button>
          </div>
        </div>
      </div>`);
  }

  function campoHTML(f) {
    const id = 'tkf-' + f.id;
    const lab = f.label ? `<label for="${id}">${escHtml(f.label)}${f.req ? ' <span aria-hidden="true">*</span>' : ''}</label>` : '';
    const pie = f.ayuda ? `<small class="tk-ayuda">${escHtml(f.ayuda)}</small>` : '';
    switch (f.tipo) {
      case 'info':
        return `<p class="tk-info">${escHtml(f.texto)}</p>`;
      case 'puntos':
        return `<div class="tk-campo">${lab}<div class="tk-puntos" role="radiogroup" aria-label="Puntos">${Array.from({ length: 11 }, (_, n) => `<label class="tk-punto"><input type="radio" name="${id}" value="${n}"${n === Number(f.valor) ? ' checked' : ''}><span>${n}</span></label>`).join('')}</div>${pie}</div>`;
      case 'texto':
        return `<div class="tk-campo">${lab}<input class="cfg-inp" id="${id}" type="text" maxlength="${f.max || 160}"
          value="${escHtml(f.valor || '')}" placeholder="${escHtml(f.ph || '')}">${pie}</div>`;
      case 'area':
        return `<div class="tk-campo">${lab}<textarea class="cfg-inp" id="${id}" rows="${f.filas || 3}" maxlength="${f.max || 2000}"
          placeholder="${escHtml(f.ph || '')}">${escHtml(f.valor || '')}</textarea>${pie}</div>`;
      case 'fecha':
        return `<div class="tk-campo">${lab}<input class="cfg-inp" id="${id}" type="date" value="${escHtml(f.valor || '')}">${pie}</div>`;
      case 'select':
        return `<div class="tk-campo">${lab}<select class="cfg-inp cfg-select" id="${id}">
          ${f.opciones.map(o => `<option value="${escHtml(o.v)}"${o.v === f.valor ? ' selected' : ''}>${escHtml(o.l)}</option>`).join('')}
        </select>${pie}</div>`;
      case 'checks':
        return `<fieldset class="tk-campo tk-checks" id="${id}"><legend>${escHtml(f.label)}${f.req ? ' <span aria-hidden="true">*</span>' : ''}</legend>
          <div class="tk-checks-lista">${f.opciones.map(o => `
            <label class="tk-check"><input type="checkbox" value="${escHtml(o.v)}"${(f.valor || []).includes(o.v) ? ' checked' : ''}>
              <span>${escHtml(o.l)}</span></label>`).join('')}</div>${pie}</fieldset>`;
      default: return '';
    }
  }

  function leerValores(campos) {
    const v = {};
    for (const f of campos) {
      if (f.tipo === 'info') continue;
      if (f.tipo === 'puntos') { v[f.id] = document.querySelector(`input[name="tkf-${f.id}"]:checked`)?.value ?? ''; continue; }
      const el = document.getElementById('tkf-' + f.id);
      if (!el) continue;
      v[f.id] = f.tipo === 'checks'
        ? [...el.querySelectorAll('input:checked')].map(i => i.value)
        : el.value.trim();
    }
    return v;
  }

  function abrirModal({ titulo, campos, confirmar, onConfirm, sinConfirmar = false }) {
    asegurarModal();
    _modal = { campos, onConfirm };
    setEl('tk-modal-title', titulo);
    document.getElementById('tk-modal-cuerpo').innerHTML = campos.map(campoHTML).join('');
    document.getElementById('tk-modal-err').textContent = '';
    const ok = document.getElementById('tk-modal-ok');
    ok.textContent = confirmar || 'Guardar';
    ok.hidden = sinConfirmar;
    ok.disabled = false;
    openModal('tk-modal');
  }

  async function confirmar() {
    if (!_modal) return;
    const ok = document.getElementById('tk-modal-ok');
    const err = document.getElementById('tk-modal-err');
    ok.disabled = true; err.textContent = '';
    const msg = await _modal.onConfirm(leerValores(_modal.campos));
    if (msg) { err.textContent = msg; ok.disabled = false; return; }
    closeModal('tk-modal');
    _modal = null;
  }

  /* ── Cambios ────────────────────────────────────────────────────────── */
  async function aplicar(c, t, patch, mensaje) {
    const res = await API.actualizarTarea(t.id, patch);
    if (!res.ok) return res.error;
    const i = c.tareas.findIndex(x => x.id === t.id);
    if (i >= 0) c.tareas[i] = res.tarea;
    render(c);
    if (mensaje) showToast(mensaje, 'ok');
    c.onCambio?.();
    return null;
  }

  const minimo = (v, n) => (v || '').trim().length >= n;

  function camposContenido(c, t = {}) {
    const cat = [...c.catalogo.entries()].map(([k, n]) => ({ v: k, l: n }));
    return [
      { id: 'titulo', tipo: 'texto', label: 'Título', req: true, valor: t.titulo, ph: 'Ej.: Cobertura de la jornada del sábado' },
      { id: 'descripcion', tipo: 'area', label: 'Qué se espera', valor: t.descripcion, ph: 'Formato, medidas, dónde se entrega…' },
      { id: 'prioridad', tipo: 'select', label: 'Prioridad', valor: t.prioridad || 'normal',
        opciones: [{ v: 'alta', l: 'Alta' }, { v: 'normal', l: 'Normal' }, { v: 'baja', l: 'Baja' }] },
      ...(cat.length ? [{ id: 'criterios', tipo: 'checks', label: 'Criterios que evidencia (opcional)', valor: t.criterios || [], opciones: cat,
        ayuda: 'Orienta al evaluador. No puntúa nada por sí solo.' }] : []),
    ];
  }

  function modalNueva(c) {
    // Quien revisa (administración / secretaría) usa el flujo completo: roles por persona, equipos, validaciones.
    if (c.revisor && typeof Asignar !== 'undefined') {
      c.onCreadas = () => cargar(c);
      return Asignar.abrir(c);
    }
    const campos = [
      ...((c.periodos || []).length > 1 ? [{ id: 'periodo', tipo: 'select', label: 'Período de la tarea', valor: c.periodoId,
        opciones: c.periodos.map(p => ({ v: p.id, l: p.pe + (p.nombre && p.nombre !== p.pe ? ' · ' + p.nombre : '') })),
        ayuda: 'La tarea cuenta como evidencia de ese período.' }] : []),
      ...(c.revisor ? [{ id: 'para', tipo: 'checks', label: 'Asignar a', req: true, valor: c.paraId ? [c.paraId] : [],
        opciones: [...c.personas.values()].filter(p => p.id !== c.yo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
          .map(p => ({ v: p.id, l: p.nombre })), ayuda: 'Puedes marcar varias personas: cada una recibe su propia tarea.' }]
        : [{ id: 'aviso', tipo: 'info', texto: 'Es una tarea por iniciativa propia. Cuenta como evidencia de iniciativa cuando tu secretario o el administrador la aprueban; no la puedes aprobar tú.' }]),
      ...camposContenido(c),
      { id: 'fecha', tipo: 'fecha', label: 'Fecha límite', valor: c.fechaIni || '' },
    ];
    abrirModal({
      titulo: c.revisor ? 'Nueva tarea' : 'Nueva tarea por iniciativa propia', campos, confirmar: 'Crear',
      onConfirm: async v => {
        if (!minimo(v.titulo, 1)) return 'Escribe un título.';
        const destinos = c.revisor ? v.para : [c.yo];
        if (!destinos.length) return 'Elige al menos una persona.';
        const res = await Promise.all(destinos.map(id => API.crearTarea({
          periodo_id: v.periodo || c.periodoId, titulo: v.titulo, descripcion: v.descripcion, asignada_a: id,
          prioridad: v.prioridad, fecha_limite: v.fecha || null, criterios: v.criterios || [],
        })));
        const fallos = res.filter(r => !r.ok);
        await cargar(c);
        c.onCambio?.();
        if (fallos.length === res.length) return fallos[0].error;
        showToast(fallos.length ? `Se crearon ${res.length - fallos.length} de ${res.length}: ${fallos[0].error}` : (res.length > 1 ? `${res.length} tareas creadas` : 'Tarea creada'),
                  fallos.length ? 'error' : 'ok');
        return null;
      },
    });
  }

  function modalEditar(c, t) {
    abrirModal({
      titulo: 'Editar tarea', campos: camposContenido(c, t), confirmar: 'Guardar',
      onConfirm: async v => {
        if (!minimo(v.titulo, 1)) return 'Escribe un título.';
        return aplicar(c, t, { titulo: v.titulo, descripcion: v.descripcion, prioridad: v.prioridad, criterios: v.criterios || t.criterios }, 'Tarea actualizada');
      },
    });
  }

  function modalEntregar(c, t) {
    abrirModal({
      titulo: t.estado === 'devuelta' ? 'Entregar corregida' : 'Entregar tarea',
      confirmar: 'Entregar',
      campos: [
        ...(t.estado === 'devuelta' && t.revision_nota ? [{ id: 'obs', tipo: 'info', texto: 'Observación: ' + t.revision_nota }] : []),
        { id: 'url', tipo: 'texto', label: 'Enlace a la entrega', max: 2000, valor: t.entrega_url || '', ph: 'https://…', ayuda: 'Drive, YouTube, carpeta compartida… Debe empezar por https://' },
        { id: 'nota', tipo: 'area', label: 'Nota', valor: t.entrega_nota || '', filas: 2, ph: 'Qué entregas, qué cambió…', ayuda: 'Necesitas un enlace, una nota, o ambos.' },
      ],
      onConfirm: async v => {
        if (v.url && !/^https?:\/\/\S+$/i.test(v.url)) return 'El enlace debe empezar por http:// o https://';
        if (!v.url && !minimo(v.nota, 3)) return 'Indica un enlace o escribe una nota de la entrega.';
        return aplicar(c, t, { estado: 'entregada', entrega_url: v.url || null, entrega_nota: v.nota || null }, 'Entregada: queda por revisar');
      },
    });
  }

  function modalDevolver(c, t) {
    abrirModal({
      titulo: 'Devolver para corregir', confirmar: 'Devolver',
      campos: [{ id: 'nota', tipo: 'area', label: 'Qué hay que corregir', req: true, filas: 3, ph: 'Sé concreto: qué falta y cómo debería quedar.' }],
      onConfirm: async v => minimo(v.nota, 3) ? aplicar(c, t, { estado: 'devuelta', revision_nota: v.nota }, 'Devuelta con observaciones') : 'Explica qué hay que corregir.',
    });
  }

  /* Aprobar = puntuar. La puntuación (0–10) es un hecho más para el evaluador;
     la base la exige al aprobar (migración 0017) y solo el admin la corrige. */
  function modalAprobar(c, t) {
    abrirModal({
      titulo: 'Aprobar y puntuar', confirmar: 'Aprobar',
      campos: [
        { id: 'info', tipo: 'info', texto: `«${t.titulo}». Los puntos quedan en el historial de la persona; no entran solos en su evaluación.` },
        { id: 'puntos', tipo: 'puntos', label: 'Puntos (0–10)', req: true, valor: 8 },
      ],
      onConfirm: async v => {
        const n = Number(v.puntos);
        if (!Number.isInteger(n) || n < 0 || n > 10) return 'Elige unos puntos entre 0 y 10.';
        let err = await aplicar(c, t, { estado: 'aprobada', puntos: n }, `Aprobada con ${n} puntos`);
        // Antes de aplicar 0017 la columna no existe: se aprueba sin puntos y se avisa.
        if (err && /puntos/i.test(err) && /column|schema|PGRST/i.test(err)) {
          err = await aplicar(c, t, { estado: 'aprobada' }, 'Aprobada (la base aún no guarda puntos: aplica 0017)');
        }
        return err;
      },
    });
  }

  function modalBloquear(c, t) {
    abrirModal({
      titulo: 'Bloquear tarea', confirmar: 'Bloquear',
      campos: [
        { id: 'info', tipo: 'info', texto: 'Una tarea bloqueada espera a un tercero y no cuenta como atraso mientras tanto.' },
        { id: 'motivo', tipo: 'texto', label: '¿De qué o de quién depende?', req: true, max: 500, ph: 'Ej.: Esperando el guion de Redacción' },
      ],
      onConfirm: async v => minimo(v.motivo, 3) ? aplicar(c, t, { estado: 'bloqueada', bloqueo_motivo: v.motivo }, 'Tarea bloqueada') : 'Indica el motivo.',
    });
  }

  function modalProrrogar(c, t) {
    abrirModal({
      titulo: 'Mover la fecha límite', confirmar: 'Mover plazo',
      campos: [
        { id: 'info', tipo: 'info', texto: `Fecha actual: ${t.fecha_limite ? fechaCorta(t.fecha_limite) : 'sin fecha'}. El cambio y su motivo quedan en el historial; la fecha original no se pierde.` },
        { id: 'fecha', tipo: 'fecha', label: 'Nueva fecha', req: true, valor: t.fecha_limite || '' },
        { id: 'motivo', tipo: 'texto', label: 'Motivo', req: true, max: 300, ph: 'Ej.: El evento se movió al viernes' },
      ],
      onConfirm: async v => {
        if (!v.fecha) return 'Elige la nueva fecha.';
        if (!minimo(v.motivo, 5)) return 'Escribe el motivo (mínimo 5 caracteres).';
        const res = await API.prorrogarTarea(t.id, v.fecha, v.motivo);
        if (!res.ok) return res.error;
        await cargar(c); c.onCambio?.(); showToast('Plazo actualizado', 'ok');
        return null;
      },
    });
  }

  async function modalHistorial(c, t) {
    abrirModal({ titulo: 'Historial', sinConfirmar: true, campos: [{ id: 'esp', tipo: 'info', texto: 'Cargando…' }] });
    const res = await API.getEventosTarea(t.id);
    const cuerpo = document.getElementById('tk-modal-cuerpo');
    if (!res.ok) { cuerpo.textContent = res.error; return; }
    if (!res.eventos.length) { cuerpo.innerHTML = '<p class="tk-info">Esta tarea aún no tiene movimientos registrados.</p>'; return; }
    const quien = id => (id && c.personas.get(id)?.nombre) || (id === c.yo ? 'Tú' : 'Alguien del equipo');
    const linea = e => {
      const m = e.motivo ? ` — «${escHtml(e.motivo)}»` : '';
      if (e.tipo === 'creada') return `Creada (${e.motivo === 'propia' ? 'iniciativa propia' : 'asignada'})`;
      if (e.tipo === 'rol') return `Rol ${escHtml(e.de || 'sin rol')} → ${escHtml(e.a || 'sin rol')}`;
      if (e.tipo === 'prorroga') return `Plazo ${escHtml(fechaCorta(e.de) || 'sin fecha')} → ${escHtml(fechaCorta(e.a))}${m}`;
      return `${escHtml((ESTADOS[e.de] || {}).txt || e.de)} → ${escHtml((ESTADOS[e.a] || {}).txt || e.a)}${m}`;
    };
    cuerpo.innerHTML = `<ol class="tk-historial">${res.eventos.map(e => `
      <li><span class="tk-h-cuando">${escHtml(fechaHora(e.created_at))}</span>
          <span class="tk-h-quien">${escHtml(quien(e.actor_id))}</span>
          <span class="tk-h-que">${e.tipo === 'creada' ? (e.motivo === 'propia' ? 'Creada (iniciativa propia)' : 'Creada (asignada)') : linea(e)}</span></li>`).join('')}</ol>`;
  }

  /* ── Despachador ────────────────────────────────────────────────────── */
  async function accion(a, el) {
    const c = ctxs.get(el.closest('[data-tk]')?.dataset.tk);
    if (!c) return;
    if (a === 'nueva') return modalNueva(c);
    const t = c.tareas.find(x => String(x.id) === String(el.dataset.arg2));
    if (!t) return;
    switch (a) {
      case 'empezar':     return void await aplicarMsg(c, t, { estado: 'en_curso' }, 'En curso');
      case 'desbloquear': return void await aplicarMsg(c, t, { estado: 'en_curso' }, 'Desbloqueada');
      case 'aprobar':     return modalAprobar(c, t);
      case 'reabrir':     return void await aplicarMsg(c, t, { estado: 'entregada' }, 'Reabierta: vuelve a quedar por revisar');
      case 'entregar':    return modalEntregar(c, t);
      case 'bloquear':    return modalBloquear(c, t);
      case 'devolver':    return modalDevolver(c, t);
      case 'prorrogar':   return modalProrrogar(c, t);
      case 'editar':      return modalEditar(c, t);
      case 'historial':   return modalHistorial(c, t);
      case 'borrar': {
        if (!confirm('¿Borrar esta tarea? No se puede deshacer.')) return;
        const res = await API.borrarTarea(t.id);
        if (!res.ok) { showToast(res.error, 'error'); return; }
        c.tareas = c.tareas.filter(x => x.id !== t.id);
        render(c); c.onCambio?.(); showToast('Tarea borrada', 'ok');
        return;
      }
    }
  }
  async function aplicarMsg(c, t, patch, ok) {
    const err = await aplicar(c, t, patch, ok);
    if (err) showToast(err, 'error');
  }

  function filtro(k, el) {
    const c = ctxs.get(el.closest('[data-tk]')?.dataset.tk); if (!c) return;
    c.filtro = k; render(c);
  }
  function filtroPersona(el) {
    const c = ctxs.get(el.closest('[data-tk]')?.dataset.tk); if (!c) return;
    c.persona = el.value; render(c);
  }

  /* ── Evidencia para el evaluador (Fase 4) ───────────────────────────────
   * Hechos, no notas: resumen_tareas_periodo los calcula en la base. Se
   * sugiere a qué criterio del núcleo alimentan, pero NO se puntúa ni se
   * rellena nada: el evaluador interpreta. */
  function evidenciaHTML(r, tareas = []) {
    if (!r) {
      return `<section class="tk-evid" aria-label="Evidencia de tareas">
        <h4 class="tk-evid-h">Evidencia de tareas</h4>
        <p class="tk-evid-p">Esta persona no tiene tareas en el período, así que no hay hechos objetivos que mostrar: evalúa con lo que observaste.</p></section>`;
    }
    const pct = r.con_plazo ? Math.round((r.a_tiempo / r.con_plazo) * 100) : null;
    const dato = (val, lbl, sub, aviso) => `
      <div class="tk-dato${aviso ? ' tk-dato--aviso' : ''}"><div class="tk-dato-val">${val}</div>
        <div class="tk-dato-lbl">${lbl}</div>${sub ? `<div class="tk-dato-sub">${sub}</div>` : ''}</div>`;
    const poca = r.con_plazo > 0 && r.con_plazo < 3;
    return `
      <section class="tk-evid" aria-label="Evidencia de tareas">
        <h4 class="tk-evid-h">Evidencia de tareas <span>en este período</span></h4>
        <div class="tk-datos">
          ${dato(pct == null ? '—' : pct + ' %', 'A tiempo', pct == null ? 'Sin tareas con plazo entregadas' : `${r.a_tiempo} de ${r.con_plazo} con plazo`, r.vencidas_abiertas > 0)}
          ${dato(r.vencidas_abiertas, 'Vencidas sin entregar', 'No cuenta lo bloqueado', r.vencidas_abiertas > 0)}
          ${dato(r.devoluciones, 'Devoluciones', 'Veces que volvió por correcciones')}
          ${dato(r.propias_aprobadas, 'Iniciativas validadas', 'Propias aprobadas por otra persona')}
          ${dato(r.prorrogas, 'Plazos movidos', 'Siempre con motivo')}
          ${dato(r.asignadas, 'Carga asignada', `${r.entregadas} entregadas · ${r.abiertas} abiertas`)}
        </div>
        <ul class="tk-evid-guia">
          <li><strong>Plazos</strong> ← tareas a tiempo, vencidas y plazos movidos.</li>
          <li><strong>Calidad y completitud</strong> ← devoluciones por correcciones.</li>
          <li><strong>Iniciativa</strong> ← iniciativas validadas.</li>
          <li>Respuesta y colaboración no se miden con tareas: valóralas con lo que observaste.</li>
        </ul>
        <p class="tk-evid-p">${poca ? '<strong>Pocas tareas con plazo:</strong> interprétalo con cautela. ' : ''}Son hechos para apoyar tu criterio; no puntúan ni rellenan nada por sí solos.</p>
        ${tareas.length ? `<details class="v2-det"><summary>Ver las ${tareas.length} tareas</summary>
          <ul class="tk-evid-lista">${tareas.map(t => `<li><span class="tk-pill tk-pill--${(ESTADOS[t.estado] || ESTADOS.asignada).cls}">${escHtml((ESTADOS[t.estado] || ESTADOS.asignada).txt)}</span>
            ${escHtml(t.titulo)}${t.origen === 'propia' ? ' <em>(iniciativa propia)</em>' : ''} · ${plazoHTML(t)}</li>`).join('')}</ul></details>` : ''}
      </section>`;
  }

  return { montar, nueva, recargar, accion, confirmar, filtro, filtroPersona, evidenciaHTML, abrirModal, ESTADOS, plazoHTML };
})();

/* Globales de la lista blanca de config.js (data-act="fn" / data-change). */
function tkConfirmar() { Tareas.confirmar(); }
function tkFiltroPersona(el) { Tareas.filtroPersona(el); }
