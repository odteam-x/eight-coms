/**
 * Barrido de «caja dentro de caja»: node tools/pruebas/ui/cajas.mjs [puerto] [anchos] [temas]
 *
 * Los controles de selección (.seg pestañas, .pe-row períodos, .chip-row filtros, .filtros-fila, inputs de búsqueda) ya son una
 * píldora con su propio fondo. Si el ancestro más cercano que los contiene TAMBIÉN pinta fondo o borde y no es una tarjeta de
 * contenido (.tarjeta/.pf-card/.lista-aj/panel/modal), se lee como una caja dentro de otra. Imprime pantalla + ancestro.
 */
import fs from 'node:fs'; import { chromium } from 'playwright-core';
const [puerto = '3100', anchosArg = '1440,390', temasArg = 'dark'] = process.argv.slice(2);
const BASE = `http://localhost:${puerto}`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROLES = [{ id: 'admin', url: '/admin.html?as=admin', entrada: true }, { id: 'secretaria', url: '/secretario.html?as=sec' }, { id: 'miembro', url: '/user.html?as=m1' }];
const espera = ms => new Promise(r => setTimeout(r, ms));
const hall = new Map();
const MEDIR = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const alfa = c => { if (!c || c === 'transparent') return 0; cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); return cx.getImageData(0, 0, 1, 1).data[3] / 255; };
  const sel = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].slice(0, 3).map(c => '.' + c).join('');
  const pinta = e => { const cs = getComputedStyle(e); return alfa(cs.backgroundColor) > 0.03 || (parseFloat(cs.borderTopWidth) > 0 && alfa(cs.borderTopColor) > 0.03); };
  const LEGIT = '.tarjeta, .pf-card, .lista-aj, .panel, .modal-box, .tk-box, .sup-marca, .kpi, .pcard, .aviso, .fila-aj, .bottom-bar, .cab-movil, .rail, .hoja, .tk-card, .cal2, .cal2-agenda, .seg, .chip-row, td, th, form, label, .modal-overlay';
  const out = [];
  document.querySelectorAll('.seg, .pe-row, .chip-row, .filtros-fila, .search-inp').forEach(s => {
    const r = s.getBoundingClientRect(); if (r.width < 60 || r.height < 20 || !r.width) return;
    if (s.closest('[hidden]') || getComputedStyle(s).display === 'none') return;
    let a = s.parentElement;
    while (a && a !== document.body) {
      if (pinta(a)) break; a = a.parentElement;
    }
    if (!a || a === document.body) return;
    if (a.matches(LEGIT) || a.closest('.modal-overlay, .panel-overlay') && a.matches('.panel-cab')) return;
    const ra = a.getBoundingClientRect();
    // solo cuenta si el ancestro es «una barra» alrededor del control (no una tarjeta grande con más contenido)
    if (ra.height > r.height * 3.2 + 40) return;
    if (parseFloat(getComputedStyle(a).borderTopLeftRadius) === 0) return;   // banda de borde a borde sin esquinas (barra fija de celular): no parece una caja
    out.push({ s: sel(s), a: sel(a), h: Math.round(ra.height) });
  });
  return out;
};
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
for (const tema of temasArg.split(',')) for (const ancho of anchosArg.split(',').map(Number)) for (const rol of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: 900 }, isMobile: ancho < 768, hasTouch: ancho < 768 });
  await ctx.addInitScript(t => { try { localStorage.setItem('ec-theme', t); } catch {} }, tema);
  const page = await ctx.newPage(); await page.goto(BASE + rol.url); await espera(1400);
  if (rol.entrada) { await page.locator('#modal-entrada .btn-save').first().click().catch(() => {}); await espera(1500); }
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
  const tabs = await page.evaluate(() => [...new Set([...document.querySelectorAll('.rail .rail-item[data-arg], .bottom-bar [data-arg], .hoja [data-arg]')].map(b => b.dataset.arg).filter(t => t && document.getElementById('tab-' + t)))]);
  tabs.push('cuenta');
  const rev = async n => { const r = await page.evaluate(MEDIR).catch(() => []); for (const h of r) hall.set([rol.id, ancho, tema, n, h.s, '←', h.a].join(' · '), h); };
  for (const t of [...new Set(tabs)]) { await page.evaluate(t => { window.switchTab(t, null); window.scrollTo(0, 0); }, t).catch(() => {}); await espera(1100); await rev('tab-' + t); }
  for (const [n, f] of [['perfil', () => document.querySelector('[data-act="perfilVer"]')?.click()], ['avisos', () => [...document.querySelectorAll('button')].find(b => /Avisos/.test(b.getAttribute('aria-label') || ''))?.click()]]) {
    await page.evaluate(f).catch(() => {}); await espera(1500); await rev(n); await page.keyboard.press('Escape').catch(() => {}); await espera(300);
  }
  await ctx.close();
}
await browser.close();
for (const k of hall.keys()) console.log(k);
console.log(`\n${hall.size} hallazgos`);
