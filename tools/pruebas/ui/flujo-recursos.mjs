// Flujo de Recursos en el navegador real contra el simulador: node tools/pruebas/ui/flujo-recursos.mjs [puerto]
// (antes flujo-banco.mjs). Servidor: node tools/pruebas/ui/server.mjs . 3100
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright-core';
const RAIZ = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const BASE = `http://localhost:${process.argv[2] || 3100}`;
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(f => fs.existsSync(f));
const out = path.join(RAIZ, 'docs/evidencias/rediseno-nov-2026/recursos'); fs.mkdirSync(out, { recursive: true });
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
const irRecursos = async p => { await p.evaluate(() => switchTab('recursos', null)); await p.waitForTimeout(1500); };
const tarjetas = p => p.locator('.rec-card').count();
const escribir = async (p, sel, v) => { await p.fill(sel, v); };
const err = p => p.locator('#tk-modal-err').innerText();

// ── admin ──
{
  const { ctx, p } = await abrir('/admin.html?as=admin', true);
  const menu = await p.locator('nav, .rail, .sidebar, body').first().innerText();
  t(/Recursos/.test(menu) && !/Banco de im/.test(menu), 'admin: el menú dice «Recursos» (ya no «Imágenes» ni «Banco»)');
  await irRecursos(p);
  t(/^Recursos$/.test((await p.locator('#tab-recursos h1').innerText()).trim()), 'admin: el título de la pantalla es «Recursos»');
  t(await tarjetas(p) === 5, 'admin: ve los 5 recursos de ejemplo');
  const grupos = await p.locator('.rec-grupo-t').allInnerTexts();
  t(grupos.length === 3 && /Jornada de cierre/.test(grupos[0]) && /Taller de fotografía/.test(grupos[1]) && /Sin evento/.test(grupos[2]), 'agrupa por evento y deja «Sin evento» al final: ' + grupos.join(' | ').replace(/\n/g, ' '));
  const ident = p.locator('.rec-card', { hasText: 'Identidad gráfica' });
  t(await ident.locator('.rec-color').count() === 4 && await ident.locator('.rec-fuentes li').count() === 2 && await ident.locator('.rec-enlace').count() === 2, 'identidad gráfica: 4 colores, 2 tipografías y 2 enlaces');
  t(/rgb\(26, 79, 160\)/.test(await ident.locator('.rec-muestra').first().evaluate(e => getComputedStyle(e).backgroundColor)), 'la muestra de color pinta #1A4FA0');
  await p.screenshot({ path: path.join(out, 'admin-lista.jpg'), type: 'jpeg', quality: 70 });
  await p.selectOption('select[data-f="agrupar"]', 'tipo'); await p.waitForTimeout(300);
  t((await p.locator('.rec-grupo-t').allInnerTexts()).join('|').startsWith('Imágenes y fotos'), 'agrupar por tipo: empieza por «Imágenes y fotos»');
  await p.selectOption('select[data-f="agrupar"]', 'nada'); await p.waitForTimeout(300);
  t(await p.locator('.rec-grupo-t').count() === 0 && await tarjetas(p) === 5, 'sin agrupar: sin títulos de grupo');
  await p.selectOption('select[data-f="agrupar"]', 'evento'); await p.waitForTimeout(300);
  await p.fill('.bco-filtros input[type=search]', 'montserrat'); await p.waitForTimeout(300);
  t(await tarjetas(p) === 1, 'buscar una tipografía («montserrat») encuentra la identidad gráfica');
  await p.fill('.bco-filtros input[type=search]', 'TALLER'); await p.waitForTimeout(300);
  t(await tarjetas(p) === 2, 'buscar «TALLER» deja 2 (título o evento; sin importar mayúsculas)');
  await p.fill('.bco-filtros input[type=search]', ''); await p.waitForTimeout(300);
  await p.selectOption('select[data-f="tipo"]', 'video'); await p.waitForTimeout(300);
  t(await tarjetas(p) === 1, 'filtrar por tipo «Video» deja 1');
  await p.selectOption('select[data-f="tipo"]', ''); await p.selectOption('select[data-f="evento"]', 'Jornada de cierre'); await p.waitForTimeout(300);
  t(await tarjetas(p) === 2, 'filtrar por evento «Jornada de cierre» deja 2');
  await p.selectOption('select[data-f="evento"]', ''); await p.waitForTimeout(200);
  await p.locator('.rec-tag', { hasText: 'logo' }).click(); await p.waitForTimeout(300);
  t(await tarjetas(p) === 1, 'pulsar una etiqueta busca recursos con esa etiqueta');
  await p.fill('.bco-filtros input[type=search]', 'zzzz'); await p.waitForTimeout(300);
  t(/Ningún recurso coincide/.test(await p.locator('#recursos-host').innerText()), 'sin coincidencias: lo dice y ofrece quitar filtros');
  await p.locator('[data-arg="limpiar"]').click(); await p.waitForTimeout(300);
  t(await tarjetas(p) === 5, 'quitar filtros devuelve los 5');

  // añadir
  await p.locator('.bco-filtros .btn-save').click(); await p.waitForTimeout(600);
  await p.fill('#tkf-titulo', 'Hi'); await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(300);
  t(/al menos 3/.test(await err(p)), 'título corto: el formulario lo explica');
  await p.fill('#tkf-titulo', 'Identidad gráfica · Taller'); await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(300);
  t(/al menos un enlace, un color o una tipograf/.test(await err(p)), 'sin enlaces, colores ni tipografías: lo explica');
  await p.fill('#tkf-enlaces', 'ftp://x'); await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(300);
  t(/no es un enlace válido/.test(await err(p)), 'enlace sin http(s): lo explica');
  await p.fill('#tkf-enlaces', 'Logos | https://drive.google.com/drive/folders/taller'); await p.fill('#tkf-colores', 'azul'); await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(300);
  t(/#1A4FA0/.test(await err(p)), 'color sin #: el formulario da un ejemplo');
  await p.fill('#tkf-colores', '#e11 Rojo evento, #0a0a0a'); await p.fill('#tkf-fuentes', 'Títulos: Inter Bold');
  await p.selectOption('#tkf-tipo', 'identidad'); await p.fill('#tkf-evento', 'Taller de fotografía'); await p.fill('#tkf-etiquetas', 'logo, paleta, Logo');
  await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(900);
  t(await tarjetas(p) === 6, 'añadir una identidad gráfica válida: ahora hay 6');
  const nueva = p.locator('.rec-card', { hasText: 'Identidad gráfica · Taller' });
  t(await nueva.locator('.rec-color').count() === 2 && /#EE1111/.test(await nueva.innerText()), 'la paleta #e11 se guarda como #EE1111');
  t(await nueva.locator('.rec-tag').count() === 2, 'las etiquetas repetidas se unifican (logo, paleta)');
  t(await nueva.locator('a.rec-abrir').getAttribute('rel') === 'noopener noreferrer' && await nueva.locator('a.rec-abrir').getAttribute('target') === '_blank', 'abrir: pestaña nueva con noopener noreferrer');
  await nueva.locator('[data-arg="editar"]').click(); await p.waitForTimeout(500);
  t(/#EE1111 Rojo evento/.test(await p.locator('#tkf-colores').inputValue()) && /Logos \| https/.test(await p.locator('#tkf-enlaces').inputValue()), 'editar: el formulario vuelve a mostrar la paleta y los enlaces');
  await p.fill('#tkf-titulo', 'Identidad gráfica · Taller (v2)'); await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(800);
  t(await p.locator('.rec-card', { hasText: '(v2)' }).count() === 1, 'editar el título funciona');
  await p.locator('.rec-card', { hasText: '(v2)' }).locator('[data-arg="borrar"]').click(); await p.waitForTimeout(500);
  await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(800);
  t(await tarjetas(p) === 5, 'borrar pide confirmación y quita el recurso');
  await p.screenshot({ path: path.join(out, 'admin-final.jpg'), type: 'jpeg', quality: 70 });
  await ctx.close();
}
// ── miembro (Ana, id …01): edita lo suyo, no lo ajeno ──
{
  const { ctx, p } = await abrir('/user.html?as=m1', false);
  await irRecursos(p);
  t(await tarjetas(p) === 5, 'miembro: ve todos los recursos');
  t(await p.locator('.rec-card [data-arg="editar"]').count() === 2, 'miembro: solo puede editar los 2 que subió (de 5)');
  await p.screenshot({ path: path.join(out, 'miembro-lista.jpg'), type: 'jpeg', quality: 70 });
  await ctx.close();
}
// ── secretaría ──
{
  const { ctx, p } = await abrir('/secretario.html?as=sec', false);
  await irRecursos(p);
  t(await tarjetas(p) === 5 && await p.locator('.rec-card [data-arg="editar"]').count() === 0, 'secretaría: ve los 5 y no edita lo ajeno');
  await ctx.close();
}
// ── sin 0071 ──
{
  const { ctx, p } = await abrir('/admin.html?as=admin&recursos=0', true);
  await irRecursos(p);
  t(/migración 0071/.test(await p.locator('#recursos-host').innerText()), 'sin 0071: la pantalla dice qué migración falta');
  await ctx.close();
}
// ── pantalla vacía ──
{
  const { ctx, p } = await abrir('/user.html?as=m1&recursos=vacio', false);
  await irRecursos(p);
  t(/Cuando haya recursos aparecerán aquí/.test(await p.locator('#recursos-host').innerText()) && await p.locator('#recursos-host [data-arg="nuevo"]').count() >= 1, 'sin recursos: «Cuando haya recursos aparecerán aquí» y un botón para añadir el primero');
  await p.screenshot({ path: path.join(out, 'vacio.jpg'), type: 'jpeg', quality: 70 });
  await ctx.close();
}
// ── celular ──
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); await p.goto(BASE + '/user.html?as=m1'); await p.waitForTimeout(1500);
  await p.evaluate(() => switchTab('recursos', null)); await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(out, 'movil.jpg'), type: 'jpeg', quality: 70 });
  const des = await p.evaluate(() => [...document.querySelectorAll('.rec-card *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).length);
  t(des === 0, 'celular: nada de las tarjetas se sale de la pantalla');
  const chicos = await p.evaluate(() => [...document.querySelectorAll('.rec-card button, .rec-card a')].filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.height < 43.5; }).length);
  t(chicos === 0, 'celular: botones y enlaces de las tarjetas con al menos 44 px de alto' + (chicos ? ' (' + chicos + ' más bajos)' : ''));
  await ctx.close();
}
await b.close();
const reales = errores.filter(e => !/favicon|manifest/i.test(e));
t(reales.length === 0, 'sin errores de consola' + (reales.length ? ': ' + reales[0].slice(0, 120) : ''));
console.log(`\n${ok} correctas, ${mal} fallidas`);
process.exit(mal ? 1 : 0);
