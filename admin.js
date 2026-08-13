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
    marca: 'EIGHT CREATORS', badge: 'ADMIN', activo: 'overview',
    // Cabecera de cuenta de la hoja móvil, donde viven salir y el
    // selector de gestión: el rail no existe por debajo de 768px.
    pie: { nombre: CU.nombre || CU.email, badge: 'Administrador' },
    grupos: [
      { items: [
        { tab:'overview', icono:'layout-dashboard', etiqueta:'Overview' },
        { tab:'evaluar',  icono:'clipboard-list',   etiqueta:'Evaluar'  },
        { tab:'usuarios', icono:'users',            etiqueta:'Usuarios' },
        { tab:'reportes', icono:'file-bar-chart',   etiqueta:'Reportes' },
      ]},
      { titulo:'Configuración', items: [
        { tab:'periodos',   icono:'calendar',      etiqueta:'Períodos'   },
        { tab:'calendario', icono:'calendar-days', etiqueta:'Calendario' },
        { tab:'rubrica',    icono:'ruler',         etiqueta:'Rúbrica'    },
        { tab:'roles',      icono:'tag',           etiqueta:'Roles'      },
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
  const gid = new URLSearchParams(location.search).get('gestion');
  if (gid) API.setGestion(gid);

  await loadAllData();
  renderOvPEBar();
  renderEvalPEBar();
  renderUsuariosPEBar();
  renderRptPEBar();
  renderUsuarios();
  renderRoles();
  renderPeriodos();
  renderCriterios();
  renderRubrica();
  renderCalendario();
  renderDistPEBar();
  populateDistritoFilters();
  initScrollEffects();
  loadOverview();
});

async function loadAllData() {
  const [users, roles, pes, crits, rub, cal, dists] = await Promise.all([
    API.getAllUsers(),
    API.getRoles(false),
    API.getPeriodos(),
    API.getCriterios(),
    API.getRubrica(),
    API.getCalendario(),
    API.getDistritos(),
  ]);
  _users      = users;
  _roles      = roles;
  _periodos   = pes;
  _criterios  = crits;
  _rubrica    = rub;
  _calendario = cal;
  _distritos  = dists;

  // getCriterios() de core/render.js lee del Store, no de _criterios.
  Store.set({ profile: CU, periodos: _periodos, criterios: _criterios, lastUpdated: new Date() });

  // Gestión elegida por URL (?gestion=). Si está archivada, solo lectura.
  const gs = await API.getGestiones();
  const gActual = gs.find(g => String(g.id) === String(new URLSearchParams(location.search).get('gestion')))
               || gs.find(g => g.activa) || null;
  renderBannerSoloLectura(gActual);
  renderSelectorGestion('gestion-switch', gs, gActual?.id,
    id => location.assign('admin.html?gestion=' + encodeURIComponent(id)));

  const defPE = _periodos.find(p => p.activo) || _periodos[0];
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

  loadEvalPEData();
}

async function selectEvalPE(periodoId, btn) {
  _activePE = _periodos.find(p => p.id == periodoId);
  document.querySelectorAll('#eval-pe-btns .pb').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _selectedEvalUser = null;
  document.getElementById('eval-form-area').innerHTML = '';
  await loadEvalPEData();
}

async function loadEvalPEData() {
  if (!_activePE) return;
  const el = document.getElementById('eval-user-list');
  if (el && !_evalPECache.length) el.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';
  _evalPECache = await API.getEvaluacionesByPE(_activePE.id);
  renderEvalUserList();
}

function renderEvalUserList() {
  const el = document.getElementById('eval-user-list'); if (!el) return;
  const q = (document.getElementById('search-eval-users')?.value || '').toLowerCase().trim();
  const distFilter = (document.getElementById('eval-distrito-filter')?.value || '').trim();
  const nonAdmins = _users.filter(u => !u.es_admin
    && (!distFilter || u.distrito === distFilter)
    && (!q || (u.nombre||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q)));

  if (!nonAdmins.length) {
    el.innerHTML = `<div class="empty-box"><div class="empty-txt">${q||distFilter ? 'Sin resultados.' : 'Sin miembros registrados.'}</div></div>`;
    return;
  }

  const evalMap = {};
  _evalPECache.forEach(e => { evalMap[e.evaluado_id] = e; });
  const criterios = getCriterios();
  const MAX = criterios.length * 4 + 2;

  const sorted = nonAdmins.map(u => {
    const ev = evalMap[u.id];
    const score = ev ? calcScorePuntajes(ev.puntajes, ev.bono_ext) : -1;
    const estado = ev?.estado || 'pendiente';
    return { ...u, ev, score, estado };
  }).sort((a, b) => {
    const order = { publicado: 0, borrador: 1, pendiente: 2 };
    const d = (order[a.estado]??2) - (order[b.estado]??2);
    return d !== 0 ? d : b.score - a.score;
  });

  let rank = 0;
  el.innerHTML = `<div class="eval-users-grid">
    ${sorted.map(u => {
      const isActive = _selectedEvalUser === u.id;
      const estadoCls = u.estado === 'publicado' ? 'estado--publicado' : u.estado === 'borrador' ? 'estado--borrador' : 'estado--none';
      const estadoTxt = u.estado === 'publicado' ? 'Publicado' : u.estado === 'borrador' ? 'Borrador' : 'Pendiente';
      if (u.estado === 'publicado') rank++;
      const medal = u.estado === 'publicado' ? (rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':`<span style="font-family:'Bebas Neue',sans-serif;color:var(--muted)">${rank}</span>`) : '';
      const pct = u.score >= 0 ? Math.round(u.score/MAX*100) : 0;
      return `<div class="eval-ucard${isActive?' eval-ucard--active':''}" data-act="evaluarUsuario" data-arg="${u.id}">
        <div class="eval-ucard-rank">${medal}</div>
        <div class="eval-ucard-info">
          <div class="eval-ucard-name">${escHtml(u.nombre)}</div>
          <div class="eval-ucard-meta">${escHtml(u.roles?.nombre||'—')} · ${escHtml(u.distrito||'—')}</div>
        </div>
        ${u.score >= 0 ? `<div class="eval-ucard-bar"><div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%;background:${scoreColor(u.score)}"></div></div></div>
        <div class="eval-ucard-score" style="color:${scoreColor(u.score)}">${u.score}</div>` : ''}
        <span class="eval-estado-badge ${estadoCls}">${estadoTxt}</span>
      </div>`;
    }).join('')}
  </div>`;
}

async function selectEvalUser(userId) {
  _selectedEvalUser = userId;
  renderEvalUserList();
  const area = document.getElementById('eval-form-area'); if (!area) return;
  area.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';
  const [ev, trabajos] = await Promise.all([
    API.getEvaluacion(_activePE.id, userId),
    API.getTrabajosEntregados(userId, _activePE?.nombre || ''),
  ]);
  renderEvalForm(ev, userId, trabajos);
  area.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function renderEvalForm(ev, evaluadoId, trabajos) {
  const area = document.getElementById('eval-form-area'); if (!area) return;
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
        <div class="cbar-tag" style="color:var(--criterio)">${escHtml(c.abbr)}</div>
        <div class="eval-crit-label">${escHtml(c.label)}</div>
      </div>
      <div class="eval-crit-inputs">
        <div class="score-btns">
          ${[0,1,2,3,4].map(v => `<button class="score-btn${(puntajes[c.key]??-1)===v?' active':''}"
            data-act="puntaje" data-arg="${c.key}" data-arg2="${v}" style="--sc:var(--criterio)">${v}</button>`).join('')}
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
        <div style="display:flex;align-items:center;gap:8px">
          ${[0,1,2].map(v => `<button class="score-btn${bono===v?' active':''}"
            data-act="bono" data-arg="${v}" style="--sc:var(--sex)">${v}</button>`).join('')}
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
             <button class="btn-draft" data-act="guardarEval" data-arg="borrador" data-arg2="${evaluadoId}">Guardar borrador</button>
             <button class="btn-save btn-publish" data-act="guardarEval" data-arg="publicado" data-arg2="${evaluadoId}">Publicar evaluación</button>
           </div>`
      }
    </div>`;
}

function setScore(key, val, btn) {
  document.getElementById(`sc-${key}`).value = val;
  btn.closest('.score-btns').querySelectorAll('.score-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function setBono(val, btn) {
  document.getElementById('sc-bono').value = val;
  btn.closest('div').querySelectorAll('.score-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

async function saveEvaluacion(estado, evaluadoId) {
  if (!_activePE) return;
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
    API.getTrabajosEntregados(evaluadoId, _activePE?.nombre || ''),
  ]);
  renderEvalForm(evNew, evaluadoId, trabajos);
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
  const rows = await API.getParticipantes(periodoId);
  rows.forEach(r => { if (!r.activo) _inactivosPE.add(r.user_id); });
  renderUsuarios();
}

function renderUsuarios() {
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
}

async function updateUserRol(userId, rolId) {
  const res = await API.updateUserRol(userId, Number(rolId));
  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  showToast('Rol actualizado', 'ok');
  _users = _users.map(u => u.id === userId ? { ...u, rol_id: Number(rolId) } : u);
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
}

/* ── TAB: ROLES ── */
function renderRoles() {
  const el = document.getElementById('roles-list'); if (!el) return;
  const q = (document.getElementById('search-roles')?.value || '').toLowerCase().trim();
  const list = _roles.filter(r => !q || (r.nombre||'').toLowerCase().includes(q));
  if (!list.length) {
    el.innerHTML = `<div class="empty-box"><div class="no-data-icon">${ICONS.clipboard}</div><div class="empty-txt">${q ? 'Sin resultados para "'+escHtml(q)+'".' : 'Sin roles.'}</div></div>`;
    renderIconos(el);
    return;
  }
  el.innerHTML = `
    <div class="tbl">
      <div class="tbl-head"><div>Nombre</div><div>Estado</div><div>Acciones</div></div>
      <div class="tbl-body">
        ${list.map(r => `
          <div class="tbl-row">
            <div class="tbl-cell">${escHtml(r.nombre)}</div>
            <div class="tbl-cell">
              <span class="estado-pill ${r.activo?'pill--ok':'pill--off'}">${r.activo?'Activo':'Inactivo'}</span>
            </div>
            <div class="tbl-cell tbl-actions">
              <button class="btn-icon" data-act="modalRol" data-arg="${r.id}" title="Editar">${ICONS.edit}</button>
              <button class="btn-icon btn-icon--danger" data-act="borrarRol" data-arg="${r.id}" title="Eliminar">${ICONS.trash}</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  renderIconos(el);
}

/** Busca el rol por id en vez de recibir nombre y activo por argumento:
    así el botón solo necesita data-arg con el id. */
function showRolModal(id) {
  const r = _roles.find(x => String(x.id) === String(id)) || {};
  document.getElementById('mrol-id').value     = r.id || '';
  document.getElementById('mrol-nombre').value = r.nombre || '';
  document.getElementById('mrol-activo').checked = r.activo !== false;
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

  const res = await API.saveRol({ id: id ? Number(id) : null, nombre, activo });
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
function renderPeriodos() {
  const el = document.getElementById('periodos-list'); if (!el) return;
  const q = (document.getElementById('search-periodos')?.value || '').toLowerCase().trim();
  const list = _periodos.filter(p => !q ||
    (p.nombre||'').toLowerCase().includes(q) ||
    (p.descripcion||'').toLowerCase().includes(q));
  if (!list.length) {
    el.innerHTML = `<div class="empty-box"><div class="no-data-icon">${ICONS.calendar}</div><div class="empty-txt">${q ? 'Sin resultados para "'+escHtml(q)+'".' : 'Sin períodos.'}</div></div>`;
    renderIconos(el);
    return;
  }
  el.innerHTML = `
    <div class="tbl">
      <div class="tbl-head"><div>Nombre</div><div>Descripción</div><div>Activo</div><div>Acciones</div></div>
      <div class="tbl-body">
        ${list.map(p => `
          <div class="tbl-row">
            <div class="tbl-cell"><strong>${escHtml(p.nombre)}</strong></div>
            <div class="tbl-cell tbl-muted">${escHtml(p.descripcion || '—')}</div>
            <div class="tbl-cell">
              <span class="estado-pill ${p.activo?'pill--ok':'pill--off'}">${p.activo?'Activo':'—'}</span>
            </div>
            <div class="tbl-cell tbl-actions">
              <button class="btn-icon" data-act="modalPeriodo" data-arg="${p.id}" title="Editar">${ICONS.edit}</button>
              <button class="btn-icon btn-icon--danger" data-act="borrarPeriodo" data-arg="${p.id}" title="Eliminar">${ICONS.trash}</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  renderIconos(el);
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

  const res = await API.savePeriodo({ id: id || null, nombre, descripcion: desc, fechas });
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
      <div class="tbl-head"><div>Color</div><div>Nombre</div><div>Abbr</div><div>Key</div><div>Orden</div><div>Estado</div><div>Acciones</div></div>
      <div class="tbl-body">
        ${list.map(c => `
          <div class="tbl-row">
            <div class="tbl-cell"><span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${colorSeguro(c.color)};flex-shrink:0"></span></div>
            <div class="tbl-cell"><strong>${escHtml(c.label)}</strong></div>
            <div class="tbl-cell"><span class="cbar-tag" style="color:var(--criterio)">${escHtml(c.abbr)}</span></div>
            <div class="tbl-cell tbl-muted">${c.key}</div>
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
  document.getElementById('mcrit-abbr').value     = c?.abbr || '';
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
  const abbr   = document.getElementById('mcrit-abbr').value.trim();
  const color  = document.getElementById('mcrit-color').value;
  const orden  = document.getElementById('mcrit-orden').value;
  const activo = document.getElementById('mcrit-activo').checked;
  const err    = document.getElementById('mcrit-err');
  if (!label) { err.textContent = 'Escribe el nombre del criterio.'; return; }
  if (!key)   { err.textContent = 'Escribe la clave interna (key).'; return; }
  if (!abbr)  { err.textContent = 'Escribe la abreviación.'; return; }

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
    { n:4, lbl:'Excelente', color:'var(--sex)' },
    { n:3, lbl:'Bueno',     color:'var(--sbu)' },
    { n:2, lbl:'En Proceso',color:'var(--spr)' },
    { n:1, lbl:'Bajo',      color:'var(--sba)' },
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
              <span style="font-family:'Bebas Neue',sans-serif;font-size:1.2rem;color:${distScoreColor(d.score)}">${d.score}</span>
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
              <span class="dist-hist-abbr" style="color:var(--criterio)">${escHtml(c.abbr)}</span>
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
        <div class="cbar-tag" style="color:var(--criterio)">${escHtml(c.abbr)}</div>
        <div class="eval-crit-label">${escHtml(c.label)}</div>
      </div>
      <div class="eval-crit-inputs">
        <div class="score-btns">
          ${[0,1,2,3,4,5,6,7].map(v => `<button class="score-btn${(puntajes[c.key]??-1)===v?' active':''}"
            data-act="puntajeDist" data-arg="${c.key}" data-arg2="${v}" style="--sc:var(--criterio)">${v}</button>`).join('')}
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
  btn.closest('.score-btns').querySelectorAll('.score-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
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
  if (!_activePEOv) {
    bodyEl.innerHTML = `<div class="empty-box"><div class="empty-txt">No hay períodos. Crea uno en la pestaña Períodos.</div></div>`;
    return;
  }
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
        <div class="kpi-icon" style="color:var(--sbu)">${ICONS.activity}</div>
        <div class="kpi-val" style="color:${avgScore?scoreColor(Number(avgScore)):'var(--muted)'}">${avgScore || '—'}</div>
        <div class="kpi-lbl">Score promedio</div>
        <div class="kpi-sub">Máx. ${MAX} pts</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon" style="color:var(--sex)">${ICONS.award}</div>
        <div class="kpi-val" style="color:${topScore!=null?scoreColor(topScore):'var(--muted)'}">${topScore ?? '—'}</div>
        <div class="kpi-lbl">Mejor score</div>
        <div class="kpi-sub">${escHtml(scored[0]?.user?.nombre?.split(' ')[0] || '—')}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon" style="color:var(--spr)">${ICONS.calendar}</div>
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
          <div class="ov-panel-title" style="margin-bottom:0">🏆 Ranking — ${escHtml(_activePEOv?.nombre || '')}</div>
          <div class="rank-tabs">
            <button class="rank-tab-btn${_rankingTab==='users'?' rank-tab-active':''}" data-act="rankTab" data-arg="users">Usuarios</button>
            <button class="rank-tab-btn${_rankingTab==='dist'?' rank-tab-active':''}" data-act="rankTab" data-arg="dist">Distritos</button>
          </div>
        </div>

        <div id="rank-users" style="${_rankingTab!=='users'?'display:none':''}">
        ${scored.length ? `<div class="ov-ranking">
          ${scored.map((e,i) => {
            const pct = Math.round(e.score/MAX*100);
            const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`<span style="font-family:'Bebas Neue',sans-serif;color:var(--muted)">${i+1}</span>`;
            return `<div class="rank-row">
              <div class="rank-pos">${medal}</div>
              <div class="rank-info">
                <div class="rank-name">${escHtml(e.user.nombre)}</div>
                <div class="rank-role">${escHtml(e.user.roles?.nombre||e.user.distrito||'—')}</div>
              </div>
              <div class="rank-bar-wrap"><div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%;background:${scoreColor(e.score)}"></div></div></div>
              <div class="rank-score" style="color:${scoreColor(e.score)}">${e.score}</div>
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
              const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`<span style="font-family:'Bebas Neue',sans-serif;color:var(--muted)">${i+1}</span>`;
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
              <div class="level-dist-lbl" style="color:${escHtml(l.color)}">${l.lbl}</div>
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
              <div class="rank-score" style="color:${scoreColor(sc)}">${sc}</div>
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
            <div class="crit-bar-tag" style="color:var(--criterio)">${escHtml(c.abbr)}</div>
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

/* ── TABS ── */
/* Operación suelta; todo lo de configuración cuelga del engranaje, cuyo
   botón padre es `periodos`. */
const _tabParentMap = {
  overview:'overview', evaluar:'evaluar', usuarios:'usuarios', reportes:'reportes',
  periodos:'periodos', calendario:'periodos', rubrica:'periodos',
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
                 title="Ver esta gestión">${ICONS.search}</a>
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
  if (tab === 'gestiones') renderGestiones();
  if (tab === 'overview' && Store.necesitaCarga('overview')) {
    Store.marcarCargado('overview'); loadOverview();
  }
  if (tab === 'reportes' && !_rptPE && _periodos.length) {
    const def = _periodos.find(p => p.activo) || _periodos[0];
    if (def) selectRptPE(def.id, document.querySelector('#rpt-pe-btns .rpt-pe-btn'));
  }
}

function switchTab(tab, btn) {
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
    `<button class="eval-pe-btn rpt-pe-btn${_rptPE?.id===p.id?' eval-pe-btn--active':''}" data-act="peRpt" data-arg="${p.id}">${escHtml(p.nombre)}</button>`
  ).join('');
}

async function selectRptPE(periodoId, _btn) {
  _rptPE = _periodos.find(p => p.id == periodoId) || null;
  document.querySelectorAll('#rpt-pe-btns .rpt-pe-btn').forEach(b => b.classList.remove('eval-pe-btn--active'));
  _btn?.classList.add('eval-pe-btn--active');
  if (!_rptEvals[periodoId]) {
    document.getElementById('rpt-body').innerHTML = '<div class="loading-box"><span class="spin"></span></div>';
    _rptEvals[periodoId] = await API.getEvaluacionesByPE(periodoId);
  }
  renderAdminReport();
}

function renderAdminReport() {
  const el = document.getElementById('rpt-body'); if (!el) return;
  if (!_rptPE) { el.innerHTML = '<div class="empty-box" style="margin-top:40px"><div class="empty-txt">Selecciona un período para generar el reporte.</div></div>'; return; }

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
  const unevaluated = Math.max(0, nonAdmins.length - evaluated);
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
        <div class="rpt-ind-rank" style="color:${scoreColor(e.score)}">#${i+1}</div>
        <div class="rpt-ind-info">
          <div class="rpt-ind-name">${escHtml(e.user.nombre)}</div>
          <div class="rpt-ind-meta">${escHtml(e.user.roles?.nombre||'—')}${e.user.distrito ? ' · '+escHtml(e.user.distrito) : ''}</div>
        </div>
        <div class="rpt-ind-score-wrap">
          <div class="rpt-ind-score" style="color:${scoreColor(e.score)}">${e.score}<span class="rpt-ind-max">/${MAX}</span></div>
          <span class="nivel-badge ${scoreClass(e.score)}">${scoreLabel(e.score)}</span>
        </div>
      </div>
      <div class="rpt-ind-bars">
        ${criterios.map(c => {
          const val = Number(punt[c.key]) || 0;
          return `<div class="rpt-ind-bar-row">
            <div class="rpt-ind-bar-lbl" title="${escHtml(c.label)}" style="color:var(--criterio)">${escHtml(c.abbr)}</div>
            <div class="rpt-ind-bar-track"><div class="rpt-ind-bar-fill" style="width:${val/4*100}%;background:var(--criterio)"></div></div>
            <div class="rpt-ind-bar-val">${val}/4</div>
          </div>`;
        }).join('')}
        <div class="rpt-ind-bar-row">
          <div class="rpt-ind-bar-lbl" style="color:var(--sex)">BONO</div>
          <div class="rpt-ind-bar-track"><div class="rpt-ind-bar-fill" style="width:${(e.bono_ext||0)/2*100}%;background:var(--sex)"></div></div>
          <div class="rpt-ind-bar-val">${e.bono_ext||0}/2</div>
        </div>
      </div>
      ${strongCrit || weakCrit ? `<div class="rpt-ind-highlights">
        ${strongCrit ? `<div class="rpt-ind-hl"><span class="rpt-ind-hl-tag" style="background:rgba(76,175,80,.12);color:#4caf50">Fortaleza</span> ${escHtml(strongCrit.label)} (${maxCrit}/4)</div>` : ''}
        ${weakCrit && weakCrit.key !== strongCrit?.key ? `<div class="rpt-ind-hl"><span class="rpt-ind-hl-tag" style="background:rgba(255,96,100,.10);color:var(--accent)">Área de mejora</span> ${escHtml(weakCrit.label)} (${minCrit}/4)</div>` : ''}
      </div>` : ''}
      ${comKeys.length || comentarios.general ? `<div class="rpt-ind-comments">
        ${comKeys.map(k => {
          const c = criterios.find(cr => cr.key === k);
          return `<div class="rpt-ind-com"><span style="font-weight:600;color:${escHtml(c?.color||'var(--txt)')}">${escHtml(c?.abbr||k)}:</span> ${escHtml(comentarios[k])}</div>`;
        }).join('')}
        ${comentarios.general ? `<div class="rpt-ind-com"><span style="font-weight:600">General:</span> ${escHtml(comentarios.general)}</div>` : ''}
      </div>` : ''}
    </div>`;
  }).join('');

  const unevalList = nonAdmins.filter(u => !scored.find(s => s.user.id === u.id));

  el.innerHTML = `
  <div class="rpt-page" id="rpt-print-area">
    <div class="rpt-header">
      <div>
        <div class="rpt-org">EIGHT CREATORS LABs</div>
        <div class="rpt-title-big">REPORTE DE EVALUACIONES</div>
        <div class="rpt-period-lbl">${escHtml(_rptPE.nombre)}${escHtml(_rptPE.descripcion ? ' · ' + _rptPE.descripcion : '')}</div>
      </div>
      <div class="rpt-date-wrap">
        <div class="rpt-date-lbl">Generado el</div>
        <div class="rpt-date-val">${today}</div>
      </div>
    </div>

    <div class="rpt-kpi-row">
      <div class="rpt-kpi"><div class="rpt-kpi-val">${nonAdmins.length}</div><div class="rpt-kpi-lbl">Miembros</div></div>
      <div class="rpt-kpi"><div class="rpt-kpi-val" style="color:var(--sex)">${evaluated}</div><div class="rpt-kpi-lbl">Evaluados</div></div>
      <div class="rpt-kpi"><div class="rpt-kpi-val" style="color:var(--data)">${avgScore}</div><div class="rpt-kpi-lbl">Promedio</div></div>
      <div class="rpt-kpi"><div class="rpt-kpi-val" style="color:var(--sex)">${topScore}</div><div class="rpt-kpi-lbl">Puntaje más alto</div></div>
      <div class="rpt-kpi"><div class="rpt-kpi-val" style="color:var(--sba)">${unevaluated}</div><div class="rpt-kpi-lbl">Sin evaluar</div></div>
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
            ${criterios.map(c => `<th class="rpt-th rpt-th-crit" title="${escHtml(c.label)}">${escHtml(c.abbr)}</th>`).join('')}
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
              <td class="rpt-td rpt-td-total" style="color:${scoreColor(e.score)};font-weight:700">${e.score}</td>
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
            <div class="rpt-crit-lbl" title="${escHtml(c.label)}">${escHtml(c.abbr)}</div>
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

    <div class="rpt-footer">EIGHT CREATORS LABs · ${escHtml(_rptPE.nombre)} · Generado el ${today}</div>
  </div>`;
}

function printAdminReport() {
  if (!_rptPE) { showToast('Selecciona un período primero', 'error'); return; }
  window.print();
}

/* ── MENÚ ── */

/* initials, setEl, showToast, initScrollEffects → core/render.js.
   El admin no tiene #back-top; initScrollEffects lo comprueba con ?. */
