/* Medidor responsive para el simulador (`npm run ui`). Lo sirve server.mjs en /__medir.js; se carga con
 *   const s = document.createElement('script'); s.src = '/__medir.js'; document.head.appendChild(s);
 * y se usa:  await __medir()  →  { vw, pestanas, problemas: { pestaña: [texto…] } }   (problemas vacío = limpio)
 *
 * Por cada pestaña del portal mide, al ancho de ventana actual:
 *   · desborde horizontal real: elementos visibles que se salen por la derecha o izquierda, SIN contar los que quedan
 *     recortados por un contenedor con scroll/overflow propio ni los cajones fuera de pantalla;
 *   · en celular (≤430 px) botones, selects, campos y pestañas de menos de 44 px de alto (o de ancho si son botones).
 * No sustituye mirar las pantallas: dice dónde mirar. Un `document.documentElement.scrollWidth` solo NO sirve aquí:
 * `body { overflow-x: hidden }` lo oculta, por eso se miden los rectángulos. */
window.__medir = async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const vw = innerWidth, movil = vw <= 430, res = { vw, problemas: {} };
  const sel = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const recortado = e => {
    for (let p = e.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) { const r = p.getBoundingClientRect(); if (r.left >= -1 && r.right <= vw + 1) return true; }
    }
    return false;
  };
  const medir = tab => {
    const p = [];
    const docDes = document.documentElement.scrollWidth > vw + 1;
    const fuera = [];
    for (const e of document.querySelectorAll('body *')) {
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;
      const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (e.closest('.sr-only,[hidden],svg,[inert]') || recortado(e)) continue;
      let cajon = false;
      for (let q = e; q; q = q.parentElement) { const c = getComputedStyle(q); if (c.position === 'fixed' && (/translate|matrix/.test(c.transform) || r.left >= vw)) { cajon = true; break; } }
      if (cajon || (!e.offsetParent && cs.position !== 'fixed')) continue;
      fuera.push(sel(e) + ` [${Math.round(r.left)}→${Math.round(r.right)}]`);
    }
    if (docDes && fuera.length) p.push('desborde horizontal: ' + fuera.slice(0, 4).join(' | '));
    else if (docDes) p.push('scrollWidth > viewport (ningún elemento visible lo explica)');
    if (movil) {
      const peq = [...document.querySelectorAll('button,select,input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea,[role=tab],[role=button]')]
        .filter(e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
          return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && e.offsetParent !== null && !e.closest('.sr-only,[hidden]')
            && (r.height < 43.5 || (r.width < 43.5 && !/(input|select|textarea)/i.test(e.tagName))); })
        .map(e => { const r = e.getBoundingClientRect(); return sel(e) + ` ${Math.round(r.width)}x${Math.round(r.height)}`; });
      if (peq.length) p.push(`${peq.length} objetivo(s) táctil(es) <44px: ` + peq.slice(0, 4).join(' | '));
    }
    if (p.length) res.problemas[tab] = p;
  };
  document.querySelector('#modal-entrada [data-arg="entrarConSeleccion"], #modal-entrada [data-act="fn"]')?.click();
  await wait(900);
  const tabs = [...new Set([...document.querySelectorAll('#rail [data-arg], #bottom-bar [data-arg]')].map(b => b.dataset.arg))]
    .filter(v => v && v !== 'toggleTheme' && typeof switchTab === 'function');
  medir('(inicial)');
  for (const t of tabs) { try { switchTab(t, null); } catch (e) { res.problemas[t] = ['error: ' + e.message]; continue; } await wait(900); medir(t); }
  res.pestanas = tabs.length;
  return res;
};
