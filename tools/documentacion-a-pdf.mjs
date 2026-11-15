// Convierte los capítulos de docs/sistema/ en una página HTML legible y en un PDF (A4) con índice, para quien no lee archivos .md.
//   node tools/documentacion-a-pdf.mjs [carpeta de salida]
// Salida: DOCUMENTACION-COMPLETA-DEL-SISTEMA.html y .pdf. El PDF lo imprime Microsoft Edge/Chrome en modo headless; los diagramas
// (mermaid) se dibujan con mermaid desde jsDelivr, así que hace falta internet la primera vez.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const DIR = new URL('../docs/sistema/', import.meta.url);
const SALIDA = path.resolve(process.argv[2] || 'docs-pdf');
fs.mkdirSync(SALIDA, { recursive: true });

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function inline(t) {
  const trozos = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => { trozos.push(`<code>${esc(c)}</code>`); return `\u0000${trozos.length - 1}\u0000`; });
  t = esc(t)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(«"])\*([^*\s][^*]*?)\*(?=[\s).,;:»"]|$)/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, a, h) => /^https?:/.test(h) ? `<a href="${h}">${a}</a>` : `<span class="ref">${a}</span>`);
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => trozos[+i]);
}

function convertir(md, capId) {
  const L = md.replace(/\r\n/g, '\n').split('\n');
  const out = []; const toc = [];
  let i = 0;
  while (i < L.length) {
    const l = L[i];
    if (/^```/.test(l)) {
      const lang = l.slice(3).trim(); const cod = [];
      i++; while (i < L.length && !/^```/.test(L[i])) cod.push(L[i++]); i++;
      out.push(lang === 'mermaid' ? `<pre class="mermaid">${esc(cod.join('\n'))}</pre>` : `<pre><code>${esc(cod.join('\n'))}</code></pre>`);
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const n = h[1].length; const id = `${capId}-${slug(h[2])}`;
      if (n <= 3) toc.push({ n, id, t: h[2].replace(/[`*]/g, '') });
      out.push(`<h${n} id="${id}">${inline(h[2])}</h${n}>`); i++; continue;
    }
    if (/^---+\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^\|.*\|\s*$/.test(l) && /^\|[\s:|-]+\|\s*$/.test(L[i + 1] || '')) {
      const cel = r => r.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
      const cab = cel(l); i += 2; const filas = [];
      while (i < L.length && /^\|.*\|\s*$/.test(L[i])) filas.push(cel(L[i++]));
      out.push(`<table><thead><tr>${cab.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${filas.map(f => `<tr>${f.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^>\s?/.test(l)) {
      const q = []; while (i < L.length && /^>\s?/.test(L[i])) q.push(L[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(q.join(' '))}</blockquote>`); continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ord = /^\s*\d+\./.test(l); const items = [];
      while (i < L.length && /^\s*([-*]|\d+\.)\s+/.test(L[i])) {
        let t = L[i].replace(/^\s*([-*]|\d+\.)\s+/, ''); i++;
        while (i < L.length && /^\s{2,}\S/.test(L[i]) && !/^\s*([-*]|\d+\.)\s+/.test(L[i])) t += ' ' + L[i++].trim();
        items.push(t);
      }
      out.push(`<${ord ? 'ol' : 'ul'}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</${ord ? 'ol' : 'ul'}>`); continue;
    }
    if (!l.trim()) { i++; continue; }
    const p = [l]; i++;
    while (i < L.length && L[i].trim() && !/^(#{1,4}\s|```|\||>|---|\s*([-*]|\d+\.)\s+)/.test(L[i])) p.push(L[i++]);
    out.push(`<p>${inline(p.join(' '))}</p>`);
  }
  return { html: out.join('\n'), toc };
}

const capitulos = fs.readdirSync(DIR).filter(x => /^\d\d-.*\.md$/.test(x)).sort();
let cuerpo = ''; const indice = [];
for (const c of capitulos) {
  const id = 'c' + c.slice(0, 2);
  const { html, toc } = convertir(fs.readFileSync(new URL(c, DIR), 'utf8'), id);
  indice.push({ id, toc });
  cuerpo += `<section class="capitulo" id="${id}">\n${html}\n</section>\n`;
}
const tocHtml = indice.map(({ toc }) => toc.map(t => `<li class="n${t.n}"><a href="#${t.id}">${esc(t.t)}</a></li>`).join('')).join('');
const fecha = new Date().toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' });

const pagina = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Documentación completa del sistema · EIGHT CREATORS LABs</title>
<style>
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
* { box-sizing: border-box; }
html { background: #fff; color-scheme: light; }
body { background: #fff; font: 10.5pt/1.55 "Segoe UI", "Source Sans 3", Arial, sans-serif; color: #14213d; margin: 0; }
.portada { height: 255mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
.portada .sup { letter-spacing: .14em; text-transform: uppercase; font-size: 10pt; color: #52627f; }
.portada h1 { font-size: 34pt; line-height: 1.05; font-weight: 300; margin: 10px 0 14px; letter-spacing: -.02em; border: 0; }
.portada p { font-size: 12pt; color: #3a4a68; max-width: 150mm; }
.indice { page-break-after: always; }
.indice h2 { font-size: 20pt; font-weight: 600; border: 0; }
.indice ul { list-style: none; padding: 0; margin: 0; columns: 1; }
.indice li { margin: 2px 0; font-size: 9.5pt; }
.indice li.n1 { margin-top: 9px; font-weight: 700; font-size: 11pt; }
.indice li.n2 { padding-left: 14px; }
.indice li.n3 { padding-left: 30px; color: #52627f; font-size: 9pt; }
.indice a { color: inherit; text-decoration: none; }
.capitulo { page-break-before: always; }
h1 { font-size: 22pt; font-weight: 600; letter-spacing: -.015em; margin: 0 0 8mm; padding-bottom: 3mm; border-bottom: 1px solid #c8d2e6; }
h2 { font-size: 15pt; font-weight: 600; margin: 9mm 0 3mm; page-break-after: avoid; }
h3 { font-size: 12pt; font-weight: 600; margin: 6mm 0 2mm; page-break-after: avoid; }
h4 { font-size: 10.5pt; font-weight: 600; margin: 4mm 0 1mm; color: #3a4a68; page-break-after: avoid; }
p { margin: 0 0 3mm; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; } li { margin: 1mm 0; }
table { border-collapse: collapse; width: 100%; margin: 3mm 0 5mm; font-size: 9pt; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th, td { border: 1px solid #c8d2e6; padding: 1.6mm 2.2mm; text-align: left; vertical-align: top; }
th { background: #e8eef9; font-weight: 600; }
code { font: 8.6pt Consolas, "Cascadia Mono", monospace; background: #eef2fa; padding: 0 1.2mm; border-radius: 3px; }
pre { background: #f3f6fc; border: 1px solid #d6deee; border-radius: 6px; padding: 3mm; overflow: hidden; white-space: pre-wrap; font-size: 8.6pt; page-break-inside: avoid; }
pre code { background: none; padding: 0; }
pre.mermaid { background: #fff; border: 1px solid #d6deee; text-align: center; white-space: normal; }
blockquote { margin: 3mm 0; padding: 2.5mm 4mm; background: #fff6e0; border-radius: 6px; font-size: 9.5pt; }
hr { border: 0; border-top: 1px solid #d6deee; margin: 6mm 0; }
a { color: #0b4fb3; } .ref { color: #0b4fb3; }
</style></head><body>
<div class="portada"><div class="sup">CELIDER 08 Santiago</div><h1>Documentación completa del sistema</h1>
<p><b>EIGHT CREATORS LABs</b> — todos los procesos, actividades, pantallas, cálculos, datos y seguridad del portal, y una propuesta de reorganización.</p>
<p>Estado descrito: 15 de noviembre de 2026 · migraciones 0001 a 0064 · generado el ${fecha}.</p></div>
<div class="indice"><h2>Contenido</h2><ul>${tocHtml}</ul></div>
${cuerpo}
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
<script>mermaid.initialize({ startOnLoad: true, theme: 'neutral', flowchart: { useMaxWidth: true } }); window.__listo = true;</script>
</body></html>`;

const html = path.join(SALIDA, 'DOCUMENTACION-COMPLETA-DEL-SISTEMA.html');
const pdf = path.join(SALIDA, 'DOCUMENTACION-COMPLETA-DEL-SISTEMA.pdf');
fs.writeFileSync(html, pagina);

const NAV = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
if (!NAV) { console.log('HTML listo; no encuentro Edge/Chrome para el PDF:', html); process.exit(0); }
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'docpdf-'));
const r = spawnSync(NAV, ['--headless', '--disable-gpu', `--user-data-dir=${perfil}`, '--no-pdf-header-footer', '--virtual-time-budget=25000',
  `--print-to-pdf=${pdf}`, 'file:///' + html.replace(/\\/g, '/')], { stdio: 'ignore', timeout: 180000 });
try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* Edge aún libera el perfil */ }
console.log(fs.existsSync(pdf) ? `PDF: ${pdf} (${Math.round(fs.statSync(pdf).size / 1024)} KB)` : 'No se generó el PDF (código ' + r.status + ')');
