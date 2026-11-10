import { chromium } from 'playwright-core';
const suf = process.argv[2] || 'antes', tema = process.argv[3] || 'dark';
const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const casos = [['miembro','/user.html?as=m1',['inicio','entregas','calendario','banco']],['sec','/secretario.html?as=sec',['inicio','distrito','tareas']],['admin','/admin.html?as=admin',['overview','evaluar','usuarios']]];
for (const [n,u,tabs] of casos) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await ctx.addInitScript(t=>localStorage.setItem('ec-theme',t), tema);
  const p = await ctx.newPage(); await p.goto('http://localhost:3100'+u); await p.waitForTimeout(1500);
  if (n==='admin') { await p.locator('#modal-entrada .btn-save').click().catch(()=>{}); await p.waitForTimeout(1500); }
  await p.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
  for (const t of tabs) { await p.evaluate(t=>{ if(document.getElementById('tab-'+t)) switchTab(t,null); window.scrollTo(0,0); }, t); await p.waitForTimeout(1200);
    await p.screenshot({ path: `docs/evidencias/rediseno-nov-2026/mv-${suf}-${n}-${t}.jpg`, type:'jpeg', quality:62 }); }
  await ctx.close();
}
await b.close();
