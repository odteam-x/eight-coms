/**
 * EIGHT CREATORS LABs — Panel Admin (Supabase)
 */
'use strict';

let CU = null;
let _users      = [];
let _roles      = [];
let _periodos   = [];
let _criterios  = [];
let _rubrica    = [];
let _calendario = [];
let _activePE   = null;
let _menuOpen   = false;

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
  const ini  = initials(name);
  setEl('av-desktop', ini); setEl('av-mobile', ini);
  setEl('uname-desktop', name); setEl('uname-mobile', name);

  await loadAllData();
  renderEvalPEBar();
  renderUsuarios();
  renderRoles();
  renderPeriodos();
  renderRubrica();
  renderCalendario();
  initScrollEffects();
});

async function loadAllData() {
  const [users, roles, pes, crits, rub, cal] = await Promise.all([
    API.getAllUsers(),
    API.getRoles(false),
    API.getPeriodos(),
    API.getCriterios(),
    API.getRubrica(),
    API.getCalendario(),
  ]);
  _users      = users;
  _roles      = roles;
  _periodos   = pes;
  _criterios  = crits;
  _rubrica    = rub;
  _calendario = cal;

  const defPE = _periodos.find(p => p.activo) || _periodos[0];
  if (defPE && !_activePE) _activePE = defPE;
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
            onclick="setScore('${c.key}',${v},this)" style="--sc:${c.color}" ${isPub?'disabled':''}>${v}</button>`).join('')}
          <input type="hidden" id="sc-${c.key}" value="${puntajes[c.key]||0}">
        </div>
        <input class="cfg-inp eval-com-inp" type="text" id="com-${c.key}"
          placeholder="Comentario (opcional)" value="${(coms[c.key]||'').replace(/"/g,'&quot;')}" ${isPub?'disabled':''}>
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
            onclick="setBono(${v},this)" style="--sc:var(--sex)" ${isPub?'disabled':''}>${v}</button>`).join('')}
          <input type="hidden" id="sc-bono" value="${bono}">
        </div>
      </div>

      <div class="eval-extras">
        <label class="eval-extra-label">Comentario general</label>
        <textarea class="cfg-inp eval-com-inp" id="com-general" rows="3"
          placeholder="Comentario general..." ${isPub?'disabled':''}>${coms.general||''}</textarea>
      </div>

      ${isPub
        ? `<div class="eval-pub-notice">Esta evaluación ya fue publicada. El miembro puede verla en su portal.</div>`
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
function renderUsuarios() {
  const el = document.getElementById('usuarios-list'); if (!el) return;
  if (!_users.length) {
    el.innerHTML = `<div class="empty-box"><div class="no-data-icon">${ICONS.users}</div><div class="empty-txt">Sin usuarios.</div></div>`;
    return;
  }
  el.innerHTML = `
    <div class="tbl">
      <div class="tbl-head">
        <div>Nombre</div><div>Email</div><div>Rol</div><div>Admin</div>
      </div>
      <div class="tbl-body">
        ${_users.map(u => `
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
          </div>`).join('')}
      </div>
    </div>`;
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
  if (!_roles.length) {
    el.innerHTML = `<div class="empty-box"><div class="no-data-icon">${ICONS.clipboard}</div><div class="empty-txt">Sin roles.</div></div>`;
    return;
  }
  el.innerHTML = `
    <div class="tbl">
      <div class="tbl-head"><div>Nombre</div><div>Estado</div><div>Acciones</div></div>
      <div class="tbl-body">
        ${_roles.map(r => `
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
  if (!_periodos.length) {
    el.innerHTML = `<div class="empty-box"><div class="no-data-icon">${ICONS.calendar}</div><div class="empty-txt">Sin períodos.</div></div>`;
    return;
  }
  el.innerHTML = `
    <div class="tbl">
      <div class="tbl-head"><div>Nombre</div><div>Descripción</div><div>Activo</div><div>Acciones</div></div>
      <div class="tbl-body">
        ${_periodos.map(p => `
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

/* ── TAB: RÚBRICA ── */
function renderRubrica() {
  const el = document.getElementById('rubrica-admin-grid'); if (!el) return;
  if (!_rubrica.length) {
    el.innerHTML = `<div class="empty-box"><div class="no-data-icon">${ICONS.ruler}</div><div class="empty-txt">Rúbrica no disponible.</div></div>`;
    return;
  }
  const criterios = getCriterios();
  const levels    = [
    { n:4, lbl:'Excelente', color:'var(--sex)' },
    { n:3, lbl:'Bueno',     color:'var(--sbu)' },
    { n:2, lbl:'En Proceso',color:'var(--spr)' },
    { n:1, lbl:'Bajo',      color:'var(--sba)' },
  ];
  const lk = { 4:'nivel4', 3:'nivel3', 2:'nivel2', 1:'nivel1' };
  el.innerHTML = _rubrica.map((r, i) => {
    const c     = criterios[i] || r.criterios || {};
    const color = c.color || '#888';
    return `
      <div class="rubrica-card" id="rca-${i}">
        <div class="rubrica-card-head" onclick="document.getElementById('rca-${i}').classList.toggle('open')">
          <div class="rubrica-dot" style="background:${color}"></div>
          <div class="rubrica-title" style="color:${color}">${r.criterio || c.label || '—'}</div>
          <span class="rubrica-chev">▾</span>
        </div>
        <div class="rubrica-body">
          <div class="rubrica-levels">
            ${levels.map(l => `<div class="rlevel"><div class="rlevel-badge" style="color:${l.color}">${l.n}</div><div class="rlevel-lbl" style="color:${l.color}">${l.lbl}</div><div class="rlevel-desc">${r[lk[l.n]] || '—'}</div></div>`).join('')}
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ── TAB: CALENDARIO ── */
function renderCalendario() {
  const el = document.getElementById('cal-editor-list'); if (!el) return;
  if (!_calendario.length) {
    el.innerHTML = `<div class="empty-box"><div class="no-data-icon">${ICONS.calendar}</div><div class="empty-txt">No hay eventos. Agrega el primero.</div></div>`;
    return;
  }
  const cAcc = { rojo:'cal-acc--rojo', verde:'cal-acc--verde', azul:'cal-acc--azul', amarillo:'cal-acc--amarillo' };
  const cT   = { rojo:'cal-t--rojo',   verde:'cal-t--verde',  azul:'cal-t--azul',   amarillo:'cal-t--amarillo' };
  el.innerHTML = `<div class="cal-grid">` +
    _calendario.map(p => {
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

/* ── MODALES ── */
function openModal(id)  {
  const m = document.getElementById(id);
  if (m) { m.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) { m.style.display = 'none'; document.body.style.overflow = ''; }
}

/* ── TABS ── */
function switchTab(tab, btn) {
  document.querySelectorAll('.atab-content').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${tab}`)?.classList.add('active');
  document.querySelectorAll('#desktop-nav .tnav').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
}
function switchTabMobile(tab, btn) {
  switchTab(tab, null);
  document.querySelectorAll('.mobile-menu .mobile-nav-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  closeMenu();
  const tabs = ['evaluar','usuarios','roles','periodos','rubrica','calendario'];
  const idx  = tabs.indexOf(tab);
  document.querySelectorAll('#desktop-nav .tnav').forEach((b, i) => b.classList.toggle('active', i === idx));
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
