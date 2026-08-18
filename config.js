/**
 * EIGHT CREATORS LABs — Configuración Supabase
 * ─────────────────────────────────────────────
 * ¿Es seguro poner la anon key aquí si este archivo es público? SÍ.
 * La anon key solo identifica la app ante Supabase. Sin una sesión de
 * usuario válida el rol PostgreSQL es "anon" y las RLS policies bloquean
 * el 100 % de los datos. La service_role key (que bypassa RLS) NUNCA
 * va al frontend.
 *
 * Obtén estos valores en:
 *   Supabase Dashboard → Settings → API
 *   → "Project URL"  → SUPABASE_URL
 *   → "anon public"  → SUPABASE_ANON_KEY
 */
const SUPABASE_URL      = 'https://owfmorjlymoxqrzhadnf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_l6zMSRSW85gASQRgPd_rmw_p3oKJhsP';

/* ── HTML-escape helper — use on ALL user-supplied data before innerHTML ── */
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Log de depuración — activar con localStorage.setItem('ec-debug','1') ── */
function debug(...args) {
  try {
    if (localStorage.getItem('ec-debug') === '1') console.log(...args);
  } catch { /* localStorage bloqueado (modo privado / cookies off) */ }
}

/* ── Barra de períodos ─────────────────────────────────────────────────
 * Genera los botones desde los datos, nunca desde HTML fijo.
 *
 * Antes los botones PE1/PE2/PE3 estaban escritos a mano en el HTML y
 * syncAllPEButtons() leía el período del atributo onclick con /'(PE\d)'/.
 * Con PE4 activo no había botón que emparejar, así que ninguno quedaba
 * marcado y no se podía llegar al período en curso.
 *
 * Usa listeners reales (no onclick inline) para poder activar la CSP.
 * En la Fase 3 esto se muda a core/render.js.
 */
/* ══ DESPACHADOR DE ACCIONES ═══════════════════════════════════════════
 * Sustituye a los `onclick=` inline. Un `onclick` en el HTML es código
 * ejecutable dentro del marcado, así que una CSP con
 * `script-src 'self'` los bloquea todos: mientras existan, no se puede
 * activar la CSP, y sin CSP la defensa contra XSS depende solo de que
 * escHtml() no se olvide en ningún sitio.
 *
 * En vez de un listener por botón, uno solo delegado en `document`:
 * funciona también con el marcado que los portales generan por innerHTML,
 * que es donde viven 49 de los 161 handlers.
 *
 *   <button data-act="tab" data-arg="scores">
 *
 * `_fn` llama a una función global por nombre, contra una lista blanca:
 * `data-arg` viene del HTML, así que no puede ser un nombre arbitrario.
 */
const _ACCIONES_SIMPLES = new Set([
  'toggleTheme', 'logout', 'printAdminReport',
  'saveCal', 'saveRol', 'savePeriodo', 'saveCriterioEntry', 'saveRubricaEntry',
  'showCalModal', 'showRolModal', 'showPeriodoModal', 'showCriterioModal',
  'showRubricaModal', 'showAbrirGestionModal', 'confirmarAbrirGestion',
  'executeDeleteUser', 'sendResetCode', 'verifyAndResetPassword',
  // buscadores y selectores de admin.html (data-input / data-change)
  'renderEvalUserList', 'renderUsuarios', 'renderRoles', 'renderPeriodos',
  'renderCriterios', 'renderRubrica', 'renderCalendario',
  'buscarDistritos', 'onDistSelectChange', 'handleAvatarUpload',
  // selectores de la tabla de usuarios (llevaban onchange= inline)
  'onCambioDistritoUsuario', 'onCambioTipoUsuario',
  'onCambioRolUsuario', 'onCambioAdminUsuario',
  // selector de entrada del admin
  'entrarConSeleccion', 'entrarConPeriodoActivo', 'restablecerEntrada',
  'onCambioGestionEntrada',
]);

const ACCIONES = {
  /** Llama a una función global sin argumentos, si está en la lista blanca. */
  fn: (arg) => {
    if (!_ACCIONES_SIMPLES.has(arg)) { console.warn('[acciones] no permitida:', arg); return; }
    const f = window[arg];
    if (typeof f === 'function') f();
  },
  salir:            ()            => (typeof logout === 'function' ? logout() : Auth.logout()),
  tab:              (arg, el)     => switchTab(arg, el),
  tabSinBtn:        (arg)         => switchTab(arg, null),
  tabPrimero:       (arg)         => switchTab(arg, document.querySelector('#desktop-nav .tnav')),
  tabMovil:         (arg, el)     => switchTabMobile(arg, el),
  grupoMovil:       (arg, el)     => toggleMobGroup(el),
  cerrarModal:      (arg)         => closeModal(arg),
  /** Solo si el clic cae en el fondo del overlay, no en su contenido. */
  cerrarModalFondo: (arg, el, e)  => { if (e.target === el) closeModal(arg); },
  verPass:          (arg, el)     => togglePassField(el, arg),
  modoRubrica:      (arg, el)     => setRubricaMode(arg, el),
  mostrarReset:     ()            => showResetForm(),
  volverLogin:      ()            => backToLogin(),
  resetPaso1:       ()            => resetStep1(),

  /* ── Navegación: rail y barra inferior (core/rail.js) ── */
  railColapso:   ()    => alternarColapso(),
  masDestinos:   ()    => abrirHoja(),
  tabDesdeHoja:  (arg) => { cerrarHoja(); switchTab(arg, null); },

  /* ── Acciones del marcado generado por los portales ── */
  irTab:        (a)             => goTab(a),
  rankTab:      (a)             => switchRankTab(a),
  abrirCerrar:  (a)             => document.getElementById(a)?.classList.toggle('open'),
  elegirDistrito: (a)           => {
    const s = document.getElementById('dist-eval-select');
    if (s) { s.value = a; onDistSelectChange(); }
  },

  // Un solo argumento
  borrarUsuario:  (a) => confirmDeleteUser(a),
  borrarCal:      (a) => deleteCal(a),
  borrarCriterio: (a) => deleteCriterioEntry(_num(a)),
  borrarPeriodo:  (a) => deletePeriodo(a),
  borrarRol:      (a) => deleteRol(_num(a)),
  borrarRubrica:  (a) => deleteRubricaEntry(_num(a)),
  borrarTrabajo:  (a) => deleteTrabajo(a),
  evaluarUsuario: (a) => selectEvalUser(a),
  modalCal:       (a) => showCalModal(a),
  modalCriterio:  (a) => showCriterioModal(_num(a)),
  modalPeriodo:   (a) => showPeriodoModal(a),
  modalRol:       (a) => showRolModal(_num(a)),
  modalRubrica:   (a) => showRubricaModal(_num(a)),
  guardarTrabajo: ()  => saveTrabajo(),

  // Barras de período del admin: (id, botón)
  peDist:   (a, el) => selectDistPE(a, el),
  peEval:   (a, el) => selectEvalPE(a, el),
  peOv:     (a, el) => selectOvPE(a, el),
  peRpt:    (a, el) => selectRptPE(a, el),
  peUsers:  (a, el) => selectUsersPE(a, el),

  // Dos o tres argumentos: el segundo viaja en data-arg2
  bono:        (a, el) => setBono(_num(a), el),
  puntaje:     (a, el) => setScore(a, _num(el.dataset.arg2), el),
  puntajeDist: (a, el) => setDistScore(a, _num(el.dataset.arg2), el),
  guardarEval: (a, el) => saveEvaluacion(a, el.dataset.arg2),
  guardarDist: (a, el) => saveDistEval(a, el.dataset.arg2),
  participante:(a, el) => toggleParticipante(a, el.dataset.arg2 === 'true'),
  aprobarUser: (a, el) => updateUserAprobado(a, el.dataset.arg2 === 'true'),
};

/** Los ids de criterios, roles y rúbrica son enteros; data-* llega como texto. */
function _num(v) { const n = Number(v); return Number.isFinite(n) ? n : v; }

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const accion = ACCIONES[el.dataset.act];
  if (!accion) { console.warn('[acciones] desconocida:', el.dataset.act); return; }
  // Los <a href="#"> llevaban `return false` para no saltar al ancla.
  if (el.tagName === 'A') e.preventDefault();
  accion(el.dataset.arg, el, e);
});

/* Los `oninput=` y `onchange=` de los buscadores y selectores de admin.html
   sobrevivieron al barrido de `onclick`, y la CSP los bloquea igual. Van por
   `data-input` / `data-change` con la misma lista blanca que `data-act="fn"`,
   sin `closest`: el evento nace ya en el control. */
function _despacharPorNombre(nombre, el, e) {
  if (!nombre) return;
  if (!_ACCIONES_SIMPLES.has(nombre)) { console.warn('[acciones] no permitida:', nombre); return; }
  const f = window[nombre];
  if (typeof f === 'function') f(el, e);
}

document.addEventListener('input',  e => _despacharPorNombre(e.target?.dataset?.input,  e.target, e));
document.addEventListener('change', e => _despacharPorNombre(e.target?.dataset?.change, e.target, e));

/** Mes en castellano de un YYYY-MM-DD, o null. Sin desfase de zona horaria. */
function mesDe(iso) {
  if (!iso) return null;
  const [a, m, d] = String(iso).split('-').map(Number);
  if (!a || !m || !d) return null;
  const s = new Date(a, m - 1, d).toLocaleDateString('es-CL', { month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderPEBar(container, periodos, current, onSelect) {
  if (!container) return;

  if (!periodos || !periodos.length) {
    container.replaceChildren();
    const msg = document.createElement('span');
    msg.className = 'pe-bar-msg pe-bar-msg--error';
    msg.setAttribute('role', 'alert');
    msg.textContent = 'No se pudieron cargar los períodos. Recarga la página.';
    container.appendChild(msg);
    return;
  }

  container.replaceChildren(...periodos.map(p => {
    const activo = p.pe === current;
    const b = document.createElement('button');
    b.type      = 'button';
    b.className = 'pb' + (activo ? ' active' : '');
    // "PE1" no significa nada para alguien nuevo. Si el período tiene
    // fecha de inicio se añade el mes: "PE1 · Marzo". Mientras las fechas
    // sigan en NULL se muestra solo el código, sin inventar nada.
    b.textContent = p.pe + (mesDe(p.inicio) ? ' · ' + mesDe(p.inicio) : '');
    b.dataset.pe  = p.pe;
    b.setAttribute('aria-pressed', String(activo));
    if (p.nombre && p.nombre !== p.pe) b.title = p.nombre;
    b.addEventListener('click', () => onSelect(p.pe, b));
    return b;
  }));
}

/** Marca cuál botón de una barra está activo, sin volver a construirla. */
function syncPEBar(container, current) {
  if (!container) return;
  container.querySelectorAll('.pb').forEach(b => {
    const activo = b.dataset.pe === current;
    b.classList.toggle('active', activo);
    b.setAttribute('aria-pressed', String(activo));
  });
}

/* ── Lucide icon helper — returns a <i data-lucide> tag that lucide.createIcons() renders ── */
function renderLucideIcon(name, cls) {
  return '<i data-lucide="' + name + '"' + (cls ? ' class="' + cls + '"' : '') + '></i>';
}

const _ICON_MAP = {
  score:'bar-chart-2', trophy:'trophy', map:'map', users:'users',
  clipboard:'clipboard-list', calendar:'calendar', search:'search', ruler:'ruler',
  star:'star', starLg:'star', award:'award', activity:'activity', zap:'zap',
  dashboard:'layout-dashboard', msg:'message-square', lock:'lock', user:'user',
  trending:'trending-up', settings:'settings', plus:'plus', trash:'trash-2',
  edit:'pencil', check:'check', logOut:'log-out',
};

const ICONS = new Proxy({}, {
  get(_, key) { return renderLucideIcon(_ICON_MAP[key] || key); }
});

/* Auto-render Lucide icons when new data-lucide elements appear in the DOM */
/**
 * Renderiza los iconos Lucide de un contenedor concreto.
 *
 * Antes esto era un MutationObserver sobre `documentElement` con
 * `subtree: true`: cada `innerHTML` masivo —y los portales hacen muchos—
 * disparaba un barrido de iconos del DOM completo, aunque los nodos
 * añadidos no tuvieran ni un `data-lucide`.
 *
 * Ahora la llamada es explícita y acotada al nodo recién pintado. Si se
 * omite el argumento recorre el documento, que es lo que hace falta una
 * sola vez al arrancar.
 */
function renderIconos(contenedor) {
  if (typeof lucide === 'undefined') return;
  try {
    if (contenedor && contenedor.nodeType === 1) lucide.createIcons({ nodes: [contenedor] });
    else lucide.createIcons();
  } catch (e) { debug('[iconos]', e); }
}

// Pasada inicial: el marcado estático de la página.
document.addEventListener('DOMContentLoaded', function () { renderIconos(); });
