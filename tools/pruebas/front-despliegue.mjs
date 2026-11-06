// Qué se despliega: .vercelignore excluye el interior del proyecto y el sitio no depende de lo excluido.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const leer = f => fs.readFileSync(path.join(R, f), 'utf8');
let ok = 0, mal = 0; const t = (n, c) => { if (c) { ok++; console.log('  ✓ ' + n); } else { mal++; console.log('  ✗ ' + n); } };

const vi = fs.existsSync(path.join(R, '.vercelignore')) ? leer('.vercelignore').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')) : [];
console.log('[.vercelignore]');
for (const p of ['supabase/', 'docs/', 'tools/', '.github/', '*.sql', 'CLAUDE.md']) t(`excluye ${p}`, vi.includes(p));

console.log('[el sitio no carga nada de lo excluido]');
const sitio = fs.readdirSync(R).filter(f => /\.(html|js|css)$/.test(f)).concat(fs.readdirSync(path.join(R, 'core')).filter(f => fs.statSync(path.join(R, 'core', f)).isFile()).map(f => 'core/' + f), fs.readdirSync(path.join(R, 'ayuda')).filter(f => /\.(html|js|css)$/.test(f)).map(f => 'ayuda/' + f));
const prohibido = /(?:href|src)=["'][^"']*(?:\/|^)(?:docs|supabase|tools)\/|fetch\(\s*['"`][^'"`]*(?:docs|supabase)\/|\.sql['"`]/;
const malos = sitio.filter(f => prohibido.test(leer(f)));
t('ningún html/js/css del sitio referencia docs/, supabase/, tools/ ni .sql', malos.length === 0);
if (malos.length) console.log('    ', malos.join(', '));
console.log(`\n${ok} correctas, ${mal} fallidas`); process.exit(mal ? 1 : 0);
