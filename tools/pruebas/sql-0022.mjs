// Pruebas de 0022 (campana: avisos dentro de la plataforma) contra Postgres real (PGlite), con RLS.
// La tabla `notificaciones` se toma del propio 0019 (solo su CREATE TABLE + REVOKE: pg_cron/pg_net no existen en PGlite).
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const R = DIR + '../../supabase/migrations/';
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };
const q = async s => (await db.query(s)).rows;
const as = async (uid, role = 'authenticated') => {
  await db.exec('RESET ROLE');
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid ?? ''}',false)`);
  await db.exec(`SET ROLE ${role}`);
};
const root = async () => { await db.exec('RESET ROLE'); await db.exec(`SELECT set_config('request.jwt.claim.sub','',false)`); };
async function rejects(sql, patron, msg) {
  try { await db.exec(sql); ok(false, msg + ' (NO fue rechazado)'); }
  catch (e) { ok(!patron || new RegExp(patron, 'i').test(e.message), msg + ' → ' + e.message.slice(0, 80)); }
}
const uid = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const A = uid(1), B = uid(2), ADMIN = uid(90);

await db.exec(fs.readFileSync(DIR + 'stub.sql', 'utf8'));
await db.exec(`
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
  INSERT INTO profiles(id,nombre,email,es_admin) VALUES ('${ADMIN}','Admin','admin@x.cl',true);
  INSERT INTO profiles(id,nombre,email) VALUES ('${A}','Ana','ana@x.cl'),('${B}','Beto','beto@x.cl');
`);
const m19 = fs.readFileSync(R + '0019_notificaciones.sql', 'utf8');
const tabla = m19.match(/CREATE TABLE IF NOT EXISTS public\.notificaciones \([\s\S]*?\n\);/)[0];
await db.exec(tabla + `
  ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.notificaciones FROM anon, authenticated;`);
await db.exec(fs.readFileSync(R + '0022_notificaciones_app.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0022_notificaciones_app.sql', 'utf8'));
console.log('— 0022 aplicada sin errores (dos veces: es idempotente)');

await root();
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001';
await db.exec(`
  INSERT INTO notificaciones(destinatario_id,tipo,datos,dedupe_key,enviar_despues) VALUES
   ('${A}','tarea_asignada','{"tarea":"Retratos"}','tarea_asignada:${T1}', now() - interval '3 hours'),
   ('${A}','nota_publicada','{"periodo":"PE2"}','nota_publicada:55:2026101716', now() - interval '1 hour'),
   ('${A}','nota_corregida','{"periodo":"PE2"}','nota_corregida:55:2026101717', now() + interval '15 minutes'),
   ('${B}','tarea_asignada','{"tarea":"Secreta de Beto"}','tarea_asignada:${T1}b', now() - interval '2 hours'),
   ('${ADMIN}','solicitud_acceso','{"persona":"Nuevo"}','solicitud_acceso:${T1}:x', now() - interval '1 hour');
`);

console.log('\n[lectura: cada persona ve solo lo suyo]');
await as(A);
let l = await q(`SELECT * FROM mis_notificaciones()`);
ok(l.length === 2, 'Ana ve sus 2 avisos ya vencidos (el programado a futuro no aparece aún)');
ok(l[0].tipo === 'nota_publicada' && l[1].tipo === 'tarea_asignada', 'orden: el más reciente primero');
ok(l[1].ref_id === T1, 'ref_id sale de dedupe_key (id de la tarea)');
ok(!JSON.stringify(l).includes('Beto'), 'no se cuela nada de otra persona');
ok((await q(`SELECT notif_no_leidas() n`))[0].n === 2, 'contador = 2 sin leer');
await as(B);
ok((await q(`SELECT * FROM mis_notificaciones()`)).length === 1, 'Beto ve solo el suyo');
await as(ADMIN);
ok((await q(`SELECT * FROM mis_notificaciones()`)).length === 1, 'la administración ve sus propios avisos, no los de todos');

console.log('\n[la tabla sigue cerrada]');
await as(A);
await rejects(`SELECT * FROM notificaciones`, 'permission', 'authenticated no lee la tabla directamente');
await rejects(`UPDATE notificaciones SET leida_en = now()`, 'permission', 'authenticated no escribe la tabla directamente');
await as(null, 'anon');
await rejects(`SELECT * FROM mis_notificaciones()`, 'permission', 'anon no puede ni llamar a la función');
await root();
await db.exec(`SELECT set_config('request.jwt.claim.sub','',false)`);
await rejects(`SET ROLE authenticated; SELECT * FROM mis_notificaciones()`, 'sesion', 'sin sesión se rechaza (guardia en el sentido correcto)');
await root();

console.log('\n[marcar leídas]');
await as(A);
const id1 = (await q(`SELECT id FROM mis_notificaciones() WHERE tipo='nota_publicada'`))[0].id;
ok((await q(`SELECT notif_marcar_leida(${id1}) r`))[0].r === true, 'Ana marca una como leída');
ok((await q(`SELECT notif_no_leidas() n`))[0].n === 1, 'el contador baja a 1');
ok((await q(`SELECT leida_en FROM mis_notificaciones() WHERE id=${id1}`))[0].leida_en !== null, 'la lista refleja leida_en');
await root();
const idBeto = (await q(`SELECT id FROM notificaciones WHERE destinatario_id='${B}'`))[0].id;
await as(A);
ok((await q(`SELECT notif_marcar_leida(${idBeto}) r`))[0].r === false, 'Ana no puede marcar un aviso de Beto (devuelve false)');
await root();
ok((await q(`SELECT leida_en FROM notificaciones WHERE id=${idBeto}`))[0].leida_en === null, 'el aviso de Beto sigue sin leer');
await as(A);
ok((await q(`SELECT notif_marcar_todas() n`))[0].n === 1, 'marcar todas devuelve cuántas cambió');
ok((await q(`SELECT notif_no_leidas() n`))[0].n === 0, 'el contador queda en 0');
await root();
ok((await q(`SELECT leida_en FROM notificaciones WHERE tipo='nota_corregida'`))[0].leida_en === null, 'un aviso programado a futuro no se marca por adelantado');

console.log('\n[paginación y límites]');
await root();
await db.exec(`INSERT INTO notificaciones(destinatario_id,tipo,datos,dedupe_key,enviar_despues)
  SELECT '${A}','actividad_nueva','{}', 'actividad_nueva:' || g || ':x', now() - (g || ' days')::interval FROM generate_series(1,130) g`);
await as(A);
ok((await q(`SELECT * FROM mis_notificaciones(500)`)).length === 100, 'el límite máximo es 100');
const pag1 = await q(`SELECT * FROM mis_notificaciones(10)`);
const pag2 = await q(`SELECT * FROM mis_notificaciones(10, '${pag1[9].creada.toISOString()}')`);
ok(pag1.length === 10 && pag2.length === 10 && pag2[0].id !== pag1[9].id, 'p_antes pagina sin repetir');
ok((await q(`SELECT * FROM mis_notificaciones(0)`)).length === 1, 'un límite 0 se corrige a 1');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
