'use strict';
/**
 * EIGHT CREATORS LABs — Primitivas de interfaz
 * ─────────────────────────────────────────────
 * Piezas visuales que comparten los tres portales: anillo de progreso,
 * variación entre períodos, pestañas segmentadas, esqueletos de carga,
 * contadores y el panel lateral.
 *
 * PRESENTACIÓN PURA. Ni una fórmula de evaluación: un valor entra, se pinta.
 * La variación es una resta entre dos números que la base ya calculó, no un
 * score nuevo. El cálculo vive en resultados_periodo() (ver core/rubrica.js).
 *
 * Todo dato de origen humano pasa por escHtml(). Las acciones van por
 * data-act y se registran en ACCIONES de config.js: nada de onclick.
 *
 * Depende de: config.js (escHtml, renderIconos), core/render.js
 *             (openModal, closeModal).
 */

const _reduceMov = () =>
  !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 87.456 → "87.5", 50 → "50", null → "—". */
const fmtNum = (n, dec = 1) => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const f = 10 ** dec;
  return String(Math.round(Number(n) * f) / f);
};


/* ══ ANILLO ════════════════════════════════════════════════════════════
 * Un solo círculo SVG con pathLength="100": el porcentaje es el
 * stroke-dashoffset, sin calcular circunferencias. El relleno anima al
 * recibir la clase .in (ver animarEntrada).
 *
 *   valor   número o null (null → pista vacía y «—»)
 *   max     techo de la escala (100 en v2; 28 en legacy)
 *   color   token de relleno, p. ej. 'var(--sbu)'
 *   decimales de lo que se escribe en el centro
 */
function anilloHTML({ valor, max = 100, color = 'var(--data)', etiqueta = '', decimales = 0 } = {}) {
  const tiene = valor != null && !Number.isNaN(Number(valor));
  const pct = tiene ? Math.max(0, Math.min(1, Number(valor) / max)) : 0;
  const txt = tiene ? fmtNum(valor, decimales) : '—';
  return `
    <div class="anillo${pct === 0 ? ' anillo--vacio' : ''}" style="--p:${pct.toFixed(4)};--c:${escHtml(color)}" role="img"
         aria-label="${escHtml(etiqueta || (tiene ? `${txt} de ${max}` : 'Sin dato'))}">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="anillo-pista" cx="50" cy="50" r="44" pathLength="100"/>
        <circle class="anillo-fill"  cx="50" cy="50" r="44" pathLength="100"/>
      </svg>
      <span class="anillo-num"${tiene ? ` data-cuenta="${Number(valor)}" data-dec="${decimales}"` : ''}>${txt}</span>
    </div>`;
}


/* ══ VARIACIÓN ═════════════════════════════════════════════════════════
 * «+10 vs PE2». Lleva icono y signo además de color: el color solo no
 * puede ser el indicador (WCAG 1.4.1).
 */
function deltaHTML(actual, previo, { decimales = 0, ref = '', unidad = '' } = {}) {
  if (actual == null || previo == null) return '';
  const a = Number(actual), p = Number(previo);
  if (Number.isNaN(a) || Number.isNaN(p)) return '';
  const f = 10 ** decimales;
  const d = Math.round((a - p) * f) / f;
  const dir = d > 0 ? 'sube' : d < 0 ? 'baja' : 'igual';
  const icono = d > 0 ? 'trending-up' : d < 0 ? 'trending-down' : 'minus';
  const txt = d > 0 ? `+${fmtNum(d, decimales)}` : d < 0 ? `−${fmtNum(Math.abs(d), decimales)}` : 'Sin cambio';
  const sr = d === 0
    ? `Sin cambio${ref ? ' respecto a ' + ref : ''}`
    : `${fmtNum(Math.abs(d), decimales)}${unidad} ${d > 0 ? 'más' : 'menos'}${ref ? ' que en ' + ref : ''}`;
  return `<span class="delta delta--${dir}" title="${escHtml(sr)}">
    <i data-lucide="${icono}" class="delta-ico" aria-hidden="true"></i>
    <span aria-hidden="true">${escHtml(txt)}${ref ? ` <span class="delta-ref">vs ${escHtml(ref)}</span>` : ''}</span>
    <span class="sr-only">${escHtml(sr)}</span>
  </span>`;
}


/* ══ PESTAÑAS SEGMENTADAS ══════════════════════════════════════════════
 * items: [{ k, etiqueta, icono? }]. Quien las usa registra la acción en
 * ACCIONES y se encarga de mostrar/ocultar los paneles (role=tabpanel).
 */
function segHTML(items, activo, accion, { etiqueta = 'Secciones', prefijo = 'seg' } = {}) {
  return `<div class="seg" role="tablist" aria-label="${escHtml(etiqueta)}">
    ${items.map(it => `
      <button type="button" class="seg-btn${it.k === activo ? ' active' : ''}" role="tab"
              id="${escHtml(prefijo)}-${escHtml(it.k)}" aria-selected="${it.k === activo}"
              aria-controls="${escHtml(prefijo)}-panel-${escHtml(it.k)}"
              tabindex="${it.k === activo ? 0 : -1}"
              data-act="${escHtml(accion)}" data-arg="${escHtml(it.k)}">
        ${it.icono ? `<i data-lucide="${escHtml(it.icono)}" class="seg-ico" aria-hidden="true"></i>` : ''}
        <span>${escHtml(it.etiqueta)}</span>
      </button>`).join('')}
  </div>`;
}

/** Flechas izquierda/derecha entre pestañas, como en el patrón ARIA de tabs. */
document.addEventListener('keydown', e => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const b = e.target.closest?.('.seg-btn');
  if (!b) return;
  const hermanos = [...b.parentElement.querySelectorAll('.seg-btn')];
  const i = hermanos.indexOf(b);
  const n = hermanos[(i + (e.key === 'ArrowRight' ? 1 : -1) + hermanos.length) % hermanos.length];
  e.preventDefault();
  n.focus();
  n.click();
});


/* ══ ESQUELETOS ════════════════════════════════════════════════════════
 * Sustituyen al spinner: muestran la FORMA de lo que viene, así el
 * contenido no salta cuando llega. aria-busy en el contenedor; el texto
 * oculto avisa a los lectores de pantalla.
 */
function esqueletoHTML(tipo = 'bloques') {
  const barra = (w, h = 14) => `<span class="skel" style="width:${w};height:${h}px"></span>`;
  if (tipo === 'perfil') {
    return `<div class="skel-wrap" aria-busy="true">
      <span class="sr-only">Cargando…</span>
      <div class="skel-cab"><span class="skel skel--circulo"></span><div class="skel-col">${barra('55%', 22)}${barra('35%')}</div></div>
      <div class="skel-kpis">${'<span class="skel skel--caja"></span>'.repeat(4)}</div>
      ${barra('100%', 44)}${barra('100%', 44)}${barra('80%', 44)}
    </div>`;
  }
  return `<div class="skel-wrap" aria-busy="true">
    <span class="sr-only">Cargando…</span>
    ${barra('100%', 56)}${barra('100%', 56)}${barra('70%', 56)}
  </div>`;
}


/* ══ ENTRADA ANIMADA ═══════════════════════════════════════════════════
 * Llamar justo después de poner el HTML en el DOM. Hace tres cosas:
 *   · anima los anillos (clase .in en el cuadro siguiente);
 *   · cuenta hasta su valor en los [data-cuenta];
 *   · renderiza los iconos Lucide del bloque.
 * Con prefers-reduced-motion no cuenta: deja el valor final puesto.
 */
function animarEntrada(raiz) {
  if (!raiz) return;
  if (typeof renderIconos === 'function') renderIconos(raiz);

  const anillos = raiz.querySelectorAll('.anillo, [data-anim]');
  const contadores = raiz.querySelectorAll('[data-cuenta]');

  if (_reduceMov()) {
    anillos.forEach(el => el.classList.add('in'));
    return;
  }

  // Dos cuadros: el primero fija el estado inicial, el segundo dispara la
  // transición. Con uno solo el navegador pinta ya el estado final.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    anillos.forEach(el => el.classList.add('in'));
  }));

  contadores.forEach(el => {
    const meta = Number(el.dataset.cuenta);
    const dec = Number(el.dataset.dec) || 0;
    if (!Number.isFinite(meta)) return;
    const t0 = performance.now(), dur = 850;
    const paso = ahora => {
      const k = Math.min(1, (ahora - t0) / dur);
      const e = 1 - (1 - k) ** 3;                   // ease-out cúbico
      el.textContent = fmtNum(meta * e, dec);
      if (k < 1) requestAnimationFrame(paso);
      else el.textContent = fmtNum(meta, dec);
    };
    el.textContent = fmtNum(0, dec);
    requestAnimationFrame(paso);
  });
}


/* ══ PANEL LATERAL ═════════════════════════════════════════════════════
 * Ficha que se abre sobre la página: panel a la derecha en escritorio y
 * hoja a pantalla completa en móvil. Usa openModal/closeModal, que ya
 * aportan role="dialog", trampa de Tab, Escape y devolución del foco.
 *
 * Devuelve el elemento del cuerpo para que quien lo abre lo rellene.
 */
const _PANEL_ID = 'panel-lateral';

function abrirPanel({ titulo = '', subtitulo = '' } = {}) {
  let ov = document.getElementById(_PANEL_ID);
  if (!ov) {
    ov = document.createElement('div');
    ov.id = _PANEL_ID;
    ov.className = 'panel-overlay';
    ov.dataset.act = 'cerrarModalFondo';
    ov.dataset.arg = _PANEL_ID;
    ov.innerHTML = `
      <div class="panel">
        <header class="panel-cab">
          <div class="panel-cab-txt">
            <h2 class="panel-titulo" id="panel-lateral-titulo"></h2>
            <p class="panel-sub" id="panel-lateral-sub"></p>
          </div>
          <button type="button" class="btn-icon" data-act="cerrarModal" data-arg="${_PANEL_ID}" aria-label="Cerrar">
            <i data-lucide="x" aria-hidden="true"></i>
          </button>
        </header>
        <div class="panel-cuerpo" id="panel-lateral-cuerpo"></div>
      </div>`;
    document.body.appendChild(ov);
    renderIconos(ov);
  }
  document.getElementById('panel-lateral-titulo').textContent = titulo;
  const sub = document.getElementById('panel-lateral-sub');
  sub.textContent = subtitulo;
  sub.hidden = !subtitulo;
  const cuerpo = document.getElementById('panel-lateral-cuerpo');
  cuerpo.replaceChildren();
  cuerpo.scrollTop = 0;
  openModal(_PANEL_ID);
  ov.setAttribute('aria-labelledby', 'panel-lateral-titulo');
  return cuerpo;
}

const cerrarPanel = () => closeModal(_PANEL_ID);


/* ══ FECHAS Y LÍNEA DE TIEMPO ══════════════════════════════════════════
 * Los períodos traen cuatro fechas (inicio, fin de trabajo, entrega de
 * scores, jornada). La línea de tiempo las pone en orden sobre un mismo eje
 * y marca dónde está «hoy». Las fechas se parten a mano (YYYY-MM-DD) para no
 * sufrir el desfase de zona horaria de new Date('2026-10-15').
 */
const HITOS_PERIODO = [
  ['inicio',     'Inicio del período'],
  ['finTrabajo', 'Fin del trabajo'],
  ['entrega',    'Entrega de scores'],
  ['jornada',    'Jornada'],
];

/** Días desde hoy hasta una fecha ISO (negativo = ya pasó). null si no hay fecha. */
function diasDesdeHoy(iso) {
  const [a, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!a || !m || !d) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return Math.round((new Date(a, m - 1, d) - hoy) / 86400000);
}

/** «15 oct» a partir de un YYYY-MM-DD. */
function fechaCortaISO(iso) {
  const [a, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!a || !m || !d) return '';
  return new Date(a, m - 1, d).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }).replace('.', '');
}

/** «en 6 días», «mañana», «hoy», «hace 3 días». */
function textoDias(n) {
  if (n == null) return '';
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n === -1) return 'ayer';
  return n > 0 ? `en ${n} días` : `hace ${-n} días`;
}

/** Hitos futuros de todos los períodos, del más cercano al más lejano. */
function proximosHitos(periodos, max = 4) {
  const out = [];
  for (const p of periodos || []) {
    for (const [k, etq] of HITOS_PERIODO) {
      const n = diasDesdeHoy(p[k]);
      if (n != null && n >= 0) out.push({ pe: p.pe, etiqueta: etq, fecha: p[k], dias: n });
    }
  }
  return out.sort((a, b) => a.dias - b.dias).slice(0, max);
}

/**
 * Línea de tiempo vertical: un bloque por período y, dentro, sus hitos con un
 * punto en el eje. Cada hito dice si ya pasó, es hoy o falta; el estado no
 * lo da solo el color (relleno / contorno + texto «hoy», «en N días»).
 */
function lineaTiempoHTML(periodos, { peActual = null } = {}) {
  const bloques = (periodos || []).map(p => {
    const hitos = HITOS_PERIODO.filter(([k]) => p[k]).map(([k, etq]) => {
      const n = diasDesdeHoy(p[k]);
      const est = n < 0 ? 'pasado' : n === 0 ? 'hoy' : 'futuro';
      return `<li class="lt-hito lt-hito--${est}">
        <span class="lt-punto" aria-hidden="true"></span>
        <span class="lt-etq">${escHtml(etq)}</span>
        <time class="lt-fecha" datetime="${escHtml(p[k])}">${escHtml(fechaCortaISO(p[k]))}</time>
        <span class="lt-rel">${escHtml(textoDias(n))}</span>
      </li>`;
    }).join('');
    const actual = p.pe === peActual;
    return `<li class="lt-periodo${actual ? ' lt-periodo--actual' : ''}"${actual ? ' aria-current="true"' : ''}>
      <div class="lt-cab"><span class="lt-pe">${escHtml(p.pe)}</span><span class="lt-nombre">${escHtml(p.nombre && p.nombre !== p.pe ? p.nombre : '')}</span>${actual ? '<span class="tag-marca">Seleccionado</span>' : ''}</div>
      ${hitos ? `<ol class="lt-hitos">${hitos}</ol>` : '<p class="lt-sin">Aún sin fechas.</p>'}
    </li>`;
  }).join('');
  return `<ol class="lt">${bloques}</ol>`;
}
