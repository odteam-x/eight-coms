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
let _menuOpen       = false;

const _USER_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

const CRITERIOS_DEFAULT = [
  { key:'pla', label:'Planificación',      abbr:'PLA', color:'#E05A6A' },
  { key:'rev', label:'Revisión',           abbr:'REV', color:'#38BDF8' },
  { key:'edi', label:'Edición Creativa',   abbr:'EDI', color:'#2ECC71' },
  { key:'dis', label:'Diseño Creativo',    abbr:'DIS', color:'#5B7FFF' },
  { key:'flu', label:'Fluidez Oral',       abbr:'FLU', color:'#C084FC' },
  { key:'nar', label:'Narrativa / Guión',  abbr:'NAR', color:'#F0C040' },
  { key:'eje', label:'Ejecución en Redes', abbr:'EJE', color:'#FB923C' },
];
const getCriterios = () => _criterios.length ? _criterios : CRITERIOS_DEFAULT;

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', async () => {
  CU = await Auth.requireAuth(true); // true → solo admins
  if (!CU) return;

  const name = CU.nombre || CU.email;
  const avContent = CU.avatar_url
    ? `<img src="${CU.avatar_url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
    : _USER_ICON;
  ['av-desktop','av-mobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = avContent;
      el.style.cursor = 'pointer';
      el.title = 'Cambiar foto de perfil';
      el.onclick = () => document.getElementById('avatar-file-input')?.click();
    }
  });
  setEl('uname-desktop', name); setEl('uname-mobile', name);

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

  const defPE = _periodos.find(p => p.activo) || _periodos[0];
  if (defPE && !_activePE) _activePE = defPE;
  if (defPE && !_activePEDist) _activePEDist = defPE;
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
    `<button class="pb${p.id === _activePE?.id ? ' active' : ''}" onclick="selectEvalPE(${p.id},this)">${p.nombre}</button>`
  ).join('');

  renderEvalUserSelect();
}

function selectEvalPE(periodoId, btn) {
  _activePE = _periodos.find(p => p.id == periodoId);
  document.querySelectorAll('.eval-pe-btns .pb').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  clearEvalForm();
  loadEvaluacion();
}

function renderEvalUserSelect() {
  const sel = document.getElementById('eval-user-select'); if (!sel) return;
  const nonAdmins = _users.filter(u => !u.es_admin);
  sel.innerHTML = '<option value="">Selecciona un miembro...</option>' +
    nonAdmins.map(u =>
      `<option value="${u.id}">${u.nombre}${u.roles?.nombre ? ' · ' + u.roles.nombre : ''}</option>`
    ).join('');
}

async function loadEvaluacion() {
  const sel = document.getElementById('eval-user-select');
  const evaluadoId = sel?.value;
  if (!evaluadoId || !_activePE) { clearEvalForm(); return; }

  const area = document.getElementById('eval-form-area'); if (!area) return;
  area.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';

  const ev = await API.getEvaluacion(_activePE.id, evaluadoId);
  renderEvalForm(ev, evaluadoId);
}

function clearEvalForm() {
  const area = document.getElementById('eval-form-area'); if (!area) return;
  area.innerHTML = `
    <div class="empty-box" style="margin-top:32px">
      <div class="no-data-icon" style="margin-bottom:6px">${ICONS.clipboard}</div>
      <div class="empty-txt">Selecciona un período y un miembro para evaluar.</div>
    </div>`;
}

function renderEvalForm(ev, evaluadoId) {
  const area = document.getElementById('eval-form-area'); if (!area) return;
  const criterios  = getCriterios();
  const puntajes   = ev?.puntajes    || {};
  const coms       = ev?.comentarios || {};
  const bono       = ev?.bono_ext    || 0;
  const estado     = ev?.estado      || 'borrador';
  const evaluado   = _users.find(u => u.id === evaluadoId);
  const isPub      = estado === 'publicado';

  const rows = criterios.map((c, i) => `
    <div class="eval-criterio-row" style="animation-delay:${i*30}ms">
      <div class="eval-crit-head">
        <div class="cbar-tag" style="color:${c.color}">${c.abbr}</div>
        <div class="eval-crit-label">${c.label}</div>
      </div>
      <div class="eval-crit-inputs">
        <div class="score-btns">
          ${[1,2,3,4].map(v => `<button class="score-btn${(puntajes[c.key]||0)===v?' active':''}"
            onclick="setScore('${c.key}',${v},this)" style="--sc:${c.color}">${v}</button>`).join('')}
          <input type="hidden" id="sc-${c.key}" value="${puntajes[c.key]||0}">
        </div>
        <input class="cfg-inp eval-com-inp" type="text" id="com-${c.key}"
          placeholder="Comentario (opcional)" value="${(coms[c.key]||'').replace(/"/g,'&quot;')}">
      </div>
    </div>`).join('');

  area.innerHTML = `
    <div class="eval-form-card">
      <div class="eval-form-header">
        <div>
          <div class="eval-miembro-name">${evaluado?.nombre || '—'}</div>
          ${evaluado?.roles?.nombre ? `<div class="eval-miembro-rol">${evaluado.roles.nombre}</div>` : ''}
        </div>
        <span class="eval-estado-badge estado--${estado}">${estado}</span>
      </div>

      <div class="eval-criterios-list">${rows}</div>

      <div class="eval-extras">
        <label class="eval-extra-label">Bono de excelencia (0–2)</label>
        <div style="display:flex;align-items:center;gap:8px">
          ${[0,1,2].map(v => `<button class="score-btn${bono===v?' active':''}"
            onclick="setBono(${v},this)" style="--sc:var(--sex)">${v}</button>`).join('')}
          <input type="hidden" id="sc-bono" value="${bono}">
        </div>
      </div>

      <div class="eval-extras">
        <label class="eval-extra-label">Notas / Comentario general</label>
        <textarea class="cfg-inp eval-com-inp" id="com-general" rows="3"
          placeholder="Notas del evaluador...">${coms.general||''}</textarea>
      </div>

      ${isPub
        ? `<div class="eval-pub-info">
             <span class="eval-pub-dot"></span>
             Evaluación publicada — visible para el miembro
           </div>
           <div class="eval-actions">
             <button class="btn-draft" onclick="saveEvaluacion('borrador','${evaluadoId}')">Volver a borrador</button>
             <button class="btn-save btn-confirm" onclick="saveEvaluacion('publicado','${evaluadoId}')">Confirmar cambios</button>
           </div>`
        : `<div class="eval-actions">
             <button class="btn-draft" onclick="saveEvaluacion('borrador','${evaluadoId}')">Guardar borrador</button>
             <button class="btn-save btn-publish" onclick="saveEvaluacion('publicado','${evaluadoId}')">Publicar evaluación</button>
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
  await loadEvaluacion();
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
    `<button class="pb${p.id === _activePEUsers?.id ? ' active' : ''}" onclick="selectUsersPE(${p.id},this)">${p.nombre}</button>`
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
  const list = _users.filter(u => !q ||
    (u.nombre||'').toLowerCase().includes(q) ||
    (u.email||'').toLowerCase().includes(q));
  if (!list.length) {
    el.innerHTML = `<div class="empty-box"><div class="no-data-icon">${ICONS.users}</div><div class="empty-txt">${q ? 'Sin resultados para "'+q+'".' : 'Sin usuarios.'}</div></div>`;
    return;
  }
  const showPECol = !!_activePEUsers;
  el.innerHTML = `
    <div class="tbl">
      <div class="tbl-head">
        <div>Nombre</div><div>Email</div><div>Rol</div><div>Admin</div>
        ${showPECol ? '<div>Estado PE</div>' : ''}
      </div>
      <div class="tbl-body">
        ${list.map(u => {
          const inactivo = _inactivosPE.has(u.id);
          return `
          <div class="tbl-row">
            <div class="tbl-cell">
              <div class="avatar" style="width:28px;height:28px;font-size:.65rem;flex-shrink:0">${initials(u.nombre||u.email)}</div>
              <span>${u.nombre || '—'}</span>
            </div>
            <div class="tbl-cell tbl-muted">${u.email}</div>
            <div class="tbl-cell">
              <select class="cfg-inp cfg-select" style="padding:4px 8px;font-size:.8rem"
                onchange="updateUserRol('${u.id}',this.value)">
                ${_roles.map(r => `<option value="${r.id}"${r.id===u.rol_id?' selected':''}>${r.nombre}</option>`).join('')}
              </select>
            </div>
            <div class="tbl-cell">
              <label class="toggle-switch" title="${u.es_admin?'Quitar admin':'Hacer admin'}">
                <input type="checkbox" ${u.es_admin?'checked':''} onchange="updateUserAdmin('${u.id}',this.checked)">
                <span class="toggle-slider"></span>
              </label>
            </div>
            ${showPECol ? `
            <div class="tbl-cell">
              <button class="pe-toggle ${inactivo ? 'pe-toggle--off' : 'pe-toggle--on'}"
                onclick="toggleParticipante('${u.id}',${inactivo})"
                title="${inactivo ? 'Activar en este PE' : 'Desactivar en este PE'}">
                ${inactivo ? 'Inactivo' : 'Activo'}
              </button>
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

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

async function updateUserRol(userId, rolId) {
  const res = await API.updateUserRol(userId, Number(rolId));
  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  showToast('Rol actualizado', 'ok');
  _users = _users.map(u => u.id === userId ? { ...u, rol_id: Number(rolId) } : u);
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
    el.innerHTML = `<div class="empty-box"><div class="no-data-icon">${ICONS.clipboard}</div><div class="empty-txt">${q ? 'Sin resultados para "'+q+'".' : 'Sin roles.'}</div></div>`;
    return;
  }
  el.innerHTML = `
    <div class="tbl">
      <div class="tbl-head"><div>Nombre</div><div>Estado</div><div>Acciones</div></div>
      <div class="tbl-body">
        ${list.map(r => `
          <div class="tbl-row">
            <div class="tbl-cell">${r.nombre}</div>
            <div class="tbl-cell">
              <span class="estado-pill ${r.activo?'pill--ok':'pill--off'}">${r.activo?'Activo':'Inactivo'}</span>
            </div>
            <div class="tbl-cell tbl-actions">
              <button class="btn-icon" onclick="showRolModal(${r.id},'${r.nombre.replace(/'/g,"\\'")}',${r.activo})" title="Editar">${ICONS.edit}</button>
              <button class="btn-icon btn-icon--danger" onclick="deleteRol(${r.id})" title="Eliminar">${ICONS.trash}</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

function showRolModal(id, nombre, activo) {
  document.getElementById('mrol-id').value     = id || '';
  document.getElementById('mrol-nombre').value = nombre || '';
  document.getElementById('mrol-activo').checked = activo !== false;
  setEl('modal-rol-title', id ? 'Editar rol' : 'Nuevo rol');
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
    el.innerHTML = `<div class="empty-box"><div class="no-data-icon">${ICONS.calendar}</div><div class="empty-txt">${q ? 'Sin resultados para "'+q+'".' : 'Sin períodos.'}</div></div>`;
    return;
  }
  el.innerHTML = `
    <div class="tbl">
      <div class="tbl-head"><div>Nombre</div><div>Descripción</div><div>Activo</div><div>Acciones</div></div>
      <div class="tbl-body">
        ${list.map(p => `
          <div class="tbl-row">
            <div class="tbl-cell"><strong>${p.nombre}</strong></div>
            <div class="tbl-cell tbl-muted">${p.descripcion || '—'}</div>
            <div class="tbl-cell">
              <span class="estado-pill ${p.activo?'pill--ok':'pill--off'}">${p.activo?'Activo':'—'}</span>
            </div>
            <div class="tbl-cell tbl-actions">
              <button class="btn-icon" onclick="showPeriodoModal(${p.id},'${p.nombre.replace(/'/g,"\\'")}','${(p.descripcion||'').replace(/'/g,"\\'")}',${p.activo})" title="Editar">${ICONS.edit}</button>
              <button class="btn-icon btn-icon--danger" onclick="deletePeriodo(${p.id})" title="Eliminar">${ICONS.trash}</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

function showPeriodoModal(id, nombre, desc, activo) {
  document.getElementById('mpe-id').value     = id || '';
  document.getElementById('mpe-nombre').value = nombre || '';
  document.getElementById('mpe-desc').value   = desc || '';
  document.getElementById('mpe-activo').checked = !!activo;
  setEl('modal-periodo-title', id ? 'Editar período' : 'Nuevo período');
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

  const res = await API.savePeriodo({ id: id ? Number(id) : null, nombre, descripcion: desc, activo });
  if (!res.ok) { err.textContent = res.error; return; }

  showToast(id ? 'Período actualizado' : 'Período creado', 'ok');
  closeModal('modal-periodo');
  _periodos = await API.getPeriodos();
  if (!_activePE) _activePE = _periodos.find(p => p.activo) || _periodos[0];
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
    el.innerHTML = `<div class="empty-box"><div class="empty-txt">${q ? 'Sin resultados para "'+q+'".' : 'Sin criterios. Agrega el primero.'}</div></div>`;
    return;
  }
  el.innerHTML = `
    <div class="tbl">
      <div class="tbl-head"><div>Color</div><div>Nombre</div><div>Abbr</div><div>Key</div><div>Orden</div><div>Estado</div><div>Acciones</div></div>
      <div class="tbl-body">
        ${list.map(c => `
          <div class="tbl-row">
            <div class="tbl-cell"><span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${c.color};flex-shrink:0"></span></div>
            <div class="tbl-cell"><strong>${c.label}</strong></div>
            <div class="tbl-cell"><span class="cbar-tag" style="color:${c.color}">${c.abbr}</span></div>
            <div class="tbl-cell tbl-muted">${c.key}</div>
            <div class="tbl-cell tbl-muted">${c.orden}</div>
            <div class="tbl-cell"><span class="estado-pill ${c.activo?'pill--ok':'pill--off'}">${c.activo?'Activo':'Inactivo'}</span></div>
            <div class="tbl-cell tbl-actions">
              <button class="btn-icon" onclick="showCriterioModal(${c.id})" title="Editar">${ICONS.edit}</button>
              <button class="btn-icon btn-icon--danger" onclick="deleteCriterioEntry(${c.id})" title="Eliminar">${ICONS.trash}</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

function showCriterioModal(id) {
  const c = id ? _criterios.find(x => x.id === id) : null;
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
  renderCriterios();
  renderRubrica();
}

async function deleteCriterioEntry(id) {
  if (!confirm('¿Eliminar este criterio? Se eliminarán también sus entradas de rúbrica.')) return;
  const res = await API.deleteCriterio(id);
  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  showToast('Criterio eliminado', 'ok');
  _criterios = await API.getCriterios();
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
    el.innerHTML = `<div class="empty-box"><div class="no-data-icon">${ICONS.ruler}</div><div class="empty-txt">${q ? 'Sin resultados para "'+q+'".' : 'Sin entradas de rúbrica. Agrega la primera.'}</div></div>`;
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
    const color = c.color || '#888';
    return `
      <div class="rubrica-card" id="rca-${i}">
        <div class="rubrica-card-head" onclick="document.getElementById('rca-${i}').classList.toggle('open')">
          <div class="rubrica-dot" style="background:${color}"></div>
          <div class="rubrica-title" style="color:${color}">${r.criterio || c.label || '—'}</div>
          <span class="rubrica-chev"></span>
        </div>
        <div class="rubrica-body">
          <div class="rubrica-levels">
            ${levels.map(l => `<div class="rlevel"><div class="rlevel-badge" style="color:${l.color}">${l.n}</div><div class="rlevel-lbl" style="color:${l.color}">${l.lbl}</div><div class="rlevel-desc">${r[lk[l.n]] || '—'}</div></div>`).join('')}
          </div>
          <div style="display:flex;gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid var(--faint)">
            <button class="btn-icon" onclick="showRubricaModal(${r.id})" title="Editar entrada">${ICONS.edit}</button>
            <button class="btn-icon btn-icon--danger" onclick="deleteRubricaEntry(${r.id})" title="Eliminar">${ICONS.trash}</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function showRubricaModal(id) {
  const r = id ? _rubrica.find(x => x.id === id) : null;
  const critSel = document.getElementById('mrub-criterio');
  const allCrits = _criterios.length ? _criterios : getCriterios();
  critSel.innerHTML = '<option value="">Seleccionar criterio...</option>' +
    allCrits.map(c => `<option value="${c.id}" ${r?.criterio_id === c.id ? 'selected' : ''}>${c.label}</option>`).join('');

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

  const crit    = (_criterios.length ? _criterios : getCriterios()).find(c => c.id === Number(criterio_id));
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
    el.innerHTML = `<div class="empty-box"><div class="no-data-icon">${ICONS.calendar}</div><div class="empty-txt">${q ? 'Sin resultados para "'+q+'".' : 'No hay eventos. Agrega el primero.'}</div></div>`;
    return;
  }
  const cAcc = { rojo:'cal-acc--rojo', verde:'cal-acc--verde', azul:'cal-acc--azul', amarillo:'cal-acc--amarillo' };
  const cT   = { rojo:'cal-t--rojo',   verde:'cal-t--verde',  azul:'cal-t--azul',   amarillo:'cal-t--amarillo' };
  el.innerHTML = `<div class="cal-grid">` +
    list.map(p => {
      const c    = (p.color || 'rojo').toLowerCase();
      const rows = [['Inicio',p.inicio],['Fin trabajo',p.fin_trabajo],['Entrega',p.entrega],['Jornada',p.jornada]].filter(([,v]) => v);
      return `
        <div class="cal-card">
          <div class="cal-acc ${cAcc[c] || cAcc.rojo}"></div>
          <div class="cal-body">
            <div class="cal-num">PERÍODO ${String(p.numero).padStart(2,'0')}</div>
            <div class="cal-t ${cT[c] || cT.rojo}">${p.titulo}</div>
            ${rows.map(([l,v]) => `<div class="cal-r"><span class="cal-rl">${l}</span><span>${v}</span></div>`).join('')}
            <div style="display:flex;gap:6px;margin-top:10px">
              <button class="btn-icon" onclick="showCalModal(${p.id})" title="Editar">${ICONS.edit}</button>
              <button class="btn-icon btn-icon--danger" onclick="deleteCal(${p.id})" title="Eliminar">${ICONS.trash}</button>
            </div>
          </div>
        </div>`;
    }).join('') + `</div>`;
}

function showCalModal(id) {
  const p = id ? _calendario.find(c => c.id === id) : null;
  document.getElementById('mcal-id').value      = p?.id || '';
  document.getElementById('mcal-num').value     = p?.numero || '';
  document.getElementById('mcal-titulo').value  = p?.titulo || '';
  document.getElementById('mcal-color').value   = p?.color || 'rojo';
  document.getElementById('mcal-inicio').value  = p?.inicio || '';
  document.getElementById('mcal-fin').value     = p?.fin_trabajo || '';
  document.getElementById('mcal-entrega').value = p?.entrega || '';
  document.getElementById('mcal-jornada').value = p?.jornada || '';
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
    inicio:      document.getElementById('mcal-inicio').value.trim()   || null,
    fin_trabajo: document.getElementById('mcal-fin').value.trim()      || null,
    entrega:     document.getElementById('mcal-entrega').value.trim()  || null,
    jornada:     document.getElementById('mcal-jornada').value.trim()  || null,
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
    `<button class="pb${p.id === _activePEDist?.id ? ' active' : ''}" onclick="selectDistPE(${p.id},this)">${p.nombre}</button>`
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
    _distritos.map(d => `<option value="${d.id}">${d.nombre}</option>`).join('');
}

function onDistSelectChange() {
  const sel = document.getElementById('dist-eval-select'); if (!sel?.value) return;
  _activeDistId = sel.value;
  loadDistEval(sel.value);
}

async function renderDistritoRanking(periodoId) {
  const el = document.getElementById('dist-ranking'); if (!el) return;
  if (!periodoId) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';

  const evals = await API.getEvaluacionesByPE(periodoId);
  const criterios = getCriterios();
  const MAX = criterios.length * 4 + 2;

  const distMap = {};
  _distritos.forEach(d => { distMap[d.id] = { id: d.id, nombre: d.nombre, scores: [] }; });

  evals.forEach(ev => {
    if (ev.estado !== 'publicado') return;
    const user = _users.find(u => u.id === ev.evaluado_id);
    if (!user?.distrito || !distMap[user.distrito]) return;
    const puntajes = ev.puntajes || {};
    const total    = criterios.reduce((s, c) => s + (puntajes[c.key] || 0), 0) + (ev.bono_ext || 0);
    distMap[user.distrito].scores.push(total);
  });

  const q = (document.getElementById('search-distritos')?.value || '').toLowerCase().trim();
  const ranked = Object.values(distMap)
    .filter(d => d.scores.length > 0 && (!q || d.nombre.toLowerCase().includes(q)))
    .map(d => ({ ...d, avg: d.scores.reduce((a, b) => a + b, 0) / d.scores.length, count: d.scores.length }))
    .sort((a, b) => b.avg - a.avg);

  if (!ranked.length) {
    el.innerHTML = `<div class="empty-box"><div class="empty-icon">${ICONS.map}</div><div class="empty-txt">${q ? 'Sin resultados para "'+q+'".' : 'Sin evaluaciones publicadas para este período.'}</div></div>`;
    return;
  }

  const posClass = ['gold','silver','bronze'];
  el.innerHTML = `
    <div class="tbl" style="max-width:700px">
      <div class="tbl-head" style="grid-template-columns:48px 1fr 90px 80px 100px">
        <div>#</div><div>Distrito</div><div style="text-align:center">Promedio</div><div style="text-align:center">Miembros</div><div style="text-align:center">Nivel</div>
      </div>
      <div class="tbl-body">
        ${ranked.map((d, i) => `
          <div class="tbl-row" style="grid-template-columns:48px 1fr 90px 80px 100px;cursor:pointer"
               onclick="document.getElementById('dist-eval-select').value='${d.id}';onDistSelectChange()">
            <div class="tbl-cell"><span class="rank-num ${posClass[i] || ''}">${i + 1}</span></div>
            <div class="tbl-cell"><strong>${d.nombre}</strong></div>
            <div class="tbl-cell" style="justify-content:center">
              <span style="font-family:'Bebas Neue',sans-serif;font-size:1.2rem;color:${scoreColor(d.avg)}">${d.avg.toFixed(1)}</span>
              <span style="font-size:.65rem;color:var(--muted);margin-left:3px">/ ${MAX}</span>
            </div>
            <div class="tbl-cell" style="justify-content:center;color:var(--muted);font-size:.82rem">${d.count}</div>
            <div class="tbl-cell" style="justify-content:center"><span class="nivel-badge ${scoreClass(d.avg)}" style="padding:2px 8px;font-size:.55rem">${scoreLabel(d.avg)}</span></div>
          </div>`).join('')}
      </div>
    </div>`;
}

async function loadDistEval(distId) {
  const area = document.getElementById('dist-eval-area'); if (!area) return;
  if (!_activePEDist || !distId) { area.innerHTML = ''; return; }
  area.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';
  const ev = await API.getEvalDistrito(_activePEDist.id, distId);
  renderDistEvalForm(ev, distId);
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

function renderDistEvalForm(ev, distId) {
  const area     = document.getElementById('dist-eval-area'); if (!area) return;
  const distrito = _distritos.find(d => d.id === distId);
  const criterios = getCriterios();
  const puntajes  = ev?.puntajes    || {};
  const coms      = ev?.comentarios || {};
  const igStats   = ev?.ig_stats    || {};
  const estado    = ev?.estado      || 'borrador';
  const isPub     = estado === 'publicado';

  const rows = criterios.map((c, i) => `
    <div class="eval-criterio-row" style="animation-delay:${i*30}ms">
      <div class="eval-crit-head">
        <div class="cbar-tag" style="color:${c.color}">${c.abbr}</div>
        <div class="eval-crit-label">${c.label}</div>
      </div>
      <div class="eval-crit-inputs">
        <div class="score-btns">
          ${[1,2,3,4].map(v => `<button class="score-btn${(puntajes[c.key]||0)===v?' active':''}"
            onclick="setDistScore('${c.key}',${v},this)" style="--sc:${c.color}">${v}</button>`).join('')}
          <input type="hidden" id="dsc-${c.key}" value="${puntajes[c.key]||0}">
        </div>
        <input class="cfg-inp eval-com-inp" type="text" id="dcom-${c.key}"
          placeholder="Comentario (opcional)" value="${(coms[c.key]||'').replace(/"/g,'&quot;')}">
      </div>
    </div>`).join('');

  area.innerHTML = `
    <div class="eval-form-card" style="max-width:800px">
      <div class="eval-form-header">
        <div>
          <div class="eval-miembro-name">${distrito?.nombre || distId}</div>
          <div class="eval-miembro-rol">Evaluación de distrito</div>
        </div>
        <span class="eval-estado-badge estado--${estado}">${estado}</span>
      </div>

      <div class="section-label" style="margin-top:4px">Estadísticas de Instagram</div>
      <div class="ig-stats-grid">
        ${_IG_FIELDS.map(f => `
          <div class="ig-stat-field">
            <label class="ig-stat-lbl">${f.label}</label>
            <input class="ig-stat-inp" type="text" id="ig-${f.key}"
              placeholder="${f.placeholder}" value="${igStats[f.key] || ''}">
          </div>`).join('')}
      </div>

      <div class="section-label">Criterios</div>
      <div class="eval-criterios-list">${rows}</div>

      <div class="eval-extras">
        <label class="eval-extra-label">Notas / Comentario general</label>
        <textarea class="cfg-inp eval-com-inp" id="dcom-general" rows="3"
          placeholder="Notas del evaluador...">${coms.general||''}</textarea>
      </div>

      ${isPub
        ? `<div class="eval-pub-info">
             <span class="eval-pub-dot"></span>
             Evaluación publicada — visible en el ranking de distritos
           </div>
           <div class="eval-actions">
             <button class="btn-draft" onclick="saveDistEval('borrador','${distId}')">Volver a borrador</button>
             <button class="btn-save btn-confirm" onclick="saveDistEval('publicado','${distId}')">Confirmar cambios</button>
           </div>`
        : `<div class="eval-actions">
             <button class="btn-draft" onclick="saveDistEval('borrador','${distId}')">Guardar borrador</button>
             <button class="btn-save btn-publish" onclick="saveDistEval('publicado','${distId}')">Publicar</button>
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
  const criterios = getCriterios();
  const puntajes = {}, comentarios = {};
  criterios.forEach(c => {
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

/* ── AVATAR UPLOAD ── */
async function handleAvatarUpload(e) {
  const file = e.target.files?.[0]; if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Imagen demasiado grande (máx. 2 MB)', 'error'); return; }
  showToast('Subiendo foto...', 'info');
  const res = await API.uploadAvatar(CU.id, file);
  if (!res.ok) { showToast('Error: ' + res.error, 'error'); return; }
  CU.avatar_url = res.url;
  const img = `<img src="${res.url}?t=${Date.now()}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  ['av-desktop','av-mobile'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = img;
  });
  showToast('Foto actualizada', 'ok');
  e.target.value = '';
}

/* ── SCORE HELPERS ── */
const calcScore  = (p, b) => Object.values(p||{}).reduce((s,v)=>s+(Number(v)||0),0)+(Number(b)||0);
const scoreColor = s => s >= 26 ? 'var(--sex)' : s >= 20 ? 'var(--sbu)' : s >= 11 ? 'var(--spr)' : 'var(--sba)';
const scoreLabel = s => s >= 26 ? 'Excelente' : s >= 20 ? 'Bueno' : s >= 11 ? 'En Proceso' : 'Bajo';
const scoreClass = s => s >= 24 ? 'sex' : s >= 18 ? 'sbu' : s >= 10 ? 'spr' : 'sba';

/* ── MODALES ── */
function openModal(id)  {
  const m = document.getElementById(id);
  if (m) { m.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) { m.style.display = 'none'; document.body.style.overflow = ''; }
}

/* ══════════════════════════════════════════════════
   TAB: OVERVIEW
   ══════════════════════════════════════════════════ */
function renderOvPEBar() {
  const bar = document.getElementById('ov-pe-btns'); if (!bar) return;
  if (!_periodos.length) { bar.innerHTML = '<span style="color:var(--muted);font-size:.8rem">Sin períodos.</span>'; return; }
  if (!_activePEOv) _activePEOv = _periodos.find(p => p.activo) || _periodos[0];
  bar.innerHTML = _periodos.map(p =>
    `<button class="pb${p.id === _activePEOv?.id ? ' active' : ''}" onclick="selectOvPE(${p.id},this)">${p.nombre}</button>`
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
    score: calcScore(e.puntajes, e.bono_ext),
    user:  _users.find(u => u.id === e.evaluado_id),
  })).filter(e => e.user).sort((a, b) => b.score - a.score);

  const avgScore  = scored.length ? (scored.reduce((s,e) => s + e.score, 0) / scored.length).toFixed(1) : null;
  const topScore  = scored[0]?.score ?? null;
  const pending   = nonAdmins.filter(u => !pub.find(e => e.evaluado_id === u.id)).length;

  const dist = { sex:0, sbu:0, spr:0, sba:0 };
  scored.forEach(e => { const k = scoreClass(e.score); dist[k] = (dist[k]||0)+1; });

  const critAvg = criterios.map(c => {
    const vals = pub.map(e => Number(e.puntajes?.[c.key])||0).filter(v => v > 0);
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

  const navBtn = n => `document.querySelectorAll('#desktop-nav .tnav')[${n}]`;

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
        <div class="kpi-sub">${scored[0]?.user?.nombre?.split(' ')[0] || '—'}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon" style="color:var(--spr)">${ICONS.calendar}</div>
        <div class="kpi-val">${_periodos.length}</div>
        <div class="kpi-lbl">Períodos</div>
        <div class="kpi-sub">${_periodos.filter(p=>p.activo).length} activo(s)</div>
      </div>
    </div>

    <div class="ov-actions">
      <button class="ov-action-btn" onclick="switchTab('evaluar',${navBtn(1)})">${ICONS.zap} Evaluar</button>
      <button class="ov-action-btn" onclick="switchTab('usuarios',${navBtn(2)})">${ICONS.users} Usuarios</button>
      <button class="ov-action-btn" onclick="switchTab('distritos',${navBtn(7)})">${ICONS.map} Distritos</button>
      <button class="ov-action-btn" onclick="switchTab('periodos',${navBtn(4)})">${ICONS.calendar} Períodos</button>
      <button class="ov-action-btn" onclick="switchTab('calendario',${navBtn(6)})">${ICONS.calendar} Calendario</button>
      <button class="ov-action-btn" onclick="switchTab('rubrica',${navBtn(5)})">${ICONS.ruler} Rúbrica</button>
    </div>

    <div class="ov-cols">
      <div class="ov-panel">
        <div class="rank-panel-header">
          <div class="ov-panel-title" style="margin-bottom:0">🏆 Ranking — ${_activePEOv?.nombre || ''}</div>
          <div class="rank-tabs">
            <button class="rank-tab-btn${_rankingTab==='users'?' rank-tab-active':''}" onclick="switchRankTab('users')">Usuarios</button>
            <button class="rank-tab-btn${_rankingTab==='dist'?' rank-tab-active':''}" onclick="switchRankTab('dist')">Distritos</button>
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
                <div class="rank-name">${e.user.nombre}</div>
                <div class="rank-role">${e.user.roles?.nombre||e.user.distrito||'—'}</div>
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
            score: calcScore(d.puntajes, d.bono_ext),
            distInfo: _distritos.find(x => x.id === d.distrito_id),
          })).sort((a,b) => b.score - a.score);
          if (!scoredDist.length) return `<div class="empty-box" style="margin:0"><div class="empty-txt">Sin evaluaciones de distrito publicadas.</div></div>`;
          return `<div class="ov-ranking">
            ${scoredDist.map((d,i) => {
              const pct = Math.round(d.score/MAX*100);
              const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`<span style="font-family:'Bebas Neue',sans-serif;color:var(--muted)">${i+1}</span>`;
              return `<div class="rank-row">
                <div class="rank-pos">${medal}</div>
                <div class="rank-info">
                  <div class="rank-name">${d.distInfo?.nombre || d.distInfo?.codigo || `Distrito ${d.distrito_id}`}</div>
                  <div class="rank-role">${d.distInfo?.codigo || '—'}</div>
                </div>
                <div class="rank-bar-wrap"><div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%;background:${scoreColor(d.score)}"></div></div></div>
                <div class="rank-score" style="color:${scoreColor(d.score)}">${d.score}</div>
                <span class="nivel-badge ${scoreClass(d.score)}" style="padding:2px 7px;font-size:.52rem">${scoreLabel(d.score)}</span>
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
              <div class="level-dist-lbl" style="color:${l.color}">${l.lbl}</div>
              <div class="level-dist-bar"><div class="level-dist-fill" style="width:${pct}%;background:${l.color}"></div></div>
              <div class="level-dist-num">${n}</div>
            </div>`;
          }).join('')}
        </div>

        <div class="ov-panel">
          <div class="ov-panel-title">Actividad reciente</div>
          ${recent.length ? recent.map(e => {
            const user = _users.find(u=>u.id===e.evaluado_id);
            const evtr = _users.find(u=>u.id===e.evaluador_id);
            const sc   = calcScore(e.puntajes, e.bono_ext);
            const d    = e.updated_at||e.created_at;
            return `<div class="activity-item">
              <div class="activity-dot" style="background:${scoreColor(sc)}"></div>
              <div class="activity-body">
                <div class="activity-text">${user?.nombre||'—'}</div>
                <div class="activity-sub">Por ${evtr?.nombre||'Admin'} · ${d?timeAgo(d):'—'}</div>
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
            <div class="crit-bar-tag" style="color:${c.color}">${c.abbr}</div>
            <div style="flex:1;min-width:0">
              <div class="crit-bar-name">${c.label}</div>
              <div class="crit-bar-bg"><div class="crit-bar-fill" style="width:${c.avg/4*100}%;background:${c.color}"></div></div>
            </div>
            <div class="crit-bar-val">${c.avg?c.avg.toFixed(1):'—'}<span style="font-size:.6rem;color:var(--muted)"> /4</span></div>
          </div>`).join('')}
      </div>
    </div>
  `;
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
function switchTab(tab, btn) {
  document.querySelectorAll('.atab-content').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${tab}`)?.classList.add('active');
  document.querySelectorAll('#desktop-nav .tnav').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  if (tab === 'overview' && !_overviewEvals.length) loadOverview();
  if (tab === 'reportes' && !_rptPE && _periodos.length) {
    const def = _periodos.find(p => p.activo) || _periodos[0];
    if (def) selectRptPE(def.id, document.querySelector('#rpt-pe-btns .rpt-pe-btn'));
  }
}
function switchTabMobile(tab, btn) {
  switchTab(tab, null);
  document.querySelectorAll('.mobile-menu .mobile-nav-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  closeMenu();
  const tabs = ['overview','evaluar','usuarios','roles','periodos','rubrica','calendario','distritos','reportes'];
  const idx  = tabs.indexOf(tab);
  document.querySelectorAll('#desktop-nav .tnav').forEach((b, i) => b.classList.toggle('active', i === idx));
}

/* ── TAB: REPORTES ── */
function renderRptPEBar() {
  const bar = document.getElementById('rpt-pe-btns'); if (!bar) return;
  if (!_periodos.length) { bar.innerHTML = '<span style="color:var(--muted);font-size:.8rem">Sin períodos.</span>'; return; }
  bar.innerHTML = _periodos.map(p =>
    `<button class="eval-pe-btn rpt-pe-btn${_rptPE?.id===p.id?' eval-pe-btn--active':''}" onclick="selectRptPE(${p.id},this)">${p.nombre}</button>`
  ).join('');
}

async function selectRptPE(periodoId, _btn) {
  _rptPE = _periodos.find(p => p.id === periodoId) || null;
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
    score: calcScore(e.puntajes, e.bono_ext),
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
    const vals = pub.map(e => Number(e.puntajes?.[c.key]) || 0).filter(v => v > 0);
    return { ...c, avg: vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length) : 0 };
  });

  const today = new Date().toLocaleDateString('es-MX', { year:'numeric', month:'long', day:'numeric' });

  el.innerHTML = `
  <div class="rpt-page" id="rpt-print-area">
    <div class="rpt-header">
      <div>
        <div class="rpt-org">EIGHT CREATORS LABs</div>
        <div class="rpt-title-big">REPORTE DE EVALUACIONES</div>
        <div class="rpt-period-lbl">${_rptPE.nombre}${_rptPE.descripcion ? ' · ' + _rptPE.descripcion : ''}</div>
      </div>
      <div class="rpt-date-wrap">
        <div class="rpt-date-lbl">Generado el</div>
        <div class="rpt-date-val">${today}</div>
      </div>
    </div>

    <div class="rpt-kpi-row">
      <div class="rpt-kpi"><div class="rpt-kpi-val">${nonAdmins.length}</div><div class="rpt-kpi-lbl">Miembros</div></div>
      <div class="rpt-kpi"><div class="rpt-kpi-val" style="color:var(--sex)">${evaluated}</div><div class="rpt-kpi-lbl">Evaluados</div></div>
      <div class="rpt-kpi"><div class="rpt-kpi-val" style="color:var(--accent2)">${avgScore}</div><div class="rpt-kpi-lbl">Promedio</div></div>
      <div class="rpt-kpi"><div class="rpt-kpi-val" style="color:var(--sex)">${topScore}</div><div class="rpt-kpi-lbl">Puntaje más alto</div></div>
      <div class="rpt-kpi"><div class="rpt-kpi-val" style="color:var(--sba)">${unevaluated}</div><div class="rpt-kpi-lbl">Sin evaluar</div></div>
    </div>

    ${evaluated === 0 ? `<div class="empty-box" style="margin:32px 0"><div class="empty-txt">No hay evaluaciones publicadas en este período.</div></div>` : `
    <div class="rpt-section-lbl">Ranking de miembros</div>
    <div class="rpt-table-wrap">
      <table class="rpt-table">
        <thead>
          <tr>
            <th class="rpt-th rpt-th-num">#</th>
            <th class="rpt-th">Nombre</th>
            <th class="rpt-th">Rol</th>
            ${criterios.map(c => `<th class="rpt-th rpt-th-crit" title="${c.label}">${c.abbr}</th>`).join('')}
            <th class="rpt-th">Bono</th>
            <th class="rpt-th">Total</th>
            <th class="rpt-th">Nivel</th>
          </tr>
        </thead>
        <tbody>
          ${scored.map((e, i) => `
            <tr class="rpt-tr ${i % 2 === 0 ? 'rpt-tr-even' : ''}">
              <td class="rpt-td rpt-td-num">${i + 1}</td>
              <td class="rpt-td rpt-td-name">${e.user.nombre}</td>
              <td class="rpt-td rpt-td-role">${e.user.roles?.nombre || '—'}</td>
              ${criterios.map(c => `<td class="rpt-td rpt-td-score">${e.puntajes?.[c.key] || 0}</td>`).join('')}
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
              <div class="rpt-dist-bar-track"><div class="rpt-dist-bar-fill" style="height:${pct}%;background:${n.color}"></div></div>
              <div class="rpt-dist-count" style="color:${n.color}">${cnt}</div>
              <div class="rpt-dist-nlbl">${n.label}</div>
              <div class="rpt-dist-pct">${pct}%</div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="rpt-section rpt-section-crit">
        <div class="rpt-section-lbl">Promedio por criterio</div>
        ${critAvg.map(c => {
          const pct = (c.avg / 4) * 100;
          return `<div class="rpt-crit-row">
            <div class="rpt-crit-lbl" title="${c.label}">${c.abbr}</div>
            <div class="rpt-crit-bar-track">
              <div class="rpt-crit-bar-fill" style="width:${pct}%;background:${c.color||'var(--accent2)'}"></div>
            </div>
            <div class="rpt-crit-val">${c.avg ? c.avg.toFixed(1) : '—'}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
    `}

    <div class="rpt-footer">EIGHT CREATORS LABs · ${_rptPE.nombre} · Generado el ${today}</div>
  </div>`;
}

function printAdminReport() {
  if (!_rptPE) { showToast('Selecciona un período primero', 'error'); return; }
  window.print();
}

/* ── MENÚ ── */
function toggleMenu() {
  _menuOpen = !_menuOpen;
  document.getElementById('hamburger')?.classList.toggle('open', _menuOpen);
  document.getElementById('mobile-menu')?.classList.toggle('open', _menuOpen);
  document.getElementById('hamburger')?.setAttribute('aria-expanded', _menuOpen);
  document.body.style.overflow = _menuOpen ? 'hidden' : '';
}
function closeMenu() {
  _menuOpen = false;
  document.getElementById('hamburger')?.classList.remove('open');
  document.getElementById('mobile-menu')?.classList.remove('open');
  document.getElementById('hamburger')?.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}
document.addEventListener('click', e => {
  const menu = document.getElementById('mobile-menu'), ham = document.getElementById('hamburger');
  if (menu?.classList.contains('open') && !menu.contains(e.target) && !ham?.contains(e.target)) closeMenu();
});
window.addEventListener('resize', () => { if (window.innerWidth > 720) closeMenu(); });

/* ── HELPERS ── */
const initials = n => (n || '?').split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
const setEl    = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

function showToast(msg, type = '') {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.className = `toast${type ? ' toast--' + type : ''} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

function initScrollEffects() {
  const topbar = document.getElementById('topbar');
  window.addEventListener('scroll', () => {
    topbar?.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });
}
