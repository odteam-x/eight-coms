// Capturas móviles puntuales: pie de página (copyright) al final de la pantalla y panel de avisos. Uso: node movil-extra.mjs [puerto] [carpeta]
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright-core';
const RAIZ = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const BASE = `http://localhost:${process.argv[2] || 3100}`; const out = path.join(RAIZ, 'docs/evidencias/rediseno-nov-2026', process.argv[3] || 'mov2'); fs.mkdirSync(out, { recursive: true });
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(f => fs.existsSync(f));
const b = await chromium.launch({ executablePath: EDGE, headless: true });
for (const tema of ['dark', 'light']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(t => { try { localStorage.setItem('ec-theme', t); } catch {} }, tema);
  const p = await ctx.newPage();
  await p.goto(BASE + '/user.html?as=m1'); await p.waitForTimeout(1800);
  await p.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(out, `pie-${tema}.jpg`), type: 'jpeg', quality: 70 });
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.evaluate(() => { const c = document.querySelector('.cab-movil [aria-label*="viso"], .cab-movil .campana, #campana-movil, .cab-movil button:last-child'); c && c.click(); });
  await p.waitForTimeout(1800);
  await p.screenshot({ path: path.join(out, `avisos-${tema}.jpg`), type: 'jpeg', quality: 70 });
  await ctx.close();
}
await b.close(); console.log('ok');
