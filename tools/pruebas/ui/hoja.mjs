// Captura la hoja «Más» en celular (oscuro y claro). Uso: node tools/pruebas/ui/hoja.mjs [puerto]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const RAIZ = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const BASE = `http://localhost:${process.argv[2] || 3100}`;
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(f => fs.existsSync(f));
const out = path.join(RAIZ, 'docs/evidencias/rediseno-nov-2026/hoja'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: EDGE, headless: true });
for (const tema of ['dark', 'light']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(t => { try { localStorage.setItem('ec-theme', t); } catch {} }, tema);
  const p = await ctx.newPage();
  await p.goto(BASE + '/admin.html?as=admin'); await p.waitForTimeout(1200);
  await p.locator('button', { hasText: /^Entrar$/ }).first().click().catch(() => {}); await p.waitForTimeout(1800);
  await p.evaluate(() => { const m = [...document.querySelectorAll('.bottom-bar button')].pop(); m && m.click(); });
  await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(out, `mas-${tema}.jpg`), type: 'jpeg', quality: 70 });
  const r = await p.evaluate(() => { const h = document.querySelector('.bb-hoja-panel'); return h ? getComputedStyle(h).backgroundColor : null; });
  console.log(tema, r);
  await ctx.close();
}
await b.close();
