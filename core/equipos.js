'use strict';
/**
 * EIGHT CREATORS LABs — Equipos de trabajo por PE y sus tareas colectivas (migraciones 0031–0036)
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * Un solo módulo para las tres perspectivas:
 *   · admin      : lista con filtros, formulario, composición, tareas, resultados e historial del equipo.
 *   · miembro    : «Mis equipos»: sus equipos, integrantes, tareas del grupo, avance, entregas y observaciones.
 *   · secretaría : lo mismo que el miembro + revisar las tareas de los equipos cuyo ámbito es su distrito.
 *
 * ES PRESENTACIÓN. Las reglas las impone la base: quién crea equipos (solo administración), quién ve cada tarea,
 * quién entrega, aprueba o corrige, qué cuenta para la nota. Este archivo ofrece los botones que cada quien puede
 * usar (las banderas `soy_participante` y `puedo_revisar` vienen de la base) y muestra su error tal cual si se
 * intenta algo fuera de regla. NO calcula ninguna nota: la del equipo viene de equipo_resultados() y la de las
 * personas de resultados_periodo() (0035).
 *
 * Una tarea colectiva se completa solo por transiciones guardadas en la base (entregar, aprobar…); abrir la pantalla
 * o marcar algo aquí no cambia nada por sí solo.
 *
 * Acciones por ACCIONES (config.js): data-act="eq" data-arg="<accion>" data-arg2="<id>". Todo texto humano pasa por
 * escHtml. Depende de: config.js, core/render.js, core/ui.js, core/tareas.js (modal), core/selector.js,
 * core/personas.js, api.js.
 */
const Equipos = (() => {

  const EST = {
    activo:    { txt: 'Activo',    cls: 'etq-verde' },
    inactivo:  { txt: 'Inactivo',  cls: 'etq-gris' },
    archivado: { txt: 'Archivado', cls: 'etq-ambar' },
  };
  const ALERTA = {
    otro_distrito: 'Fuera del distrito del equipo',
    no_participa:  'Ya no participa en este PE',
    sin_aprobar:   'Acceso sin aprobar',
  };
  const OMITIDO = {
    ya_integrante: 'ya es integrante', administracion: 'es administración (no se evalúa)', no_participa: 'no participa en este PE',
    sin_aprobar: 'su acceso no está aprobado', otro_distrito: 'es de otro distrito (usa la excepción explícita)', no_existe: 'no existe',
  };
  const EST_TAREA = {
    ...Tareas.ESTADOS,
    anulada: { txt: 'Anulada', cls: 'devuelta' },
  };
  const PRIORIDAD = { alta: 'Alta', normal: 'Normal', baja: 'Baja' };

  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const hora = ts => ts ? new Date(ts).toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const nom = id => S.personas.get(id)?.nombre || '';

  /** Estado del módulo: una sola pantalla activa por página. */
  const S = {
    modo: 'admin', host: null, yo: null, esAdmin: false, periodos: [], personas: new Map(), distritos: [],
    periodoId: null, equipos: [], miembros: new Map(), f: { q: '', estado: '', resp: '' },
    eqId: null, tareas: [], integrantes: [], resultados: [], eventos: [], cargando: false, onCambio: null,
    tq: { equipo: '', estado: '' },
  };
  /* Una misma página puede tener varios contenedores de equipos (Entregas y Tareas, por ejemplo). El estado es uno solo;
     al pulsar algo en otro contenedor se guarda el del anterior y se recupera el de ese. */
  const SNAP = {};
  function usar(host) {
    if (!host || S.host === host) return;
    if (S.host && S.host.id) SNAP[S.host.id] = { ...S };
    const sn = SNAP[host.id];
    if (sn) Object.assign(S, sn);
  }
  const soloLectura = () => document.body.classList.contains('gestion-archivada');
  const v2 = () => (S.periodos || []).filter(p => typeof esPeriodoV2 === 'function' ? esPeriodoV2(p) : p.modelo === 'v2');

  /* ══ Piezas de pantalla ══════════════════════════════════════════════ */
  const barraAvance = n => n == null ? '' : `
    <span class="eq-avance" role="img" aria-label="Avance ${Number(n)} %"><span class="barra-track"><span class="barra-fill" style="width:${Math.max(0, Math.min(100, Number(n)))}%"></span></span><b>${Number(n)} %</b></span>`;

  const avatarChip = (nombre, extra = '') => `
    <li class="eq-pers">${Avatar.html({ nombre: nombre || '' }, { tam: 'xs', attrs: 'aria-hidden="true"' })}<span>${escHtml(nombre || '—')}${extra}</span></li>`;

  function noDisponibleHTML() {
    return `<div class="empty-box"><div class="empty-txt">Los equipos todavía no están activos en esta instalación: falta aplicar las migraciones 0031 a 0036 en la base de datos.</div></div>`;
  }

  /* ── Tarjeta de una tarea colectiva ───────────────────────────────── */
  function tareaHTML(t) {
    const est = EST_TAREA[t.estado] || EST_TAREA.asignada;
    const lect = soloLectura();
    const nota = t.estado === 'aprobada' && t.puntos != null
      ? `<span class="eq-nota${t.nota_anulada ? ' eq-nota--anulada' : ''}" title="Nota del grupo">${t.nota_anulada ? 'Nota anulada · ' : 'Nota del grupo '}<b>${Number(t.puntos)}/10</b>${t.puntos_original != null && t.puntos_original !== t.puntos ? ` <small>(original ${Number(t.puntos_original)})</small>` : ''}<small> · peso ${Number(t.peso)}</small></span>` : '';
    const b = (a, txt, primario) => `<button type="button" class="${primario ? 'btn-save' : 'tk-btn'}" data-act="eq" data-arg="${a}" data-arg2="${t.tarea_id}">${escHtml(txt)}</button>`;
    const out = [];
    if (!lect) {
      if (t.soy_participante) {
        if (t.estado === 'asignada') out.push(b('t-empezar', 'Empezar'), b('t-avance', 'Registrar avance'), b('t-entregar', 'Entregar', true));
        if (t.estado === 'en_curso') out.push(b('t-avance', 'Registrar avance'), b('t-evidencia', 'Añadir evidencia'), b('t-entregar', 'Entregar', true), b('t-bloquear', 'Bloquear'));
        if (t.estado === 'devuelta') out.push(b('t-empezar', 'Retomar'), b('t-entregar', 'Entregar corregida', true));
        if (t.estado === 'bloqueada') out.push(b('t-desbloquear', 'Desbloquear', true));
      }
      if (t.puedo_revisar) {
        if (t.estado === 'entregada') out.push(b('t-aprobar', 'Aprobar', true), b('t-devolver', 'Devolver'));
        if (['asignada', 'en_curso', 'devuelta', 'bloqueada'].includes(t.estado)) out.push(b('t-prorrogar', 'Prorrogar'));
        if (!['aprobada', 'anulada'].includes(t.estado)) out.push(b('t-editar', 'Editar'), b('t-anular', 'Anular'));
        if (t.estado === 'bloqueada') out.push(b('t-desbloquear', 'Desbloquear'));
        if (!t.soy_participante) out.push(b('t-comentario', 'Comentar'));
      }
      if (S.esAdmin && t.estado === 'aprobada') {
        out.push(b('t-corregir', 'Corregir nota'), t.nota_anulada ? b('t-restaurar', 'Restaurar nota') : b('t-anularnota', 'Anular nota'), b('t-notaindiv', 'Nota individual'), b('t-reabrir', 'Reabrir'));
      }
      if (S.esAdmin && t.estado === 'anulada') out.push(b('t-reabrir', 'Reabrir'));
    }
    out.push(b('t-detalle', 'Detalle'));
    return `
      <article class="tk-card eq-tarea eq-tarea--${escHtml(t.estado)}" aria-label="${escHtml(t.titulo)}">
        <div class="tk-card-cab">
          <div class="tk-card-t">${escHtml(t.titulo)}</div>
          <span class="tk-pill tk-pill--${est.cls}">${escHtml(t.estado === 'entregada' && t.puedo_revisar ? 'Por revisar' : est.txt)}</span>
        </div>
        <p class="eq-tarea-meta"><span class="etiqueta etq-azul">Tarea de equipo</span>
          <span>${escHtml(t.equipo_nombre)}</span> · ${Tareas.plazoHTML(t)}
          ${t.prioridad !== 'normal' ? ` · Prioridad ${escHtml(PRIORIDAD[t.prioridad] || t.prioridad)}` : ''}</p>
        ${t.descripcion ? `<p class="tk-desc">${escHtml(t.descripcion)}</p>` : ''}
        ${barraAvance(t.avance)}
        <p class="eq-tarea-meta">${Number(t.participantes)} integrante${t.participantes === 1 ? '' : 's'} · ${Number(t.aportes)} aporte${t.aportes === 1 ? '' : 's'}${t.responsable_nombre ? ` · Seguimiento: ${escHtml(t.responsable_nombre)}` : ''}</p>
        ${t.estado === 'bloqueada' && t.bloqueo_motivo ? `<p class="tk-nota tk-nota--bloq"><strong>Bloqueada:</strong> ${escHtml(t.bloqueo_motivo)}</p>` : ''}
        ${t.revision_nota && ['devuelta', 'entregada', 'aprobada'].includes(t.estado) ? `<p class="tk-nota"><strong>Observación de quien revisa:</strong> ${escHtml(t.revision_nota)}</p>` : ''}
        ${t.entregada_en ? `<p class="eq-tarea-meta">Entregada por <b>${escHtml(t.entregada_por_nombre || '—')}</b> · ${escHtml(hora(t.entregada_en))}${t.entrega_url ? ` · <a href="${escHtml(t.entrega_url)}" target="_blank" rel="noopener noreferrer">enlace de la entrega</a>` : ''}</p>` : ''}
        ${nota}
        <div class="tk-acciones">${out.join('')}</div>
      </article>`;
  }

  /* ══ Carga ═══════════════════════════════════════════════════════════ */
  async function cargarTareas(equipoId = null) {
    const r = await API.getTareasEquipo({ equipoId, periodoId: equipoId ? null : S.periodoId });
    if (!r.ok) return r;
    S.tareas = r.tareas;
    return r;
  }

  /* ══ ADMIN: lista ════════════════════════════════════════════════════ */
  async function montarAdmin(host, { yo, periodos, personas, distritos = [], onCambio = null }) {
    if (S.host && S.host !== host && S.host.id) SNAP[S.host.id] = { ...S };
    Object.assign(S, { modo: 'admin', host, yo, esAdmin: true, periodos, distritos, onCambio, eqId: null,
      personas: new Map((personas || []).map(p => [p.id, p])) });
    const pe = v2();
    if (!pe.length) { host.innerHTML = `<div class="empty-box"><div class="empty-txt">Los equipos viven en los PE con la rúbrica por roles. Crea uno en Períodos.</div></div>`; return; }
    if (!pe.some(p => String(p.id) === String(S.periodoId))) S.periodoId = (pe.find(p => p.activo) || pe[pe.length - 1]).id;
    await listar();
  }

  async function listar() {
    renderCargando(S.host);
    const [r, m] = await Promise.all([API.getEquipos({ periodoId: S.periodoId }), API.getMiembrosVigentes()]);
    if (!r.ok) { if (r.noDisponible) S.host.innerHTML = noDisponibleHTML(); else renderError(S.host, r.error, listar); return; }
    S.equipos = r.equipos;
    // Las reglas de calificación del PE elegido, encima de la lista (editables solo por la administración).
    const per = S.periodos.find(p => String(p.id) === String(S.periodoId));
    const rg = document.getElementById('eq-reglas');
    if (per && rg && typeof EvaluacionPerfil !== 'undefined') EvaluacionPerfil.montarReglas(rg, { periodo: { ...per, pe: per.pe || per.nombre }, editable: true });
    S.miembros = new Map();
    for (const x of (m.ok ? m.filas : [])) { if (!S.miembros.has(x.equipo_id)) S.miembros.set(x.equipo_id, []); S.miembros.get(x.equipo_id).push(x.persona_id); }
    pintarLista();
  }

  function filtrados() {
    const q = norm(S.f.q);
    return S.equipos.filter(e => {
      if (S.f.estado && e.estado !== S.f.estado) return false;
      if (S.f.resp && e.responsable_id !== S.f.resp) return false;
      if (!q) return true;
      const gente = (S.miembros.get(e.equipo_id) || []).map(nom).join(' ');
      return norm(`${e.nombre} ${e.descripcion} ${e.responsable_nombre || ''} ${gente}`).includes(q);
    });
  }

  function pintarLista() {
    const pe = v2();
    const lista = filtrados();
    const resp = [...new Set(S.equipos.map(e => e.responsable_id).filter(Boolean))];
    S.host.innerHTML = `
      <div class="filtros-fila eq-filtros">
        <label class="eq-f"><span>PE</span>
          <select class="cfg-inp cfg-select" data-change="eqFiltrar" data-f="periodo" aria-label="PE">
            ${pe.map(p => `<option value="${escHtml(p.id)}"${String(p.id) === String(S.periodoId) ? ' selected' : ''}>${escHtml(p.pe || p.nombre)}</option>`).join('')}
          </select></label>
        <label class="eq-f eq-f--busca"><span>Buscar</span>
          <input class="cfg-inp" type="search" data-input="eqFiltrar" data-f="q" value="${escHtml(S.f.q)}" placeholder="Equipo, responsable o integrante" aria-label="Buscar equipos"></label>
        <label class="eq-f"><span>Estado</span>
          <select class="cfg-inp cfg-select" data-change="eqFiltrar" data-f="estado" aria-label="Estado del equipo">
            <option value="">Todos</option>${Object.entries(EST).map(([k, v]) => `<option value="${k}"${S.f.estado === k ? ' selected' : ''}>${v.txt}</option>`).join('')}
          </select></label>
        <label class="eq-f"><span>Responsable</span>
          <select class="cfg-inp cfg-select" data-change="eqFiltrar" data-f="resp" aria-label="Responsable">
            <option value="">Cualquiera</option>${resp.map(id => `<option value="${escHtml(id)}"${S.f.resp === id ? ' selected' : ''}>${escHtml(nom(id) || '—')}</option>`).join('')}
          </select></label>
      </div>
      <div class="eq-lista-cab"><span>${lista.length} equipo${lista.length === 1 ? '' : 's'}</span>
        ${soloLectura() ? '' : `<button type="button" class="btn-save" data-act="eq" data-arg="nuevo"><i data-lucide="plus" aria-hidden="true"></i>Nuevo equipo</button>`}</div>
      ${lista.length ? `<div class="eq-grid">${lista.map(tarjetaEquipoHTML).join('')}</div>`
        : `<div class="empty-box"><div class="empty-txt">${S.equipos.length ? 'Ningún equipo coincide con el filtro.' : 'Este PE todavía no tiene equipos. Crea el primero con «Nuevo equipo».'}</div></div>`}`;
    renderIconos(S.host);
  }

  function tarjetaEquipoHTML(e) {
    const est = EST[e.estado] || EST.activo;
    return `
      <button type="button" class="eq-card" data-act="eq" data-arg="abrir" data-arg2="${e.equipo_id}" aria-label="Abrir el equipo ${escHtml(e.nombre)}">
        <span class="eq-card-cab"><b class="eq-card-t">${escHtml(e.nombre)}</b><span class="etiqueta ${est.cls}">${est.txt}</span></span>
        <span class="eq-card-sub">${escHtml(e.periodo_nombre)}${e.distrito ? ' · ' + escHtml(/^distrito/i.test(e.distrito) ? e.distrito : 'Distrito ' + e.distrito) : ''}</span>
        <span class="eq-card-sub">${e.responsable_nombre ? 'Responsable: ' + escHtml(e.responsable_nombre) : 'Sin responsable'}</span>
        ${barraAvance(e.avance_promedio)}
        <span class="eq-card-pie">
          <span class="etiqueta etq-gris">${Number(e.integrantes)} integrante${e.integrantes === 1 ? '' : 's'}</span>
          <span class="etiqueta ${e.tareas_abiertas ? 'etq-azul' : 'etq-gris'}">${Number(e.tareas_abiertas)} abierta${e.tareas_abiertas === 1 ? '' : 's'}</span>
          ${e.tareas_por_revisar ? `<span class="etiqueta etq-ambar">${Number(e.tareas_por_revisar)} por revisar</span>` : ''}
          ${e.tareas_vencidas ? `<span class="etiqueta etq-coral">${Number(e.tareas_vencidas)} vencida${e.tareas_vencidas === 1 ? '' : 's'}</span>` : ''}
          ${e.alertas ? `<span class="etiqueta etq-coral">${Number(e.alertas)} por revisar</span>` : ''}
        </span>
      </button>`;
  }

  function filtrar(el) {
    usar(el.closest('#eq-host'));
    const f = el.dataset.f;
    if (f === 'periodo') { S.periodoId = el.value; listar(); return; }
    S.f[f] = el.value;
    if (f === 'q') {
      // No se repinta el buscador mientras se escribe (perdería el foco): solo la lista.
      const lista = filtrados();
      const cont = S.host.querySelector('.eq-grid, .empty-box');
      const cab = S.host.querySelector('.eq-lista-cab span');
      if (cab) cab.textContent = `${lista.length} equipo${lista.length === 1 ? '' : 's'}`;
      if (cont) cont.outerHTML = lista.length ? `<div class="eq-grid">${lista.map(tarjetaEquipoHTML).join('')}</div>` : `<div class="empty-box"><div class="empty-txt">Ningún equipo coincide con el filtro.</div></div>`;
      return;
    }
    pintarLista();
  }

  /* ══ ADMIN: formulario ═══════════════════════════════════════════════ */
  function formularioEquipo(e = null) {
    const pe = v2();
    const gente = [...S.personas.values()].filter(p => !p.es_admin).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    const campos = [
      { id: 'nombre', tipo: 'texto', label: 'Nombre del equipo', req: true, max: 80, valor: e?.nombre || '', ph: 'Cobertura de la Jornada' },
      { id: 'descripcion', tipo: 'area', label: 'Descripción', max: 1000, valor: e?.descripcion || '', ph: 'Qué hace este equipo en el PE' },
      e ? { tipo: 'info', texto: `PE: ${e.periodo_nombre}. Un equipo no cambia de PE: si hace falta, se archiva y se crea otro.` }
        : { id: 'periodo', tipo: 'select', label: 'PE', req: true, valor: String(S.periodoId), opciones: pe.map(p => ({ v: String(p.id), l: p.pe || p.nombre })) },
      { id: 'responsable', tipo: 'select', label: 'Responsable (opcional)', valor: e?.responsable_id || '', opciones: [{ v: '', l: 'Sin responsable' }, ...gente.map(p => ({ v: p.id, l: p.nombre || p.email }))] },
      { id: 'distrito', tipo: 'select', label: 'Ámbito (opcional)', valor: e?.distrito || '',
        ayuda: 'Si eliges un distrito, sus integrantes son de ese distrito (salvo una excepción explícita de la administración) y su secretaría puede revisar las tareas del equipo.',
        opciones: [{ v: '', l: 'Transversal (sin distrito)' }, ...S.distritos.map(d => ({ v: d.nombre ?? d, l: d.nombre ?? d }))] },
    ];
    Tareas.abrirModal({
      titulo: e ? 'Editar equipo' : 'Nuevo equipo', campos, confirmar: e ? 'Guardar cambios' : 'Crear equipo',
      onConfirm: async v => {
        if (!v.nombre || v.nombre.length < 2) return 'Escribe un nombre de al menos 2 caracteres.';
        const r = await API.guardarEquipo({ id: e?.equipo_id ?? null, periodoId: e ? null : v.periodo, nombre: v.nombre, descripcion: v.descripcion, responsableId: v.responsable, distrito: v.distrito });
        if (!r.ok) return r.error;
        showToast(e ? 'Equipo actualizado' : 'Equipo creado', 'ok');
        if (e) await abrir(e.equipo_id); else { S.periodoId = v.periodo || S.periodoId; await abrir(r.id); }
        return null;
      },
    });
  }

  /* ══ ADMIN/MIEMBRO: detalle de un equipo ═════════════════════════════ */
  async function abrir(id) {
    S.eqId = Number(id);
    renderCargando(S.host);
    const [r, ints, tars, res, evs] = await Promise.all([
      API.getEquipos({ periodoId: null }), API.getEquipoIntegrantes(S.eqId, { bajas: S.esAdmin }),
      API.getTareasEquipo({ equipoId: S.eqId }), API.getEquipoResultados(S.eqId),
      S.esAdmin ? API.getEquipoEventos(S.eqId) : Promise.resolve({ ok: true, eventos: [] }),
    ]);
    if (!r.ok) { S.host.innerHTML = r.noDisponible ? noDisponibleHTML() : ''; if (!r.noDisponible) renderError(S.host, r.error, () => abrir(id)); return; }
    S.equipos = r.equipos;
    S.integrantes = ints.ok ? ints.integrantes : [];
    S.tareas = tars.ok ? tars.tareas : [];
    S.resultados = res.ok ? res.filas : [];
    S.eventos = evs.ok ? evs.eventos : [];
    pintarDetalle();
  }

  function pintarDetalle() {
    const e = S.equipos.find(x => x.equipo_id === S.eqId);
    if (!e) { S.host.innerHTML = `<div class="empty-box"><div class="empty-txt">No se encontró ese equipo o no tienes acceso.</div></div>`; return; }
    const est = EST[e.estado] || EST.activo;
    const vigentes = S.integrantes.filter(i => !i.hasta);
    const bajas = S.integrantes.filter(i => i.hasta);
    const lect = soloLectura();
    const eq = S.resultados.find(r => r.persona_id == null);
    const yo = S.resultados.find(r => r.persona_id === S.yo);

    const integrantes = S.esAdmin
      ? (vigentes.length ? `<div class="roster">${vigentes.map(i => `
          <div class="eq-integrante">
            ${personaCardHTML({ id: i.persona_id, nombre: i.nombre, rol: i.rol_nombre, distrito: i.distrito, valor: null, estado: i.es_responsable ? 'Responsable' : 'Integrante',
              chips: [...(i.alerta ? [{ txt: ALERTA[i.alerta] || i.alerta, aviso: true }] : []), ...(i.excepcion ? [{ txt: 'Excepción de ámbito' }] : [])] })}
            ${lect || e.estado === 'archivado' ? '' : `<button type="button" class="tk-btn eq-retirar" data-act="eq" data-arg="retirar" data-arg2="${escHtml(i.persona_id)}">Retirar</button>`}
          </div>`).join('')}</div>` : `<div class="empty-box"><div class="empty-txt">Este equipo todavía no tiene integrantes.</div></div>`)
      : `<ul class="eq-pers-lista">${vigentes.map(i => avatarChip(i.nombre, i.es_responsable ? ' <small>· responsable</small>' : '')).join('')}</ul>`;

    S.host.innerHTML = `
      <div class="eq-detalle">
        <div class="eq-detalle-cab">
          <button type="button" class="tk-btn" data-act="eq" data-arg="${S.modo === 'admin' ? 'lista' : S.modo === 'tareas' ? 'lista-tareas' : 'lista-miembro'}"><i data-lucide="arrow-left" aria-hidden="true"></i>Volver</button>
          <div>
            <h2 class="eq-detalle-t">${escHtml(e.nombre)} <span class="etiqueta ${est.cls}">${est.txt}</span></h2>
            <p class="eq-card-sub">${escHtml(e.periodo_nombre)}${e.distrito ? ' · Ámbito: ' + escHtml(e.distrito) : ' · Transversal'} · ${e.responsable_nombre ? 'Responsable: ' + escHtml(e.responsable_nombre) : 'Sin responsable'}</p>
            ${e.descripcion ? `<p class="tk-desc">${escHtml(e.descripcion)}</p>` : ''}
          </div>
          ${S.esAdmin && !lect ? `<div class="eq-detalle-acc">
            <button type="button" class="tk-btn" data-act="eq" data-arg="editar">Editar</button>
            ${e.estado === 'activo' ? `<button type="button" class="tk-btn" data-act="eq" data-arg="miembros">Añadir integrantes</button>
              <button type="button" class="btn-save" data-act="eq" data-arg="nueva-tarea">Nueva tarea de equipo</button>` : ''}
            <button type="button" class="tk-btn" data-act="eq" data-arg="estado">Cambiar estado</button>
          </div>` : ''}
        </div>

        <div class="pf-kpis eq-kpis">
          <div class="pf-kpi"><div class="pf-kpi-lbl">Integrantes</div><div class="pf-kpi-val"><span>${vigentes.length}</span></div></div>
          <div class="pf-kpi"><div class="pf-kpi-lbl">Tareas abiertas</div><div class="pf-kpi-val"><span>${Number(e.tareas_abiertas)}</span></div><div class="pf-kpi-sub">${Number(e.tareas_por_revisar)} por revisar · ${Number(e.tareas_vencidas)} vencidas</div></div>
          <div class="pf-kpi"><div class="pf-kpi-lbl">Avance</div><div class="pf-kpi-val"><span>${e.avance_promedio == null ? '—' : Number(e.avance_promedio)}</span>${e.avance_promedio == null ? '' : '<small>%</small>'}</div></div>
          <div class="pf-kpi"><div class="pf-kpi-lbl">Nota del equipo</div><div class="pf-kpi-val"><span>${eq?.nota == null ? '—' : fmtNum(eq.nota, 1)}</span>${eq?.nota == null ? '' : '<small>/100</small>'}</div>
            <div class="pf-kpi-sub">${eq ? `${Number(eq.tareas_cuentan)} de ${Number(eq.tareas_total)} tareas calificadas` : ''}</div></div>
        </div>

        <section class="pf-card eq-sec" aria-labelledby="eq-h-int"><h3 class="pf-h" id="eq-h-int">Integrantes</h3>${integrantes}
          ${S.esAdmin && bajas.length ? `<details class="v2-det"><summary>Salieron del equipo (${bajas.length})</summary>
            <ul class="eq-pers-lista">${bajas.map(i => `<li class="eq-pers"><span>${escHtml(i.nombre)} <small>· ${escHtml(hora(i.desde))} → ${escHtml(hora(i.hasta))}${i.motivo_retiro ? ' · ' + escHtml(i.motivo_retiro) : ''}</small></span></li>`).join('')}</ul></details>` : ''}
        </section>

        <section class="pf-card eq-sec" aria-labelledby="eq-h-tar"><h3 class="pf-h" id="eq-h-tar">Tareas del equipo</h3>
          ${S.tareas.length ? `<div class="tk-lista">${S.tareas.map(tareaHTML).join('')}</div>` : `<div class="empty-box"><div class="empty-txt">Todavía no hay tareas colectivas para este equipo.</div></div>`}
          <p class="pf-nota">Una tarea del equipo es <strong>una sola</strong> para todos los integrantes. Su nota entra en la evaluación de cada persona según las reglas del PE (cada tarea cuenta una vez por persona).</p>
        </section>

        ${S.resultados.length > 1 || (yo && !eq) ? `<section class="pf-card eq-sec" aria-labelledby="eq-h-res"><h3 class="pf-h" id="eq-h-res">Lo que aportan las tareas a cada persona</h3>
          <div class="v2-tabla-wrap"><table class="v2-tabla"><caption class="sr-only">Notas por persona en las tareas de este equipo</caption>
            <thead><tr><th scope="col">Persona</th><th scope="col">Tareas que cuentan</th><th scope="col">Nota en este equipo</th></tr></thead>
            <tbody>${S.resultados.filter(r => r.persona_id).map(r => `<tr><td class="v2-nom">${escHtml(r.nombre)}${r.persona_id === S.yo ? ' <small>(tú)</small>' : ''}</td>
              <td>${Number(r.tareas_cuentan)} de ${Number(r.tareas_total)}${r.con_nota_individual ? ` <small>· ${Number(r.con_nota_individual)} con nota individual</small>` : ''}</td>
              <td class="v2-tot">${r.nota == null ? '—' : fmtNum(r.nota, 1)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}

        ${S.esAdmin ? `<section class="pf-card eq-sec" aria-labelledby="eq-h-his"><h3 class="pf-h" id="eq-h-his">Historial de cambios</h3>
          ${S.eventos.length ? `<ul class="eq-hist">${S.eventos.map(ev => `<li><span class="eq-hist-f">${escHtml(hora(ev.created_at))}</span> <b>${escHtml(etiquetaEvento(ev))}</b>
            ${ev.persona_id ? ' · ' + escHtml(nom(ev.persona_id) || 'persona') : ''}${ev.motivo ? ' — ' + escHtml(ev.motivo) : ''}</li>`).join('')}</ul>` : '<p class="pf-vacio">Sin cambios registrados.</p>'}</section>` : ''}
      </div>`;
    renderIconos(S.host);
  }

  function etiquetaEvento(ev) {
    const d = ev.detalle || {};
    switch (ev.tipo) {
      case 'creado': return 'Equipo creado';
      case 'editado': return 'Datos editados';
      case 'estado': return `Estado: ${(EST[d.de] || {}).txt || d.de} → ${(EST[d.a] || {}).txt || d.a}`;
      case 'responsable': return 'Cambió el responsable';
      case 'ambito': return 'Cambió el ámbito';
      case 'miembro_alta': return d.excepcion ? 'Se incorporó (excepción de ámbito)' : 'Se incorporó';
      case 'miembro_baja': return 'Salió del equipo';
      case 'alerta': return d.causa === 'cambio_distrito' ? `Cambió de distrito (${d.de || '—'} → ${d.a || '—'}): revisar su lugar en el equipo` : 'Dejó de participar en el PE: revisar su lugar en el equipo';
      default: return ev.tipo;
    }
  }

  /* ══ ADMIN: composición y estado ═════════════════════════════════════ */
  async function modalMiembros() {
    const e = S.equipos.find(x => x.equipo_id === S.eqId); if (!e) return;
    const ya = new Set(S.integrantes.filter(i => !i.hasta).map(i => i.persona_id));
    const personas = [...S.personas.values()].filter(p => !p.es_admin && !ya.has(p.id)).map(p => Selector.persona({ id: p.id, nombre: p.nombre || p.email, distrito: p.distrito, rol_nombre: p.rol_nombre || p.rol }));
    Selector.soltar('eq-miembros');
    const sel = Selector.crear({ id: 'eq-miembros', personas, equipos: [], seleccion: [] });
    Tareas.abrirModal({
      titulo: `Añadir integrantes a «${e.nombre}»`,
      campos: [
        { tipo: 'info', texto: 'Solo entran personas con acceso aprobado que participan en este PE. Quien ya es integrante no se repite.' },
        { tipo: 'html', html: '<div id="eq-sel-host"></div>' },
        ...(e.distrito ? [{ id: 'exc', tipo: 'texto', label: 'Excepción de ámbito (opcional)', max: 300, ph: 'Motivo, si eliges a alguien de otro distrito', ayuda: `El equipo es del distrito ${e.distrito}. Para incorporar a alguien de otro distrito escribe el motivo: queda registrado.` }] : []),
      ],
      confirmar: 'Añadir',
      onConfirm: async v => {
        const ids = sel.seleccion();
        if (!ids.length) return 'Elige al menos una persona.';
        const r = await API.agregarMiembrosEquipo(S.eqId, ids, { excepcion: !!v.exc, motivo: v.exc || null });
        if (!r.ok) return r.error;
        const om = r.omitidos.map(o => `${nom(o.persona) || 'Una persona'}: ${OMITIDO[o.razon] || o.razon}`);
        showToast(`${r.agregados.length} añadid${r.agregados.length === 1 ? 'a' : 'as'}${om.length ? ` · no entraron: ${om.join('; ')}` : ''}`, om.length ? 'info' : 'ok');
        await abrir(S.eqId);
        return null;
      },
    });
    const host = document.getElementById('eq-sel-host');
    if (host) { sel.montar(host); renderIconos(host); }
  }

  function modalRetirar(personaId) {
    const n = S.integrantes.find(i => i.persona_id === personaId)?.nombre || 'la persona';
    Tareas.abrirModal({
      titulo: `Retirar a ${n}`,
      campos: [
        { tipo: 'info', texto: 'Deja de participar en las tareas abiertas del equipo. Lo ya hecho y las notas se conservan; si aportó algo, sigue contando. Queda en el historial.' },
        { id: 'motivo', tipo: 'area', label: 'Motivo', req: true, filas: 2, max: 500 },
      ],
      confirmar: 'Retirar',
      onConfirm: async v => {
        if ((v.motivo || '').length < 5) return 'Explica el motivo (mínimo 5 caracteres).';
        const r = await API.retirarMiembroEquipo(S.eqId, personaId, v.motivo);
        if (!r.ok) return r.error;
        showToast('Integrante retirado', 'ok');
        await abrir(S.eqId);
        return null;
      },
    });
  }

  function modalEstado() {
    const e = S.equipos.find(x => x.equipo_id === S.eqId); if (!e) return;
    const destinos = { activo: ['inactivo', 'archivado'], inactivo: ['activo', 'archivado'], archivado: ['inactivo'] }[e.estado] || [];
    Tareas.abrirModal({
      titulo: 'Cambiar el estado del equipo',
      campos: [
        { tipo: 'info', texto: 'Desactivar o archivar NO borra nada: el historial, las tareas y las notas se conservan. Un equipo inactivo no recibe tareas ni integrantes; para archivarlo no deben quedar tareas abiertas.' },
        { id: 'estado', tipo: 'select', label: 'Nuevo estado', valor: destinos[0], opciones: destinos.map(d => ({ v: d, l: EST[d].txt })) },
        { id: 'motivo', tipo: 'area', label: 'Motivo (obligatorio al archivar)', filas: 2, max: 500 },
      ],
      confirmar: 'Cambiar estado',
      onConfirm: async v => {
        const r = await API.cambiarEstadoEquipo(S.eqId, v.estado, v.motivo || null);
        if (!r.ok) return r.error;
        showToast('Estado actualizado', 'ok');
        await abrir(S.eqId);
        return null;
      },
    });
  }

  /* ══ Tareas colectivas: nueva y acciones ═════════════════════════════ */
  function modalNuevaTarea() {
    const e = S.equipos.find(x => x.equipo_id === S.eqId); if (!e) return;
    const crit = (Store.get('criteriosV2') || []);
    const part = S.integrantes.filter(i => !i.hasta);
    Tareas.abrirModal({
      titulo: `Nueva tarea para «${e.nombre}»`,
      campos: [
        { tipo: 'info', texto: `Una sola tarea para todo el equipo (${part.length} integrante${part.length === 1 ? '' : 's'}): todos la ven desde su cuenta.` },
        { id: 'titulo', tipo: 'texto', label: 'Título', req: true, max: 160 },
        { id: 'descripcion', tipo: 'area', label: 'Descripción', filas: 3, max: 4000 },
        { id: 'instrucciones', tipo: 'area', label: 'Instrucciones', filas: 3, max: 4000, ph: 'Paso a paso, material de apoyo…' },
        { id: 'criterios_evaluacion', tipo: 'area', label: 'Criterios de evaluación', filas: 2, max: 2000, ph: 'Qué se va a mirar al calificar' },
        { id: 'fecha_limite', tipo: 'fecha', label: 'Fecha límite' },
        { id: 'prioridad', tipo: 'select', label: 'Prioridad', valor: 'normal', opciones: [{ v: 'baja', l: 'Baja' }, { v: 'normal', l: 'Normal' }, { v: 'alta', l: 'Alta' }] },
        { id: 'peso', tipo: 'select', label: 'Peso de esta tarea en la nota', valor: '1', ayuda: 'Cuánto pesa frente a otras tareas al promediar. Las reglas del PE lo combinan con el tipo de tarea.', opciones: ['1', '2', '3', '5'].map(x => ({ v: x, l: x })) },
        { id: 'responsable', tipo: 'select', label: 'Responsable de seguimiento (opcional)', valor: '', opciones: [{ v: '', l: 'Sin responsable' }, ...part.map(i => ({ v: i.persona_id, l: i.nombre }))] },
        ...(crit.length ? [{ id: 'criterios', tipo: 'checks', label: 'Criterios que evidencia (orientativo)', opciones: crit.filter(c => c.activo !== false).map(c => ({ v: c.key, l: c.nombre })) }] : []),
      ],
      confirmar: 'Asignar al equipo',
      onConfirm: async v => {
        if (!v.titulo) return 'Escribe un título.';
        const r = await API.crearTareaEquipo({ equipo_id: S.eqId, titulo: v.titulo, descripcion: v.descripcion, instrucciones: v.instrucciones, criterios_evaluacion: v.criterios_evaluacion,
          criterios: v.criterios || [], prioridad: v.prioridad, fecha_limite: v.fecha_limite, responsable_id: v.responsable, peso: Number(v.peso) });
        if (!r.ok) return r.error;
        showToast('Tarea asignada al equipo', 'ok');
        await abrir(S.eqId);
        return null;
      },
    });
  }

  const tarea = id => S.tareas.find(t => String(t.tarea_id) === String(id));

  /** Aplica un cambio de la tarea; devuelve el texto de error de la base o null. */
  async function cambiar(id, patch, ok) {
    const r = await API.actualizarTareaEquipo(Number(id), patch);
    if (!r.ok) return r.error;
    showToast(ok, 'ok');
    await refrescar();
    return null;
  }

  async function refrescar() {
    if (S.modo === 'tareas' && !S.eqId) await recargarTareas();
    else if (S.modo === 'admin' || S.eqId) { if (S.eqId) await abrir(S.eqId); else await listar(); }
    else await recargarMiembro();
    S.onCambio?.();
  }

  async function accionTarea(a, id) {
    const t = tarea(id); if (!t && a !== 't-detalle') return;
    const m = (titulo, campos, confirmar, onConfirm) => Tareas.abrirModal({ titulo, campos, confirmar, onConfirm });
    const motivo = (label = 'Motivo', min = 5) => ({ id: 'motivo', tipo: 'area', label, req: true, filas: 2, max: 500, ph: `Mínimo ${min} caracteres` });
    const largo = (v, min = 5) => (v.motivo || '').length >= min ? null : `Escribe el motivo (mínimo ${min} caracteres).`;

    switch (a) {
      case 't-empezar':    return void await cambiar(id, { estado: 'en_curso' }, 'Tarea en curso');
      case 't-desbloquear': return void await cambiar(id, { estado: 'en_curso' }, 'Tarea desbloqueada');
      case 't-bloquear':
        return m('Bloquear la tarea', [{ tipo: 'info', texto: 'Una tarea bloqueada espera a un tercero y no cuenta como atraso.' }, motivo('¿Qué la bloquea?', 3)], 'Bloquear',
          v => largo(v, 3) || cambiar(id, { estado: 'bloqueada', bloqueo_motivo: v.motivo }, 'Tarea bloqueada'));
      case 't-avance':
        return m('Registrar avance', [
          { tipo: 'info', texto: 'Tu avance queda a tu nombre. La tarea no se da por terminada hasta que alguien del equipo la ENTREGA.' },
          { id: 'avance', tipo: 'texto', label: 'Avance del equipo (0 a 100 %)', req: true, max: 3, valor: String(t.avance ?? 0) },
          { id: 'nota', tipo: 'area', label: 'Qué se avanzó', filas: 2, max: 2000 }], 'Registrar',
          async v => { const n = Number(v.avance); if (!Number.isInteger(n) || n < 0 || n > 100) return 'El avance es un número entero de 0 a 100.';
            const r = await API.aportarTareaEquipo(Number(id), { tipo: 'avance', nota: v.nota, avance: n }); if (!r.ok) return r.error; showToast('Avance registrado', 'ok'); await refrescar(); return null; });
      case 't-evidencia':
        return m('Añadir evidencia', [{ id: 'url', tipo: 'texto', label: 'Enlace (https://…)', max: 2000 }, { id: 'nota', tipo: 'area', label: 'Nota', filas: 2, max: 2000 }], 'Añadir',
          async v => { if (!v.url && !v.nota) return 'Indica un enlace o escribe una nota.';
            const r = await API.aportarTareaEquipo(Number(id), { tipo: 'evidencia', nota: v.nota, url: v.url }); if (!r.ok) return r.error; showToast('Evidencia añadida', 'ok'); await refrescar(); return null; });
      case 't-comentario':
        return m('Comentar la tarea', [{ id: 'nota', tipo: 'area', label: 'Observación para el equipo', req: true, filas: 3, max: 2000 }], 'Publicar',
          async v => { if (!v.nota) return 'Escribe el comentario.';
            const r = await API.aportarTareaEquipo(Number(id), { tipo: 'comentario', nota: v.nota }); if (!r.ok) return r.error; showToast('Comentario publicado', 'ok'); await refrescar(); return null; });
      case 't-entregar':
        return m(t.estado === 'devuelta' ? 'Entregar corregida' : 'Entregar la tarea del equipo', [
          { tipo: 'info', texto: 'Queda registrado que entregas tú, cuándo y con qué evidencia. Esta entrega vale para todo el equipo.' },
          { id: 'url', tipo: 'texto', label: 'Enlace de la entrega (https://…)', max: 2000 },
          { id: 'nota', tipo: 'area', label: 'Nota de la entrega', filas: 3, max: 2000 }], 'Entregar',
          v => (v.url || (v.nota || '').length >= 3) ? cambiar(id, { estado: 'entregada', entrega_url: v.url || null, entrega_nota: v.nota || null }, 'Tarea entregada') : 'Indica un enlace o escribe una nota de la entrega.');
      case 't-aprobar':
        return m('Aprobar la tarea del equipo', [
          { tipo: 'info', texto: `«${t.titulo}». Esta nota es del GRUPO: cada integrante la recibe una vez. Cuenta en la evaluación de cada persona según las reglas del PE.` },
          { id: 'puntos', tipo: 'puntos', label: 'Puntos (0–10)', req: true, valor: 8 },
          { id: 'peso', tipo: 'select', label: 'Peso de la tarea', valor: String(t.peso), opciones: ['1', '2', '3', '5'].map(x => ({ v: x, l: x })) }], 'Aprobar',
          v => { const n = Number(v.puntos); if (v.puntos === '' || !Number.isInteger(n) || n < 0 || n > 10) return 'Elige unos puntos entre 0 y 10.';
            return cambiar(id, { estado: 'aprobada', puntos: n, peso: Number(v.peso) }, `Aprobada con ${n} puntos`); });
      case 't-devolver':
        return m('Devolver con correcciones', [{ id: 'motivo', tipo: 'area', label: 'Qué hay que corregir', req: true, filas: 3, max: 2000 }], 'Devolver',
          v => largo(v, 3) || cambiar(id, { estado: 'devuelta', revision_nota: v.motivo }, 'Tarea devuelta'));
      case 't-prorrogar':
        return m('Prorrogar la fecha límite', [{ id: 'fecha', tipo: 'fecha', label: 'Nueva fecha', req: true, valor: t.fecha_limite || '' }, motivo('Motivo de la prórroga')], 'Prorrogar',
          async v => { if (!v.fecha) return 'Elige la nueva fecha.'; const e = largo(v); if (e) return e;
            const r = await API.prorrogarTareaEquipo(Number(id), v.fecha, v.motivo); if (!r.ok) return r.error; showToast('Plazo actualizado', 'ok'); await refrescar(); return null; });
      case 't-anular':
        return m('Anular la tarea', [{ tipo: 'info', texto: 'Una tarea anulada queda fuera de todo cómputo (no cuenta ni como pendiente). Se conserva en el historial.' }, motivo('Motivo de la anulación')], 'Anular',
          v => largo(v) || cambiar(id, { estado: 'anulada', anulacion_motivo: v.motivo }, 'Tarea anulada'));
      case 't-reabrir':
        return m('Reabrir la tarea', [{ tipo: 'info', texto: 'Reabrir una aprobada borra su nota vigente (el historial de notas la conserva).' },
          { id: 'estado', tipo: 'select', label: 'Dejarla en', valor: 'entregada', opciones: [{ v: 'entregada', l: 'Entregada (por revisar)' }, { v: 'en_curso', l: 'En curso' }, { v: 'asignada', l: 'Asignada' }] }], 'Reabrir',
          v => cambiar(id, { estado: v.estado }, 'Tarea reabierta'));
      case 't-editar':
        return m('Editar la tarea', [
          { id: 'titulo', tipo: 'texto', label: 'Título', req: true, max: 160, valor: t.titulo },
          { id: 'descripcion', tipo: 'area', label: 'Descripción', filas: 3, max: 4000, valor: t.descripcion },
          { id: 'instrucciones', tipo: 'area', label: 'Instrucciones', filas: 3, max: 4000, valor: t.instrucciones },
          { id: 'criterios_evaluacion', tipo: 'area', label: 'Criterios de evaluación', filas: 2, max: 2000, valor: t.criterios_evaluacion },
          { id: 'prioridad', tipo: 'select', label: 'Prioridad', valor: t.prioridad, opciones: [{ v: 'baja', l: 'Baja' }, { v: 'normal', l: 'Normal' }, { v: 'alta', l: 'Alta' }] },
          { id: 'peso', tipo: 'select', label: 'Peso', valor: String(Number(t.peso)), opciones: ['1', '2', '3', '5'].map(x => ({ v: x, l: x })) }], 'Guardar',
          v => v.titulo ? cambiar(id, { titulo: v.titulo, descripcion: v.descripcion, instrucciones: v.instrucciones, criterios_evaluacion: v.criterios_evaluacion, prioridad: v.prioridad, peso: Number(v.peso) }, 'Tarea actualizada') : 'Escribe un título.');
      case 't-corregir':
        return m('Corregir la nota', [{ tipo: 'info', texto: `Nota actual ${t.puntos}/10${t.puntos_original != null ? ` (original ${t.puntos_original})` : ''}. Toda corrección queda en el historial con su justificación; las notas de las personas se recalculan.` },
          { id: 'puntos', tipo: 'puntos', label: 'Puntos (0–10)', req: true, valor: t.puntos }, motivo('Justificación')], 'Corregir',
          async v => { if (v.puntos === '') return 'Elige los puntos.'; const e = largo(v); if (e) return e;
            const r = await API.corregirNota('equipo', Number(id), Number(v.puntos), v.motivo); if (!r.ok) return r.error; showToast('Nota corregida', 'ok'); await refrescar(); return null; });
      case 't-anularnota': case 't-restaurar':
        return m(a === 't-anularnota' ? 'Anular la nota' : 'Restaurar la nota',
          [{ tipo: 'info', texto: a === 't-anularnota' ? 'La tarea sigue aprobada pero su nota deja de contar para todas las personas (sale del numerador y del denominador).' : 'La nota vuelve a contar.' }, motivo('Justificación')],
          a === 't-anularnota' ? 'Anular nota' : 'Restaurar',
          async v => { const e = largo(v); if (e) return e;
            const r = await (a === 't-anularnota' ? API.anularNota : API.restaurarNota)('equipo', Number(id), v.motivo); if (!r.ok) return r.error; showToast('Nota actualizada', 'ok'); await refrescar(); return null; });
      case 't-notaindiv': {
        const p = await API.getParticipacionTareaEquipo(Number(id));
        const filas = p.ok ? p.filas : [];
        return m('Nota individual dentro del grupo', [
          { tipo: 'info', texto: 'Por defecto cada integrante recibe la nota del grupo. Solo si hay evidencia de una participación distinta, ponle una nota individual (queda registrada con su justificación). Deja «Sin nota individual» para volver a la del grupo.' },
          { id: 'persona', tipo: 'select', label: 'Integrante', valor: filas[0]?.persona_id || '', opciones: filas.map(f => ({ v: f.persona_id, l: `${f.nombre}${f.puntos_individual != null ? ` (individual ${f.puntos_individual})` : ''}` })) },
          { id: 'puntos', tipo: 'select', label: 'Nota individual', valor: '', opciones: [{ v: '', l: 'Sin nota individual (vale la del grupo)' }, ...Array.from({ length: 11 }, (_, n) => ({ v: String(n), l: `${n} / 10` }))] },
          motivo('Evidencia o motivo (mínimo 10 caracteres)', 10)], 'Guardar',
          async v => { if (!v.persona) return 'Elige al integrante.'; const e = largo(v, 10); if (e) return e;
            const r = await API.notaIndividualEquipo(Number(id), v.persona, v.puntos === '' ? null : Number(v.puntos), v.motivo); if (!r.ok) return r.error; showToast('Nota individual registrada', 'ok'); await refrescar(); return null; });
      }
      case 't-detalle': return detalleTarea(id);
    }
  }

  async function detalleTarea(id) {
    const t = tarea(id);
    const [p, ap, ev, hn] = await Promise.all([API.getParticipacionTareaEquipo(Number(id)), API.getAportesTareaEquipo(Number(id)), API.getEventosTareaEquipo(Number(id)), API.getHistorialNotas('equipo', Number(id))]);
    const porId = new Map((p.ok ? p.filas : []).map(f => [f.persona_id, f.nombre]));
    const quien = u => porId.get(u) || nom(u) || '—';
    const ETIQ = { creada: 'Creada', estado: 'Cambio de estado', prorroga: 'Plazo movido', responsable: 'Cambió el seguimiento', instrucciones: 'Instrucciones actualizadas', contenido: 'Contenido editado', participante_alta: 'Se sumó a la tarea', participante_baja: 'Dejó la tarea', aporte: 'Aporte' };
    const ACC = { calificada: 'Calificada', corregida: 'Nota corregida', anulada: 'Nota anulada', restaurada: 'Nota restaurada', reabierta: 'Reabierta', tarea_anulada: 'Tarea anulada', individual: 'Nota individual', individual_retirada: 'Nota individual retirada' };
    const html = `
      ${t?.instrucciones ? `<h4 class="pf-sub">Instrucciones</h4><p class="tk-desc">${escHtml(t.instrucciones)}</p>` : ''}
      ${t?.criterios_evaluacion ? `<h4 class="pf-sub">Criterios de evaluación</h4><p class="tk-desc">${escHtml(t.criterios_evaluacion)}</p>` : ''}
      <h4 class="pf-sub">Participación</h4>
      ${p.ok && p.filas.length ? `<ul class="eq-pers-lista">${p.filas.map(f => `<li class="eq-pers"><span>${escHtml(f.nombre)}${f.es_responsable ? ' <small>· seguimiento</small>' : ''}${f.entrego ? ' <small>· entregó</small>' : ''}${f.hasta ? ' <small>· salió</small>' : ''}
        — ${Number(f.aportes)} aporte${f.aportes === 1 ? '' : 's'}${f.ultimo_aporte ? ' · último ' + escHtml(hora(f.ultimo_aporte)) : ''}${f.puntos_individual != null ? ` · <b>nota individual ${Number(f.puntos_individual)}</b>` : ''}</span></li>`).join('')}</ul>` : '<p class="pf-vacio">Sin datos.</p>'}
      <h4 class="pf-sub">Aportes</h4>
      ${ap.ok && ap.aportes.length ? `<ul class="eq-hist">${ap.aportes.map(a => `<li><span class="eq-hist-f">${escHtml(hora(a.created_at))}</span> <b>${escHtml(quien(a.persona_id))}</b> · ${escHtml(a.tipo)}${a.avance != null ? ' ' + Number(a.avance) + ' %' : ''}${a.nota ? ' — ' + escHtml(a.nota) : ''}${a.url ? ` — <a href="${escHtml(a.url)}" target="_blank" rel="noopener noreferrer">enlace</a>` : ''}</li>`).join('')}</ul>` : '<p class="pf-vacio">Nadie ha aportado todavía.</p>'}
      <h4 class="pf-sub">Historial de la tarea</h4>
      ${ev.ok && ev.eventos.length ? `<ul class="eq-hist">${ev.eventos.map(e => `<li><span class="eq-hist-f">${escHtml(hora(e.created_at))}</span> <b>${escHtml(ETIQ[e.tipo] || e.tipo)}</b>${e.de || e.a ? ` · ${escHtml(e.de || '')}${e.de && e.a ? ' → ' : ''}${escHtml(e.tipo === 'responsable' ? '' : (e.a || ''))}` : ''}${e.motivo ? ' — ' + escHtml(e.motivo) : ''}</li>`).join('')}</ul>` : '<p class="pf-vacio">Sin eventos.</p>'}
      <h4 class="pf-sub">Historial de la nota</h4>
      ${hn.ok && hn.filas.length ? `<ul class="eq-hist">${hn.filas.map(h => `<li><span class="eq-hist-f">${escHtml(hora(h.created_at))}</span> <b>${escHtml(ACC[h.accion] || h.accion)}</b>${h.persona_id ? ' · ' + escHtml(quien(h.persona_id)) : ' · grupo'}
        ${h.puntos_anterior != null || h.puntos_nuevo != null ? ` · ${h.puntos_anterior ?? '—'} → ${h.puntos_nuevo ?? '—'}` : ''}${h.motivo ? ' — ' + escHtml(h.motivo) : ''}${h.contexto?.peso_tareas_pct != null ? ` <small>(peso de tareas del PE ${Number(h.contexto.peso_tareas_pct)} %, de la tarea ${Number(h.contexto.peso_tarea)})</small>` : ''}</li>`).join('')}</ul>` : '<p class="pf-vacio">Aún sin calificación.</p>'}`;
    Tareas.abrirModal({ titulo: t?.titulo || 'Tarea del equipo', campos: [{ tipo: 'html', html }], sinConfirmar: true, onConfirm: async () => null });
  }

  /* ══ MIEMBRO / SECRETARÍA: «Mis equipos» ═════════════════════════════ */
  async function montarMiembro(host, { periodoId, yo, periodos = [], esSecretaria = false }) {
    if (S.host && S.host !== host && S.host.id) SNAP[S.host.id] = { ...S };
    Object.assign(S, { modo: esSecretaria ? 'secretaria' : 'miembro', host, yo, esAdmin: false, periodoId, periodos, eqId: null, personas: new Map() });
    await recargarMiembro();
  }

  async function recargarMiembro() {
    const host = S.host; if (!host) return;
    S.eqId = null;
    const per = (S.periodos || []).find(p => String(p.id) === String(S.periodoId));
    if (per && typeof esPeriodoV2 === 'function' && !esPeriodoV2(per)) { host.innerHTML = ''; return; }   // los PE anteriores no tienen equipos
    const [r, t] = await Promise.all([API.getEquipos({ periodoId: S.periodoId }), API.getTareasEquipo({ periodoId: S.periodoId })]);
    if (!r.ok) { host.innerHTML = r.noDisponible ? '' : `<div class="empty-box" role="alert"><div class="empty-txt">No se pudieron cargar tus equipos: ${escHtml(r.error)}</div></div>`; return; }
    S.equipos = r.equipos;
    S.tareas = t.ok ? t.tareas : [];
    if (!S.equipos.length) { host.innerHTML = ''; return; }          // sin equipos no hay nada que mostrar
    host.innerHTML = `
      <section class="eq-miembro" aria-labelledby="eq-h-mis">
        <h3 class="pf-h" id="eq-h-mis">${S.modo === 'secretaria' ? 'Equipos' : 'Mis equipos'}</h3>
        <div class="eq-grid">${S.equipos.map(e => `
          <button type="button" class="eq-card" data-act="eq" data-arg="abrir-miembro" data-arg2="${e.equipo_id}" aria-label="Abrir el equipo ${escHtml(e.nombre)}">
            <span class="eq-card-cab"><b class="eq-card-t">${escHtml(e.nombre)}</b><span class="etiqueta ${(EST[e.estado] || EST.activo).cls}">${(EST[e.estado] || EST.activo).txt}</span></span>
            <span class="eq-card-sub">${e.responsable_nombre ? 'Responsable: ' + escHtml(e.responsable_nombre) : 'Sin responsable'} · ${Number(e.integrantes)} integrantes</span>
            ${barraAvance(e.avance_promedio)}
            <span class="eq-card-pie"><span class="etiqueta ${e.tareas_abiertas ? 'etq-azul' : 'etq-gris'}">${Number(e.tareas_abiertas)} abierta${e.tareas_abiertas === 1 ? '' : 's'}</span>
              ${e.tareas_vencidas ? `<span class="etiqueta etq-coral">${Number(e.tareas_vencidas)} vencida${e.tareas_vencidas === 1 ? '' : 's'}</span>` : ''}</span>
          </button>`).join('')}</div>
        ${S.tareas.length ? `<h4 class="pf-sub">Tareas de equipo</h4><div class="tk-lista">${S.tareas.map(tareaHTML).join('')}</div>` : ''}
      </section>`;
    renderIconos(host);
  }


  /* ══ SECCIÓN «TAREAS DE EQUIPO» (pestaña Tareas de administración y secretaría) ═══════════════════
   * Todas las tareas colectivas del PE, agrupadas por equipo, con los mismos botones que el detalle del equipo.
   * Lo que ve cada quien lo decide la base (administración: todas; secretaría: las de su distrito...). */
  async function montarTareas(host, { periodoId, yo, esAdmin = false, periodos = [], personas = [], onCambio = null }) {
    if (S.host && S.host !== host && S.host.id) SNAP[S.host.id] = { ...S };
    Object.assign(S, { modo: 'tareas', host, yo, esAdmin, periodoId, periodos, eqId: null, onCambio,
      personas: new Map((personas || []).map(p => [p.id, p])) });
    await recargarTareas();
  }

  async function recargarTareas() {
    const host = S.host; if (!host) return;
    const per = (S.periodos || []).find(p => String(p.id) === String(S.periodoId));
    if (per && !(typeof esPeriodoV2 === 'function' ? esPeriodoV2(per) : per.modelo === 'v2')) {
      host.innerHTML = `<div class="empty-box"><div class="empty-txt">Los equipos y sus tareas existen en los PE con la rúbrica por roles. Elige uno de esos PE.</div></div>`; return;
    }
    renderCargando(host);
    const [r, t] = await Promise.all([API.getEquipos({ periodoId: S.periodoId }), API.getTareasEquipo({ periodoId: S.periodoId })]);
    if (!r.ok) { host.innerHTML = r.noDisponible ? noDisponibleHTML() : ''; if (!r.noDisponible) renderError(host, r.error, recargarTareas); return; }
    S.equipos = r.equipos; S.tareas = t.ok ? t.tareas : [];
    pintarTareas();
  }

  const FILTROS_TQ = [['', 'Todas'], ['abiertas', 'Abiertas'], ['revisar', 'Por revisar'], ['vencidas', 'Vencidas'], ['aprobadas', 'Aprobadas'], ['anuladas', 'Anuladas']];
  const pasaTQ = (t, f) => !f || (f === 'abiertas' && ['asignada', 'en_curso', 'bloqueada', 'devuelta'].includes(t.estado)) || (f === 'revisar' && t.estado === 'entregada')
    || (f === 'vencidas' && t.vencida) || (f === 'aprobadas' && t.estado === 'aprobada') || (f === 'anuladas' && t.estado === 'anulada');

  function pintarTareas() {
    const lista = S.tareas.filter(t => (!S.tq.equipo || String(t.equipo_id) === S.tq.equipo) && pasaTQ(t, S.tq.estado));
    const grupos = new Map();
    for (const e of S.equipos) grupos.set(e.equipo_id, { e, tareas: [] });
    for (const t of lista) { if (!grupos.has(t.equipo_id)) grupos.set(t.equipo_id, { e: { equipo_id: t.equipo_id, nombre: t.equipo_nombre, estado: 'activo' }, tareas: [] }); grupos.get(t.equipo_id).tareas.push(t); }
    const visibles = [...grupos.values()].filter(g => g.tareas.length);
    const porRevisar = S.tareas.filter(t => t.estado === 'entregada' && t.puedo_revisar).length;
    S.host.innerHTML = `
      <div class="filtros-fila eq-filtros">
        <label class="eq-f"><span>Equipo</span>
          <select class="cfg-inp cfg-select" data-change="eqFiltrarTareas" data-f="equipo" aria-label="Equipo">
            <option value="">Todos los equipos</option>${S.equipos.map(e => `<option value="${e.equipo_id}"${S.tq.equipo === String(e.equipo_id) ? ' selected' : ''}>${escHtml(e.nombre)}</option>`).join('')}
          </select></label>
        <label class="eq-f"><span>Estado</span>
          <select class="cfg-inp cfg-select" data-change="eqFiltrarTareas" data-f="estado" aria-label="Estado de la tarea">
            ${FILTROS_TQ.map(([v, l]) => `<option value="${v}"${S.tq.estado === v ? ' selected' : ''}>${l}${v === 'revisar' && porRevisar ? ` (${porRevisar})` : ''}</option>`).join('')}
          </select></label>
        ${soloLectura() || !(S.esAdmin || S.modo === 'tareas') ? '' : `<button type="button" class="btn-save" data-act="eq" data-arg="nueva-desde-tareas"><i data-lucide="plus" aria-hidden="true"></i>Nueva tarea de equipo</button>`}
      </div>
      ${!S.equipos.length ? `<div class="empty-box"><div class="empty-txt">Este PE todavía no tiene equipos${S.esAdmin ? ': créalos en la pestaña Equipos' : ''}.</div></div>`
        : !visibles.length ? `<div class="empty-box"><div class="empty-txt">${S.tareas.length ? 'Ninguna tarea coincide con el filtro.' : 'Todavía no hay tareas de equipo en este PE.'}</div></div>`
        : visibles.map(g => `
          <section class="eq-grupo" aria-label="Tareas del equipo ${escHtml(g.e.nombre)}">
            <div class="eq-grupo-cab"><h4 class="pf-sub">${escHtml(g.e.nombre)}</h4>
              <button type="button" class="tk-btn" data-act="eq" data-arg="abrir" data-arg2="${g.e.equipo_id}">Ver el equipo</button></div>
            <div class="tk-lista">${g.tareas.map(tareaHTML).join('')}</div>
          </section>`).join('')}`;
    renderIconos(S.host);
  }

  function filtrarTareas(el) { usar(el.closest('#tareas-equipo-host')); S.tq[el.dataset.f] = el.value; pintarTareas(); }

  /** «Nueva tarea de equipo» desde la pestaña Tareas: primero se elige el equipo. */
  function elegirEquipoParaTarea() {
    const activos = S.equipos.filter(e => e.estado === 'activo');
    if (!activos.length) { showToast('No hay equipos activos en este PE.', 'info'); return; }
    Tareas.abrirModal({
      titulo: 'Nueva tarea de equipo',
      campos: [{ id: 'equipo', tipo: 'select', label: 'Equipo', valor: String(activos[0].equipo_id), opciones: activos.map(e => ({ v: String(e.equipo_id), l: e.nombre })) }],
      confirmar: 'Continuar',
      onConfirm: async v => {
        S.eqId = Number(v.equipo);
        const ints = await API.getEquipoIntegrantes(S.eqId);
        S.integrantes = ints.ok ? ints.integrantes : [];
        setTimeout(modalNuevaTarea, 0);
        return null;
      },
    });
  }

  /* ══ Despachador ═════════════════════════════════════════════════════ */
  function accion(a, id, el) {
    usar(el?.closest?.('#eq-host, #equipos-host, #tareas-equipo-host'));
    if (String(a).startsWith('t-')) return accionTarea(a, id);
    switch (a) {
      case 'nuevo':   return formularioEquipo(null);
      case 'editar':  return formularioEquipo(S.equipos.find(x => x.equipo_id === S.eqId));
      case 'abrir': case 'abrir-miembro': return abrir(id);
      case 'lista':   return listar();
      case 'lista-miembro': return recargarMiembro();
      case 'lista-tareas': S.eqId = null; return recargarTareas();
      case 'nueva-desde-tareas': return elegirEquipoParaTarea();
      case 'miembros': return modalMiembros();
      case 'retirar': return modalRetirar(id);
      case 'estado':  return modalEstado();
      case 'nueva-tarea': return modalNuevaTarea();
    }
  }

  return { montarAdmin, montarMiembro, montarTareas, accion, filtrar, filtrarTareas, tareaHTML, ESTADOS: EST_TAREA };
})();

/* Globales de la lista blanca de config.js (data-input / data-change). */
function eqFiltrar(el) { Equipos.filtrar(el); }
function eqFiltrarTareas(el) { Equipos.filtrarTareas(el); }
