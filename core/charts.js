/**
 * EIGHT CREATORS LABs — Gráficos (Chart.js)
 *
 * Envoltorio fino sobre Chart.js. Existe para tres cosas que, hechas a mano
 * en cada sitio, se olvidan en el segundo:
 *
 *  1. Los colores se leen del CSS en tiempo de ejecución, no se escriben en
 *     el JS. Un hex en un dataset es un color fuera de :root que ningún
 *     cambio de tema alcanza.
 *  2. Al cambiar de tema hay que DESTRUIR y reconstruir. Chart.js copia los
 *     colores al construir el gráfico: si solo se llama a update(), el
 *     lienzo se queda con la paleta del tema anterior.
 *  3. El lienzo necesita una altura fija de su contenedor y
 *     maintainAspectRatio:false. Sin las dos, un canvas dentro de un flex
 *     crece en cada repintado hasta llenar la página.
 */
'use strict';

/* Cada gráfico vivo, con la receta para reconstruirlo tras cambiar de tema. */
const _graficos = new Map();   // id -> { chart, construir }

/** ¿Está Chart.js cargado? El CDN puede fallar y la vista debe seguir viva. */
const hayChart = () => typeof Chart !== 'undefined';

/** Token del CSS, resuelto ahora. Chart.js no entiende var(). */
function token(nombre, respaldo) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
  return v || respaldo || '#888';
}

/** Serie secundaria. --cyan-200 solo aparecía en la escala de nivel; aquí
 *  da el segundo peldaño de dato sin salir de la paleta. */
const colorDato = (n = 0) => token(n === 0 ? '--data' : '--cyan-200', '#00CBFF');

/** Un color de la paleta con transparencia, para rellenos bajo la línea. */
function conAlfa(hex, alfa) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const [r, g, b] = h.match(/../g).map(v => parseInt(v, 16));
  return `rgba(${r},${g},${b},${alfa})`;
}

const _sinMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* La leyenda solo cabe en pantallas anchas: por debajo se come la mitad del
   alto útil del gráfico. Los datasets llevan etiqueta en el tooltip igual. */
const _cabeLeyenda = () => window.innerWidth >= 640;

/**
 * Opciones comunes. Todo lo que sea color sale de un token.
 */
function opcionesBase() {
  const txt    = token('--txt-2', '#B4BCC8');
  const rejill = token('--border', 'rgba(255,255,255,.07)');
  const sup    = token('--surface-2', '#1F2126');
  const borde  = token('--border-hi', 'rgba(255,255,255,.14)');

  return {
    responsive: true,
    // Sin esto el canvas crece sin límite dentro de un contenedor flexible.
    maintainAspectRatio: false,
    animation: _sinMovimiento() ? false : { duration: 400 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: _cabeLeyenda(),
        labels: { color: txt, usePointStyle: true, boxWidth: 8, padding: 16,
                  font: { family: 'Barlow, system-ui, sans-serif', size: 12 } },
      },
      tooltip: {
        backgroundColor: sup,
        borderColor: borde,
        borderWidth: 1,
        titleColor: token('--txt', '#F2F4F7'),
        bodyColor: txt,
        padding: 10,
        cornerRadius: 8,
        displayColors: true,
        titleFont: { family: 'Barlow, system-ui, sans-serif', weight: '600' },
        bodyFont:  { family: 'Source Sans 3, system-ui, sans-serif' },
      },
    },
    scales: {
      x: {
        grid:   { color: rejill, drawTicks: false },
        border: { color: rejill },
        ticks:  { color: txt, font: { family: 'Barlow, system-ui, sans-serif', size: 12 } },
      },
      y: {
        beginAtZero: true,
        grid:   { color: rejill, drawTicks: false },
        border: { display: false },
        ticks:  { color: txt, precision: 0, font: { family: 'Barlow, system-ui, sans-serif', size: 12 } },
      },
    },
  };
}

/** Mezcla profunda mínima, solo para options (objetos planos anidados). */
function fundir(a, b) {
  const r = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    r[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof r[k] === 'object'
      ? fundir(r[k], v) : v;
  }
  return r;
}

/**
 * Crea o reemplaza un gráfico.
 *
 * @param {string}   idCanvas  id del <canvas>, dentro de un .chart-wrap
 * @param {function} construir () => ({ type, data, options }) — se vuelve a
 *                   llamar en cada cambio de tema, así que debe leer los
 *                   colores con token() dentro, nunca fuera.
 */
function pintarGrafico(idCanvas, construir) {
  const canvas = document.getElementById(idCanvas);
  if (!canvas) return null;

  // El CDN puede caerse. Mejor decirlo que dejar un rectángulo en blanco.
  if (!hayChart()) {
    const caja = canvas.closest('.chart-wrap');
    if (caja) {
      caja.replaceChildren();
      caja.classList.add('chart-wrap--fallo');
      const p = document.createElement('p');
      p.className = 'chart-fallback';
      p.setAttribute('role', 'status');
      p.textContent = 'No se pudo cargar la librería de gráficos. Los datos están en la tabla de abajo.';
      caja.appendChild(p);
    }
    return null;
  }

  _graficos.get(idCanvas)?.chart?.destroy();

  const cfg = construir();
  const chart = new Chart(canvas, { ...cfg, options: fundir(opcionesBase(), cfg.options) });
  _graficos.set(idCanvas, { chart, construir });
  return chart;
}

/** Destruye un gráfico y lo olvida (antes de repintar la sección por innerHTML). */
function borrarGrafico(idCanvas) {
  _graficos.get(idCanvas)?.chart?.destroy();
  _graficos.delete(idCanvas);
}

/**
 * Reconstruye todo al cambiar de tema.
 *
 * Se escucha el atributo en vez de acoplar core/theme.js a este archivo: las
 * páginas de acceso cargan theme.js y no cargan gráficos.
 */
new MutationObserver(muts => {
  if (!muts.some(m => m.attributeName === 'data-theme')) return;
  for (const [id, { construir }] of _graficos) {
    if (document.getElementById(id)) pintarGrafico(id, construir);
    else _graficos.delete(id);
  }
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/* Al cruzar 640px la leyenda entra o sale, y eso es una opción de
   construcción. Se reconstruye solo en el cruce, no en cada resize. */
(() => {
  const mq = window.matchMedia('(min-width: 640px)');
  mq.addEventListener('change', () => {
    for (const [id, { construir }] of _graficos) {
      if (document.getElementById(id)) pintarGrafico(id, construir);
    }
  });
})();

/**
 * Línea de evolución entre períodos. El único gráfico que el portal
 * necesita: es la vista que legítimamente cruza períodos.
 *
 * @param {string} idCanvas
 * @param {Array}  puntos  [{ pe, total }]
 * @param {number} max     puntaje máximo del eje
 */
function graficoEvolucion(idCanvas, puntos, max) {
  return pintarGrafico(idCanvas, () => {
    const color = token('--data', '#00CBFF');
    return {
      type: 'line',
      data: {
        labels: puntos.map(p => p.pe),
        datasets: [{
          label: 'Puntaje total',
          data: puntos.map(p => p.total),
          borderColor: color,
          backgroundColor: conAlfa(color, .12),
          pointBackgroundColor: color,
          pointBorderColor: token('--bg', '#0E0F12'),
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          borderWidth: 2,
          fill: true,
          tension: .3,
        }],
      },
      options: {
        // Un solo dataset: la leyenda repetiría el título de la sección.
        plugins: { legend: { display: false } },
        scales: { y: { max, ticks: { stepSize: Math.max(1, Math.round(max / 6)) } } },
      },
    };
  });
}
