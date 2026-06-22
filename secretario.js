/**
 * EIGHT CREATORS LABs — Portal (Secretario + Miembro)
 * Secretario ve: Mi Score, Ranking, Mi Distrito, Criterios, Rúbrica, Calendario
 * Miembro   ve: Mi Score,           Mi Distrito, Criterios, Rúbrica, Calendario
 */
'use strict';

let CU = null, D = null;
let mPE='PE1', rPE='PE1', dPE='PE1';
let _arTimer=null, _lastUpdated=null, _menuOpen=false, _peInited=false;

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
const getMaxScore  = () => getCriterios().length * 4;
const MAX_TOTAL    = () => getMaxScore() + 2;
const isSecretario = () => CU?.rol === 'secretario';

const DIST_CRITERIOS = [
  { key:'cgo', label:'Competencia en Gestión y Organización', abbr:'CGO', color:'#0087F2', max:7 },
  { key:'cct', label:'Competencia Creativa y Técnica',        abbr:'CCT', color:'#2ECC71', max:7 },
  { key:'com', label:'Competencia Comunicativa',              abbr:'COM', color:'#C084FC', max:7 },
  { key:'cee', label:'Competencia de Ejecución Estratégica',  abbr:'CEE', color:'#FB923C', max:7 },
];
const MAX_DIST_SEC   = 28;
const calcDistScore  = p => DIST_CRITERIOS.reduce((s,c) => s+(Number(p?.[c.key])||0), 0);
const distScoreColor = s => s>=24?'var(--sex)':s>=17?'var(--sbu)':s>=10?'var(--spr)':'var(--sba)';
const distScoreLabel = s => s>=24?'Excelente':s>=17?'Bueno':s>=10?'En Proceso':'Bajo';
const distScoreClass = s => s>=24?'sex':s>=17?'sbu':s>=10?'spr':'sba';

function getMyDistrito() {
  if (!CU) return '';
  return (CU.distrito || '').trim();
}

function getDistritoRows(pe) {
  const myD = getMyDistrito();
  const all  = D?.scores?.[pe] || [];
  if (!myD) return all;
  return all.filter(r => String(r.distrito||'').trim().toLowerCase() === myD.toLowerCase());
}

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', async () => {
  CU = Auth.requireAnyRole(['secretario','miembro']);
  if (!CU) return;

  const cached = Auth.getCachedData();
  if (cached) { D = cached; initUI(); }
  await loadData();
  initUI();
});

async function loadData() {
  try {
    const data = await API.getSecretarioData(CU.user);
    if (data.ok !== false) {
      D = data;
      if (data.myDistrito) {
        CU.distrito = data.myDistrito;
        Auth.setSession(CU);
      }
      if (!_peInited && data.config?.periodoActivo) {
        mPE = rPE = dPE = data.config.periodoActivo;
        _peInited = true;
      }
      // Cargar rúbrica de distritos solo para secretario
      if (isSecretario() && !D.rubricaDistritos) {
        try {
          const rd = await API.getRubricaDistritos();
          if (rd.ok !== false) D.rubricaDistritos = rd.rubrica || rd;
        } catch(e) { console.warn('[Portal] No se pudo cargar rúbrica distritos'); }
      }
      Auth.setCachedData(data);
      _lastUpdated = new Date();
    }
  } catch(e) { console.error('[Portal]', e); }
}

function initUI() {
  if (!CU || !D) return;

  // Mostrar/ocultar elementos exclusivos del secretario
  const sec = isSecretario();
  document.querySelectorAll('.sec-only').forEach(el => { el.style.display = sec ? '' : 'none'; });
  document.querySelectorAll('.mem-only').forEach(el => { el.style.display = sec ? 'none' : ''; });
  document.getElementById('dist-calificacion')?.style && (document.getElementById('dist-calificacion').style.display = sec ? 'block' : 'none');

  // Badge de rol
  const badge = document.getElementById('role-badge');
  if (badge) { badge.textContent = sec ? 'SECRETARIO' : 'CREATOR'; badge.className = sec ? 'secretario-badge' : 'portal-badge'; }
  const rolMob = document.getElementById('role-label-mob');
  if (rolMob) rolMob.textContent = sec ? 'Secretario de Comunicaciones' : 'Creator';

  // Datos de usuario en UI
  const name = CU.name || CU.user, ini = initials(name);
  setEl('av-desktop',ini); setEl('av-mobile',ini);
  setEl('uname-desktop',name); setEl('uname-mobile',name);
  setEl('hero-name',name);
  setEl('hero-tag', sec ? 'SECRETARIO DE COMUNICACIONES · CELIDER' : 'CREATOR · CELIDER');

  renderDistritoHeader();
  renderMyScore(mPE); renderPEDates(mPE,'tab-miscore');
  renderRankingDistritos(dPE); renderDistrito(rPE);
  renderRubrica(); renderTablaEvaluacion(); renderCalendario(); updateTimestamp();
  initScrollEffects();
}

/* ── HEADER DISTRITO ── */
function renderDistritoHeader() {
  const el = document.getElementById('distrito-header'); if (!el) return;
  const nombre = getMyDistrito();
  if (!nombre) {
    el.innerHTML = `<div style="padding:14px 0"><div style="font-family:'Barlow Condensed',sans-serif;font-size:.65rem;letter-spacing:3px;text-transform:uppercase;color:var(--red);margin-bottom:4px">⚠ Sin distrito asignado</div></div>`;
    return;
  }
  el.innerHTML = `<div class="distrito-title-block"><div class="distrito-label">TU DISTRITO</div><div class="distrito-nombre">${nombre}</div></div>`;
}

/* ── PE DATES ── */
function renderPEDates(pe, tabId) {
  const p = D?.periodos?.find(x => x.pe === pe);
  const infoId = `pe-dates-info${tabId?'-'+tabId:''}`;
  let el = document.getElementById(infoId);
  if (!el) {
    const peRow = document.querySelector(`#${tabId||'tab-miscore'} .pe-row`);
    if (!peRow) return;
    el = document.createElement('div');
    el.id = infoId;
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

/* ── MI SCORE ── */
function selectPE(pe, btn) {
  mPE = pe;
  document.querySelectorAll('#tab-miscore .pe-row .pb').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); setEl('hero-pe',pe); renderPEDates(pe,'tab-miscore'); renderMyScore(pe);
}

function renderMyScore(pe) {
  const container = document.getElementById('score-body'); if (!container) return;
  if (!D) { container.innerHTML='<div class="loading-box"><span class="spin"></span></div>'; return; }
  const criterios=getCriterios(), scores=D.scores?.[pe]||[], fbs=D.feedback?.[pe]||[];
  const myScore=scores.find(r=>r.usuario===CU.user), myFb=fbs.find(r=>r.usuario===CU.user);

  if (myScore) {
    const total=calcScore(myScore), el=document.getElementById('hero-score');
    if(el){el.textContent=total;el.style.color=scoreColor(total);}
    setEl('hero-nivel',scoreLabel(total));
  } else {
    setEl('hero-score','—'); setEl('hero-nivel','—');
    const el=document.getElementById('hero-score'); if(el) el.style.color='var(--muted)';
  }
  setEl('hero-max', MAX_TOTAL());

  if (!myScore) {
    container.innerHTML=`<div class="no-data-msg"><div class="no-data-icon">${ICONS.score}</div><div class="no-data-txt">Aún no hay evaluación para <strong>${pe}</strong>.</div></div>`;
    return;
  }

  const total=calcScore(myScore), ext=myScore.ext||0;
  const bars=criterios.map((c,i)=>{
    const val=myScore[c.key]??0, critFb=myFb?.[c.key]||'';
    return `<div class="cbar" style="animation-delay:${i*40}ms">
      <div class="cbar-top"><div><div class="cbar-tag" style="color:${c.color}">${c.abbr}</div><div class="cbar-name">${c.label}</div></div>
      <div class="cbar-val" style="color:${c.color}">${val}<span>/4</span></div></div>
      <div class="cbar-track"><div class="cbar-fill" style="width:${(val/4)*100}%;background:${c.color}"></div></div>
      ${critFb?`<div class="cbar-feedback"><span class="cbar-fb-icon">${ICONS.msg}</span><span class="cbar-fb-txt">${critFb}</span></div>`:''}
    </div>`;
  }).join('');

  container.innerHTML=`
    <div class="score-summary-card">
      <div class="sse-left">
        <div class="sse-label">Puntaje total — ${pe}</div>
        <div class="sse-name">${CU.name||CU.user}</div>
        <div class="sse-role">${isSecretario()?'Secretario':'Creator'} · ${getMyDistrito()||'Sin distrito'}</div>
        ${ext>0?`<div style="margin-top:8px"><span class="bono-badge"><span class="bono-icon">${ICONS.star}</span>Bono +${ext}</span></div>`:''}
      </div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span class="nivel-badge ${scoreClass(total)}">${scoreLabel(total)}</span>
        <div style="text-align:right">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:${scoreColor(total)};line-height:1">${total}</div>
          <div style="font-size:.65rem;color:var(--muted)">/ ${MAX_TOTAL()} pts</div>
        </div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">${bars}</div>
    ${renderTendenciaInline()}`;
}

function renderTendenciaInline() {
  if (!D) return '';
  const cards=PORTAL_CONFIG.PERIODOS.map(pe=>{
    const row=D.scores?.[pe]?.find(r=>r.usuario===CU.user);
    return {pe, s:row?calcScore(row):null, isCur:pe===mPE};
  });
  const wd=cards.filter(c=>c.s!==null);
  let arrow='';
  if (wd.length>=2) {
    const diff=wd[wd.length-1].s-wd[wd.length-2].s;
    if(diff>0) arrow=`<span class="trend-arrow up">▲ +${diff} vs período anterior</span>`;
    else if(diff<0) arrow=`<span class="trend-arrow down">▼ ${diff} vs período anterior</span>`;
    else arrow=`<span class="trend-arrow same">▬ Sin cambio</span>`;
  }
  return `<div class="trend-section"><div class="section-label">Tendencia de desempeño</div>
    <div class="trend-grid">${cards.map(({pe,s,isCur})=>`<div class="trend-card ${isCur?'current':''}">
      <div class="trend-card-pe">${pe}</div>
      <div class="trend-card-score" style="color:${s!==null?scoreColor(s):'var(--muted)'}">${s!==null?s:'—'}</div>
      <div class="trend-card-label">${s!==null?scoreLabel(s):'Sin datos'}</div></div>`).join('')}
    </div>${arrow}</div>`;
}

/* ── RANKING DE DISTRITOS (solo secretario) ── */
function selectPERankDist(pe, btn) {
  dPE = pe;
  document.querySelectorAll('#tab-ranking .pe-row .pb').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); renderRankingDistritos(pe);
}

function renderRankingDistritos(pe) {
  const el = document.getElementById('ranking-dist-body');
  if (!el) return;
  if (!D) { el.innerHTML='<div class="loading-box"><span class="spin"></span></div>'; return; }

  // Usar datos de distritos directamente del sheet (filas 23+)
  const districts = D.districtScores?.[pe] || [];
  const myDistrito = getMyDistrito();

  if (!districts.length) {
    el.innerHTML=`<div class="empty-box"><div class="empty-icon">${ICONS.trophy}</div><div class="empty-txt">Sin datos de ranking para ${pe}.</div></div>`;
    return;
  }

  const myIdx = districts.findIndex(d => d.distrito.toLowerCase() === myDistrito.toLowerCase());
  const myPos  = myIdx + 1;
  const myDist = myIdx >= 0 ? districts[myIdx] : null;
  const COMP = D?.distCompetencias || [
    { key:'cgo', label:'Gestión y Organización', abbr:'CGO', color:'#38BDF8', max:7 },
    { key:'cct', label:'Creativa y Técnica',     abbr:'CCT', color:'#2ECC71', max:7 },
    { key:'com', label:'Comunicativa',           abbr:'COM', color:'#C084FC', max:7 },
    { key:'cee', label:'Ejecución Estratégica',  abbr:'CEE', color:'#F0C040', max:7 },
  ];
  const maxTotal  = Math.max(...districts.map(d=>d.total), 1);

  // Banner de posición
  const rc = myPos===1?'gold':myPos===2?'silver':myPos===3?'bronze':'';
  const bannerHtml = myDist ? `
    <div class="dist-rank-banner">
      <div class="dist-rank-banner-label">MI POSICIÓN EN EL RANKING — ${pe}</div>
      <div class="dist-rank-banner-pos ${rc}">#${myPos}</div>
      <div class="dist-rank-banner-sub">de ${districts.length} distritos · ${myDist.total} pts</div>
    </div>` : `
    <div class="dist-rank-banner dist-rank-banner--warn">
      <div class="dist-rank-banner-label">⚠ Sin distrito asignado</div>
      <div class="dist-rank-banner-sub">Agrega el distrito en la hoja USUARIOS</div>
    </div>`;

  const rows = districts.map((d, i) => {
    const pos   = i + 1;
    const posRc = pos===1?'gold':pos===2?'silver':pos===3?'bronze':'';
    const isMe  = d.distrito.toLowerCase() === myDistrito.toLowerCase();

    if (isMe) {
      const critBars = COMP.map(c => {
        const val = d[c.key] ?? 0;
        return `<div class="dm-crit-row">
          <span class="dm-crit-abbr" style="color:${c.color}">${c.abbr}</span>
          <div class="dm-crit-track"><div class="dm-crit-fill" style="width:${(val/c.max)*100}%;background:${c.color}"></div></div>
          <span class="dm-crit-val" style="color:${c.color}">${val}</span>
        </div>`;
      }).join('');
      return `<div class="dist-rk-card dist-rk-card--me">
        <div class="dist-rk-head">
          <div class="dist-rk-pos ${posRc}">#${pos}</div>
          <div class="dist-rk-info">
            <div class="dist-rk-name">${d.distrito} <span class="dm-you-tag">MI DISTRITO</span></div>
            <div class="dist-rk-sub">Puntaje total del período</div>
          </div>
          <div class="dist-rk-score-block">
            <div class="dist-rk-score" style="color:var(--blue)">${d.total}</div>
            <div class="dist-rk-max">pts</div>
          </div>
        </div>
        <div class="dm-crit-bars dist-rk-crit-section">${critBars}</div>
      </div>`;
    } else {
      return `<div class="dist-rk-card dist-rk-card--locked">
        <div class="dist-rk-head">
          <div class="dist-rk-pos ${posRc}">#${pos}</div>
          <div class="dist-rk-info">
            <div class="dist-rk-name dist-rk-blur">Distrito confidencial</div>
            <div class="dist-rk-sub dist-rk-blur">·· pts</div>
          </div>
          <div class="dist-rk-score-block">
            <div class="dist-rk-score dist-rk-blur">●●●</div>
          </div>
        </div>
        <div class="dist-rk-lock-msg">${ICONS.lock} Información confidencial</div>
      </div>`;
    }
  }).join('');

  el.innerHTML = bannerHtml + `<div class="dist-rk-list">${rows}</div>`;
}

/* ── MI DISTRITO ── */
function selectPERank(pe, btn) {
  rPE=pe;
  document.querySelectorAll('#tab-distrito .pe-row .pb').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); renderDistrito(pe);
}

function renderDistrito(pe) {
  renderCalificacionDistrito(pe);
  renderDistStats(pe);
  renderMiembrosDistrito(pe);
}

/* Calificación oficial del distrito desde CREATORS DISTRITOS - PEx */
function renderCalificacionDistrito(pe) {
  const el = document.getElementById('dist-cal-body'); if (!el) return;
  if (!isSecretario()) return;
  const myDist = getMyDistrito();
  if (!myDist) {
    el.innerHTML = '<div style="font-size:.8rem;color:var(--muted);padding:8px 0">Sin distrito asignado.</div>';
    return;
  }
  el.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';
  API.getEvalDistritoByNombreAndPE(myDist, pe).then(ev => {
    if (!ev) {
      el.innerHTML = '<div style="font-size:.8rem;color:var(--muted);padding:8px 0">Sin calificación oficial para este período.</div>';
      return;
    }
    const s = calcDistScore(ev.puntajes);
    const critBars = DIST_CRITERIOS.map(c => {
      const val = ev.puntajes?.[c.key] ?? 0;
      return `<div class="dist-cal-row">
        <span class="dist-cal-abbr" style="color:${c.color}">${c.abbr}</span>
        <div class="dist-cal-track"><div class="dist-cal-fill" style="width:${(val/7)*100}%;background:${c.color}"></div></div>
        <span class="dist-cal-val" style="color:${c.color}">${val}</span>
      </div>`;
    }).join('');
    el.innerHTML = `<div class="dist-cal-card">
      <div class="dist-cal-head">
        <div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:.6rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--muted)">Calificación oficial · Distrito ${myDist} · ${pe}</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:2rem;line-height:1;color:${distScoreColor(s)};margin-top:4px">${s} <span style="font-size:.75rem;color:var(--muted)">/ ${MAX_DIST_SEC} pts</span></div>
        </div>
        <span class="nivel-badge ${distScoreClass(s)}">${distScoreLabel(s)}</span>
      </div>
      <div class="dist-cal-bars">${critBars}</div>
    </div>`;
  });
}

function renderDistStats(pe) {
  const el=document.getElementById('dist-stats'); if(!el) return;
  const rows=getDistritoRows(pe), myD=getMyDistrito();
  if (!rows.length) {
    el.innerHTML=`<div style="grid-column:1/-1;padding:12px 0;font-size:.8rem;color:var(--muted)">No hay miembros en <strong style="color:var(--txt)">${myD||'tu distrito'}</strong> para ${pe}.</div>`;
    return;
  }
  const scores=rows.map(calcScore), total=rows.length;
  const avg=(scores.reduce((a,b)=>a+b,0)/total).toFixed(1);
  const myRow=rows.find(r=>r.usuario===CU.user), myS=myRow?calcScore(myRow):null;
  const myPos=myS!==null?[...rows].sort((a,b)=>calcScore(b)-calcScore(a)).findIndex(r=>r.usuario===CU.user)+1:null;
  const maxS=Math.max(...scores), topR=rows.find(r=>calcScore(r)===maxS);
  el.innerHTML=[
    {lbl:'Miembros en el distrito', val:total,               sub:myD||pe,            col:''},
    {lbl:'Promedio del distrito',   val:avg,                 sub:`/ ${MAX_TOTAL()} pts`, col:scoreColor(parseFloat(avg))},
    {lbl:'Mi posición',             val:myPos?`#${myPos}`:'—', sub:`de ${total} miembros`, col:'var(--blue)'},
    {lbl:'Puntaje más alto',        val:maxS,                sub:topR?.nombre||'—',  col:'var(--sex)'},
  ].map(s=>`<div class="dist-scard"><div class="dist-scard-lbl">${s.lbl}</div><div class="dist-scard-val"${s.col?` style="color:${s.col}"`:''}>${s.val}</div><div class="dist-scard-sub">${s.sub}</div></div>`).join('');
}

function renderMiembrosDistrito(pe) {
  const el=document.getElementById('distrito-members'); if(!el) return;
  const rows=getDistritoRows(pe), fbs=D?.feedback?.[pe]||[], criterios=getCriterios();
  if (!rows.length) {
    el.innerHTML=`<div class="empty-box"><div class="empty-icon">${ICONS.users}</div><div class="empty-txt">No hay miembros en tu distrito para ${pe}.</div></div>`;
    return;
  }
  const sorted=[...rows].sort((a,b)=>calcScore(b)-calcScore(a));
  el.innerHTML=`<div class="distrito-members-grid">${sorted.map((r,i)=>{
    const s=calcScore(r), isMe=r.usuario===CU.user, myFb=fbs.find(f=>f.usuario===r.usuario);
    const ext=r.ext||0, pos=i+1, rc=pos===1?'gold':pos===2?'silver':pos===3?'bronze':'';
    const critBars=criterios.map(c=>{
      const val=r[c.key]||0;
      return `<div class="dm-crit-row"><span class="dm-crit-abbr" style="color:${c.color}">${c.abbr}</span><div class="dm-crit-track"><div class="dm-crit-fill" style="width:${(val/4)*100}%;background:${c.color}"></div></div><span class="dm-crit-val" style="color:${c.color}">${val}</span></div>`;
    }).join('');
    const hasFb=myFb&&criterios.some(c=>myFb[c.key]);
    return `<div class="dm-card${isMe?' dm-card--me':''}">
      <div class="dm-card-head">
        <div class="dm-rank ${rc}">#${pos}</div>
        <div class="dm-avatar">${initials(r.nombre||r.usuario)}</div>
        <div class="dm-info">
          <div class="dm-name">${r.nombre||r.usuario}${isMe?'<span class="dm-you-tag">YO</span>':''}</div>
          <div class="dm-role">${r.rol||'Creator'}${r.area?' · '+r.area:''}</div>
        </div>
        <div class="dm-score-block">
          <div class="dm-score-total" style="color:${scoreColor(s)}">${s}</div>
          <div class="dm-score-max">/ ${MAX_TOTAL()}</div>
          <span class="nivel-badge ${scoreClass(s)}" style="font-size:.55rem;padding:3px 8px">${scoreLabel(s)}</span>
          ${ext>0?`<span class="bono-badge" style="font-size:.55rem;padding:3px 8px;margin-top:4px"><span class="bono-icon">${ICONS.star}</span>+${ext}</span>`:''}
        </div>
      </div>
      <div class="dm-crit-bars">${critBars}</div>
      ${hasFb?`<details class="dm-feedback"><summary>Ver retroalimentación</summary><div class="dm-feedback-body">${criterios.map(c=>myFb[c.key]?`<div class="dm-fb-row"><span style="color:${c.color};font-weight:700;font-size:.65rem;letter-spacing:1px">${c.abbr}</span><span>${myFb[c.key]}</span></div>`:'').join('')}</div></details>`:''}
    </div>`;
  }).join('')}</div>`;
}

/* ── RÚBRICA ── */
function renderRubrica() {
  const el=document.getElementById('rubrica-grid'); if(!el) return;
  const rubrica=D?.rubrica||[], criterios=getCriterios();
  if (!rubrica.length) { el.innerHTML=`<div class="empty-box"><div class="empty-icon">${ICONS.clipboard}</div><div class="empty-txt">Rúbrica no disponible.</div></div>`; return; }
  const levels=[{n:4,lbl:'Excelente',color:'var(--green)'},{n:3,lbl:'Bueno',color:'var(--blue)'},{n:2,lbl:'En Proceso',color:'var(--gold)'},{n:1,lbl:'Bajo',color:'var(--red)'}];
  const lk={4:'nivel4',3:'nivel3',2:'nivel2',1:'nivel1'};
  el.innerHTML=rubrica.map((r,i)=>{const c=criterios[i]||{},color=c.color||'#888';return `<div class="rubrica-card" id="rc-${i}"><div class="rubrica-card-head" onclick="document.getElementById('rc-${i}').classList.toggle('open')"><div class="rubrica-dot" style="background:${color}"></div><div class="rubrica-title" style="color:${color}">${r.criterio}</div><span class="rubrica-chev">▾</span></div><div class="rubrica-body"><div class="rubrica-levels">${levels.map(l=>`<div class="rlevel"><div class="rlevel-badge" style="color:${l.color}">${l.n}</div><div class="rlevel-lbl" style="color:${l.color}">${l.lbl}</div><div class="rlevel-desc">${r[lk[l.n]]||'—'}</div></div>`).join('')}</div></div></div>`;}).join('');
}

/* ── TABLA DE EVALUACIÓN (solo secretario) ── */
let _rubricaMode = 'creators';

function setRubricaMode(mode, btn) {
  _rubricaMode = mode;
  document.querySelectorAll('.eval-rtb').forEach(b=>b.classList.remove('active'));
  btn?.classList.add('active');
  document.getElementById('eval-rubric-creators').style.display  = mode==='creators'  ? '' : 'none';
  document.getElementById('eval-rubric-distritos').style.display = mode==='distritos' ? '' : 'none';
}

function renderTablaEvaluacion() {
  if (!isSecretario()) return;
  _renderRubricaGrid('eval-rubrica-creators-grid',  D?.rubrica || [], getCriterios());
  _renderRubricaGrid('eval-rubrica-distritos-grid',  D?.rubricaDistritos || [], D?.distCompetencias || [
    {color:'#38BDF8'},{color:'#2ECC71'},{color:'#C084FC'},{color:'#F0C040'}
  ]);
}

function _renderRubricaGrid(elId, rubrica, criterios) {
  const el = document.getElementById(elId); if (!el) return;
  if (!rubrica.length) {
    el.innerHTML=`<div class="empty-box"><div class="empty-icon">${ICONS.clipboard}</div><div class="empty-txt">Rúbrica no disponible aún.</div></div>`;
    return;
  }
  const levels=[{n:4,lbl:'Excelente',color:'var(--green)'},{n:3,lbl:'Bueno',color:'var(--blue)'},{n:2,lbl:'En Proceso',color:'var(--gold)'},{n:1,lbl:'Bajo',color:'var(--red)'}];
  const lk={4:'nivel4',3:'nivel3',2:'nivel2',1:'nivel1'};
  el.innerHTML=rubrica.map((r,i)=>{
    const c=criterios[i]||{}, color=c.color||'#888', uid=`${elId}-${i}`;
    return `<div class="rubrica-card" id="${uid}">
      <div class="rubrica-card-head" onclick="document.getElementById('${uid}').classList.toggle('open')">
        <div class="rubrica-dot" style="background:${color}"></div>
        <div class="rubrica-title" style="color:${color}">${r.criterio}</div>
        <span class="rubrica-chev">▾</span>
      </div>
      <div class="rubrica-body">
        <div class="rubrica-levels">
          ${levels.map(l=>`<div class="rlevel">
            <div class="rlevel-badge" style="color:${l.color}">${l.n}</div>
            <div class="rlevel-lbl" style="color:${l.color}">${l.lbl}</div>
            <div class="rlevel-desc">${r[lk[l.n]]||'—'}</div>
          </div>`).join('')}
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ── CALENDARIO ── */
function renderCalendario() {
  const el=document.getElementById('cal-grid'); if(!el) return;
  const cal=D?.calendario||[];
  if (!cal.length) { el.innerHTML=`<div class="empty-box" style="grid-column:1/-1"><div class="empty-icon">${ICONS.calendar}</div><div class="empty-txt">No hay eventos disponibles.</div></div>`; return; }
  const cAcc={rojo:'cal-acc--rojo',verde:'cal-acc--verde',azul:'cal-acc--azul',amarillo:'cal-acc--amarillo'};
  const cT={rojo:'cal-t--rojo',verde:'cal-t--verde',azul:'cal-t--azul',amarillo:'cal-t--amarillo'};
  const emap={'en curso':{cls:'sa',dot:true,txt:'En curso'},'próximo':{cls:'sp',dot:true,txt:'Próximo'},'proximo':{cls:'sp',dot:true,txt:'Próximo'},'pendiente':{cls:'spe',dot:false,txt:'Pendiente'},'completado':{cls:'spe',dot:false,txt:'Completado'}};
  el.innerHTML=cal.map(p=>{const c=(p.color||'rojo').toLowerCase(),es=emap[(p.estado||'pendiente').toLowerCase()]||emap.pendiente,rows=[['Inicio',p.inicio],['Fin de trabajo',p.finTrabajo],['Entrega scores',p.entrega],['Jornada',p.jornada]].filter(([,v])=>v);return `<div class="cal-card"><div class="cal-acc ${cAcc[c]||cAcc.rojo}"></div><div class="cal-body"><div class="cal-num">PERÍODO ${String(p.numero).padStart(2,'0')}</div><div class="cal-t ${cT[c]||cT.rojo}">${p.titulo}</div>${rows.map(([l,v])=>`<div class="cal-r"><span class="cal-rl">${l}</span><span>${v}</span></div>`).join('')}<div class="cst ${es.cls}">${es.dot?'<span class="sdot"></span>':''}${es.txt}</div></div></div>`;}).join('');
}

/* ── REFRESH ── */
async function handleRefresh() {
  const btn=document.getElementById('btn-refresh');
  if(btn){btn.classList.add('refreshing');btn.disabled=true;}
  showToast('Actualizando...','info');
  await loadData(); renderDistritoHeader();
  renderMyScore(mPE); renderRankingDistritos(dPE); renderDistrito(rPE);
  renderRubrica(); renderTablaEvaluacion(); renderCalendario(); updateTimestamp();
  if(btn){btn.classList.remove('refreshing');btn.disabled=false;}
  showToast('Datos actualizados ✓','ok');
}

/* ── HELPERS ── */
const calcScore  = row => getCriterios().reduce((s,c)=>s+(row[c.key]||0),0)+(row.ext||0);
const scoreColor = s => s>=26?'var(--sex)':s>=20?'var(--sbu)':s>=11?'var(--spr)':'var(--sba)';
const scoreLabel = s => s>=26?'Excelente':s>=20?'Bueno':s>=11?'En Proceso':'Bajo';
const scoreClass = s => s>=26?'sex':s>=20?'sbu':s>=11?'spr':'sba';
const initials   = n => String(n||'').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase()||'?';
const setEl      = (id,txt) => { const el=document.getElementById(id); if(el) el.textContent=txt; };
const pad        = n => String(n).padStart(2,'0');

/* ── TABS ── */
function switchTab(tab, btn) {
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  document.getElementById(`tab-${tab}`)?.classList.add('active');
  document.querySelectorAll('#desktop-nav .tnav').forEach(b=>b.classList.remove('active'));
  btn?.classList.add('active');
}
function switchTabMobile(tab, btn) {
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  document.getElementById(`tab-${tab}`)?.classList.add('active');
  document.querySelectorAll('.mobile-menu .mobile-nav-btn').forEach(b=>b.classList.remove('active'));
  btn?.classList.add('active'); closeMenu();
  // Sincronizar desktop nav
  const allTabs=['miscore','ranking','distrito','evaluacion','rubrica','cal'];
  const idx=allTabs.indexOf(tab);
  const visibleBtns=[...document.querySelectorAll('#desktop-nav .tnav')].filter(b=>b.style.display!=='none');
  const visibleTabs=allTabs.filter((t,i)=>{ const b=document.querySelectorAll('#desktop-nav .tnav')[i]; return !b||b.style.display!=='none'; });
  document.querySelectorAll('#desktop-nav .tnav').forEach(b=>b.classList.remove('active'));
  const deskBtn=[...document.querySelectorAll('#desktop-nav .tnav')].find(b=>b.getAttribute('onclick')?.includes(`'${tab}'`));
  if(deskBtn) deskBtn.classList.add('active');
}
function toggleMenu() {
  _menuOpen=!_menuOpen;
  document.getElementById('hamburger')?.classList.toggle('open',_menuOpen);
  document.getElementById('mobile-menu')?.classList.toggle('open',_menuOpen);
  document.getElementById('hamburger')?.setAttribute('aria-expanded',_menuOpen);
  document.body.style.overflow=_menuOpen?'hidden':'';
}
function closeMenu() {
  _menuOpen=false;
  document.getElementById('hamburger')?.classList.remove('open');
  document.getElementById('mobile-menu')?.classList.remove('open');
  document.getElementById('hamburger')?.setAttribute('aria-expanded','false');
  document.body.style.overflow='';
}
document.addEventListener('click',e=>{const menu=document.getElementById('mobile-menu'),ham=document.getElementById('hamburger');if(menu?.classList.contains('open')&&!menu.contains(e.target)&&!ham?.contains(e.target))closeMenu();});
window.addEventListener('resize',()=>{if(window.innerWidth>720)closeMenu();});
function updateTimestamp() {
  if(!_lastUpdated)return;
  const t=_lastUpdated,txt=`✓ ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  ['ts-badge','ts-badge-mob'].forEach(id=>{const el=document.getElementById(id);if(!el)return;el.textContent=txt;el.classList.add('flash');setTimeout(()=>el.classList.remove('flash'),1000);});
}
function showToast(msg,type='') {
  const t=document.getElementById('toast');if(!t)return;
  t.textContent=msg;t.className=`toast${type?' toast--'+type:''} show`;
  setTimeout(()=>t.classList.remove('show'),3000);
}
function logout(){if(_arTimer)clearInterval(_arTimer);Auth.logout();window.location.replace('index.html');}
function initScrollEffects(){
  const topbar=document.getElementById('topbar'),backTop=document.getElementById('back-top');let ticking=false;
  window.addEventListener('scroll',()=>{if(!ticking){requestAnimationFrame(()=>{const y=window.scrollY;topbar?.classList.toggle('scrolled',y>10);backTop?.classList.toggle('visible',y>300);ticking=false;});ticking=true;}},{passive:true});
}