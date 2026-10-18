// Pruebas de 0044 (manuales privados): solo la administración lee el manual; nadie escribe desde el portal. Postgres real (PGlite) con RLS.
import { crear, montar, sql } from './base-eq.mjs';

const t = crear();
const { db, q, ok, as, root, rejects, allowed, fin } = t;
const ids = await montar(t, ['0015_rubrica_v2.sql', '0015_seed_perfiles.PENDIENTE.sql']);
const { P } = ids;
const m = sql('0044_manuales_privados.sql');
await db.exec(m);
await db.exec(m);
console.log('— 0044 aplicada sin errores (dos veces: es idempotente)');
await db.exec(`INSERT INTO manuales_privados(slug, titulo, html) VALUES ('admin', 'Manual para administración', '<p>contenido secreto</p>')`);

const lee = async (uid, role = 'authenticated') => { await as(uid, role); try { return (await q(`SELECT slug FROM manuales_privados`)).length; } catch (e) { return 'error: ' + e.message.slice(0, 60); } finally { await root(); } };
console.log('\n[quién lo lee]');
ok(await lee(P.ADMIN) === 1, 'la administración lee el manual');
ok(await lee(P.SEC1) === 0, 'una secretaría no ve nada (0 filas)');
ok(await lee(P.M1) === 0, 'un miembro no ve nada (0 filas)');
ok(/permission denied/.test(String(await lee(null, 'anon'))), 'sin sesión (anon) ni siquiera puede consultar la tabla');

console.log('\n[nadie escribe desde el portal]');
for (const [n, uid] of [['la administración', P.ADMIN], ['una secretaría', P.SEC1], ['un miembro', P.M1]]) {
  await as(uid);
  await rejects(`INSERT INTO manuales_privados(slug, titulo, html) VALUES ('x', 'x', 'x')`, 'permission|row-level', `${n} no puede insertar`);
  await rejects(`UPDATE manuales_privados SET html = 'cambiado'`, 'permission|row-level', `${n} no puede modificar`);
  await rejects(`DELETE FROM manuales_privados`, 'permission|row-level', `${n} no puede borrar`);
  await root();
}
ok((await q(`SELECT html FROM manuales_privados WHERE slug='admin'`))[0].html === '<p>contenido secreto</p>', 'el contenido sigue intacto');
await allowed(`INSERT INTO manuales_privados(slug, titulo, html) VALUES ('otro', 'Otro', '<p>x</p>') ON CONFLICT (slug) DO UPDATE SET html = EXCLUDED.html`, 'quien publica (SQL Editor, como propietario) sí puede escribir');
await rejects(`INSERT INTO manuales_privados(slug, titulo, html) VALUES ('Mal Slug!', 'x', 'x')`, 'check', 'el slug solo admite minúsculas, números y guiones');
fin();
