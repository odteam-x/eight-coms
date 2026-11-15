/**
 * Contraste de los ESTADOS (pasar el ratón y foco): node tools/pruebas/ui/contraste-estados.mjs [puerto] [temas] [roles]
 * Para cada control interactivo de cada pantalla (hasta 45 por pantalla) lo pone en :hover (ratón encima) y mide el texto que
 * contiene contra el primer fondo casi opaco de su cadena de ancestros (si el control o un ancestro pinta un fondo sólido).
 * Esto detecta el caso «el hover vuelve el fondo navy pero el texto sigue oscuro» (visto en las tarjetas de persona del tema claro).
 */
import fs from 'node:fs'; import { chromium } from 'playwright-core';
const [puerto = '3100', temasArg = 'dark,light', rolesArg = 'admin,sec,miembro'] = process.argv.slice(2);
const BASE = `http://localhost:${puerto}`;
const NAV = process.env.NAVEGADOR || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const ROLES = { admin: { url: '/admin.html?as=admin', entrada: true }, sec: { url: '/secretario.html?as=sec' }, miembro: { url: '/user.html?as=m1' } };
const espera = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: NAV, headless: true });
const hall = new Map(); let medidos = 0;
const MEDIR = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = s => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const hov = [...document.querySelectorAll(':hover')].pop(); if (!hov) return [];
  const raiz = hov.closest('button, a, [role=button], .pcard, .tk-card, .eval-ucard, label, summary') || hov;
  // fondo sólido más cercano hacia arriba desde el control
  const fondo = e => { let a = e; while (a && a !== document.documentElement) { const c = rgba(getComputedStyle(a).backgroundColor); if (c[3] >= 0.9) return c; a = a.parentElement; } return null; };
  const out = [];
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode; const t = (n.nodeValue || '').trim(); if (t.length < 2) continue; const e = n.parentElement;
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const bg = fondo(e); if (!bg) continue;
    const fg = rgba(cs.color); const a = fg[3] * (parseFloat(cs.opacity) || 1);
    const R = fg[0] * a + bg[0] * (1 - a), G = fg[1] * a + bg[1] * (1 - a), B = fg[2] * a + bg[2] * (1 - a);
    const l1 = L(R, G, B), l2 = L(bg[0], bg[1], bg[2]); const cr = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const grande = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && parseInt(cs.fontWeight) >= 700);
    if (cr < (grande ? 3 : 4.5)) out.push({ t: t.slice(0, 36), s: e.tagName.toLowerCase() + '.' + [...e.classList].slice(0, 2).join('.'), cr: +cr.toFixed(2), c: cs.color, bg: `rgb(${bg.slice(0, 3).join(',')})` });
  }
  return out;
};
for (const tema of temasArg.split(',')) for (const rol of rolesArg.split(',')) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(t => { try { localStorage.setItem('ec-theme', t); } catch {} }, tema);
  const page = await ctx.newPage();
  await page.goto(BASE + ROLES[rol].url); await espera(1300);
  if (ROLES[rol].entrada) { await page.locator('#modal-entrada .btn-save').first().click().catch(() => {}); await espera(1400); }
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;scroll-behavior:auto!important}' + (process.env.INYECTAR || '') });
  const tabs = await page.evaluate(() => [...new Set([...document.querySelectorAll('.rail .rail-item[data-arg]')].map(b => b.dataset.arg).filter(t => t && document.getElementById('tab-' + t)))]);
  for (const tab of [...tabs, 'cuenta']) {
    await page.evaluate(t => { window.switchTab(t, null); window.scrollTo(0, 0); }, tab).catch(() => {}); await espera(1000);
    const n = await page.evaluate(() => { document.querySelectorAll('[data-hv]').forEach(e => e.removeAttribute('data-hv')); const raiz = document.querySelector('.atab-content.active, .tab-content.active') || document.body; const v = []; raiz.querySelectorAll('button, a[href], [role=button], .pcard, summary, label.chip').forEach((e, i) => { const r = e.getBoundingClientRect(); if (r.width > 20 && r.height > 14 && r.top >= 0 && r.bottom <= innerHeight && !e.closest('details:not([open])')) { e.setAttribute('data-hv', String(v.length)); v.push(i); } }); return Math.min(v.length, 45); });
    if (process.env.DEBUG) console.log('  pantalla', tab, 'candidatos', n);
    for (let i = 0; i < n; i++) {
      const box = await page.locator(`[data-hv="${i}"]`).first().boundingBox().catch(() => null); if (!box) continue;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await espera(60);
      const res = await page.evaluate(MEDIR).catch(() => []);
      for (const r of res) { medidos++; const k = [tema, rol, tab, r.s, r.t].join(' | '); if (!hall.has(k)) hall.set(k, r); }
    }
    await page.mouse.move(2, 2);
  }
  await ctx.close(); console.log(`· ${tema} ${rol}: acumulado ${hall.size}`);
}
await browser.close();
console.log(`\n${hall.size} textos bajo el mínimo al pasar el ratón`);
for (const [k, r] of [...hall.entries()].sort((a, b) => a[1].cr - b[1].cr).slice(0, 40)) console.log(`  ${r.cr}:1  ${k}  fg=${r.c} bg=${r.bg}`);
process.exit(hall.size ? 1 : 0);
