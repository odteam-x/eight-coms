/**
 * EIGHT CREATORS LABs — Lógica Vista de Miembro (Supabase)
 */
'use strict';

let CU = null;

const _USER_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

let _criterios  = [];
let _evaluaciones = [];
let _rubrica    = [];
let _calendario = [];
let _periodos   = [];
let _activePE   = null;
let _lastUpdated = null;
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
const getMaxScore  = () => getCriterios().length * 4;

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', async () => {
  CU = await Auth.requireAuth(false); // false → redirige admins a admin.html
  if (!CU) return;

  // Mostrar nombre e icono de usuario inmediatamente
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
  setEl('hero-name', name);
  if (CU.roles?.nombre) setEl('urole-mobile', CU.roles.nombre);

  await loadData();
  initUI();
  initScrollEffects();
});

async function loadData() {
  const [evals, crits, rub, cal, pes] = await Promise.all([
    API.getMisEvaluaciones(),
    API.getCriterios(),
    API.getRubrica(),
    API.getCalendario(),
    API.getPeriodos(),
  ]);
  _evaluaciones = evals;
  _criterios    = crits;
  _rubrica      = rub;
  _calendario   = cal;
  _periodos     = pes;
  _lastUpdated  = new Date();
}

function initUI() {
  renderPEBar();
  renderRubrica();
  renderCalendario();
  updateTimestamp();
}

/* ── PE BAR (dinámica) ── */
function renderPEBar() {
  const row = document.getElementById('pe-row'); if (!row) return;
  if (!_periodos.length) {
    row.innerHTML = '<span style="color:var(--muted);font-size:.8rem">Sin períodos configurados</span>';
    return;
  }
  // Seleccionar el primer periodo activo, o el primero disponible
  const defPE = _periodos.find(p => p.activo) || _periodos[0];
  _activePE = _activePE || defPE;

  row.innerHTML = _periodos.map(p =>
    `<button class="pb${p.id === _activePE.id ? ' active' : ''}" onclick="selectPE('${p.id}',this)" data-pe-id="${p.id}">${p.nombre}</button>`
  ).join('');

  setEl('hero-pe', _activePE.nombre);
  renderScores(_activePE.id);
}

function selectPE(periodoId, btn) {
  _activePE = _periodos.find(p => p.id == periodoId);
  document.querySelectorAll('.pe-row .pb').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  setEl('hero-pe', _activePE?.nombre || periodoId);
  renderScores(periodoId);
}

/* ── SCORES ── */
function renderScores(periodoId) {
  const container = document.getElementById('score-body'); if (!container) return;

  const evalRow = _evaluaciones.find(e => e.periodo_id == periodoId);

  if (!evalRow) {
    setEl('hero-score', '—');
    setEl('hero-nivel', '—');
    const hs = document.getElementById('hero-score'); if (hs) hs.style.color = 'var(--muted)';
    container.innerHTML = `
      <div class="no-data-msg">
        <div class="no-data-icon">${ICONS.score}</div>
        <div class="no-data-txt">Aún no hay evaluación publicada para este período.<br>Consulta más adelante.</div>
      </div>`;
    return;
  }

  const criterios  = getCriterios();
  const puntajes   = evalRow.puntajes   || {};
  const comentarios = evalRow.comentarios || {};
  const bono       = evalRow.bono_ext   || 0;
  const total      = calcScore(puntajes, bono);
  const MAX        = getMaxScore() + 2; // +2 máx bono

  // Hero
  const hs = document.getElementById('hero-score');
  if (hs) { hs.textContent = total; hs.style.color = scoreColor(total); }
  setEl('hero-nivel', scoreLabel(total));
  setEl('hero-max', MAX);

  // Score track
  const trackFill = document.getElementById('score-track-fill');
  const trackWrap = document.getElementById('score-track-wrap');
  if (trackFill && trackWrap) {
    const col = scoreColor(total);
    trackFill.style.color = col;
    setEl('score-track-max', MAX);
    trackWrap.style.display = '';
    requestAnimationFrame(() => { trackFill.style.width = Math.round((total / MAX) * 100) + '%'; });
  }

  const bars = criterios.map((c, i) => {
    const val    = puntajes[c.key] ?? 0;
    const critFb = comentarios[c.key] || '';
    return `
      <div class="cbar" style="animation-delay:${i * 40}ms">
        <div class="cbar-top">
          <div>
            <div class="cbar-tag" style="color:${c.color}">${c.abbr}</div>
            <div class="cbar-name">${c.label}</div>
          </div>
          <div class="cbar-val" style="color:${c.color}">${val}<span>/4</span></div>
        </div>
        <div class="cbar-track">
          <div class="cbar-fill" style="width:${(val / 4) * 100}%;background:${c.color}"></div>
        </div>
        ${critFb ? `<div class="cbar-feedback"><span class="cbar-fb-icon">${ICONS.msg}</span><span class="cbar-fb-txt">${escHtml(critFb)}</span></div>` : ''}
      </div>`;
  }).join('');

  const evaluadorNombre = evalRow.evaluador?.nombre || '';
  const periodoNombre   = evalRow.periodos_evaluacion?.nombre || _activePE?.nombre || '';
  const comentGen       = comentarios.general || '';

  container.innerHTML = `
    <div class="score-summary-card">
      <div class="sse-left">
        <div class="sse-label">Puntaje total — ${periodoNombre}</div>
        <div class="sse-name">${escHtml(CU.nombre || CU.email)}</div>
        ${CU.roles?.nombre ? `<div class="sse-role">${escHtml(CU.roles.nombre)}</div>` : ''}
        ${bono > 0 ? `<div style="margin-top:8px"><span class="bono-badge"><span class="bono-icon">${ICONS.star}</span>Bono de excelencia +${bono}</span></div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span class="nivel-badge ${scoreClass(total)}">${scoreLabel(total)}</span>
        <div style="text-align:right">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:${scoreColor(total)};line-height:1">${total}</div>
          <div style="font-size:.65rem;color:var(--muted)">/ ${MAX} pts</div>
        </div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">${bars}</div>
    ${comentGen ? `
    <div class="cbar" style="margin-top:4px">
      <div class="cbar-top"><div><div class="cbar-tag" style="color:var(--cyan)">GRAL</div><div class="cbar-name">Comentario general</div></div></div>
      <div class="cbar-feedback" style="margin-top:6px"><span class="cbar-fb-icon">${ICONS.msg}</span><span class="cbar-fb-txt">${escHtml(comentGen)}</span></div>
    </div>` : ''}
    ${evaluadorNombre ? `<p style="margin-top:12px;font-size:.72rem;color:var(--muted);text-align:right">Evaluado por: ${escHtml(evaluadorNombre)}</p>` : ''}`;
}

/* ── RÚBRICA ── */
function renderRubrica() {
  const el = document.getElementById('rubrica-grid'); if (!el) return;
  if (!_rubrica.length) {
    el.innerHTML = `<div class="empty-box"><div class="empty-icon">${ICONS.clipboard}</div><div class="empty-txt">Rúbrica no disponible.</div></div>`;
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
      <div class="rubrica-card" id="rc-${i}">
        <div class="rubrica-card-head" onclick="document.getElementById('rc-${i}').classList.toggle('open')">
          <div class="rubrica-dot" style="background:${color}"></div>
          <div class="rubrica-title" style="color:${color}">${r.criterio || c.label || r.criterios?.label || '—'}</div>
          <span class="rubrica-chev"></span>
        </div>
        <div class="rubrica-body">
          <div class="rubrica-levels">
            ${levels.map(l => `<div class="rlevel"><div class="rlevel-badge" style="color:${l.color}">${l.n}</div><div class="rlevel-lbl" style="color:${l.color}">${l.lbl}</div><div class="rlevel-desc">${r[lk[l.n]] || '—'}</div></div>`).join('')}
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ── CALENDARIO ── */
function renderCalendario() {
  const el = document.getElementById('cal-grid'); if (!el) return;
  if (!_calendario.length) {
    el.innerHTML = `<div class="empty-box" style="grid-column:1/-1"><div class="empty-icon">${ICONS.calendar}</div><div class="empty-txt">No hay eventos disponibles.</div></div>`;
    return;
  }
  const cAcc = { rojo:'cal-acc--rojo', verde:'cal-acc--verde', azul:'cal-acc--azul', amarillo:'cal-acc--amarillo' };
  const cT   = { rojo:'cal-t--rojo',   verde:'cal-t--verde',  azul:'cal-t--azul',   amarillo:'cal-t--amarillo' };
  const emap = { 'en curso':{cls:'sa',dot:true,txt:'En curso'}, 'próximo':{cls:'sp',dot:true,txt:'Próximo'}, 'proximo':{cls:'sp',dot:true,txt:'Próximo'}, 'pendiente':{cls:'spe',dot:false,txt:'Pendiente'}, 'completado':{cls:'spe',dot:false,txt:'Completado'} };
  el.innerHTML = _calendario.map(p => {
    const c  = (p.color || 'rojo').toLowerCase();
    const es = emap[(p.estado || 'pendiente').toLowerCase()] || emap.pendiente;
    const rows = [['Inicio',p.inicio],['Fin de trabajo',p.fin_trabajo],['Entrega scores',p.entrega],['Jornada',p.jornada]].filter(([,v]) => v);
    return `
      <div class="cal-card">
        <div class="cal-acc ${cAcc[c] || cAcc.rojo}"></div>
        <div class="cal-body">
          <div class="cal-num">PERÍODO ${String(p.numero).padStart(2,'0')}</div>
          <div class="cal-t ${cT[c] || cT.rojo}">${p.titulo}</div>
          ${rows.map(([l,v]) => `<div class="cal-r"><span class="cal-rl">${l}</span><span>${v}</span></div>`).join('')}
          <div class="cst ${es.cls}">${es.dot ? '<span class="sdot"></span>' : ''}${es.txt}</div>
        </div>
      </div>`;
  }).join('');
}

/* ── REFRESH ── */
async function handleRefresh() {
  const btn = document.getElementById('btn-refresh');
  if (btn) { btn.classList.add('refreshing'); btn.disabled = true; }
  showToast('Actualizando...', 'info');
  Auth.clearCache();
  await loadData();
  renderPEBar();
  renderRubrica();
  renderCalendario();
  updateTimestamp();
  if (btn) { btn.classList.remove('refreshing'); btn.disabled = false; }
  showToast('Datos actualizados', 'ok');
}

/* ── HELPERS ── */
const calcScore  = (puntajes, bono) => getCriterios().reduce((s, c) => s + (puntajes[c.key] || 0), 0) + (bono || 0);
const scoreColor = s => s >= 26 ? 'var(--sex)' : s >= 20 ? 'var(--sbu)' : s >= 11 ? 'var(--spr)' : 'var(--sba)';
const scoreLabel = s => s >= 26 ? 'Excelente' : s >= 20 ? 'Bueno' : s >= 11 ? 'En Proceso' : 'Bajo';
const scoreClass = s => s >= 24 ? 'sex' : s >= 18 ? 'sbu' : s >= 10 ? 'spr' : 'sba';
const initials   = n => (n || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
const setEl      = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
const pad        = n => String(n).padStart(2, '0');

/* ── TABS ── */
function switchTab(tab, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${tab}`)?.classList.add('active');
  document.querySelectorAll('#desktop-nav .tnav').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
}
function switchTabMobile(tab, btn) {
  switchTab(tab, null);
  document.querySelectorAll('.mobile-menu .mobile-nav-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  closeMenu();
  const tabs = ['scores', 'rubrica', 'cal'], idx = tabs.indexOf(tab);
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

/* ── TIMESTAMP ── */
function updateTimestamp() {
  if (!_lastUpdated) return;
  const t = _lastUpdated, txt = `✓ ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  ['ts-badge', 'ts-badge-mob'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    el.textContent = txt; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1000);
  });
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

/* ── TOAST ── */
function showToast(msg, type = '') {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.className = `toast${type ? ' toast--' + type : ''} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

/* ── SCROLL ── */
function initScrollEffects() {
  const topbar = document.getElementById('topbar'), backTop = document.getElementById('back-top');
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const y = window.scrollY;
        topbar?.classList.toggle('scrolled', y > 10);
        backTop?.classList.toggle('visible', y > 300);
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}
