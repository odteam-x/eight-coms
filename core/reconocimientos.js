/**
 * Reconocimientos: medallas de puesto, trofeo y estrellas. SVG propios, locales, en un solo sprite (~2 KB).
 *
 * Por qué no una biblioteca (Icons8, IconScout, Free Game UI, Lordicon…): sus recursos «premium» exigen atribución o licencia de
 * pago por uso comercial, pesan 10–100× más y casi todos tienen estilo de videojuego; aquí el metal es un gradiente de
 * gradients.css (--metal-*) y la forma es sobria (disco con borde interior y cinta).
 *
 * Qué reconoce (y qué NO): solo lo que ya existe en los datos.
 *   · Puesto 1–3 de un ranking calculado por la base → medalla oro/plata/bronce.
 *   · «Mejor resultado» del período → trofeo (es el máximo de resultados publicados).
 *   · Una valoración 1–5 de un criterio (v2 escala «cinco») → estrellas con su valor real, también fraccionario.
 * No hay premios por reglas inventadas: añadir uno exige una regla y un dato reales, y una entrada aquí.
 *
 * Todo texto de origen humano que se pinte con estos helpers pasa por escHtml() en quien llama.
 */

const SPRITE_RECONOCIMIENTOS = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="rec-g-oro" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--metal-oro-1)"/><stop offset=".3" style="stop-color:var(--metal-oro-2)"/><stop offset=".66" style="stop-color:var(--metal-oro-3)"/><stop offset="1" style="stop-color:var(--metal-oro-4)"/></linearGradient>
    <linearGradient id="rec-g-plata" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--metal-plata-1)"/><stop offset=".3" style="stop-color:var(--metal-plata-2)"/><stop offset=".66" style="stop-color:var(--metal-plata-3)"/><stop offset="1" style="stop-color:var(--metal-plata-4)"/></linearGradient>
    <linearGradient id="rec-g-bronce" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--metal-bronce-1)"/><stop offset=".32" style="stop-color:var(--metal-bronce-2)"/><stop offset=".66" style="stop-color:var(--metal-bronce-3)"/><stop offset="1" style="stop-color:var(--metal-bronce-4)"/></linearGradient>
    <symbol id="rec-medalla" viewBox="0 0 36 36">
      <path d="M11 2h6l3 10h-6z" style="fill:var(--medalla-cinta,#2A5FA8)" opacity=".9"/><path d="M25 2h-6l-3 10h6z" style="fill:var(--medalla-cinta,#2A5FA8)"/>
      <circle cx="18" cy="22" r="12.5" style="fill:var(--medalla-relleno)"/>
      <circle cx="18" cy="22" r="12.5" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1"/>
      <circle cx="18" cy="22" r="9.4" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1"/>
      <path d="M9.2 17.5a10 10 0 0 1 8-5" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.4" stroke-linecap="round"/>
    </symbol>
    <symbol id="rec-trofeo" viewBox="0 0 36 36">
      <path d="M10 5h16v8a8 8 0 0 1-16 0z" style="fill:url(#rec-g-oro)"/>
      <path d="M10 8H5v3a5 5 0 0 0 5.4 5M26 8h5v3a5 5 0 0 1-5.4 5" fill="none" stroke="url(#rec-g-oro)" stroke-width="2.2" stroke-linecap="round"/>
      <rect x="16.2" y="21" width="3.6" height="5" style="fill:url(#rec-g-oro)"/>
      <path d="M11 31h14l-1.6-5H12.6z" style="fill:url(#rec-g-oro)"/>
      <path d="M13 7.5v5.5" stroke="rgba(255,255,255,.7)" stroke-width="1.6" stroke-linecap="round"/>
    </symbol>
    <symbol id="rec-estrella" viewBox="0 0 20 20"><path d="M10 1.6l2.5 5.3 5.8.7-4.3 4 1.1 5.7L10 14.4 4.9 17.3 6 11.6 1.7 7.6l5.8-.7z"/></symbol>
  </defs>
</svg>`;

(function montarSpriteReconocimientos() {
  const poner = () => { if (!document.getElementById('rec-medalla')) document.body.insertAdjacentHTML('afterbegin', SPRITE_RECONOCIMIENTOS); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', poner); else poner();
})();

/** Medalla de puesto 1–3 (oro, plata, bronce). El número va en HTML sobre el SVG: accesible y con la tipografía del sistema. */
function medallaSVG(pos) {
  const n = Number(pos), tono = n === 1 ? 'oro' : n === 2 ? 'plata' : 'bronce';
  return `<span class="medalla medalla--${tono}" role="img" aria-label="Puesto ${n}"><svg viewBox="0 0 36 36" aria-hidden="true" focusable="false"><use href="#rec-medalla"/></svg><b>${n}</b></span>`;
}

/** Trofeo del «mejor resultado»: un icono de reconocimiento, no una decoración. `etiqueta` es su nombre accesible. */
function trofeoHTML(etiqueta = 'Mejor resultado') {
  return `<span class="trofeo" role="img" aria-label="${escHtml(etiqueta)}"><svg viewBox="0 0 36 36" aria-hidden="true" focusable="false"><use href="#rec-trofeo"/></svg></span>`;
}

/**
 * Estrellas que dicen el valor real. valor/max → 5 estrellas con relleno proporcional (3,5 de 5 = tres y media).
 * `etiqueta` es lo que lee un lector de pantalla («4 de 5»). Un valor ausente no pinta estrellas llenas: pinta las 5 vacías.
 */
function estrellasHTML(valor, max = 5, etiqueta = '') {
  const v = Number(valor), tiene = Number.isFinite(v);
  const frac = tiene ? Math.max(0, Math.min(1, v / max)) : 0;
  const una = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><use href="#rec-estrella"/></svg>';
  const fila = una.repeat(5);
  const txt = etiqueta || (tiene ? `${String(v).replace('.', ',')} de ${max}` : 'Sin valorar');
  return `<span class="estrellas" role="img" aria-label="${escHtml(txt)}"><span class="estrellas-base">${fila}</span><span class="estrellas-lleno" style="width:${(frac * 100).toFixed(1)}%">${fila}</span></span>`;
}
