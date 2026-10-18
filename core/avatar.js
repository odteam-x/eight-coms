'use strict';
/**
 * EIGHT CREATORS LABs — Avatar de persona (UN componente para todo el sitio)
 * ───────────────────────────────────────────────────────────────────────────
 * Ninguna pantalla resuelve una foto por su cuenta: todas piden `Avatar.html(persona, { tam })`
 * (o `Avatar.interior(persona)` cuando el contenedor ya existe, como el rail o el perfil editable).
 *
 * TODA persona tiene imagen visible, haya subido foto o no:
 *   1. el avatar PREDETERMINADO es siempre el que se pinta primero: las iniciales sobre el patrón de la marca que la
 *      persona eligió (`Fondo.clase`, el mismo de su tarjeta de perfil; sin elección, el que sale de su id). Son los
 *      recursos que ya teníamos (los siete patrones), no hay imágenes de avatar nuevas;
 *   2. si hay `avatar_url` válida, la foto se superpone. Mientras carga, o si falla, se ve el predeterminado: no hay
 *      icono de imagen rota, ni hueco, ni «null»/«undefined» (esos valores se tratan como «sin foto»);
 *   3. un listener delegado (la CSP prohíbe `onerror` en el marcado) marca `avatar--sin-img` cuando una foto da error
 *      y la oculta. `error` no sube por el DOM: se escucha en fase de captura.
 *
 * Tamaño y forma salen solo del CSS (`.avatar` en shared.css): círculo 1:1, recorte `object-fit: cover`, mismo tamaño en
 * escritorio, tablet y celular. Tamaños: xs 28 · sm 36 · md 48 (por defecto) · lg 64 · xl 96 · xxl 112.
 *
 * Todo texto humano pasa por escHtml. Depende de: core/render.js (escHtml vive en config.js; initials aquí).
 */
const Avatar = (() => {
  const TAMS = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'];

  /** Una URL usable: texto no vacío, ni «null»/«undefined» escritos como cadena, ni javascript:. */
  function urlValida(u) {
    if (typeof u !== 'string') return false;
    const t = u.trim();
    return !!t && !/^(null|undefined|false|0)$/i.test(t) && !/^javascript:/i.test(t);
  }

  const _nombre = p => (p && (p.nombre || p.name || p.email || p.user)) || '';
  const _pat = p => (typeof Fondo !== 'undefined' && p ? Fondo.clase(p) : 0);

  /** Iniciales (o el icono de persona si no hay ni nombre) + la foto encima, si existe. */
  function interior(p, { bust = false } = {}) {
    const n = String(_nombre(p)).trim();
    const ini = n ? initials(n) : '';
    const vacio = !ini || ini === '?';
    const base = vacio && typeof _ICONO_USUARIO !== 'undefined' ? _ICONO_USUARIO : escHtml(ini || '?');
    const src = urlValida(p && p.avatar_url) ? p.avatar_url + (bust ? (String(p.avatar_url).includes('?') ? '&' : '?') + 't=' + Date.now() : '') : '';
    return `<span class="avatar-ini" aria-hidden="true">${base}</span>${src ? `<img class="avatar-img" src="${escHtml(src)}" alt="" loading="lazy" decoding="async" draggable="false">` : ''}`;
  }

  /** Clases del contenedor: base, tamaño y patrón de la persona. */
  const clases = (p, tam = 'md') => `avatar avatar--${TAMS.includes(tam) ? tam : 'md'} pat-${_pat(p)}`;

  /** Avatar completo. `clase` y `attrs` añaden clases y atributos propios del contexto (ya escapados por quien llama). */
  function html(p, { tam = 'md', tag = 'span', clase = '', attrs = '', bust = false } = {}) {
    return `<${tag} class="${clases(p, tam)}${clase ? ' ' + escHtml(clase) : ''}"${attrs ? ' ' + attrs : ''}>${interior(p, { bust })}</${tag}>`;
  }

  /** Pinta (o repinta) un contenedor que ya existe, conservando sus otras clases (#av-desktop, #av-hoja). */
  function pintar(el, p, { tam = 'md', bust = false } = {}) {
    if (!el) return;
    el.className = [...el.classList].filter(c => !/^avatar--|^pat-\d$/.test(c) && c !== 'avatar--sin-img').concat(clases(p, tam).split(' ')).filter((c, i, a) => a.indexOf(c) === i).join(' ');
    el.innerHTML = interior(p, { bust });
  }

  // La foto que falla deja ver el predeterminado. Captura: `error` no burbujea.
  document.addEventListener('error', e => {
    const img = e.target;
    if (img && img.tagName === 'IMG' && img.classList.contains('avatar-img')) img.closest('.avatar')?.classList.add('avatar--sin-img');
  }, true);

  return { html, interior, pintar, clases, urlValida, TAMS };
})();
