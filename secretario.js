/**
 * EIGHT CREATORS LABs — Portal del secretario
 *
 * Cinco destinos en dos grupos:
 *   Mi espacio  : Inicio · Mi perfil · Entregas          (lo mismo que el miembro)
 *   Mi distrito : Distrito · Tareas                       (solo secretario)
 *
 *   · Inicio    → core/inicio.js, con el pulso del distrito como bloque propio.
 *   · Mi perfil → core/perfil.js. Absorbe lo que eran «Mi Score» e «Historial».
 *   · Distrito  → las personas del distrito (tarjetas que abren su perfil) y,
 *                 en una subpestaña, el ranking de distritos.
 *   · Tareas    → asigna y revisa a las personas de SU distrito.
 *
 * Quién ve qué lo decide RLS: el cliente no vuelve a filtrar por distrito.
 */
'use strict';

let CU = null, D = null;
/* parseJSON → core/render.js */

/* Un solo período gobierna toda la página: cambiarlo en cualquier barra
   repinta Inicio, Perfil, Distrito, Tareas y Entregas a la vez. */
let mPE = null;
let _lastUpdated = null, _peInited = false;

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

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', async () => {
  CU = await Auth.requireAnyRole(['secretario','miembro']);
  if (!CU) return;

  if (await loadContexto()) {
    await initUI();
    if (await loadContenido()) await renderPeriodoActual();
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
    // todas lo siguen a la vez.
    const nuevo = Store.periodoActivo();
    if (nuevo && String(nuevo.id) !== String(idAnterior)) {
      Store.setPeriodo(nuevo.id);
      mPE = _trabajosPE = nuevo.pe;
    }
    await loadContenido();
    await initUI();
    await renderPeriodoActual();
    if (!Store.necesitaCarga('trabajos')) renderTrabajosTab();
  });
}

/* ── CONTEXTO ── */
async function loadContexto() {
  try {
    const ctx = await API.getContexto(gestionDeURL());
    if (!ctx.ok) { mostrarErrorCarga(ctx.error); return false; }

    _lastUpdated = new Date();
    Store.set({
      profile:     CU,
      periodos:    ctx.periodos  || [],
      criterios:   ctx.criterios || [],
      criteriosV2: ctx.criteriosV2 || [],
      perfiles:    ctx.perfiles    || [],
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
        mPE = _trabajosPE = inicial.pe;
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

/* ── CONTENIDO del período elegido (lazy, cancelable) ── */
let _abortContenido = null;
let _contenido = null;

async function loadContenido() {
  const pid = Store.periodoId();
  if (!pid) { _contenido = null; return true; }

  _abortContenido?.abort();
  const ctrl = _abortContenido = new AbortController();

  const res = await API.getContenido(pid, { signal: ctrl.signal });
  if (res.aborted) return false;
  if (!res.ok) { mostrarErrorCarga(res.error); return false; }

  // Período con la rúbrica por roles: el resultado lo calcula la base. Para
  // un secretario la función devuelve las filas de su distrito.
  res.v2 = null;
  if (esPeriodoV2(Store.periodo())) {
    const r2 = await API.getResultadosV2(pid);
    if (ctrl.signal.aborted) return false;
    if (!r2.ok) { mostrarErrorCarga(r2.error); return false; }
    res.v2 = r2.rows;
  }

  _contenido   = res;
  _tareasDistrito = null;                 // las tareas se piden por período
  _lastUpdated = new Date();
  Store.set({ lastUpdated: _lastUpdated });
  return true;
}

/** Estado de error visible. Delega en renderError() de core/render.js: el
    mensaje al usuario y la ocultación del detalle técnico se deciden allí. */
function mostrarErrorCarga(msg) {
  const host = document.getElementById('inicio-host') || document.getElementById('perfil-host');
  renderError(host, msg, () => location.reload());
}

/* ── BARRAS DE PERÍODO (todas siguen al mismo valor) ── */
const _BARRAS_PE = ['pe-row-rank', 'trabajos-pe-row', 'tareas-pe-row'];

function buildPEBars() {
  const pes = D?.periodos || [];
  for (const id of _BARRAS_PE) renderPEBar(document.getElementById(id), pes, mPE, cambiarPeriodo);
}

function syncAllPEButtons() {
  for (const id of _BARRAS_PE) syncPEBar(document.getElementById(id), mPE);
}

/* ── UI ──────────────────────────────────────────────────────────────────
   Lo estático se monta una vez; lo que depende del período se repinta aparte
   con renderPeriodoActual(). */
let _uiMontada = false;

async function initUI() {
  if (!CU) return;
  buildPEBars();
  actualizarRailProximo();

  if (!_uiMontada) {
    const sec = isSecretario();
    initNav({
      marca: 'EIGHT CREATORS',
      badge: sec ? 'SECRETARIO' : 'CREATOR',
      activo: 'inicio', calTab: 'calendario',
      pie: { nombre: CU.name || CU.user,
             badge: sec ? 'Secretario de Comunicaciones' : 'Creator' },
      grupos: [
        { titulo: sec ? 'Mi espacio' : '', items: [
          { tab:'inicio',   icono:'house',       etiqueta:'Inicio'    },
          { tab:'perfil',   icono:'user-round',  etiqueta:'Mi perfil' },
          { tab:'calendario', icono:'calendar',  etiqueta:'Calendario' },
          { tab:'trabajos', icono:'folder-open', etiqueta:'Entregas'  },
        ]},
        ...(sec ? [{ titulo: 'Mi distrito', items: [
          { tab:'distrito', icono:'map',         etiqueta:'Distrito'  },
          { tab:'tareas',   icono:'list-checks', etiqueta:'Tareas'    },
        ]}] : []),
      ],
    });
    montarAvatar(CU);
    renderDistritoHeader();
    initScrollEffects();
    Perfil.configurar({ modo: 'supervision', resolver: personaDeDistrito, calendario: () => D?.calendario,
      // Desde el perfil de cualquier persona del distrito: asignar y revisar sus tareas.
      tareas: isSecretario() ? { yo: CU.id, esAdmin: false, personas: () => personasDelDistrito() } : null,
      acciones: isSecretario() ? [{ act: 'perfilNuevaTarea', etiqueta: 'Nueva tarea', icono: 'plus-circle' }] : [] });
    registrarBuscador();
    _uiMontada = true;
  }

  renderCalendario();
  renderLineaTiempo();
  await montarPerfil();
  updateTimestamp();

  // Enlace guardado a una pestaña interna del perfil: #perfil/criterios.
  const m = /^#perfil\/(\w+)/.exec(location.hash);
  if (m) { switchTab('perfil', null); Perfil.tab(m[1], document.getElementById('perfil-host')); }
}

/** Persona que ve el perfil propio: la sesión. */
async function _personaPropia() {
  let rol_nombre = '';
  try { rol_nombre = (await API.getRoles(false)).find(r => String(r.id) === String(CU.rol_id))?.nombre || ''; }
  catch { /* sin nombre de rol el perfil sigue: el v2 lo trae en su fila */ }
  return { id: CU.id, nombre: CU.name || CU.user, email: CU.email, avatar_url: CU.avatar_url,
           rol_nombre, distrito: CU.distrito, tipo_miembro: CU.tipo_miembro };
}

async function montarPerfil() {
  const host = document.getElementById('perfil-host'); if (!host) return;
  await Perfil.montar({
    el: host, persona: await _personaPropia(), modo: 'propio', periodoId: Store.periodoId(),
    onPeriodo: pe => cambiarPeriodo(pe, null, { desdePerfil: true }),
  });
}

/** Quién entra en «Asignar a»: las personas del distrito. */
const personasDelDistrito = () => (_contenido?.districtMembers || []).map(m => ({ id: m.id, nombre: m.nombre || m.email }));

/* ── BUSCADOR: personas del distrito y atajos ── */
function registrarBuscador() {
  Buscador.registrar(() => {
    const out = [];
    const per = Store.periodo();
    if (isSecretario()) {
      for (const m of (_contenido?.districtMembers || [])) {
        out.push({ grupo: 'Personas', icono: 'user-round', titulo: m.nombre || m.email, sub: m.roles?.nombre || '', ir: () => Perfil.abrir(m.id) });
      }
      if (esPeriodoV2(per)) {
        out.push({ grupo: 'Acciones', icono: 'plus-circle', titulo: 'Nueva tarea para el distrito', sub: per.pe,
          ir: () => Tareas.nueva({ periodoId: per.id, yo: CU.id, revisor: true, personas: personasDelDistrito(), onCambio: () => Store.invalidar('calendario') }) });
        out.push({ grupo: 'Acciones', icono: 'inbox', titulo: 'Revisar entregas del distrito', ir: () => switchTab('tareas', null) });
      }
    } else if (esPeriodoV2(per)) {
      out.push({ grupo: 'Acciones', icono: 'plus-circle', titulo: 'Nueva tarea por iniciativa propia', sub: per.pe,
        ir: () => Tareas.nueva({ periodoId: per.id, yo: CU.id, onCambio: () => Store.invalidar('calendario') }) });
    }
    return out;
  });
}

/** Resuelve a alguien del distrito para abrir su perfil en el panel lateral. */
function personaDeDistrito(id) {
  const m = (_contenido?.districtMembers || []).find(x => String(x.id) === String(id));
  if (!m) return null;
  return { id: m.id, nombre: m.nombre || m.email, email: m.email, avatar_url: m.avatar_url,
           rol_nombre: m.roles?.nombre || '', distrito: m.distrito, tipo_miembro: m.tipo_miembro };
}

/** Repinta solo lo que depende del período seleccionado. */
async function renderPeriodoActual() {
  renderRankingDistritos();
  await Promise.all([renderDistrito(), montarInicio()]);
}

/* ── INICIO: lo que toca ahora + pulso del distrito ─────────────────── */
async function montarInicio() {
  const host = document.getElementById('inicio-host'); if (!host) return;
  await Inicio.montar({
    el: host, persona: await _personaPropia(),
    extra: isSecretario() ? pintarPulsoDistrito : null,
  });
}

async function pintarPulsoDistrito(el) {
  if (!el) return;
  const miembros = _contenido?.districtMembers || [];
  const v2 = esPeriodoV2(Store.periodo());
  const evaluados = v2 ? (_contenido?.v2 || []).length : getDistritoRows().length;
  const t = await datosTareasDistrito();
  const porRevisar = t ? [...t.porRevisar.values()].reduce((a, b) => a + b, 0) : null;
  const vencidas = t ? [...t.resumen.values()].reduce((a, r) => a + (r.vencidas_abiertas || 0), 0) : null;
  const tile = (val, lbl, aviso) => `<div class="pf-tk${aviso ? ' pf-tk--aviso' : ''}"><div class="pf-tk-val">${escHtml(String(val))}</div><div class="pf-tk-lbl">${escHtml(lbl)}</div></div>`;
  el.innerHTML = `
    <section class="pf-card pf-card--ancha" aria-labelledby="pulso-h">
      <div class="pf-card-cab"><h3 class="pf-h" id="pulso-h">Tu distrito${getMyDistrito() ? ` <small>${escHtml(getMyDistrito())}</small>` : ''}</h3>
        <button type="button" class="pf-enlace" data-act="tab" data-arg="distrito">Ver personas<i data-lucide="arrow-right" aria-hidden="true"></i></button></div>
      <div class="pf-tks">
        ${tile(miembros.length, 'Personas')}
        ${tile(`${evaluados}/${miembros.length}`, 'Evaluadas este período')}
        ${porRevisar == null ? '' : tile(porRevisar, 'Entregas por revisar', porRevisar > 0)}
        ${vencidas == null ? '' : tile(vencidas, 'Tareas vencidas', vencidas > 0)}
      </div>
      ${t && (porRevisar > 0) ? `<p class="pf-nota"><button type="button" class="pf-enlace" data-act="tab" data-arg="tareas">Revisar las entregas<i data-lucide="arrow-right" aria-hidden="true"></i></button></p>` : ''}
    </section>`;
  animarEntrada(el);
}

/* ── TAREAS DEL DISTRITO (resumen por persona) ───────────────────────────
   Solo en períodos con la rúbrica por roles. Una consulta de resumen y una
   de tareas, ambas filtradas por RLS al distrito. */
let _tareasDistrito = null;

async function datosTareasDistrito() {
  const per = Store.periodo();
  if (!per || !esPeriodoV2(per) || !isSecretario()) return null;
  if (_tareasDistrito?.periodoId === per.id) return _tareasDistrito;
  const [res, lista] = await Promise.all([API.getResumenTareas(per.id), API.getTareas({ periodoId: per.id })]);
  if (!res.ok || !lista.ok) return null;
  const porRevisar = new Map();
  for (const t of lista.tareas) {
    // Una persona no revisa lo suyo: no cuenta como «por revisar» para el secretario.
    if (t.estado === 'entregada' && t.asignada_a !== CU.id) porRevisar.set(t.asignada_a, (porRevisar.get(t.asignada_a) || 0) + 1);
  }
  _tareasDistrito = { periodoId: per.id, resumen: new Map(Object.entries(res.porUsuario)), porRevisar };
  return _tareasDistrito;
}

/* ── HEADER DISTRITO ── */
function renderDistritoHeader() {
  const el = document.getElementById('distrito-header'); if (!el) return;
  const nombre = getMyDistrito();
  if (!nombre) {
    el.innerHTML = `<div class="no-data-msg" role="note"><div class="no-data-txt">No tienes un distrito asignado. Pídele a la coordinación que te asigne uno.</div></div>`;
    return;
  }
  el.innerHTML = `<h2 class="tab-title tab-title--mb">Distrito ${escHtml(nombre)}</h2>`;
}

/* ── CAMBIO DE PERÍODO ─────────────────────────────────────────────────── */
async function cambiarPeriodo(pe, btn, { desdePerfil = false } = {}) {
  if (!pe) return;
  mPE = _trabajosPE = pe;
  Store.setPeriodo(pe);
  if (btn) syncPEBar(btn.closest('.pe-row'), pe);
  syncAllPEButtons();
  if (!desdePerfil) Perfil.sincronizar(pe);
  renderLineaTiempo();

  const cuerpo = document.getElementById('distrito-members');
  if (cuerpo) cuerpo.innerHTML = esqueletoHTML();

  // Solo la fase 2, cancelando la petición anterior.
  if (!(await loadContenido())) return;
  await renderPeriodoActual();
  if (!Store.necesitaCarga('trabajos')) renderTrabajosTab();
  if (!Store.necesitaCarga('tareas')) renderTareasDistrito();
}

/* ── RANKING DE DISTRITOS (solo secretario) ── */
function renderRankingDistritos() {
  const el = document.getElementById('ranking-dist-body');
  if (!el) return;
  if (!_contenido) { renderCargando(el); return; }
  const pe = mPE;

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

  // Banner de posición
  const rc = myPos===1?'gold':myPos===2?'silver':myPos===3?'bronze':'';
  const bannerHtml = myDist ? `
    <div class="dist-rank-banner">
      <div class="dist-rank-banner-label">Mi posición en el ranking — ${escHtml(pe)}</div>
      <div class="dist-rank-banner-pos ${rc}">#${myPos}</div>
      <div class="dist-rank-banner-sub">de ${districts.length} distritos · ${myDist.total} pts</div>
    </div>` : `
    <div class="dist-rank-banner dist-rank-banner--warn">
      <div class="dist-rank-banner-label">Sin distrito asignado</div>
      <div class="dist-rank-banner-sub">La coordinación debe asignarte un distrito.</div>
    </div>`;

  const rows = districts.map((d, i) => {
    const pos   = i + 1;
    const posRc = pos===1?'gold':pos===2?'silver':pos===3?'bronze':'';
    const isMe  = d.distrito.toLowerCase() === myDistrito.toLowerCase();

    if (isMe) {
      const critBars = COMP.map(c => {
        const val = d[c.key] ?? 0;
        return `<div class="dm-crit-row">
          <span class="dm-crit-abbr" style="color:var(--criterio-txt)">${escHtml(c.abbr)}</span>
          <div class="dm-crit-track"><div class="dm-crit-fill" style="width:${(val/c.max)*100}%;background:var(--criterio)"></div></div>
          <span class="dm-crit-val" style="color:var(--criterio-txt)">${val}</span>
        </div>`;
      }).join('');
      return `<div class="dist-rk-card dist-rk-card--me">
        <div class="dist-rk-head">
          <div class="dist-rk-pos ${posRc}">#${pos}</div>
          <div class="dist-rk-info">
            <div class="dist-rk-name">${escHtml(d.distrito)} <span class="dm-you-tag">Mi distrito</span></div>
            <div class="dist-rk-sub">Puntaje total del período</div>
          </div>
          <div class="dist-rk-score-block">
            <div class="dist-rk-score" style="color:var(--criterio-txt)">${d.total}</div>
            <div class="dist-rk-max">pts</div>
          </div>
        </div>
        <div class="dm-crit-bars dist-rk-crit-section">${critBars}</div>
      </div>`;
    }
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
  }).join('');

  el.innerHTML = bannerHtml + `<div class="dist-rk-list">${rows}</div>`;
}

/* ── DISTRITO: SUBPESTAÑAS ────────────────────────────────────────────── */
let _distritoTab = 'miembros';

function pintarSegDistrito() {
  const host = document.getElementById('distrito-seg'); if (!host) return;
  host.innerHTML = segHTML([
    { k: 'miembros', etiqueta: 'Personas',               icono: 'users'  },
    { k: 'ranking',  etiqueta: 'Ranking de distritos',   icono: 'trophy' },
  ], _distritoTab, 'distritoTab', { etiqueta: 'Secciones del distrito', prefijo: 'dist' });
  renderIconos(host);
  document.getElementById('dist-panel-miembros').hidden = _distritoTab !== 'miembros';
  document.getElementById('dist-panel-ranking').hidden  = _distritoTab !== 'ranking';
}

function seleccionarDistritoTab(k) {
  _distritoTab = k === 'ranking' ? 'ranking' : 'miembros';
  pintarSegDistrito();
}

/* ── DISTRITO: PERSONAS ──────────────────────────────────────────────── */
async function renderDistrito() {
  if (!isSecretario()) return;
  pintarSegDistrito();
  renderCalificacionDistrito();
  const v2 = esPeriodoV2(Store.periodo());
  if (v2) renderDistritoV2Stats(); else renderDistStats();
  await renderRoster();
}

/* La rúbrica por roles trae las filas de resultados_periodo que la base deja
   ver a un secretario (su distrito); el percentil se calcula contra todos los
   pares del rol, también los de otros distritos. */
function renderDistritoV2Stats() {
  const stats = document.getElementById('dist-stats');
  const rows  = _contenido?.v2 || [];
  const miembros = getDistrictMembersList();
  const prom = rows.length ? rows.reduce((a, r) => a + (r.individual || 0), 0) / rows.length : null;
  const orden = [...rows].sort((a, b) => (b.general ?? -1) - (a.general ?? -1));
  const miPos = orden.findIndex(r => r.evaluado_id === CU.id) + 1;
  const mejor = orden[0];
  if (!stats) return;
  stats.innerHTML = [
    { lbl: 'Personas en el distrito', val: miembros.length, sub: `${rows.length} evaluadas`, col: '' },
    { lbl: 'Promedio individual', val: prom == null ? '—' : fmtV2(prom), sub: 'sobre 100', col: prom == null ? '' : scoreColorTxtV2(prom) },
    { lbl: 'Mi posición (general)', val: miPos ? '#' + miPos : '—', sub: rows.length ? `de ${rows.length} evaluadas` : 'Sin evaluar', col: 'var(--txt)' },
    { lbl: 'General más alto', val: mejor ? fmtV2(mejor.general) : '—', sub: mejor?.nombre || '—', col: mejor ? scoreColorTxtV2(mejor.general) : '' },
  ].map(c => `<div class="dist-scard"><div class="dist-scard-lbl">${escHtml(c.lbl)}</div><div class="dist-scard-val"${c.col ? ` style="color:${c.col}"` : ''}>${escHtml(String(c.val))}</div><div class="dist-scard-sub">${escHtml(String(c.sub))}</div></div>`).join('');
}

/* Calificación oficial del distrito desde CREATORS DISTRITOS - PEx */
function renderCalificacionDistrito() {
  const el = document.getElementById('dist-cal-body'); if (!el) return;
  const wrap = document.getElementById('dist-calificacion');
  if (!isSecretario()) { if (wrap) wrap.hidden = true; return; }
  if (wrap) wrap.hidden = false;
  const pe = mPE;
  const myDist = getMyDistrito();
  if (!myDist) {
    el.innerHTML = '<p class="pf-vacio">Sin distrito asignado.</p>';
    return;
  }
  renderCargando(el);
  API.getEvalDistritoByNombreAndPE(myDist, pe).then(ev => {
    if (!ev) {
      el.innerHTML = '<p class="pf-vacio">Sin calificación oficial para este período.</p>';
      return;
    }
    const s = calcDistScore(ev.puntajes);
    const critBars = DIST_CRITERIOS.map(c => {
      const val = parseJSON(ev.puntajes)[c.key] ?? 0;
      return `<div class="dist-cal-row">
        <span class="dist-cal-abbr" style="color:var(--criterio-txt)">${escHtml(c.abbr)}</span>
        <div class="dist-cal-track"><div class="dist-cal-fill" style="width:${(val/7)*100}%;background:var(--criterio)"></div></div>
        <span class="dist-cal-val" style="color:var(--criterio-txt)">${val}</span>
      </div>`;
    }).join('');
    el.innerHTML = `<div class="dist-cal-card">
      <div class="dist-cal-head">
        <div>
          <div class="pf-sub">Calificación oficial · Distrito ${escHtml(myDist)} · ${escHtml(pe)}</div>
          <div class="dist-cal-total" style="color:${distScoreColor(s)}">${s} <small>/ ${MAX_DIST_SEC} pts</small></div>
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

function renderDistStats() {
  const el = document.getElementById('dist-stats'); if (!el) return;
  const members = getDistrictMembersList(), myD = getMyDistrito();
  const rows = getDistritoRows();
  const totalMembers = members.length;
  if (!totalMembers) {
    el.innerHTML = `<div class="pf-vacio" style="grid-column:1/-1">No hay personas en <strong>${escHtml(myD || 'tu distrito')}</strong>.</div>`;
    return;
  }
  const evaluated = rows.length;
  const scores = rows.map(calcScore);
  const avg = evaluated ? (scores.reduce((a,b)=>a+b,0)/evaluated).toFixed(1) : '—';
  const myRow = rows.find(r => r.evaluado_id === CU.id), myS = myRow ? calcScore(myRow) : null;
  const myPos = myS !== null ? [...rows].sort((a,b) => calcScore(b)-calcScore(a)).findIndex(r => r.evaluado_id === CU.id)+1 : null;
  const maxS = scores.length ? Math.max(...scores) : 0, topR = scores.length ? rows.find(r => calcScore(r) === maxS) : null;
  el.innerHTML = [
    { lbl:'Personas en el distrito', val:totalMembers,           sub:`${evaluated} evaluadas · ${myD || mPE}`, col:'' },
    { lbl:'Promedio del distrito',   val:avg,                    sub:evaluated ? `/ ${MAX_TOTAL()} pts` : 'Sin evaluaciones', col:evaluated ? scoreColorTxt(parseFloat(avg)) : '' },
    { lbl:'Mi posición',             val:myPos ? `#${myPos}` : '—', sub:evaluated ? `de ${evaluated} evaluadas` : 'Sin evaluar', col:'var(--txt)' },
    { lbl:'Puntaje más alto',        val:scores.length ? maxS : '—', sub:topR?.nombre || '—', col:scores.length ? scoreColorTxt(maxS) : '' },
  ].map(s => `<div class="dist-scard"><div class="dist-scard-lbl">${escHtml(s.lbl)}</div><div class="dist-scard-val"${s.col ? ` style="color:${s.col}"` : ''}>${escHtml(String(s.val))}</div><div class="dist-scard-sub">${escHtml(String(s.sub))}</div></div>`).join('');
}

/**
 * Las personas del distrito como tarjetas que abren su perfil. Sirve a las
 * dos rúbricas: el puntaje de cada tarjeta es el de su período (sobre 100 con
 * la rúbrica por roles, sobre el máximo clásico en los anteriores).
 */
async function renderRoster() {
  const el = document.getElementById('distrito-members'); if (!el) return;
  const miembros = getDistrictMembersList();
  if (!miembros.length) { el.innerHTML = rosterHTML([], 'No hay personas registradas en tu distrito.'); return; }

  const v2 = esPeriodoV2(Store.periodo());
  const t = v2 ? await datosTareasDistrito() : null;
  const filas = _contenido?.v2 || [];
  const scoreRows = getDistritoRows();

  const personas = miembros.map(m => {
    const base = { id: m.id, nombre: m.nombre || m.email, avatar_url: m.avatar_url, rol: m.roles?.nombre || (m.tipo_miembro === 'secretario' ? 'Secretario' : 'Creator'),
                   soyYo: m.id === CU.id, chips: [], valor: null };
    if (v2) {
      const f = filas.find(r => r.evaluado_id === m.id);
      if (f) {
        base.rol = f.rol_nombre || base.rol;
        if (f.individual != null) Object.assign(base, { valor: f.individual, max: 100, color: scoreColorV2(f.individual), nivel: nivelV2(f.individual) });
        if (f.rol_pequeno) base.chips.push({ txt: 'Rol pequeño', icono: 'users' });
      }
      const r = t?.resumen.get(m.id), pr = t?.porRevisar.get(m.id) || 0;
      if (pr > 0) base.chips.push({ txt: `${pr} por revisar`, aviso: true, icono: 'inbox' });
      if (r?.vencidas_abiertas > 0) base.chips.push({ txt: `${r.vencidas_abiertas} vencida${r.vencidas_abiertas === 1 ? '' : 's'}`, aviso: true, icono: 'alarm-clock' });
    } else {
      const sr = scoreRows.find(r => r.evaluado_id === m.id);
      if (sr) { const s = calcScore(sr); Object.assign(base, { valor: s, max: MAX_TOTAL(), color: scoreColor(s), nivel: { key: scoreClass(s), label: scoreLabel(s) } }); }
      if ((sr?.ext || 0) > 0) base.chips.push({ txt: `Bono +${sr.ext}`, icono: 'star' });
    }
    return base;
  }).sort((a, b) => (b.valor ?? -1) - (a.valor ?? -1) || a.nombre.localeCompare(b.nombre, 'es'));

  el.innerHTML = rosterHTML(personas) + (v2 && filas.length ? `
    <details class="rubrica-details entregas-cal"><summary class="rubrica-summary">Ranking del distrito por roles</summary>
      <div class="rubrica-wrap">${rankingV2HTML(filas, { resaltarId: CU.id })}</div></details>` : '');
  animarEntrada(el);
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
    return `<div class="cal-card"><div class="cal-acc ${cAcc[c]||cAcc.rojo}"></div><div class="cal-body">
      <div class="cal-num">PERÍODO ${String(p.numero).padStart(2,'0')}</div><div class="cal-t ${cT[c]||cT.rojo}">${escHtml(p.titulo)}</div>
      ${rows.map(([l,v])=>`<div class="cal-r"><span class="cal-rl">${l}</span><span>${escHtml(v)}</span></div>`).join('')}
      <div class="cst ${es.cls}">${es.dot?'<span class="sdot"></span>':''}${es.txt}</div></div></div>`;
  }).join('');
}

/* ── ENTREGAS: LÍNEA DE TIEMPO ── */
function renderLineaTiempo() {
  const el = document.getElementById('linea-tiempo'); if (!el) return;
  const periodos = D?.periodos || [];
  if (!periodos.length) {
    el.innerHTML = '<div class="empty-box"><div class="empty-txt">No hay períodos disponibles.</div></div>';
    return;
  }
  el.innerHTML = lineaTiempoHTML(periodos, { peActual: mPE });
}

/* Los helpers viven ahora en core/render.js. */

/* ── TABS ── */
/* Se aceptan los nombres viejos por si queda algún enlace guardado. */
const _ALIAS_TAB = {
  miscore:'perfil', scores:'perfil', historial:'perfil', reportes:'perfil', rubrica:'perfil', evaluacion:'perfil',
  ranking:'distrito', periodos:'trabajos', cal:'calendario',
};
const _secTabParent = { inicio:'inicio', cuenta:'cuenta', perfil:'perfil', calendario:'calendario', distrito:'distrito', tareas:'tareas', trabajos:'trabajos' };

function switchTab(tab, btn) {
  const original = tab;
  tab = _ALIAS_TAB[tab] || tab;
  // El distrito y las tareas son solo del secretario.
  if ((tab === 'distrito' || tab === 'tareas') && !isSecretario()) tab = 'inicio';
  switchTabCore(tab, btn, { contentSelector: '.tab-content', parentMap: _secTabParent });

  // El Historial de antes es ahora la pestaña Evolución del perfil, y el
  // Ranking de distritos, una subpestaña de Distrito.
  if (tab === 'perfil' && (original === 'historial' || original === 'reportes')) Perfil.tab('evolucion', document.getElementById('perfil-host'));
  if (tab === 'distrito' && original === 'ranking') seleccionarDistritoTab('ranking');

  // Entregas reúne trabajos, fechas del período y calendario: es la
  // pestaña de "qué debo entregar y cuándo".
  if (tab === 'cuenta') Cuenta.montar(document.getElementById('cuenta-host'), CU);
  if (tab === 'calendario' && Store.necesitaCarga('calendario')) {
    Store.marcarCargado('calendario');
    Calendario.montar({ el: document.getElementById('calendario-host'), yo: CU.id, modo: isSecretario() ? 'secretario' : 'miembro', personas: personasDelDistrito() });
  }
  if (tab === 'trabajos') renderLineaTiempo();
  if (tab === 'trabajos' && Store.necesitaCarga('trabajos')) {
    Store.marcarCargado('trabajos');
    _trabajosPE = Store.periodoNombre();
    syncAllPEButtons();
    renderTrabajosTab();
  }
  if (tab === 'tareas' && Store.necesitaCarga('tareas')) {
    Store.marcarCargado('tareas');
    _trabajosPE = Store.periodoNombre();
    syncAllPEButtons();
    renderTareasDistrito();
  }
}

function switchTabMobile(tab, btn) { switchTabMobileCore(tab, btn, switchTab); }

function toggleMobGroup(header) { header.classList.toggle('open'); }
function logout(){Auth.logout();}

/* updateTimestamp, showToast, initScrollEffects → core/render.js */
function goTab(tab) { goTabCore(tab, switchTab); }

/* ── ENTREGAS: TRABAJOS Y TAREAS ── */
// null hasta que loadContexto() resuelva el período activo real.
let _trabajosPE = null, _trabajosLoaded = false;

function syncTrabajoPEBtns() { syncPEBar(document.getElementById('trabajos-pe-row'), _trabajosPE); }

function selectTrabajoPE(pe, btn) { cambiarPeriodo(pe, btn); }

/* Tareas del distrito: asigna y revisa a los miembros de SU distrito. La base
   rechaza cualquier otra cosa; aquí solo se ofrece lo que sí puede hacer. */
async function renderTareasDistrito() {
  const el = document.getElementById('tareas-lista'); if (!el) return;
  const per = Store.periodos().find(p => p.pe === _trabajosPE) || null;
  // Las tareas existen solo en los períodos nuevos (rúbrica por roles).
  if (!esPeriodoV2(per)) {
    el.innerHTML = '<div class="empty-box"><div class="empty-txt">Las tareas están disponibles en los períodos nuevos, con la rúbrica por roles. Este período conserva su forma de entrega original: elige uno más reciente.</div></div>';
    return;
  }
  const pid = per?.id ?? null;
  await Tareas.montar({
    id: 'sec-tareas', el, periodoId: pid, yo: CU.id, revisor: true,
    personas: (_contenido?.districtMembers || []).map(m => ({ id: m.id, nombre: m.nombre || m.email })),
    onNoDisponible: () => renderVacio(el, 'Las tareas aún no están activadas en la base de datos (migración 0016).'),
  });
}

/* Las tareas (migración 0016) sustituyen a «Registrar trabajo»; si la base aún
   no las tiene, se conserva el formulario anterior. */
async function renderTrabajosTab() {
  const el = document.getElementById('trabajos-body'); if (!el) return;
  const per = Store.periodos().find(p => p.pe === _trabajosPE) || null;
  // Los períodos anteriores a la rúbrica por roles siguen con «registrar trabajo».
  setEl('trabajos-titulo', esPeriodoV2(per) ? 'Mis tareas' : 'Mis trabajos');
  if (!esPeriodoV2(per)) return renderTrabajosLegacy();
  await Tareas.montar({
    id: 'mis-tareas', el, periodoId: per?.id ?? null, yo: CU.id,
    onNoDisponible: () => renderTrabajosLegacy(),
  });
}

async function renderTrabajosLegacy() {
  const el = document.getElementById('trabajos-body'); if (!el) return;
  renderCargando(el);
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
        <i data-lucide="plus-circle" class="tj-icon"></i> Registrar trabajo en ${escHtml(_trabajosPE)}
      </div>
      <input class="cfg-inp" id="tj-titulo" type="text" placeholder="Título del trabajo" style="width:100%;margin-bottom:8px">
      <textarea class="cfg-inp" id="tj-desc" placeholder="Describe la actividad realizada..." rows="3" style="width:100%;resize:vertical"></textarea>
      <button class="btn-save" style="margin-top:10px;width:100%;display:flex;align-items:center;justify-content:center;gap:7px" data-act="guardarTrabajo">
        <i data-lucide="send" style="width:14px;height:14px"></i> Agregar trabajo
      </button>
    </div>
    <div class="section-label" style="margin:20px 0 10px">
      <i data-lucide="list" style="width:12px;height:12px;vertical-align:-2px;margin-right:4px"></i>
      ${trabajos.length} trabajo${trabajos.length!==1?'s':''} en ${escHtml(_trabajosPE)}
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
           <div class="empty-txt">Sin trabajos en <strong>${escHtml(_trabajosPE)}</strong>.<br>Usa el formulario de arriba para agregar.</div>
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
