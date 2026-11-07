'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
 * EIGHT CREATORS LABs — Niveles de desempeño: UNA sola definición de los cortes
 *
 * Antes había tres tablas de cortes escritas por separado (core/render.js, core/rubrica.js, core/distritos.js). Aquí
 * están juntas, con su escala, para que se vean lado a lado y un test las compare. NO cambia ningún valor mostrado.
 *
 *   CLASICA   26 / 20 / 11 sobre 30      (rúbrica clásica; el máximo real lo da MAX_TOTAL())
 *   V2        87 / 67 / 37 sobre 100     (rúbrica por roles; = 26/20/11 de 30 redondeados)
 *   DISTRITO  24 / 17 / 10 sobre 28      (evaluación de distrito)  ⚠ NO es equivalente a los otros dos (ver DISTRITO_PCT)
 *
 * Solo cortes y etiquetas: ningún puntaje se calcula aquí. Debe cargarse antes de core/render.js.
 * ═══════════════════════════════════════════════════════════════════════════ */
const Niveles = (() => {
  const CLAVES = ['sex', 'sbu', 'spr', 'sba'];
  const ETIQ   = ['Excelente', 'Bueno', 'En Proceso', 'Bajo'];

  /** Tabla ordenada de mayor a menor corte; el último nivel no tiene piso. */
  const tabla = (cortes, etiquetas = ETIQ) =>
    CLAVES.map((key, i) => ({ min: i < 3 ? cortes[i] : -Infinity, key, label: etiquetas[i] }));

  const CORTES = {
    CLASICA:  { cortes: [26, 20, 11], sobre: 30  },
    V2:       { cortes: [87, 67, 37], sobre: 100 },
    DISTRITO: { cortes: [24, 17, 10], sobre: 28  },
  };

  const CLASICA  = tabla(CORTES.CLASICA.cortes).map(n => ({ ...n, color: `var(--${n.key})` }));
  const V2       = tabla(CORTES.V2.cortes);
  const DISTRITO = tabla(CORTES.DISTRITO.cortes, ['Excelente', 'Bueno', 'En proceso', 'Bajo']);

  const de = (t, s) => t.find(n => Number(s) >= n.min) || t[t.length - 1];

  /** Cada corte como porcentaje de su escala: para comparar tablas entre sí (lo usa el test). */
  const porcentajes = k => CORTES[k].cortes.map(c => c / CORTES[k].sobre * 100);

  return { CLASICA, V2, DISTRITO, CORTES, de, porcentajes };
})();
