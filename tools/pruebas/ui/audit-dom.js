/**
 * Auditoría de contraste sobre el DOM real (solo desarrollo; no se despliega).
 * ─────────────────────────────────────────────────────────────────────────
 * tools/contraste.js mide pares de TOKENS. Esto mide lo que de verdad se
 * pinta: para cada elemento con texto propio, su color computado contra el
 * fondo efectivo (se sube por los ancestros componiendo las transparencias).
 * Si el fondo es una imagen o un degradado, el elemento se marca «?» y se
 * mide contra el color base del degradado más claro que encuentra.
 *
 * Carga:  const s=document.createElement('script'); s.src='/tools/pruebas/ui/audit-dom.js';
 *         document.head.appendChild(s);   // same-origin: la CSP lo permite
 * Uso:    __contraste()  →  { revisados, fallos:[{txt, ratio, min, sel, fg, bg}] }
 */
(function () {
  const parse = c => {
    const m = /rgba?\(([^)]+)\)/.exec(c) || /color\(srgb ([^)]+)\)/.exec(c);
    if (!m) return null;
    if (c.startsWith('color(')) {
      const p = m[1].split(/[ /]+/).map(Number);
      return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1];
    }
    const p = m[1].split(/[,/ ]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const over = (f, b) => { const a = f[3]; return [0, 1, 2].map(i => f[i] * a + b[i] * (1 - a)).concat(1); };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };

  /** Primer color de un degradado/imagen, para estimar el fondo. */
  const colorDeImagen = bi => {
    const cols = [...bi.matchAll(/rgba?\([^)]+\)|color\(srgb [^)]+\)/g)].map(m => parse(m[0])).filter(Boolean);
    return cols.length ? cols[0] : null;
  };

  function fondo(el) {
    const capas = [];
    let imagen = false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const c = parse(cs.backgroundColor);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        imagen = true;
        const ci = colorDeImagen(cs.backgroundImage);
        if (ci && ci[3] >= 0.99) { capas.push(ci); break; }
      }
      if (c && c[3] > 0) { capas.push(c); if (c[3] >= 0.99) break; }
    }
    let base = [255, 255, 255, 1];
    for (let i = capas.length - 1; i >= 0; i--) base = over(capas[i], base);
    return { base, imagen };
  }

  window.__contraste = function () {
    const fallos = []; let n = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const vistos = new Set();
    while (walker.nextNode()) {
      const t = walker.currentNode;
      if (!t.nodeValue.trim()) continue;
      const el = t.parentElement;
      if (!el || vistos.has(el)) continue;
      vistos.add(el);
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (el.closest('.sr-only, script, style, [hidden]')) continue;
      let a = el, oculto = false;
      while (a && a !== document.body) { const s = getComputedStyle(a); if (s.display === 'none' || s.visibility === 'hidden') { oculto = true; break; } a = a.parentElement; }
      if (oculto) continue;
      const fg0 = parse(cs.color); if (!fg0) continue;
      const { base, imagen } = fondo(el);
      const fg = over(fg0, base);
      const px = parseFloat(cs.fontSize), peso = +cs.fontWeight || 400;
      const grande = px >= 24 || (px >= 18.66 && peso >= 700);
      const min = grande ? 3 : 4.5;
      const q = ratio(fg, base);
      n++;
      if (q < min) fallos.push({
        txt: t.nodeValue.trim().slice(0, 36), ratio: +q.toFixed(2), min,
        sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
        fg: cs.color, bg: `rgb(${base.slice(0, 3).map(Math.round)})`, img: imagen ? '?' : '',
      });
    }
    fallos.sort((x, y) => x.ratio - y.ratio);
    return { tema: document.documentElement.dataset.theme || 'dark', revisados: n, fallos: fallos.slice(0, 25), total: fallos.length };
  };
})();
