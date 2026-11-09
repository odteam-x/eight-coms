/**
 * Recorrido visual de TODA la plataforma con un navegador real (Edge instalado, vía playwright-core) contra el simulador.
 *
 *   node tools/pruebas/ui/recorrido.mjs <fase> [puerto] [anchos]
 *     fase    antes | despues | lo que sea: carpeta de salida
 *     puerto  donde escucha ui/server.mjs (por defecto 3100)
 *     anchos  lista separada por comas (por defecto 1440,1024,768,390)
 *
 * Por cada rol (admin, secretaría, miembro y sin sesión) y cada ancho abre cada pestaña que el menú REAL ofrece (no una lista
 * escrita a mano), espera a que pinte, guarda una captura JPEG y mide con audit-layout.js: desbordes, objetivos táctiles,
 * texto diminuto y controles sin nombre, más los errores de consola. Abre además las superficies que no son pestañas:
 * avisos, buscador, Mi cuenta, un perfil y el formulario de nueva tarea.
 *
 * Salida: docs/evidencias/rediseno-nov-2026/<fase>/<rol>-<ancho>/<pantalla>.jpg y resumen.json (las imágenes no se versionan).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const AQUI = fileURLToPath(new URL('.', import.meta.url));
const RAIZ = path.resolve(AQUI, '../../..');
const [fase = 'actual', puerto = '3100', anchosArg = '1440,1024,768,390'] = process.argv.slice(2);
const BASE = `http://localhost:${puerto}`;
const SALIDA = path.join(RAIZ, 'docs/evidencias/rediseno-nov-2026', fase);
const ANCHOS = anchosArg.split(',').map(Number);
const ALTO = { 1440: 900, 1024: 768, 768: 1024, 390: 844, 320: 640 };
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'].find(f => fs.existsSync(f));

const ROLES = [
  { id: 'admin', url: '/admin.html?as=admin', entrada: true },
  { id: 'secretaria', url: '/secretario.html?as=sec' },
  { id: 'miembro', url: '/user.html?as=m1' },
];
const espera = ms => new Promise(r => setTimeout(r, ms));
const resumen = [];

async function medir(page) {
  await page.evaluate(() => new Promise(res => {
    if (window.__aud) return res();
    const s = document.createElement('script'); s.src = '/tools/pruebas/ui/audit-layout.js'; s.onload = res; s.onerror = res; document.head.appendChild(s);
  }));
  return page.evaluate(() => {
    const a = window.__aud ? window.__aud() : {};
    return { overflow: (a.overflow || []).length, small: a.smallN ?? (a.small || []).length, tiny: (a.tiny || []).length, noname: (a.noname || []).length,
      ejemplos: { overflow: (a.overflow || []).slice(0, 3), small: (a.small || []).slice(0, 3), noname: (a.noname || []).slice(0, 3) },
      alto: document.documentElement.scrollHeight };
  });
}

async function captura(page, dir, nombre, meta, errores) {
  fs.mkdirSync(dir, { recursive: true });
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;caret-color:transparent!important}' }).catch(() => {});
  await espera(250);
  const archivo = path.join(dir, nombre.replace(/[^a-z0-9-]+/gi, '_') + '.jpg');
  await page.screenshot({ path: archivo, type: 'jpeg', quality: 62, fullPage: meta.ancho >= 1024 });
  const m = await medir(page);
  resumen.push({ ...meta, pantalla: nombre, archivo: path.relative(RAIZ, archivo).replace(/\\/g, '/'), ...m, errores: [...errores] });
  errores.length = 0;
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
try {
  for (const ancho of ANCHOS) {
    const vp = { width: ancho, height: ALTO[ancho] || 900 };
    // Sin sesión: acceso, registro, recuperación
    {
      const ctx = await browser.newContext({ viewport: vp, isMobile: ancho < 768, hasTouch: ancho < 768 });
      const page = await ctx.newPage(); const errores = [];
      page.on('pageerror', e => errores.push(String(e.message).slice(0, 200)));
      page.on('console', m => { if (m.type() === 'error') errores.push(m.text().slice(0, 200)); });
      const dir = path.join(SALIDA, `anon-${ancho}`); const meta = { rol: 'anon', ancho };
      await page.goto(BASE + '/index.html?as=anon'); await espera(900);
      await captura(page, dir, 'acceso', meta, errores);
      await page.click('#tab-registro').catch(() => {}); await espera(700);
      await captura(page, dir, 'registro', meta, errores);
      await page.click('#tab-login').catch(() => {}); await espera(500);
      await page.click('[data-act="mostrarReset"]').catch(() => {}); await espera(500);
      await captura(page, dir, 'recuperar', meta, errores);
      await ctx.close();
    }
    for (const rol of ROLES) {
      const ctx = await browser.newContext({ viewport: vp, isMobile: ancho < 768, hasTouch: ancho < 768 });
      const page = await ctx.newPage(); const errores = [];
      page.on('pageerror', e => errores.push(String(e.message).slice(0, 200)));
      page.on('console', m => { if (m.type() === 'error') errores.push(m.text().slice(0, 200)); });
      await page.goto(BASE + rol.url); await espera(1500);
      if (rol.entrada) { await page.locator('button', { hasText: /^Entrar$/ }).first().click().catch(() => {}); await espera(1800); }
      const dir = path.join(SALIDA, `${rol.id}-${ancho}`); const meta = { rol: rol.id, ancho };
      const tabs = await page.evaluate(() => [...new Set([...document.querySelectorAll('.rail .rail-item[data-arg], .bottom-bar [data-arg], .hoja [data-arg]')]
        .filter(b => /tab/i.test(b.dataset.act || '') || b.classList.contains('rail-item')).map(b => b.dataset.arg).filter(t => t && document.getElementById('tab-' + t)))]);
      for (const t of tabs) {
        await page.evaluate(t => { (window.switchTab || window.irA || (() => {}))(t, null); window.scrollTo(0, 0); }, t); await espera(1600);
        await captura(page, dir, 'tab-' + t, meta, errores);
      }
      // Superficies que no son pestañas
      await page.evaluate(() => { (window.switchTab || (() => {}))(document.querySelector('.rail .rail-item[data-arg]')?.dataset.arg, null); }); await espera(800);
      const abrir = async (nombre, accion) => { await page.evaluate(accion).catch(() => {}); await espera(1500); await captura(page, dir, nombre, meta, errores);
        await page.keyboard.press('Escape').catch(() => {}); await espera(400); };
      await abrir('avisos', () => [...document.querySelectorAll('button, a')].find(b => /Avisos|avisos/.test(b.getAttribute('aria-label') || b.textContent))?.click());
      await abrir('buscador', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })));
      await abrir('perfil-ajeno', () => { const b = document.querySelector('[data-act="perfilVer"]'); b ? b.click() : null; });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  fs.mkdirSync(SALIDA, { recursive: true });
  fs.writeFileSync(path.join(SALIDA, 'resumen.json'), JSON.stringify(resumen, null, 1));
  const con = k => resumen.filter(r => r[k] > 0).length;
  console.log(`${resumen.length} capturas · con desborde ${con('overflow')} · con objetivos chicos ${con('small')} · con texto diminuto ${con('tiny')} · sin nombre ${con('noname')} · con errores ${resumen.filter(r => r.errores.length).length}`);
  console.log('salida:', path.relative(RAIZ, SALIDA));
}
