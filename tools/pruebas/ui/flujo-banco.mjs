// Flujo del banco de imágenes en el navegador real contra el simulador: node tools/pruebas/ui/flujo-banco.mjs [puerto]
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright-core';
const RAIZ = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const BASE = `http://localhost:${process.argv[2] || 3100}`;
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(f => fs.existsSync(f));
const out = path.join(RAIZ, 'docs/evidencias/rediseno-nov-2026/banco'); fs.mkdirSync(out, { recursive: true });
let ok = 0, mal = 0; const t = (c, m) => { c ? ok++ : mal++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };
const b = await chromium.launch({ executablePath: EDGE, headless: true });
const errores = [];

async function abrir(url, entrar) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errores.push(e.message)); p.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
  await p.goto(BASE + url); await p.waitForTimeout(1500);
  if (entrar) { await p.locator('button', { hasText: /^Entrar$/ }).first().click().catch(() => {}); await p.waitForTimeout(1800); }
  await p.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
  return { ctx, p };
}
const irBanco = async p => { await p.evaluate(() => switchTab('banco', null)); await p.waitForTimeout(1500); };

// ── admin ──
{
  const { ctx, p } = await abrir('/admin.html?as=admin', true);
  await irBanco(p);
  t(await p.locator('.bco-fila').count() === 2, 'admin: ve los 2 enlaces de ejemplo');
  await p.screenshot({ path: path.join(out, 'admin-lista.jpg'), type: 'jpeg', quality: 70 });
  await p.fill('.bco-filtros input[type=search]', 'taller'); await p.waitForTimeout(300);
  t(await p.locator('.bco-fila').count() === 1, 'buscar «taller» deja 1 (sin importar tildes ni mayúsculas)');
  await p.fill('.bco-filtros input[type=search]', ''); await p.waitForTimeout(300);
  await p.locator('.bco-filtros .btn-save').click(); await p.waitForTimeout(600);
  await p.fill('#tkf-titulo', 'Hi'); await p.fill('#tkf-enlace', 'ftp://x');
  await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(400);
  t(/al menos 3/.test(await p.locator('#tk-modal-err').innerText()), 'título corto: el formulario lo explica');
  await p.fill('#tkf-titulo', 'Reunión de equipo'); await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(400);
  t(/http/.test(await p.locator('#tk-modal-err').innerText()), 'enlace sin http(s): el formulario lo explica');
  await p.fill('#tkf-enlace', 'https://drive.google.com/drive/folders/nuevo'); await p.fill('#tkf-evento', 'Reunión'); await p.fill('#tkf-descripcion', 'Fotos de la reunión');
  await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(900);
  t(await p.locator('.bco-fila').count() === 3, 'añadir un enlace válido: ahora hay 3');
  const fila = p.locator('.bco-fila', { hasText: 'Reunión de equipo' });
  t(await fila.locator('a.bco-abrir').getAttribute('rel') === 'noopener noreferrer' && await fila.locator('a.bco-abrir').getAttribute('target') === '_blank', 'abrir: pestaña nueva con noopener noreferrer');
  await fila.locator('[data-arg="editar"]').click(); await p.waitForTimeout(500);
  await p.fill('#tkf-titulo', 'Reunión de equipo (editada)'); await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(800);
  t(await p.locator('.bco-fila', { hasText: 'editada' }).count() === 1, 'editar el título funciona');
  await p.locator('.bco-fila', { hasText: 'editada' }).locator('[data-arg="borrar"]').click(); await p.waitForTimeout(500);
  await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(800);
  t(await p.locator('.bco-fila').count() === 2, 'borrar pide confirmación y quita el enlace');
  await p.screenshot({ path: path.join(out, 'admin-final.jpg'), type: 'jpeg', quality: 70 });
  await ctx.close();
}
// ── miembro (Ana, id …01): edita lo suyo, no lo ajeno ──
{
  const { ctx, p } = await abrir('/user.html?as=m1', false);
  await irBanco(p);
  t(await p.locator('.bco-fila').count() === 2, 'miembro: ve todo el banco');
  t(await p.locator('.bco-fila').nth(0).locator('[data-arg="editar"]').count() + await p.locator('.bco-fila').nth(1).locator('[data-arg="editar"]').count() === 1, 'miembro: solo puede editar el enlace que subió (1 de 2)');
  await p.screenshot({ path: path.join(out, 'miembro-lista.jpg'), type: 'jpeg', quality: 70 });
  await ctx.close();
}
// ── sin 0058 ──
{
  const { ctx, p } = await abrir('/admin.html?as=admin&banco=0', true);
  await irBanco(p);
  t(/migración 0058/.test(await p.locator('#banco-host').innerText()), 'sin 0058: la pantalla dice qué migración falta');
  await ctx.close();
}
// ── celular ──
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); await p.goto(BASE + '/user.html?as=m1'); await p.waitForTimeout(1500);
  await p.evaluate(() => switchTab('banco', null)); await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(out, 'movil.jpg'), type: 'jpeg', quality: 70 });
  const des = await p.evaluate(() => [...document.querySelectorAll('.bco-fila *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).length);
  t(des === 0, 'celular: nada de la lista se sale de la pantalla');
  await ctx.close();
}
await b.close();
const reales = errores.filter(e => !/favicon|manifest/i.test(e));
t(reales.length === 0, 'sin errores de consola' + (reales.length ? ': ' + reales[0].slice(0, 120) : ''));
console.log(`\n${ok} correctas, ${mal} fallidas`);
process.exit(mal ? 1 : 0);
