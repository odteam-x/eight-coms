// Pruebas de 0030 (fondo de perfil elegible) contra Postgres real (PGlite). La RLS de profiles de producción no está en el
// stub, así que aquí se prueba la columna y su CHECK; quién puede escribir lo comprobó la consulta de pg_policies en producción
// (profiles_update: fila propia o administración; el disparador de privilegios no incluye `fondo`).
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const R = DIR + '../../supabase/migrations/';
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };
async function rejects(sql, patron, msg) {
  try { await db.exec(sql); ok(false, msg + ' (NO fue rechazado)'); }
  catch (e) { ok(!patron || new RegExp(patron, 'i').test(e.message), msg + ' → ' + String(e.message).slice(0, 90)); }
}
const q = async s => (await db.query(s)).rows;
const A = '00000000-0000-0000-0000-000000000001', B = '00000000-0000-0000-0000-000000000002';

await db.exec(fs.readFileSync(DIR + 'stub.sql', 'utf8'));
await db.exec(`INSERT INTO profiles(id,nombre) VALUES ('${A}','Ana'),('${B}','Beto')`);
await db.exec(fs.readFileSync(R + '0030_fondo_perfil.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0030_fondo_perfil.sql', 'utf8'));
console.log('— 0030 aplicada sin errores (dos veces: es idempotente)');

console.log('\n[la columna]');
ok((await q(`SELECT count(*)::int n FROM profiles WHERE fondo IS NOT NULL`))[0].n === 0, 'nadie cambia al aplicarla: todos en automático (NULL)');
for (const v of [1, 4, 7]) { await db.exec(`UPDATE profiles SET fondo=${v} WHERE id='${A}'`); ok((await q(`SELECT fondo FROM profiles WHERE id='${A}'`))[0].fondo === v, `se acepta el patrón ${v}`); }
await db.exec(`UPDATE profiles SET fondo=NULL WHERE id='${A}'`);
ok((await q(`SELECT fondo FROM profiles WHERE id='${A}'`))[0].fondo === null, 'se puede volver al automático (NULL)');
await rejects(`UPDATE profiles SET fondo=0 WHERE id='${A}'`, 'check|violates', 'el 0 no es una opción (automático es NULL)');
await rejects(`UPDATE profiles SET fondo=8 WHERE id='${A}'`, 'check|violates', 'no hay un octavo patrón');
await rejects(`UPDATE profiles SET fondo=-1 WHERE id='${A}'`, 'check|violates', 'ni valores negativos');
ok((await q(`SELECT fondo FROM profiles WHERE id='${B}'`))[0].fondo === null, 'el fondo de otra persona no se mueve');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
