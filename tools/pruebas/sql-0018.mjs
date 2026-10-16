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
async function allowed(sql, msg) {
  try { await db.exec(sql); ok(true, msg); } catch (e) { ok(false, msg + ' → ' + e.message.slice(0, 120)); }
}
const uid = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const ADMIN = uid(90), SEC1 = uid(91), SEC2 = uid(92), M1 = uid(1), M3 = uid(3);

await db.exec(fs.readFileSync(DIR + 'stub.sql', 'utf8'));
await db.exec(`
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
  INSERT INTO gestiones(nombre, activa) VALUES ('2026-2027', true);
  INSERT INTO gestiones(nombre, activa, archivada) VALUES ('2025-2026', false, true);
  INSERT INTO profiles(id,nombre,es_admin) VALUES ('${ADMIN}','Admin',true);
  INSERT INTO profiles(id,nombre,tipo_miembro,distrito) VALUES ('${SEC1}','Sec1','secretario','08-01'),('${SEC2}','Sec2','secretario','08-02');
  INSERT INTO profiles(id,nombre,distrito) VALUES ('${M1}','M1','08-01'),('${M3}','M3','08-02');
`);
await db.exec(fs.readFileSync(R + '0018_actividades.sql', 'utf8'));
console.log('— 0018 aplicada sin errores');
const G = (await q(`SELECT id FROM gestiones WHERE activa`))[0].id;
const GA = (await q(`SELECT id FROM gestiones WHERE archivada`))[0].id;

console.log('\n[etiquetas de partida]');
await root();
ok((await q(`SELECT count(*)::int n FROM etiquetas WHERE gestion_id=${G}`))[0].n === 5, 'la gestión existente recibió sus 5 etiquetas');
await db.exec(`INSERT INTO gestiones(nombre) VALUES ('2027-2028')`);
ok((await q(`SELECT count(*)::int n FROM etiquetas e JOIN gestiones g ON g.id=e.gestion_id WHERE g.nombre='2027-2028'`))[0].n === 5, 'una gestión nueva recibe sus etiquetas');
const ET = (await q(`SELECT id FROM etiquetas WHERE gestion_id=${G} AND nombre='Jornada'`))[0].id;
const ETA = (await q(`SELECT id FROM etiquetas WHERE gestion_id=${GA} LIMIT 1`))[0].id;

console.log('\n[etiquetas: quién escribe]');
await as(ADMIN);
await allowed(`INSERT INTO etiquetas(gestion_id,nombre,tono) VALUES (${G},'Evento especial','violeta')`, 'admin crea una etiqueta');
await rejects(`INSERT INTO etiquetas(gestion_id,nombre,tono) VALUES (${G},'Mal tono','fucsia')`, 'check|violates', 'un tono fuera de la paleta se rechaza');
await rejects(`INSERT INTO etiquetas(gestion_id,nombre,tono) VALUES (${GA},'En archivo','azul')`, 'row-level|policy', 'no se crean etiquetas en una gestión archivada');
await as(SEC1);
await rejects(`INSERT INTO etiquetas(gestion_id,nombre,tono) VALUES (${G},'De secretaría','azul')`, 'row-level|policy', 'la secretaría no crea etiquetas');
await as(M1);
ok((await q(`SELECT count(*)::int n FROM etiquetas WHERE gestion_id=${G}`))[0].n >= 5, 'cualquier persona lee las etiquetas');

console.log('\n[actividades: administración]');
await as(ADMIN);
await allowed(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio,fecha_fin,etiqueta_id) VALUES (${G},'Jornada de cierre','2026-11-02','2026-11-03',${ET})`, 'admin crea una actividad para todo el equipo');
await allowed(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio,distrito) VALUES (${G},'Taller del distrito 2','2026-11-10','08-02')`, 'admin crea una actividad de un distrito');
await rejects(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio,fecha_fin) VALUES (${G},'Al revés','2026-11-05','2026-11-01')`, 'check|violates', 'una fecha final anterior a la inicial se rechaza');
await rejects(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio) VALUES (${G},'   ','2026-11-05')`, 'check|violates', 'un título vacío se rechaza');
await rejects(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio) VALUES (${GA},'En archivo','2026-11-05')`, 'row-level|policy', 'no se escribe en una gestión archivada');
await rejects(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio,etiqueta_id) VALUES (${G},'Etiqueta ajena','2026-11-05',${ETA})`, 'etiqueta', 'la etiqueta debe ser de la misma gestión');
ok((await q(`SELECT creada_por FROM actividades WHERE titulo='Jornada de cierre'`))[0].creada_por === ADMIN, 'creada_por la fija el servidor');

console.log('\n[actividades: secretaría]');
await as(SEC1);
await allowed(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio,distrito) VALUES (${G},'Reunión del distrito 1','2026-11-12','08-01')`, 'la secretaría crea una actividad de su distrito');
await rejects(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio,distrito) VALUES (${G},'En otro distrito','2026-11-12','08-02')`, 'policy|distrito|42501', 'no crea actividades de otro distrito');
await rejects(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio) VALUES (${G},'Para todos','2026-11-12')`, 'policy|distrito|42501', 'no crea actividades para todo el equipo');
const mia = (await q(`SELECT id FROM actividades WHERE titulo='Reunión del distrito 1'`))[0].id;
await allowed(`UPDATE actividades SET titulo='Reunión del distrito 1 (nueva hora)' WHERE id=${mia}`, 'edita la suya');
await db.exec(`UPDATE actividades SET titulo='Intento' WHERE titulo='Jornada de cierre'`);
await root();
ok((await q(`SELECT titulo FROM actividades WHERE titulo='Jornada de cierre'`)).length === 1, 'no puede editar la de todo el equipo (no la ve para escribir)');
await as(SEC1);
await db.exec(`UPDATE actividades SET titulo='Intento' WHERE titulo='Taller del distrito 2'`);
await root();
ok((await q(`SELECT titulo FROM actividades WHERE titulo='Taller del distrito 2'`)).length === 1, 'no puede editar la de otro distrito');
await as(SEC1);
await allowed(`DELETE FROM actividades WHERE id=${mia}`, 'borra la suya');

console.log('\n[actividades: lectura]');
await as(M1);
const vistas = (await q(`SELECT titulo FROM actividades ORDER BY titulo`)).map(r => r.titulo);
ok(vistas.includes('Jornada de cierre'), 'un miembro ve las de todo el equipo');
ok(!vistas.includes('Taller del distrito 2'), 'un miembro NO ve las de otro distrito');
await as(M3);
ok((await q(`SELECT titulo FROM actividades`)).map(r => r.titulo).includes('Taller del distrito 2'), 'un miembro ve las de su distrito');
await rejects(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio) VALUES (${G},'Mía','2026-11-12')`, 'row-level|policy|Solo la administración', 'un miembro no crea actividades');
await as(null, 'anon');
try { const r = await q(`SELECT * FROM actividades`); ok(r.length === 0, 'sin sesión no se lee nada'); } catch (e) { ok(true, 'sin sesión no se lee nada (' + e.message.slice(0, 40) + ')'); }
await root();

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
