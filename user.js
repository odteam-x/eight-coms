/**
 * EIGHT CREATORS LABs — Lógica Vista de Miembro
 *
 * Tres destinos: Inicio, Mi perfil y Entregas.
 *   · Inicio     → core/inicio.js: qué toca ahora (tareas, próximas fechas, mi evaluación).
 *   · Mi perfil  → core/perfil.js (score, criterios, tareas y evolución). Absorbe
 *                  lo que eran «Mi Score» e «Historial».
 *   · Entregas   → tareas, fechas del período y calendario.
 */
'use strict';

let CU = null, D = null, mPE = null, _lastUpdated = null, _peInited = false;

/* CRITERIOS_DEFAULT eliminado: si la consulta de criterios falla, la vista
   debe mostrar un error, no siete criterios inventados que parecen reales.
   getCriterios/getMaxScore/MAX_TOTAL viven en core/render.js y leen Store. */

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', async () => {
  CU = await Auth.requireRole('miembro');
  if (!CU) return;

  // Con el contexto (perfil, criterios, períodos) ya se puede pintar todo:
  // el perfil pide por sí mismo lo que necesita de cada período.
  if (await loadContexto()) await initUI();
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
    await initUI();
    if (!Store.necesitaCarga('trabajos')) renderTrabajosTab();
  });
}

/* ── CONTEXTO (crítico, paralelo) ── */
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

/** Estado de error visible. Delega en renderError() de core/render.js: el
    mensaje al usuario y la ocultación del detalle técnico se deciden allí. */
function mostrarErrorCarga(msg) {
  renderError(document.getElementById('perfil-host'), msg, () => location.reload());
}

/* ── UI ──────────────────────────────────────────────────────────────────
   initUI() monta lo que no cambia una sola vez y vuelve a pintar el perfil
   cuando cambian los datos (revalidación). */
let _uiMontada = false;

async function initUI() {
  if (!CU) return;

  if (!_uiMontada) {
    initNav({
      marca: 'EIGHT CREATORS',
      activo: 'inicio', calTab: 'calendario',
      pie: { nombre: CU.name || CU.user, badge: 'Creator' },
      grupos: [{ items: [
        { tab:'inicio',   icono:'house',       etiqueta:'Inicio'    },
        { tab:'perfil',   icono:'user-round',  etiqueta:'Mi perfil' },
        { tab:'calendario', icono:'calendar',  etiqueta:'Calendario' },
        { tab:'trabajos', icono:'folder-open', etiqueta:'Entregas'  },
      ]}],
    });
    // montarAvatar() de core/render.js: pinta la foto si la hay, las
    // iniciales si no, y engancha el selector de archivo.
    montarAvatar(CU);
    initScrollEffects();
    registrarBuscador();
    _uiMontada = true;
  }

  buildPEBars();
  renderCalendario();
  renderLineaTiempo();
  actualizarRailProximo();
  await Promise.all([montarInicio(), montarPerfil()]);
  updateTimestamp();

  // Enlace guardado a una pestaña interna del perfil: #perfil/criterios.
  const m = /^#perfil\/(\w+)/.exec(location.hash);
  if (m) { switchTab('perfil', null); Perfil.tab(m[1], document.getElementById('perfil-host')); }
}

/** Persona que ve el perfil: la propia sesión. */
async function _personaPropia() {
  let rol_nombre = '';
  try { rol_nombre = (await API.getRoles(false)).find(r => String(r.id) === String(CU.rol_id))?.nombre || ''; }
  catch { /* sin nombre de rol el perfil sigue: el v2 lo trae en su fila */ }
  return { id: CU.id, nombre: CU.name || CU.user, email: CU.email, avatar_url: CU.avatar_url,
           rol_nombre, distrito: CU.distrito, tipo_miembro: CU.tipo_miembro };
}

/** Inicio: lo que toca ahora. Mismo módulo que el secretario (sin su bloque de distrito). */
async function montarInicio() {
  const host = document.getElementById('inicio-host'); if (!host) return;
  await Inicio.montar({ el: host, persona: await _personaPropia() });
}

async function montarPerfil() {
  const host = document.getElementById('perfil-host'); if (!host) return;
  Perfil.configurar({ calendario: () => D?.calendario });
  await Perfil.montar({
    el: host, persona: await _personaPropia(), modo: 'propio', periodoId: Store.periodoId(),
    rubricaLegacy: renderRubricaLegacy,
    // Una sola barra de período gobierna la página: Entregas sigue al perfil.
    onPeriodo: pe => {
      mPE = _trabajosPE = pe;
      Store.setPeriodo(pe);
      syncPEBar(document.getElementById('trabajos-pe-row'), pe);
      renderLineaTiempo();
      if (!Store.necesitaCarga('trabajos')) renderTrabajosTab();
    },
  });
}

/* ── RÚBRICA CLÁSICA ─────────────────────────────────────────────────────
   Referencia de «cómo se califica» de los períodos anteriores a la rúbrica
   por roles. La pinta el perfil dentro de su pestaña Criterios. */
function renderRubricaLegacy(el) {
  if (!el) return;
  const rubrica   = D?.rubrica || [];
  const criterios = getCriterios();
  if (!rubrica.length) { el.innerHTML = `<div class="empty-box"><div class="empty-icon">${ICONS.clipboard}</div><div class="empty-txt">Rúbrica no disponible.</div></div>`; return; }
  const levels = [{n:4,lbl:'Excelente',color:'var(--sex-txt)'},{n:3,lbl:'Bueno',color:'var(--sbu-txt)'},{n:2,lbl:'En Proceso',color:'var(--spr-txt)'},{n:1,lbl:'Bajo',color:'var(--sba-txt)'}];
  const lk = {4:'nivel4',3:'nivel3',2:'nivel2',1:'nivel1'};
  el.innerHTML = rubrica.map((r,i) => {
    const c = criterios[i] || {}, color = 'var(--criterio-txt)';
    return `
      <div class="rubrica-card" id="rc-${i}">
        <div class="rubrica-card-head" data-act="abrirCerrar" data-arg="rc-${i}">
          <div class="rubrica-dot" style="background:var(--criterio)"></div>
          <div class="rubrica-title" style="color:${color}">${escHtml(r.criterio)}</div>
          <span class="rubrica-chev"><i data-lucide="chevron-down"></i></span>
        </div>
        <div class="rubrica-body">
          <div class="rubrica-levels">
            ${levels.map(l=>`<div class="rlevel"><div class="rlevel-badge" style="color:${escHtml(l.color)}">${l.n}</div><div class="rlevel-lbl" style="color:${escHtml(l.color)}">${l.lbl}</div><div class="rlevel-desc">${escHtml(r[lk[l.n]]||'—')}</div></div>`).join('')}
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ── BARRA DE PERÍODOS DE ENTREGAS ── */
function buildPEBars() {
  renderPEBar(document.getElementById('trabajos-pe-row'), D?.periodos || [], _trabajosPE, selectTrabajoPE);
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
          ${rows.map(([l,v])=>`<div class="cal-r"><span class="cal-rl">${l}</span><span>${escHtml(v)}</span></div>`).join('')}
          <div class="cst ${es.cls}">${es.dot?'<span class="sdot"></span>':''}${es.txt}</div>
        </div>
      </div>`;
  }).join('');
}

/* Los helpers (calcScore, scoreColor/Label/Class, initials, setEl, pad,
   showToast, timeAgo...) viven ahora en core/render.js. */

/* ── TABS ──────────────────────────────────────────────────────────────
 * Dos destinos. «Mi Score» e «Historial» se fundieron en Mi perfil
 * (Resumen, Criterios, Tareas, Evolución); «Períodos» y «Calendario» son las
 * fechas de cada PE y viven en Entregas, donde se pregunta «qué debo
 * entregar y cuándo». La rúbrica es una referencia dentro de Criterios.
 *
 * Se aceptan los nombres viejos por si queda algún enlace guardado.
 */
const _ALIAS_TAB = { scores:'perfil', historial:'perfil', reportes:'perfil', rubrica:'perfil', periodos:'trabajos', cal:'calendario' };
const _userTabParent = { inicio:'inicio', perfil:'perfil', calendario:'calendario', trabajos:'trabajos', cuenta:'cuenta' };

function switchTab(tab, btn) {
  const original = tab;
  tab = _ALIAS_TAB[tab] || tab;
  switchTabCore(tab, btn, { contentSelector: '.tab-content', parentMap: _userTabParent });

  // El Historial de antes es ahora la pestaña Evolución del perfil.
  if (tab === 'perfil' && (original === 'historial' || original === 'reportes')) {
    Perfil.tab('evolucion', document.getElementById('perfil-host'));
  }

  if (tab === 'cuenta') Cuenta.montar(document.getElementById('cuenta-host'), CU);
  if (tab === 'calendario' && Store.necesitaCarga('calendario')) {
    Store.marcarCargado('calendario');
    Calendario.montar({ el: document.getElementById('calendario-host'), yo: CU.id, modo: 'miembro' });
  }
  // Entregas reúne trabajos, fechas del período y calendario: es la
  // pestaña de "qué debo entregar y cuándo".
  if (tab === 'trabajos') renderLineaTiempo();
  if (tab === 'trabajos' && Store.necesitaCarga('trabajos')) {
    Store.marcarCargado('trabajos');
    _trabajosPE = Store.periodoNombre();
    syncTrabajoPEBtns();
    renderTrabajosTab();
  }
}

function switchTabMobile(tab, btn) { switchTabMobileCore(tab, btn, switchTab); }

function toggleMobGroup(header) { header.classList.toggle('open'); }

/* ── BUSCADOR: atajos de este portal ── */
function registrarBuscador() {
  Buscador.registrar(() => {
    const per = Store.periodo();
    return esPeriodoV2(per) ? [{ grupo: 'Acciones', icono: 'plus-circle', titulo: 'Nueva tarea por iniciativa propia', sub: per.pe,
      ir: () => Tareas.nueva({ periodoId: per.id, yo: CU.id, onCambio: () => { Store.invalidar('calendario'); if (!Store.necesitaCarga('trabajos')) renderTrabajosTab(); } }) }] : [];
  });
}

/* ── LOGOUT ── */
function logout() { Auth.logout(); }

/* updateTimestamp, showToast, initScrollEffects → core/render.js */
function goTab(tab) { goTabCore(tab, switchTab); }

/* ── ENTREGAS: LÍNEA DE TIEMPO ──
   Las fechas de cada período en un solo eje, con «hoy» marcado. Sustituye a
   «Fechas del período», que repetía los mismos datos en otra forma. */
function renderLineaTiempo() {
  const el = document.getElementById('linea-tiempo'); if (!el) return;
  const periodos = D?.periodos || [];
  if (!periodos.length) {
    el.innerHTML = '<div class="empty-box"><div class="empty-txt">No hay períodos disponibles.</div></div>';
    return;
  }
  el.innerHTML = lineaTiempoHTML(periodos, { peActual: mPE });
}

/* ── ENTREGAS: TRABAJOS Y TAREAS ── */
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

/* Las tareas (migración 0016) sustituyen a «Registrar trabajo». Si la base aún
   no las tiene, se conserva el formulario anterior para no dejar la pestaña
   sin función hasta que se aplique el SQL. */
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
      <input class="cfg-inp" id="tj-titulo" type="text" placeholder="Título del trabajo (ej: Video campaña agosto)" style="width:100%;margin-bottom:8px">
      <textarea class="cfg-inp" id="tj-desc" placeholder="Describe la actividad realizada..." rows="3" style="width:100%;resize:vertical"></textarea>
      <button class="btn-save" style="margin-top:10px;width:100%;display:flex;align-items:center;justify-content:center;gap:7px" data-act="guardarTrabajo">
        <i data-lucide="send" style="width:14px;height:14px"></i> Agregar trabajo
      </button>
    </div>
    <div class="section-label" style="margin:20px 0 10px">
      <i data-lucide="list" style="width:12px;height:12px;vertical-align:-2px;margin-right:4px"></i>
      ${trabajos.length} trabajo${trabajos.length!==1?'s':''} registrado${trabajos.length!==1?'s':''} · ${escHtml(_trabajosPE)}
    </div>
    ${trabajos.length
      ? `<div class="trabajos-list">${trabajos.map(t=>`
          <div class="trabajo-item">
            <div class="trabajo-item-head">
              <div class="trabajo-titulo">${t.titulo?escHtml(t.titulo):'<span class="tj-notitle">Sin título</span>'}</div>
              <button class="btn-icon-del" data-act="borrarTrabajo" data-arg="${t.id}" title="Eliminar" aria-label="Eliminar trabajo">
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
  showToast('Trabajo registrado','ok');
  await renderTrabajosTab();
}

async function deleteTrabajo(id) {
  if (!confirm('¿Eliminar este trabajo?')) return;
  const res = await API.deleteTrabajo(id);
  if (!res.ok) { showToast('Error al eliminar','error'); return; }
  showToast('Trabajo eliminado','ok');
  await renderTrabajosTab();
}
