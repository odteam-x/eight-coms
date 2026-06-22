/**
 * EIGHT CREATORS LABs — Lógica Vista de Miembro
 */
'use strict';

let CU = null, D = null, mPE = 'PE1', _arTimer = null, _lastUpdated = null, _menuOpen = false, _peInited = false, _rptUserLoaded = false;

const CRITERIOS_DEFAULT = [
  { key:'pla', label:'Planificación',       abbr:'PLA', color:'#E05A6A' },
  { key:'rev', label:'Revisión',            abbr:'REV', color:'#38BDF8' },
  { key:'edi', label:'Edición Creativa',    abbr:'EDI', color:'#2ECC71' },
  { key:'dis', label:'Diseño Creativo',     abbr:'DIS', color:'#5B7FFF' },
  { key:'flu', label:'Fluidez Oral',        abbr:'FLU', color:'#C084FC' },
  { key:'nar', label:'Narrativa / Guión',   abbr:'NAR', color:'#F0C040' },
  { key:'eje', label:'Ejecución en Redes',  abbr:'EJE', color:'#FB923C' },
];

const getCriterios = () => D?.criterios?.length ? D.criterios : CRITERIOS_DEFAULT;
const getMaxScore  = () => getCriterios().length * 4; // 28 pts base
const MAX_TOTAL    = () => getMaxScore() + 2;         // 30 pts con bono

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', async () => {
  CU = Auth.requireRole('miembro');
  if (!CU) return;

  const cached = Auth.getCachedData();
  if (cached) { D = cached; initUI(); }

  await loadData();
  initUI();
});

async function loadData() {
  try {
    const data = await API.getData();
    if (data.ok !== false) {
      D = data;
      Auth.setCachedData(data);
      _lastUpdated = new Date();
      if (!_peInited && data.config?.periodoActivo) {
        mPE = data.config.periodoActivo;
        _peInited = true;
        document.querySelectorAll('.pe-row .pb').forEach((b,i) => {
          b.classList.toggle('active', ['PE1','PE2','PE3'][i] === mPE);
        });
        setEl('hero-pe', mPE);
      }
    }
  } catch (e) { console.error('[User]', e); }
}

function initUI() {
  if (!CU || !D) return;
  const name = CU.name || CU.user;
  const ini  = initials(name);
  setEl('av-desktop', ini); setEl('av-mobile', ini);
  setEl('uname-desktop', name); setEl('uname-mobile', name);
  setEl('hero-name', name);
  renderScores(mPE);
  renderPEDates(mPE);
  renderRubrica();
  renderCalendario();
  updateTimestamp();
  initScrollEffects();
}

/* ── PE DATES ── */
function renderPEDates(pe) {
  const p = D?.periodos?.find(x => x.pe === pe);
  let el = document.getElementById('pe-dates-info');
  if (!el) {
    const peRow = document.querySelector('#tab-scores .pe-row');
    if (!peRow) return;
    el = document.createElement('div');
    el.id = 'pe-dates-info';
    el.className = 'pe-dates-info';
    peRow.insertAdjacentElement('afterend', el);
  }
  if (!p) { el.innerHTML = ''; return; }
  const items = [['Inicio',p.inicio],['Fin trabajo',p.finTrabajo],['Entrega',p.entrega],['Jornada',p.jornada]].filter(([,v])=>v);
  const estadoCls = (p.estado||'').toLowerCase().replace(/\s+/g,'-');
  el.innerHTML = `<span class="pe-dates-nombre">${p.nombre||p.pe}</span>` +
    items.map(([l,v])=>`<span class="pe-dates-item"><span class="pe-dates-lbl">${l}:</span> ${v}</span>`).join('') +
    (p.estado?`<span class="pe-dates-estado pe-estado--${estadoCls}">${p.estado}</span>`:'');
}

/* ── SCORES ── */
function selectPE(pe, btn) {
  mPE = pe;
  document.querySelectorAll('.pe-row .pb').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  setEl('hero-pe', pe);
  renderPEDates(pe);
  renderScores(pe);
}

function renderScores(pe) {
  const container = document.getElementById('score-body'); if (!container) return;
  if (!D) { container.innerHTML = '<div class="loading-box"><span class="spin"></span></div>'; return; }

  const criterios = getCriterios();
  const MAX       = getMaxScore();
  const scores    = D.scores?.[pe] || [];
  const fbs       = D.feedback?.[pe] || [];
  const myScore   = scores.find(r => r.usuario === CU.user);
  const myFb      = fbs.find(r => r.usuario === CU.user);

  /* Hero */
  if (myScore) {
    const total = calcScore(myScore);
    const el = document.getElementById('hero-score');
    if (el) { el.textContent = total; el.style.color = scoreColor(total); }
    setEl('hero-nivel', scoreLabel(total));
  } else {
    setEl('hero-score', '—');
    setEl('hero-nivel', '—');
    const el = document.getElementById('hero-score'); if (el) el.style.color = 'var(--muted)';
  }
  setEl('hero-max', MAX_TOTAL());

  if (!myScore) {
    container.innerHTML = `
      <div class="no-data-msg">
        <div class="no-data-icon">${ICONS.score}</div>
        <div class="no-data-txt">Aún no hay evaluación para <strong>${pe}</strong>.<br>Consulta más adelante.</div>
      </div>`;
    return;
  }

  const total = calcScore(myScore);
  const base  = total - (myScore.ext||0);
  const ext   = myScore.ext || 0;
  const bars  = criterios.map((c, i) => {
    const val    = myScore[c.key] ?? 0;
    const critFb = myFb?.[c.key] || '';
    return `
      <div class="cbar" style="animation-delay:${i*40}ms">
        <div class="cbar-top">
          <div>
            <div class="cbar-tag" style="color:${c.color}">${c.abbr}</div>
            <div class="cbar-name">${c.label}</div>
          </div>
          <div class="cbar-val" style="color:${c.color}">${val}<span>/4</span></div>
        </div>
        <div class="cbar-track">
          <div class="cbar-fill" style="width:${(val/4)*100}%;background:${c.color}"></div>
        </div>
        ${critFb ? `<div class="cbar-feedback"><span class="cbar-fb-icon">${ICONS.msg}</span><span class="cbar-fb-txt">${critFb}</span></div>` : ''}
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="score-summary-card">
      <div class="sse-left">
        <div class="sse-label">Puntaje total — ${pe}</div>
        <div class="sse-name">${CU.name || CU.user}</div>
        ${myScore.area ? `<div class="sse-role">Área: ${myScore.area}</div>` : ''}
        ${ext > 0 ? `<div style="margin-top:8px"><span class="bono-badge"><span class="bono-icon">${ICONS.star}</span>Bono de excelencia +${ext}</span></div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span class="nivel-badge ${scoreClass(total)}">${scoreLabel(total)}</span>
        <div style="text-align:right">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:${scoreColor(total)};line-height:1">${total}</div>
          <div style="font-size:.65rem;color:var(--muted)">/ ${MAX_TOTAL()} pts</div>
        </div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">${bars}</div>`;
}

/* ── RÚBRICA ── */
function renderRubrica() {
  const el = document.getElementById('rubrica-grid'); if (!el) return;
  const rubrica   = D?.rubrica || [];
  const criterios = getCriterios();
  if (!rubrica.length) { el.innerHTML = `<div class="empty-box"><div class="empty-icon">${ICONS.clipboard}</div><div class="empty-txt">Rúbrica no disponible.</div></div>`; return; }
  const levels = [{n:4,lbl:'Excelente',color:'var(--green)'},{n:3,lbl:'Bueno',color:'var(--blue)'},{n:2,lbl:'En Proceso',color:'var(--gold)'},{n:1,lbl:'Bajo',color:'var(--red)'}];
  const lk = {4:'nivel4',3:'nivel3',2:'nivel2',1:'nivel1'};
  el.innerHTML = rubrica.map((r,i) => {
    const c = criterios[i] || {}, color = c.color || '#888';
    return `
      <div class="rubrica-card" id="rc-${i}">
        <div class="rubrica-card-head" onclick="document.getElementById('rc-${i}').classList.toggle('open')">
          <div class="rubrica-dot" style="background:${color}"></div>
          <div class="rubrica-title" style="color:${color}">${r.criterio}</div>
          <span class="rubrica-chev">▾</span>
        </div>
        <div class="rubrica-body">
          <div class="rubrica-levels">
            ${levels.map(l=>`<div class="rlevel"><div class="rlevel-badge" style="color:${l.color}">${l.n}</div><div class="rlevel-lbl" style="color:${l.color}">${l.lbl}</div><div class="rlevel-desc">${r[lk[l.n]]||'—'}</div></div>`).join('')}
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ── CALENDARIO ── */
function renderCalendario() {
  const el = document.getElementById('cal-grid'); if (!el) return;
  const cal = D?.calendario || [];
  if (!cal.length) { el.innerHTML = `<div class="empty-box" style="grid-column:1/-1"><div class="empty-icon">${ICONS.calendar}</div><div class="empty-txt">No hay eventos disponibles.</div></div>`; return; }
  const cAcc = {rojo:'cal-acc--rojo',verde:'cal-acc--verde',azul:'cal-acc--azul',amarillo:'cal-acc--amarillo'};
  const cT   = {rojo:'cal-t--rojo',verde:'cal-t--verde',azul:'cal-t--azul',amarillo:'cal-t--amarillo'};
  const emap = {'en curso':{cls:'sa',dot:true,txt:'En curso'},'próximo':{cls:'sp',dot:true,txt:'Próximo'},'proximo':{cls:'sp',dot:true,txt:'Próximo'},'pendiente':{cls:'spe',dot:false,txt:'Pendiente'},'completado':{cls:'spe',dot:false,txt:'Completado'}};
  el.innerHTML = cal.map(p => {
    const c  = (p.color||'rojo').toLowerCase();
    const es = emap[(p.estado||'pendiente').toLowerCase()] || emap.pendiente;
    const rows = [['Inicio',p.inicio],['Fin de trabajo',p.finTrabajo],['Entrega scores',p.entrega],['Jornada',p.jornada]].filter(([,v])=>v);
    return `
      <div class="cal-card">
        <div class="cal-acc ${cAcc[c]||cAcc.rojo}"></div>
        <div class="cal-body">
          <div class="cal-num">PERÍODO ${String(p.numero).padStart(2,'0')}</div>
          <div class="cal-t ${cT[c]||cT.rojo}">${p.titulo}</div>
          ${rows.map(([l,v])=>`<div class="cal-r"><span class="cal-rl">${l}</span><span>${v}</span></div>`).join('')}
          <div class="cst ${es.cls}">${es.dot?'<span class="sdot"></span>':''}${es.txt}</div>
        </div>
      </div>`;
  }).join('');
}

/* ── REFRESH ── */
async function handleRefresh() {
  const btn = document.getElementById('btn-refresh');
  if (btn) { btn.classList.add('refreshing'); btn.disabled = true; }
  showToast('Actualizando...', 'info');
  await loadData();
  renderScores(mPE); renderRubrica(); renderCalendario(); updateTimestamp();
  if (btn) { btn.classList.remove('refreshing'); btn.disabled = false; }
  showToast('Datos actualizados ✓', 'ok');
}

/* ── HELPERS ── */
const calcScore  = row => getCriterios().reduce((s,c)=>s+(row[c.key]||0),0) + (row.ext||0);
const scoreColor = s => s>=26?'var(--sex)':s>=20?'var(--sbu)':s>=11?'var(--spr)':'var(--sba)';
const scoreLabel = s => s>=26?'Excelente':s>=20?'Bueno':s>=11?'En Proceso':'Bajo';
const scoreClass = s => s>=24?'sex':s>=18?'sbu':s>=10?'spr':'sba';
const initials   = n => n.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
const setEl      = (id,txt) => { const el=document.getElementById(id); if(el) el.textContent=txt; };
const pad        = n => String(n).padStart(2,'0');

/* ── TABS ── */
function switchTab(tab, btn) {
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  document.getElementById(`tab-${tab}`)?.classList.add('active');
  document.querySelectorAll('#desktop-nav .tnav').forEach(b=>b.classList.remove('active'));
  btn?.classList.add('active');
  if (tab === 'reportes' && !_rptUserLoaded) renderUserReport();
}
function switchTabMobile(tab, btn) {
  switchTab(tab, null);
  document.querySelectorAll('.mobile-menu .mobile-nav-btn').forEach(b=>b.classList.remove('active'));
  btn?.classList.add('active');
  closeMenu();
  const tabs=['scores','rubrica','cal','reportes'], idx=tabs.indexOf(tab);
  document.querySelectorAll('#desktop-nav .tnav').forEach((b,i)=>b.classList.toggle('active',i===idx));
}

/* ── TAB: REPORTES (usuario) ── */
function renderUserReport() {
  _rptUserLoaded = true;
  const el = document.getElementById('rpt-user-body'); if (!el) return;
  if (!D) { el.innerHTML = '<div class="loading-box"><span class="spin"></span></div>'; return; }

  const criterios = getCriterios();
  const pes       = ['PE1','PE2','PE3'];
  const data      = pes.map(pe => {
    const row = D.scores?.[pe]?.find(r => r.usuario === CU.user);
    return row ? { pe, row, total: calcScore(row) } : null;
  }).filter(Boolean);

  if (!data.length) {
    el.innerHTML = `<div class="empty-box"><div class="empty-txt">No tienes evaluaciones disponibles aún.</div></div>`;
    return;
  }

  const avg   = data.reduce((s,d)=>s+d.total,0) / data.length;
  const best  = data.reduce((b,d)=>d.total>b.total?d:b);
  const trend = data.length >= 2 ? data[data.length-1].total - data[0].total : 0;
  const trendTxt = trend > 0 ? `+${trend} vs PE1` : trend < 0 ? `${trend} vs PE1` : 'Sin cambio';
  const trendColor = trend > 0 ? 'var(--sex)' : trend < 0 ? 'var(--sba)' : 'var(--muted)';
  const MAX   = MAX_TOTAL();

  const critAvg = criterios.map(c => {
    const vals = data.map(d => d.row[c.key] || 0);
    return { ...c, avg: vals.reduce((s,v)=>s+v,0) / vals.length };
  }).sort((a,b) => b.avg - a.avg);

  el.innerHTML = `
    <div class="urpt-header">
      <div class="urpt-name">${CU.name || CU.user}</div>
      <div class="urpt-meta">Períodos evaluados: ${data.map(d=>d.pe).join(' · ')}</div>
    </div>

    <div class="urpt-kpi-row">
      <div class="urpt-kpi">
        <div class="urpt-kpi-val" style="color:${scoreColor(best.total)}">${best.total}</div>
        <div class="urpt-kpi-lbl">Mejor puntaje<br><span style="font-size:.7rem;color:var(--muted)">${best.pe}</span></div>
      </div>
      <div class="urpt-kpi">
        <div class="urpt-kpi-val" style="color:var(--accent2)">${avg.toFixed(1)}</div>
        <div class="urpt-kpi-lbl">Promedio<br><span style="font-size:.7rem;color:var(--muted)">/ ${MAX} pts</span></div>
      </div>
      <div class="urpt-kpi">
        <div class="urpt-kpi-val" style="color:${trendColor}">${trendTxt}</div>
        <div class="urpt-kpi-lbl">Tendencia</div>
      </div>
      <div class="urpt-kpi">
        <div class="urpt-kpi-val"><span class="nivel-badge ${scoreClass(best.total)}">${scoreLabel(best.total)}</span></div>
        <div class="urpt-kpi-lbl">Mejor nivel</div>
      </div>
    </div>

    <div class="urpt-section-lbl">Historial por período</div>
    <div class="urpt-history">
      ${data.map(d => {
        const pct = Math.round((d.total / MAX) * 100);
        return `
          <div class="urpt-hist-card">
            <div class="urpt-hist-pe">${d.pe}</div>
            <div class="urpt-hist-bar-track">
              <div class="urpt-hist-bar-fill" style="width:${pct}%;background:${scoreColor(d.total)}"></div>
            </div>
            <div class="urpt-hist-score" style="color:${scoreColor(d.total)}">${d.total}<span style="font-size:.65rem;color:var(--muted);font-weight:400">/${MAX}</span></div>
            <span class="nivel-badge ${scoreClass(d.total)}" style="font-size:.55rem">${scoreLabel(d.total)}</span>
          </div>`;
      }).join('')}
    </div>

    <div class="urpt-bottom">
      <div class="urpt-section urpt-section-crit">
        <div class="urpt-section-lbl">Promedio por criterio</div>
        ${critAvg.map((c, i) => {
          const pct = (c.avg / 4) * 100;
          const tag = i === 0 ? '↑ Mejor' : i === critAvg.length - 1 ? '↓ A mejorar' : '';
          return `<div class="urpt-crit-row">
            <div class="urpt-crit-lbl" title="${c.label}" style="color:${c.color}">${c.abbr}</div>
            <div class="urpt-crit-bar-track">
              <div class="urpt-crit-bar-fill" style="width:${pct}%;background:${c.color}"></div>
            </div>
            <div class="urpt-crit-val">${c.avg.toFixed(1)}</div>
            ${tag ? `<div class="urpt-crit-tag" style="color:${i===0?'var(--sex)':'var(--sba)'}">${tag}</div>` : '<div></div>'}
          </div>`;
        }).join('')}
      </div>

      <div class="urpt-section urpt-section-table">
        <div class="urpt-section-lbl">Detalle por período</div>
        <div class="urpt-table-wrap">
          <table class="urpt-table">
            <thead>
              <tr>
                <th class="urpt-th">PE</th>
                ${criterios.map(c=>`<th class="urpt-th" title="${c.label}" style="color:${c.color}">${c.abbr}</th>`).join('')}
                <th class="urpt-th">Bono</th>
                <th class="urpt-th">Total</th>
                <th class="urpt-th">Nivel</th>
              </tr>
            </thead>
            <tbody>
              ${data.map(d=>`
                <tr>
                  <td class="urpt-td urpt-td-pe">${d.pe}</td>
                  ${criterios.map(c=>`<td class="urpt-td urpt-td-s">${d.row[c.key]||0}</td>`).join('')}
                  <td class="urpt-td urpt-td-s">${d.row.ext||0}</td>
                  <td class="urpt-td urpt-td-total" style="color:${scoreColor(d.total)}">${d.total}</td>
                  <td class="urpt-td"><span class="nivel-badge ${scoreClass(d.total)}" style="font-size:.55rem">${scoreLabel(d.total)}</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

/* ── MENÚ ── */
function toggleMenu() {
  _menuOpen = !_menuOpen;
  document.getElementById('hamburger')?.classList.toggle('open',_menuOpen);
  document.getElementById('mobile-menu')?.classList.toggle('open',_menuOpen);
  document.getElementById('hamburger')?.setAttribute('aria-expanded',_menuOpen);
  document.body.style.overflow = _menuOpen?'hidden':'';
}
function closeMenu() {
  _menuOpen = false;
  document.getElementById('hamburger')?.classList.remove('open');
  document.getElementById('mobile-menu')?.classList.remove('open');
  document.getElementById('hamburger')?.setAttribute('aria-expanded','false');
  document.body.style.overflow = '';
}
document.addEventListener('click', e => {
  const menu=document.getElementById('mobile-menu'), ham=document.getElementById('hamburger');
  if (menu?.classList.contains('open') && !menu.contains(e.target) && !ham?.contains(e.target)) closeMenu();
});
window.addEventListener('resize', ()=>{ if(window.innerWidth>720) closeMenu(); });

/* ── TIMESTAMP ── */
function updateTimestamp() {
  if (!_lastUpdated) return;
  const t=_lastUpdated, txt=`✓ ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  ['ts-badge','ts-badge-mob'].forEach(id => {
    const el=document.getElementById(id); if(!el) return;
    el.textContent=txt; el.classList.add('flash'); setTimeout(()=>el.classList.remove('flash'),1000);
  });
}

/* ── TOAST ── */
function showToast(msg, type='') {
  const t=document.getElementById('toast'); if(!t) return;
  t.textContent=msg; t.className=`toast${type?' toast--'+type:''} show`;
  setTimeout(()=>t.classList.remove('show'),3000);
}

/* ── LOGOUT ── */
function logout() { if(_arTimer) clearInterval(_arTimer); Auth.logout(); window.location.replace('index.html'); }

/* ── SCROLL ── */
function initScrollEffects() {
  const topbar=document.getElementById('topbar'), backTop=document.getElementById('back-top');
  let ticking=false;
  window.addEventListener('scroll',()=>{ if(!ticking){ requestAnimationFrame(()=>{ const y=window.scrollY; topbar?.classList.toggle('scrolled',y>10); backTop?.classList.toggle('visible',y>300); ticking=false; }); ticking=true; }},{passive:true});
}
