// Genera docs/plantillas-supabase.html: una sola página con cada plantilla de acceso lista para copiar.
//   node tools/guia-plantillas.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const asuntos = JSON.parse(readFileSync(join(RAIZ, 'supabase/emails/asuntos.json'), 'utf8')).auth;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const FILAS = [
  ['Confirm sign up', 'confirmacion'],
  ['Invite user', 'invitacion'],
  ['Magic link or OTP', 'enlace_magico'],
  ['Change email address', 'cambio_correo'],
  ['Reset password', 'recuperacion'],
  ['Reauthentication', 'reautenticacion'],
];

const bloques = FILAS.map(([fila, clave], i) => {
  const html = readFileSync(join(RAIZ, `supabase/emails/auth/${clave}.html`), 'utf8');
  return `
  <section class="tpl" id="${clave}">
    <h2><span class="n">${i + 1}</span> ${fila}</h2>
    <p class="donde">Authentication → Emails → Templates → <b>${fila}</b></p>
    <div class="campo"><div class="et">Subject <button data-c="s-${clave}">Copiar asunto</button></div><pre id="s-${clave}">${esc(asuntos[clave])}</pre></div>
    <div class="campo"><div class="et">Message body (pestaña Source) <button data-c="h-${clave}">Copiar HTML</button></div><pre id="h-${clave}">${esc(html)}</pre></div>
  </section>`;
}).join('\n');

const tabla = FILAS.map(([fila, clave], i) => `<tr><td>${i + 1}</td><td><a href="#${clave}">${fila}</a></td><td>${esc(asuntos[clave])}</td></tr>`).join('');

writeFileSync(join(RAIZ, 'docs/plantillas-supabase.html'), `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Plantillas de correo para Supabase</title>
<style>
  :root{color-scheme:dark;--bg:#061326;--s1:#0A1D38;--s2:#10264A;--txt:#F3F8FF;--txt2:#A7E8FF;--trazo:#1B3A66;--coral:#FF6063;--navy:#002247}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:16px/1.55 'Segoe UI',Helvetica,Arial,sans-serif;padding:24px 16px 80px}
  main{max-width:880px;margin:0 auto}h1{font-size:2rem;line-height:1.1;margin:0 0 8px}h2{font-size:1.3rem;margin:0 0 4px;display:flex;gap:10px;align-items:center}
  p{color:#C9DBEE}.n{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--coral);color:var(--navy);font-weight:700;font-size:.95rem}
  table{width:100%;border-collapse:collapse;background:var(--s1);border-radius:16px;overflow:hidden;margin:16px 0 32px}
  th,td{text-align:left;padding:12px 16px;border-bottom:1px solid var(--trazo);font-size:.95rem}th{color:var(--txt2);font-weight:600}tr:last-child td{border-bottom:0}a{color:var(--txt2)}
  .tpl{background:var(--s1);border-radius:24px;padding:20px 20px 8px;margin:0 0 24px}.donde{margin:0 0 16px;font-size:.9rem}
  .campo{margin:0 0 16px}.et{display:flex;justify-content:space-between;align-items:center;gap:12px;font-weight:600;margin-bottom:6px}
  button{background:var(--coral);color:var(--navy);border:0;border-radius:999px;padding:10px 18px;font:600 .9rem 'Segoe UI',Arial,sans-serif;cursor:pointer;min-height:40px}
  button.ok{background:var(--txt2)}
  pre{margin:0;padding:14px 16px;background:var(--s2);border-radius:14px;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all;font:12.5px/1.45 Consolas,Menlo,monospace;color:#DCEBFA}
  .smtp td:first-child{color:var(--txt2);font-weight:600;width:34%}
</style></head><body><main>
<h1>Plantillas de correo para Supabase</h1>
<p>Panel del proyecto <b>eight coms</b> → <b>Authentication → Emails → Templates</b>. En cada fila: pega el asunto en <i>Subject</i>, abre la pestaña <b>Source</b> en <i>Message body</i>, borra lo que haya, pega el HTML y pulsa <b>Save</b>.</p>
<table><thead><tr><th>#</th><th>Fila en Supabase</th><th>Asunto (Subject)</th></tr></thead><tbody>${tabla}</tbody></table>
${bloques}
<section class="tpl">
  <h2>Antes: SMTP propio</h2>
  <p class="donde">Authentication → Emails → <b>SMTP Settings</b> → Enable custom SMTP</p>
  <table class="smtp"><tbody>
    <tr><td>Sender email</td><td>creatorscelider08sti@gmail.com</td></tr>
    <tr><td>Sender name</td><td>EIGHT CREATORS LABs</td></tr>
    <tr><td>Host</td><td>smtp.gmail.com</td></tr>
    <tr><td>Port</td><td>465</td></tr>
    <tr><td>Username</td><td>creatorscelider08sti@gmail.com</td></tr>
    <tr><td>Password</td><td>la contraseña de aplicación de 16 letras (la que creaste en Google)</td></tr>
  </tbody></table>
</section>
</main>
<script>
document.querySelectorAll('button[data-c]').forEach(function(b){b.addEventListener('click',function(){
  var t=document.getElementById(b.dataset.c).textContent;
  var fin=function(){var o=b.textContent;b.textContent='¡Copiado!';b.classList.add('ok');setTimeout(function(){b.textContent=o;b.classList.remove('ok')},1500)};
  if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(t).then(fin)}
  else{var a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove();fin()}
})});
</script></body></html>
`);
console.log('ok → docs/plantillas-supabase.html');
