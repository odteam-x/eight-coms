/* ═══════════════════════════════════════════════════════════
   EIGHT CREATORS LABs — app.js  (v3 — todo desde Sheets)
   ───────────────────────────────────────────────────────────

   ESTRUCTURA REQUERIDA EN GOOGLE SHEETS
   ════════════════════════════════════════════════════════════

   1. USUARIOS
      A=usuario | B=contraseña | C=nombre_completo | D=rol (miembro/admin)

   2. CRITERIOS  (opcional — si no existe usa los defaults)
      A=key | B=label | C=abreviatura | D=color_hex

   3. CREATORS SCORE - PE1  (también PE2, PE3)
      A=Nombre | B..H = puntuación por criterio (mismo orden que CRITERIOS)

   4. CREATORS FEEDBACK - PE1  (también PE2, PE3)
      A=Nombre | B..E = otras columnas (ignoradas) | F..L = comentario por criterio (mismo orden que CRITERIOS)

   5. TABLA DE PUNTUACIÓN
      A=(ignorar) | B=Criterio | C=Nivel 4 | D=Nivel 3 | E=Nivel 2 | F=Nivel 1

   6. CALENDARIO
      A=Número | B=Título | C=Color(rojo/verde/azul)
      D=Inicio | E=Fin trabajo | F=Entrega scores | G=Jornada | H=Estado

   ════════════════════════════════════════════════════════════ */

'use strict';

const SID              = '1FQiY64mpQdErTXz2pVASijs5LeCTNwH5gnikNVEmPB4';
const AUTO_REFRESH_MS  = 60_000;

let D = {
  users:      [],
  criterios:  [],
  scores:     { PE1:[], PE2:[], PE3:[] },
  feedback:   { PE1:[], PE2:[], PE3:[] },
  rubrica:    [],
  calendario: [],
  periodos:   ['PE1','PE2','PE3'],
};

let CU           = null;
let mPE          = 'PE1';
let aPE          = 'PE1';
let aMember      = null;
let _arTimer     = null;
let _isLoading   = false;
let _lastUpdated = null;

const CRITERIOS_DEFAULT = [
  { key:'pla', label:'Planificación',      abbr:'PLA', col:1, color:'#E05A6A' },
  { key:'dis', label:'Diseño Creativo',    abbr:'DIS', col:2, color:'#5B7FFF' },
  { key:'edi', label:'Edición Creativa',   abbr:'EDI', col:3, color:'#2ECC71' },
  { key:'nar', label:'Narrativa / Guión',  abbr:'NAR', col:4, color:'#F0C040' },
  { key:'flu', label:'Fluidez Oral',       abbr:'FLU', col:5, color:'#C084FC' },
  { key:'rev', label:'Revisión',           abbr:'REV', col:6, color:'#38BDF8' },
  { key:'eje', label:'Ejecución en Redes', abbr:'EJE', col:7, color:'#FB923C' },
];

const getCriterios = () => D.criterios.length ? D.criterios : CRITERIOS_DEFAULT;
const getMaxScore  = () => getCriterios().length * 4;

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', () => {
  const saved = sessionStorage.getItem('ec_cu');
  if (saved) {
    try {
      CU = JSON.parse(saved);
      loadAll().then(() => { enterPortal(); startAutoRefresh(); });
    } catch { sessionStorage.removeItem('ec_cu'); }
  }
});

/* ── FETCH SHEET ── */
async function fetchSheet(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}&_=${Date.now()}`;
  try {
    const r    = await fetch(url, { cache: 'no-store' });
    const text = await r.text();
    const m    = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/);
    if (!m) return [];
    return JSON.parse(m[1])?.table?.rows ?? [];
  } catch(e) {
    console.warn(`fetchSheet("${sheetName}") failed:`, e);
    return [];
  }
}

const rv   = (row, i) => row?.c?.[i]?.v ?? null;
const rstr = (row, i) => String(rv(row, i) ?? '').trim();
const rnum = (row, i) => { const v = rv(row, i); return v !== null ? (parseFloat(v) || 0) : 0; };

/* ── LOAD ALL ── */
async function loadAll() {
  if (_isLoading) return;
  _isLoading = true;
  try {
    /* USUARIOS */
    const urRows = await fetchSheet('USUARIOS');
    D.users = urRows
      .map(r => ({
        user: rstr(r,0), pass: rstr(r,1),
        name: rstr(r,2), rol: (rstr(r,3)||'miembro').toLowerCase(),
      }))
      .filter(u => u.user);

    /* CRITERIOS (hoja opcional) */
    const crRows = await fetchSheet('CRITERIOS');
    if (crRows.length) {
      D.criterios = crRows
        .filter(r => rstr(r,0))
        .map((r,i) => ({
          key:   rstr(r,0) || `c${i}`,
          label: rstr(r,1) || `Criterio ${i+1}`,
          abbr:  rstr(r,2) || rstr(r,0).toUpperCase().slice(0,3),
          col:   i + 1,
          color: rstr(r,3) || '#888888',
        }));
    } else {
      D.criterios = [];
    }

    const criterios = getCriterios();

    /* SCORES & FEEDBACK por período */
    const SCORE_COL_START = 5; // columna F (índice 5) → hasta M
    for (const pe of D.periodos) {
      const sRows = await fetchSheet(`CREATORS SCORE - ${pe}`);
      D.scores[pe] = sRows
        .map(r => {
          const nombre = rstr(r,0);
          if (!nombre) return null;
          const entry = { nombre };
          criterios.forEach((c, idx) => { entry[c.key] = rnum(r, SCORE_COL_START + idx); });
          return entry;
        })
        .filter(Boolean);

      const fRows = await fetchSheet(`CREATORS FEEDBACK - ${pe}`);
      // Columnas F..L = índices 5..11 → un comentario por criterio
      const FB_COL_START = 5;
      D.feedback[pe] = fRows
        .map(r => {
          const nombre = rstr(r, 0);
          if (!nombre) return null;
          const perCriterio = {};
          criterios.forEach((c, idx) => {
            const txt = rstr(r, FB_COL_START + idx);
            if (txt) perCriterio[c.key] = txt;
          });
          return { nombre, fb: '', perCriterio };
        })
        .filter(Boolean);
    }

    /* RÚBRICA */
    let rubRows = await fetchSheet('TABLA DE PUNTUACIÓN');
    if (!rubRows.length) rubRows = await fetchSheet('TABLA DE PUNTUACION');
    D.rubrica = rubRows
      .filter(r => rstr(r,1))
      .map(r => ({
        criterio: rstr(r,1),
        nivel4: rstr(r,2), nivel3: rstr(r,3),
        nivel2: rstr(r,4), nivel1: rstr(r,5),
      }));

    /* CALENDARIO */
    const calRows = await fetchSheet('CALENDARIO');
    D.calendario = calRows
      .filter(r => rstr(r,0))
      .map(r => ({
        numero:     rstr(r,0),
        titulo:     rstr(r,1),
        color:      rstr(r,2) || 'rojo',
        inicio:     rstr(r,3),
        finTrabajo: rstr(r,4),
        entrega:    rstr(r,5),
        jornada:    rstr(r,6),
        estado:     rstr(r,7) || 'Pendiente',
      }));

    _lastUpdated = new Date();
    console.log(`✅ loadAll OK — PE1: ${D.scores.PE1.length} miembros, criterios: ${criterios.length}`);
  } finally {
    _isLoading = false;
  }
}

/* ── AUTO-REFRESH ── */
function startAutoRefresh() {
  stopAutoRefresh();
  _arTimer = setInterval(silentRefresh, AUTO_REFRESH_MS);
}
function stopAutoRefresh() {
  if (_arTimer) { clearInterval(_arTimer); _arTimer = null; }
}
async function silentRefresh() {
  if (!CU || _isLoading) return;
  await loadAll();
  if (CU.rol === 'admin') { renderAdminPE(aPE); renderAdminMemberChips(); }
  else renderMScores(mPE);
  updateTimestamp();
}

/* ── MANUAL RELOAD ── */
async function reloadData() {
  if (_isLoading) return;
  const btns = document.querySelectorAll('.btn-refresh');
  btns.forEach(b => { b.classList.add('refreshing'); b.disabled = true; });
  showToast('↺ Recargando desde Google Sheets...');

  await loadAll();

  if (CU?.rol === 'admin') {
    renderAdminPE(aPE);
    renderAdminMemberChips();
    renderRubrica('rubrica-grid-a');
    renderDebugPanel();
  } else if (CU) {
    renderMScores(mPE);
    renderCalendario();
    renderRubrica('rubrica-grid');
  }
  updateTimestamp();
  startAutoRefresh();
  btns.forEach(b => { b.classList.remove('refreshing'); b.disabled = false; });
  showToast(`✅ Actualizado — ${D.scores.PE1.length} miembros en PE1`);
}

/* ── TIMESTAMP ── */
function updateTimestamp() {
  if (!_lastUpdated) return;
  const t   = _lastUpdated;
  const txt = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  document.querySelectorAll('.last-updated-badge').forEach(el => {
    el.textContent = `Actualizado ${txt}`;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1000);
  });
}
const pad = n => String(n).padStart(2,'0');

/* ── LOGIN / LOGOUT ── */
async function doLogin() {
  const user      = document.getElementById('li-user').value.trim();
  const pass      = document.getElementById('li-pass').value.trim();
  const errEl     = document.getElementById('li-err');
  const loadingEl = document.getElementById('li-loading');
  errEl.style.display = 'none';
  loadingEl.style.display = 'block';

  await loadAll();
  loadingEl.style.display = 'none';

  let found = D.users.find(u => u.user === user && u.pass === pass);
  if (!found && user === 'admin' && pass === 'admin2025')
    found = { user:'admin', pass:'', name:'Administrador', rol:'admin' };

  if (!found) { errEl.style.display = 'block'; return; }

  CU = found;
  sessionStorage.setItem('ec_cu', JSON.stringify(CU));
  enterPortal();
  startAutoRefresh();
}

function enterPortal() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  if (CU.rol === 'admin') {
    document.getElementById('screen-admin').classList.add('active');
    initAdmin();
  } else {
    document.getElementById('screen-member').classList.add('active');
    initMember();
  }
}

function logout() {
  stopAutoRefresh();
  sessionStorage.removeItem('ec_cu');
  CU = null;
  closeAllMenus();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-login').classList.add('active');
  document.getElementById('li-user').value = '';
  document.getElementById('li-pass').value = '';
}

/* ── HELPERS ── */
const calcScore  = row => getCriterios().reduce((s,c) => s + (row[c.key]||0), 0);
const scoreColor = s => s>=24?'#2ECC71':s>=18?'#5B7FFF':s>=10?'#F0C040':'#E05A6A';
const scoreLabel = s => s>=24?'Excelente':s>=18?'Bueno':s>=10?'En Proceso':'Bajo';
const scoreClass = s => s>=24?'sex':s>=18?'sbu':s>=10?'spr':'sba';
const dCls       = v => `d${Math.min(4,Math.max(1,v||1))}`;
const initials   = name => name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();

/* ── MOBILE MENU ── */
function toggleMenu(prefix) {
  const ham  = document.getElementById(`${prefix}-hamburger`);
  const menu = document.getElementById(`${prefix}-mobile-menu`);
  if (!ham || !menu) return;
  const open = !menu.classList.contains('open');
  ham.classList.toggle('open', open);
  menu.classList.toggle('open', open);
  ham.setAttribute('aria-expanded', open);
  document.body.style.overflow = open ? 'hidden' : '';
}
function closeMenu(prefix) {
  const ham  = document.getElementById(`${prefix}-hamburger`);
  const menu = document.getElementById(`${prefix}-mobile-menu`);
  if (!ham || !menu) return;
  ham.classList.remove('open'); menu.classList.remove('open');
  ham.setAttribute('aria-expanded','false');
  document.body.style.overflow = '';
}
function closeAllMenus() { ['m','a'].forEach(closeMenu); }

document.addEventListener('click', e => {
  ['m','a'].forEach(p => {
    const menu = document.getElementById(`${p}-mobile-menu`);
    const ham  = document.getElementById(`${p}-hamburger`);
    if (menu?.classList.contains('open') && !menu.contains(e.target) && !ham?.contains(e.target))
      closeMenu(p);
  });
});
window.addEventListener('resize', () => { if (window.innerWidth > 640) closeAllMenus(); });

/* ════════════════════════════════════════
   MEMBER
════════════════════════════════════════ */
function initMember() {
  const n = CU.name || CU.user;
  const ini = initials(n);
  ['m-av','m-av-mob'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=ini; });
  ['m-un','m-un-mob'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=n; });
  const nb = document.getElementById('m-nbig'); if(nb) nb.textContent = n;
  renderMScores('PE1');
  renderRubrica('rubrica-grid');
  renderCalendario();
  updateTimestamp();
}

function mTab(tab, btn) {
  _mSwitch(tab);
  document.querySelectorAll('#m-desktop-nav .tnav').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _syncMobileBtns('m', tab);
}
function mTabMobile(tab, btn) {
  _mSwitch(tab);
  document.querySelectorAll('#m-mobile-menu .mobile-nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _syncDesktopBtns('m-desktop-nav', tab);
  closeMenu('m');
}
function _mSwitch(tab) {
  document.querySelectorAll('#screen-member .tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${tab}`)?.classList.add('active');
}
function _syncMobileBtns(prefix, tab) {
  document.querySelectorAll(`#${prefix}-mobile-menu .mobile-nav-btn`).forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
}
function _syncDesktopBtns(navId, tab) {
  document.querySelectorAll(`#${navId} .tnav`).forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
}

function mSelPE(pe, btn) {
  mPE = pe;
  document.querySelectorAll('#tab-scores .pb').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const lbl = document.getElementById('m-pelbl'); if(lbl) lbl.textContent = pe;
  renderMScores(pe);
}

function renderMScores(pe) {
  const n         = CU.name || CU.user;
  const criterios = getCriterios();
  const MAX       = getMaxScore();

  const d  = D.scores[pe]?.find(r =>
    r.nombre === n ||
    r.nombre === CU.user ||
    r.nombre?.toLowerCase().trim() === n.toLowerCase().trim() ||
    r.nombre?.toLowerCase().trim() === CU.user?.toLowerCase().trim()
  );
  const sbig  = document.getElementById('m-sbig');
  const nivel = document.getElementById('m-nivel');
  const body  = document.getElementById('m-score-body');
  if (!body) return;

  if (!d) {
    if (sbig)  { sbig.textContent = '—'; sbig.style.color = ''; }
    if (nivel) nivel.textContent = 'Sin datos';
    body.innerHTML = `
      <div class="empty-box" style="grid-column:1/-1">
        <div class="empty-icon">📊</div>
        <div class="empty-txt">Sin datos para ${pe}</div>
        <div style="margin-top:8px;font-size:.65rem;color:#5A6080">
          El nombre en el Sheet debe coincidir exactamente con: <strong style="color:rgba(255,255,255,.5)">"${n}"</strong>
        </div>
      </div>`;
    return;
  }

  const total = calcScore(d);
  if (sbig)  { sbig.textContent = total; sbig.style.color = scoreColor(total); }
  if (nivel) nivel.textContent = scoreLabel(total);

  const fbData   = D.feedback[pe]?.find(r =>
    r.nombre === n || r.nombre === CU.user ||
    r.nombre?.toLowerCase().trim() === n.toLowerCase().trim()
  ) || { fb:'', perCriterio:{} };
  const fbGeneral = fbData.fb || '';
  const fbPerC    = fbData.perCriterio || {};

  body.innerHTML = `
    <div class="crit-bars">
      ${criterios.map(c => {
        const critFb = fbPerC[c.key] || '';
        return `
        <div class="cbar">
          <div class="cbar-top">
            <div>
              <div class="cbar-tag" style="color:${c.color}">${c.abbr}</div>
              <div class="cbar-name">${c.label}</div>
            </div>
            <div class="cbar-val" style="color:${c.color}">${d[c.key]??0}<span style="font-size:.85rem;color:var(--muted)">/4</span></div>
          </div>
          <div class="cbar-track">
            <div class="cbar-fill" style="width:${((d[c.key]??0)/4)*100}%;background:${c.color}"></div>
          </div>
          ${critFb ? `<div class="cbar-feedback" style="--c:${c.color}"><span class="cbar-fb-icon">💬</span><span class="cbar-fb-txt">${escHtml(critFb)}</span></div>` : ''}
        </div>`}).join('')}
    </div>
    ${fbGeneral ? `<div class="fb-card"><div class="fb-lbl">Retroalimentación General — ${pe}</div><div class="fb-txt">${escHtml(fbGeneral)}</div></div>` : ''}`;
}

/* ── CALENDARIO desde Sheets ── */
function renderCalendario() {
  const el = document.getElementById('cal-grid-dynamic');
  if (!el) return;

  if (!D.calendario.length) {
    el.innerHTML = `
      <div class="empty-box" style="grid-column:1/-1">
        <div class="empty-icon">📅</div>
        <div class="empty-txt">Sin datos de calendario</div>
        <div style="margin-top:8px;font-size:.65rem;color:#5A6080">
          Crea una hoja llamada <strong style="color:rgba(255,255,255,.4)">CALENDARIO</strong> con columnas:<br>
          A=Número | B=Título | C=Color | D=Inicio | E=Fin trabajo | F=Entrega | G=Jornada | H=Estado
        </div>
      </div>`;
    return;
  }

  const colorMap = {
    rojo:  { acc:'cal-acc--rojo',  t:'cal-t--rojo'  },
    verde: { acc:'cal-acc--verde', t:'cal-t--verde' },
    azul:  { acc:'cal-acc--azul',  t:'cal-t--azul'  },
  };
  const estadoMap = {
    'en curso':  { cls:'sa',  dot:true,  txt:'En curso'  },
    'próximo':   { cls:'sp',  dot:true,  txt:'Próximo'   },
    'proximo':   { cls:'sp',  dot:true,  txt:'Próximo'   },
    'pendiente': { cls:'spe', dot:false, txt:'Pendiente' },
    'completado':{ cls:'sp',  dot:false, txt:'Completado'},
  };

  el.innerHTML = D.calendario.map(p => {
    const c  = colorMap[(p.color||'rojo').toLowerCase()] || colorMap.rojo;
    const es = estadoMap[(p.estado||'pendiente').toLowerCase()] || estadoMap.pendiente;
    const rows = [
      ['Inicio', p.inicio], ['Fin trabajo', p.finTrabajo],
      ['Entrega scores', p.entrega], ['Jornada', p.jornada],
    ].filter(([,v]) => v);
    return `
      <div class="cal-card">
        <div class="cal-acc ${c.acc}"></div>
        <div class="cal-body">
          <div class="cal-num">PERÍODO ${String(p.numero).padStart(2,'0')}</div>
          <div class="cal-t ${c.t}">${p.titulo}</div>
          ${rows.map(([l,v]) => `<div class="cal-r"><span class="cal-rl">${l}</span><span>${v}</span></div>`).join('')}
          <div class="cst ${es.cls}">${es.dot?'<span class="sdot"></span>':''}${es.txt}</div>
        </div>
      </div>`;
  }).join('');
}

/* ── RÚBRICA ── */
function renderRubrica(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!D.rubrica.length) {
    el.innerHTML = '<div class="empty-box"><div class="empty-icon">📋</div><div class="empty-txt">Sin datos de rúbrica<br><small style="color:#5A6080">Verifica la hoja "TABLA DE PUNTUACIÓN"</small></div></div>';
    return;
  }
  const criterios = getCriterios();
  const levels = [
    {n:4,lbl:'Excelente',color:'#2ECC71'},
    {n:3,lbl:'Bueno',    color:'#5B7FFF'},
    {n:2,lbl:'En Proceso',color:'#F0C040'},
    {n:1,lbl:'Bajo',    color:'#E05A6A'},
  ];
  const lk = {4:'nivel4',3:'nivel3',2:'nivel2',1:'nivel1'};
  el.innerHTML = D.rubrica.map((r,i) => {
    const c = criterios[i] || {};
    const color = c.color || '#888';
    const levHtml = levels.map(l => `
      <div class="rlevel">
        <div class="rlevel-badge" style="color:${l.color}">${l.n}</div>
        <div class="rlevel-lbl" style="color:${l.color}">${l.lbl}</div>
        <div class="rlevel-desc">${r[lk[l.n]]||'—'}</div>
      </div>`).join('');
    return `
      <div class="rubrica-card" id="rc-${containerId}-${i}">
        <div class="rubrica-card-head" onclick="toggleRubrica('rc-${containerId}-${i}')">
          <div class="rubrica-dot" style="background:${color}"></div>
          <div class="rubrica-title" style="color:${color}">${r.criterio}</div>
          <span class="rubrica-chev">▾</span>
        </div>
        <div class="rubrica-body"><div class="rubrica-levels">${levHtml}</div></div>
      </div>`;
  }).join('');
}
function toggleRubrica(id) { document.getElementById(id)?.classList.toggle('open'); }

/* ════════════════════════════════════════
   ADMIN
════════════════════════════════════════ */
function initAdmin() {
  renderRubrica('rubrica-grid-a');
  renderAdminPE('PE1');
  renderAdminMemberChips();
  renderDebugPanel();
  updateTimestamp();
}

function aTab(tab, btn) {
  _aSwitch(tab);
  document.querySelectorAll('#a-desktop-nav .tnav').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _syncMobileBtns('a', tab);
}
function aTabMobile(tab, btn) {
  _aSwitch(tab);
  document.querySelectorAll('#a-mobile-menu .mobile-nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _syncDesktopBtns('a-desktop-nav', tab);
  closeMenu('a');
}
function _aSwitch(tab) {
  document.querySelectorAll('.atab-content').forEach(t => t.classList.remove('active'));
  document.getElementById(`atab-${tab}`)?.classList.add('active');
}
function aSelPE(pe, btn) {
  aPE = pe;
  document.querySelectorAll('.admin-pe-bar .pb').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAdminPE(pe);
}
function renderAdminPE(pe) {
  const rows = D.scores[pe] || [];
  renderOverview(pe, rows);
  renderRanking(pe, rows);
  renderCriterios(pe, rows);
  if (aMember) renderMemberDetail(aMember);
}

function renderOverview(pe, rows) {
  const MAX = getMaxScore();
  document.getElementById('ov-pe-lbl')?.textContent !== undefined && (document.getElementById('ov-pe-lbl').textContent = pe);
  const total = rows.length;
  const scores = rows.map(calcScore);
  const avg  = total ? (scores.reduce((a,b)=>a+b,0)/total).toFixed(1) : '—';
  const maxS = total ? Math.max(...scores) : '—';
  const topR = rows.find(r => calcScore(r) === Math.max(...scores));
  const exc = scores.filter(s=>s>=24).length;
  const bue = scores.filter(s=>s>=18&&s<24).length;
  const enP = scores.filter(s=>s>=10&&s<18).length;
  const baj = scores.filter(s=>s<10).length;

  const statsEl = document.getElementById('ov-stats');
  if (statsEl) statsEl.innerHTML = `
    <div class="scard"><div class="sc-lbl">Miembros evaluados</div><div class="sc-val">${total}</div><div class="sc-sub">${pe}</div></div>
    <div class="scard"><div class="sc-lbl">Promedio del equipo</div><div class="sc-val" style="color:${avg!=='—'?scoreColor(parseFloat(avg)):'inherit'}">${avg}</div><div class="sc-sub">/ ${MAX} pts</div></div>
    <div class="scard"><div class="sc-lbl">Puntaje máximo</div><div class="sc-val" style="color:#2ECC71">${maxS}</div><div class="sc-sub">${topR?escHtml(topR.nombre):'—'}</div></div>
    <div class="scard"><div class="sc-lbl">Nivel Excelente</div><div class="sc-val" style="color:#2ECC71">${exc}</div><div class="sc-sub">de ${total} miembros</div></div>`;

  const distData = [
    {lbl:'Excelente ≥24',n:exc,color:'#2ECC71',pct:total?exc/total:0},
    {lbl:'Bueno ≥18',    n:bue,color:'#5B7FFF',pct:total?bue/total:0},
    {lbl:'En Proceso ≥10',n:enP,color:'#F0C040',pct:total?enP/total:0},
    {lbl:'Bajo <10',     n:baj,color:'#E05A6A',pct:total?baj/total:0},
  ];
  const distEl = document.getElementById('ov-dist');
  if (distEl) distEl.innerHTML = `<div class="dist-bars">${distData.map(d=>`
    <div class="dist-bar-row">
      <div class="dist-bar-lbl" style="color:${d.color}">${d.lbl}</div>
      <div class="dist-bar-track"><div class="dist-bar-fill" style="width:${d.pct*100}%;background:${d.color}"></div></div>
      <div class="dist-bar-count" style="color:${d.color}">${d.n}</div>
    </div>`).join('')}</div>`;

  const critEl = document.getElementById('ov-crit-summary');
  if (critEl) critEl.innerHTML = `<div class="crit-summary-grid">${getCriterios().map(c=>{
    const a = total ? (rows.reduce((s,r)=>s+(r[c.key]||0),0)/total).toFixed(2) : 0;
    return `<div class="cs-row"><div class="cs-lbl" style="color:${c.color}">${c.label}</div><div class="cs-track"><div class="cs-fill" style="width:${(a/4)*100}%;background:${c.color}"></div></div><div class="cs-val" style="color:${c.color}">${a}</div></div>`;
  }).join('')}</div>`;
}

function renderRanking(pe, rows) {
  const rkLbl = document.getElementById('rk-pe-lbl'); if(rkLbl) rkLbl.textContent = pe;
  const criterios = getCriterios();
  const sorted = [...rows].sort((a,b)=>calcScore(b)-calcScore(a));
  // Columnas: nombre flexible, score fijo, cada criterio fijo pequeño
  const cols = `1fr 52px ${criterios.map(()=>'36px').join(' ')}`;
  const tbl  = document.getElementById('ranking-tbl'); if(!tbl) return;
  if (!sorted.length) { tbl.innerHTML='<div class="empty-box"><div class="empty-icon">🏆</div><div class="empty-txt">Sin datos para este período</div></div>'; return; }
  tbl.innerHTML = `
    <div class="tbl-h" style="grid-template-columns:${cols}">
      <div class="tbl-th">Miembro</div>
      <div class="tbl-th tbl-score-h">Pts</div>
      ${criterios.map(c=>`<div class="tbl-th tbl-crit" style="color:${c.color}">${c.abbr}</div>`).join('')}
    </div>
    ${sorted.map((r,i)=>{
      const s=calcScore(r), rc=i===0?'gold':i===1?'silver':i===2?'bronze':'';
      return `<div class="tbl-r" style="grid-template-columns:${cols};animation-delay:${i*25}ms">
        <div class="tbl-td tbl-name-cell">
          <span class="rank-num ${rc}">#${i+1}</span>
          <span>${escHtml(r.nombre)}</span>
        </div>
        <div class="tbl-td tbl-score-cell"><span class="sbadge ${scoreClass(s)}">${s}</span></div>
        ${criterios.map(c=>`<div class="tbl-td tbl-crit" style="justify-content:center;padding:8px 4px"><span class="cdot ${dCls(r[c.key])}">${r[c.key]||0}</span></div>`).join('')}
      </div>`;
    }).join('')}`;
}

function renderCriterios(pe, rows) {
  const crLbl = document.getElementById('cr-pe-lbl'); if(crLbl) crLbl.textContent = pe;
  const criterios = getCriterios(); const total = rows.length;
  const grid = document.getElementById('crit-detail-grid'); if(!grid) return;
  grid.innerHTML = criterios.map(c=>{
    const avg = total ? (rows.reduce((s,r)=>s+(r[c.key]||0),0)/total).toFixed(2) : '—';
    const sorted = [...rows].sort((a,b)=>(b[c.key]||0)-(a[c.key]||0));
    const minis = sorted.slice(0,8).map(r=>`
      <div class="crit-mini-row">
        <div class="crit-mini-name">${escHtml(r.nombre)}</div>
        <div class="crit-mini-track"><div class="crit-mini-fill" style="width:${((r[c.key]||0)/4)*100}%;background:${c.color}"></div></div>
        <div class="crit-mini-val">${r[c.key]||0}</div>
      </div>`).join('');
    return `<div class="crit-detail-card">
      <div class="crit-detail-head">
        <div class="crit-detail-dot" style="background:${c.color}"></div>
        <div class="crit-detail-name" style="color:${c.color}">${c.label}</div>
        <div class="crit-avg-big" style="color:${c.color}">${avg}<span style="font-size:.8rem;color:var(--muted)">/4</span></div>
      </div>
      <div class="crit-mini-bars">${minis||'<div class="empty-txt" style="padding:.5rem 0">Sin datos</div>'}</div>
    </div>`;
  }).join('');
}

function renderAdminMemberChips() {
  const names = [...new Set([...D.scores.PE1,...D.scores.PE2,...D.scores.PE3].map(r=>r.nombre))].sort();
  const chips = document.getElementById('member-chips'); if(!chips) return;
  chips.innerHTML = names.map(n=>`<button class="member-chip ${n===aMember?'active':''}" onclick="selectMember(${escHtml(JSON.stringify(n))})"> ${escHtml(n)}</button>`).join('');
  if (!aMember && names.length) selectMember(names[0]);
}

function selectMember(name) {
  aMember = name;
  document.querySelectorAll('.member-chip').forEach(c => c.classList.toggle('active', c.textContent.trim()===name));
  renderMemberDetail(name);
}

function renderMemberDetail(name) {
  const el = document.getElementById('member-detail'); if(!el) return;
  const criterios = getCriterios(); const MAX = getMaxScore();
  const ini = initials(name);
  const peCards = D.periodos.map(pe=>{
    const d=D.scores[pe]?.find(r=>r.nombre===name); const s=d?calcScore(d):null;
    return `<div class="mpc-card"><div class="mpc-pe">${pe}</div><div class="mpc-score" style="color:${s!==null?scoreColor(s):'var(--muted)'}">${s!==null?s:'—'}</div><div class="mpc-label">${s!==null?`${scoreLabel(s)} / ${MAX} pts`:'Sin datos'}</div></div>`;
  }).join('');
  const d=D.scores[aPE]?.find(r=>r.nombre===name);
  const fbData = D.feedback[aPE]?.find(r=>r.nombre===name) || { fb:'', perCriterio:{} };
  const fb = fbData.fb || '';
  const fbPerC = fbData.perCriterio || {};
  const total=d?calcScore(d):null;
  const critHtml = d ? `<div class="section-label" style="margin-top:0">Criterios — ${aPE}</div><div class="crit-bars">${criterios.map(c=>{
    const critFb = fbPerC[c.key] || '';
    return `
    <div class="cbar"><div class="cbar-top"><div><div class="cbar-tag" style="color:${c.color}">${c.abbr}</div><div class="cbar-name">${c.label}</div></div><div class="cbar-val" style="color:${c.color}">${d[c.key]??0}<span style="font-size:.85rem;color:var(--muted)">/4</span></div></div><div class="cbar-track"><div class="cbar-fill" style="width:${((d[c.key]??0)/4)*100}%;background:${c.color}"></div></div>${critFb ? `<div class="cbar-feedback" style="--c:${c.color}"><span class="cbar-fb-icon">💬</span><span class="cbar-fb-txt">${escHtml(critFb)}</span></div>` : ''}</div>`}).join('')}</div>` :
    `<div class="empty-box"><div class="empty-icon">📊</div><div class="empty-txt">Sin scores para ${aPE}</div></div>`;
  el.innerHTML = `
    <div class="member-detail-card">
      <div class="member-detail-head">
        <div style="display:flex;align-items:center;gap:14px">
          <div class="avatar" style="width:44px;height:44px;font-size:1rem">${ini}</div>
          <div><div class="member-detail-name">${escHtml(name)}</div><div style="font-family:'Barlow Condensed',sans-serif;font-size:.65rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted)">Miembro del equipo</div></div>
        </div>
        ${total!==null?`<div><div class="score-big" style="color:${scoreColor(total)}">${total}</div><div class="score-lbl">/ ${MAX} · ${scoreLabel(total)}</div></div>`:''}
      </div>
      <div class="member-detail-body">
        <div class="section-label" style="margin-top:0">Comparativa por período</div>
        <div class="member-pe-compare">${peCards}</div>
        ${critHtml}
        ${fb?`<div class="fb-card" style="margin-top:1rem"><div class="fb-lbl">Retroalimentación — ${aPE}</div><div class="fb-txt">${fb}</div></div>`:''}
      </div>
    </div>`;
}

/* ── DEBUG PANEL (admin) ── */
function renderDebugPanel() {
  const el = document.getElementById('debug-panel-content') || document.getElementById('atab-debug'); if(!el) return;
  const criterios = getCriterios();
  const isDefault = D.criterios.length === 0;
  const mk = (title, val, ok, color) => {
    const c = color || (ok?'#2ECC71':'#E05A6A');
    return `<div style="background:var(--s2);border:1px solid ${c}33;border-left:3px solid ${c};border-radius:8px;padding:12px 14px"><div style="font-family:'Barlow Condensed',sans-serif;font-size:.55rem;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:4px">${title}</div><div style="font-family:'Bebas Neue',sans-serif;font-size:1.1rem;color:${c}">${val}</div></div>`;
  };
  el.innerHTML = `
    <div class="ptitle" style="color:#F0C040">🔍 DIAGNÓSTICO</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:1.5rem">
      ${mk('USUARIOS', `${D.users.length} usuarios`, D.users.length>0)}
      ${mk('CRITERIOS', isDefault?`Default (${criterios.length})`:`Hoja (${criterios.length})`, true, isDefault?'#F0C040':'#2ECC71')}
      ${mk('SCORES PE1', `${D.scores.PE1.length} miembros`, D.scores.PE1.length>0)}
      ${mk('SCORES PE2', `${D.scores.PE2.length} miembros`, true)}
      ${mk('SCORES PE3', `${D.scores.PE3.length} miembros`, true)}
      ${mk('RÚBRICA', `${D.rubrica.length} criterios`, D.rubrica.length>0)}
      ${mk('CALENDARIO', `${D.calendario.length} períodos`, D.calendario.length>0)}
    </div>
    <div class="section-label">Criterios activos</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:1.5rem">
      ${criterios.map(c=>`<span style="background:rgba(0,0,0,.3);border:1px solid ${c.color};color:${c.color};padding:3px 10px;border-radius:4px;font-family:'Barlow Condensed',sans-serif;font-size:.68rem;letter-spacing:1px">${c.abbr} — ${c.label}</span>`).join('')}
    </div>
    ${D.scores.PE1.length ? `
    <div class="section-label">Muestra CREATORS SCORE - PE1 (primeros 5)</div>
    <div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-family:'Barlow Condensed',sans-serif;font-size:.72rem">
      <thead><tr><th style="padding:6px 12px;background:#1E2230;color:#5B7FFF;text-align:left">Nombre</th>${criterios.map(c=>`<th style="padding:6px 10px;background:#1E2230;color:${c.color};text-align:center">${c.abbr}</th>`).join('')}<th style="padding:6px 10px;background:#1E2230;color:#2ECC71;text-align:center">TOTAL</th></tr></thead>
      <tbody>${D.scores.PE1.slice(0,5).map(r=>`<tr><td style="padding:5px 12px;border-bottom:1px solid #1E2230;color:rgba(255,255,255,.8)">${escHtml(r.nombre)}</td>${criterios.map(c=>`<td style="padding:5px 10px;border-bottom:1px solid #1E2230;text-align:center;color:${c.color}">${r[c.key]??0}</td>`).join('')}<td style="padding:5px 10px;border-bottom:1px solid #1E2230;text-align:center;font-weight:700;color:#2ECC71">${calcScore(r)}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}
    <div style="margin-top:1.5rem;padding:12px;background:#0A0D12;border-radius:6px;font-size:.7rem;color:#5A6080;font-family:monospace;line-height:1.8">
      Sheet ID: ${SID}<br>
      Última carga: ${_lastUpdated ? _lastUpdated.toLocaleString('es-ES') : 'Nunca'}<br>
      Auto-refresh: cada ${AUTO_REFRESH_MS/1000}s<br>
      Criterios: ${isDefault?'⚠️ Usando defaults — crea hoja "CRITERIOS"':'✅ Desde hoja CRITERIOS'}<br>
      Calendario: ${D.calendario.length>0?'✅ Desde hoja CALENDARIO':'⚠️ Crea hoja "CALENDARIO"'}
    </div>`;
}

/* ── TOAST ── */
function showToast(msg) {
  const t = document.getElementById('toast'); if(!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

/* ── SCROLL EFFECTS ── */
(function() {
  const backTop = document.getElementById('back-top');
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const y = window.scrollY || document.documentElement.scrollTop;
        backTop?.classList.toggle('visible', y > 300);
        ['m-topbar','a-topbar'].forEach(id => document.getElementById(id)?.classList.toggle('scrolled', y > 10));
        ticking = false;
      });
      ticking = true;
    }
  }, { passive:true });
})();