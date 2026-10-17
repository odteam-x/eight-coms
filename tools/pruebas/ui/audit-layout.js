/**
 * Auditoría de layout y objetivos táctiles sobre el DOM real (solo desarrollo; no se despliega).
 * ─────────────────────────────────────────────────────────────────────────
 * Complementa audit-dom.js (contraste). Por cada pestaña visible mide:
 *   · overflow  elementos que se salen del viewport sin un ancestro con scroll horizontal.
 *               `body { overflow-x: hidden }` oculta el desbordamiento, así que
 *               scrollWidth NO sirve: se miden los rectángulos.
 *   · small     controles interactivos por debajo de 44×44 (el mínimo del proyecto
 *               con puntero grueso; WCAG 2.2 AA exige 24×24).
 *   · tiny      texto por debajo de 12,8 px (--fs-xs).
 *   · noname    controles sin nombre accesible (texto, aria-label, label, title).
 *
 * Carga:  const s=document.createElement('script'); s.src='/tools/pruebas/ui/audit-layout.js';
 *         document.head.appendChild(s);   // same-origin: la CSP lo permite
 * Uso:    __aud()                        → informe de la vista actual
 *         await __sweep(['overview',…])  → informe compacto por pestaña (usa switchTab del portal)
 */
(function () {
  const sel = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const vis = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const scrollAnc = el => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) return true;
    }
    return false;
  };
  const nombre = el => el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.textContent.trim() ||
    el.title || (el.labels && el.labels.length) || el.querySelector('img[alt]:not([alt=""])');

  window.__aud = function () {
    const vw = innerWidth;
    const out = { vw, overflow: [], small: [], tiny: [], noname: [] };
    document.querySelectorAll('body *').forEach(el => {
      if (!vis(el) || el.closest('[aria-hidden=true],[hidden],.skip-link')) return;
      const r = el.getBoundingClientRect();
      if ((r.right > vw + 1 || r.left < -1) && !scrollAnc(el) && getComputedStyle(el).position !== 'fixed')
        out.overflow.push(sel(el) + ' ' + Math.round(r.left) + '→' + Math.round(r.right));
      if (el.matches('button,a[href],[role=button],[role=tab],input:not([type=hidden]),select,textarea,summary')) {
        const enTexto = el.tagName === 'A' && el.closest('p,li,span,small') && el.parentElement.childNodes.length > 1;
        // Una casilla o radio dentro de un <label> grande: el objetivo táctil es el label entero.
        const lbl = el.matches('input[type=checkbox],input[type=radio]') && el.closest('label');
        const enLabel = lbl && lbl.getBoundingClientRect().height >= 44 && lbl.getBoundingClientRect().width >= 44;
        if ((r.height < 44 || r.width < 44) && !enTexto && !enLabel)
          out.small.push(sel(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.getAttribute('aria-label') || el.textContent.trim()).slice(0, 20) + '"');
        if (!nombre(el)) out.noname.push(sel(el));
      }
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 12.7 && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
        out.tiny.push(sel(el) + ' ' + fs + 'px "' + el.textContent.trim().slice(0, 16) + '"');
    });
    const u = a => [...new Set(a)];
    out.overflow = u(out.overflow).slice(0, 15); out.tiny = u(out.tiny).slice(0, 15); out.noname = u(out.noname).slice(0, 15);
    out.small = u(out.small); out.smallN = out.small.length; out.small = out.small.slice(0, 25);
    out.docScroll = document.documentElement.scrollWidth - vw;
    return out;
  };

  window.__sweep = async function (tabs, esperaMs) {
    const res = {};
    for (const t of tabs) {
      try { switchTab(t); } catch (e) { res[t] = { err: String(e) }; continue; }
      await new Promise(r => setTimeout(r, esperaMs || 1100));
      const a = __aud();
      res[t] = { ov: a.overflow.length ? a.overflow.slice(0, 5) : 0, small: a.smallN, smallEx: a.small.slice(0, 6), tiny: a.tiny.slice(0, 4), noname: a.noname, doc: a.docScroll };
    }
    return res;
  };
})();
