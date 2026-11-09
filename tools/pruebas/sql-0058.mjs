// Pruebas de 0058 (banco de imágenes: enlaces con título y descripción) contra Postgres real (PGlite), con RLS.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const DIR = fileURLToPath(new URL('.', import.meta.url));
const R = DIR + '../../supabase/migrations/';
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };
const q = async s => (await db.query(s)).rows;
const as = async (uid, role = 'authenticated') => { await db.exec('RESET ROLE'); await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid ?? ''}',false)`); await db.exec(`SET ROLE ${role}`); };
const root = async () => { await db.exec('RESET ROLE'); await db.exec(`SELECT set_config('request.jwt.claim.sub','',false)`); };
async function rejects(sql, patron, msg) { try { await db.exec(sql); ok(false, msg + ' (NO fue rechazado)'); } catch (e) { ok(!patron || new RegExp(patron, 'i').test(e.message), msg + ' → ' + e.message.slice(0, 80)); } }
async function allowed(sql, msg) { try { await db.exec(sql); ok(true, msg); } catch (e) { ok(false, msg + ' → ' + e.message.slice(0, 140)); } }
const uid = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const ADMIN = uid(90), M1 = uid(1), M2 = uid(2), PEND = uid(3);

await db.exec(fs.readFileSync(DIR + 'stub.sql', 'utf8'));
await db.exec(`
  ALTER TABLE public.profiles ADD COLUMN aprobado BOOLEAN DEFAULT true;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
  INSERT INTO gestiones(nombre, activa) VALUES ('2026-2027', true);
  INSERT INTO gestiones(nombre, activa, archivada) VALUES ('2025-2026', false, true);
  INSERT INTO roles(nombre) VALUES ('Fotografía'), ('Redacción');
  INSERT INTO profiles(id,nombre,es_admin) VALUES ('${ADMIN}','Admin',true);
  INSERT INTO profiles(id,nombre,rol_id,distrito) VALUES ('${M1}','Ana',(SELECT id FROM roles WHERE nombre='Fotografía'),'08-01'),('${M2}','Beto',(SELECT id FROM roles WHERE nombre='Redacción'),'08-02');
  INSERT INTO profiles(id,nombre,aprobado) VALUES ('${PEND}','Pendiente',false);
`);
const m = fs.readFileSync(R + '0058_banco_imagenes.sql', 'utf8');
await db.exec(m); await db.exec(m);
console.log('— 0058 aplicada sin errores (dos veces: es idempotente)');
const G = (await q(`SELECT id FROM gestiones WHERE activa`))[0].id;
const ROL1 = (await q(`SELECT id FROM roles WHERE nombre='Fotografía'`))[0].id;
const GA = (await q(`SELECT id FROM gestiones WHERE archivada`))[0].id;

console.log('\n[añadir: el servidor fija autor, gestión, rol y distrito]');
await as(M1);
await allowed(`INSERT INTO banco_imagenes(titulo, descripcion, enlace, evento, creado_por, rol_id, distrito) VALUES ('Jornada de cierre','Fotos del escenario','https://drive.google.com/drive/folders/abc','Jornada',  '${M2}', 999, '08-02')`, 'una persona aprobada añade un enlace');
const f = (await q(`SELECT * FROM banco_imagenes`))[0];
ok(f.creado_por === M1 && f.rol_id === ROL1 && f.distrito === '08-01' && String(f.gestion_id) === String(G), 'aunque mande otro autor/rol/distrito, queda con los suyos y la gestión activa');
await rejects(`INSERT INTO banco_imagenes(titulo, enlace) VALUES ('Sin enlace válido','ftp://x.cl/a')`, 'check|violates', 'el enlace debe ser http(s)');
await rejects(`INSERT INTO banco_imagenes(titulo, enlace) VALUES ('Con espacios','https://x.cl/a b')`, 'check|violates', 'el enlace no admite espacios');
await rejects(`INSERT INTO banco_imagenes(titulo, enlace) VALUES ('ab','https://x.cl/a')`, 'check|violates', 'el título tiene al menos 3 caracteres');
await rejects(`INSERT INTO banco_imagenes(titulo, enlace, gestion_id) VALUES ('Archivada','https://x.cl/a',${GA})`, 'row-level|policy', 'no se escribe en una gestión archivada');

console.log('\n[leer: toda persona aprobada ve todo; la pendiente y anon, nada]');
await as(M2);
ok((await q(`SELECT count(*)::int n FROM banco_imagenes`))[0].n === 1, 'otra persona aprobada ve el enlace de Ana');
await as(PEND);
ok((await q(`SELECT count(*)::int n FROM banco_imagenes`))[0].n === 0, 'una cuenta pendiente de aprobación no ve nada');
await rejects(`INSERT INTO banco_imagenes(titulo, enlace) VALUES ('Pendiente','https://x.cl/a')`, 'row-level|policy', 'ni escribe');
await as(null, 'anon');
await rejects(`SELECT * FROM banco_imagenes`, 'permission', 'sin sesión no se lee');

console.log('\n[editar y borrar: quien lo subió o la administración]');
await as(M2);
await db.exec(`UPDATE banco_imagenes SET titulo='Intento ajeno'`);
ok((await q(`SELECT count(*)::int n FROM banco_imagenes WHERE titulo='Intento ajeno'`))[0].n === 0, 'otra persona no puede editar el enlace de Ana');
await db.exec(`DELETE FROM banco_imagenes`);
ok((await q(`SELECT count(*)::int n FROM banco_imagenes`))[0].n === 1, 'ni borrarlo');
await as(M1);
await db.exec(`UPDATE banco_imagenes SET titulo='Jornada de cierre 2026', creado_por='${M2}', rol_id=${ROL1 + 1}`);
const g = (await q(`SELECT titulo, creado_por, rol_id FROM banco_imagenes`))[0];
ok(g.titulo === 'Jornada de cierre 2026' && g.creado_por === M1 && g.rol_id === ROL1, 'la autora edita el título y no puede reasignar autoría ni rol');
await as(ADMIN);
await db.exec(`UPDATE banco_imagenes SET descripcion='Corregida por administración'`);
ok((await q(`SELECT descripcion FROM banco_imagenes`))[0].descripcion === 'Corregida por administración', 'la administración corrige cualquier enlace');
await db.exec(`DELETE FROM banco_imagenes`);
ok((await q(`SELECT count(*)::int n FROM banco_imagenes`))[0].n === 0, 'y lo borra');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
