/**
 * EIGHT CREATORS LABs — Lógica Vista de Miembro
 */
'use strict';

let CU = null, D = null, mPE = null, _lastUpdated = null, _menuOpen = false, _peInited = false;

/* CRITERIOS_DEFAULT eliminado: si la consulta de criterios falla, la vista
   debe mostrar un error, no siete criterios inventados que parecen reales.
   getCriterios/getMaxScore/MAX_TOTAL viven en core/render.js y leen Store. */

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', async () => {
  CU = await Auth.requireRole('miembro');
  if (!CU) return;

  // Fase 1: con esto ya se pinta el hero y la barra de períodos.
  if (await loadContexto()) {
    initUI();
    // Fase 2: el contenido del período llega después, sin bloquear el pintado.
    if (await loadContenido()) renderPeriodoActual();
  }
  initRevalidacion();
});

/* ── REVALIDACIÓN AL VOLVER A LA PESTAÑA ──────────────────────────────
 * Sin esto, si el admin cambia el período activo mientras el miembro tiene
 * la pestaña abierta, el miembro no se entera nunca y la etiqueta "Última
 * actualización" miente: marca cuándo se cargó la página, no cuándo cambió
 * el dato.
 */
const REVALIDAR_MS = 60000;

function initRevalidacion() {
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    if (_lastUpdated && Date.now() - _lastUpdated.getTime() < REVALIDAR_MS) return;

    const idAnterior = Store.periodoActivo()?.id ?? null;
    if (!(await loadContexto())) return;

    // Si el admin cambió el período activo, seguirlo.
    const nuevo = Store.periodoActivo();
    if (nuevo && String(nuevo.id) !== String(idAnterior)) {
      Store.setPeriodo(nuevo.id);
      mPE = nuevo.pe;
      _trabajosPE = nuevo.pe;
    }
    await loadContenido();
    initUI();
    if (!Store.necesitaCarga('trabajos')) renderTrabajosTab();
  });
}

/* ── FASE 1: CONTEXTO (crítica, paralela) ── */
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
        mPE = inicial.pe;
        _trabajosPE = inicial.pe;
      }
      _peInited = true;
    }
    return true;
  } catch (e) {
    console.error('[User]', e);
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

/* ── FASE 2: CONTENIDO del período elegido (lazy, cancelable) ──
 * Cambiar de PE rápido disparaba N peticiones sin cancelación que podían
 * llegar desordenadas y pintar el período equivocado.
 */
let _abortContenido = null;

async function loadContenido() {
  const pid = Store.periodoId();
  if (!pid) { _contenido = null; return true; }

  _abortContenido?.abort();
  _abortContenido = new AbortController();

  const res = await API.getContenido(pid, { signal: _abortContenido.signal });
  if (res.aborted) return false;          // llegó una petición más nueva
  if (!res.ok) { mostrarErrorCarga(res.error); return false; }

  _contenido   = res;
  _lastUpdated = new Date();
  Store.set({ lastUpdated: _lastUpdated });
  return true;
}

let _contenido = null;

/** Mi fila del período actual. Identidad SIEMPRE por UUID (3.6). */
const miFila     = () => (_contenido?.scores   || []).find(r => r.evaluado_id === CU?.id) || null;
const miFeedback = () => (_contenido?.feedback || []).find(r => r.evaluado_id === CU?.id) || null;

/** Estado de error visible. Un fallo de RLS no debe parecer "sin datos". */
function mostrarErrorCarga(msg) {
  const cont = document.getElementById('score-body');
  if (!cont) return;
  cont.replaceChildren();
  const box = document.createElement('div');
  box.className = 'no-data-msg';
  box.setAttribute('role', 'alert');
  const t = document.createElement('div');
  t.className = 'no-data-txt';
  t.textContent = 'No se pudieron cargar tus datos. ' + (msg || '');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pb';
  btn.style.marginTop = '12px';
  btn.textContent = 'Reintentar';
  btn.addEventListener('click', () => location.reload());
  box.append(t, btn);
  cont.appendChild(box);
}

/* Barras de período: se construyen desde los datos, no desde HTML fijo. */
function buildPEBars() {
  const pes = D?.periodos || [];
  renderPEBar(document.getElementById('pe-row-scores'),   pes, mPE,         selectPE);
  renderPEBar(document.getElementById('trabajos-pe-row'), pes, _trabajosPE, selectTrabajoPE);
  setEl('hero-pe', mPE);
}

function syncAllPEButtons() {
  syncPEBar(document.getElementById('pe-row-scores'),   mPE);
  syncPEBar(document.getElementById('trabajos-pe-row'), _trabajosPE);
  setEl('hero-pe', mPE);
}

/* Render quirúrgico (3.9): initUI() monta lo que no cambia; el contenido
   que depende del período se repinta aparte con renderPeriodoActual().
   Antes initUI() reconstruía por innerHTML scores, rúbrica, calendario,
   quick links y timestamp completos en cada pasada. */
let _uiMontada = false;

function initUI() {
  if (!CU) return;
  buildPEBars();

  if (!_uiMontada) {
    const name = CU.name || CU.user;
    const ini  = initials(name);
    setEl('av-desktop', ini); setEl('av-mobile', ini);
    setEl('uname-desktop', name); setEl('uname-mobile', name);
    setEl('hero-name', name);
    renderQuickLinks();     // 4 tarjetas estáticas: se montan UNA vez
    initScrollEffects();
    _uiMontada = true;
  }

  renderRubrica();
  renderCalendario();
  renderPeriodoActual();
  updateTimestamp();
}

/** Repinta solo lo que depende del período seleccionado. */
function renderPeriodoActual() {
  renderScores(mPE);
  renderPEDates(mPE);
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
  // La etiqueta de estado la decide la UI, no la capa de datos (3.5).
  const est = estadoPeriodo(p);
  el.innerHTML = `<span class="pe-dates-nombre">${escHtml(p.nombre||p.pe)}</span>` +
    items.map(([l,v])=>`<span class="pe-dates-item"><span class="pe-dates-lbl">${l}:</span> ${escHtml(v)}</span>`).join('') +
    `<span class="pe-dates-estado pe-estado--${est.key}">${est.label}</span>`;
}

/* ── SCORES ── */
async function selectPE(pe, btn) {
  mPE = pe;
  Store.setPeriodo(pe);
  // Solo la barra que contiene el botón pulsado. Antes usaba
  // '.pe-row .pb' global y desactivaba también la barra de Trabajos.
  syncPEBar(btn.closest('.pe-row'), pe);
  setEl('hero-pe', pe);
  renderPEDates(pe);
  renderCargando(document.getElementById('score-body'));
  // Cambiar de período dispara solo la fase 2, cancelando la anterior.
  if (await loadContenido()) renderScores(pe);
}

function renderScores(pe) {
  const container = document.getElementById('score-body'); if (!container) return;

  // Sin criterios no se puede puntuar nada. Antes se caía a
  // CRITERIOS_DEFAULT y el usuario veía barras plausibles pero falsas.
  if (!hayCriterios()) {
    renderError(container, 'No se pudieron cargar los criterios de evaluación.', () => location.reload());
    return;
  }
  if (!_contenido) { renderCargando(container); return; }

  const criterios = getCriterios();
  // Identidad SIEMPRE por UUID (3.6). Antes buscaba por email O por UUID
  // porque el join a veces no devolvía el email; eso era una curita sobre
  // el problema real, no una solución.
  const myScore = miFila();
  const myFb    = miFeedback()?.fb || null;

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
    // Vacío legítimo: dice CUÁNDO estará disponible si se sabe.
    renderVacio(container, `Aún no hay evaluación para ${pe}.`,
                { periodo: Store.periodo(), calendario: D?.calendario });
    return;
  }

  const total = calcScore(myScore);
  const ext   = myScore.ext || 0;
  const bars  = criterios.map((c, i) => {
    const val    = puntajeDe(myScore, c.key);
    const critFb = myFb?.[c.key] || '';
    return `
      <div class="cbar" style="animation-delay:${i*40}ms">
        <div class="cbar-top">
          <div>
            <div class="cbar-tag" style="color:var(--criterio)">${escHtml(c.abbr)}</div>
            <div class="cbar-name">${escHtml(c.label)}</div>
          </div>
          <div class="cbar-val" style="color:var(--criterio)">${val}<span>/4</span></div>
        </div>
        <div class="cbar-track">
          <div class="cbar-fill" style="width:${(val/4)*100}%;background:var(--criterio)"></div>
        </div>
        ${critFb ? `<div class="cbar-feedback"><span class="cbar-fb-icon">${ICONS.msg}</span><span class="cbar-fb-txt">${escHtml(critFb)}</span></div>` : ''}
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="score-summary-card">
      <div class="sse-left">
        <div class="sse-label">Puntaje total — ${pe}</div>
        <div class="sse-name">${escHtml(CU.name || CU.user)}</div>
        
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
          <div class="rubrica-title" style="color:${color}">${escHtml(r.criterio)}</div>
          <span class="rubrica-chev">▾</span>
        </div>
        <div class="rubrica-body">
          <div class="rubrica-levels">
            ${levels.map(l=>`<div class="rlevel"><div class="rlevel-badge" style="color:${escHtml(l.color)}">${l.n}</div><div class="rlevel-lbl" style="color:${escHtml(l.color)}">${l.lbl}</div><div class="rlevel-desc">${r[lk[l.n]]||'—'}</div></div>`).join('')}
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
          <div class="cal-t ${cT[c]||cT.rojo}">${escHtml(p.titulo)}</div>
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

/* Los helpers (calcScore, scoreColor/Label/Class, initials, setEl, pad,
   showToast, timeAgo...) viven ahora en core/render.js. */

/* ── TABS ── */
const _userTabParent = { scores:'scores', periodos:'periodos', cal:'periodos', trabajos:'trabajos', rubrica:'rubrica', reportes:'reportes' };

function switchTab(tab, btn) {
  switchTabCore(tab, btn, { contentSelector: '.tab-content', parentMap: _userTabParent });

  // Política única de carga (3.11): se carga la primera vez y solo se
  // repite si alguien invalida la pestaña explícitamente.
  if (tab === 'reportes' && Store.necesitaCarga('reportes')) {
    Store.marcarCargado('reportes'); renderUserReport();
  }
  if (tab === 'periodos') renderPeriodosTab();
  if (tab === 'trabajos' && Store.necesitaCarga('trabajos')) {
    Store.marcarCargado('trabajos');
    _trabajosPE = Store.periodoNombre();
    syncTrabajoPEBtns();
    renderTrabajosTab();
  }
}

function switchTabMobile(tab, btn) { switchTabMobileCore(tab, btn, switchTab); }

function toggleMobGroup(header) { header.classList.toggle('open'); }

/* ── TAB: REPORTES (usuario) ──
 * El historial cruza TODOS los períodos, así que no puede salir de la fase
 * 2 (que está filtrada a uno). Usa su propia consulta, pequeña: una fila
 * por período y solo del usuario en sesión.
 */
async function renderUserReport() {
  const el = document.getElementById('rpt-user-body'); if (!el) return;
  renderCargando(el);

  const res = await API.getMiHistorial();
  if (!res.ok) {
    renderError(el, 'No se pudo cargar tu historial. ' + (res.error || ''), () => {
      Store.invalidar('reportes'); renderUserReport();
    });
    return;
  }

  const criterios = getCriterios();
  const data = (Store.periodos() || []).map(p => {
    const h = res.porPeriodo[p.id];
    if (!h) return null;
    const row = { evaluado_id: CU.id, ext: h.ext, puntajes: h.puntajes };
    return { pe: p.pe, row, total: calcScore(row) };
  }).filter(Boolean);

  if (!data.length) {
    renderVacio(el, 'No tienes evaluaciones disponibles aún.',
                { periodo: Store.periodo(), calendario: D?.calendario });
    return;
  }

  const avg   = data.reduce((s,d)=>s+d.total,0) / data.length;
  const best  = data.reduce((b,d)=>d.total>b.total?d:b);
  const trend = data.length >= 2 ? data[data.length-1].total - data[0].total : 0;
  const trendTxt = trend > 0 ? `+${trend} vs PE1` : trend < 0 ? `${trend} vs PE1` : 'Sin cambio';
  const trendColor = trend > 0 ? 'var(--sex)' : trend < 0 ? 'var(--sba)' : 'var(--muted)';
  const MAX   = MAX_TOTAL();

  const critAvg = criterios.map(c => {
    const vals = data.map(d => puntajeDe(d.row, c.key));
    return { ...c, avg: vals.reduce((s,v)=>s+v,0) / vals.length };
  }).sort((a,b) => b.avg - a.avg);

  el.innerHTML = `
    <div class="urpt-header">
      <div class="urpt-name">${escHtml(CU.name || CU.user)}</div>
      <div class="urpt-meta">Períodos evaluados: ${escHtml(data.map(d=>d.pe).join(' · '))}</div>
    </div>

    <div class="urpt-kpi-row">
      <div class="urpt-kpi">
        <div class="urpt-kpi-val" style="color:${scoreColor(best.total)}">${best.total}</div>
        <div class="urpt-kpi-lbl">Mejor puntaje<br><span style="font-size:.7rem;color:var(--muted)">${escHtml(best.pe)}</span></div>
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
            <div class="urpt-hist-pe">${escHtml(d.pe)}</div>
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
            <div class="urpt-crit-lbl" title="${escHtml(c.label)}" style="color:var(--criterio)">${escHtml(c.abbr)}</div>
            <div class="urpt-crit-bar-track">
              <div class="urpt-crit-bar-fill" style="width:${pct}%;background:var(--criterio)"></div>
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
                ${criterios.map(c=>`<th class="urpt-th" title="${escHtml(c.label)}" style="color:var(--criterio)">${escHtml(c.abbr)}</th>`).join('')}
                <th class="urpt-th">Bono</th>
                <th class="urpt-th">Total</th>
                <th class="urpt-th">Nivel</th>
              </tr>
            </thead>
            <tbody>
              ${data.map(d=>`
                <tr>
                  <td class="urpt-td urpt-td-pe">${escHtml(d.pe)}</td>
                  ${criterios.map(c=>`<td class="urpt-td urpt-td-s">${puntajeDe(d.row,c.key)}</td>`).join('')}
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

/* ── LOGOUT ── */
function logout() { Auth.logout(); }

/* updateTimestamp, showToast, initScrollEffects → core/render.js */
function goTab(tab) { goTabCore(tab, switchTab); }

/* ── ATAJOS RÁPIDOS ── */
function renderQuickLinks() {
  const el = document.getElementById('quick-links'); if (!el) return;
  const links = [
    { tab:'trabajos', icon:'folder-open',    title:'Mis Trabajos',  desc:'Registra tus actividades del período actual' },
    { tab:'periodos', icon:'layers',          title:'Períodos',      desc:'Fechas de inicio, entrega y cierre' },
    { tab:'rubrica',  icon:'clipboard-list', title:'Rúbrica',       desc:'Criterios y tabla de puntuación' },
    { tab:'reportes', icon:'bar-chart-2',    title:'Mis Estadísticas', desc:'Historial y evolución de tu desempeño' },
  ];
  el.innerHTML = links.map(l =>
    `<button class="ql-card" onclick="goTab('${l.tab}')" aria-label="Ir a ${l.title}">
       <i data-lucide="${l.icon}" class="ql-icon"></i>
       <div class="ql-text"><div class="ql-title">${l.title}</div><div class="ql-desc">${l.desc}</div></div>
       <i data-lucide="chevron-right" class="ql-arrow"></i>
     </button>`
  ).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
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
// Antes era 'PE1' fijo, que con PE4 activo mostraba el período equivocado.
let _trabajosPE = null, _trabajosLoaded = false;

function syncTrabajoPEBtns() {
  syncPEBar(document.getElementById('trabajos-pe-row'), _trabajosPE);
}

function selectTrabajoPE(pe, btn) {
  _trabajosPE = pe;
  syncPEBar(btn.closest('.pe-row'), pe);
  renderTrabajosTab();
}

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
      <input class="cfg-inp" id="tj-titulo" type="text" placeholder="Título del trabajo (ej: Video campaña agosto)" style="width:100%;margin-bottom:8px">
      <textarea class="cfg-inp" id="tj-desc" placeholder="Describe la actividad realizada..." rows="3" style="width:100%;resize:vertical"></textarea>
      <button class="btn-save" style="margin-top:10px;width:100%;display:flex;align-items:center;justify-content:center;gap:7px" onclick="saveTrabajo()">
        <i data-lucide="send" style="width:14px;height:14px"></i> Agregar trabajo
      </button>
    </div>
    <div class="section-label" style="margin:20px 0 10px">
      <i data-lucide="list" style="width:12px;height:12px;vertical-align:-2px;margin-right:4px"></i>
      ${trabajos.length} trabajo${trabajos.length!==1?'s':''} registrado${trabajos.length!==1?'s':''} · ${_trabajosPE}
    </div>
    ${trabajos.length
      ? `<div class="trabajos-list">${trabajos.map(t=>`
          <div class="trabajo-item">
            <div class="trabajo-item-head">
              <div class="trabajo-titulo">${t.titulo?escHtml(t.titulo):'<span class="tj-notitle">Sin título</span>'}</div>
              <button class="btn-icon-del" onclick="deleteTrabajo('${t.id}')" title="Eliminar" aria-label="Eliminar trabajo">
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
  if (typeof lucide !== 'undefined') lucide.createIcons();
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
