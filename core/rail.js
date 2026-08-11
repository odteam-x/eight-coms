'use strict';
/**
 * EIGHT CREATORS LABs — Navegación (Fase 6)
 * ─────────────────────────────────────────
 * Un solo componente genera las dos formas de la navegación:
 *
 *   ≥1024px  rail lateral fijo, colapsable, con etiquetas
 *   768–1023 rail siempre colapsado a iconos
 *   <768px   rail fuera; barra inferior de pestañas
 *
 * Se construye desde datos porque los tres portales tienen destinos
 * distintos y antes eso significaba tres bloques de marcado duplicado que
 * divergían. Sustituye a `.topbar`, `.tb-nav` y `.mobile-menu`.
 *
 * Depende de: config.js (despachador data-act, renderIconos)
 *             core/render.js (switchTabCore marca role/aria)
 */

const RAIL_COLAPSO_KEY = 'ec-rail-colapsado';

/** Máximo de destinos en la barra inferior antes de agrupar en "Más". */
const BOTTOM_MAX = 5;

let _railCfg = null;

/**
 * @param {object} cfg
 * @param {Array}  cfg.grupos   [{ titulo?, items:[{tab, icono, etiqueta}] }]
 * @param {string} cfg.activo   tab inicial
 * @param {string} cfg.marca    texto de la marca
 * @param {string} [cfg.badge]  etiqueta de rol (ADMIN, SECRETARIO…)
 */
function initNav(cfg) {
  _railCfg = cfg;
  document.body.classList.add('con-rail');
  renderRail();
  renderBottomBar();
  aplicarColapso(localStorage.getItem(RAIL_COLAPSO_KEY) === '1');
}

/** Todos los items en plano, respetando el orden de los grupos. */
const _items = () => (_railCfg?.grupos || []).flatMap(g => g.items);

/* ══ RAIL ══════════════════════════════════════════════════════════════ */
function renderRail() {
  const host = document.getElementById('rail');
  if (!host || !_railCfg) return;
  host.replaceChildren();

  // Marca
  const marca = document.createElement('button');
  marca.className = 'rail-marca';
  marca.type = 'button';
  marca.dataset.act = 'tab';
  marca.dataset.arg = _items()[0]?.tab || '';
  marca.setAttribute('aria-label', 'Ir al inicio');
  marca.innerHTML =
    '<picture><source srcset="logo.webp 1x, logo@2x.webp 2x" type="image/webp">' +
    '<img src="logo.png" alt="" class="rail-logo" width="32" height="32"></picture>' +
    `<span class="rail-marca-txt">${escHtml(_railCfg.marca || '')}</span>` +
    (_railCfg.badge ? `<span class="rail-badge">${escHtml(_railCfg.badge)}</span>` : '');
  host.appendChild(marca);

  // Destinos
  const nav = document.createElement('nav');
  nav.className = 'rail-nav';
  nav.id = 'desktop-nav';
  nav.setAttribute('role', 'navigation');
  nav.setAttribute('aria-label', 'Navegación principal');

  for (const g of _railCfg.grupos) {
    if (g.titulo) {
      const sep = document.createElement('div');
      sep.className = 'rail-sep';
      sep.innerHTML = `<span>${escHtml(g.titulo)}</span>`;
      nav.appendChild(sep);
    }
    for (const it of g.items) nav.appendChild(_botonRail(it));
  }
  host.appendChild(nav);

  // Pie: gestión, tema, usuario, salir
  const pie = document.createElement('div');
  pie.className = 'rail-pie';
  pie.innerHTML = `
    <span id="gestion-switch" hidden></span>
    <button class="rail-item rail-item--sec" data-act="fn" data-arg="toggleTheme"
            aria-label="Cambiar tema" data-tip="Cambiar tema">
      <i data-lucide="sun-moon" class="rail-ico"></i><span class="rail-txt">Tema</span>
    </button>
    <div class="rail-user">
      <div class="avatar" id="av-desktop">?</div>
      <div class="rail-user-info">
        <div class="rail-uname" id="uname-desktop">—</div>
        <div class="rail-ts" id="ts-badge"></div>
      </div>
    </div>
    <button class="rail-item rail-item--sec" data-act="salir" data-tip="Salir">
      <i data-lucide="log-out" class="rail-ico"></i><span class="rail-txt">Salir</span>
    </button>
    <button class="rail-toggle" data-act="railColapso" aria-label="Contraer o expandir el menú">
      <i data-lucide="chevrons-left" class="rail-ico"></i>
    </button>`;
  host.appendChild(pie);

  renderIconos(host);
  marcarActivo(_railCfg.activo);
}

function _botonRail(it) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rail-item';
  b.dataset.act = 'tab';
  b.dataset.arg = it.tab;
  b.dataset.tip = it.etiqueta;              // tooltip cuando está colapsado
  b.innerHTML = `<i data-lucide="${escHtml(it.icono)}" class="rail-ico"></i>` +
                `<span class="rail-txt">${escHtml(it.etiqueta)}</span>`;
  return b;
}

/* ══ BARRA INFERIOR (móvil) ════════════════════════════════════════════ */
function renderBottomBar() {
  const host = document.getElementById('bottom-bar');
  if (!host || !_railCfg) return;
  host.replaceChildren();
  host.setAttribute('role', 'navigation');
  host.setAttribute('aria-label', 'Navegación');

  const todos = _items();
  // Con más destinos que huecos, el último abre una hoja con el resto.
  const directos = todos.length > BOTTOM_MAX ? todos.slice(0, BOTTOM_MAX - 1) : todos;
  const resto    = todos.slice(directos.length);

  for (const it of directos) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bb-item';
    b.dataset.act = 'tab';
    b.dataset.arg = it.tab;
    b.innerHTML = `<i data-lucide="${escHtml(it.icono)}" class="bb-ico"></i>` +
                  `<span class="bb-txt">${escHtml(it.etiqueta)}</span>`;
    host.appendChild(b);
  }

  if (resto.length) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bb-item';
    b.dataset.act = 'masDestinos';
    b.setAttribute('aria-haspopup', 'true');
    b.innerHTML = '<i data-lucide="more-horizontal" class="bb-ico"></i><span class="bb-txt">Más</span>';
    host.appendChild(b);
    _montarHoja(resto);
  }
  renderIconos(host);
  marcarActivo(_railCfg.activo);
}

/** Hoja inferior con los destinos que no caben en la barra. */
function _montarHoja(items) {
  let hoja = document.getElementById('bb-hoja');
  if (hoja) hoja.remove();
  hoja = document.createElement('div');
  hoja.id = 'bb-hoja';
  hoja.className = 'bb-hoja';
  hoja.setAttribute('role', 'dialog');
  hoja.setAttribute('aria-modal', 'true');
  hoja.setAttribute('aria-label', 'Más destinos');
  hoja.innerHTML =
    '<div class="bb-hoja-panel">' +
    '<div class="bb-hoja-tirador" aria-hidden="true"></div>' +
    items.map(it =>
      `<button class="bb-hoja-item" data-act="tabDesdeHoja" data-arg="${escHtml(it.tab)}">
         <i data-lucide="${escHtml(it.icono)}" class="rail-ico"></i>${escHtml(it.etiqueta)}
       </button>`).join('') +
    '</div>';
  hoja.addEventListener('click', e => { if (e.target === hoja) cerrarHoja(); });
  document.body.appendChild(hoja);
  renderIconos(hoja);
}

function abrirHoja()  { document.getElementById('bb-hoja')?.classList.add('open'); }
function cerrarHoja() { document.getElementById('bb-hoja')?.classList.remove('open'); }

/* ══ ESTADO ════════════════════════════════════════════════════════════ */

/** Marca el destino activo en el rail y en la barra, con aria-current. */
function marcarActivo(tab) {
  if (!tab) return;
  if (_railCfg) _railCfg.activo = tab;
  // Solo los destinos: data-act="tab". El botón de tema también lleva
  // data-arg y no debe poder quedar marcado como activo.
  document.querySelectorAll('.rail-item[data-act="tab"], .bb-item[data-act="tab"]').forEach(b => {
    const on = b.dataset.arg === tab;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else    b.removeAttribute('aria-current');
  });
}

function aplicarColapso(colapsado) {
  document.body.classList.toggle('rail-colapsado', !!colapsado);
  localStorage.setItem(RAIL_COLAPSO_KEY, colapsado ? '1' : '0');
  const t = document.querySelector('.rail-toggle');
  if (t) t.setAttribute('aria-expanded', String(!colapsado));
}

function alternarColapso() {
  aplicarColapso(!document.body.classList.contains('rail-colapsado'));
}
