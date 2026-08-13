/**
 * EIGHT CREATORS LABs — Portal (Secretario + Miembro)
 * Secretario ve: Mi Score, Ranking, Mi Distrito, Criterios, Rúbrica, Calendario
 * Miembro   ve: Mi Score,           Mi Distrito, Criterios, Rúbrica, Calendario
 */
'use strict';

let CU = null, D = null;
/* parseJSON → core/render.js */

/* Un solo período gobierna toda la página: mPE, rPE y dPE son ahora vistas
   del mismo valor del Store, no tres estados independientes. Antes elegir
   "PE2" en Mi Score dejaba el ranking en PE1. */
let mPE=null, rPE=null, dPE=null;
let _lastUpdated=null, _peInited=false;

/* CRITERIOS_DEFAULT eliminado — ver core/render.js. */
const isSecretario = () => CU?.rol === 'secretario';

const DIST_CRITERIOS = [
  { key:'cgo', label:'Competencia en Gestión y Organización', abbr:'CGO', color:'var(--criterio)', max:7 },
  { key:'cct', label:'Competencia Creativa y Técnica',        abbr:'CCT', color:'var(--criterio)', max:7 },
  { key:'com', label:'Competencia Comunicativa',              abbr:'COM', color:'var(--criterio)', max:7 },
  { key:'cee', label:'Competencia de Ejecución Estratégica',  abbr:'CEE', color:'var(--criterio)', max:7 },
];
const MAX_DIST_SEC   = 28;
const calcDistScore  = p => { const o = parseJSON(p); return DIST_CRITERIOS.reduce((s,c) => s+(Number(o[c.key])||0), 0); };
const distScoreColor = s => s>=24?'var(--sex)':s>=17?'var(--sbu)':s>=10?'var(--spr)':'var(--sba)';
const distScoreLabel = s => s>=24?'Excelente':s>=17?'Bueno':s>=10?'En Proceso':'Bajo';
const distScoreClass = s => s>=24?'sex':s>=17?'sbu':s>=10?'spr':'sba';

function getMyDistrito() {
  if (!CU) return '';
  return (CU.distrito || '').trim();
}

/**
 * Filas del distrito para el período actual.
 *
 * NO vuelve a filtrar por distrito (3.10): RLS es la única frontera. El
 * filtro en JS asumía que llegaban más filas de las que el usuario debe
 * ver, y ese es exactamente el sitio donde se cuelan las fugas cuando
 * alguien toca una policy meses después.
 */
function getDistritoRows() {
  return _contenido?.scores || [];
}

/* toggleMenu / closeMenu vivían aquí, apuntando a #hamburger y
   #mobile-menu. Ninguno de los dos existe en el marcado desde que el
   rail sustituyó a la topbar en la fase 6, junto con sus dos listeners
   globales de clic y resize. */

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', async () => {
  CU = await Auth.requireAnyRole(['secretario','miembro']);
  if (!CU) return;

  if (await loadContexto()) {
    initUI();
    if (await loadContenido()) renderPeriodoActual();
  }
  initRevalidacion();
});

/* ── REVALIDACIÓN AL VOLVER A LA PESTAÑA ── */
const REVALIDAR_MS = 60000;

function initRevalidacion() {
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    if (_lastUpdated && Date.now() - _lastUpdated.getTime() < REVALIDAR_MS) return;

    const idAnterior = Store.periodoActivo()?.id ?? null;
    if (!(await loadContexto())) return;

    // Un solo período gobierna todas las secciones: si el admin lo cambió,
    // Mi Score, Ranking, Mi Distrito y Trabajos lo siguen a la vez.
    const nuevo = Store.periodoActivo();
    if (nuevo && String(nuevo.id) !== String(idAnterior)) {
      Store.setPeriodo(nuevo.id);
      mPE = rPE = dPE = _trabajosPE = nuevo.pe;
    }
    await loadContenido();
    initUI();
    if (!Store.necesitaCarga('trabajos')) renderTrabajosTab();
  });
}

/* ── FASE 1: CONTEXTO ── */
async function loadContexto() {
  try {
    const ctx = await API.getContexto(gestionDeURL());
    if (!ctx.ok) { mostrarErrorCarga(ctx.error); return false; }

    _lastUpdated = new Date();
    Store.set({
      profile:     CU,
      periodos:    ctx.periodos  || [],
      criterios:   ctx.criterios || [],
      lastUpdated: _lastUpdated,
    });
    D = { ...(D || {}), criterios: ctx.criterios, periodos: ctx.periodos,
          rubrica: ctx.rubrica, calendario: ctx.calendario,
          gestion: ctx.gestion, gestiones: ctx.gestiones, soloLectura: ctx.soloLectura };

    // Lo pasado se lee siempre, se escribe nunca.
    renderBannerSoloLectura(ctx.gestion);
    renderSelectorGestion('gestion-switch', ctx.gestiones, ctx.gestion?.id, cambiarGestion);

    if (!_peInited) {
      const inicial = ctx.periodoActivo || ctx.periodos?.[0] || null;
      if (inicial) {
        Store.setPeriodo(inicial.id);
        mPE = rPE = dPE = _trabajosPE = inicial.pe;
      }
      _peInited = true;
    }
    return true;
  } catch(e) {
    console.error('[Portal]', e);
    mostrarErrorCarga(e.message || String(e));
    return false;
  }
}

/**
 * Cambia de gestión. Recarga la página con ?gestion=<id>: reconstruir el
 * estado a mano (períodos, contenido, historial, caché de pestañas) es más
 * frágil que empezar limpio, y cambiar de gestión es una acción rara.
 */
function cambiarGestion(gestionId) {
  const u = new URL(location.href);
  u.searchParams.set('gestion', gestionId);
  location.assign(u.toString());
}

/** Gestión pedida por URL, si la hay. */
function gestionDeURL() {
  return new URLSearchParams(location.search).get('gestion') || null;
}

/* ── FASE 2: CONTENIDO del período elegido (lazy, cancelable) ── */
let _abortContenido = null;
let _contenido = null;

async function loadContenido() {
  const pid = Store.periodoId();
  if (!pid) { _contenido = null; return true; }

  _abortContenido?.abort();
  _abortContenido = new AbortController();

  const res = await API.getContenido(pid, { signal: _abortContenido.signal });
  if (res.aborted) return false;
  if (!res.ok) { mostrarErrorCarga(res.error); return false; }

  _contenido   = res;
  _lastUpdated = new Date();
  Store.set({ lastUpdated: _lastUpdated });
  return true;
}

/** Identidad SIEMPRE por UUID (3.6), nunca por email. */
const miFila     = () => (_contenido?.scores   || []).find(r => r.evaluado_id === CU?.id) || null;
const miFeedback = () => (_contenido?.feedback || []).find(r => r.evaluado_id === CU?.id) || null;

/** Estado de error visible. Un fallo de RLS no debe parecer "sin datos". */
/** Estado de error del bloque de score. Delega en renderError() de
    core/render.js: el mensaje al usuario y la ocultacion del detalle
    tecnico se deciden en un solo sitio. */
function mostrarErrorCarga(msg) {
  renderError(document.getElementById('score-body'), msg, () => location.reload());
}

/* Las cuatro barras se generan desde los datos. */
function buildPEBars() {
  const pes = D?.periodos || [];
  renderPEBar(document.getElementById('pe-row-miscore'),  pes, mPE,         selectPE);
  renderPEBar(document.getElementById('pe-row-rankdist'), pes, dPE,         selectPERankDist);
  renderPEBar(document.getElementById('pe-row-rank'),     pes, rPE,         selectPERank);
  renderPEBar(document.getElementById('trabajos-pe-row'), pes, _trabajosPE, selectTrabajoPE);
  setEl('hero-pe', mPE);
}

function syncAllPEButtons() {
  syncPEBar(document.getElementById('pe-row-miscore'),  mPE);
  syncPEBar(document.getElementById('pe-row-rankdist'), dPE);
  syncPEBar(document.getElementById('pe-row-rank'),     rPE);
  syncPEBar(document.getElementById('trabajos-pe-row'), _trabajosPE);
  setEl('hero-pe', mPE);
}

/* Render quirúrgico (3.9): lo estático se monta una vez. */
let _uiMontada = false;

function initUI() {
  if (!CU) return;
  buildPEBars();

  if (!_uiMontada) {
    const sec = isSecretario();
    initNav({
      marca: 'EIGHT CREATORS',
      badge: sec ? 'SECRETARIO' : 'CREATOR',
      activo: 'miscore',
      pie: { nombre: CU.name || CU.user,
             badge: sec ? 'Secretario de Comunicaciones' : 'Creator' },
      grupos: [{ items: [
        { tab:'miscore',   icono:'bar-chart-2', etiqueta:'Mi Score' },
        ...(sec ? [
        { tab:'ranking',   icono:'trophy',      etiqueta:'Ranking' },
        { tab:'distrito',  icono:'map',         etiqueta:'Mi Distrito' }] : []),
        { tab:'trabajos',  icono:'folder-open', etiqueta:'Entregas' },
        { tab:'historial', icono:'history',     etiqueta:'Historial' },
      ]}],
    });
    // Mostrar/ocultar elementos exclusivos del secretario
    document.querySelectorAll('.sec-only').forEach(el => { el.style.display = sec ? '' : 'none'; });
    document.querySelectorAll('.mem-only').forEach(el => { el.style.display = sec ? 'none' : ''; });
    const dc = document.getElementById('dist-calificacion');
    if (dc) dc.style.display = sec ? 'block' : 'none';

    const badge = document.getElementById('role-badge');
    if (badge) { badge.textContent = sec ? 'SECRETARIO' : 'CREATOR'; badge.className = sec ? 'secretario-badge' : 'portal-badge'; }
    const rolMob = document.getElementById('role-label-mob');
    if (rolMob) rolMob.textContent = sec ? 'Secretario de Comunicaciones' : 'Creator';

    const name = CU.name || CU.user, ini = initials(name);
    // 'av-mobile' y 'uname-mobile' no existen en ningún HTML: eran ids
    // de la topbar que el rail sustituyó en la fase 6.
    // montarAvatar() de core/render.js: pinta la foto si la hay, las
    // iniciales si no, y engancha el selector de archivo.
    montarAvatar(CU);
    setEl('hero-name',name);
    setEl('hero-tag', sec ? 'SECRETARIO DE COMUNICACIONES · CELIDER 08' : 'CREATOR · CELIDER 08');

    renderDistritoHeader();
    renderQuickLinks();      // estáticas: una sola vez
    initScrollEffects();
    _uiMontada = true;
  }

  renderRubrica(); renderTablaEvaluacion(); renderCalendario();
  renderPeriodoActual();
  updateTimestamp();
}

/** Repinta solo lo que depende del período seleccionado. */
function renderPeriodoActual() {
  renderMyScore(mPE);
  renderPEDates(mPE, 'tab-miscore');
  renderRankingDistritos(dPE);
  renderDistrito(rPE);
}

/* ── HEADER DISTRITO ── */
function renderDistritoHeader() {
  const el = document.getElementById('distrito-header'); if (!el) return;
  const nombre = getMyDistrito();
  if (!nombre) {
    el.innerHTML = `<div style="padding:14px 0"><div style="font-family:'Barlow Condensed',sans-serif;font-size:.65rem;letter-spacing:3px;text-transform:uppercase;color:var(--red);margin-bottom:4px">⚠ Sin distrito asignado</div></div>`;
    return;
  }
  el.innerHTML = `<div class="distrito-title-block"><div class="distrito-label">TU DISTRITO</div><div class="distrito-nombre">${escHtml(nombre)}</div></div>`;
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
  el.innerHTML = `<span class="pe-dates-nombre">${escHtml(p.nombre||p.pe)}</span>` +
    items.map(([l,v])=>`<span class="pe-dates-item"><span class="pe-dates-lbl">${l}:</span> ${v}</span>`).join('') +
    (p.estado?`<span class="pe-dates-estado pe-estado--${estadoCls}">${p.estado}</span>`:'');
}

/* ── MI SCORE ── */
/* Un solo período para toda la página (3.8): cambiarlo en cualquier barra
   repinta Mi Score, Ranking, Mi Distrito y Trabajos a la vez. */
async function cambiarPeriodo(pe, btn) {
  if (!pe) return;
  mPE = rPE = dPE = _trabajosPE = pe;
  Store.setPeriodo(pe);
  if (btn) syncPEBar(btn.closest('.pe-row'), pe);
  syncAllPEButtons();
  setEl('hero-pe', pe);
  renderPEDates(pe, 'tab-miscore');
  renderCargando(document.getElementById('score-body'));

  // Solo la fase 2, cancelando la petición anterior.
  if (!(await loadContenido())) return;

  renderMyScore(pe);
  renderRankingDistritos(pe);
  renderDistrito(pe);
  if (!Store.necesitaCarga('trabajos')) renderTrabajosTab();
}

function selectPE(pe, btn)         { cambiarPeriodo(pe, btn); }

function renderMyScore(pe) {
  const container = document.getElementById('score-body'); if (!container) return;
  if (!hayCriterios()) {
    renderError(container, 'No se pudieron cargar los criterios de evaluación.', () => location.reload());
    return;
  }
  if (!_contenido) { renderCargando(container); return; }

  // El historial (tendencia) se carga una vez y repinta al llegar.
  if (!_historial) ensureHistorial().then(() => renderMyScore(mPE));

  const criterios = getCriterios();
  const myScore = miFila();               // identidad por UUID (3.6)
  const myFb    = miFeedback()?.fb || null;

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
    renderVacio(container, `Aún no hay evaluación para ${pe}.`,
                { periodo: Store.periodo(), calendario: D?.calendario });
    return;
  }

  const total=calcScore(myScore), ext=myScore.ext||0;
  const bars=criterios.map((c,i)=>{
    const val=puntajeDe(myScore,c.key), critFb=myFb?.[c.key]||'';
    return `<div class="cbar" style="animation-delay:${i*40}ms">
      <div class="cbar-top"><div><div class="cbar-tag" style="color:var(--criterio)">${escHtml(c.abbr)}</div><div class="cbar-name">${escHtml(c.label)}</div></div>
      <div class="cbar-val" style="color:var(--criterio)">${val}<span>/4</span></div></div>
      <div class="cbar-track"><div class="cbar-fill" style="width:${pctBarra(val, c)}%;background:var(--criterio)"></div></div>
      ${critFb?`<div class="cbar-feedback"><span class="cbar-fb-icon">${ICONS.msg}</span><span class="cbar-fb-txt">${escHtml(critFb)}</span></div>`:''}
    </div>`;
  }).join('');

  container.innerHTML=`
    <div class="score-summary-card">
      <div class="sse-left">
        <div class="sse-label">Puntaje total — ${pe}</div>
        <div class="sse-name">${escHtml(CU.name||CU.user)}</div>
        <div class="sse-role">${isSecretario()?'Secretario':'Creator'} · ${escHtml(getMyDistrito()||'Sin distrito')}</div>
        ${ext>0?`<div style="margin-top:8px"><span class="bono-badge"><span class="bono-icon">${ICONS.star}</span>Bono +${ext}</span></div>`:''}
      </div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span class="nivel-badge ${scoreClass(total)}">${scoreLabel(total)}</span>
        <div style="text-align:right">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:${scoreColorTxt(total)};line-height:1">${total}</div>
          <div style="font-size:.65rem;color:var(--muted)">/ ${MAX_TOTAL()} pts</div>
        </div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">${bars}</div>
    ${renderTendenciaInline()}`;
}

/* La tendencia cruza TODOS los períodos, así que no puede salir de la fase 2
   (filtrada a uno). Usa el historial propio, que es una consulta pequeña. */
let _historial = null;   // { [periodo_id]: { ext, puntajes } }

async function ensureHistorial() {
  if (_historial) return _historial;
  const res = await API.getMiHistorial();
  _historial = res.ok ? res.porPeriodo : {};
  return _historial;
}

function renderTendenciaInline() {
  if (!_historial) return '';   // se pinta en la segunda pasada
  const cards = (Store.periodos() || []).map(p => {
    const h = _historial[p.id];
    const row = h ? { evaluado_id: CU.id, ext: h.ext, puntajes: h.puntajes } : null;
    return { pe: p.pe, s: row ? calcScore(row) : null, isCur: p.pe === mPE };
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
function selectPERankDist(pe, btn) { cambiarPeriodo(pe, btn); }

function renderRankingDistritos(pe) {
  const el = document.getElementById('ranking-dist-body');
  if (!el) return;
  if (!_contenido) { renderCargando(el); return; }

  // Ya viene filtrado por período desde la consulta (3.4).
  const districts  = _contenido.districtScores || [];
  const myDistrito = getMyDistrito();

  if (!districts.length) {
    renderVacio(el, `Sin datos de ranking para ${pe}.`,
                { periodo: Store.periodo(), calendario: D?.calendario });
    return;
  }

  const myIdx = districts.findIndex(d => d.distrito.toLowerCase() === myDistrito.toLowerCase());
  const myPos  = myIdx + 1;
  const myDist = myIdx >= 0 ? districts[myIdx] : null;
  const COMP = D?.distCompetencias || [
    { key:'cgo', label:'Gestión y Organización', abbr:'CGO', color:'var(--criterio)', max:7 },
    { key:'cct', label:'Creativa y Técnica',     abbr:'CCT', color:'var(--criterio)', max:7 },
    { key:'com', label:'Comunicativa',           abbr:'COM', color:'var(--criterio)', max:7 },
    { key:'cee', label:'Ejecución Estratégica',  abbr:'CEE', color:'var(--criterio)', max:7 },
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
          <span class="dm-crit-abbr" style="color:var(--criterio)">${escHtml(c.abbr)}</span>
          <div class="dm-crit-track"><div class="dm-crit-fill" style="width:${(val/c.max)*100}%;background:var(--criterio)"></div></div>
          <span class="dm-crit-val" style="color:var(--criterio)">${val}</span>
        </div>`;
      }).join('');
      return `<div class="dist-rk-card dist-rk-card--me">
        <div class="dist-rk-head">
          <div class="dist-rk-pos ${posRc}">#${pos}</div>
          <div class="dist-rk-info">
            <div class="dist-rk-name">${escHtml(d.distrito)} <span class="dm-you-tag">MI DISTRITO</span></div>
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
function selectPERank(pe, btn) { cambiarPeriodo(pe, btn); }

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
      const val = parseJSON(ev.puntajes)[c.key] ?? 0;
      return `<div class="dist-cal-row">
        <span class="dist-cal-abbr" style="color:var(--criterio)">${escHtml(c.abbr)}</span>
        <div class="dist-cal-track"><div class="dist-cal-fill" style="width:${(val/7)*100}%;background:var(--criterio)"></div></div>
        <span class="dist-cal-val" style="color:var(--criterio)">${val}</span>
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

function getDistrictMembersList() {
  return _contenido?.districtMembers || [];
}

function renderDistStats(pe) {
  const el=document.getElementById('dist-stats'); if(!el) return;
  const members=getDistrictMembersList(), myD=getMyDistrito();
  const rows=getDistritoRows();
  const totalMembers=members.length;
  if (!totalMembers) {
    el.innerHTML=`<div style="grid-column:1/-1;padding:12px 0;font-size:.8rem;color:var(--muted)">No hay miembros en <strong style="color:var(--txt)">${escHtml(myD||'tu distrito')}</strong>.</div>`;
    return;
  }
  const evaluated=rows.length;
  const scores=rows.map(calcScore);
  const avg=evaluated?(scores.reduce((a,b)=>a+b,0)/evaluated).toFixed(1):'—';
  const myRow=rows.find(r=>r.evaluado_id===CU.id), myS=myRow?calcScore(myRow):null;
  const myPos=myS!==null?[...rows].sort((a,b)=>calcScore(b)-calcScore(a)).findIndex(r=>r.evaluado_id===CU.id)+1:null;
  const maxS=scores.length?Math.max(...scores):0, topR=scores.length?rows.find(r=>calcScore(r)===maxS):null;
  el.innerHTML=[
    {lbl:'Miembros en el distrito', val:totalMembers,          sub:`${evaluated} evaluados · ${myD||pe}`, col:''},
    {lbl:'Promedio del distrito',   val:avg,                   sub:evaluated?`/ ${MAX_TOTAL()} pts`:'Sin evaluaciones', col:evaluated?scoreColor(parseFloat(avg)):''},
    {lbl:'Mi posición',             val:myPos?`#${myPos}`:'—', sub:evaluated?`de ${evaluated} evaluados`:'Sin evaluar', col:'var(--blue)'},
    {lbl:'Puntaje más alto',        val:scores.length?maxS:'—', sub:topR?.nombre||'—', col:scores.length?'var(--sex)':''},
  ].map(s=>`<div class="dist-scard"><div class="dist-scard-lbl">${s.lbl}</div><div class="dist-scard-val"${s.col?` style="color:${s.col}"`:''}>${s.val}</div><div class="dist-scard-sub">${s.sub}</div></div>`).join('');
}

function renderMiembrosDistrito(pe) {
  const el=document.getElementById('distrito-members'); if(!el) return;
  const members=getDistrictMembersList(), scoreRows=getDistritoRows(), fbs=_contenido?.feedback||[], criterios=getCriterios();
  if (!members.length) {
    el.innerHTML=`<div class="empty-box"><div class="empty-icon">${ICONS.users}</div><div class="empty-txt">No hay miembros registrados en tu distrito.</div></div>`;
    return;
  }
  const merged=members.map(m=>{
    const scoreRow=scoreRows.find(r=>r.evaluado_id===m.id);
    return { ...m, usuario:m.email, score:scoreRow?calcScore(scoreRow):null, scoreRow, ext:scoreRow?.ext||0 };
  });
  const withScores=merged.filter(m=>m.score!==null).sort((a,b)=>b.score-a.score);
  const withoutScores=merged.filter(m=>m.score===null).sort((a,b)=>(a.nombre||'').localeCompare(b.nombre||''));
  const sorted=[...withScores,...withoutScores];
  el.innerHTML=`<div class="distrito-members-grid">${sorted.map((r,i)=>{
    const hasEval=r.score!==null;
    const s=r.score||0, isMe=r.id===CU.id, myFb=(fbs.find(f=>f.evaluado_id===r.id)||{}).fb||null;
    const pos=hasEval?withScores.indexOf(r)+1:null;
    const rc=pos===1?'gold':pos===2?'silver':pos===3?'bronze':'';
    const rolName=r.roles?.nombre||r.tipo_miembro||'Creator';
    const critBars=hasEval?criterios.map(c=>{
      const val=puntajeDe(r.scoreRow,c.key);
      return `<div class="dm-crit-row"><span class="dm-crit-abbr" style="color:var(--criterio)">${escHtml(c.abbr)}</span><div class="dm-crit-track"><div class="dm-crit-fill" style="width:${pctBarra(val, c)}%;background:var(--criterio)"></div></div><span class="dm-crit-val" style="color:var(--criterio)">${val}</span></div>`;
    }).join(''):'';
    const hasFb=myFb&&criterios.some(c=>myFb[c.key]);
    return `<div class="dm-card${isMe?' dm-card--me':''}">
      <div class="dm-card-head">
        <div class="dm-rank ${rc}">${pos?'#'+pos:'—'}</div>
        <div class="dm-avatar">${escHtml(initials(r.nombre||r.email))}</div>
        <div class="dm-info">
          <div class="dm-name">${escHtml(r.nombre||r.email)}${isMe?'<span class="dm-you-tag">YO</span>':''}</div>
          <div class="dm-role">${escHtml(rolName)}</div>
        </div>
        <div class="dm-score-block">
          ${hasEval?`
            <div class="dm-score-total" style="color:${scoreColorTxt(s)}">${s}</div>
            <div class="dm-score-max">/ ${MAX_TOTAL()}</div>
            <span class="nivel-badge ${scoreClass(s)}" style="font-size:.55rem;padding:3px 8px">${scoreLabel(s)}</span>
            ${r.ext>0?`<span class="bono-badge" style="font-size:.55rem;padding:3px 8px;margin-top:4px"><span class="bono-icon">${ICONS.star}</span>+${r.ext}</span>`:''}
          `:`<div class="dm-score-total" style="color:var(--muted);font-size:.85rem">Sin evaluar</div>`}
        </div>
      </div>
      ${critBars?`<div class="dm-crit-bars">${critBars}</div>`:''}
      ${hasFb?`<details class="dm-feedback"><summary>Ver retroalimentación</summary><div class="dm-feedback-body">${criterios.map(c=>myFb[c.key]?`<div class="dm-fb-row"><span style="color:var(--criterio);font-weight:700;font-size:.65rem;letter-spacing:1px">${escHtml(c.abbr)}</span><span>${myFb[c.key]}</span></div>`:'').join('')}</div></details>`:''}
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
  el.innerHTML=rubrica.map((r,i)=>{const c=criterios[i]||{},color='var(--criterio)';return `<div class="rubrica-card" id="rc-${i}"><div class="rubrica-card-head" data-act="abrirCerrar" data-arg="rc-${i}"><div class="rubrica-dot" style="background:${color}"></div><div class="rubrica-title" style="color:${color}">${escHtml(r.criterio)}</div><span class="rubrica-chev">▾</span></div><div class="rubrica-body"><div class="rubrica-levels">${levels.map(l=>`<div class="rlevel"><div class="rlevel-badge" style="color:${escHtml(l.color)}">${l.n}</div><div class="rlevel-lbl" style="color:${escHtml(l.color)}">${l.lbl}</div><div class="rlevel-desc">${r[lk[l.n]]||'—'}</div></div>`).join('')}</div></div></div>`;}).join('');
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
    {color:'var(--criterio)'},{color:'var(--criterio)'},{color:'var(--criterio)'},{color:'var(--criterio)'}
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
    const c=criterios[i]||{}, color = 'var(--criterio)', uid=`${elId}-${i}`;
    return `<div class="rubrica-card" id="${uid}">
      <div class="rubrica-card-head" data-act="abrirCerrar" data-arg="${uid}">
        <div class="rubrica-dot" style="background:${color}"></div>
        <div class="rubrica-title" style="color:${color}">${escHtml(r.criterio)}</div>
        <span class="rubrica-chev">▾</span>
      </div>
      <div class="rubrica-body">
        <div class="rubrica-levels">
          ${levels.map(l=>`<div class="rlevel">
            <div class="rlevel-badge" style="color:${escHtml(l.color)}">${l.n}</div>
            <div class="rlevel-lbl" style="color:${escHtml(l.color)}">${l.lbl}</div>
            <div class="rlevel-desc">${escHtml(r[lk[l.n]]||'—')}</div>
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
  el.innerHTML=cal.map(p=>{const c=(p.color||'rojo').toLowerCase(),es=emap[(p.estado||'pendiente').toLowerCase()]||emap.pendiente,rows=[['Inicio',p.inicio],['Fin de trabajo',p.finTrabajo],['Entrega scores',p.entrega],['Jornada',p.jornada]].filter(([,v])=>v);return `<div class="cal-card"><div class="cal-acc ${cAcc[c]||cAcc.rojo}"></div><div class="cal-body"><div class="cal-num">PERÍODO ${String(p.numero).padStart(2,'0')}</div><div class="cal-t ${cT[c]||cT.rojo}">${escHtml(p.titulo)}</div>${rows.map(([l,v])=>`<div class="cal-r"><span class="cal-rl">${l}</span><span>${v}</span></div>`).join('')}<div class="cst ${es.cls}">${es.dot?'<span class="sdot"></span>':''}${es.txt}</div></div></div>`;}).join('');
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

/* Los helpers viven ahora en core/render.js. */

/* ── TABS ── */
/* Se aceptan los nombres viejos por si queda algun enlace guardado. */
const _ALIAS_TAB = { periodos:'historial', cal:'historial', reportes:'historial' };
const _secTabParent = {
  miscore:'miscore', ranking:'ranking', distrito:'ranking',
  trabajos:'trabajos', historial:'historial',
  evaluacion:'evaluacion', rubrica:'rubrica',
};

function switchTab(tab, btn) {
  tab = _ALIAS_TAB[tab] || tab;
  switchTabCore(tab, btn, { contentSelector: '.tab-content', parentMap: _secTabParent });

  // Entregas reúne trabajos, fechas del período y calendario: es la
  // pestaña de "qué debo entregar y cuándo".
  if (tab === 'trabajos') renderPeriodosTab();
  if (tab === 'trabajos' && Store.necesitaCarga('trabajos')) {
    Store.marcarCargado('trabajos');
    _trabajosPE = Store.periodoNombre();
    syncTrabajoPEBtns();
    renderTrabajosTab();
  }
  if (tab === 'historial' && Store.necesitaCarga('reportes')) {
    Store.marcarCargado('reportes'); renderUserReport();
  }
}

function switchTabMobile(tab, btn) { switchTabMobileCore(tab, btn, switchTab); }

function toggleMobGroup(header) { header.classList.toggle('open'); }
function logout(){Auth.logout();}

/* updateTimestamp, showToast, initScrollEffects → core/render.js */
function goTab(tab) { goTabCore(tab, switchTab); }

/* ── ATAJOS RÁPIDOS ── */
function renderQuickLinks() {
  const el = document.getElementById('quick-links'); if (!el) return;
  const sec = isSecretario();
  const links = [
    { tab:'trabajos',  icon:'folder-open',    title:'Mis Trabajos',     desc:'Registra tus actividades del período' },
    { tab:'periodos',  icon:'layers',          title:'Períodos',         desc:'Fechas y estados de evaluación' },
    ...(sec ? [
      { tab:'distrito',  icon:'map',           title:'Mi Distrito',      desc:'Miembros y calificación de tu distrito' },
      { tab:'ranking',   icon:'trophy',        title:'Ranking Distritos', desc:'Posición de todos los distritos' },
    ] : []),
    { tab:'rubrica',   icon:'clipboard-list', title:'Rúbrica',          desc:'Criterios y tabla de puntuación' },
    { tab:'reportes',  icon:'bar-chart-2',    title:'Mis Estadísticas', desc:'Historial y evolución de tu desempeño' },
  ];
  el.innerHTML = links.map(l =>
    `<button class="ql-card" data-act="irTab" data-arg="${l.tab}" aria-label="Ir a ${l.title}">
       <i data-lucide="${l.icon}" class="ql-icon"></i>
       <div class="ql-text"><div class="ql-title">${l.title}</div><div class="ql-desc">${l.desc}</div></div>
       <i data-lucide="chevron-right" class="ql-arrow"></i>
     </button>`
  ).join('');
  renderIconos(el);
}

/* ── TAB: PERÍODOS ── */
function renderPeriodosTab() {
  const el = document.getElementById('periodos-body'); if (!el) return;
  const periodos = D?.periodos || [];
  if (!periodos.length) {
    el.innerHTML = '<div class="empty-box"><div class="empty-txt">No hay períodos disponibles.</div></div>';
    return;
  }
  const stateMap = { 'Activo':'sex','Próximo':'sbu','En Progreso':'spr','Cerrado':'sba' };
  el.innerHTML = periodos.map(p => {
    const active = p.pe === mPE;
    const cls    = stateMap[p.estado] || 'sbu';
    const fields = [['Inicio',p.inicio],['Fin trabajo',p.finTrabajo],['Entrega',p.entrega],['Jornada',p.jornada]].filter(([,v])=>v);
    return `<div class="pe-card${active?' pe-card--active':''}">
      <div class="pe-card-head">
        <div class="pe-card-code">${escHtml(p.pe)}</div>
        <div class="pe-card-nombre">${escHtml(p.nombre||p.pe)}</div>
        ${p.estado?`<span class="nivel-badge ${cls}" style="font-size:.52rem;padding:3px 9px">${p.estado}</span>`:''}
        ${active?'<span class="pe-card-now">◉ ACTUAL</span>':''}
      </div>
      ${fields.length?`<div class="pe-card-dates">${fields.map(([l,v])=>`<div class="pe-card-date"><span class="pe-card-lbl">${l}</span><span class="pe-card-val">${v}</span></div>`).join('')}</div>`:''}
    </div>`;
  }).join('');
}

/* ── TAB: TRABAJOS ── */
// null hasta que loadData() resuelva el período activo real.
let _trabajosPE = null, _trabajosLoaded = false;

function syncTrabajoPEBtns() {
  syncPEBar(document.getElementById('trabajos-pe-row'), _trabajosPE);
}

function selectTrabajoPE(pe, btn) { cambiarPeriodo(pe, btn); }

async function renderTrabajosTab() {
  const el = document.getElementById('trabajos-body'); if (!el) return;
  el.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';
  // La API indexa por periodo_id (UUID); _trabajosPE es solo la etiqueta.
  const pidTrab = Store.periodos().find(p => p.pe === _trabajosPE)?.id ?? null;
  const data = await API.getTrabajosEntregados(CU.id, pidTrab);
  renderTrabajosBody(data);
}

// escHtml() defined globally in config.js

function renderTrabajosBody(trabajos) {
  const el = document.getElementById('trabajos-body'); if (!el) return;
  el.innerHTML = `
    <div class="trabajo-form-card">
      <div class="trabajo-form-title">
        <i data-lucide="plus-circle" class="tj-icon"></i> Registrar trabajo en ${_trabajosPE}
      </div>
      <input class="cfg-inp" id="tj-titulo" type="text" placeholder="Título del trabajo" style="width:100%;margin-bottom:8px">
      <textarea class="cfg-inp" id="tj-desc" placeholder="Describe la actividad realizada..." rows="3" style="width:100%;resize:vertical"></textarea>
      <button class="btn-save" style="margin-top:10px;width:100%;display:flex;align-items:center;justify-content:center;gap:7px" data-act="guardarTrabajo">
        <i data-lucide="send" style="width:14px;height:14px"></i> Agregar trabajo
      </button>
    </div>
    <div class="section-label" style="margin:20px 0 10px">
      <i data-lucide="list" style="width:12px;height:12px;vertical-align:-2px;margin-right:4px"></i>
      ${trabajos.length} trabajo${trabajos.length!==1?'s':''} en ${_trabajosPE}
    </div>
    ${trabajos.length
      ? `<div class="trabajos-list">${trabajos.map(t=>`
          <div class="trabajo-item">
            <div class="trabajo-item-head">
              <div class="trabajo-titulo">${t.titulo?escHtml(t.titulo):'<span class="tj-notitle">Sin título</span>'}</div>
              <button class="btn-icon-del" data-act="borrarTrabajo" data-arg="${t.id}" title="Eliminar" aria-label="Eliminar">
                <i data-lucide="trash-2" style="width:13px;height:13px"></i>
              </button>
            </div>
            <div class="trabajo-desc">${escHtml(t.descripcion)}</div>
            <div class="trabajo-meta">
              <i data-lucide="clock" style="width:11px;height:11px;vertical-align:-1px;opacity:.55;margin-right:3px"></i>
              ${new Date(t.created_at).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'})}
            </div>
          </div>`).join('')}
        </div>`
      : `<div class="empty-box" style="border-style:dashed;margin-top:0">
           <div class="empty-icon" style="opacity:.35"><i data-lucide="folder-open" style="width:30px;height:30px"></i></div>
           <div class="empty-txt">Sin trabajos en <strong>${_trabajosPE}</strong>.<br>Usa el formulario de arriba para agregar.</div>
         </div>`}`;
  renderIconos(el);
}

async function saveTrabajo() {
  const tEl = document.getElementById('tj-titulo'), dEl = document.getElementById('tj-desc');
  const titulo = tEl?.value.trim()||'', desc = dEl?.value.trim()||'';
  if (!desc) { showToast('Describe el trabajo antes de agregar.','error'); dEl?.focus(); return; }
  const pidNuevo = Store.periodos().find(p => p.pe === _trabajosPE)?.id ?? null;
  if (!pidNuevo) { showToast('No se pudo identificar el período.', 'error'); return; }
  const res = await API.upsertTrabajo({ user_id:CU.id, periodo_id:pidNuevo, titulo, descripcion:desc });
  if (!res.ok) { showToast('Error: '+res.error,'error'); return; }
  if (tEl) tEl.value=''; if (dEl) dEl.value='';
  showToast('✓ Trabajo registrado','ok');
  await renderTrabajosTab();
}

async function deleteTrabajo(id) {
  if (!confirm('¿Eliminar este trabajo?')) return;
  const res = await API.deleteTrabajo(id);
  if (!res.ok) { showToast('Error al eliminar','error'); return; }
  showToast('Trabajo eliminado','ok');
  await renderTrabajosTab();
}

/* ── TAB: REPORTES (secretario/miembro) ── */
async function renderUserReport() {
  const el = document.getElementById('rpt-user-body'); if (!el) return;
  renderCargando(el);

  const hist = await ensureHistorial();
  const criterios = getCriterios();
  const data = (Store.periodos() || []).map(p => {
    const h = hist[p.id];
    if (!h) return null;
    const row = { evaluado_id: CU.id, ext: h.ext, puntajes: h.puntajes };
    return { pe: p.pe, row, total: calcScore(row) };
  }).filter(Boolean);

  if (!data.length) {
    renderVacio(el, 'Sin evaluaciones registradas aún.',
                { periodo: Store.periodo(), calendario: D?.calendario });
    return;
  }
  borrarGrafico('rpt-evolucion');

  const scores = data.map(d => d.total);
  const best = Math.max(...scores), avg = (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1);
  const maxT = MAX_TOTAL();
  el.innerHTML = `
    <div class="urpt-header">
      <div class="urpt-name">${escHtml(CU.name||CU.user)}</div>
      <div class="urpt-meta">Historial de desempeño · ${data.length} período${data.length!==1?'s':''} evaluado${data.length!==1?'s':''}</div>
    </div>
    <div class="urpt-kpi-row">
      <div class="urpt-kpi"><div class="urpt-kpi-val" style="color:${scoreColorTxt(best)}">${best}</div><div class="urpt-kpi-lbl">Mejor puntaje</div></div>
      <div class="urpt-kpi"><div class="urpt-kpi-val">${avg}</div><div class="urpt-kpi-lbl">Promedio</div></div>
      <div class="urpt-kpi"><div class="urpt-kpi-val">${maxT}</div><div class="urpt-kpi-lbl">Puntaje máximo</div></div>
      <div class="urpt-kpi"><div class="urpt-kpi-val" style="color:var(--sex);font-size:1rem">${scoreLabel(best)}</div><div class="urpt-kpi-lbl">Mejor nivel</div></div>
    </div>
    <div class="urpt-section-lbl" id="rpt-evol-lbl">Evolución entre períodos</div>
    <div class="chart-wrap">
      <canvas id="rpt-evolucion" role="img"
              aria-labelledby="rpt-evol-lbl" aria-describedby="rpt-evol-alt"></canvas>
    </div>
    <p class="chart-alt" id="rpt-evol-alt">${escHtml(
      data.map(d => `${d.pe}: ${d.total} de ${maxT} (${scoreLabel(d.total)})`).join('. ')
    )}.</p>
    <div class="urpt-section-lbl" style="margin-top:16px">Detalle por criterio</div>
    <div class="urpt-section">
      <div class="urpt-table-wrap"><table class="urpt-table">
        <thead><tr>
          <th class="urpt-th">Criterio</th>
          ${data.map(d=>`<th class="urpt-th">${escHtml(d.pe)}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${criterios.map(c=>`<tr>
            <td class="urpt-td" style="text-align:left;font-weight:600;font-size:.72rem">${escHtml(c.abbr||c.label)}</td>
            ${data.map(d=>`<td class="urpt-td urpt-td-s" style="color:var(--criterio)">${puntajeDe(d.row,c.key)}</td>`).join('')}
          </tr>`).join('')}
          <tr>
            <td class="urpt-td urpt-td-pe">TOTAL</td>
            ${data.map(d=>`<td class="urpt-td urpt-td-total" style="color:${scoreColorTxt(d.total)}">${d.total}</td>`).join('')}
          </tr>
        </tbody>
      </table></div>
    </div>`;

  // Después del innerHTML: antes el <canvas> todavía no existe.
  graficoEvolucion('rpt-evolucion', data, maxT);
}