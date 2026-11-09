// Perfil de CPU de la carga de un portal (celular, CPU ×4): qué funciones consumen más. node tools/pruebas/ui/perfil-cpu.mjs [url] [puerto]
import fs from 'node:fs'; import { chromium } from 'playwright-core';
const [url = '/admin.html?as=admin', puerto = '3100'] = process.argv.slice(2);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const b = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
await page.goto(`http://localhost:${puerto}${url}`, { waitUntil: 'load' }); await page.waitForTimeout(800);
await page.locator('#modal-entrada .btn-save').first().click().catch(() => {}); await page.waitForTimeout(3000);
const { profile } = await cdp.send('Profiler.stop');
const dt = profile.timeDeltas, ids = profile.samples, por = new Map(), nodos = new Map(profile.nodes.map(n => [n.id, n]));
ids.forEach((id, i) => { const n = nodos.get(id); const cf = n.callFrame; const k = `${cf.functionName || '(anónima)'} · ${cf.url.split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`; por.set(k, (por.get(k) || 0) + (dt[i] || 0) / 1000); });
const total = [...por.values()].reduce((a, c) => a + c, 0);
console.log('CPU total ms (con freno ×4):', Math.round(total));
[...por.entries()].filter(([k]) => !/\(idle\)|\(program\)|\(garbage/.test(k)).sort((a, c) => c[1] - a[1]).slice(0, 18).forEach(([k, v]) => console.log(String(Math.round(v)).padStart(6), k));
await b.close();
