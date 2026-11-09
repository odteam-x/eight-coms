/**
 * Medición de rendimiento con un navegador real: node tools/pruebas/ui/rendimiento.mjs [puerto] [etiqueta]
 *
 * Por cada portal (admin, secretaría, miembro) en celular con CPU frenada ×4 (un teléfono de gama media) y en escritorio:
 * FCP, DOMContentLoaded, carga, tiempo bloqueado por tareas largas (TBT, aprox.), peticiones, bytes (sin comprimir: el servidor
 * local no comprime), nodos del DOM y cuánto tarda cambiar de pestaña. Guarda docs/evidencias/rendimiento-<etiqueta>.json.
 */
import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright-core';
const [puerto = '3100', etiqueta = 'actual'] = process.argv.slice(2);
const BASE = `http://localhost:${puerto}`;
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'].find(f => fs.existsSync(f));
const PORTALES = [{ id: 'admin', url: '/admin.html?as=admin', entrada: true }, { id: 'secretaria', url: '/secretario.html?as=sec' }, { id: 'miembro', url: '/user.html?as=m1' }];
const espera = ms => new Promise(r => setTimeout(r, ms));
const mediana = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const salida = [];
for (const perfil of [{ n: 'movil', w: 390, h: 844, cpu: 4 }, { n: 'escritorio', w: 1440, h: 900, cpu: 1 }]) {
  for (const p of PORTALES) {
    const corridas = [];
    for (let i = 0; i < 3; i++) {
      const ctx = await browser.newContext({ viewport: { width: perfil.w, height: perfil.h }, isMobile: perfil.w < 768, hasTouch: perfil.w < 768 });
      await ctx.addInitScript(() => {
        window.__tbt = 0; window.__fcp = 0;
        new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.duration > 50) window.__tbt += e.duration - 50; }).observe({ type: 'longtask', buffered: true });
        new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__fcp = e.startTime; }).observe({ type: 'paint', buffered: true });
      });
      const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
      if (perfil.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: perfil.cpu });
      let reqs = 0, bytes = 0; page.on('response', async r => { reqs++; try { bytes += (await r.body()).length; } catch { /* redirección */ } });
      await page.goto(BASE + p.url, { waitUntil: 'load' }); await espera(p.entrada ? 700 : 1200);
      if (p.entrada) { await page.locator('#modal-entrada .btn-save').first().click().catch(() => {}); }
      await espera(2500);
      const m = await page.evaluate(() => {
        const n = performance.getEntriesByType('navigation')[0];
        return { fcp: Math.round(window.__fcp), dcl: Math.round(n.domContentLoadedEventEnd), carga: Math.round(n.loadEventEnd), tbt: Math.round(window.__tbt), nodos: document.getElementsByTagName('*').length };
      });
      const tabs = await page.evaluate(() => [...new Set([...document.querySelectorAll('.rail .rail-item[data-arg], .bottom-bar [data-arg]')].map(b => b.dataset.arg).filter(t => t && document.getElementById('tab-' + t)))]);
      const t0 = []; for (const t of tabs.slice(0, 8)) { const d = await page.evaluate(async t => { const a = performance.now(); window.switchTab(t, null); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - a; }, t); t0.push(d); await espera(500); }
      corridas.push({ ...m, reqs, kb: Math.round(bytes / 1024), pestana_ms: Math.round(mediana(t0) || 0), pestana_max_ms: Math.round(Math.max(0, ...t0)) });
      await ctx.close();
    }
    const med = k => Math.round(mediana(corridas.map(c => c[k])));
    const fila = { perfil: perfil.n, portal: p.id, fcp: med('fcp'), dcl: med('dcl'), carga: med('carga'), tbt: med('tbt'), reqs: med('reqs'), kb: med('kb'), nodos: med('nodos'), pestana_ms: med('pestana_ms'), pestana_max_ms: med('pestana_max_ms') };
    salida.push(fila); console.log(Object.entries(fila).map(([k, v]) => `${k}=${v}`).join(' '));
  }
}
await browser.close();
fs.mkdirSync('docs/evidencias', { recursive: true });
fs.writeFileSync(path.join('docs/evidencias', `rendimiento-${etiqueta}.json`), JSON.stringify(salida, null, 1));
