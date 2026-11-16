// Flujo de «Pedir ayuda» (0068) en el navegador real contra el simulador, en los tres portales y en celular:
//   node tools/pruebas/ui/server.mjs . 3171   (en otra terminal)   →   node tools/pruebas/ui/flujo-ayuda.mjs [puerto]
// Deja capturas en docs/evidencias/solicito-ayuda/. Lo que NO prueba: la base real (eso lo hace sql-0068.mjs) ni Realtime de verdad.
import { spawn } from 'node:child_process'; import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright-core';
const RAIZ = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const BASE = `http://localhost:${process.argv[2] || 3171}`;
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(f => fs.existsSync(f));
const out = path.join(RAIZ, 'docs/evidencias/solicito-ayuda'); fs.mkdirSync(out, { recursive: true });
let ok = 0, mal = 0; const t = (c, m) => { c ? ok++ : mal++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };
// Edge se lanza aparte y Playwright se conecta por CDP (lanzarlo con chromium.launch falla en algunos Windows; así lo hace también capturas-manual.mjs).
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'flujo-ayuda-'));
const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9334', '--user-data-dir=' + perfil, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
let b; for (let i = 0; i < 30 && !b; i++) { await new Promise(r => setTimeout(r, 500)); try { b = await chromium.connectOverCDP('http://127.0.0.1:9334'); } catch (e) { /* aún arrancando */ } }
if (!b) { proc.kill(); throw new Error('No se pudo abrir el navegador'); }
const errores = [];

async function abrir(url, { entrar = false, movil = false } = {}) {
  const ctx = await b.newContext(movil ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errores.push(url + ' → ' + e.message)); p.on('console', m => { if (m.type() === 'error') errores.push(url + ' → ' + m.text()); });
  await p.goto(BASE + url); await p.waitForTimeout(1500);
  if (entrar) { await p.locator('button', { hasText: /^Entrar$/ }).first().click().catch(() => {}); await p.waitForTimeout(1800); }
  await p.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
  return { ctx, p };
}
const ir = async p => { await p.evaluate(() => switchTab('apoyo', null)); await p.waitForTimeout(1200); };
const tab = async (p, k) => { await p.locator(`#apy-tabs [data-arg2="${k}"]`).click(); await p.waitForTimeout(300); };
const filas = p => p.locator('#apoyo-host .apy-fila-p');
const foto = (p, n) => p.screenshot({ path: path.join(out, n + '.jpg'), type: 'jpeg', quality: 72 });

// ── miembro (Ana: Fotografía, 08-01, id …01) ──
{
  const { ctx, p } = await abrir('/user.html?as=m1');
  // El destino está en el menú (escritorio)
  t(await p.locator('#rail [data-tab="apoyo"], #rail [data-arg="apoyo"]').count() > 0, 'miembro: «Pedir ayuda» está en el menú lateral');
  await ir(p);
  t(await p.locator('#tab-apoyo.active').count() === 1 && /Pedir ayuda/.test(await p.locator('#tab-apoyo h1').innerText()), 'miembro: abre la pantalla «Pedir ayuda»');
  t(await p.locator('#apy-tabs .apy-tab').count() === 4, 'miembro: 4 pestañas (Pedir, Abiertas para mi rol, Mis pedidos, Las que tomé)');
  t(await p.locator('#apy-form').count() === 1, 'miembro: la primera pestaña es el formulario');
  await foto(p, 'miembro-formulario');
  // Abiertas para mi rol: Ana (Fotografía) puede tomar el #1 (de Flor, Fotografía, todo el equipo) pero NO el #6 (distrito 08-02) ni el suyo
  await tab(p, 'abiertas');
  t(await filas(p).count() === 1 && /Fotos del taller de redacción/.test(await filas(p).first().innerText()), 'miembro: «Abiertas para mi rol» muestra solo lo que puede tomar (1)');
  t(await filas(p).first().locator('[data-arg="tomar"]').count() === 1, 'miembro: tiene el botón «Tomar»');
  await foto(p, 'miembro-abiertas');
  await filas(p).first().locator('[data-arg="tomar"]').click(); await p.waitForTimeout(800);
  t(/vacío|Ahora no hay pedidos abiertos/.test(await p.locator('#apy-panel').innerText()) || await filas(p).count() === 0, 'miembro: al tomarlo sale de «Abiertas» y queda el estado vacío con mensaje claro');
  await tab(p, 'tomadas');
  t(await filas(p).count() === 2, 'miembro: «Las que tomé» ahora tiene 2 (el #3 y el recién tomado)');
  // Resolver
  const f3 = filas(p).filter({ hasText: 'Fotos del taller de redacción' });
  await f3.locator('[data-arg="resolver"]').click(); await p.waitForTimeout(500);
  await p.fill('#tkf-nota', 'Subí 12 fotos a la carpeta'); await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(900);
  t(/Resuelta/.test(await filas(p).filter({ hasText: 'Fotos del taller de redacción' }).innerText()), 'miembro: marcar resuelta cambia el estado');
  // Mis pedidos: el #2 (abierta), #4 (resuelta: confirmar/reabrir), #5 (abierta)
  await tab(p, 'mios');
  t(await filas(p).count() === 3, 'miembro: «Mis pedidos» muestra los 3 que pidió');
  const f4 = filas(p).filter({ hasText: 'Corregir la ortografía' });
  t(await f4.locator('[data-arg="confirmar"]').count() === 1 && await f4.locator('[data-arg="reabrir"]').count() === 1, 'miembro: lo resuelto ofrece Confirmar y Reabrir');
  await foto(p, 'miembro-mis-pedidos');
  await f4.locator('[data-arg="reabrir"]').click(); await p.waitForTimeout(400);
  await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(400);
  t(/frase|al menos/i.test(await p.locator('#tk-modal-err').innerText()), 'miembro: reabrir sin decir qué falta lo explica');
  await p.fill('#tkf-nota', 'Faltan tildes en el segundo título'); await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(900);
  t(/Tomada/.test(await filas(p).filter({ hasText: 'Corregir la ortografía' }).innerText()), 'miembro: reabierto vuelve a «Tomada»');
  await filas(p).filter({ hasText: 'Corregir la ortografía' }).locator('[data-arg="historial"]').click(); await p.waitForTimeout(700);
  t(await p.locator('.apy-linea li').count() >= 4, 'miembro: el historial cuenta lo que pasó');
  // Cancelar uno
  await filas(p).filter({ hasText: 'Redactar la nota' }).locator('[data-arg="cancelar"]').click(); await p.waitForTimeout(400);
  await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(900);
  t(/Cancelada/.test(await filas(p).filter({ hasText: 'Redactar la nota' }).innerText()), 'miembro: cancelar su pedido');
  // Pedir ayuda (formulario)
  await tab(p, 'pedir');
  await p.locator('#apy-enviar').click(); await p.waitForTimeout(300);
  t(/pocas palabras/.test(await p.locator('#apy-err').innerText()), 'miembro: enviar vacío explica qué falta');
  await p.fill('#apy-titulo', 'Diseñar el afiche del taller'); await p.selectOption('#apy-rol', '3'); await p.selectOption('#apy-pri', 'alta');
  await p.fill('#apy-enlace', 'ftp://x'); await p.locator('#apy-enviar').click(); await p.waitForTimeout(300);
  t(/http/.test(await p.locator('#apy-err').innerText()), 'miembro: un enlace que no es http(s) se explica');
  await p.fill('#apy-enlace', 'https://drive.example.com/afiche'); await p.locator('#apy-enviar').click(); await p.waitForTimeout(1000);
  t(await p.locator('#apy-tabs .apy-tab.active').innerText().then(x => /Mis pedidos/.test(x)) && await filas(p).filter({ hasText: 'Diseñar el afiche' }).count() === 1, 'miembro: el pedido enviado aparece en «Mis pedidos»');
  // Sin 0068
  await ctx.close();
}
// ── sin la migración ──
{
  const { ctx, p } = await abrir('/user.html?as=m1&ayuda=0');
  await ir(p);
  t(/migración 0068/.test(await p.locator('#apoyo-host').innerText()), 'sin 0068: la pantalla dice qué migración falta');
  await ctx.close();
}
// ── secretaría (Sofía: Dirección, 08-01) ──
{
  const { ctx, p } = await abrir('/secretario.html?as=sec');
  t(await p.locator('#rail [data-tab="apoyo"], #rail [data-arg="apoyo"]').count() > 0, 'secretaría: «Pedir ayuda» está en el menú');
  await ir(p);
  t(await p.locator('#apy-tabs .apy-tab').count() === 5, 'secretaría: 5 pestañas (incluye «De mi distrito»)');
  await tab(p, 'abiertas');
  t(await filas(p).filter({ hasText: 'Apoyo con la agenda del mes' }).locator('[data-arg="tomar"]').count() === 1, 'secretaría: puede tomar lo que se le pide a Dirección');
  await tab(p, 'todas');
  t(await filas(p).count() === 5 && await filas(p).filter({ hasText: 'visita al distrito 08-02' }).count() === 0, 'secretaría: «De mi distrito» muestra los 5 de 08-01 y ninguno de 08-02');
  await foto(p, 'secretaria-distrito');
  await ctx.close();
}
// ── administración ──
{
  const { ctx, p } = await abrir('/admin.html?as=admin', { entrar: true });
  t(await p.locator('#rail [data-tab="apoyo"], #rail [data-arg="apoyo"]').count() > 0, 'admin: «Pedir ayuda» está en el menú');
  await ir(p);
  await tab(p, 'todas');
  t(await filas(p).count() === 6, 'admin: «Todas» muestra los 6');
  await foto(p, 'admin-todas');
  await tab(p, 'abiertas');
  const a1 = filas(p).filter({ hasText: 'Fotos del taller de redacción' });
  await a1.locator('[data-arg="reasignar"]').click(); await p.waitForTimeout(800);
  t(await p.locator('#tkf-persona option').count() >= 2, 'admin: «Asignar a…» lista a quienes tienen el rol Fotografía');
  await p.locator('#tk-modal-ok').click(); await p.waitForTimeout(900);
  t(await filas(p).filter({ hasText: 'Fotos del taller de redacción' }).count() === 0, 'admin: tras asignar, el pedido sale de «Abiertas»');
  await tab(p, 'todas');
  t(/Tomada/.test(await filas(p).filter({ hasText: 'Fotos del taller de redacción' }).innerText()), 'admin: queda «Tomada» por la persona asignada');
  await ctx.close();
}
// ── celular ──
for (const [url, nom] of [['/user.html?as=m1', 'movil-miembro'], ['/secretario.html?as=sec', 'movil-secretaria']]) {
  const { ctx, p } = await abrir(url, { movil: true });
  const enBarra = await p.locator('#bottom-bar [data-tab="apoyo"], #bottom-bar [data-arg="apoyo"]').count();
  await p.locator('#bottom-bar [data-act="masDestinos"]').click().catch(() => {}); await p.waitForTimeout(500);
  const enMas = await p.locator('[data-tab="apoyo"], [data-arg="apoyo"]').evaluateAll(els => els.filter(e => e.offsetParent !== null).length);
  t(enBarra + enMas > 0, `${nom}: «Pedir ayuda» se alcanza en la barra inferior o en «Más» (barra: ${enBarra}, Más: ${enMas})`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await ir(p);
  await foto(p, nom + '-formulario');
  const des = await p.evaluate(() => [...document.querySelectorAll('#tab-apoyo *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && e.offsetParent !== null).length);
  t(des === 0, `${nom}: nada del formulario se sale de la pantalla`);
  const chicos = await p.evaluate(() => [...document.querySelectorAll('#tab-apoyo button, #tab-apoyo select, #tab-apoyo input:not([type=radio])')].filter(e => e.offsetParent !== null && e.getBoundingClientRect().height < 43.5).map(e => e.id || e.className).slice(0, 4));
  t(chicos.length === 0, `${nom}: todo lo táctil mide al menos 44 px` + (chicos.length ? ' → ' + chicos : ''));
  await tab(p, 'abiertas'); await foto(p, nom + '-abiertas');
  const des2 = await p.evaluate(() => [...document.querySelectorAll('#tab-apoyo *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && e.offsetParent !== null).length);
  t(des2 === 0, `${nom}: la lista tampoco se sale`);
  await ctx.close();
}
await b.close(); proc.kill(); try { fs.rmSync(perfil, { recursive: true, force: true }); } catch (e) { /* Edge aún libera el perfil */ }
const reales = errores.filter(e => !/favicon|manifest|0068|ayuda_listar|PGRST202/i.test(e));
t(reales.length === 0, 'sin errores de consola' + (reales.length ? ': ' + reales[0].slice(0, 160) : ''));
console.log(`\n${ok} correctas, ${mal} fallidas`);
process.exit(mal ? 1 : 0);
