/**
 * Contraste REAL en pantalla (lo que ve la persona, no solo los tokens): node tools/pruebas/ui/contraste-dom.mjs [puerto] [anchos] [temas] [roles]
 *
 * Por cada pantalla: lista cada texto visible con su color calculado, apaga el texto (color transparente), hace una captura y
 * mide el FONDO REAL detrás de cada texto (incluye mallas, degradados, vidrio y patrones), compone el color del texto sobre ese
 * fondo y calcula la razón WCAG. Falla bajo 4.5:1 (texto normal) o 3:1 (texto grande ≥ 24 px, o ≥ 18,66 px en negrita).
 */
import fs from 'node:fs'; import { chromium } from 'playwright-core';
const [puerto = '3100', anchosArg = '1440,390', temasArg = 'dark,light', rolesArg = 'admin,sec,miembro'] = process.argv.slice(2);
const BASE = `http://localhost:${puerto}`;
const NAV = process.env.NAVEGADOR || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const ROLES = { admin: { url: '/admin.html?as=admin', entrada: true }, sec: { url: '/secretario.html?as=sec' }, miembro: { url: '/user.html?as=m1' } };
const espera = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: NAV, headless: true });
const falla = new Map(); let medidos = 0, pantallas = 0;

const LISTAR = () => {
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const vistos = new Set();
  while (w.nextNode()) {
    const n = w.currentNode; const t = (n.nodeValue || '').trim(); if (t.length < 2) continue;
    const e = n.parentElement; if (!e || vistos.has(e)) continue;
    if (e.closest('script,style,noscript,[hidden],[inert],.sr-only,option,svg')) continue;
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.05) continue;
    // rango real del texto
    const rg = document.createRange(); rg.selectNodeContents(n); const r = rg.getBoundingClientRect();
    if (r.width < 6 || r.height < 6 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    // ¿se ve entero? Se comprueban cinco puntos del texto: si otro elemento (barra inferior, cabecera, panel) lo cubre o lo recorta
    // en alguno, no se mide (su fondo no es el que se ve) — la misma prueba que haría el ojo.
    const pts = [[.5, .5], [.12, .5], [.88, .5], [.5, .2], [.5, .8]];
    const tapado = pts.some(([fx, fy]) => { const px = Math.min(innerWidth - 1, Math.max(0, r.left + r.width * fx)), py = Math.min(innerHeight - 1, Math.max(0, r.top + r.height * fy)); const top = document.elementFromPoint(px, py); return !top || !e.contains(top); });
    if (tapado) continue;
    vistos.add(e);
    let op = 1; for (let a = e; a && a !== document.documentElement; a = a.parentElement) op *= parseFloat(getComputedStyle(a).opacity) || 1;
    out.push({ t: t.slice(0, 40), s: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + [...e.classList].slice(0, 3).join('.'), c: cs.color, op, fs: parseFloat(cs.fontSize), fw: parseInt(cs.fontWeight) || 400, x: r.left, y: r.top, w: r.width, h: r.height });
  }
  return out.slice(0, 700);
};
const analizar = async (page, items) => page.evaluate(async ([items, b64]) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const cc = document.createElement('canvas'); cc.width = cc.height = 1; const c2 = cc.getContext('2d', { willReadFrequently: true });
  const rgba = s => { c2.clearRect(0, 0, 1, 1); c2.fillStyle = '#000'; c2.fillStyle = s; c2.fillRect(0, 0, 1, 1); const d = c2.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const res = [];
  const k = img.width / innerWidth;   // la captura puede venir a otra densidad de píxeles que los px CSS
  for (const it of items) {
    const x = Math.max(0, Math.floor(it.x * k)), y = Math.max(0, Math.floor(it.y * k)), w = Math.min(img.width - x, Math.ceil(it.w * k)), h = Math.min(img.height - y, Math.ceil(it.h * k));
    if (w < 2 || h < 2) continue;
    const d = cx.getImageData(x, y, w, h).data; const L = [];
    for (let i = 0; i < d.length; i += 4 * Math.max(1, Math.floor(d.length / 4 / 80))) L.push([d[i], d[i + 1], d[i + 2]]);
    // el PEOR fondo (el que menos contrasta con el texto) entre los muestreados: un texto debe leerse sobre todo su rectángulo
    const [fr, fg, fb, fa0] = rgba(it.c); const fa = fa0 * it.op;
    let peor = 99, bgPeor = null;
    for (const [r, g, b] of L) {
      const R = Math.round(fr * fa + r * (1 - fa)), G = Math.round(fg * fa + g * (1 - fa)), B = Math.round(fb * fa + b * (1 - fa));
      const l1 = lum(R, G, B), l2 = lum(r, g, b); const cr = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (cr < peor) { peor = cr; bgPeor = [r, g, b]; }
    }
    const grande = it.fs >= 24 || (it.fs >= 18.66 && it.fw >= 700);
    res.push({ ...it, cr: peor, bg: bgPeor, grande });
  }
  return res;
}, [items, page.__b64]);

for (const tema of temasArg.split(',')) for (const ancho of anchosArg.split(',').map(Number)) for (const rol of rolesArg.split(',')) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: ancho < 768 ? 844 : 900 }, isMobile: ancho < 768, hasTouch: ancho < 768 });
  await ctx.addInitScript(t => { try { localStorage.setItem('ec-theme', t); } catch {} }, tema);
  const page = await ctx.newPage();
  await page.goto(BASE + ROLES[rol].url); await espera(1300);
  if (ROLES[rol].entrada) { await page.locator('#modal-entrada .btn-save').first().click().catch(() => {}); await espera(1400); }
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;scroll-behavior:auto!important}' });
  await page.waitForFunction(t => (document.documentElement.getAttribute('data-theme') === 'light') === (t === 'light'), tema, { timeout: 8000 }).catch(() => {});
  await espera(700);
  const tabs = await page.evaluate(() => [...new Set([...document.querySelectorAll('.rail .rail-item[data-arg], .bottom-bar [data-arg], .hoja [data-arg]')].map(b => b.dataset.arg).filter(t => t && document.getElementById('tab-' + t)))]);
  tabs.push('cuenta');
  const superficies = [...new Set(tabs)].map(t => ['tab-' + t, () => page.evaluate(t => { window.switchTab(t, null); window.scrollTo(0, 0); }, t)]);
  superficies.push(['avisos', async () => { await page.evaluate(() => window.switchTab(document.querySelector('.rail .rail-item[data-arg], .bottom-bar [data-arg]')?.dataset.arg, null)); await page.evaluate(() => [...document.querySelectorAll('button,a')].find(b => /Avisos/.test(b.getAttribute('aria-label') || ''))?.click()); }]);
  // Superficies abiertas desde cada pantalla: el primer botón «Nueva/Nuevo/Añadir/Crear» (formularios y diálogos), el buscador y, en celular, la hoja «Más».
  for (const t of [...new Set(tabs)].filter(t => t !== 'cuenta')) superficies.push(['dialogo-' + t, async () => {
    await page.evaluate(t => { window.switchTab(t, null); window.scrollTo(0, 0); }, t); await espera(900);
    await page.evaluate(() => { const raiz = document.querySelector('.atab-content.active, .tab-content.active') || document.body; const b = [...raiz.querySelectorAll('button, a')].find(x => /^[+\s]*(Nueva|Nuevo|Añadir|Crear|Agregar)/i.test((x.textContent || '').trim()) && x.getBoundingClientRect().width > 0); b?.click(); });
  }]);
  superficies.push(['buscador', async () => { await page.keyboard.press('Control+K'); }]);
  if (ancho < 768) superficies.push(['mas', async () => { await page.evaluate(() => document.querySelector('.bottom-bar [data-act="masDestinos"], .bottom-bar .bb-mas, .bottom-bar button:last-child')?.click()); }]);
  superficies.push(['perfil', async () => { await page.evaluate(() => document.querySelector('[data-act="perfilVer"]')?.click()); }]);
  for (const [nombre, ir] of superficies) {
    await ir().catch(() => {}); await espera(1300);
    const items = await page.evaluate(LISTAR);
    await page.addStyleTag({ content: '*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}' }).then(h => (page.__st = h));
    await espera(150);
    const png = await page.screenshot({ type: 'png' });
    await page.__st.evaluate(e => e.remove());
    page.__b64 = png.toString('base64');
    const res = await analizar(page, items); pantallas++;
    for (const r of res) {
      medidos++;
      const min = r.grande ? 3 : 4.5;
      if (r.cr < min) { const k = [tema, ancho, rol, nombre, r.s, r.t].join(' | '); if (!falla.has(k)) falla.set(k, r); }
    }
    await page.keyboard.press('Escape').catch(() => {}); await espera(200);
  }
  await ctx.close();
  console.log(`· ${tema} ${ancho}px ${rol}: ${superficies.length} pantallas, fallos acumulados ${falla.size}`);
}
await browser.close();
console.log(`\n${pantallas} pantallas · ${medidos} textos medidos · ${falla.size} bajo el mínimo`);
const orden = [...falla.entries()].sort((a, b) => a[1].cr - b[1].cr);
for (const [k, r] of orden.slice(0, 60)) console.log(`  ${r.cr.toFixed(2)}:1 (mín ${r.grande ? 3 : 4.5})  ${k}  fg=${r.c}  bg=rgb(${(r.bg || []).join(',')})`);
fs.writeFileSync('docs/evidencias/contraste-dom.json', JSON.stringify(orden.map(([k, r]) => ({ k, cr: +r.cr.toFixed(2), fg: r.c, bg: r.bg })), null, 1));
process.exit(falla.size ? 1 : 0);
