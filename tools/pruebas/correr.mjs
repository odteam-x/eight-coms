// Corre TODAS las pruebas, cada script en su propio proceso, y resume al final.
// Por qué existe: encadenadas con `&&`, en Windows (Node 24) la cadena se cae con
// «Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c» al cerrar PGlite entre procesos,
// aunque ninguna prueba falle. Aquí un cierre raro de proceso NO se confunde con un fallo: se cuenta el resultado
// impreso («N correctas, M fallidas» / «N pasaron, M fallaron»); si el script no imprime resumen, se reintenta una vez.
// Uso: node correr.mjs [filtro]      (p. ej. `node correr.mjs sql-005` corre solo lo que contenga ese texto)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const grupos = ['sql', 'cadena', 'correo', 'front', 'rg'];
const cmds = grupos.flatMap(g => pkg.scripts[g].split('&&').map(s => s.trim()));
const filtro = process.argv[2];
const lista = [...new Set(cmds)].filter(c => c.startsWith('node ') && (!filtro || c.includes(filtro)));

const resumen = out => {
  const m = out.match(/(\d+) (?:correctas|pasaron), (\d+) (?:fallidas|fallaron)/) || out.match(/(\d+) pasaron, (\d+) fallaron/);
  return m ? { ok: Number(m[1]), mal: Number(m[2]) } : null;
};
const correr = c => spawnSync('node', c.replace(/^node /, '').split(' '), { encoding: 'utf8', timeout: 280000, stdio: ['ignore', 'pipe', 'pipe'] });

let totalOk = 0, totalMal = 0; const rotos = [];
for (const c of lista) {
  let r = correr(c), s = resumen((r.stdout || '') + (r.stderr || ''));
  if (!s) { r = correr(c); s = resumen((r.stdout || '') + (r.stderr || '')); }   // un reintento si no hubo resumen
  if (!s) { rotos.push(c + '  (sin resumen: el script no terminó)'); console.log('✗', c, '— sin resumen'); continue; }
  totalOk += s.ok; totalMal += s.mal;
  if (s.mal) rotos.push(`${c}  (${s.mal} fallidas)`);
  console.log(s.mal ? '✗' : '✓', c.padEnd(40), `${s.ok} correctas, ${s.mal} fallidas`);
}
console.log(`\n${lista.length} scripts · ${totalOk} correctas · ${totalMal} fallidas${rotos.length ? '\nCon problemas:\n  ' + rotos.join('\n  ') : ''}`);
process.exit(rotos.length ? 1 : 0);
