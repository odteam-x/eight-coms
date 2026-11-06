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

/* ── Plugins (annotation y datalabels, vía CDN con SRI) ──────────────────────
   datalabels, una vez registrado, pintaría un número sobre TODOS los gráficos: se apaga por defecto y cada gráfico lo
   pide con etiquetasValor(). Si el CDN de un plugin falla, las opciones que lo usan se ignoran y el gráfico sigue siendo válido. */
if (typeof Chart !== 'undefined') {
  if (typeof ChartDataLabels !== 'undefined') Chart.register(ChartDataLabels);   // la v2 del plugin NO se registra sola
  if (Chart.defaults.plugins.datalabels) Chart.defaults.plugins.datalabels.display = false;
}

/** Relleno degradado bajo una línea: del color (opaco a medias) arriba a transparente abajo. Escriptable: usa el área real. */
function rellenoDegradado(color, arriba = .30) {
  return ctx => {
    const { chart } = ctx, a = chart.chartArea;
    if (!a) return conAlfa(color, .12);
    const g = chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
    g.addColorStop(0, conAlfa(color, arriba)); g.addColorStop(1, conAlfa(color, 0));
    return g;
  };
}

/** Bandas de nivel (Bajo / En proceso / Bueno / Excelente) tras la línea, con su nombre al borde: el gráfico dice qué significa
 *  cada altura sin tener que ir a la tabla. Los umbrales salen de NIVELES / NIVELES_V2 (una sola definición). */
function bandasNivel(modelo, max) {
  const niv = (modelo === 'v2' ? NIVELES_V2 : NIVELES).slice().reverse();      // de abajo hacia arriba
  const txt = token('--txt-2', '#B4BCC8'), out = {};
  niv.forEach((n, i) => {
    const min = n.min === -Infinity ? 0 : n.min, techo = niv[i + 1] ? niv[i + 1].min : max;
    out['nivel' + i] = {
      type: 'box', yMin: min, yMax: techo, drawTime: 'beforeDatasetsDraw', borderWidth: 0,
      backgroundColor: conAlfa(token('--' + n.key, '#00CBFF'), .075),
      label: { display: true, content: n.label, position: { x: 'end', y: 'center' }, xAdjust: -6, color: txt,
               font: { family: 'Barlow, system-ui, sans-serif', size: 11, weight: '600' } },
    };
  });
  return out;
}

/** Número sobre cada barra / punto. */
function etiquetasValor({ decimales = 0, sufijo = '', alinear = 'end', ancla = 'end' } = {}) {
  return {
    display: ctx => ctx.dataset.data[ctx.dataIndex] != null,
    color: token('--txt', '#F2F4F7'), anchor: ancla, align: alinear, offset: 2, clamp: true,
    font: { family: 'Barlow, system-ui, sans-serif', size: 12, weight: '600' },
    formatter: v => (v == null ? '' : Number(v).toFixed(decimales).replace('.', ',') + sufijo),
  };
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
    animation: _sinMovimiento() ? false : { duration: 600, easing: 'easeOutQuart' },
    elements: { bar: { borderRadius: 6, borderSkipped: false }, line: { borderJoinStyle: 'round' } },
    layout: { padding: { top: 8, right: 4 } },
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
        displayColors: true, usePointStyle: true, boxPadding: 4,
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

/**
 * Evolución con la rúbrica por roles: dos líneas sobre la misma escala 0–100.
 * Individual lleva el color de dato; General, el segundo peldaño (--cyan-200),
 * y la diferencia se distingue además por el trazo, no solo por el color.
 *
 * @param {Array} puntos [{ pe, individual, general }] (null = sin dato)
 */
function graficoEvolucionV2(idCanvas, puntos) {
  return pintarGrafico(idCanvas, () => {
    const c1 = colorDato(0), c2 = colorDato(1);
    const base = (label, data, color, extra = {}) => ({
      label, data, borderColor: color, backgroundColor: color,
      pointBackgroundColor: color, pointBorderColor: token('--bg', '#061326'),
      pointBorderWidth: 2, pointRadius: 5, pointHoverRadius: 7,
      borderWidth: 2, tension: .3, spanGaps: true, ...extra,
    });
    return {
      type: 'line',
      data: {
        labels: puntos.map(p => p.pe),
        datasets: [
          base('Individual', puntos.map(p => p.individual), c1, { fill: true, backgroundColor: conAlfa(c1, .12) }),
          base('General',    puntos.map(p => p.general),    c2, { borderDash: [6, 4], pointStyle: 'rectRot' }),
        ],
      },
      options: {
        plugins: { legend: { display: true } },
        scales: { y: { min: 0, max: 100, ticks: { stepSize: 25 } } },
      },
    };
  });
}
