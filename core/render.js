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
const getMaxScore  = () => getCriterios().length * 4;   // 28 con 7 criterios
const MAX_TOTAL    = () => getMaxScore() + 2;           // +2 de bono

/** ¿Hay criterios utilizables? Úsalo antes de pintar cualquier puntaje. */
const hayCriterios = () => getCriterios().length > 0;


/* ══ CÁLCULO DE PUNTAJE ════════════════════════════════════════════════ */

/** Fila del portal: las claves de criterio vienen al mismo nivel + `ext`. */
const calcScore = row =>
  getCriterios().reduce((s, c) => s + (Number(row?.[c.key]) || 0), 0) + (Number(row?.ext) || 0);

/** Forma del admin: objeto `puntajes` (o su JSON) + bono aparte. */
const calcScorePuntajes = (puntajes, bono) =>
  Object.values(parseJSON(puntajes)).reduce((s, v) => s + (Number(v) || 0), 0) + (Number(bono) || 0);


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

function openModal(id) {
  const m = document.getElementById(id);
  if (m) { m.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) { m.style.display = 'none'; document.body.style.overflow = ''; }
}


/* ══ PESTAÑAS ══════════════════════════════════════════════════════════
 * El núcleo es común; cada portal aporta su selector de contenido, su mapa
 * de pestaña→padre y sus hooks de carga.
 */
function switchTabCore(tab, btn, { contentSelector = '.tab-content', parentMap = {} } = {}) {
  document.querySelectorAll(contentSelector).forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${tab}`)?.classList.add('active');

  document.querySelectorAll('#desktop-nav .tnav').forEach(b => b.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else {
    const parent = parentMap[tab] || tab;
    document.querySelectorAll('#desktop-nav .tnav-group > .tnav, #desktop-nav > .tnav').forEach(b => {
      if ((b.getAttribute('onclick') || '').includes(`'${parent}'`)) b.classList.add('active');
    });
  }
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
    .find(b => b.getAttribute('onclick')?.includes(`'${tab}'`) && b.style.display !== 'none');
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

function renderError(cont, msg, onRetry) {
  if (!cont) return;
  cont.replaceChildren();
  const box = document.createElement('div');
  box.className = 'no-data-msg';
  box.setAttribute('role', 'alert');

  const t = document.createElement('div');
  t.className = 'no-data-txt';
  t.textContent = msg || 'No se pudieron cargar los datos.';
  box.appendChild(t);

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

function renderVacio(cont, msg) {
  if (!cont) return;
  cont.replaceChildren();
  const box = document.createElement('div');
  box.className = 'no-data-msg';
  const t = document.createElement('div');
  t.className = 'no-data-txt';
  t.textContent = msg || 'Aún no hay datos.';
  box.append(t);
  cont.appendChild(box);
}
