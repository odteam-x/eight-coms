// Regenera las capturas de los manuales (ayuda/img/*.jpg y *-pc.jpg) desde el simulador, con la identidad vigente.
//   1) node tools/pruebas/ui/server.mjs . 3171        (simulador con datos de ejemplo)
//   2) node tools/capturas-manual.mjs http://localhost:3171 [filtro]
// Usa Microsoft Edge/Chrome en modo headless por el protocolo de depuración (sin dependencias). Tema oscuro (el de partida).
// Cada receta es JS que corre en la página (puede esperar); las capturas «a-*» (admin) no se generan: el manual de administración es privado.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:3171';
const FILTRO = process.argv[3] || '';
const OUT = new URL('../ayuda/img/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const NAV = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
if (!NAV) { console.error('No encuentro Edge ni Chrome.'); process.exit(1); }

const esp = ms => new Promise(r => setTimeout(r, ms));
const TAB = t => `await window.switchTab('${t}', null);`;
const CLICK_TXT = (sel, re) => `[...document.querySelectorAll('${sel}')].find(b => ${re}.test(b.textContent.trim()))?.click();`;

/* [nombre, rol de la simulación, receta, {solo: 'pc'|'cel'}] */
const CAPTURAS = [
  ['m-inicio', 'm1', TAB('inicio')],
  ['m-primeros-pasos', 'm1', TAB('inicio'), { q: 'bv=2' }],
  ['m-perfil', 'm1', TAB('perfil')],
  ['m-calendario', 'm1', TAB('calendario')],
  ['m-entregas', 'm1', TAB('trabajos')],
  ['m-cuenta', 'm1', TAB('cuenta')],
  ['m-preferencias', 'm1', TAB('cuenta') + 'await new Promise(r => setTimeout(r, 400));' + CLICK_TXT('button, [role="tab"]', '/^Mi rol$/')],
  ['m-avisos', 'm1', TAB('inicio') + 'await new Promise(r => setTimeout(r, 400));' + `document.querySelector('[data-act="abrirAvisos"]')?.click();`],
  ['m-bienvenida', 'm5', TAB('inicio') + 'await new Promise(r => setTimeout(r, 400)); window.Bienvenida && Bienvenida.abrir();', { q: 'bv=1' }],
  ['m-mas', 'm1', TAB('inicio') + 'await new Promise(r => setTimeout(r, 400));' + `[...document.querySelectorAll('.bb-item')].pop()?.click();`, { solo: 'cel' }],
  ['s-inicio', 'sec', TAB('inicio')],
  ['s-distrito', 'sec', TAB('distrito')],
  ['s-tareas', 'sec', TAB('tareas')],
  ['s-seguimiento', 'sec', TAB('seguimiento')],
  ['s-reportes', 'sec', TAB('reportes')],
  ['s-novedades', 'sec', TAB('inicio') + 'await new Promise(r => setTimeout(r, 400)); window.Bienvenida && Bienvenida.abrir();', { q: 'bv=3' }],
  ['s-nueva-tarea', 'sec', TAB('tareas') + 'await new Promise(r => setTimeout(r, 500));' + `document.querySelector('[data-act="tkAccion"][data-arg="nueva"]')?.click();`],
  ['s-selector', 'sec', TAB('tareas') + 'await new Promise(r => setTimeout(r, 500));' + `document.querySelector('[data-act="tkAccion"][data-arg="nueva"]')?.click(); await new Promise(r => setTimeout(r, 500));` +
    `const t = document.querySelector('#asig-titulo'); if (t) { t.value = 'Cobertura de la jornada'; t.dispatchEvent(new Event('input', { bubbles: true })); }` + CLICK_TXT('button', '/^Siguiente/')],
  ['s-actividad', 'sec', TAB('calendario') + 'await new Promise(r => setTimeout(r, 600));' + CLICK_TXT('button', '/Nueva actividad/')],
];

// ── Protocolo de depuración ──
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'capman-'));
const proc = spawn(NAV, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${perfil}`, '--hide-scrollbars', '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
let lista = null;
for (let i = 0; i < 60 && !lista; i++) { try { lista = await (await fetch('http://127.0.0.1:9333/json')).json(); } catch { await esp(250); } }
if (!lista) { proc.kill(); console.error('Edge no abrió el puerto de depuración.'); process.exit(1); }
const ws = new WebSocket(lista.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let n = 0; const esperando = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && esperando.has(m.id)) { esperando.get(m.id)(m); esperando.delete(m.id); } });
const cdp = (method, params = {}) => new Promise(res => { const id = ++n; esperando.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJS = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.log('   · aviso:', r.result.exceptionDetails.exception?.description?.slice(0, 120)); };

async function capturar([nombre, como, receta, op], modo) {
  if (op?.solo && op.solo !== modo) return;
  const cel = modo === 'cel';
  await cdp('Emulation.setDeviceMetricsOverride', cel ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `${BASE}/${como === 'sec' ? 'secretario' : 'user'}.html?as=${como}${op?.q ? "&" + op.q : ""}` });
  await esp(2200);
  await evalJS("try { localStorage.setItem('theme', 'dark'); } catch (e) {} window.setTheme && setTheme('dark');");
  await evalJS(receta);
  await esp(1100);
  const r = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
  fs.writeFileSync(OUT + nombre + (cel ? '' : '-pc') + '.jpg', Buffer.from(r.result.data, 'base64'));
  console.log('✓', nombre + (cel ? '' : '-pc'));
}

await cdp('Page.enable');
for (const c of CAPTURAS) {
  if (FILTRO && !c[0].includes(FILTRO)) continue;
  await capturar(c, 'cel');
  await capturar(c, 'pc');
}
ws.close(); proc.kill();
try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* Edge aún libera el perfil */ }
