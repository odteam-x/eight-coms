import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Todo icono que el marcado o el JS piden (data-lucide, icono:, ico:, icon:) debe existir en core/iconos.js (o en sus alias).
// Si falta, la pantalla muestra un hueco en blanco sin avisar al usuario; solo queda un aviso en la consola.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const src = fs.readFileSync(ROOT + 'core/iconos.js', 'utf8');
const linea = nombre => src.split(/\r?\n/).find(l => l.startsWith('const ' + nombre + ' = '));
const lit = nombre => { const l = linea(nombre); return l.slice(l.indexOf('=') + 1).trim().replace(/;$/, ''); };
const ICONOS = vm.runInNewContext('(' + lit('ICONOS_SVG') + ')');
const alias = vm.runInNewContext('(' + lit('ICONO_ALIAS') + ')');
const tiene = n => n in ICONOS || (alias[n] && alias[n] in ICONOS);

const archivos = [];
const andar = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f);
  if (/node_modules|\.git|\.claude|tools|supabase|docs|videos|img/.test(p.replace(ROOT, ''))) continue;
  const st = fs.statSync(p); if (st.isDirectory()) andar(p); else if (/\.(js|html)$/.test(f) && f !== 'iconos.js') archivos.push(p); } };
andar(ROOT);

const falta = new Map();
const reg = (n, f, linea) => { if (!n || /[${}]/.test(n) || !/^[a-z0-9-]+$/.test(n)) return; if (!tiene(n)) { const k = n; (falta.get(k) || falta.set(k, []).get(k)).push(`${path.relative(ROOT, f)}:${linea}`); } };
for (const f of archivos) {
  const lineas = fs.readFileSync(f, 'utf8').split('\n');
  lineas.forEach((l, i) => {
    for (const x of l.matchAll(/data-lucide=["']([a-z0-9-]+)["']/g)) reg(x[1], f, i + 1);
    for (const x of l.matchAll(/\b(?:icono|ico|icon|ic)\s*:\s*['"]([a-z0-9-]+)['"]/g)) reg(x[1], f, i + 1);
    for (const x of l.matchAll(/\bicono\s*=\s*['"]([a-z0-9-]+)['"]/g)) reg(x[1], f, i + 1);
  });
}
console.log(`Iconos en el pack: ${Object.keys(ICONOS).length} (+${Object.keys(alias).length} alias) · archivos revisados: ${archivos.length}`);
if (!falta.size) console.log('✓ todos los iconos usados existen');
const n = falta.size;
console.log(`
${n ? 0 : 1} correctas, ${n} fallidas`);
for (const [n, ls] of falta) console.log(`✗ «${n}» no existe → ${ls.slice(0, 4).join(', ')}${ls.length > 4 ? ' …' : ''}`);
process.exit(falta.size ? 1 : 0);
