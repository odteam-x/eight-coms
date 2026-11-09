/**
 * Barrido de superposiciones con el vidrio: node tools/pruebas/ui/capas.mjs [puerto] [anchos] [temas]
 *
 * En cada pantalla REAL de cada rol (pestañas del menú + avisos, buscador, perfil, Mi cuenta), con contenido desplazado, busca
 * los elementos fijos o pegajosos (position fixed/sticky, o los que flotan sobre una lista que se desplaza) y falla si alguno:
 *   · tiene fondo translúcido (alfa < .9) sin desenfoque que lo rescate → el contenido de debajo se ve a través;
 *   · o es tapado por otro elemento en los puntos que se muestrean (orden de capas roto).
 * Imprime una línea por hallazgo (rol · ancho · tema · pantalla · selector · alfa) y sale con 1 si hay alguno.
 */
import fs from 'node:fs'; import { chromium } from 'playwright-core';
const [puerto = '3100', anchosArg = '1440,390', temasArg = 'dark,light'] = process.argv.slice(2);
const BASE = `http://localhost:${puerto}`;
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'].find(f => fs.existsSync(f));
const ROLES = [{ id: 'admin', url: '/admin.html?as=admin', entrada: true }, { id: 'secretaria', url: '/secretario.html?as=sec' }, { id: 'miembro', url: '/user.html?as=m1' }];
const espera = ms => new Promise(r => setTimeout(r, ms));
const hallazgos = new Map();

const MEDIR = () => {
  // alfa efectivo de un color computado (rgb/rgba/color(srgb …)/oklab…): se pinta en un canvas 1×1 y se lee el alfa.
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const alfa = c => { if (!c || c === 'transparent') return 0; cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); return cx.getImageData(0, 0, 1, 1).data[3] / 255; };
  const sel = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].slice(0, 3).map(c => '.' + c).join('');
  // se desplaza cada contenedor con scroll para que haya contenido pasando por debajo
  document.querySelectorAll('*').forEach(e => { if (e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY) && e !== document.documentElement) e.scrollTop = 80; });
  window.scrollTo(0, 90);
  const out = [];
  document.querySelectorAll('*').forEach(e => {
    const cs = getComputedStyle(e);
    if (!/fixed|sticky/.test(cs.position) || cs.visibility === 'hidden' || cs.display === 'none') return;
    const r = e.getBoundingClientRect(); if (r.width < 40 || r.height < 24 || r.bottom < 0 || r.top > innerHeight) return;
    if (e.closest('[hidden], [inert]') || cs.opacity === '0' || cs.pointerEvents === 'none') return;
    const a = alfa(cs.backgroundColor), blur = /blur/.test(cs.backdropFilter || cs.webkitBackdropFilter || '');
    // los fondos transparentes que solo posicionan (contenedores sin pintura) no tapan nada: se ignoran salvo que lleven borde o sombra
    const pinta = a > 0 || (cs.boxShadow && cs.boxShadow !== 'none') || /px/.test(cs.borderTopWidth) && alfa(cs.borderTopColor) > 0;
    const traslucido = a > 0 && a < 0.9 && !blur;
    // ¿lo tapa algo? se muestrean cinco puntos
    const pts = [[.5, .5], [.15, .5], [.85, .5], [.5, .2], [.5, .8]]; let tapado = 0;
    pts.forEach(([x, y]) => { const px = Math.min(innerWidth - 1, Math.max(0, r.left + r.width * x)), py = Math.min(innerHeight - 1, Math.max(0, r.top + r.height * y)); const t = document.elementFromPoint(px, py); if (t && !e.contains(t) && !t.contains(e) && !t.closest('[role=dialog], [aria-modal=true], .modal-overlay, .overlay, .panel-fondo, .tk-overlay, .buscador, .hoja-fondo, [class*=overlay], [class*=backdrop], [class*=scrim]')) tapado++; });
    if ((pinta && traslucido) || tapado >= 3) out.push({ s: sel(e), alfa: +a.toFixed(2), blur, tapado, w: Math.round(r.width), h: Math.round(r.height) });
  });
  return out;
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
try {
  for (const tema of temasArg.split(',')) for (const ancho of anchosArg.split(',').map(Number)) for (const rol of ROLES) {
    const ctx = await browser.newContext({ viewport: { width: ancho, height: ancho < 768 ? 844 : 900 }, isMobile: ancho < 768, hasTouch: ancho < 768 });
    await ctx.addInitScript(t => { try { localStorage.setItem('ec-theme', t); } catch {} }, tema);
    const page = await ctx.newPage();
    await page.goto(BASE + rol.url); await espera(1400);
    if (rol.entrada) { await page.locator('#modal-entrada .btn-save').first().click().catch(() => {}); await espera(1500); }
    await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' + (process.env.INYECTAR || '') });
    const tabs = await page.evaluate(() => [...new Set([...document.querySelectorAll('.rail .rail-item[data-arg], .bottom-bar [data-arg], .hoja [data-arg]')].map(b => b.dataset.arg).filter(t => t && document.getElementById('tab-' + t)))]);
    tabs.push('cuenta');
    const revisar = async nombre => {
      const r = await page.evaluate(MEDIR).catch(() => []);
      for (const h of r) { const k = [rol.id, ancho, tema, nombre, h.s].join(' · '); hallazgos.set(k, h); }
    };
    for (const t of [...new Set(tabs)]) { await page.evaluate(t => { window.switchTab(t, null); window.scrollTo(0, 0); }, t).catch(() => {}); await espera(1300); await revisar('tab-' + t); }
    await page.evaluate(() => window.switchTab(document.querySelector('.rail .rail-item[data-arg], .bottom-bar [data-arg]')?.dataset.arg, null)); await espera(700);
    for (const [n, f] of [
      ['avisos', () => [...document.querySelectorAll('button, a')].find(b => /Avisos|avisos/.test(b.getAttribute('aria-label') || b.textContent))?.click()],
      ['buscador', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))],
      ['perfil', () => document.querySelector('[data-act="perfilVer"]')?.click()],
    ]) { await page.evaluate(f).catch(() => {}); await espera(1300); await revisar(n); await page.keyboard.press('Escape').catch(() => {}); await espera(400); }
    await ctx.close();
  }
} finally { await browser.close(); }
for (const [k, h] of hallazgos) console.log(k, `· alfa ${h.alfa}${h.tapado ? ' · tapado ' + h.tapado + '/5' : ''} · ${h.w}×${h.h}`);
console.log(`\n${hallazgos.size} hallazgos`);
process.exit(hallazgos.size ? 1 : 0);
