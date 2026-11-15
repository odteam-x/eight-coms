/**
 * Recorrido de «humo» de BOTONES: node tools/pruebas/ui/humo.mjs [puerto] [anchos=1440,390] [roles=admin,sec,miembro]
 *
 * En cada pantalla de cada rol pulsa (de verdad, con el ratón) cada control con data-act / data-arg distinto y comprueba:
 *   · que no salga un error de JavaScript ni de consola,
 *   · que no se avise «[acciones] desconocida / no permitida» (botón sin función),
 *   · que no salga un aviso rojo («Error: …») por una acción que debería funcionar,
 *   · que el control sea PULSABLE (nada lo tapa en su centro) cuando se pulsa.
 * Entre pantallas recarga el simulador (estado limpio). NO pulsa: cerrar sesión ni borrados definitivos.
 */
import fs from 'node:fs'; import { chromium } from 'playwright-core';
const [puerto = '3100', anchosArg = '1440,390', rolesArg = 'admin,sec,miembro'] = process.argv.slice(2);
const BASE = `http://localhost:${puerto}`;
const NAV = process.env.NAVEGADOR || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const ROLES = { admin: { url: '/admin.html?as=admin', entrada: true }, sec: { url: '/secretario.html?as=sec' }, miembro: { url: '/user.html?as=m1' } };
const SALTAR = /^(salir|cerrarSesion|logout)$/;
const SALTAR_ARG = /borrar|eliminar|delete|remove/i;
const espera = ms => new Promise(r => setTimeout(r, ms));
const hallazgos = [];
const browser = await chromium.launch({ executablePath: NAV, headless: true });
let pulsados = 0;

async function abrir(rol, ancho) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: ancho < 768 ? 844 : 900 }, isMobile: ancho < 768, hasTouch: ancho < 768 });
  const page = await ctx.newPage(); const log = [];
  page.on('filechooser', fc => fc.setFiles([]).catch(() => {}));   // «Cambiar foto» abre el selector de archivos: se cierra solo
  page.on('pageerror', e => log.push('JS: ' + e.message.slice(0, 160)));
  page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/favicon|manifest|Failed to load resource/i.test(x)) log.push('consola: ' + x.slice(0, 160)); if (/\[acciones\]/.test(x)) log.push(x.slice(0, 120)); });
  await page.goto(BASE + ROLES[rol].url); await espera(1300);
  if (ROLES[rol].entrada) { await page.locator('#modal-entrada .btn-save').first().click().catch(() => {}); await espera(1400); }
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;scroll-behavior:auto!important}' });
  return { ctx, page, log };
}

for (const ancho of anchosArg.split(',').map(Number)) for (const rol of rolesArg.split(',')) {
  let s = await abrir(rol, ancho);
  const tabs = await s.page.evaluate(() => [...new Set([...document.querySelectorAll('.rail .rail-item[data-arg], .bottom-bar [data-arg], .hoja [data-arg]')].map(b => b.dataset.arg).filter(t => t && document.getElementById('tab-' + t)))]);
  tabs.push('cuenta');
  for (const tab of [...new Set(tabs)]) {
    await s.page.evaluate(t => { window.switchTab(t, null); window.scrollTo(0, 0); }, tab).catch(() => {}); await espera(1100);
    // candidatos únicos por (act, arg, arg2) dentro de la pestaña activa o de superficies abiertas
    const cand = await s.page.evaluate(() => {
      const raiz = document.querySelector('.atab-content.active, .tab-content.active') || document.body;
      const vis = e => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 4 && r.height > 4 && c.visibility !== 'hidden' && c.display !== 'none'; };
      const out = [], vistos = new Set();
      raiz.querySelectorAll('[data-act]').forEach((e, i) => { if (!vis(e) || e.disabled || e.closest('details:not([open])')) return; const k = [e.dataset.act, e.dataset.arg, e.dataset.arg2].join('|'); if (vistos.has(k)) return; vistos.add(k); e.setAttribute('data-humo', String(i)); out.push({ i, key: k, act: e.dataset.act, arg: e.dataset.arg || '', txt: (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) }); });
      return out;
    });
    let n = 0;
    for (const c of cand) {
      if (SALTAR.test(c.act) || SALTAR_ARG.test(c.arg) || SALTAR_ARG.test(c.act) || SALTAR.test(c.arg)) continue;
      if (++n > 40) break;
      const el = s.page.locator(`[data-humo="${c.i}"]`).first();
      if (!(await el.count())) continue;
      const antes = s.log.length;
      const est0 = await s.page.evaluate(() => (document.querySelector('.atab-content.active, .tab-content.active')?.id || '') + '|' + document.querySelectorAll('.panel-overlay.open, .panel-overlay[style*="flex"], .modal-overlay[style*="flex"], .tk-overlay[style*="flex"], .panel--pantalla').length);
      const tapado = await el.evaluate(e => { e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); const x = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return x && !e.contains(x) && !x.contains(e) ? x.tagName + '.' + [...x.classList].slice(0, 2).join('.') : ''; }).catch(() => '');
      let hecho = false, motivo = '';
      for (let intento = 0; intento < 2 && !hecho; intento++) {
        try { await s.page.locator(`[data-humo="${c.i}"]`).first().click({ timeout: 2000 }); pulsados++; hecho = true; }
        catch (e) {
          motivo = e.message.split('\n')[0].slice(0, 90);
          // El primer fallo suele ser estado que dejó el control anterior: se recarga limpio y se reintenta una vez.
          await s.ctx.close(); s = await abrir(rol, ancho);
          await s.page.evaluate(t => window.switchTab(t, null), tab).catch(() => {}); await espera(900);
          await s.page.evaluate(([i, k]) => { const raiz = document.querySelector('.atab-content.active, .tab-content.active') || document.body; let hecho = false; raiz.querySelectorAll('[data-act]').forEach(e => { if (!hecho && [e.dataset.act, e.dataset.arg, e.dataset.arg2].join('|') === k) { hecho = true; e.setAttribute('data-humo', String(i)); } }); }, [c.i, c.key]).catch(() => {});
        }
      }
      if (!hecho) { hallazgos.push({ rol, ancho, tab, ctl: `${c.act}:${c.arg} «${c.txt}»`, problema: 'no se pudo pulsar (ni tras recargar): ' + motivo }); continue; }
      if (tapado) hallazgos.push({ rol, ancho, tab, ctl: `${c.act}:${c.arg} «${c.txt}»`, problema: 'lo tapa ' + tapado });
      await espera(350);
      const nuevos = s.log.slice(antes); for (const m of nuevos) hallazgos.push({ rol, ancho, tab, ctl: `${c.act}:${c.arg} «${c.txt}»`, problema: m });
      const toastErr = await s.page.evaluate(() => [...document.querySelectorAll('.toast.error, .toast--error, .toast.t-error, #toast.error')].map(e => e.textContent.trim().slice(0, 100)).join(' | ')).catch(() => '');
      if (toastErr) hallazgos.push({ rol, ancho, tab, ctl: `${c.act}:${c.arg} «${c.txt}»`, problema: 'aviso rojo: ' + toastErr });
      // cierra lo que se haya abierto y vuelve a la pestaña
      await s.page.keyboard.press('Escape').catch(() => {}); await espera(150);
      const est1 = await s.page.evaluate(() => (document.querySelector('.atab-content.active, .tab-content.active')?.id || '') + '|' + document.querySelectorAll('.panel-overlay.open, .panel-overlay[style*="flex"], .modal-overlay[style*="flex"], .tk-overlay[style*="flex"], .panel--pantalla').length).catch(() => 'x');
      if (est1 !== est0 || !s.page.url().includes(ROLES[rol].url.split('?')[0].replace('/', ''))) { await s.ctx.close(); s = await abrir(rol, ancho); await s.page.evaluate(t => window.switchTab(t, null), tab).catch(() => {}); await espera(900); }
    }
    // reinicio limpio entre pantallas
    await s.ctx.close(); s = await abrir(rol, ancho);
  }
  await s.ctx.close();
  console.log(`· ${rol} ${ancho}px: ${[...new Set(tabs)].length} pantallas`);
}
await browser.close();
const uniq = new Map(); for (const h of hallazgos) uniq.set([h.rol, h.tab, h.ctl, h.problema].join('|'), h);
console.log(`\n${pulsados} controles pulsados · ${uniq.size} hallazgos`);
for (const h of uniq.values()) console.log(`  ✗ ${h.rol}/${h.ancho}/${h.tab}  ${h.ctl}  → ${h.problema}`);
fs.writeFileSync('docs/evidencias/humo-botones.json', JSON.stringify([...uniq.values()], null, 1));
process.exit(uniq.size ? 1 : 0);
