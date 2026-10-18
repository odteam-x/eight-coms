/**
 * EIGHT CREATORS LABs — Panel Admin (Supabase)
 */
'use strict';

let CU = null;
let _users       = [];
let _roles       = [];
let _periodos    = [];
let _criterios   = [];
let _rubrica     = [];
let _calendario  = [];
let _distritos    = [];
/** Período elegido en el selector de entrada, si lo hubo. */
let _periodoEntrada = null;
let _activePE       = null;
let _activePEDist   = null;
let _activePEOv     = null;
let _activePEUsers  = null;
let _activeDistId   = null;
let _overviewEvals      = [];
let _overviewDistEvals  = [];
let _ovInactivosPE      = new Set();
let _rptPE              = null;
let _rptEvals           = {};
let _rankingTab         = 'users';
let _inactivosPE        = new Set();
let _evalPECache    = [];
let _selectedEvalUser = null;
let _evalEstado = '';   // filtro de la lista de Evaluar: '', pendiente, borrador, publicado
let _evalFlag = '';     // atajo: '', revisar, vencidas, sinrol, pequeno, inactivos
let _evalTareas = {};   // por persona: { porRevisar, vencidas } (solo períodos por roles)
let _evalInactivos = new Set();
/** Rúbrica v2 (migración 0015). Vacíos si la migración aún no se aplicó. */
let _criteriosV2 = [];
let _perfiles    = [];
/** Resultados v2 del período en Evaluar, por evaluado_id (incluye borradores). */
let _resV2 = {};
/** Estado del formulario v2 abierto: { evaluadoId, perfil, puntajes, claves }. */
let _formV2 = null;

/* parseJSON → core/render.js */

/* CRITERIOS_DEFAULT eliminado — getCriterios() vive en core/render.js y lee
   Store. Si la consulta falla, la vista debe mostrar un error, no criterios
   inventados que el admin podría acabar puntuando. */

const DIST_CRITERIOS = [
  { key:'cgo', label:'Competencia en Gestión y Organización', abbr:'CGO', color:'var(--criterio)', max:7,
    desc:'Evalúa la estética y organización del feed: coherencia visual, uso de portadas, colores e identidad. Feed visualmente equilibrado, atractivo y bien distribuido.' },
  { key:'cct', label:'Competencia Creativa y Técnica',        abbr:'CCT', color:'var(--criterio)', max:7,
    desc:'Evalúa la creatividad e innovación del contenido: diseño impactante y edición profesional adaptada a formatos de Instagram.' },
  { key:'com', label:'Competencia Comunicativa',              abbr:'COM', color:'var(--criterio)', max:7,
    desc:'Evalúa la claridad y estrategia del mensaje: captions bien estructurados, narrativa coherente e intención comunicativa alineada con los objetivos del distrito.' },
  { key:'cee', label:'Competencia de Ejecución Estratégica',  abbr:'CEE', color:'var(--criterio)', max:7,
    desc:'Evalúa la constancia y estrategia de publicación: uso óptimo de reels, stories y posts, con evidencia de alto rendimiento e interacción.' },
];
const MAX_DIST       = 28;
const calcDistScore  = p => { const o = parseJSON(p); return DIST_CRITERIOS.reduce((s,c) => s+(Number(o[c.key])||0), 0); };
const distScoreColor = s => s>=24?'var(--sex)':s>=17?'var(--sbu)':s>=10?'var(--spr)':'var(--sba)';
const distScoreLabel = s => s>=24?'Excelente':s>=17?'Bueno':s>=10?'En Proceso':'Bajo';
const distScoreClass = s => s>=24?'sex':s>=17?'sbu':s>=10?'spr':'sba';

/* toggleMenu / closeMenu vivían aquí, apuntando a #hamburger y
   #mobile-menu. Ninguno de los dos existe en el marcado desde que el
   rail sustituyó a la topbar en la fase 6, junto con sus dos listeners
   globales de clic y resize. */

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', async () => {
  CU = await Auth.requireAuth(true); // true → solo admins
  if (!CU) return;

  initNav({
    marca: 'EIGHT CREATORS', badge: 'ADMIN', portal: 'admin', ayuda: 'ayuda/admin.html', inicio: 'overview', activo: 'overview', calTab: 'agenda',
    // Cabecera de cuenta de la hoja móvil, donde viven salir y el
    // selector de gestión: el rail no existe por debajo de 768px.
    pie: { nombre: CU.nombre || CU.email, badge: 'Administrador' },
    grupos: [
      { items: [
        { tab:'overview', icono:'layout-dashboard', etiqueta:'Panel'    },
        { tab:'evaluar',  icono:'clipboard-list',   etiqueta:'Evaluar'  },
        { tab:'tareas',   icono:'list-checks',      etiqueta:'Tareas'   },
        { tab:'usuarios', icono:'users',            etiqueta:'Personas' },
        { tab:'equipos',  icono:'users-round',      etiqueta:'Equipos'  },
        { tab:'seguimiento', icono:'trending-up',   etiqueta:'Seguimiento' },
        { tab:'agenda',   icono:'calendar',         etiqueta:'Calendario' },
        { tab:'reportes', icono:'file-bar-chart',   etiqueta:'Reportes' },
      ]},
      { titulo:'Configuración', plegado: true, items: [
        { tab:'periodos',   icono:'calendar',      etiqueta:'Períodos'   },
        { tab:'calendario', icono:'calendar-days', etiqueta:'Actividades' },
        { tab:'rubrica',    icono:'ruler',         etiqueta:'Rúbrica'    },
        { tab:'roles',      icono:'sliders-horizontal', etiqueta:'Roles y perfiles' },
        { tab:'distritos',  icono:'map-pin',       etiqueta:'Distritos'  },
        { tab:'gestiones',  icono:'archive',       etiqueta:'Gestiones'  },
      ]},
    ],
  });

  // El avatar se monta DESPUÉS de initNav(). #av-desktop y #uname-desktop
  // los crea renderRail() de core/rail.js; antes de eso getElementById
  // devolvía null, el `if (el)` no entraba nunca y el <input type="file">
  // no llegaba a abrirse jamás.
  // 'av-mobile' y 'uname-mobile' no existen en ningún HTML del proyecto:
  // eran ids de la topbar que el rail sustituyó.
  montarAvatar(CU);

  // La gestión debe fijarse ANTES de cargar: los getters filtran por ella.
  const entrada = await resolverEntrada();
  if (entrada?.gestionId) API.setGestion(entrada.gestionId);
  _periodoEntrada = entrada?.periodoId || null;

  await loadAllData();
  renderOvPEBar();
  renderEvalPEBar();
  renderUsuariosPEBar();
  renderRptPEBar();
  renderUsuarios();
  initPersonas();
  renderRoles();
  renderPeriodos();
  renderCriterios();
  Bienvenida.iniciar({ perfil: CU, tipo: 'admin', ir: tab => switchTab(tab, null) });
  renderRubrica();
  renderPerfiles();
  renderCalendario();
  renderDistPEBar();
  populateDistritoFilters();
  initScrollEffects();
  actualizarRailProximo();
  registrarBuscadorAdmin();
  loadOverview();
});

async function loadAllData() {
  const [users, roles, pes, crits, rub, cal, dists, crV2, perf] = await Promise.all([
    API.getAllUsers(),
    API.getRoles(false),
    API.getPeriodos(),
    API.getCriterios(),
    API.getRubrica(),
    API.getCalendario(),
    API.getDistritos(),
    API.getCriteriosV2(),
    API.getPerfiles(),
    API.probarEscala(),
  ]);
  _users      = users;
  _roles      = roles;
  _periodos   = pes;
  _criterios  = crits;
  _rubrica    = rub;
  _calendario = cal;
  _distritos  = dists;
  _criteriosV2 = crV2;
  _perfiles    = perf;

  // getCriterios() de core/render.js lee del Store, no de _criterios.
  // El Store lleva los períodos con la forma de los portales (pe, fechas en
  // camelCase): core/perfil.js los lee así. Se conservan todos los campos crudos.
  const periodosStore = _periodos.map(p => ({
    ...p, pe: p.nombre, nombre: p.descripcion || p.nombre,
    inicio: p.fecha_inicio || null, finTrabajo: p.fecha_fin_trabajo || null,
    entrega: p.fecha_entrega || null, jornada: p.fecha_jornada || null,
    v2Permitido: p.v2_permitido !== false,
  }));
  Store.set({ profile: CU, periodos: periodosStore, criterios: _criterios,
              criteriosV2: _criteriosV2, perfiles: _perfiles, lastUpdated: new Date() });

  // Gestión elegida por URL (?gestion=). Si está archivada, solo lectura.
  const gs = await API.getGestiones();
  const gActual = gs.find(g => String(g.id) === String(new URLSearchParams(location.search).get('gestion')))
               || gs.find(g => g.activa) || null;
  renderBannerSoloLectura(gActual);
  renderSelectorGestion('gestion-switch', gs, gActual?.id,
    id => location.assign('admin.html?gestion=' + encodeURIComponent(id)));

  // El período elegido en el selector de entrada manda sobre el activo.
  // Si ya no existe, se cae al activo y se avisa: es peor mirar datos de
  // otro período sin saberlo que perder la preferencia.
  let defPE = null;
  if (_periodoEntrada) {
    defPE = _periodos.find(p => String(p.id) === String(_periodoEntrada));
    if (!defPE) showToast('El período guardado ya no existe. Se abrió el activo.', 'info');
  }
  defPE = defPE || _periodos.find(p => p.activo) || _periodos[0];
  if (defPE && !_activePE) _activePE = defPE;
  if (defPE && !_activePEDist) _activePEDist = defPE;
}

/**
 * Filtros de distrito. Salen del CATÁLOGO (_distritos), no de los distritos
 * ya asignados: derivarlos de _users dejaba fuera cualquier distrito sin
 * nadie dentro. El valor iba además sin escHtml, a diferencia del resto de
 * la tabla.
 */
function populateDistritoFilters() {
  const opts = '<option value="">Todos los distritos</option>' +
    _distritos.map(d => `<option value="${escHtml(d.id)}">${escHtml(d.nombre)}</option>`).join('') +
    '<option value="__none__">Sin asignar</option>';
  const optsRol = '<option value="">Todos los roles</option>' +
    (typeof _roles !== 'undefined' ? _roles : []).map(r => `<option value="${escHtml(r.id)}">${escHtml(r.nombre)}</option>`).join('') +
    '<option value="__none__">Sin rol</option>';
  const selRol = document.getElementById('eval-rol-filter');
  if (selRol) { const previo = selRol.value; selRol.innerHTML = optsRol; if (previo) selRol.value = previo; }
  ['filter-distrito-usuarios', 'eval-distrito-filter'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const previo = sel.value;
    sel.innerHTML = opts;
    if (previo) sel.value = previo;      // no perder el filtro al repintar
  });
}

/* ── TAB: EVALUAR ── */
function renderEvalPEBar() {
  const bar = document.getElementById('eval-pe-btns'); if (!bar) return;
  if (!_periodos.length) {
    bar.innerHTML = '<span style="color:var(--muted);font-size:.8rem">Sin períodos. Créalos en la pestaña Períodos.</span>';
    return;
  }
  if (!_activePE) _activePE = _periodos.find(p => p.activo) || _periodos[0];

  bar.innerHTML = _periodos.map(p =>
    `<button class="pb${p.id === _activePE?.id ? ' active' : ''}" data-act="peEval" data-arg="${p.id}">${escHtml(p.nombre)}</button>`
  ).join('');

  loadEvalPEData().then(fijarCabeceraEval);
}

function fijarCabeceraEval() {
  const fijo = document.getElementById('eval-fijo'); if (!fijo || fijo._obs) return;
  const set = () => document.getElementById('tab-evaluar')?.style.setProperty('--eval-cab-h', fijo.offsetHeight + 'px');
  fijo._obs = new ResizeObserver(set); fijo._obs.observe(fijo); set();
}

async function selectEvalPE(periodoId, btn) {
  _activePE = _periodos.find(p => p.id == periodoId);
  document.querySelectorAll('#eval-pe-btns .pb').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _selectedEvalUser = null;
  document.getElementById('eval-form-area').innerHTML = '';
  await loadEvalPEData();
  fijarCabeceraEval();
}

async function loadEvalPEData() {
  if (!_activePE) return;
  const el = document.getElementById('eval-user-list');
  if (el && !_evalPECache.length) el.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';
  const v2 = esPeriodoV2(_activePE);
  const [evs, res] = await Promise.all([
    API.getEvaluacionesByPE(_activePE.id),
    // El admin pide también los borradores para ver el avance mientras evalúa.
    v2 ? API.getResultadosV2(_activePE.id, { borradores: true }) : Promise.resolve({ ok: true, rows: [] }),
  ]);
  _evalPECache = evs;
  _resV2 = Object.fromEntries((res.rows || []).map(r => [r.evaluado_id, r]));
  // Datos para los atajos (participación y, en períodos por roles, tareas). Si fallan, el atajo no cuenta.
  try {
    const part = await API.getParticipantes(_activePE.id);
    _evalInactivos = new Set((part || []).filter(r => !r.activo).map(r => r.user_id));
  } catch { _evalInactivos = new Set(); }
  _evalTareas = {};
  if (v2) {
    const [rt, lt] = await Promise.all([API.getResumenTareas(_activePE.id), API.getTareas({ periodoId: _activePE.id })]);
    if (rt.ok) Object.entries(rt.porUsuario).forEach(([id, r]) => { (_evalTareas[id] ||= { porRevisar: 0, vencidas: 0 }).vencidas = r.vencidas_abiertas || 0; });
    if (lt.ok) lt.tareas.filter(t => t.estado === 'entregada').forEach(t => { (_evalTareas[t.asignada_a] ||= { porRevisar: 0, vencidas: 0 }).porRevisar++; });
  }
  if (v2 && !res.ok) showToast('No se pudieron calcular los resultados v2: ' + res.error, 'error');
  renderEvalUserList();
}

const _EVAL_ATAJOS = [
  { id: 'revisar',   txt: 'Con entregas por revisar', v2: true,  ico: 'inbox',        test: u => (_evalTareas[u.id]?.porRevisar || 0) > 0 },
  { id: 'vencidas',  txt: 'Con tareas vencidas',      v2: true,  ico: 'alarm-clock',  test: u => (_evalTareas[u.id]?.vencidas || 0) > 0 },
  { id: 'sinrol',    txt: 'Sin rol asignado',         v2: true,  ico: 'user-x',       test: u => !u.rol_id },
  { id: 'pequeno',   txt: 'Rol con pocas personas',   v2: true,  ico: 'group',        test: u => !!_resV2[u.id]?.rol_pequeno },
  { id: 'inactivos', txt: 'Inactivos en el período',  v2: false, ico: 'pause',        test: u => _evalInactivos.has(u.id) },
];

function _evalPoblacion() {
  const q = (document.getElementById('search-eval-users')?.value || '').toLowerCase().trim();
  const dist = (document.getElementById('eval-distrito-filter')?.value || '').trim();
  const rol = (document.getElementById('eval-rol-filter')?.value || '').trim();
  return _users.filter(u => !u.es_admin
    && (!dist || (dist === '__none__' ? !u.distrito : u.distrito === dist))
    && (!rol || (rol === '__none__' ? !u.rol_id : String(u.rol_id) === rol))
    && (!q || (u.nombre || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)));
}

/** Pinta chips (con conteo) y lista. La cabecera no se toca al elegir a alguien. */
function renderEvalUserList() {
  const el = document.getElementById('eval-user-list'); if (!el) return;
  const host = document.getElementById('eval-chips-host');
  const nonAdmins = _evalPoblacion();
  const evalMap = {};
  _evalPECache.forEach(e => { evalMap[e.evaluado_id] = e; });
  const criterios = getCriterios();
  const v2  = esPeriodoV2(_activePE);
  const MAX = v2 ? 100 : criterios.length * 4 + 2;
  const colFill = v2 ? scoreColorV2    : scoreColor;
  const colTxt  = v2 ? scoreColorTxtV2 : scoreColorTxt;

  const todos = nonAdmins.map(u => {
    const ev = evalMap[u.id];
    const score = v2 ? (_resV2[u.id]?.individual ?? -1) : (ev ? calcScorePuntajes(ev.puntajes, ev.bono_ext) : -1);
    // Quien está desactivado en este período y no tiene evaluación no es un «pendiente»: no cuenta por evaluar.
    const inactivo = !ev && _evalInactivos.has(u.id);
    return { ...u, ev, score, inactivo, estado: ev?.estado || (inactivo ? 'inactivo' : 'pendiente') };
  }).sort((a, b) => {
    const order = { publicado: 0, borrador: 1, pendiente: 2, inactivo: 3 };
    const d = (order[a.estado] ?? 2) - (order[b.estado] ?? 2);
    return d !== 0 ? d : b.score - a.score;
  });

  const cuenta = { publicado: 0, borrador: 0, pendiente: 0, inactivo: 0 };
  todos.forEach(u => { cuenta[u.estado] = (cuenta[u.estado] || 0) + 1; });
  const hechos = cuenta.publicado, total = todos.length - cuenta.inactivo;   // sin los desactivados del período
  const atajos = _EVAL_ATAJOS.filter(f => v2 || !f.v2);
  const cuentaAtajo = Object.fromEntries(atajos.map(f => [f.id, todos.filter(f.test).length]));
  if (_evalFlag && !atajos.some(f => f.id === _evalFlag)) _evalFlag = '';
  const fAct = atajos.find(f => f.id === _evalFlag);
  // Un atajo con cero personas no ayuda a nadie: solo se ofrece si tiene algo o está activo.
  const atajosVisibles = atajos.filter(f => cuentaAtajo[f.id] > 0 || f.id === _evalFlag);

  const lista = todos.filter(u => (!_evalEstado || u.estado === _evalEstado) && (!fAct || fAct.test(u)));
  const chip = (act, id, txt, n, on, ico) => `<button type="button" class="eval-chip${on ? ' on' : ''}" data-act="${act}" data-arg="${id}" aria-pressed="${on}">${ico ? `<i data-lucide="${ico}"></i>` : ''}${escHtml(txt)} <b>${n}</b></button>`;
  if (host) {
    host.innerHTML = `
      <div class="eval-resumen">
        <div class="eval-resumen-n"><strong>${hechos}</strong><span>de ${total} publicadas</span></div>
        <div class="eval-resumen-bar" role="img" aria-label="${hechos} de ${total} evaluaciones publicadas"><i style="width:${total ? Math.round(hechos / total * 100) : 0}%"></i></div>
      </div>
      <div class="eval-grupo"><span class="eval-grupo-t">Estado</span><div class="eval-chips">
        ${chip('evalFiltro', '', 'Todas', todos.length, !_evalEstado)}${chip('evalFiltro', 'pendiente', 'Pendientes', cuenta.pendiente, _evalEstado === 'pendiente')}${chip('evalFiltro', 'borrador', 'Borrador', cuenta.borrador, _evalEstado === 'borrador')}${chip('evalFiltro', 'publicado', 'Publicadas', cuenta.publicado, _evalEstado === 'publicado')}
      </div></div>
      ${cuenta.borrador ? `<div class="eval-grupo"><button type="button" class="btn-texto btn-texto--peligro" data-act="borrarBorradores"><i data-lucide="trash-2" aria-hidden="true"></i>${cuenta.borrador === 1 ? 'Eliminar el borrador' : 'Eliminar los ' + cuenta.borrador + ' borradores'}</button></div>` : ''}
      ${atajosVisibles.length ? `<div class="eval-grupo"><span class="eval-grupo-t">Atajos</span><div class="eval-chips">
        ${atajosVisibles.map(f => chip('evalAtajo', f.id, f.txt, cuentaAtajo[f.id], _evalFlag === f.id, f.ico)).join('')}
      </div></div>` : ''}`;
    renderIconos(host);
  }

  const top = el.scrollTop;
  if (!lista.length) {
    el.innerHTML = `<div class="empty-box"><div class="empty-txt">${total ? 'Nadie cumple esos filtros.' : 'Sin miembros registrados.'}</div></div>`;
    return;
  }
  let rank = 0;
  el.innerHTML = `<div class="eval-users-grid">
    ${lista.map(u => {
      const estadoCls = u.estado === 'publicado' ? 'estado--publicado' : u.estado === 'borrador' ? 'estado--borrador' : 'estado--none';
      const estadoTxt = u.estado === 'publicado' ? 'Publicado' : u.estado === 'borrador' ? 'Borrador' : u.estado === 'inactivo' ? 'Inactivo' : 'Pendiente';
      if (u.estado === 'publicado') rank++;
      const medal = u.estado === 'publicado' ? medallaHTML(rank) : '';
      const pct = u.score >= 0 ? Math.round(u.score / MAX * 100) : 0;
      const sinRol = v2 && !u.rol_id;
      const dist = (_distritos.find(d => String(d.id) === String(u.distrito)) || {}).nombre || u.distrito || '—';
      const t = _evalTareas[u.id];
      const avisos = (t?.porRevisar ? `<span class="etiqueta etq-azul">${t.porRevisar} por revisar</span>` : '') + (t?.vencidas ? `<span class="etiqueta etq-rojo">${t.vencidas} vencida${t.vencidas === 1 ? '' : 's'}</span>` : '');
      return `<div class="eval-ucard${_selectedEvalUser === u.id ? ' eval-ucard--active' : ''}" data-act="evaluarUsuario" data-arg="${u.id}">
        <div class="eval-ucard-rank">${medal}</div>
        <div class="eval-ucard-info">
          <div class="eval-ucard-name">${escHtml(u.nombre)}</div>
          <div class="eval-ucard-meta">${sinRol ? '<span class="etiqueta etq-coral">Sin rol</span>' : escHtml(u.roles?.nombre || '—')} · ${escHtml(dist)}</div>
          <div class="eval-ucard-avisos"><span class="eval-estado-badge ${estadoCls}">${estadoTxt}</span>${avisos}</div>
        </div>
        <div class="eval-ucard-fin">
          ${u.score >= 0 ? `<span class="eval-ucard-score" style="color:${colTxt(u.score)}">${v2 ? fmtV2(u.score) : u.score}</span>` : ''}
          <button type="button" class="eval-perfil" data-act="perfilVer" data-arg="${u.id}" aria-label="Ver perfil de ${escHtml(u.nombre)}" title="Ver perfil"><i data-lucide="user"></i></button>
        </div>
      </div>`;
    }).join('')}
  </div>`;
  renderIconos(el);
  el.scrollTop = top;   // no perder el sitio en la lista
}

async function selectEvalUser(userId) {
  _selectedEvalUser = userId;
  // Solo se marca la fila: no se repinta la lista ni se mueve la cabecera.
  document.querySelectorAll('#eval-user-list .eval-ucard').forEach(c => c.classList.toggle('eval-ucard--active', c.dataset.arg === String(userId)));
  const area = document.getElementById('eval-form-area'); if (!area) return;
  if (!area.firstElementChild) area.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';
  area.classList.add('cargando');
  // getTrabajosEntregados indexa por periodo_id (UUID), no por el nombre.
  const [ev, trabajos] = await Promise.all([
    API.getEvaluacion(_activePE.id, userId),
    API.getTrabajosEntregados(userId, _activePE?.id || null),
  ]);
  if (_selectedEvalUser !== userId) return;      // se eligió a otra persona mientras cargaba
  renderEvalForm(ev, userId, trabajos);
  area.classList.remove('cargando');
  area.scrollTop = 0;
  // En pantallas estrechas el formulario va debajo de la lista: ahí sí se baja a él.
  if (window.matchMedia('(max-width: 1099px)').matches) area.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderEvalForm(ev, evaluadoId, trabajos) {
  const area = document.getElementById('eval-form-area'); if (!area) return;
  if (esPeriodoV2(_activePE)) { renderEvalFormV2(ev, evaluadoId, trabajos); return; }
  const criterios  = getCriterios();
  const puntajes   = parseJSON(ev?.puntajes);
  const coms       = parseJSON(ev?.comentarios);
  const bono       = ev?.bono_ext    || 0;
  const estado     = ev?.estado      || 'borrador';
  const evaluado   = _users.find(u => u.id === evaluadoId);
  const isPub      = estado === 'publicado';

  const rows = criterios.map((c, i) => `
    <div class="eval-criterio-row" style="animation-delay:${i*30}ms">
      <div class="eval-crit-head">
        <div class="eval-crit-label">${escHtml(c.label)}</div>
      </div>
      <div class="eval-crit-inputs">
        <div class="escala-wrap">
          ${escalaHTML({ min: 0, max: 4, valor: puntajes[c.key] ?? null, accion: 'puntaje', key: c.key, nombre: c.label })}
          <input type="hidden" id="sc-${c.key}" value="${puntajes[c.key]??0}">
        </div>
        <input class="cfg-inp eval-com-inp" type="text" id="com-${c.key}"
          placeholder="Comentario (opcional)" value="${escHtml(coms[c.key]||'')}">
      </div>
    </div>`).join('');

  const trabajosHTML = trabajos && trabajos.length ? `
    <details class="eval-trabajos-section" open>
      <summary class="eval-extra-label" style="cursor:pointer;user-select:none">
        Trabajos entregados — ${escHtml(_activePE?.nombre || '')} <span style="font-weight:400;color:var(--muted)">(${trabajos.length})</span>
      </summary>
      <div class="eval-trabajos-list">
        ${trabajos.map(t => `<div class="eval-trabajo-item">
          <div class="eval-trabajo-title">${escHtml(t.titulo || 'Sin título')}</div>
          <div class="eval-trabajo-desc">${escHtml(t.descripcion || '')}</div>
          <div class="eval-trabajo-date">${t.created_at ? new Date(t.created_at).toLocaleDateString('es-CL') : ''}</div>
        </div>`).join('')}
      </div>
    </details>` : `
    <div class="eval-extras" style="opacity:.5">
      <div class="eval-extra-label">Trabajos entregados — ${escHtml(_activePE?.nombre || '')}</div>
      <div style="font-size:.78rem;color:var(--muted)">Este miembro no ha entregado trabajos en este período.</div>
    </div>`;

  area.innerHTML = `
    <div class="eval-form-card">
      <div class="eval-form-header">
        <div>
          <div class="eval-miembro-name">${escHtml(evaluado?.nombre || '—')}</div>
          ${evaluado?.roles?.nombre ? `<div class="eval-miembro-rol">${escHtml(evaluado.roles.nombre)}${evaluado?.distrito ? ' · '+escHtml(evaluado.distrito) : ''}</div>` : ''}
        </div>
        <span class="eval-estado-badge estado--${estado}">${estado}</span>
      </div>

      ${trabajosHTML}

      <div class="eval-criterios-list">${rows}</div>

      <div class="eval-extras">
        <label class="eval-extra-label">Bono de excelencia (0–2)</label>
        <div class="escala-wrap">
          ${escalaHTML({ min: 0, max: 2, valor: bono, accion: 'bono', key: null, nombre: 'bono de excelencia' })}
          <input type="hidden" id="sc-bono" value="${bono}">
        </div>
      </div>

      <div class="eval-extras">
        <label class="eval-extra-label">Notas / Comentario general</label>
        <textarea class="cfg-inp eval-com-inp" id="com-general" rows="3"
          placeholder="Notas del evaluador...">${escHtml(coms.general||'')}</textarea>
      </div>

      ${isPub
        ? `<div class="eval-pub-info">
             <span class="eval-pub-dot"></span>
             Evaluación publicada — visible para el miembro
           </div>
           <div class="eval-actions">
             <button class="btn-draft" data-act="guardarEval" data-arg="borrador" data-arg2="${evaluadoId}">Volver a borrador</button>
             <button class="btn-save btn-confirm" data-act="guardarEval" data-arg="publicado" data-arg2="${evaluadoId}">Confirmar cambios</button>
           </div>`
        : `<div class="eval-actions">
             ${ev?.estado === 'borrador' ? `<button class="btn-draft btn-draft--borrar" data-act="borrarEval" data-arg="${evaluadoId}"><i data-lucide="trash-2" aria-hidden="true"></i>Eliminar borrador</button>` : ''}
             <button class="btn-draft" data-act="guardarEval" data-arg="borrador" data-arg2="${evaluadoId}">Guardar borrador</button>
             <button class="btn-save btn-publish" data-act="guardarEval" data-arg="publicado" data-arg2="${evaluadoId}">Publicar evaluación</button>
           </div>`
      }
    </div>`;
}

/* ── Eliminar borradores ───────────────────────────────────────────────────────────────────
 * Solo borradores: la consulta filtra estado = 'borrador', así que una evaluación publicada no se puede borrar
 * desde aquí aunque el botón se manipule. Los borradores no avisan a nadie, no hay nada más que limpiar. */
async function _trasBorrar(userIdParaRehacer) {
  await loadEvalPEData();
  if (userIdParaRehacer) await selectEvalUser(userIdParaRehacer);
  else { _selectedEvalUser = null; const a = document.getElementById('eval-form-area'); if (a) a.innerHTML = ''; }
}

function borrarBorradorEval(userId) {
  const u = _users.find(x => x.id === userId);
  if (!_activePE || !u) return;
  Tareas.abrirModal({
    titulo: 'Eliminar borrador', confirmar: 'Eliminar borrador',
    campos: [{ id: 'i', tipo: 'info', texto: `Se borra el borrador de ${u.nombre} en ${_activePE.nombre}: puntajes y comentarios. No se puede deshacer. Si ya estaba publicado no se toca.` }],
    onConfirm: async () => {
      const r = await API.deleteBorrador(_activePE.id, userId);
      if (!r.ok) return r.error;
      showToast(r.n ? 'Borrador eliminado' : 'No había un borrador para eliminar (puede que ya esté publicado)', r.n ? 'success' : 'info');
      await _trasBorrar(userId);
      return null;
    },
  });
}

function borrarBorradoresEval() {
  if (!_activePE) return;
  const n = _evalPECache.filter(e => e.estado === 'borrador').length;
  if (!n) { showToast('No hay borradores en este período.', 'info'); return; }
  Tareas.abrirModal({
    titulo: 'Eliminar borradores', confirmar: n === 1 ? 'Eliminar 1 borrador' : `Eliminar ${n} borradores`,
    campos: [{ id: 'i', tipo: 'info', texto: `Se borran los ${n} borradores de ${_activePE.nombre} (puntajes y comentarios). Las evaluaciones publicadas no se tocan. No se puede deshacer.` }],
    onConfirm: async () => {
      const r = await API.deleteBorradores(_activePE.id);
      if (!r.ok) return r.error;
      showToast(r.n === 1 ? '1 borrador eliminado' : `${r.n} borradores eliminados`, 'success');
      await _trasBorrar(null);
      return null;
    },
  });
}

function setScore(key, val, btn) {
  document.getElementById(`sc-${key}`).value = val;
  escalaActualizar(btn.closest('.escala'), val);
}

function setBono(val, btn) {
  document.getElementById('sc-bono').value = val;
  escalaActualizar(btn.closest('.escala'), val);
}

async function saveEvaluacion(estado, evaluadoId) {
  if (!_activePE) return;
  if (esPeriodoV2(_activePE)) { await saveEvaluacionV2(estado, evaluadoId); return; }
  const criterios  = getCriterios();
  const puntajes   = {}, comentarios = {};
  criterios.forEach(c => {
    puntajes[c.key] = parseInt(document.getElementById(`sc-${c.key}`)?.value || 0);
    const v = document.getElementById(`com-${c.key}`)?.value.trim();
    if (v) comentarios[c.key] = v;
  });
  const gen = document.getElementById('com-general')?.value.trim();
  if (gen) comentarios.general = gen;
  const bono_ext = parseInt(document.getElementById('sc-bono')?.value || 0);

  const res = await API.upsertEvaluacion({
    periodo_id:   _activePE.id,
    evaluado_id:  evaluadoId,
    evaluador_id: CU.id,
    puntajes,
    bono_ext,
    comentarios,
    estado,
  });

  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  showToast(estado === 'publicado' ? 'Evaluación publicada' : 'Borrador guardado', 'ok');
  _evalPECache = await API.getEvaluacionesByPE(_activePE.id);
  renderEvalUserList();
  const [evNew, trabajos] = await Promise.all([
    API.getEvaluacion(_activePE.id, evaluadoId),
    API.getTrabajosEntregados(evaluadoId, _activePE?.id || null),
  ]);
  renderEvalForm(evNew, evaluadoId, trabajos);
}

/* ── EVALUAR v2 (rúbrica por roles, migración 0015) ───────────────────
 * El formulario se construye desde el PERFIL del rol de la persona: el
 * núcleo (5, igual para todos) y los técnicos de su rol con su peso. Lo que
 * no está en el perfil no se muestra ni se puntúa: un criterio que no aplica
 * se excluye, nunca vale cero. Escala 1–5; los descriptores de 1, 3 y 5 van
 * a mano y el 2 y el 4 son intermedios.
 *
 * Nada se calcula aquí: Núcleo, Técnico, Individual y General salen de la
 * base (resultados_periodo) y se refrescan tras cada guardado.
 */
function trabajosPanelHTML(trabajos) {
  if (!trabajos?.length) {
    return `<div class="eval-extras" style="opacity:.5">
      <div class="eval-extra-label">Trabajos entregados — ${escHtml(_activePE?.nombre || '')}</div>
      <div style="font-size:.8rem;color:var(--txt-2)">Este miembro no ha entregado trabajos en este período.</div>
    </div>`;
  }
  return `<details class="eval-trabajos-section" open>
    <summary class="eval-extra-label" style="cursor:pointer;user-select:none">
      Trabajos entregados — ${escHtml(_activePE?.nombre || '')} <span style="font-weight:400;color:var(--txt-2)">(${trabajos.length})</span>
    </summary>
    <div class="eval-trabajos-list">
      ${trabajos.map(t => `<div class="eval-trabajo-item">
        <div class="eval-trabajo-title">${escHtml(t.titulo || 'Sin título')}</div>
        <div class="eval-trabajo-desc">${escHtml(t.descripcion || '')}</div>
        <div class="eval-trabajo-date">${t.created_at ? new Date(t.created_at).toLocaleDateString('es-CL') : ''}</div>
      </div>`).join('')}
    </div>
  </details>`;
}

function renderEvalFormV2(ev, evaluadoId, trabajos) {
  const area = document.getElementById('eval-form-area'); if (!area) return;
  const evaluado = _users.find(u => u.id === evaluadoId);
  const estado   = ev?.estado || 'borrador';
  const coms     = parseJSON(ev?.comentarios);
  const guardado = parseJSON(ev?.puntajes);

  // El perfil de una evaluación ya guardada es el que fijó el servidor; si
  // aún no hay evaluación, el vigente para el rol en este período.
  const perfil = !evaluado?.rol_id ? null
    : (ev?.perfil_id && _perfiles.find(p => String(p.id) === String(ev.perfil_id)))
      || perfilVigenteDe(evaluado.rol_id, _activePE.id, _perfiles, _periodos);

  const cabecera = `
    <div class="eval-form-header">
      <div>
        <div class="eval-miembro-name">${escHtml(evaluado?.nombre || '—')}</div>
        <div class="eval-miembro-rol">${escHtml(evaluado?.roles?.nombre || 'Sin rol')}${evaluado?.distrito ? ' · ' + escHtml(evaluado.distrito) : ''}${perfil ? ' · perfil v' + perfil.version : ''}</div>
      </div>
      <span class="eval-estado-badge estado--${estado}">${estado}</span>
    </div>`;

  if (!perfil) {
    _formV2 = null;
    area.innerHTML = `<div class="eval-form-card">${cabecera}
      <div class="v2-nota v2-nota--regla" role="alert">
        ${!evaluado?.rol_id
          ? '<strong>Esta persona no tiene rol.</strong> Asígnalo en <em>Usuarios</em> para poder evaluarla: cada rol tiene su propio formulario.'
          : `<strong>No hay perfil de evaluación para el rol ${escHtml(evaluado?.roles?.nombre || '')}.</strong> Créalo en <em>Configuración → Perfiles</em>.`}
      </div></div>`;
    return;
  }

  const respGuardadas = parseJSON(ev?.respuestas);
  const ap = criteriosAplicables(perfil, _criteriosV2, { conservar: [...Object.keys(guardado), ...Object.keys(respGuardadas)] });
  const escalas = [...ap.nucleo, ...ap.tecnicos];
  // Escala: 'cinco' si la evaluación ya existe guardada de 1 a 5 (historia); en cualquier otro caso 'pesos'
  // (de 0 al peso del criterio; núcleo de 0 a 10). La base la fija en el primer guardado (migración 0023);
  // sin 0023 aplicada la columna no existe y se sigue evaluando de 1 a 5.
  const escalaForm = API.escalaPorPeso() ? (ev?.escala === 'cinco' ? 'cinco' : 'pesos') : 'cinco';
  _formV2 = {
    escala: escalaForm,
    evaluadoId, perfilId: perfil.id,
    claves: escalas.map(c => c.key),
    // Lo obligatorio es lo que bloquea la publicación; lo opcional sin responder se omite (nunca vale 0).
    requeridas: [...escalas, ...ap.registro].filter(c => c.obligatorio !== false && c.activo !== false).map(c => c.key),
    registro: ap.registro,
    puntajes: Object.fromEntries(Object.entries(guardado).map(([k, v]) => [k, Number(v)])),
    respuestas: { ...respGuardadas },
  };

  // Control de puntaje de un criterio, según la escala de ESTA evaluación.
  const controlPuntajeV2 = c => {
    const v = _formV2.puntajes[c.key] ?? null;
    if (_formV2.escala === 'cinco') return escalaHTML({ min: 1, max: 5, valor: v, accion: 'puntajeV2', key: c.key, nombre: c.nombre, peso: c.peso });
    const max = c.tipo === 'nucleo' ? ESCALA_NUCLEO_V2 : Number(c.peso) || 0;
    if (!max) return '<p class="v2-nota v2-nota--regla" role="alert">Este criterio no tiene peso en el perfil: no se puede puntuar.</p>';
    return puntosHTML({ max, valor: v, key: c.key, nombre: c.nombre, peso: c.tipo === 'nucleo' ? null : c.peso, accionPaso: 'puntosPaso', entrada: 'puntosInputV2' });
  };

  const fila = c => `
    <div class="v2-crit">
      <div class="v2-crit-head">
        <div class="v2-crit-nombre">${escHtml(c.nombre)}${c.obligatorio === false ? ' <span class="etiqueta etq-gris">Opcional</span>' : ''}${c.activo === false ? ' <span class="etiqueta etq-gris">Desactivado</span>' : ''}</div>
      </div>
      ${c.descripcion ? `<p class="v2-crit-desc">${escHtml(c.descripcion)}</p>` : ''}
      ${controlPuntajeV2(c)}
      <details class="v2-det"><summary>Descriptores 1 · 3 · 5</summary>${descriptoresHTML(c)}</details>
      <input class="cfg-inp eval-com-inp" type="text" id="com-${escHtml(c.key)}" aria-label="Comentario sobre ${escHtml(c.nombre)}"
        placeholder="Comentario (opcional)" value="${escHtml(coms[c.key] || '')}">
    </div>`;

  // Campos de registro (sí/no, opciones, texto): se guardan en la evaluación, no puntúan.
  const campo = c => {
    const t = tipoCampoDe(c), v = _formV2.respuestas[c.key];
    const cab = `<div class="v2-crit-head"><div class="v2-crit-nombre">${escHtml(c.nombre)}${c.obligatorio === false ? ' <span class="etiqueta etq-gris">Opcional</span>' : ''}</div></div>
      ${c.descripcion ? `<p class="v2-crit-desc">${escHtml(c.descripcion)}</p>` : ''}`;
    let ctl;
    if (t === 'si_no') {
      ctl = `<div class="v2-score v2-score--sino" role="group" aria-label="${escHtml(c.nombre)}">${[[true, 'Sí'], [false, 'No']].map(([val, l]) => `
        <button type="button" class="${v === val ? 'active' : ''}" data-act="campoV2" data-arg="${escHtml(c.key)}" data-arg2="${val}" aria-pressed="${v === val}">${l}</button>`).join('')}</div>`;
    } else if (t === 'opcion') {
      ctl = `<div class="v2-opciones" role="group" aria-label="${escHtml(c.nombre)}">${(c.opciones || []).map((o, i) => `
        <button type="button" class="eval-chip${v === o ? ' on' : ''}" data-act="campoV2" data-arg="${escHtml(c.key)}" data-arg2="${i}" aria-pressed="${v === o}">${escHtml(o)}</button>`).join('')}</div>`;
    } else {
      ctl = `<textarea class="cfg-inp eval-com-inp" id="reg-${escHtml(c.key)}" rows="2" maxlength="1000" aria-label="${escHtml(c.nombre)}" placeholder="Escribe aquí…">${escHtml(v || '')}</textarea>`;
    }
    return `<div class="v2-crit">${cab}${ctl}</div>`;
  };

  const r = _resV2[evaluadoId];
  const resumen = r ? `
      <span>Núcleo <b>${fmtV2(r.nucleo)}</b></span>
      <span>Técnico <b>${fmtV2(r.tecnico)}</b></span>
      <span>Individual <b>${fmtV2(r.individual)}</b></span>
      <span>General <b>${fmtV2(r.general)}</b>${r.rol_pequeno ? ' <small>(rol pequeño)</small>' : ''}</span>` : '';

  const isPub = estado === 'publicado';
  area.innerHTML = `
    <div class="eval-form-card">
      ${cabecera}
      <div id="v2-evidencia"></div>
      <div id="v2-trabajos">${trabajosPanelHTML(trabajos)}</div>
      <div class="v2-form-sec">Núcleo transversal<small>Igual para los ocho roles. Se compara en valor absoluto.</small></div>
      ${ap.nucleo.map(fila).join('')}
      <div class="v2-form-sec">Criterios técnicos de ${escHtml(evaluado?.roles?.nombre || 'su rol')}<small>Solo se compara con quienes tienen el mismo rol. Ordenados por peso.</small></div>
      ${ap.tecnicos.map(fila).join('')}
      ${ap.registro.length ? `<div class="v2-form-sec">Registro de la evaluación<small>Datos que se guardan con la evaluación y no puntúan.</small></div>${ap.registro.map(campo).join('')}` : ''}
      <p class="v2-fuera"><strong>No se evalúan (${ap.fuera.length}):</strong> ${escHtml(ap.fuera.map(c => c.nombre).join(' · '))}. No aparecen en este formulario y no entran al denominador.</p>

      <div class="eval-extras">
        <label class="eval-extra-label" for="com-general">Notas / Comentario general</label>
        <textarea class="cfg-inp eval-com-inp" id="com-general" rows="3" placeholder="Notas del evaluador...">${escHtml(coms.general || '')}</textarea>
      </div>

      <div class="v2-resumen" aria-live="polite">
        <span id="v2-progreso"></span>${resumen}
      </div>

      ${isPub
        ? `<div class="eval-pub-info"><span class="eval-pub-dot"></span>Evaluación publicada — visible para el miembro</div>
           <div class="eval-actions">
             <button class="btn-draft" data-act="guardarEval" data-arg="borrador" data-arg2="${evaluadoId}">Volver a borrador</button>
             <button class="btn-save btn-confirm" data-act="guardarEval" data-arg="publicado" data-arg2="${evaluadoId}">Confirmar cambios</button>
           </div>`
        : `<div class="eval-actions">
             ${ev?.estado === 'borrador' ? `<button class="btn-draft btn-draft--borrar" data-act="borrarEval" data-arg="${evaluadoId}"><i data-lucide="trash-2" aria-hidden="true"></i>Eliminar borrador</button>` : ''}
             <button class="btn-draft" data-act="guardarEval" data-arg="borrador" data-arg2="${evaluadoId}">Guardar borrador</button>
             <button class="btn-save btn-publish" data-act="guardarEval" data-arg="publicado" data-arg2="${evaluadoId}">Publicar evaluación</button>
           </div>`}
    </div>`;
  actualizarProgresoV2();
  cargarEvidenciaV2(evaluadoId);
}

/**
 * Hechos de las tareas del período para quien evalúa. Solo sugiere a qué
 * criterio alimentan; no puntúa ni rellena nada. Si las tareas no están
 * activadas, el panel no aparece y queda el de «Trabajos entregados».
 */
async function cargarEvidenciaV2(evaluadoId) {
  const periodoId = _activePE?.id;
  const [resumen, lista] = await Promise.all([
    API.getResumenTareas(periodoId),
    API.getTareas({ periodoId, userId: evaluadoId }),
  ]);
  // El formulario pudo cambiar de persona mientras llegaba la respuesta.
  if (!_formV2 || _formV2.evaluadoId !== evaluadoId) return;
  const host = document.getElementById('v2-evidencia');
  if (!host || !resumen.ok || !lista.ok) return;
  host.innerHTML = Tareas.evidenciaHTML(resumen.porUsuario[evaluadoId] || null, lista.tareas);
  document.getElementById('v2-trabajos')?.remove();   // ya migrados a tareas
}

/** Clic en un puntaje: vuelve a pulsar el activo para dejarlo sin puntuar. */
function setScoreV2(key, n, btn) {
  if (!_formV2) return;
  if (_formV2.puntajes[key] === n) delete _formV2.puntajes[key];
  else _formV2.puntajes[key] = n;
  escalaActualizar(btn.closest('.escala'), _formV2.puntajes[key] ?? null);
  actualizarProgresoV2();
}

/* ── Puntos por peso (0023): barra, número y − / + ───────────────────────────────────────────── */
function _fijarPuntosV2(g, key, v, origen) {
  if (!_formV2) return;
  if (v == null) delete _formV2.puntajes[key]; else _formV2.puntajes[key] = v;
  puntosActualizar(g, v, origen);
  actualizarProgresoV2();
}
/** data-input / data-change de la barra y del número. El número vacío deja el criterio sin puntuar. */
function puntosInputV2(el, ev) {
  const g = el.closest('.pts'); if (!g) return;
  const max = Number(g.dataset.max);
  let v;
  if (el.type === 'number') {
    if (el.value === '') v = null;
    else { v = Math.round(Number(el.value)); if (!Number.isFinite(v)) return; v = Math.max(0, Math.min(max, v)); }
    _fijarPuntosV2(g, g.dataset.key, v, ev?.type === 'change' ? null : el);   // al soltar, el número queda normalizado
  } else {
    _fijarPuntosV2(g, g.dataset.key, Number(el.value), el);
  }
}
/** − / +: de un punto en un punto; sin puntuar, «+» empieza en 1 y «−» en 0. */
function puntosPasoV2(key, el) {
  const g = el.closest('.pts'); if (!g || !_formV2) return;
  const max = Number(g.dataset.max), d = Number(el.dataset.arg2), cur = _formV2.puntajes[key];
  const sig = cur == null ? (d > 0 ? 1 : 0) : Math.max(0, Math.min(max, cur + d));
  _fijarPuntosV2(g, key, Math.min(sig, max), null);
}

/** ¿Tiene respuesta este requerido? Escala: puntaje; texto: lo escrito; el resto: lo elegido. */
function _requeridoCumplido(k) {
  if (_formV2.claves.includes(k)) return _formV2.puntajes[k] != null;   // en «pesos» el 0 es un puntaje válido
  const c = (_formV2.registro || []).find(x => x.key === k);
  if (c && tipoCampoDe(c) === 'texto') return !!(document.getElementById('reg-' + k)?.value || '').trim();
  return _formV2.respuestas[k] !== undefined;
}

function actualizarProgresoV2() {
  const el = document.getElementById('v2-progreso'); if (!el || !_formV2) return;
  const req = _formV2.requeridas;
  const hechos = req.filter(_requeridoCumplido).length;
  const faltan = req.length - hechos;
  el.innerHTML = faltan
    ? `<b>${hechos}</b> de ${req.length} obligatorios · <span class="v2-faltan">faltan ${faltan} para poder publicar</span>`
    : `<b>${hechos}</b> de ${req.length} obligatorios · completo`;
}

/** Clic en un campo de registro: pulsar de nuevo el elegido lo deja sin responder. */
function setCampoV2(key, raw, btn) {
  if (!_formV2) return;
  const c = (_formV2.registro || []).find(x => x.key === key); if (!c) return;
  const val = tipoCampoDe(c) === 'si_no' ? raw === 'true' : (c.opciones || [])[Number(raw)];
  if (_formV2.respuestas[key] === val) delete _formV2.respuestas[key];
  else _formV2.respuestas[key] = val;
  btn.parentElement.querySelectorAll('button').forEach(b => {
    const bv = tipoCampoDe(c) === 'si_no' ? b.dataset.arg2 === 'true' : (c.opciones || [])[Number(b.dataset.arg2)];
    const on = _formV2.respuestas[key] === bv;
    b.classList.toggle('active', on); b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  actualizarProgresoV2();
}

async function saveEvaluacionV2(estado, evaluadoId) {
  if (!_formV2 || _formV2.evaluadoId !== evaluadoId) return;
  const faltan = _formV2.requeridas.filter(k => !_requeridoCumplido(k));
  if (estado === 'publicado' && faltan.length) {
    const nombres = faltan.map(k => _criteriosV2.find(c => c.key === k)?.nombre || k);
    showToast(`No se puede publicar: faltan ${faltan.length} obligatorio${faltan.length === 1 ? '' : 's'} (${nombres.slice(0, 3).join(', ')}${nombres.length > 3 ? '…' : ''}).`, 'error');
    return;
  }
  // Texto libre: se lee al guardar; sí/no y opciones ya están en _formV2.respuestas.
  const respuestas = { ..._formV2.respuestas };
  (_formV2.registro || []).filter(c => tipoCampoDe(c) === 'texto').forEach(c => {
    const v = (document.getElementById('reg-' + c.key)?.value || '').trim();
    if (v) respuestas[c.key] = v; else delete respuestas[c.key];
  });
  const comentarios = {};
  _formV2.claves.forEach(k => {
    const v = document.getElementById(`com-${k}`)?.value.trim();
    if (v) comentarios[k] = v;
  });
  const gen = document.getElementById('com-general')?.value.trim();
  if (gen) comentarios.general = gen;

  // modelo y perfil_id los fija el servidor; el bono no existe en v2.
  const res = await API.upsertEvaluacion({
    periodo_id: _activePE.id, evaluado_id: evaluadoId, evaluador_id: CU.id,
    puntajes: _formV2.puntajes, bono_ext: 0, comentarios, estado,
    // Solo con 0020 aplicada: sin la columna, mandarla haría fallar el guardado.
    respuestas: API.v2Dinamico(_criteriosV2) ? respuestas : null,
  });
  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  showToast(estado === 'publicado' ? 'Evaluación publicada' : 'Borrador guardado', 'ok');

  await loadEvalPEData();
  const [evNew, trabajos] = await Promise.all([
    API.getEvaluacion(_activePE.id, evaluadoId),
    API.getTrabajosEntregados(evaluadoId, _activePE?.id || null),
  ]);
  renderEvalFormV2(evNew, evaluadoId, trabajos);
}

/* ── TAB: USUARIOS ── */
function renderUsuariosPEBar() {
  const bar = document.getElementById('users-pe-btns'); if (!bar) return;
  if (!_periodos.length) {
    bar.innerHTML = '<span style="color:var(--muted);font-size:.8rem">Sin períodos.</span>';
    return;
  }
  if (!_activePEUsers) _activePEUsers = _periodos.find(p => p.activo) || _periodos[0];
  bar.innerHTML = _periodos.map(p =>
    `<button class="pb${p.id === _activePEUsers?.id ? ' active' : ''}" data-act="peUsers" data-arg="${p.id}">${escHtml(p.nombre)}</button>`
  ).join('');
}

async function selectUsersPE(periodoId, btn) {
  _activePEUsers = _periodos.find(p => p.id == periodoId);
  document.querySelectorAll('#users-pe-btns .pb').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _inactivosPE = new Set();
  invalidarPersonasRes();
  const rows = await API.getParticipantes(periodoId);
  rows.forEach(r => { if (!r.activo) _inactivosPE.add(r.user_id); });
  renderUsuarios();
}

function renderUsuarios() {
  renderPersonasCards();
  const el = document.getElementById('usuarios-list'); if (!el) return;
  const q = (document.getElementById('search-usuarios')?.value || '').toLowerCase().trim();
  const distFilter = (document.getElementById('filter-distrito-usuarios')?.value || '').trim();
  const list = _users.filter(u =>
    (!q || (u.nombre||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q) || (u.distrito||'').toLowerCase().includes(q)) &&
    (!distFilter
      || (distFilter === '__none__' ? !u.distrito : u.distrito === distFilter))
  );
  if (!list.length) {
    el.innerHTML = `<div class="empty-box"><div class="no-data-icon">${ICONS.users}</div><div class="empty-txt">${q || distFilter ? 'Sin resultados.' : 'Sin usuarios.'}</div></div>`;
    renderIconos(el);
    return;
  }
  const showPECol = !!_activePEUsers;
  // Las opciones salen del CATÁLOGO, no de los distritos ya asignados.
  // Con `new Set(_users.map(...))` un distrito sin nadie dentro no aparecía
  // nunca, así que no había forma de asignar el primero: 08-02 y 08-03
  // estaban en la base y eran inalcanzables desde el panel.
  const distOpts = _distritos;
  const filaCls = 'tbl--usuarios' + (showPECol ? ' tbl--usuarios-pe' : '');
  el.innerHTML = `
    <div class="tbl">
      <div class="tbl-head ${filaCls}">
        <div>Nombre</div><div>Email</div><div>Distrito</div><div>Tipo</div><div>Rol</div><div>Acceso</div><div>Admin</div>
        ${showPECol ? '<div>Estado PE</div>' : ''}
        <div></div>
      </div>
      <div class="tbl-body">
        ${list.map(u => {
          const inactivo = _inactivosPE.has(u.id);
          // `aprobado !== false` → si la migración 0001 aún no se aplicó el
          // campo es undefined y se muestra como aprobado, igual que el gate
          // de auth.js. Así el panel no miente antes de correr el SQL.
          const aprobado = u.aprobado !== false;
          return `
          <div class="tbl-row ${filaCls}">
            <div class="tbl-cell">
              <div class="avatar" style="width:28px;height:28px;font-size:.65rem;flex-shrink:0">${escHtml(initials(u.nombre||u.email))}</div>
              <span>${escHtml(u.nombre || '—')}</span>
            </div>
            <div class="tbl-cell tbl-muted">${escHtml(u.email)}</div>
            <div class="tbl-cell">
              <select class="cfg-inp cfg-select" style="padding:4px 8px;font-size:.78rem"
                aria-label="Distrito de ${escHtml(u.nombre || u.email)}"
                data-change="onCambioDistritoUsuario" data-arg="${u.id}">
                <option value="">—</option>
                ${distOpts.map(d => `<option value="${escHtml(d.id)}"${d.id===u.distrito?' selected':''}>${escHtml(d.nombre)}</option>`).join('')}
              </select>
            </div>
            <div class="tbl-cell">
              <select class="cfg-inp cfg-select" style="padding:4px 8px;font-size:.78rem"
                aria-label="Tipo de miembro de ${escHtml(u.nombre || u.email)}"
                data-change="onCambioTipoUsuario" data-arg="${u.id}">
                <option value="miembro"${'miembro'===u.tipo_miembro?' selected':''}>Miembro</option>
                <option value="secretario"${'secretario'===u.tipo_miembro?' selected':''}>Secretario</option>
              </select>
            </div>
            <div class="tbl-cell">
              <select class="cfg-inp cfg-select" style="padding:4px 8px;font-size:.8rem"
                aria-label="Rol de ${escHtml(u.nombre || u.email)}"
                data-change="onCambioRolUsuario" data-arg="${u.id}">
                ${_roles.map(r => `<option value="${r.id}"${r.id===u.rol_id?' selected':''}>${escHtml(r.nombre)}</option>`).join('')}
              </select>
            </div>
            <div class="tbl-cell">
              <button class="pe-toggle ${aprobado ? 'pe-toggle--on' : 'pe-toggle--off'}"
                data-act="aprobarUser" data-arg="${u.id}" data-arg2="${!aprobado}"
                title="${aprobado ? 'Revocar el acceso al portal' : 'Aprobar el acceso al portal'}">
                ${aprobado ? 'Aprobado' : 'Pendiente'}
              </button>
            </div>
            <div class="tbl-cell">
              <label class="toggle-switch" title="${u.es_admin?'Quitar admin':'Hacer admin'}">
                <input type="checkbox" ${u.es_admin?'checked':''}
                  aria-label="${u.es_admin?'Quitar':'Dar'} permisos de admin a ${escHtml(u.nombre || u.email)}"
                  data-change="onCambioAdminUsuario" data-arg="${u.id}">
                <span class="toggle-slider"></span>
              </label>
            </div>
            ${showPECol ? `
            <div class="tbl-cell">
              <button class="pe-toggle ${inactivo ? 'pe-toggle--off' : 'pe-toggle--on'}"
                data-act="participante" data-arg="${u.id}" data-arg2="${inactivo}"
                title="${inactivo ? 'Activar en este PE' : 'Desactivar en este PE'}">
                ${inactivo ? 'Inactivo' : 'Activo'}
              </button>
            </div>` : ''}
            <div class="tbl-cell">
              <button class="btn-icon btn-icon--danger" data-act="borrarUsuario" data-arg="${u.id}" title="Eliminar usuario">${ICONS.trash}</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  renderIconos(el);
}

/* ── Cambios en la tabla de usuarios ──────────────────────────────────
 * Cuatro `onchange=` inline vivían dentro de este template literal.
 * Sobrevivieron a los dos barridos anteriores porque uno buscaba `onclick`
 * y el otro solo miraba admin.html. Con script-src 'self' no se ejecutan:
 * cambiar distrito, tipo, rol o el toggle de admin no hacía NADA en
 * producción. Ahora van por el despachador delegado de config.js, que
 * llama f(elemento, evento).
 */
function onCambioDistritoUsuario(el) { updateUserField(el.dataset.arg, 'distrito', el.value); }
function onCambioTipoUsuario(el)     { updateUserField(el.dataset.arg, 'tipo_miembro', el.value); }
function onCambioRolUsuario(el)      { updateUserRol(el.dataset.arg, el.value); }
function onCambioAdminUsuario(el)    { updateUserAdmin(el.dataset.arg, el.checked); }

async function toggleParticipante(userId, eraInactivo) {
  if (!_activePEUsers) return;
  const nuevoActivo = eraInactivo; // invert: si era inactivo, ahora activo
  const res = await API.setParticipante(_activePEUsers.id, userId, nuevoActivo);
  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  if (nuevoActivo) {
    _inactivosPE.delete(userId);
    showToast('Usuario activado en este PE', 'ok');
  } else {
    _inactivosPE.add(userId);
    showToast('Usuario desactivado en este PE', 'ok');
  }
  renderUsuarios();
}

let _deleteUserId = null;

function confirmDeleteUser(userId) {
  const u = _users.find(x => x.id === userId);
  if (!u) return;
  _deleteUserId = userId;
  document.getElementById('modal-del-user-name').textContent = u.nombre || u.email;
  document.getElementById('modal-del-user-email').textContent = u.email;
  openModal('modal-del-user');
}

async function executeDeleteUser() {
  if (!_deleteUserId) return;
  const btn = document.querySelector('#modal-del-user .btn-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Eliminando…'; }
  const res = await API.deleteUserProfile(_deleteUserId);
  if (!res.ok) {
    showToast('Error: ' + res.error, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Eliminar'; }
    return;
  }
  _users = _users.filter(u => u.id !== _deleteUserId);
  _deleteUserId = null;
  closeModal('modal-del-user');
  if (btn) { btn.disabled = false; btn.textContent = 'Eliminar'; }
  populateDistritoFilters();
  renderUsuarios();
  showToast('Usuario eliminado', 'ok');
}

async function updateUserField(userId, field, value) {
  const res = await API.updateUserProfile(userId, { [field]: value });
  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  showToast(field === 'distrito' ? 'Distrito actualizado' : 'Tipo actualizado', 'ok');
  _users = _users.map(u => u.id === userId ? { ...u, [field]: value || null } : u);
  if (field === 'distrito') populateDistritoFilters();
  renderPersonasCards();
}

async function updateUserRol(userId, rolId) {
  const res = await API.updateUserRol(userId, Number(rolId));
  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  showToast('Rol actualizado', 'ok');
  _users = _users.map(u => u.id === userId ? { ...u, rol_id: Number(rolId) } : u);
  renderPersonasCards();
}

async function updateUserAprobado(userId, aprobado) {
  const res = await API.updateUserAprobado(userId, aprobado);
  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  showToast(aprobado ? 'Acceso aprobado' : 'Acceso revocado', 'ok');
  _users = _users.map(u => u.id === userId ? { ...u, aprobado } : u);
  renderUsuarios();
}

async function updateUserAdmin(userId, esAdmin) {
  const res = await API.updateUserAdmin(userId, esAdmin);
  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  showToast(esAdmin ? 'Usuario promovido a admin' : 'Permisos de admin retirados', 'ok');
  _users = _users.map(u => u.id === userId ? { ...u, es_admin: esAdmin } : u);
  renderPersonasCards();
}

/* ══ SELECTOR DE ENTRADA ═══════════════════════════════════════════════
 * Al abrir el panel, el admin elige gestión y período antes de que se
 * pinte nada. Antes se entraba siempre a la gestión activa y al período
 * activo, y para mirar otra cosa había que editar la URL a mano.
 *
 * La preferencia vive en localStorage bajo 'ec-admin-entrada', con forma
 * { omitir, gestionId, periodoId }. TODO acceso va en try/catch: config.js
 * ya documenta que puede estar bloqueado en modo privado.
 */
const ENTRADA_KEY = 'ec-admin-entrada';

function _leerEntrada() {
  try { return JSON.parse(localStorage.getItem(ENTRADA_KEY) || '{}') || {}; }
  catch { return {}; }        // bloqueado o JSON corrupto: se pregunta
}

function _guardarEntrada(v) {
  try { localStorage.setItem(ENTRADA_KEY, JSON.stringify(v)); }
  catch { /* modo privado: no persiste, pero la sesión funciona igual */ }
}

/** Borra la preferencia para que el selector vuelva a aparecer. */
function restablecerEntrada() {
  try { localStorage.removeItem(ENTRADA_KEY); } catch { /* modo privado */ }
  showToast('El selector volverá a aparecer la próxima vez que entres.', 'ok');
}

let _gestionesEntrada = [];

/**
 * Decide gestión y período ANTES de cargar datos.
 * Devuelve { gestionId, periodoId } o null si no hay nada que elegir.
 */
async function resolverEntrada() {
  // ?gestion= en la URL manda sobre todo lo demás: es un enlace explícito.
  const porUrl = new URLSearchParams(location.search).get('gestion');
  if (porUrl) return { gestionId: porUrl, periodoId: null };

  _gestionesEntrada = await API.getGestiones();
  if (!_gestionesEntrada.length) return null;

  const pref = _leerEntrada();
  if (pref.omitir) {
    const g = _gestionesEntrada.find(x => String(x.id) === String(pref.gestionId));
    if (g) return { gestionId: g.id, periodoId: pref.periodoId || null };
    // La gestión guardada ya no existe: se cae a la activa y se avisa, en
    // vez de dejar al admin mirando datos de otra sin saber por qué.
    showToast('La gestión guardada ya no existe. Se abrió la activa.', 'info');
    return null;
  }
  return await _preguntarEntrada();
}

/** Muestra el modal y espera. Resuelve con la elección. */
function _preguntarEntrada() {
  return new Promise(resolver => {
    _resolverEntrada = resolver;
    const sel = document.getElementById('ent-gestion');
    sel.innerHTML = _gestionesEntrada.map(g =>
      `<option value="${escHtml(String(g.id))}"${g.activa ? ' selected' : ''}>` +
      `${escHtml(g.nombre)}${g.activa ? ' (actual)' : g.archivada ? ' (solo lectura)' : ''}` +
      `</option>`).join('');
    onCambioGestionEntrada(sel);
    openModal('modal-entrada');
  });
}

let _resolverEntrada = null;

/** Al cambiar de gestión se recargan sus períodos. */
async function onCambioGestionEntrada(el) {
  const selP = document.getElementById('ent-periodo');
  selP.innerHTML = '<option>Cargando…</option>';
  selP.disabled = true;
  API.setGestion(el.value);
  let periodos = [];
  try { periodos = await API.getPeriodos(); }
  catch (e) { console.error('[entrada] periodos:', e); }
  selP.disabled = false;
  selP.innerHTML = periodos.length
    ? periodos.map(p =>
        `<option value="${escHtml(p.id)}"${p.activo ? ' selected' : ''}>` +
        `${escHtml(p.nombre)}${p.activo ? ' (activo)' : ''}</option>`).join('')
    : '<option value="">Esta gestión no tiene períodos</option>';
}

function _cerrarEntrada(eleccion) {
  const omitir = document.getElementById('ent-omitir')?.checked;
  _guardarEntrada({ omitir: !!omitir, ...eleccion });
  closeModal('modal-entrada');
  _resolverEntrada?.(eleccion);
  _resolverEntrada = null;
}

function entrarConSeleccion() {
  _cerrarEntrada({
    gestionId: document.getElementById('ent-gestion').value,
    periodoId: document.getElementById('ent-periodo').value || null,
  });
}

function entrarConPeriodoActivo() {
  _cerrarEntrada({ gestionId: document.getElementById('ent-gestion').value, periodoId: null });
}

/* ── TAB: ROLES ── */
const _TONOS_PESO = ['azul', 'verde', 'violeta', 'ambar', 'cian', 'coral', 'gris', 'rojo'];

function renderRoles() {
  const el = document.getElementById('roles-list'); if (!el) return;
  const q = (document.getElementById('search-roles')?.value || '').toLowerCase().trim();
  const list = _roles.filter(r => !q || (r.nombre || '').toLowerCase().includes(q));
  if (!list.length) {
    renderVacio(el, q ? 'Ningún rol coincide con "' + q + '".' : 'Aún no hay roles. Crea el primero con «Nuevo rol».');
    return;
  }
  const v2 = v2Disponible();
  const nombrePeriodo = id => _periodos.find(p => String(p.id) === String(id))?.nombre;
  const catalogo = Object.fromEntries(_criteriosV2.map(c => [c.key, c.nombre]));
  el.innerHTML = list.map(r => {
    const versiones = v2 ? _perfiles.filter(p => String(p.rol_id) === String(r.id)).sort((a, b) => b.version - a.version) : [];
    const gente = _users.filter(u => !u.es_admin && String(u.rol_id) === String(r.id)).length;
    const vigente = versiones[0];
    const barra = pf => {
      const cs = [...pf.perfil_criterios].sort((a, b) => b.peso - a.peso);
      return `<div class="pesos-bar" role="img" aria-label="Pesos de las competencias del rol">${cs.map((c, i) => `<i style="flex:${c.peso};--etq:var(--etq-${_TONOS_PESO[i % _TONOS_PESO.length]})" title="${escHtml(catalogo[c.criterio_key] || c.criterio_key)}: ${c.peso}"></i>`).join('')}</div>
        <ul class="pesos-leyenda">${cs.map((c, i) => `<li><span class="punto" style="--etq:var(--etq-${_TONOS_PESO[i % _TONOS_PESO.length]})"></span>${escHtml(catalogo[c.criterio_key] || c.criterio_key)} <b>${c.peso}</b></li>`).join('')}</ul>`;
    };
    return `
      <section class="tarjeta rol-card" aria-label="Rol ${escHtml(r.nombre)}">
        <div class="rol-cab">
          <div class="rol-id">
            <h3 class="rol-t">${escHtml(r.nombre)}</h3>
            <div class="rol-meta">
              <span>${gente} persona${gente === 1 ? '' : 's'}</span>
              <span class="etiqueta ${r.activo ? 'etq-verde' : 'etq-gris'}">${r.activo ? 'Activo' : 'Inactivo'}</span>
              ${v2 && r.activo && gente < 4 ? '<span class="etiqueta etq-ambar" title="Con menos de 4 personas no hay posición dentro del rol: se mide contra la rúbrica">Pocas personas</span>' : ''}
            </div>
          </div>
          <div class="rol-acc">
            ${v2 && r.activo ? `<button type="button" class="btn-cfg-add" data-act="modalPerfil" data-arg="${r.id}">${versiones.length ? 'Nueva versión del perfil' : 'Crear perfil'}</button>` : ''}
            <button type="button" class="btn-icon" data-act="modalRol" data-arg="${r.id}" title="Editar rol" aria-label="Editar rol ${escHtml(r.nombre)}"><i data-lucide="pencil"></i></button>
            <button type="button" class="btn-icon btn-icon--danger" data-act="borrarRol" data-arg="${r.id}" title="Eliminar rol" aria-label="Eliminar rol ${escHtml(r.nombre)}"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
        ${rolTextosHTML(r)}
        ${v2 && r.activo ? (vigente ? `
          <div class="rol-perfil">
            <div class="rol-perfil-t"><strong>Perfil vigente · versión ${vigente.version}</strong>
              <span>${vigente.vigente_desde_periodo ? 'rige desde ' + escHtml(nombrePeriodo(vigente.vigente_desde_periodo) || '—') : 'rige desde el inicio de la gestión'}</span></div>
            ${barra(vigente)}
          </div>
          ${versiones.length > 1 ? `<details class="v2-det rol-hist"><summary>Versiones anteriores (${versiones.length - 1})</summary>${versiones.slice(1).map(v => `<div class="rol-perfil"><div class="rol-perfil-t"><strong>Versión ${v.version}</strong><span>${v.vigente_desde_periodo ? 'rigió desde ' + escHtml(nombrePeriodo(v.vigente_desde_periodo) || '—') : 'rigió desde el inicio'}</span></div>${barra(v)}</div>`).join('')}</details>` : ''}`
          : '<div class="v2-nota v2-nota--regla" role="alert">Sin perfil: las personas con este rol no se pueden evaluar en períodos por roles.</div>') : ''}
      </section>`;
  }).join('');
  renderIconos(el);
}

/** Lo que significa el rol (0021): descripción siempre visible; responsabilidades y requisitos plegados
 *  (el detalle baja la carga sin esconder lo que hace falta para decidir). Sin texto, un aviso suave para el admin. */
function rolTextosHTML(r) {
  if (!API.rolesAmpliados(_roles)) return '';
  const lista = t => `<ul class="rol-lista">${lineasDeTexto(t).map(x => `<li>${escHtml(x)}</li>`).join('')}</ul>`;
  if (!r.descripcion && !r.responsabilidades && !r.requisitos) {
    return `<p class="rol-sin-texto">Sin descripción todavía. Escríbela en «Editar rol»: se muestra al asignar tareas y en Mi cuenta.</p>`;
  }
  return `<div class="rol-textos">
    ${r.descripcion ? `<p class="rol-desc">${escHtml(r.descripcion)}</p>` : ''}
    ${r.responsabilidades ? acordeonHTML({ id: 'rol-resp-' + r.id, titulo: 'Responsabilidades', cuerpo: lista(r.responsabilidades), extra: 'acordeon--compacto' }) : ''}
    ${r.requisitos ? acordeonHTML({ id: 'rol-req-' + r.id, titulo: 'Requisitos', cuerpo: lista(r.requisitos), extra: 'acordeon--compacto' }) : ''}
  </div>`;
}

/** Busca el rol por id en vez de recibir nombre y activo por argumento:
    así el botón solo necesita data-arg con el id. */
function showRolModal(id) {
  const r = _roles.find(x => String(x.id) === String(id)) || {};
  document.getElementById('mrol-id').value     = r.id || '';
  document.getElementById('mrol-nombre').value = r.nombre || '';
  document.getElementById('mrol-activo').checked = r.activo !== false;
  // Descripción, responsabilidades y requisitos (0021): si la migración no está, el bloque se oculta y se explica.
  const amp = API.rolesAmpliados(_roles);
  document.getElementById('mrol-textos').hidden = !amp;
  document.getElementById('mrol-sin-0021').hidden = amp;
  document.getElementById('mrol-desc').value = r.descripcion || '';
  document.getElementById('mrol-resp').value = r.responsabilidades || '';
  document.getElementById('mrol-req').value  = r.requisitos || '';
  setEl('modal-rol-title', r.id ? 'Editar rol' : 'Nuevo rol');
  document.getElementById('mrol-err').textContent = '';
  openModal('modal-rol');
}

async function saveRol() {
  const id     = document.getElementById('mrol-id').value;
  const nombre = document.getElementById('mrol-nombre').value.trim();
  const activo = document.getElementById('mrol-activo').checked;
  const err    = document.getElementById('mrol-err');
  if (!nombre) { err.textContent = 'Escribe un nombre.'; return; }

  const textos = API.rolesAmpliados(_roles) ? {
    descripcion: document.getElementById('mrol-desc').value,
    responsabilidades: document.getElementById('mrol-resp').value,
    requisitos: document.getElementById('mrol-req').value,
  } : {};
  const res = await API.saveRol({ id: id ? Number(id) : null, nombre, activo, ...textos });
  if (!res.ok) { err.textContent = res.error; return; }

  showToast(id ? 'Rol actualizado' : 'Rol creado', 'ok');
  closeModal('modal-rol');
  _roles = await API.getRoles(false);
  renderRoles();
  renderEvalUserSelect();
}

async function deleteRol(id) {
  if (!confirm('¿Eliminar este rol?')) return;
  const res = await API.deleteRol(id);
  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  showToast('Rol eliminado', 'ok');
  _roles = await API.getRoles(false);
  renderRoles();
}

/* ── TAB: PERÍODOS ── */
/** Estado de un período por sus fechas: pasado, en curso o próximo (o sin fechas). */
function _estadoPeriodo(p) {
  const hoy = new Date().toISOString().slice(0, 10);
  const ini = p.fecha_inicio, fin = p.fecha_jornada || p.fecha_entrega || p.fecha_fin_trabajo || p.fecha_inicio;
  if (!ini) return { k: 'sin', t: 'Sin fechas', etq: 'etq-gris' };
  if (hoy < ini) return { k: 'proximo', t: 'Próximo', etq: 'etq-azul' };
  if (hoy > fin) return { k: 'pasado', t: 'Terminado', etq: 'etq-gris' };
  return { k: 'curso', t: 'En curso', etq: 'etq-verde' };
}
const _fechaPer = f => { if (!f) return '—'; const [a, m, d] = String(f).slice(0, 10).split('-').map(Number); return d + ' ' + ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][m - 1] + ' ' + a; };

function renderPeriodos() {
  const el = document.getElementById('periodos-list'); if (!el) return;
  const q = (document.getElementById('search-periodos')?.value || '').toLowerCase().trim();
  const todos = [..._periodos].sort((a, b) => String(a.fecha_inicio || '9999').localeCompare(String(b.fecha_inicio || '9999')) || String(a.nombre).localeCompare(String(b.nombre), 'es', { numeric: true }));
  const list = todos.filter(p => !q || (p.nombre || '').toLowerCase().includes(q) || (p.descripcion || '').toLowerCase().includes(q));
  renderLineaPeriodos(todos);
  if (!list.length) { renderVacio(el, q ? 'Ningún período coincide con "' + q + '".' : 'Aún no hay períodos. Crea el primero con «Nuevo período».'); return; }
  const fila = p => {
    const est = _estadoPeriodo(p);
    const fechas = [['Inicio', p.fecha_inicio], ['Fin del trabajo', p.fecha_fin_trabajo], ['Entrega', p.fecha_entrega], ['Jornada', p.fecha_jornada]].filter(x => x[1]);
    return `<div class="fila-aj per-fila">
      <div class="fila-aj-txt">
        <div class="fila-aj-t">${escHtml(p.nombre)}${p.descripcion ? ` <span class="per-desc">${escHtml(p.descripcion)}</span>` : ''}</div>
        <div class="fila-aj-d">${fechas.length ? fechas.map(f => `${f[0]}: <b>${escHtml(_fechaPer(f[1]))}</b>`).join(' · ') : 'Define sus fechas para que aparezca en el calendario.'}</div>
      </div>
      <span class="etiqueta ${est.etq}">${est.t}</span>
      ${p.activo ? '<span class="etiqueta etq-coral">Activo</span>' : `<button type="button" class="btn--texto" data-act="activarPeriodo" data-arg="${p.id}">Activar</button>`}
      <div class="act-acc">
        <button type="button" class="btn-icon" data-act="modalPeriodo" data-arg="${p.id}" aria-label="Editar ${escHtml(p.nombre)}" title="Editar"><i data-lucide="pencil"></i></button>
        <button type="button" class="btn-icon btn-icon--danger" data-act="borrarPeriodo" data-arg="${p.id}" aria-label="Eliminar ${escHtml(p.nombre)}" title="Eliminar"><i data-lucide="trash-2"></i></button>
      </div>
    </div>`;
  };
  const grupo = (t, d, l) => l.length ? `<h2 class="cuenta-t">${t} <span class="cuenta-cont">${l.length}</span></h2><p class="cfg-hint rub-desc">${d}</p><div class="lista-aj">${l.map(fila).join('')}</div>` : '';
  const v2 = list.filter(p => p.modelo === 'v2'), cl = list.filter(p => p.modelo !== 'v2');
  el.innerHTML = grupo('Rúbrica por roles', 'Competencias comunes y del rol, con tareas como evidencia.', v2) +
    (v2.length && cl.length ? '<div style="height:var(--sec-main)"></div>' : '') +
    grupo('Clásicos', 'Períodos anteriores a la rúbrica por roles: conservan su evaluación original.', cl);
  renderIconos(el);
}

/**
 * Línea de tiempo: cada período como un tramo sobre un eje de meses, con la marca de hoy.
 * Los tramos que se pisan van en pistas distintas; el eje deja aire a ambos lados para que
 * un solo período no ocupe todo el ancho sin escala.
 */
function renderLineaPeriodos(todos) {
  const host = document.getElementById('periodos-linea'); if (!host) return;
  const con = todos.filter(p => p.fecha_inicio);
  if (con.length < 1) { host.innerHTML = ''; return; }
  const DIA = 86400000;
  const t = f => new Date(String(f).slice(0, 10) + 'T00:00:00').getTime();
  const fin = p => p.fecha_jornada || p.fecha_entrega || p.fecha_fin_trabajo || p.fecha_inicio;
  const ini0 = Math.min(...con.map(p => t(p.fecha_inicio)));
  const fin0 = Math.max(...con.map(p => t(fin(p))), Date.now());
  const aire = Math.max((fin0 - ini0) * 0.06, 10 * DIA);
  let min = ini0 - aire, max = fin0 + aire;
  if (max - min < 120 * DIA) { const falta = 120 * DIA - (max - min); min -= falta / 2; max += falta / 2; }
  const span = max - min;
  const pos = ms => (ms - min) / span * 100;
  // pistas: cada tramo va en la primera donde no pisa a otro
  const pistas = [];
  const tramos = [...con].sort((x, y) => t(x.fecha_inicio) - t(y.fecha_inicio)).map(p => {
    const ini = t(p.fecha_inicio), fn = Math.max(t(fin(p)), ini + DIA);
    let k = pistas.findIndex(ult => ult <= ini);
    if (k < 0) { k = pistas.length; pistas.push(0); }
    pistas[k] = fn;
    return { p, ini, fn, k };
  });
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const ticks = [];
  for (let d = new Date(min); ; ) {
    d = new Date(d.getFullYear(), d.getMonth() + (ticks.length ? 1 : 0), 1);
    if (!ticks.length && d.getTime() < min) { d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
    if (d.getTime() > max) break;
    ticks.push({ ms: d.getTime(), txt: MESES[d.getMonth()] + (d.getMonth() === 0 || !ticks.length ? ' ' + d.getFullYear() : '') });
    if (ticks.length > 60) break;
  }
  const hoy = Date.now();
  host.innerHTML = `<div class="per-linea-pista" style="--pistas:${pistas.length}" role="img" aria-label="Línea de tiempo de los períodos con fechas">
      ${ticks.map(k => `<i class="per-tick" style="left:${pos(k.ms)}%"></i><span class="per-mes" style="left:${pos(k.ms)}%">${escHtml(k.txt)}</span>`).join('')}
      ${tramos.map(({ p, ini, fn, k }) => {
        const l = pos(ini), w = Math.max(2, pos(fn) - l);
        const rango = _fechaPer(p.fecha_inicio).replace(/ [0-9]{4}$/, '') + ' – ' + _fechaPer(fin(p)).replace(/ [0-9]{4}$/, '');
        return `<div class="per-tramo${p.activo ? ' per-tramo--activo' : ''}" style="left:${l}%;width:${w}%;--pista:${k}" title="${escHtml(p.nombre)}: ${escHtml(_fechaPer(p.fecha_inicio))} – ${escHtml(_fechaPer(fin(p)))}"><b>${escHtml(p.nombre)}</b><span>${escHtml(rango)}</span></div>`;
      }).join('')}
      ${hoy >= min && hoy <= max ? `<i class="per-hoy" style="left:${pos(hoy)}%"></i><span class="per-hoy-t" style="left:${pos(hoy)}%">Hoy</span>` : ''}
    </div>`;
}

/** Propone las fechas de un período nuevo a partir del último: mismo largo, a continuación. */
function _fechasSugeridas() {
  const prev = [..._periodos].filter(p => p.fecha_inicio).sort((a, b) => String(b.fecha_inicio).localeCompare(String(a.fecha_inicio)))[0];
  if (!prev) return {};
  const d = x => x ? new Date(String(x).slice(0, 10) + 'T00:00:00') : null;
  const fmt = x => x ? x.toISOString().slice(0, 10) : '';
  const fin = d(prev.fecha_jornada || prev.fecha_entrega || prev.fecha_fin_trabajo || prev.fecha_inicio);
  const dias = Math.round((fin - d(prev.fecha_inicio)) / 86400000) + 1;
  const mover = x => { const dx = d(x); if (!dx) return ''; dx.setDate(dx.getDate() + dias); return fmt(dx); };
  return { inicio: mover(prev.fecha_inicio), finTrabajo: mover(prev.fecha_fin_trabajo), entrega: mover(prev.fecha_entrega), jornada: mover(prev.fecha_jornada) };
}

function showPeriodoModal(id) {
  const p = _periodos.find(x => String(x.id) === String(id)) || {};
  document.getElementById('mpe-id').value         = p.id || '';
  document.getElementById('mpe-nombre').value     = p.nombre || '';
  document.getElementById('mpe-desc').value       = p.descripcion || '';
  document.getElementById('mpe-inicio').value     = p.fecha_inicio || '';
  document.getElementById('mpe-fintrabajo').value = p.fecha_fin_trabajo || '';
  document.getElementById('mpe-entrega').value    = p.fecha_entrega || '';
  document.getElementById('mpe-jornada').value    = p.fecha_jornada || '';
  document.getElementById('mpe-activo').checked   = !!p.activo;
  if (!p.id) {   // nuevo: fechas propuestas a partir del período anterior
    const sg = _fechasSugeridas();
    document.getElementById('mpe-inicio').value     = sg.inicio || '';
    document.getElementById('mpe-fintrabajo').value = sg.finTrabajo || '';
    document.getElementById('mpe-entrega').value    = sg.entrega || '';
    document.getElementById('mpe-jornada').value    = sg.jornada || '';
  }
  // El modelo solo se ofrece si la migración 0015 está aplicada. Un período
  // nuevo arranca en v2 si ya hay perfiles; uno existente conserva el suyo.
  document.getElementById('mpe-modelo-field').hidden = !v2Disponible();
  document.getElementById('mpe-modelo').value = p.modelo || (_perfiles.length ? 'v2' : 'legacy');
  // Un período que ya existía antes de la rúbrica por roles conserva su
  // evaluación original: la base lo impide, aquí se explica en vez de ofrecerlo.
  const bloqueado = !!p.id && p.v2_permitido === false;
  document.getElementById('mpe-modelo').disabled = bloqueado;
  document.querySelectorAll('input[name="mpe-modelo-r"]').forEach(r => { r.checked = r.value === document.getElementById('mpe-modelo').value; r.disabled = bloqueado; });
  document.getElementById('mpe-modelo-ayuda').textContent = bloqueado
    ? 'Este período es anterior a la rúbrica por roles: conserva su evaluación original y no puede cambiar de modelo.'
    : 'No se puede cambiar una vez que el período tiene evaluaciones.';
  setEl('modal-periodo-title', p.id ? 'Editar período' : 'Nuevo período');
  document.getElementById('mpe-err').textContent = '';
  openModal('modal-periodo');
}

async function savePeriodo() {
  const id     = document.getElementById('mpe-id').value;
  const nombre = document.getElementById('mpe-nombre').value.trim();
  const desc   = document.getElementById('mpe-desc').value.trim();
  const activo = document.getElementById('mpe-activo').checked;
  const err    = document.getElementById('mpe-err');
  if (!nombre) { err.textContent = 'Escribe un nombre.'; return; }

  const fechas = {
    inicio:     document.getElementById('mpe-inicio').value     || null,
    finTrabajo: document.getElementById('mpe-fintrabajo').value || null,
    entrega:    document.getElementById('mpe-entrega').value    || null,
    jornada:    document.getElementById('mpe-jornada').value    || null,
  };

  const orden = [['inicio', 'inicio'], ['finTrabajo', 'fin del trabajo'], ['entrega', 'entrega'], ['jornada', 'jornada']].filter(([k]) => fechas[k]);
  for (let i = 1; i < orden.length; i++) {
    if (fechas[orden[i][0]] < fechas[orden[i - 1][0]]) { err.textContent = `La fecha de ${orden[i][1]} no puede ser anterior a la de ${orden[i - 1][1]}.`; return; }
  }
  const sel = document.querySelector('input[name="mpe-modelo-r"]:checked');
  if (sel && !document.getElementById('mpe-modelo').disabled) document.getElementById('mpe-modelo').value = sel.value;
  const res = await API.savePeriodo({
    id: id || null, nombre, descripcion: desc, fechas,
    // Un select deshabilitado (período anterior) no se envía: no se toca el modelo.
    modelo: v2Disponible() && !document.getElementById('mpe-modelo').disabled
      ? document.getElementById('mpe-modelo').value : null,
  });
  if (!res.ok) { err.textContent = res.error; return; }

  // El flag `activo` NO va en el update: lo cambia el RPC set_periodo_activo,
  // que desactiva el anterior y activa este en una sola operación. El bucle
  // JS anterior hacía N updates sueltos y podía dejar dos activos.
  const eraActivo = _periodos.find(p => String(p.id) === String(id))?.activo;
  if (activo) {
    const r = await API.setPeriodoActivo(res.id);
    if (!r.ok) { err.textContent = r.error; return; }
  } else if (eraActivo) {
    const r = await API.setPeriodoActivo(null);
    if (!r.ok) { err.textContent = r.error; return; }
  }

  showToast(id ? 'Período actualizado' : 'Período creado', 'ok');
  closeModal('modal-periodo');
  _periodos = await API.getPeriodos();
  _activePE = _periodos.find(p => p.activo) || _periodos[0];
  renderPeriodos();
  renderEvalPEBar();
}

async function deletePeriodo(id) {
  if (!confirm('¿Eliminar este período? Se perderán todas sus evaluaciones.')) return;
  const res = await API.deletePeriodo(id);
  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  showToast('Período eliminado', 'ok');
  _periodos = await API.getPeriodos();
  _activePE = _periodos.find(p => p.activo) || _periodos[0] || null;
  renderPeriodos();
  renderEvalPEBar();
}

/* ── TAB: RÚBRICA — criterios list ── */
function renderCriterios() {
  const el = document.getElementById('criterios-list'); if (!el) return;
  const q = (document.getElementById('search-criterios')?.value || '').toLowerCase().trim();
  const all = _criterios.length ? _criterios : [];
  const list = all.filter(c => !q ||
    (c.label||'').toLowerCase().includes(q) ||
    (c.key||'').toLowerCase().includes(q) ||
    (c.abbr||'').toLowerCase().includes(q));
  if (!list.length) {
    el.innerHTML = `<div class="empty-box"><div class="empty-txt">${q ? 'Sin resultados para "'+escHtml(q)+'".' : 'Sin criterios. Agrega el primero.'}</div></div>`;
    return;
  }
  el.innerHTML = `
    <div class="tbl">
      <div class="tbl-head"><div>Criterio</div><div>Orden</div><div>Estado</div><div>Acciones</div></div>
      <div class="tbl-body">
        ${list.map(c => `
          <div class="tbl-row">
            <div class="tbl-cell"><strong>${escHtml(c.label)}</strong></div>
            <div class="tbl-cell tbl-muted">${c.orden}</div>
            <div class="tbl-cell"><span class="estado-pill ${c.activo?'pill--ok':'pill--off'}">${c.activo?'Activo':'Inactivo'}</span></div>
            <div class="tbl-cell tbl-actions">
              <button class="btn-icon" data-act="modalCriterio" data-arg="${c.id}" title="Editar">${ICONS.edit}</button>
              <button class="btn-icon btn-icon--danger" data-act="borrarCriterio" data-arg="${c.id}" title="Eliminar">${ICONS.trash}</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  renderIconos(el);
}

function showCriterioModal(id) {
  const c = id ? _criterios.find(x => x.id == id) : null;
  document.getElementById('mcrit-id').value       = c?.id || '';
  document.getElementById('mcrit-label').value    = c?.label || '';
  document.getElementById('mcrit-key').value      = c?.key || '';
  document.getElementById('mcrit-color').value    = c?.color || '#888888';
  document.getElementById('mcrit-orden').value    = c?.orden ?? 99;
  document.getElementById('mcrit-activo').checked = c?.activo !== false;
  document.getElementById('mcrit-err').textContent = '';
  setEl('modal-criterio-title', id ? 'Editar criterio' : 'Nuevo criterio');
  openModal('modal-criterio');
}

async function saveCriterioEntry() {
  const id     = document.getElementById('mcrit-id').value;
  const label  = document.getElementById('mcrit-label').value.trim();
  const key    = document.getElementById('mcrit-key').value.trim();
  const abbr   = (document.getElementById('mcrit-abbr')?.value || label).trim().slice(0, 5).toUpperCase();
  const color  = document.getElementById('mcrit-color').value;
  const orden  = document.getElementById('mcrit-orden').value;
  const activo = document.getElementById('mcrit-activo').checked;
  const err    = document.getElementById('mcrit-err');
  if (!label) { err.textContent = 'Escribe el nombre del criterio.'; return; }
  if (!key)   { err.textContent = 'Escribe la clave interna (key).'; return; }

  const res = await API.saveCriterio({ id: id ? Number(id) : null, key, label, abbr, color, orden, activo });
  if (!res.ok) { err.textContent = res.error; return; }

  showToast(id ? 'Criterio actualizado' : 'Criterio creado', 'ok');
  closeModal('modal-criterio');
  _criterios = await API.getCriterios();
  Store.set({ criterios: _criterios });
  renderCriterios();
  renderRubrica();
}

async function deleteCriterioEntry(id) {
  if (!confirm('¿Eliminar este criterio? Se eliminarán también sus entradas de rúbrica.')) return;
  const res = await API.deleteCriterio(id);
  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  showToast('Criterio eliminado', 'ok');
  _criterios = await API.getCriterios();
  Store.set({ criterios: _criterios });
  _rubrica   = await API.getRubrica();
  renderCriterios();
  renderRubrica();
}

/* ── TAB: RÚBRICA — rubrica table ── */
function renderRubrica() {
  const el = document.getElementById('rubrica-admin-grid'); if (!el) return;
  const q = (document.getElementById('search-rubrica')?.value || '').toLowerCase().trim();
  const rubList = _rubrica.filter(r => !q ||
    (r.criterio||'').toLowerCase().includes(q) ||
    (r.criterios?.label||'').toLowerCase().includes(q) ||
    (r.criterios?.abbr||'').toLowerCase().includes(q));
  if (!rubList.length) {
    el.innerHTML = `<div class="empty-box"><div class="no-data-icon">${ICONS.ruler}</div><div class="empty-txt">${q ? 'Sin resultados para "'+escHtml(q)+'".' : 'Sin entradas de rúbrica. Agrega la primera.'}</div></div>`;
    renderIconos(el);
    return;
  }
  const levels = [
    { n:4, lbl:'Excelente', color:'var(--sex-txt)' },
    { n:3, lbl:'Bueno',     color:'var(--sbu-txt)' },
    { n:2, lbl:'En Proceso',color:'var(--spr-txt)' },
    { n:1, lbl:'Bajo',      color:'var(--sba-txt)' },
  ];
  const lk = { 4:'nivel4', 3:'nivel3', 2:'nivel2', 1:'nivel1' };
  el.innerHTML = rubList.map((r, i) => {
    const c     = r.criterios || {};
    const color = 'var(--criterio)';
    return `
      <div class="rubrica-card" id="rca-${i}">
        <div class="rubrica-card-head" data-act="abrirCerrar" data-arg="rca-${i}">
          <div class="rubrica-dot" style="background:${color}"></div>
          <div class="rubrica-title" style="color:${color}">${escHtml(r.criterio || c.label || '—')}</div>
          <span class="rubrica-chev"></span>
        </div>
        <div class="rubrica-body">
          <div class="rubrica-levels">
            ${levels.map(l => `<div class="rlevel"><div class="rlevel-badge" style="color:${escHtml(l.color)}">${l.n}</div><div class="rlevel-lbl" style="color:${escHtml(l.color)}">${l.lbl}</div><div class="rlevel-desc">${r[lk[l.n]] || '—'}</div></div>`).join('')}
          </div>
          <div style="display:flex;gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid var(--faint)">
            <button class="btn-icon" data-act="modalRubrica" data-arg="${r.id}" title="Editar entrada">${ICONS.edit}</button>
            <button class="btn-icon btn-icon--danger" data-act="borrarRubrica" data-arg="${r.id}" title="Eliminar">${ICONS.trash}</button>
          </div>
        </div>
      </div>`;
  }).join('');
  renderIconos(el);
}

function showRubricaModal(id) {
  const r = id ? _rubrica.find(x => x.id == id) : null;
  const critSel = document.getElementById('mrub-criterio');
  const allCrits = _criterios.length ? _criterios : getCriterios();
  critSel.innerHTML = '<option value="">Seleccionar criterio...</option>' +
    allCrits.map(c => `<option value="${c.id}" ${r?.criterio_id === c.id ? 'selected' : ''}>${escHtml(c.label)}</option>`).join('');

  document.getElementById('mrub-id').value    = r?.id || '';
  document.getElementById('mrub-n4').value    = r?.nivel4 || '';
  document.getElementById('mrub-n3').value    = r?.nivel3 || '';
  document.getElementById('mrub-n2').value    = r?.nivel2 || '';
  document.getElementById('mrub-n1').value    = r?.nivel1 || '';
  document.getElementById('mrub-orden').value = r?.orden ?? 99;
  document.getElementById('mrub-err').textContent = '';
  setEl('modal-rubrica-title', id ? 'Editar entrada de rúbrica' : 'Nueva entrada de rúbrica');
  openModal('modal-rubrica');
}

async function saveRubricaEntry() {
  const id         = document.getElementById('mrub-id').value;
  const criterio_id = document.getElementById('mrub-criterio').value;
  const nivel4     = document.getElementById('mrub-n4').value.trim();
  const nivel3     = document.getElementById('mrub-n3').value.trim();
  const nivel2     = document.getElementById('mrub-n2').value.trim();
  const nivel1     = document.getElementById('mrub-n1').value.trim();
  const orden      = document.getElementById('mrub-orden').value;
  const err        = document.getElementById('mrub-err');
  if (!criterio_id) { err.textContent = 'Selecciona un criterio.'; return; }

  const crit    = (_criterios.length ? _criterios : getCriterios()).find(c => c.id == criterio_id);
  const criterio = crit?.label || '';

  const res = await API.saveRubricaRow({ id: id ? Number(id) : null, criterio_id, criterio, nivel4, nivel3, nivel2, nivel1, orden });
  if (!res.ok) { err.textContent = res.error; return; }

  showToast(id ? 'Entrada actualizada' : 'Entrada creada', 'ok');
  closeModal('modal-rubrica');
  _rubrica = await API.getRubrica();
  renderRubrica();
}

async function deleteRubricaEntry(id) {
  if (!confirm('¿Eliminar esta entrada de rúbrica?')) return;
  const res = await API.deleteRubricaRow(id);
  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  showToast('Entrada eliminada', 'ok');
  _rubrica = await API.getRubrica();
  renderRubrica();
}

/* ── TAB: CALENDARIO ── */
function renderCalendario() {
  const el = document.getElementById('cal-editor-list'); if (!el) return;
  const q = (document.getElementById('search-calendario')?.value || '').toLowerCase().trim();
  const list = _calendario.filter(p => !q ||
    (p.titulo||'').toLowerCase().includes(q) ||
    String(p.numero||'').includes(q));
  if (!list.length) {
    el.innerHTML = `<div class="empty-box"><div class="no-data-icon">${ICONS.calendar}</div><div class="empty-txt">${q ? 'Sin resultados para "'+escHtml(q)+'".' : 'No hay eventos. Agrega el primero.'}</div></div>`;
    renderIconos(el);
    return;
  }
  const cAcc = { rojo:'cal-acc--rojo', verde:'cal-acc--verde', azul:'cal-acc--azul', amarillo:'cal-acc--amarillo' };
  const cT   = { rojo:'cal-t--rojo',   verde:'cal-t--verde',  azul:'cal-t--azul',   amarillo:'cal-t--amarillo' };
  el.innerHTML = `<div class="cal-grid">` +
    list.map(p => {
      const c    = (p.color || 'rojo').toLowerCase();
      const rows = [['Inicio',p.fecha_inicio],['Fin trabajo',p.fecha_fin_trabajo],
                    ['Entrega',p.fecha_entrega],['Jornada',p.fecha_jornada]].filter(([,v]) => v);
      return `
        <div class="cal-card">
          <div class="cal-acc ${cAcc[c] || cAcc.rojo}"></div>
          <div class="cal-body">
            <div class="cal-num">PERÍODO ${String(p.numero).padStart(2,'0')}</div>
            <div class="cal-t ${cT[c] || cT.rojo}">${escHtml(p.titulo)}</div>
            ${rows.map(([l,v]) => `<div class="cal-r"><span class="cal-rl">${l}</span><span>${v}</span></div>`).join('')}
            <div style="display:flex;gap:6px;margin-top:10px">
              <button class="btn-icon" data-act="modalCal" data-arg="${p.id}" title="Editar">${ICONS.edit}</button>
              <button class="btn-icon btn-icon--danger" data-act="borrarCal" data-arg="${p.id}" title="Eliminar">${ICONS.trash}</button>
            </div>
          </div>
        </div>`;
    }).join('') + `</div>`;
  renderIconos(el);
}

function showCalModal(id) {
  const p = id ? _calendario.find(c => c.id == id) : null;
  document.getElementById('mcal-id').value      = p?.id || '';
  document.getElementById('mcal-num').value     = p?.numero || '';
  document.getElementById('mcal-titulo').value  = p?.titulo || '';
  document.getElementById('mcal-color').value   = p?.color || 'rojo';
  document.getElementById('mcal-inicio').value  = p?.fecha_inicio || '';
  document.getElementById('mcal-fin').value     = p?.fecha_fin_trabajo || '';
  document.getElementById('mcal-entrega').value = p?.fecha_entrega || '';
  document.getElementById('mcal-jornada').value = p?.fecha_jornada || '';
  document.getElementById('mcal-estado').value  = p?.estado || 'pendiente';
  setEl('modal-cal-title', id ? 'Editar actividad' : 'Nueva actividad');
  document.getElementById('mcal-err').textContent = '';
  openModal('modal-cal');
}

async function saveCal() {
  const id  = document.getElementById('mcal-id').value;
  const err = document.getElementById('mcal-err');
  const ev  = {
    id:          id ? Number(id) : undefined,
    numero:      Number(document.getElementById('mcal-num').value) || 1,
    titulo:      document.getElementById('mcal-titulo').value.trim(),
    color:       document.getElementById('mcal-color').value,
    // Columnas `date`, no las de texto: getContexto() sirve estas a los
    // portales, asi que escribir en las de texto dejaba el calendario del
    // miembro en blanco mientras el admin veia las fechas.
    fecha_inicio:      document.getElementById('mcal-inicio').value.trim()   || null,
    fecha_fin_trabajo: document.getElementById('mcal-fin').value.trim()      || null,
    fecha_entrega:     document.getElementById('mcal-entrega').value.trim()  || null,
    fecha_jornada:     document.getElementById('mcal-jornada').value.trim()  || null,
    estado:      document.getElementById('mcal-estado').value,
  };
  if (!ev.titulo) { err.textContent = 'Escribe un título.'; return; }

  const res = await API.saveCalEvento(ev);
  if (!res.ok) { err.textContent = res.error; return; }

  showToast(id ? 'Actividad actualizada' : 'Actividad creada', 'ok');
  closeModal('modal-cal');
  _calendario = await API.getCalendario();
  renderCalendario();
}

async function deleteCal(id) {
  if (!confirm('¿Eliminar esta actividad del calendario?')) return;
  const res = await API.deleteCalEvento(id);
  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  showToast('Actividad eliminada', 'ok');
  _calendario = await API.getCalendario();
  renderCalendario();
}

/* ── TAB: DISTRITOS ── */
function renderDistPEBar() {
  const bar = document.getElementById('dist-pe-btns'); if (!bar) return;
  if (!_periodos.length) {
    bar.innerHTML = '<span style="color:var(--muted);font-size:.8rem">Sin períodos.</span>';
    return;
  }
  if (!_activePEDist) _activePEDist = _periodos.find(p => p.activo) || _periodos[0];
  bar.innerHTML = _periodos.map(p =>
    `<button class="pb${p.id === _activePEDist?.id ? ' active' : ''}" data-act="peDist" data-arg="${p.id}">${escHtml(p.nombre)}</button>`
  ).join('');
  renderDistritoSelect();
  renderDistritoRanking(_activePEDist?.id);
}

async function selectDistPE(periodoId, btn) {
  _activePEDist = _periodos.find(p => p.id == periodoId);
  document.querySelectorAll('#dist-pe-btns .pb').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderDistritoRanking(periodoId);
  if (_activeDistId) loadDistEval(_activeDistId);
}

function renderDistritoSelect() {
  const sel = document.getElementById('dist-eval-select'); if (!sel) return;
  sel.innerHTML = '<option value="">Seleccionar distrito...</option>' +
    _distritos.map(d => `<option value="${d.id}">${escHtml(d.nombre)}</option>`).join('');
}

/** Buscador de distritos: repinta el ranking del PE seleccionado. */
function buscarDistritos() { renderDistritoRanking(_activePEDist?.id); }

function onDistSelectChange() {
  const sel = document.getElementById('dist-eval-select'); if (!sel?.value) return;
  _activeDistId = sel.value;
  loadDistEval(sel.value);
}

async function renderDistritoRanking(periodoId) {
  const el = document.getElementById('dist-ranking'); if (!el) return;
  if (!periodoId) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';

  const distEvals = await API.getEvalDistritosByPE(periodoId);

  const q = (document.getElementById('search-distritos')?.value || '').toLowerCase().trim();
  const ranked = distEvals
    .filter(d => d.estado === 'publicado')
    .map(d => {
      const score    = calcDistScore(d.puntajes);
      const distInfo = _distritos.find(x => x.id === d.distrito_id);
      return { ...d, score, nombre: distInfo?.nombre || d.distrito_id };
    })
    .filter(d => !q || d.nombre.toLowerCase().includes(q))
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    el.innerHTML = `<div class="empty-box"><div class="empty-icon">${ICONS.map}</div><div class="empty-txt">${q ? 'Sin resultados para "'+escHtml(q)+'".' : 'Sin evaluaciones publicadas para este período.'}</div></div>`;
    renderIconos(el);
    return;
  }

  const posClass = ['gold','silver','bronze'];
  el.innerHTML = `
    <div class="tbl" style="max-width:700px;margin:0 auto">
      <div class="tbl-head" style="grid-template-columns:48px 1fr 80px 100px">
        <div>#</div><div>Distrito</div><div style="text-align:center">Puntos</div><div style="text-align:center">Nivel</div>
      </div>
      <div class="tbl-body">
        ${ranked.map((d, i) => `
          <div class="tbl-row" style="grid-template-columns:48px 1fr 80px 100px;cursor:pointer"
               data-act="elegirDistrito" data-arg="${escHtml(d.distrito_id)}">
            <div class="tbl-cell"><span class="rank-num ${posClass[i] || ''}">${i + 1}</span></div>
            <div class="tbl-cell"><strong>${escHtml(d.nombre)}</strong></div>
            <div class="tbl-cell" style="justify-content:center">
              <span class="num-display" style="color:${distScoreColor(d.score)}">${d.score}</span>
              <span style="font-size:.65rem;color:var(--muted);margin-left:3px">/ ${MAX_DIST}</span>
            </div>
            <div class="tbl-cell" style="justify-content:center"><span class="nivel-badge ${distScoreClass(d.score)}" style="padding:2px 8px;font-size:.55rem">${distScoreLabel(d.score)}</span></div>
          </div>`).join('')}
      </div>
    </div>`;
  renderIconos(el);
}

async function loadDistEval(distId) {
  const area = document.getElementById('dist-eval-area'); if (!area) return;
  if (!_activePEDist || !distId) { area.innerHTML = ''; return; }
  area.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';
  const [ev, historial] = await Promise.all([
    API.getEvalDistrito(_activePEDist.id, distId),
    API.getEvalDistritoHistorial(distId),
  ]);
  renderDistEvalForm(ev, distId, historial);
}

const _IG_FIELDS = [
  { key:'visualizaciones',     label:'Visualizaciones',    placeholder:'41,937' },
  { key:'cuentas_alcanzadas',  label:'Cuentas alcanzadas', placeholder:'9,251'  },
  { key:'visitas_perfil',      label:'Visitas al perfil',  placeholder:'1,325'  },
  { key:'seguidores',          label:'Seguidores (neto)',  placeholder:'+125'   },
  { key:'pct_publicaciones',   label:'Publicaciones %',    placeholder:'53.7'   },
  { key:'pct_historias',       label:'Historias %',        placeholder:'23.7'   },
  { key:'pct_reels',           label:'Reels %',            placeholder:'22.6'   },
];

function renderDistEvalForm(ev, distId, historial = []) {
  const area     = document.getElementById('dist-eval-area'); if (!area) return;
  const distrito = _distritos.find(d => d.id === distId);
  const puntajes = parseJSON(ev?.puntajes);
  const coms     = parseJSON(ev?.comentarios);
  const igStats  = parseJSON(ev?.ig_stats);
  const estado   = ev?.estado      || 'borrador';
  const isPub    = estado === 'publicado';

  const prevHistory = historial.filter(h => h.periodo_id !== _activePEDist?.id);
  const histHTML = prevHistory.length ? `
    <div class="section-label">Períodos anteriores</div>
    <div class="dist-hist-row">
      ${prevHistory.map(h => {
        const s = calcDistScore(h.puntajes);
        return `<div class="dist-hist-card">
          <div class="dist-hist-pe">${escHtml(h.periodos_evaluacion?.nombre || '—')}</div>
          ${DIST_CRITERIOS.map(c => `
            <div class="dist-hist-crit">
              <span class="dist-hist-abbr" style="color:var(--criterio)">${escHtml(c.label)}</span>
              <span class="dist-hist-val">${h.puntajes?.[c.key] ?? '—'}</span>
            </div>`).join('')}
          <div class="dist-hist-total" style="color:${distScoreColor(s)}">${s}<span style="font-size:.6rem;color:var(--muted);font-weight:400">/${MAX_DIST}</span></div>
          <span class="nivel-badge ${distScoreClass(s)}" style="font-size:.52rem">${distScoreLabel(s)}</span>
        </div>`;
      }).join('')}
    </div>` : '';

  const rows = DIST_CRITERIOS.map((c, i) => `
    <div class="eval-criterio-row" style="animation-delay:${i*30}ms">
      <div class="eval-crit-head">
        <div class="eval-crit-label">${escHtml(c.label)}</div>
      </div>
      <div class="eval-crit-inputs">
        <div class="escala-wrap">
          ${escalaHTML({ min: 0, max: 7, valor: puntajes[c.key] ?? null, accion: 'puntajeDist', key: c.key, nombre: c.label })}
          <input type="hidden" id="dsc-${c.key}" value="${puntajes[c.key]??0}">
        </div>
        <input class="cfg-inp eval-com-inp" type="text" id="dcom-${c.key}"
          placeholder="Comentario (opcional)" value="${escHtml(coms[c.key]||'')}">
      </div>
    </div>`).join('');

  area.innerHTML = `
    <div class="eval-form-card" style="max-width:800px;margin:0 auto">
      <div class="eval-form-header">
        <div>
          <div class="eval-miembro-name">${escHtml(distrito?.nombre || distId)}</div>
          <div class="eval-miembro-rol">Evaluación de distrito · ${escHtml(_activePEDist?.nombre || '')}</div>
        </div>
        <span class="eval-estado-badge estado--${estado}">${estado}</span>
      </div>

      ${histHTML}

      <div class="section-label" style="margin-top:4px">Estadísticas de Instagram</div>
      <div class="ig-stats-grid">
        ${_IG_FIELDS.map(f => `
          <div class="ig-stat-field">
            <label class="ig-stat-lbl">${escHtml(f.label)}</label>
            <input class="ig-stat-inp" type="text" id="ig-${f.key}"
              placeholder="${escHtml(f.placeholder)}" value="${escHtml(igStats[f.key] || '')}">
          </div>`).join('')}
      </div>

      <div class="section-label">Criterios de Distrito <span style="font-size:.7rem;color:var(--muted);font-weight:400">(puntaje 1–7 por criterio · máx. ${MAX_DIST} pts)</span></div>
      <div class="eval-criterios-list">${rows}</div>

      <div class="eval-extras">
        <label class="eval-extra-label">Notas / Comentario general</label>
        <textarea class="cfg-inp eval-com-inp" id="dcom-general" rows="3"
          placeholder="Notas del evaluador...">${escHtml(coms.general||'')}</textarea>
      </div>

      ${isPub
        ? `<div class="eval-pub-info">
             <span class="eval-pub-dot"></span>
             Evaluación publicada — visible en el ranking de distritos
           </div>
           <div class="eval-actions">
             <button class="btn-draft" data-act="guardarDist" data-arg="borrador" data-arg2="${distId}">Volver a borrador</button>
             <button class="btn-save btn-confirm" data-act="guardarDist" data-arg="publicado" data-arg2="${distId}">Confirmar cambios</button>
           </div>`
        : `<div class="eval-actions">
             <button class="btn-draft" data-act="guardarDist" data-arg="borrador" data-arg2="${distId}">Guardar borrador</button>
             <button class="btn-save btn-publish" data-act="guardarDist" data-arg="publicado" data-arg2="${distId}">Publicar</button>
           </div>`
      }
    </div>`;
}

function setDistScore(key, val, btn) {
  document.getElementById(`dsc-${key}`).value = val;
  escalaActualizar(btn.closest('.escala'), val);
}

async function saveDistEval(estado, distId) {
  if (!_activePEDist || !distId) return;
  const puntajes = {}, comentarios = {};
  DIST_CRITERIOS.forEach(c => {
    puntajes[c.key] = parseInt(document.getElementById(`dsc-${c.key}`)?.value || 0);
    const v = document.getElementById(`dcom-${c.key}`)?.value.trim();
    if (v) comentarios[c.key] = v;
  });
  const gen = document.getElementById('dcom-general')?.value.trim();
  if (gen) comentarios.general = gen;
  const ig_stats = {};
  _IG_FIELDS.forEach(f => {
    const v = document.getElementById(`ig-${f.key}`)?.value.trim();
    if (v) ig_stats[f.key] = v;
  });

  const res = await API.upsertEvalDistrito({
    periodo_id:  _activePEDist.id,
    distrito_id: distId,
    evaluador_id: CU.id,
    ig_stats, puntajes, comentarios, estado,
  });

  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  showToast(estado === 'publicado' ? 'Evaluación publicada' : 'Borrador guardado', 'ok');
  await loadDistEval(distId);
  renderDistritoRanking(_activePEDist.id);
}

/* Score helpers y modales → core/render.js.
   El admin usa calcScorePuntajes(puntajes, bono); los portales, calcScore(fila). */

/* ══════════════════════════════════════════════════
   TAB: OVERVIEW
   ══════════════════════════════════════════════════ */
function renderOvPEBar() {
  const bar = document.getElementById('ov-pe-btns'); if (!bar) return;
  if (!_periodos.length) { bar.innerHTML = '<span style="color:var(--muted);font-size:.8rem">Sin períodos.</span>'; return; }
  if (!_activePEOv) _activePEOv = _periodos.find(p => p.activo) || _periodos[0];
  bar.innerHTML = _periodos.map(p =>
    `<button class="pb${p.id === _activePEOv?.id ? ' active' : ''}" data-act="peOv" data-arg="${p.id}">${escHtml(p.nombre)}</button>`
  ).join('');
}

async function selectOvPE(periodoId, btn) {
  _activePEOv = _periodos.find(p => p.id == periodoId);
  document.querySelectorAll('#ov-pe-btns .pb').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  await loadOverview();
}

async function loadOverview() {
  const bodyEl = document.getElementById('ov-body'); if (!bodyEl) return;
  renderAtencion();
  if (!_activePEOv) {
    bodyEl.innerHTML = `<div class="empty-box"><div class="empty-txt">No hay períodos. Crea uno en la pestaña Períodos.</div></div>`;
    return;
  }
  // Panel nuevo (core: admin-panel.js): sirve a los dos modelos de rúbrica.
  PanelAdmin.invalidar(_activePEOv.id);
  await PanelAdmin.montar(bodyEl, _activePEOv);
  return;
  if (esPeriodoV2(_activePEOv)) { await renderResumenV2(bodyEl, _activePEOv); return; }
  bodyEl.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';
  const [evals, distEvals, participantes] = await Promise.all([
    API.getEvaluacionesByPE(_activePEOv.id),
    API.getEvalDistritosByPE(_activePEOv.id),
    API.getParticipantes(_activePEOv.id),
  ]);
  debug('[Overview] PE:', _activePEOv.nombre, '| evals:', evals.length, '| publicadas:', evals.filter(e=>e.estado==='publicado').length, '| distEvals:', distEvals.length, '| participantes:', participantes.length, '| inactivos:', participantes.filter(r=>!r.activo).length);
  _overviewEvals     = evals;
  _overviewDistEvals = distEvals;
  _ovInactivosPE     = new Set(participantes.filter(r => !r.activo).map(r => r.user_id));
  renderOverview();
}

function renderOverview() {
  const el = document.getElementById('ov-body'); if (!el) return;
  const criterios = getCriterios();
  const nonAdmins = _users.filter(u => !u.es_admin && !_ovInactivosPE.has(u.id));
  const pub       = _overviewEvals.filter(e => e.estado === 'publicado' && !_ovInactivosPE.has(e.evaluado_id));
  const MAX       = criterios.length * 4 + 2;

  const scored = pub.map(e => ({
    ...e,
    score: calcScorePuntajes(e.puntajes, e.bono_ext),
    user:  _users.find(u => u.id === e.evaluado_id),
  })).filter(e => e.user).sort((a, b) => b.score - a.score);

  const avgScore  = scored.length ? (scored.reduce((s,e) => s + e.score, 0) / scored.length).toFixed(1) : null;
  const topScore  = scored[0]?.score ?? null;
  const pending   = nonAdmins.filter(u => !pub.find(e => e.evaluado_id === u.id)).length;

  const dist = { sex:0, sbu:0, spr:0, sba:0 };
  scored.forEach(e => { const k = scoreClass(e.score); dist[k] = (dist[k]||0)+1; });

  const critAvg = criterios.map(c => {
    const vals = pub.map(e => Number(parseJSON(e.puntajes)[c.key])||0).filter(v => v > 0);
    return { ...c, avg: vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0 };
  });

  const recent = [...pub]
    .sort((a,b) => new Date(b.updated_at||b.created_at) - new Date(a.updated_at||a.created_at))
    .slice(0,6);

  const timeAgo = d => {
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff/60000), h = Math.floor(m/60), dy = Math.floor(h/24);
    return dy>0 ? `hace ${dy}d` : h>0 ? `hace ${h}h` : m>1 ? `hace ${m}m` : 'ahora';
  };

  el.innerHTML = `
    <div class="ov-kpi-grid">
      <div class="kpi-card">
        <div class="kpi-icon" style="color:var(--cyan)">${ICONS.users}</div>
        <div class="kpi-val">${nonAdmins.length}</div>
        <div class="kpi-lbl">Miembros</div>
        <div class="kpi-sub">${_roles.length} roles · ${_distritos.length} distritos</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon" style="color:var(--accent)">${ICONS.clipboard}</div>
        <div class="kpi-val">${pub.length}<span style="font-size:1rem;opacity:.5"> / ${nonAdmins.length}</span></div>
        <div class="kpi-lbl">Evaluados</div>
        <div class="kpi-sub" style="color:${pending>0?'var(--spr)':'var(--sex)'}">${pending} pendiente${pending!==1?'s':''}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon" style="color:var(--sbu-txt)">${ICONS.activity}</div>
        <div class="kpi-val" style="color:${avgScore?scoreColor(Number(avgScore)):'var(--muted)'}">${avgScore || '—'}</div>
        <div class="kpi-lbl">Score promedio</div>
        <div class="kpi-sub">Máx. ${MAX} pts</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon" style="color:var(--sex-txt)">${ICONS.award}</div>
        <div class="kpi-val" style="color:${topScore != null ? scoreColorTxt(topScore) : 'var(--txt-muted)'}">${topScore ?? '—'}</div>
        <div class="kpi-lbl">Mejor score</div>
        <div class="kpi-sub">${escHtml(scored[0]?.user?.nombre?.split(' ')[0] || '—')}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon" style="color:var(--spr-txt)">${ICONS.calendar}</div>
        <div class="kpi-val">${_periodos.length}</div>
        <div class="kpi-lbl">Períodos</div>
        <div class="kpi-sub">${_periodos.filter(p=>p.activo).length} activo(s)</div>
      </div>
    </div>

    <div class="ov-actions">
      <button class="ov-action-btn" data-act="tabSinBtn" data-arg="evaluar">${ICONS.zap} Evaluar</button>
      <button class="ov-action-btn" data-act="tabSinBtn" data-arg="usuarios">${ICONS.users} Usuarios</button>
      <button class="ov-action-btn" data-act="tabSinBtn" data-arg="distritos">${ICONS.map} Distritos</button>
      <button class="ov-action-btn" data-act="tabSinBtn" data-arg="periodos">${ICONS.calendar} Períodos</button>
      <button class="ov-action-btn" data-act="tabSinBtn" data-arg="calendario">${ICONS.calendar} Calendario</button>
      <button class="ov-action-btn" data-act="tabSinBtn" data-arg="rubrica">${ICONS.ruler} Rúbrica</button>
    </div>

    <div class="ov-cols">
      <div class="ov-panel">
        <div class="rank-panel-header">
          <div class="ov-panel-title" style="margin-bottom:0"><i data-lucide="trophy"></i> Ranking — ${escHtml(_activePEOv?.nombre || '')}</div>
          <div class="rank-tabs">
            <button class="rank-tab-btn${_rankingTab==='users'?' rank-tab-active':''}" data-act="rankTab" data-arg="users">Usuarios</button>
            <button class="rank-tab-btn${_rankingTab==='dist'?' rank-tab-active':''}" data-act="rankTab" data-arg="dist">Distritos</button>
          </div>
        </div>

        <div id="rank-users" style="${_rankingTab!=='users'?'display:none':''}">
        ${scored.length ? `<div class="ov-ranking">
          ${scored.map((e,i) => {
            const pct = Math.round(e.score/MAX*100);
            const medal = medallaHTML(i+1);
            return `<div class="rank-row">
              <div class="rank-pos">${medal}</div>
              <div class="rank-info">
                <div class="rank-name">${escHtml(e.user.nombre)}</div>
                <div class="rank-role">${escHtml(e.user.roles?.nombre||e.user.distrito||'—')}</div>
              </div>
              <div class="rank-bar-wrap"><div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%;background:${scoreColor(e.score)}"></div></div></div>
              <div class="rank-score" style="color:${scoreColorTxt(e.score)}">${e.score}</div>
              <span class="nivel-badge ${scoreClass(e.score)}" style="padding:2px 7px;font-size:.52rem">${scoreLabel(e.score)}</span>
            </div>`;
          }).join('')}
        </div>` : `<div class="empty-box" style="margin:0"><div class="empty-txt">Sin evaluaciones publicadas aún.</div></div>`}
        </div>

        <div id="rank-dist" style="${_rankingTab!=='dist'?'display:none':''}">
        ${(() => {
          const pubDist = _overviewDistEvals.filter(d => d.estado === 'publicado');
          const scoredDist = pubDist.map(d => ({
            ...d,
            score: calcDistScore(d.puntajes),
            distInfo: _distritos.find(x => x.id === d.distrito_id),
          })).sort((a,b) => b.score - a.score);
          if (!scoredDist.length) return `<div class="empty-box" style="margin:0"><div class="empty-txt">Sin evaluaciones de distrito publicadas.</div></div>`;
          return `<div class="ov-ranking">
            ${scoredDist.map((d,i) => {
              const pct = Math.round(d.score/MAX_DIST*100);
              const medal = medallaHTML(i+1);
              return `<div class="rank-row">
                <div class="rank-pos">${medal}</div>
                <div class="rank-info">
                  <div class="rank-name">${escHtml(d.distInfo?.nombre || d.distInfo?.codigo || 'Distrito '+d.distrito_id)}</div>
                  <div class="rank-role">${escHtml(d.distInfo?.codigo || '—')}</div>
                </div>
                <div class="rank-bar-wrap"><div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%;background:${distScoreColor(d.score)}"></div></div></div>
                <div class="rank-score" style="color:${distScoreColor(d.score)}">${d.score}</div>
                <span class="nivel-badge ${distScoreClass(d.score)}" style="padding:2px 7px;font-size:.52rem">${distScoreLabel(d.score)}</span>
              </div>`;
            }).join('')}
          </div>`;
        })()}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="ov-panel">
          <div class="ov-panel-title">Distribución por nivel</div>
          ${[
            {key:'sex',lbl:'Excelente',color:'var(--sex)'},
            {key:'sbu',lbl:'Bueno',color:'var(--sbu)'},
            {key:'spr',lbl:'En Proceso',color:'var(--spr)'},
            {key:'sba',lbl:'Bajo',color:'var(--sba)'},
          ].map(l => {
            const n   = dist[l.key]||0;
            const pct = scored.length ? Math.round(n/scored.length*100) : 0;
            return `<div class="level-dist-row">
              <div class="level-dist-lbl" style="color:var(--${l.key}-txt)">${l.lbl}</div>
              <div class="level-dist-bar"><div class="level-dist-fill" style="width:${pct}%;background:${escHtml(l.color)}"></div></div>
              <div class="level-dist-num">${n}</div>
            </div>`;
          }).join('')}
        </div>

        <div class="ov-panel">
          <div class="ov-panel-title">Actividad reciente</div>
          ${recent.length ? recent.map(e => {
            const user = _users.find(u=>u.id===e.evaluado_id);
            const evtr = _users.find(u=>u.id===e.evaluador_id);
            const sc   = calcScorePuntajes(e.puntajes, e.bono_ext);
            const d    = e.updated_at||e.created_at;
            return `<div class="activity-item">
              <div class="activity-dot" style="background:${scoreColor(sc)}"></div>
              <div class="activity-body">
                <div class="activity-text">${escHtml(user?.nombre||'—')}</div>
                <div class="activity-sub">Por ${escHtml(evtr?.nombre||'Admin')} · ${d?timeAgo(d):'—'}</div>
              </div>
              <div class="rank-score" style="color:${scoreColorTxt(sc)}">${sc}</div>
            </div>`;
          }).join('') : `<div class="empty-box" style="margin:0"><div class="empty-txt">Sin actividad aún.</div></div>`}
        </div>
      </div>
    </div>

    <div class="ov-panel">
      <div class="ov-panel-title">Rendimiento por criterio — promedio del período</div>
      <div class="crit-bars-grid">
        ${critAvg.map(c => `
          <div class="crit-bar-row">
            <div style="flex:1;min-width:0">
              <div class="crit-bar-name">${escHtml(c.label)}</div>
              <div class="crit-bar-bg"><div class="crit-bar-fill" style="width:${pctBarra(c.avg, c)}%;background:var(--criterio)"></div></div>
            </div>
            <div class="crit-bar-val">${c.avg?c.avg.toFixed(1):'—'}<span style="font-size:.6rem;color:var(--muted)"> /4</span></div>
          </div>`).join('')}
      </div>
    </div>
  `;
  renderIconos(el);
}

function switchRankTab(tab) {
  _rankingTab = tab;
  const users = document.getElementById('rank-users');
  const dist  = document.getElementById('rank-dist');
  if (users) users.style.display = tab === 'users' ? '' : 'none';
  if (dist)  dist.style.display  = tab === 'dist'  ? '' : 'none';
  document.querySelectorAll('.rank-tab-btn').forEach(b => b.classList.remove('rank-tab-active'));
  document.querySelectorAll('.rank-tab-btn').forEach((b,i) => {
    if ((i===0&&tab==='users')||(i===1&&tab==='dist')) b.classList.add('rank-tab-active');
  });
}

/* ══════════════════════════════════════════════════
   TAB: PERFILES (rúbrica v2)
   Cada rol se evalúa con el núcleo transversal más sus criterios técnicos;
   los pesos suman 100 y esa suma la valida la base. Un perfil que ya se usó
   no se edita: se crea una versión nueva que rige desde un período posterior
   (crear_perfil_rol). Editar en caliente movería rankings hacia atrás sin
   que nadie haya sido evaluado de nuevo.
   ══════════════════════════════════════════════════ */

/** ¿Está aplicada la migración 0015? Sin ella no hay catálogo ni columna. */
const v2Disponible = () => _criteriosV2.length > 0 || (_periodos[0] && 'modelo' in _periodos[0]);

/** Los perfiles ahora viven dentro de la tarjeta de cada rol. */
function renderPerfiles() { renderRoles(); renderCatalogoV2(); }

let _rubVista = '';
function renderRubricaTab() {
  const hay = v2Disponible() && _criteriosV2.length;
  if (!_rubVista) _rubVista = hay ? 'roles' : 'clasica';
  const seg = document.getElementById('rubrica-seg');
  if (seg) {
    seg.innerHTML = segHTML([{ k: 'roles', etiqueta: 'Por roles' }, { k: 'clasica', etiqueta: 'Clásica' }], _rubVista, 'rubricaVista', { etiqueta: 'Tipo de rúbrica', prefijo: 'rub' });
  }
  document.getElementById('rubrica-roles').hidden = _rubVista !== 'roles';
  document.getElementById('rubrica-clasica').hidden = _rubVista !== 'clasica';
  renderCatalogoV2();
}

/** Competencias comunes y del rol, con sus anclas 1-3-5 a un clic; con 0020, también gestión (admin-criterios.js). */
function renderCatalogoV2() { CriteriosAdmin.pintar(); }

/* La versión de solo lectura anterior a 0020 ya no se usa: se conserva el nombre por si algo la referencia. */
function _renderCatalogoV2Antiguo() {
  const cat = document.getElementById('catalogo-v2'); if (!cat) return;
  if (!v2Disponible() || !_criteriosV2.length) {
    renderVacio(cat, 'La rúbrica por roles aún no está activada en la base de datos (migración 0015).');
    return;
  }
  const grupo = (titulo, desc, tipo) => {
    const lista = _criteriosV2.filter(c => c.tipo === tipo);
    return `<h2 class="cuenta-t">${titulo} <span class="cuenta-cont">${lista.length}</span></h2>
      <p class="cfg-hint rub-desc">${desc}</p>
      <div class="lista-aj">${lista.map(c => `
        <details class="rub-crit"><summary class="fila-aj">
          <div class="fila-aj-txt"><div class="fila-aj-t">${escHtml(c.nombre)}</div></div>
          <span class="fila-aj-ind"><i data-lucide="chevron-down"></i></span>
        </summary><div class="rub-anclas">${descriptoresHTML(c)}</div></details>`).join('')}</div>`;
  };
  cat.innerHTML = grupo('Competencias comunes', 'Las mismas para todos los roles; se comparan en valor absoluto.', 'nucleo') +
    '<div style="height:var(--sec-main)"></div>' +
    grupo('Competencias del rol', 'Cada rol usa las suyas, con el peso que le da su perfil.', 'tecnico');
  renderIconos(cat);
}

function showPerfilModal(rolId) {
  if (!v2Disponible()) { showToast('Aplica primero la migración 0015.', 'error'); return; }
  const sel = document.getElementById('mpf-rol');
  sel.innerHTML = _roles.filter(r => r.activo)
    .map(r => `<option value="${r.id}">${escHtml(r.nombre)}</option>`).join('');
  if (rolId != null && rolId !== '') sel.value = String(rolId);

  // Por defecto entra en vigor el período siguiente al activo (o el último).
  const activo = _periodos.findIndex(p => p.activo);
  const sugerido = _periodos[Math.min(activo + 1, _periodos.length - 1)] || _periodos[_periodos.length - 1];
  document.getElementById('mpf-desde').innerHTML = _periodos
    .map(p => `<option value="${p.id}">${escHtml(p.nombre)}</option>`).join('');
  if (sugerido) document.getElementById('mpf-desde').value = sugerido.id;

  document.getElementById('mpf-pesos').innerHTML = CriteriosAdmin.pesosHTML();
  document.getElementById('mpf-err').textContent = '';
  cambiarRolPerfil();
  openModal('modal-perfil');
}

/** Al elegir rol: rellena con la última versión y decide si hay "desde". */
function cambiarRolPerfil() {
  const rolId = document.getElementById('mpf-rol').value;
  const previas = _perfiles.filter(p => String(p.rol_id) === String(rolId)).sort((a, b) => b.version - a.version);
  const ultima = previas[0];
  document.querySelectorAll('#mpf-pesos input').forEach(i => { i.value = ''; });
  (ultima?.perfil_criterios || []).forEach(c => {
    const i = document.getElementById('mpf-w-' + c.criterio_key);
    if (i) i.value = c.peso;
  });
  document.getElementById('mpf-desde-field').hidden = !ultima;
  setEl('modal-perfil-title', ultima ? `Nueva versión (v${ultima.version + 1})` : 'Nuevo perfil (versión 1)');
  actualizarSumaPerfil();
}

function _pesosDelModal() {
  const pesos = {};
  document.querySelectorAll('#mpf-pesos input').forEach(i => {
    const n = parseInt(i.value, 10);
    if (Number.isFinite(n) && n > 0) pesos[i.dataset.key] = n;
  });
  return pesos;
}

function actualizarSumaPerfil() {
  const suma = Object.values(_pesosDelModal()).reduce((a, b) => a + b, 0);
  const el = document.getElementById('mpf-suma'); if (!el) return;
  el.textContent = suma;
  el.parentElement.classList.toggle('v2-faltan', suma !== 100);
  document.getElementById('mpf-estado').textContent =
    suma === 100 ? 'Suma correcta' : suma < 100 ? `faltan ${100 - suma}` : `sobran ${suma - 100}`;
}

async function savePerfil() {
  const err   = document.getElementById('mpf-err');
  const rolId = Number(document.getElementById('mpf-rol').value);
  const pesos = _pesosDelModal();
  const suma  = Object.values(pesos).reduce((a, b) => a + b, 0);
  if (!rolId) { err.textContent = 'Elige un rol.'; return; }
  if (suma !== 100) { err.textContent = `Los pesos deben sumar exactamente 100 (suman ${suma}).`; return; }

  const hayPrevias = _perfiles.some(p => Number(p.rol_id) === rolId);
  const res = await API.crearPerfilRol({
    rolId, pesos,
    vigenteDesde: hayPrevias ? document.getElementById('mpf-desde').value : null,
  });
  // Los mensajes de la base ya vienen redactados (período con evaluaciones,
  // suma, etc.); se muestran tal cual.
  if (!res.ok) { err.textContent = res.error; return; }

  showToast('Perfil guardado', 'ok');
  closeModal('modal-perfil');
  _perfiles = await API.getPerfiles();
  Store.set({ perfiles: _perfiles });
  renderPerfiles();
}

/* ── Resumen de un período v2 (Overview y Reportes) ──
 * El cálculo viene de la base; esto solo lo presenta. */
async function renderResumenV2(el, periodo) {
  el.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';
  const res = await API.getResultadosV2(periodo.id);
  if (!res.ok) { renderError(el, res.error, () => renderResumenV2(el, periodo)); return; }
  const rows = res.rows;
  const part = await API.getParticipantes(periodo.id).catch(() => []);
  const inactivos = new Set(part.filter(r => !r.activo).map(r => r.user_id));
  const conResultado = new Set(rows.map(r => r.evaluado_id));
  // Un desactivado sin resultado no cuenta como pendiente; si tiene resultado, cuenta como evaluado.
  const total = _users.filter(u => !u.es_admin && (!inactivos.has(u.id) || conResultado.has(u.id))).length;
  const prom = rows.length ? rows.reduce((s, r) => s + (r.individual || 0), 0) / rows.length : null;
  const top  = rows.length ? Math.max(...rows.map(r => r.individual ?? 0)) : null;
  const kpi = (lbl, val, color) => `
    <div class="v2-kpi"><div class="v2-kpi-val">${val}</div><div class="v2-kpi-lbl">${lbl}</div></div>`;
  el.innerHTML = `
    <div class="v2-kpis">
      ${kpi('Evaluados', `${rows.length}<span>/${total}</span>`)}
      ${kpi('Pendientes', Math.max(0, total - rows.length))}
      ${kpi('Promedio individual', prom == null ? '—' : fmtV2(prom), prom == null ? null : scoreColorTxtV2(prom))}
      ${kpi('Mejor individual', top == null ? '—' : fmtV2(top), top == null ? null : scoreColorTxtV2(top))}
    </div>
    ${rankingV2HTML(rows)}`;
}

/* ══════════════════════════════════════════════════
   TAB: TAREAS
   La lista, los modales y las reglas viven en core/tareas.js; las reglas de
   verdad (quién pasa de qué estado a cuál) las impone la base.
   ══════════════════════════════════════════════════ */
let _activePETareas = null;

/* ── TAB: EQUIPOS (core/equipos.js + core/evaluacion-perfil.js) ── */
function abrirEquipos() {
  const host = document.getElementById('eq-host'); if (!host) return;
  Equipos.montarAdmin(host, {
    yo: CU.id, periodos: _periodos, distritos: (typeof _distritos !== 'undefined' ? _distritos : []).map(d => ({ nombre: d.nombre ?? d })),
    personas: _users.filter(u => !u.es_admin).map(u => ({ id: u.id, nombre: u.nombre || u.email, email: u.email, distrito: u.distrito, rol_nombre: u.rol_nombre || u.roles?.nombre || '' })),
    onCambio: () => { if (typeof PanelAdmin !== 'undefined') _periodos.forEach(p => PanelAdmin.invalidar?.(p.id)); },
  });
}

function abrirTareas() {
  if (!_periodos.length) {
    document.getElementById('tareas-lista').innerHTML = '<div class="empty-box"><div class="empty-txt">No hay períodos. Crea uno en Períodos.</div></div>';
    return;
  }
  if (!_activePETareas) _activePETareas = _periodos.find(p => p.activo) || _periodos[0];
  const bar = document.getElementById('tareas-pe-btns');
  bar.innerHTML = _periodos.map(p =>
    `<button class="pb${p.id === _activePETareas.id ? ' active' : ''}" data-act="peTareas" data-arg="${p.id}">${escHtml(p.nombre)}</button>`).join('');
  montarTareas();
}

function selectTareasPE(periodoId, btn) {
  _activePETareas = _periodos.find(p => String(p.id) === String(periodoId)) || _activePETareas;
  document.querySelectorAll('#tareas-pe-btns .pb').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  montarTareas();
}

function montarTareas() {
  // Las tareas existen solo en los períodos nuevos (rúbrica por roles).
  if (!esPeriodoV2(_activePETareas)) {
    document.getElementById('tareas-lista').innerHTML =
      '<div class="empty-box"><div class="empty-txt">Las tareas están disponibles en los períodos nuevos, con la rúbrica por roles. Este período conserva su forma de entrega original: elige uno más reciente.</div></div>';
    return;
  }
  const hostEq = document.getElementById('tareas-equipo-host');
  if (hostEq) Equipos.montarTareas(hostEq, { periodoId: _activePETareas.id, yo: CU.id, esAdmin: true, periodos: _periodos, personas: _users.filter(u => !u.es_admin).map(u => ({ id: u.id, nombre: u.nombre || u.email })) });
  Tareas.montar({
    id: 'adm-tareas', el: document.getElementById('tareas-lista'),
    periodoId: _activePETareas.id, yo: CU.id, revisor: true, esAdmin: true,
    personas: _users.filter(u => !u.es_admin).map(u => ({ id: u.id, nombre: u.nombre || u.email })),
    onNoDisponible: () => renderVacio(document.getElementById('tareas-lista'),
      'Las tareas aún no están activadas en la base de datos (migración 0016).'),
  });
}

/* ── TABS ── */
/* Operación suelta; todo lo de configuración cuelga del engranaje, cuyo
   botón padre es `periodos`. */
const _tabParentMap = {
  cuenta:'cuenta',
  agenda: 'agenda',
  overview:'overview', evaluar:'evaluar', tareas:'tareas', usuarios:'usuarios', equipos:'equipos', reportes:'reportes', seguimiento:'seguimiento',
  periodos:'periodos', calendario:'periodos', rubrica:'periodos', perfiles:'periodos',
  roles:'periodos', distritos:'periodos', gestiones:'periodos',
};

/* ── TAB: GESTIONES ──────────────────────────────────────────────────
 * Cada gestión es un contenedor estanco: sus períodos, criterios, rúbrica
 * y calendario le pertenecen. Lo pasado se lee siempre, se escribe nunca —
 * lo garantiza gestion_escribible() en el WITH CHECK de las policies.
 */
let _gestiones = [];

async function renderGestiones() {
  const el = document.getElementById('gestiones-list'); if (!el) return;
  _gestiones = await API.getGestiones();

  if (!_gestiones.length) {
    renderVacio(el, 'No hay gestiones configuradas.');
    return;
  }

  el.innerHTML = `
    <div class="tbl">
      <div class="tbl-head"><div>Gestión</div><div>Estado</div><div>Períodos</div><div></div></div>
      <div class="tbl-body">
        ${_gestiones.map(g => `
          <div class="tbl-row">
            <div class="tbl-cell"><strong>${escHtml(g.nombre)}</strong></div>
            <div class="tbl-cell">
              <span class="estado-pill ${g.activa ? 'pill--ok' : 'pill--off'}">
                ${g.activa ? 'Activa' : g.archivada ? 'Archivada' : 'Inactiva'}
              </span>
            </div>
            <div class="tbl-cell tbl-muted">${g.activa ? 'en curso' : 'solo lectura'}</div>
            <div class="tbl-cell tbl-actions">
              <a class="btn-icon" href="admin.html?gestion=${encodeURIComponent(g.id)}"
                 aria-label="Ver la gestión ${escHtml(g.nombre)}" title="Ver esta gestión">${ICONS.search}</a>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  renderIconos(el);
}

function showAbrirGestionModal() {
  document.getElementById('mg-nombre').value = '';
  document.getElementById('mg-err').textContent = '';
  openModal('modal-gestion');
}

async function confirmarAbrirGestion() {
  const nombre = document.getElementById('mg-nombre').value.trim();
  const err    = document.getElementById('mg-err');
  if (!nombre) { err.textContent = 'Escribe el nombre de la gestión.'; return; }

  const actual = _gestiones.find(g => g.activa);
  if (!confirm(
    `Se archivará "${actual?.nombre ?? 'la gestión actual'}" y se abrirá "${nombre}".\n\n` +
    'La gestión archivada seguirá siendo consultable, pero no se podrá modificar. ¿Continuar?'
  )) return;

  const res = await API.abrirGestion(nombre);
  if (!res.ok) { err.textContent = res.error; return; }

  closeModal('modal-gestion');
  showToast('Gestión abierta', 'ok');
  location.assign('admin.html');
}

function switchTabAdminHooks(tab) {
  if (tab === 'calendario') Actividades.abrir();
  if (tab === 'rubrica') renderRubricaTab();
  if (tab === 'roles') renderRoles();
  if (tab === 'cuenta') Cuenta.montar(document.getElementById('cuenta-host'), CU);
  if (tab === 'agenda' && Store.necesitaCarga('agenda')) {
    Store.marcarCargado('agenda');
    Calendario.montar({ el: document.getElementById('agenda-host'), yo: CU.id, modo: 'admin', distritos: _distritos, personas: _users.filter(u => !u.es_admin).map(u => ({ id: u.id, nombre: u.nombre || u.email })) });
  }
  if (tab === 'gestiones') renderGestiones();
  if (tab === 'perfiles') renderPerfiles();
  if (tab === 'tareas') abrirTareas();
  if (tab === 'equipos') abrirEquipos();
  if (tab === 'overview' && Store.necesitaCarga('overview')) {
    Store.marcarCargado('overview'); loadOverview();
  }
  if (tab === 'reportes') Reportes.abrir();
  if (tab === 'seguimiento') { Seguimiento.invalidar(); Seguimiento.montar(document.getElementById('seguimiento-host'), { modo: 'admin' }); }
}

function switchTab(tab, btn) {
  if (tab === 'perfiles') tab = 'roles';   // Perfiles vive dentro de Roles y perfiles
  switchTabCore(tab, btn, { contentSelector: '.atab-content', parentMap: _tabParentMap });
  switchTabAdminHooks(tab);
}

function switchTabMobile(tab, btn) { switchTabMobileCore(tab, btn, switchTab); }

function toggleMobGroup(header) {
  header.classList.toggle('open');
}

/* ── TAB: REPORTES ── */
function renderRptPEBar() {
  const bar = document.getElementById('rpt-pe-btns'); if (!bar) return;
  if (!_periodos.length) { bar.innerHTML = '<span style="color:var(--muted);font-size:.8rem">Sin períodos.</span>'; return; }
  bar.innerHTML = _periodos.map(p =>
    `<button class="pb rpt-pe-btn${_rptPE?.id===p.id?' active eval-pe-btn--active':''}" data-act="peRpt" data-arg="${p.id}">${escHtml(p.nombre)}</button>`
  ).join('');
}

let _rptInactivos = new Set();
async function selectRptPE(periodoId, _btn) {
  _rptPE = _periodos.find(p => p.id == periodoId) || null;
  document.querySelectorAll('#rpt-pe-btns .rpt-pe-btn').forEach(b => b.classList.remove('eval-pe-btn--active', 'active'));
  _btn?.classList.add('eval-pe-btn--active', 'active');
  if (!_rptEvals[periodoId]) {
    document.getElementById('rpt-body').innerHTML = '<div class="loading-box"><span class="spin"></span></div>';
    _rptEvals[periodoId] = await API.getEvaluacionesByPE(periodoId);
  }
  try { _rptInactivos = new Set((await API.getParticipantes(periodoId)).filter(r => !r.activo).map(r => r.user_id)); } catch { _rptInactivos = new Set(); }
  renderAdminReport();
}

function renderAdminReport() {
  const el = document.getElementById('rpt-body'); if (!el) return;
  if (!_rptPE) { el.innerHTML = '<div class="empty-box" style="margin-top:40px"><div class="empty-txt">Selecciona un período para generar el reporte.</div></div>'; return; }
  if (esPeriodoV2(_rptPE)) { renderResumenV2(el, _rptPE); return; }

  const criterios = getCriterios();
  const evals     = _rptEvals[_rptPE.id] || [];
  const pub       = evals.filter(e => e.estado === 'publicado');
  const MAX       = criterios.length * 4 + 2;

  const scored = pub.map(e => ({
    ...e,
    score: calcScorePuntajes(e.puntajes, e.bono_ext),
    user:  _users.find(u => u.id === e.evaluado_id),
  })).filter(e => e.user).sort((a, b) => b.score - a.score);

  const nonAdmins  = _users.filter(u => !u.es_admin);
  const evaluated  = scored.length;
  // Los desactivados del período que no tienen evaluación no son «sin evaluar».
  const porEvaluar = nonAdmins.filter(u => !_rptInactivos.has(u.id) || scored.some(s => s.user.id === u.id));
  const unevaluated = Math.max(0, porEvaluar.length - evaluated);
  const avgScore   = evaluated ? (scored.reduce((s, e) => s + e.score, 0) / evaluated).toFixed(1) : '—';
  const topScore   = evaluated ? Math.max(...scored.map(e => e.score)) : '—';

  const dist = { sex:0, sbu:0, spr:0, sba:0 };
  scored.forEach(e => { const k = scoreClass(e.score); dist[k] = (dist[k]||0)+1; });

  const critAvg = criterios.map(c => {
    const vals = pub.map(e => Number(parseJSON(e.puntajes)[c.key]) || 0).filter(v => v > 0);
    return { ...c, avg: vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length) : 0 };
  });

  const today = new Date().toLocaleDateString('es-MX', { year:'numeric', month:'long', day:'numeric' });

  const individualCards = scored.map((e, i) => {
    const punt = parseJSON(e.puntajes);
    const maxCrit = criterios.length ? Math.max(...criterios.map(c => Number(punt[c.key]) || 0)) : 0;
    const minCrit = criterios.length ? Math.min(...criterios.map(c => Number(punt[c.key]) || 0)) : 0;
    const strongCrit = criterios.find(c => Number(punt[c.key]) === maxCrit);
    const weakCrit = criterios.find(c => Number(punt[c.key]) === minCrit);
    const comentarios = parseJSON(e.comentarios);
    const comKeys = Object.keys(comentarios).filter(k => k !== 'general' && comentarios[k]);
    return `<div class="rpt-individual-card">
      <div class="rpt-ind-header">
        <div class="rpt-ind-rank" style="color:${scoreColorTxt(e.score)}">#${i+1}</div>
        <div class="rpt-ind-info">
          <div class="rpt-ind-name">${escHtml(e.user.nombre)}</div>
          <div class="rpt-ind-meta">${escHtml(e.user.roles?.nombre||'—')}${e.user.distrito ? ' · '+escHtml(e.user.distrito) : ''}</div>
        </div>
        <div class="rpt-ind-score-wrap">
          <div class="rpt-ind-score" style="color:${scoreColorTxt(e.score)}">${e.score}<span class="rpt-ind-max">/${MAX}</span></div>
          <span class="nivel-badge ${scoreClass(e.score)}">${scoreLabel(e.score)}</span>
        </div>
      </div>
      <div class="rpt-ind-bars">
        ${criterios.map(c => {
          const val = Number(punt[c.key]) || 0;
          return `<div class="rpt-ind-bar-row">
            <div class="rpt-ind-bar-lbl" title="${escHtml(c.label)}" style="color:var(--criterio)">${escHtml(c.label)}</div>
            <div class="rpt-ind-bar-track"><div class="rpt-ind-bar-fill" style="width:${val/4*100}%;background:var(--criterio)"></div></div>
            <div class="rpt-ind-bar-val">${val}/4</div>
          </div>`;
        }).join('')}
        <div class="rpt-ind-bar-row">
          <div class="rpt-ind-bar-lbl" style="color:var(--sex-txt)">BONO</div>
          <div class="rpt-ind-bar-track"><div class="rpt-ind-bar-fill" style="width:${(e.bono_ext||0)/2*100}%;background:var(--sex)"></div></div>
          <div class="rpt-ind-bar-val">${e.bono_ext||0}/2</div>
        </div>
      </div>
      ${strongCrit || weakCrit ? `<div class="rpt-ind-highlights">
        ${strongCrit ? `<div class="rpt-ind-hl"><span class="rpt-ind-hl-tag rpt-ind-hl-tag--alta">Fortaleza</span> ${escHtml(strongCrit.label)} (${maxCrit}/4)</div>` : ''}
        ${weakCrit && weakCrit.key !== strongCrit?.key ? `<div class="rpt-ind-hl"><span class="rpt-ind-hl-tag" style="background:rgba(255,96,100,.10);color:var(--accent)">Área de mejora</span> ${escHtml(weakCrit.label)} (${minCrit}/4)</div>` : ''}
      </div>` : ''}
      ${comKeys.length || comentarios.general ? `<div class="rpt-ind-comments">
        ${comKeys.map(k => {
          const c = criterios.find(cr => cr.key === k);
          return `<div class="rpt-ind-com"><span style="font-weight:600;color:${escHtml(c?.color||'var(--txt)')}">${escHtml(c?.label||k)}:</span> ${escHtml(comentarios[k])}</div>`;
        }).join('')}
        ${comentarios.general ? `<div class="rpt-ind-com"><span style="font-weight:600">General:</span> ${escHtml(comentarios.general)}</div>` : ''}
      </div>` : ''}
    </div>`;
  }).join('');

  const unevalList = porEvaluar.filter(u => !scored.find(s => s.user.id === u.id));

  el.innerHTML = `
  <div class="rpt-page" id="rpt-print-area">
    <div class="rpt-header">
      <div class="rpt-marca">
        <picture>
          <source srcset="logo.webp 1x, logo@2x.webp 2x" type="image/webp">
          <img src="logo.png" alt="" class="rpt-logo" width="64" height="64">
        </picture>
        <div>
        <div class="rpt-org">EIGHT CREATORS LABs</div>
        <div class="rpt-title-big">REPORTE DE EVALUACIONES</div>
        <div class="rpt-period-lbl">${escHtml(_rptPE.nombre)}${escHtml(_rptPE.descripcion ? ' · ' + _rptPE.descripcion : '')}</div>
        </div>
      </div>
      <div class="rpt-date-wrap">
        <div class="rpt-date-lbl">Generado el</div>
        <div class="rpt-date-val">${today}</div>
      </div>
    </div>

    <div class="rpt-kpi-row">
      <div class="rpt-kpi"><div class="rpt-kpi-val">${nonAdmins.length}</div><div class="rpt-kpi-lbl">Miembros</div></div>
      <div class="rpt-kpi"><div class="rpt-kpi-val" style="color:var(--sex-txt)">${evaluated}</div><div class="rpt-kpi-lbl">Evaluados</div></div>
      <div class="rpt-kpi"><div class="rpt-kpi-val" style="color:var(--data)">${avgScore}</div><div class="rpt-kpi-lbl">Promedio</div></div>
      <div class="rpt-kpi"><div class="rpt-kpi-val" style="color:var(--sex-txt)">${topScore}</div><div class="rpt-kpi-lbl">Puntaje más alto</div></div>
      <div class="rpt-kpi"><div class="rpt-kpi-val" style="color:var(--sba-txt)">${unevaluated}</div><div class="rpt-kpi-lbl">Sin evaluar</div></div>
    </div>

    ${evaluated === 0 ? `<div class="empty-box" style="margin:32px 0"><div class="empty-txt">No hay evaluaciones publicadas en este período.</div></div>` : `
    <div class="rpt-section-lbl">Desempeño general — Ranking</div>
    <div class="rpt-table-wrap">
      <table class="rpt-table">
        <thead>
          <tr>
            <th class="rpt-th rpt-th-num">#</th>
            <th class="rpt-th">Nombre</th>
            <th class="rpt-th">Rol</th>
            ${criterios.map(c => `<th class="rpt-th rpt-th-crit" title="${escHtml(c.label)}">${escHtml(c.label)}</th>`).join('')}
            <th class="rpt-th">Bono</th>
            <th class="rpt-th">Total</th>
            <th class="rpt-th">Nivel</th>
          </tr>
        </thead>
        <tbody>
          ${scored.map((e, i) => `
            <tr class="rpt-tr ${i % 2 === 0 ? 'rpt-tr-even' : ''}">
              <td class="rpt-td rpt-td-num">${i + 1}</td>
              <td class="rpt-td rpt-td-name">${escHtml(e.user.nombre)}</td>
              <td class="rpt-td rpt-td-role">${escHtml(e.user.roles?.nombre || '—')}</td>
              ${criterios.map(c => `<td class="rpt-td rpt-td-score">${parseJSON(e.puntajes)[c.key] ?? 0}</td>`).join('')}
              <td class="rpt-td rpt-td-score">${e.bono_ext || 0}</td>
              <td class="rpt-td rpt-td-total" style="color:${scoreColorTxt(e.score)};font-weight:700">${e.score}</td>
              <td class="rpt-td"><span class="nivel-badge ${scoreClass(e.score)}">${scoreLabel(e.score)}</span></td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr class="rpt-tfoot">
            <td colspan="3" class="rpt-td" style="font-weight:600">Promedio por criterio</td>
            ${criterios.map(c => {
              const avg = critAvg.find(x=>x.key===c.key)?.avg||0;
              return `<td class="rpt-td rpt-td-score" style="font-weight:600">${avg ? avg.toFixed(1) : '—'}</td>`;
            }).join('')}
            <td class="rpt-td">—</td>
            <td class="rpt-td rpt-td-total" style="font-weight:700">${avgScore}</td>
            <td class="rpt-td"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="rpt-bottom-row">
      <div class="rpt-section rpt-section-dist">
        <div class="rpt-section-lbl">Distribución por nivel</div>
        <div class="rpt-dist-grid">
          ${[
            { key:'sex', label:'Excelente', color:'var(--sex)' },
            { key:'sbu', label:'Bueno',     color:'var(--sbu)' },
            { key:'spr', label:'En Proceso',color:'var(--spr)' },
            { key:'sba', label:'Bajo',       color:'var(--sba)' },
          ].map(n => {
            const cnt = dist[n.key] || 0;
            const pct = evaluated ? Math.round(cnt / evaluated * 100) : 0;
            return `<div class="rpt-dist-item">
              <div class="rpt-dist-bar-track"><div class="rpt-dist-bar-fill" style="height:${pct}%;background:${escHtml(n.color)}"></div></div>
              <div class="rpt-dist-count" style="color:${escHtml(n.color)}">${cnt}</div>
              <div class="rpt-dist-nlbl">${escHtml(n.label)}</div>
              <div class="rpt-dist-pct">${pct}%</div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="rpt-section rpt-section-crit">
        <div class="rpt-section-lbl">Promedio por criterio</div>
        ${critAvg.map(c => {
          const pct = pctBarra(c.avg, c);
          return `<div class="rpt-crit-row">
            <div class="rpt-crit-lbl" title="${escHtml(c.label)}">${escHtml(c.label)}</div>
            <div class="rpt-crit-bar-track">
              <div class="rpt-crit-bar-fill" style="width:${pct}%"></div>
            </div>
            <div class="rpt-crit-val">${c.avg ? c.avg.toFixed(1) : '—'}</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="rpt-section-lbl" style="margin-top:36px">Desempeño individual</div>
    <div class="rpt-individuals-grid">${individualCards}</div>

    ${unevalList.length ? `
    <div class="rpt-section-lbl" style="margin-top:28px;color:var(--muted)">Miembros sin evaluar (${unevalList.length})</div>
    <div class="rpt-uneval-list">
      ${unevalList.map(u => `<div class="rpt-uneval-item">
        <span class="rpt-uneval-name">${escHtml(u.nombre)}</span>
        <span class="rpt-uneval-meta">${escHtml(u.roles?.nombre||'—')}${u.distrito?' · '+escHtml(u.distrito):''}</span>
      </div>`).join('')}
    </div>` : ''}
    `}

    <div class="rpt-footer">
      <picture>
        <source srcset="logo.webp 1x, logo@2x.webp 2x" type="image/webp">
        <img src="logo.png" alt="" class="rpt-logo-pie" width="22" height="22">
      </picture>
      <span>EIGHT CREATORS LABs · ${escHtml(_rptPE.nombre)} · Generado el ${today}</span>
    </div>
  </div>`;
}

function printAdminReport() {
  if (!_rptPE) { showToast('Selecciona un período primero', 'error'); return; }
  window.print();
}

/* ── MENÚ ── */

/* initials, setEl, showToast, initScrollEffects → core/render.js.
   El admin no tiene #back-top; initScrollEffects lo comprueba con ?. */
