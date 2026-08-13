'use strict';
/**
 * EIGHT CREATORS LABs — Helpers compartidos de presentación (Fase 3A)
 * ───────────────────────────────────────────────────────────────────
 * Estas funciones estaban copiadas en user.js, secretario.js y admin.js.
 * No eran copias exactas: habían divergido, y una divergencia era un bug
 * visible (ver NIVELES).
 *
 * Se definen como globales a propósito: los tres portales son scripts
 * clásicos sin bundler y las llaman por nombre suelto. Así la extracción no
 * obliga a reescribir cientos de llamadas.
 *
 * Depende de: core/store.js (getCriterios) y config.js (escHtml).
 */


/* ══ NIVELES DE DESEMPEÑO ══════════════════════════════════════════════
 * ÚNICA fuente de verdad de los umbrales. Antes había tres tablas sueltas:
 *
 *   scoreColor / scoreLabel  →  26/20/11  en los tres archivos
 *   scoreClass               →  24/18/10  en user.js y admin.js
 *                            →  26/20/11  en secretario.js
 *
 * Resultado: un miembro con 25 puntos veía en user.html la etiqueta "Bueno"
 * dentro de una insignia con la clase `sex`, que es la de "Excelente". El
 * texto y el color se contradecían. En secretario.html salía coherente.
 *
 * Umbral acordado: 26/20/11, que es lo que la etiqueta y el color ya
 * mostraban a los usuarios. Solo cambia el color de la insignia en 24-25;
 * ninguna calificación mostrada se mueve.
 */
const NIVELES = [
  { min: 26,        key: 'sex', label: 'Excelente',  color: 'var(--sex)' },
  { min: 20,        key: 'sbu', label: 'Bueno',      color: 'var(--sbu)' },
  { min: 11,        key: 'spr', label: 'En Proceso', color: 'var(--spr)' },
  { min: -Infinity, key: 'sba', label: 'Bajo',       color: 'var(--sba)' },
];

const nivelDe    = s => NIVELES.find(n => Number(s) >= n.min) || NIVELES[NIVELES.length - 1];
const scoreColor = s => nivelDe(s).color;
const scoreLabel = s => nivelDe(s).label;
const scoreClass = s => nivelDe(s).key;


/* ══ CRITERIOS ═════════════════════════════════════════════════════════
 * SIN fallback a una lista por defecto. Antes, si la consulta de criterios
 * fallaba, el usuario veía siete criterios plausibles que no eran los
 * reales y nada indicaba el fallo. Ahora devuelve [] y la vista debe
 * mostrar un error — fallar visible es mejor que mentir.
 */
const getCriterios = () => Store.criterios();

/**
 * Suma de los máximos reales de cada criterio, no `nCriterios * 4`.
 * `criterios.max` es editable por el admin: con el 4 fijo, subirlo a 5
 * hacía que el total mostrado y la longitud de las barras mintieran.
 */
const getMaxScore = () => getCriterios().reduce((s, c) => s + maxDe(c), 0);
const MAX_TOTAL   = () => getMaxScore() + 2;            // +2 de bono

/** Máximo de un criterio, con 4 como valor por defecto sensato. */
/**
 * Color de la base apto para un atributo style.
 *
 * escHtml() escapa comillas pero NO el punto y coma, así que un valor como
 * `red;background:url(x)` inyecta declaraciones extra en el mismo atributo.
 * Solo se admite notación hexadecimal; cualquier otra cosa cae al token.
 */
const colorSeguro = v => (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || '').trim())
  ? String(v).trim() : 'var(--criterio)');

const maxDe = c => (Number(c?.max) > 0 ? Number(c.max) : 4);

/** Porcentaje de relleno de una barra, acotado a 0–100. */
const pctBarra = (val, c) => Math.max(0, Math.min(100, (Number(val) || 0) / maxDe(c) * 100));

/** ¿Hay criterios utilizables? Úsalo antes de pintar cualquier puntaje. */
const hayCriterios = () => getCriterios().length > 0;


/* ══ CÁLCULO DE PUNTAJE ════════════════════════════════════════════════ */

/**
 * Fila del portal. Los puntajes van ANIDADOS en `row.puntajes`.
 *
 * Antes se esparcían al nivel de la fila junto a `nombre`, `distrito` y
 * `ext`. Como los criterios los crea el admin desde un formulario libre,
 * un criterio llamado `nombre` habría sobrescrito el nombre del usuario en
 * silencio.
 */
const puntajeDe = (row, key) => Number(row?.puntajes?.[key]) || 0;

const calcScore = row =>
  getCriterios().reduce((s, c) => s + puntajeDe(row, c.key), 0) + (Number(row?.ext) || 0);

/** Forma del admin: objeto `puntajes` (o su JSON) + bono aparte. */
const calcScorePuntajes = (puntajes, bono) =>
  Object.values(parseJSON(puntajes)).reduce((s, v) => s + (Number(v) || 0), 0) + (Number(bono) || 0);


/* ══ GESTIONES ═════════════════════════════════════════════════════════
 * Lo pasado se lee siempre, se escribe nunca. Cuando la gestión que se está
 * viendo está archivada, se muestra un banner y se ocultan los controles de
 * escritura, que además la base rechaza vía gestion_escribible().
 */
function renderBannerSoloLectura(gestion) {
  const previo = document.getElementById('banner-solo-lectura');
  if (previo) previo.remove();
  if (!gestion?.archivada) {
    document.body.classList.remove('gestion-archivada');
    return;
  }

  document.body.classList.add('gestion-archivada');
  const b = document.createElement('div');
  b.id = 'banner-solo-lectura';
  b.className = 'banner-readonly';
  b.setAttribute('role', 'status');
  b.textContent = `Estás viendo la gestión ${gestion.nombre}, archivada. Solo lectura: no se puede modificar nada.`;
  document.body.insertBefore(b, document.body.firstChild);
}

/**
 * Selector de gestión en el topbar. Solo aparece si hay más de una: con una
 * sola gestión no significa nada y ocupa sitio.
 */
function renderSelectorGestion(contenedorId, gestiones, actualId, onSelect) {
  const host = document.getElementById(contenedorId);
  if (!host) return;
  host.replaceChildren();
  if (!gestiones || gestiones.length < 2) { host.hidden = true; return; }

  host.hidden = false;
  const sel = document.createElement('select');
  sel.className = 'gestion-select';
  sel.setAttribute('aria-label', 'Gestión');
  for (const g of gestiones) {
    const o = document.createElement('option');
    o.value = String(g.id);
    o.textContent = g.nombre + (g.activa ? ' (actual)' : g.archivada ? ' (archivada)' : '');
    if (String(g.id) === String(actualId)) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onSelect(sel.value));
  host.appendChild(sel);
}


/* ══ ESTADO DE UN PERÍODO ══════════════════════════════════════════════
 * Tres estados, no dos. Antes todo período no activo se marcaba "Cerrado",
 * incluidos los que aún no han empezado.
 *
 * Se deriva de las fechas; el flag `activo` manda cuando las hay o no.
 * OJO: hoy las 4 fechas están en NULL en la base, así que sin fechas solo
 * se puede distinguir por `activo`. En cuanto el admin las rellene (modal
 * de períodos), los futuros pasan a "Pendiente" correctamente.
 */
function estadoPeriodo(p) {
  if (!p) return { key: 'cerrado', label: 'Cerrado' };
  if (p.activo) return { key: 'encurso', label: 'En curso' };

  const hoy    = new Date().toISOString().slice(0, 10);
  const inicio = p.inicio || null;
  const fin    = p.jornada || p.entrega || p.finTrabajo || null;

  if (inicio && hoy < inicio) return { key: 'pendiente', label: 'Pendiente' };
  if (inicio && !fin && hoy >= inicio) return { key: 'encurso', label: 'En curso' };
  if (fin && hoy <= fin && (!inicio || hoy >= inicio)) return { key: 'encurso', label: 'En curso' };
  return { key: 'cerrado', label: 'Cerrado' };
}

/** Fecha en la que el dato de un período debería estar disponible. */
function fechaDisponibilidad(p, calendario) {
  if (p?.entrega) return p.entrega;
  const evt = (calendario || []).find(c => c.titulo && p?.pe && c.titulo.includes(p.pe));
  return evt?.entrega || p?.jornada || null;
}

/** "16 de marzo" a partir de un YYYY-MM-DD, sin desfase de zona horaria. */
function fechaLarga(iso) {
  if (!iso) return null;
  const [a, m, d] = String(iso).split('-').map(Number);
  if (!a || !m || !d) return null;
  return new Date(a, m - 1, d).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' });
}


/* ══ UTILIDADES ════════════════════════════════════════════════════════ */

function parseJSON(v) {
  if (!v) return {};
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return {}; } }
  return v;
}

const initials = n =>
  String(n || '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';

const setEl = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

const pad = n => String(n).padStart(2, '0');

/** "hace 5 min" / "hace 2 h" / "hace 3 d". */
function timeAgo(fecha) {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (isNaN(d)) return '—';
  const seg = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seg < 60)    return 'hace un momento';
  if (seg < 3600)  return `hace ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`;
  return `hace ${Math.floor(seg / 86400)} d`;
}


/* ══ TOAST Y MODALES ═══════════════════════════════════════════════════ */

function showToast(msg, type = '') {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg;
  t.className = `toast${type ? ' toast--' + type : ''} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 3000);
}

/* ══ MODALES ═══════════════════════════════════════════════════════════
 * Antes solo cerraban con la X: no había ni una sola referencia a
 * `Escape` en todo el JS, ni role="dialog", ni trampa de foco. Con el
 * teclado se podía tabular fuera del modal y quedar operando el fondo
 * mientras el overlay seguía encima.
 */
let _modalAbierto  = null;
let _focoPrevio    = null;

const _FOCUSABLES = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;

  _focoPrevio = document.activeElement;
  m.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-modal', 'true');
  const titulo = m.querySelector('.modal-title');
  if (titulo) {
    if (!titulo.id) titulo.id = id + '-titulo';
    m.setAttribute('aria-labelledby', titulo.id);
  }

  _modalAbierto = m;
  // Foco al primer control, para no dejarlo en el fondo.
  const primero = m.querySelector(_FOCUSABLES);
  (primero || m).focus?.();
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.style.display = 'none';
  document.body.style.overflow = '';
  if (_modalAbierto === m) _modalAbierto = null;

  // Devolver el foco a donde estaba antes de abrir.
  if (_focoPrevio?.isConnected) _focoPrevio.focus?.();
  _focoPrevio = null;
}

/* Escape cierra; Tab queda atrapado dentro del modal. */
document.addEventListener('keydown', e => {
  if (!_modalAbierto) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    closeModal(_modalAbierto.id);
    return;
  }

  if (e.key !== 'Tab') return;
  const f = [..._modalAbierto.querySelectorAll(_FOCUSABLES)]
    .filter(el => el.offsetParent !== null);
  if (!f.length) return;

  const primero = f[0], ultimo = f[f.length - 1];
  if (e.shiftKey && document.activeElement === primero) {
    e.preventDefault(); ultimo.focus();
  } else if (!e.shiftKey && document.activeElement === ultimo) {
    e.preventDefault(); primero.focus();
  }
});


/* ══ PESTAÑAS ══════════════════════════════════════════════════════════
 * El núcleo es común; cada portal aporta su selector de contenido, su mapa
 * de pestaña→padre y sus hooks de carga.
 */
function switchTabCore(tab, btn, { contentSelector = '.tab-content', parentMap = {} } = {}) {
  document.querySelectorAll(contentSelector).forEach(t => {
    t.classList.remove('active');
    // El panel oculto sale del árbol de accesibilidad; si no, un lector de
    // pantalla recorre el contenido de las seis pestañas como si estuviera
    // todo visible a la vez.
    t.setAttribute('role', 'tabpanel');
    t.setAttribute('aria-hidden', 'true');
  });
  const panel = document.getElementById(`tab-${tab}`);
  if (panel) { panel.classList.add('active'); panel.setAttribute('aria-hidden', 'false'); }

  document.querySelectorAll('#desktop-nav .tnav').forEach(b => b.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else {
    const parent = parentMap[tab] || tab;
    document.querySelectorAll('#desktop-nav .tnav-group > .tnav, #desktop-nav > .tnav').forEach(b => {
      // La pestaña de cada botón sale de data-arg. Antes se leía del
      // atributo onclick con includes("'tab'"), que además de frágil
      // impedía activar la CSP.
      if (b.dataset.arg === parent) b.classList.add('active');
    });
  }

  // La navegación se comporta como tabs pero no lo declaraba: cero
  // role="tab" y cero aria-selected en todo el HTML.
  const nav = document.getElementById('desktop-nav');
  if (nav) {
    nav.setAttribute('role', 'tablist');
    nav.querySelectorAll('.tnav').forEach(b => {
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(b.classList.contains('active')));
    });
  }

  // Rail y barra inferior comparten el destino activo (core/rail.js).
  if (typeof marcarActivo === 'function') marcarActivo(tab);
}

function switchTabMobileCore(tab, btn, switchFn) {
  switchFn(tab, null);
  document.querySelectorAll('.mobile-menu .mobile-nav-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  if (typeof closeMenu === 'function') closeMenu();
}

/** Salta a una pestaña buscando su botón visible en el nav de escritorio. */
function goTabCore(tab, switchFn) {
  const btn = [...document.querySelectorAll('#desktop-nav .tnav')]
    .find(b => b.dataset.arg === tab && b.style.display !== 'none');
  switchFn(tab, btn);
}


/* ══ SCROLL Y TIMESTAMP ════════════════════════════════════════════════ */

function initScrollEffects({ backTop = true } = {}) {
  const topbar  = document.getElementById('topbar');
  const backTopEl = backTop ? document.getElementById('back-top') : null;
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      topbar?.classList.toggle('scrolled', y > 10);
      backTopEl?.classList.toggle('visible', y > 300);
      ticking = false;
    });
  }, { passive: true });
}

/** Pinta la hora de última actualización en las insignias del topbar. */
function updateTimestamp(fecha) {
  const t = fecha || Store.lastUpdated();
  if (!t) return;
  const txt = `✓ ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  ['ts-badge', 'ts-badge-mob'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    el.textContent = txt;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1000);
  });
}


/* ══ ESTADOS DE VISTA ══════════════════════════════════════════════════
 * Tres estados distinguibles. Antes vacío, error y cargando se veían igual,
 * y por eso un fallo de RLS aparecía como "Aún no hay evaluación".
 * (El estado vacío con fecha de disponibilidad llega en la Fase 3B.)
 */
function renderCargando(cont) {
  if (!cont) return;
  cont.replaceChildren();
  const box = document.createElement('div');
  box.className = 'loading-box';
  box.setAttribute('aria-busy', 'true');
  const s = document.createElement('span');
  s.className = 'spin';
  box.appendChild(s);
  cont.appendChild(box);
}

/**
 * Estado de error visible.
 *
 * `msg` es el mensaje CRUDO de PostgREST, y a un miembro no le sirve de
 * nada: "Could not find a relationship between 'evaluaciones' and
 * 'evaluado_id' in the schema cache" no le dice qué hacer. Se registra
 * siempre en consola y solo se muestra en pantalla con el modo depuración
 * activo (localStorage 'ec-debug').
 */
const _TXT_ERROR = 'No se pudieron cargar tus datos. Vuelve a intentarlo; '
                 + 'si sigue fallando, avisa a la coordinación.';

function renderError(cont, msg, onRetry) {
  if (msg) console.error('[render]', msg);
  if (!cont) return;
  cont.replaceChildren();
  const box = document.createElement('div');
  box.className = 'no-data-msg';
  box.setAttribute('role', 'alert');

  const t = document.createElement('div');
  t.className = 'no-data-txt';
  t.textContent = _TXT_ERROR;
  box.appendChild(t);

  let verDetalle = false;
  try { verDetalle = localStorage.getItem('ec-debug') === '1'; }
  catch { /* localStorage bloqueado (modo privado / cookies off) */ }

  if (verDetalle && msg) {
    const d = document.createElement('p');
    d.className = 'no-data-detalle';
    d.textContent = msg;
    box.appendChild(d);
  }

  if (onRetry) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pb';
    b.style.marginTop = '12px';
    b.textContent = 'Reintentar';
    b.addEventListener('click', onRetry);
    box.appendChild(b);
  }
  cont.appendChild(box);
}

/**
 * Vacío legítimo. Si se conoce la fecha de publicación se dice, porque
 * "Aún no hay evaluación" sin más no distingue "todavía no toca" de
 * "algo falló".
 */
function renderVacio(cont, msg, { periodo = null, calendario = null } = {}) {
  if (!cont) return;
  cont.replaceChildren();
  const box = document.createElement('div');
  box.className = 'no-data-msg';

  const t = document.createElement('div');
  t.className = 'no-data-txt';
  t.textContent = msg || 'Aún no hay datos.';
  box.append(t);

  const fecha = fechaLarga(fechaDisponibilidad(periodo, calendario));
  if (fecha) {
    const sub = document.createElement('div');
    sub.className = 'no-data-sub';
    sub.textContent = `Tu evaluación de ${periodo.pe} se publica el ${fecha}.`;
    box.append(sub);
  }
  cont.appendChild(box);
}

/* ══ TABLAS EN MÓVIL ═══════════════════════════════════════════════════
 * Por debajo de 768px las tablas dejan de ser rejilla y pasan a tarjetas:
 * cada celda en su línea, precedida por el nombre de su columna. Sin eso,
 * la tabla de usuarios (8 columnas) se forzaba a 900px y había que
 * arrastrarla de lado en un teléfono de 320.
 *
 * La etiqueta sale de la propia .tbl-head, no de un data-label escrito a
 * mano en cada celda: son seis tablas y ninguna se puede olvidar. Se
 * observa el DOM porque las filas nacen de innerHTML en seis funciones
 * distintas, y una llamada explícita en cada una se acaba perdiendo.
 */
function etiquetarFilas(raiz) {
  const filas = raiz.matches?.('.tbl-row') ? [raiz] : raiz.querySelectorAll?.('.tbl-row') || [];
  for (const fila of filas) {
    if (fila.dataset.etiquetada) continue;
    const tabla = fila.closest('.tbl') || fila.parentElement?.parentElement;
    const cabecera = tabla?.querySelector('.tbl-head');
    if (!cabecera) continue;
    const nombres = [...cabecera.children].map(c => c.textContent.trim());
    [...fila.children].forEach((celda, i) => {
      const n = nombres[i];
      if (n) celda.setAttribute('data-label', n);
    });
    fila.dataset.etiquetada = '1';
  }
}

new MutationObserver(muts => {
  for (const m of muts) {
    for (const nodo of m.addedNodes) {
      if (nodo.nodeType === 1) etiquetarFilas(nodo);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('DOMContentLoaded', () => etiquetarFilas(document.body));
