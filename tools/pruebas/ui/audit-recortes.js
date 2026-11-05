/**
 * Detector de RECORTES (solo desarrollo; no se despliega).
 * audit-layout.js mide lo que se sale del viewport; esto mide lo que un CONTENEDOR corta:
 *   · clip     un elemento visible cuyo rectángulo sobresale del de un ancestro con overflow
 *              hidden/clip (o scroll horizontal que no se ofrece al usuario) — la media luna
 *              del avatar y las tarjetas cortadas de las capturas del usuario.
 *   · texto    texto cortado sin elipsis (scrollWidth > clientWidth en overflow hidden).
 *   · carrusel contenedor con scroll horizontal cuyos hijos son tarjetas (patrón a evitar:
 *              deja vecinas cortadas a los lados).
 * Carga:  const s=document.createElement('script'); s.src='/tools/pruebas/ui/audit-recortes.js'; document.head.appendChild(s)
 * Uso:    __rec()   → informe de la vista actual
 *         await __recSweep(['overview',…]) → por pestaña (switchTab del portal)
 */
(function () {
  const sel = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const vis = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const recorta = cs => /(hidden|clip)/.test(cs.overflowX) || /(hidden|clip)/.test(cs.overflowY);

  window.__rec = function () {
    const out = { clip: [], texto: [], carrusel: [] };
    document.querySelectorAll('body *').forEach(el => {
      if (!vis(el) || el.closest('[aria-hidden=true],[hidden],[inert],.sr-only,.skip-link')) return;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed') return;
      const r = el.getBoundingClientRect();
      // 1) ancestros que recortan
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const pc = getComputedStyle(p);
        if (pc.position === 'fixed' && p !== el.parentElement) { /* sigue */ }
        // un ancestro con scroll en el eje ofrece el contenido al usuario: no es recorte
        if (/(auto|scroll)/.test(pc.overflowX) && r.right > p.getBoundingClientRect().right + 2) break;
        if (!recorta(pc)) continue;
        // un absoluto cuyo bloque contenedor está por encima del recortador no se recorta
        if (cs.position === 'absolute') {
          let cb = el.offsetParent; if (!cb || !p.contains(cb) && cb !== p) break;
        }
        const pr = p.getBoundingClientRect();
        if (pr.width < 2 || pr.height < 2) continue;
        const dx = Math.max(pr.left - r.left, r.right - pr.right, 0), dy = Math.max(pr.top - r.top, r.bottom - pr.bottom, 0);
        const ox = /(hidden|clip)/.test(pc.overflowX), oy = /(hidden|clip)/.test(pc.overflowY);
        if ((ox && dx > 2) || (oy && dy > 2)) {
          out.clip.push(sel(el) + ' (' + Math.round(r.width) + 'x' + Math.round(r.height) + ') en ' + sel(p) + ' −' + Math.round(ox ? dx : 0) + 'x/−' + Math.round(oy ? dy : 0) + 'y');
          break;
        }
      }
      // 2) texto cortado sin elipsis
      if (recorta(cs) && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
        out.texto.push(sel(el) + ' ' + el.scrollWidth + '>' + el.clientWidth + ' "' + el.textContent.trim().slice(0, 24) + '"');
      // 3) carrusel de tarjetas
      if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2) {
        const hijos = [...el.children].filter(vis);
        if (hijos.length > 1 && hijos.every(h => h.getBoundingClientRect().height > 80)) out.carrusel.push(sel(el) + ' ' + hijos.length + ' hijos');
      }
    });
    const u = a => [...new Set(a)].slice(0, 25);
    out.clip = u(out.clip); out.texto = u(out.texto); out.carrusel = u(out.carrusel);
    out.n = out.clip.length + out.texto.length + out.carrusel.length;
    return out;
  };

  window.__recSweep = async function (tabs, esperar = 700) {
    const res = {};
    for (const t of tabs) {
      try { (window.switchTab || window.irATab || (() => {}))(t); } catch (e) {}
      await new Promise(r => setTimeout(r, esperar));
      const o = __rec(); if (o.n) res[t] = o;
    }
    return res;
  };
})();
