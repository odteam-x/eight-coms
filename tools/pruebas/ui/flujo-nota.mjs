/**
 * Flujo de DAR NOTA (admin, Evaluar) contra el simulador: node tools/pruebas/ui/flujo-nota.mjs [puerto]
 * Por ancho (1440 y 390): elige a una persona, puntúa, guarda borrador y publica; comprueba que cada botón sea PULSABLE
 * (nada lo tapa: elementFromPoint en su centro) y que el aviso salga sin errores de consola.
 */
import fs from 'node:fs'; import { chromium } from 'playwright-core';
const BASE = `http://localhost:${process.argv[2] || 3100}`;
const EDGE = process.env.NAVEGADOR || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const b = await chromium.launch({ executablePath: EDGE, headless: true });
let ok = 0, mal = 0; const t = (c, m) => { c ? ok++ : mal++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };
fs.mkdirSync('docs/evidencias/rediseno-nov-2026/nota', { recursive: true });
for (const [w, h] of [[1440, 900], [390, 844]]) {
  console.log(`\n── ${w}px ──`);
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 768, hasTouch: w < 768 });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('JS: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  await p.goto(BASE + '/admin.html?as=admin'); await p.waitForTimeout(1500);
  await p.locator('#modal-entrada .btn-save').click().catch(() => {}); await p.waitForTimeout(1500);
  await p.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
  await p.evaluate(() => switchTab('evaluar', null)); await p.waitForTimeout(1500);
  const cards = await p.locator('#eval-user-list .eval-ucard').count();
  t(cards > 0, `Evaluar lista personas (${cards})`);
  // una persona pendiente o con borrador (no publicada)
  const idx = await p.evaluate(() => { const c = [...document.querySelectorAll('#eval-user-list .eval-ucard')]; const i = c.findIndex(x => /pendiente|borrador/i.test(x.textContent)); return i < 0 ? 0 : i; });
  await p.locator('#eval-user-list .eval-ucard').nth(idx).click(); await p.waitForTimeout(1500);
  const info = await p.evaluate(() => ({ pasos: document.querySelectorAll('#eval-form-area .escala-paso, #eval-form-area .escala button').length, rangos: document.querySelectorAll('#eval-form-area input[type=range]').length, nums: document.querySelectorAll('#eval-form-area input[type=number]').length, borrador: !!document.querySelector('#eval-form-area [data-arg="borrador"]'), publicar: !!document.querySelector('#eval-form-area .btn-publish') }));
  console.log('  formulario:', JSON.stringify(info));
  t(info.publicar, 'el formulario muestra «Publicar evaluación»');
  // puntúa: pulsa el valor 3 (o el medio) de cada escala visible
  const n = await p.evaluate(() => { let c = 0; document.querySelectorAll('#eval-form-area .escala').forEach(e => { const bs = [...e.querySelectorAll('button')]; const bt = bs[Math.min(2, bs.length - 1)]; if (bt) { bt.click(); c++; } }); return c; });
  console.log('  escalas puntuadas:', n);
  const clicable = async sel => p.evaluate(s => { const el = document.querySelector(s); if (!el) return 'no existe'; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el.contains(e) || e === el ? 'ok' : 'TAPADO por ' + (e ? e.tagName + '.' + [...e.classList].slice(0, 3).join('.') : 'nada'); }, sel);
  const cb = await clicable('#eval-form-area .eval-actions .btn-draft:not(.btn-draft--borrar)');
  t(cb === 'ok', `«Guardar borrador» pulsable: ${cb}`);
  const cp = await clicable('#eval-form-area .btn-publish');
  t(cp === 'ok', `«Publicar evaluación» pulsable: ${cp}`);
  await p.screenshot({ path: `docs/evidencias/rediseno-nov-2026/nota/${w}-antes.png` });
  // guardar borrador (clic real)
  await p.locator('#eval-form-area .eval-actions .btn-draft:not(.btn-draft--borrar)').first().click({ timeout: 5000 }).catch(e => t(false, 'clic en borrador: ' + e.message.split('\n')[0]));
  await p.waitForTimeout(1200);
  const toast1 = await p.evaluate(() => [...document.querySelectorAll('.toast, #toast, [role=status]')].map(e => e.textContent.trim()).filter(Boolean).slice(-2).join(' | '));
  console.log('  aviso tras borrador:', toast1);
  t(/borrador|guardad/i.test(toast1), 'aviso de borrador guardado');
  // publicar
  await p.locator('#eval-form-area .btn-publish').first().click({ timeout: 5000 }).catch(e => t(false, 'clic en publicar: ' + e.message.split('\n')[0]));
  await p.waitForTimeout(1500);
  const toast2 = await p.evaluate(() => [...document.querySelectorAll('.toast, #toast, [role=status]')].map(e => e.textContent.trim()).filter(Boolean).slice(-2).join(' | '));
  console.log('  aviso tras publicar:', toast2);
  t(/public|faltan|obligatorio/i.test(toast2), 'publicar responde (publica o dice qué falta)');
  await p.screenshot({ path: `docs/evidencias/rediseno-nov-2026/nota/${w}-despues.png` });
  t(errs.filter(e => !/favicon|manifest/i.test(e)).length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs[0] : ''));
  await ctx.close();
}
await b.close();
console.log(`\n${ok} correctas, ${mal} fallidas`); process.exit(mal ? 1 : 0);
