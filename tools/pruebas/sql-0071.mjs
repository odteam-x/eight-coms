// Pruebas de 0071 (Recursos: tipos, partes, etiquetas, paridad con el banco de 0058) contra Postgres real (PGlite), con RLS.
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
async function rejects(sql, patron, msg) { try { await db.exec(sql); ok(false, msg + ' (NO fue rechazado)'); } catch (e) { ok(!patron || new RegExp(patron, 'i').test(e.message), msg + ' → ' + e.message.slice(0, 80)); } }
async function allowed(sql, msg) { try { await db.exec(sql); ok(true, msg); } catch (e) { ok(false, msg + ' → ' + e.message.slice(0, 140)); } }
const uid = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const ADMIN = uid(90), M1 = uid(1), M2 = uid(2), PEND = uid(3);
const LINK = `'[{"t":"enlace","e":"Carpeta","v":"https://drive.google.com/drive/folders/abc"}]'`;

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
const G = (await q(`SELECT id FROM gestiones WHERE activa`))[0].id;
const GA = (await q(`SELECT id FROM gestiones WHERE archivada`))[0].id;
const ROL1 = (await q(`SELECT id FROM roles WHERE nombre='Fotografía'`))[0].id;

console.log('[paridad: 0058 con datos reales → 0071 los copia sin pérdida]');
await db.exec(fs.readFileSync(R + '0058_banco_imagenes.sql', 'utf8'));
await db.exec(`
  ALTER TABLE banco_imagenes DISABLE TRIGGER banco_fijar;
  INSERT INTO banco_imagenes(gestion_id,titulo,descripcion,enlace,evento,rol_id,distrito,creado_por,created_at,updated_at) VALUES
   (${G},'Jornada de cierre · escenario','Fotos del escenario','https://drive.google.com/drive/folders/ej1','Jornada de cierre',${ROL1},'08-01','${M1}','2026-11-05T15:00:00Z','2026-11-06T15:00:00Z'),
   (${G},'Taller de fotografía','','https://www.dropbox.com/sh/ej2','',NULL,NULL,'${M2}','2026-11-07T15:00:00Z','2026-11-07T15:00:00Z');
  ALTER TABLE banco_imagenes ENABLE TRIGGER banco_fijar;`);
const m = fs.readFileSync(R + '0071_recursos.sql', 'utf8');
await db.exec(m); await db.exec(m);
console.log('— 0071 aplicada sin errores (dos veces: es idempotente)');
const rs = await q(`SELECT * FROM recursos ORDER BY banco_id`);
ok(rs.length === 2, 'las 2 filas del banco quedaron como recursos (y la segunda ejecución no duplicó)');
ok(rs.every(r => r.tipo === 'imagen' && r.partes.length === 1 && r.partes[0].t === 'enlace'), 'todas son de tipo imagen con su enlace como única parte');
const b = (await q(`SELECT * FROM banco_imagenes ORDER BY id`));
ok(rs.every((r, i) => r.titulo === b[i].titulo && r.descripcion === b[i].descripcion && r.partes[0].v === b[i].enlace && r.evento === b[i].evento && r.rol_id === b[i].rol_id && r.distrito === b[i].distrito && r.creado_por === b[i].creado_por && String(r.gestion_id) === String(b[i].gestion_id)), 'título, descripción, enlace, evento, rol, distrito, autor y gestión idénticos');
ok(rs.every((r, i) => +new Date(r.created_at) === +new Date(b[i].created_at) && +new Date(r.updated_at) === +new Date(b[i].updated_at)), 'conservan sus fechas originales');
await db.exec(`ALTER TABLE banco_imagenes DISABLE TRIGGER banco_fijar; INSERT INTO banco_imagenes(gestion_id,titulo,enlace,creado_por) VALUES (${G},'Llegó tarde','https://x.cl/tarde','${M1}'); ALTER TABLE banco_imagenes ENABLE TRIGGER banco_fijar;`);
await db.exec(m);
ok((await q(`SELECT count(*)::int n FROM recursos`))[0].n === 3, 'volver a ejecutar copia solo lo que faltaba (3 en total)');
ok((await q(`SELECT count(*)::int n FROM banco_imagenes`))[0].n === 3, 'banco_imagenes queda intacta (es la reversa)');
await db.exec(`DELETE FROM recursos WHERE banco_id IS NOT NULL`);

console.log('\n[añadir: el servidor fija autor, gestión, rol y distrito; tipos y partes validados]');
await as(M1);
await allowed(`INSERT INTO recursos(titulo, tipo, evento, partes, creado_por, rol_id, distrito, banco_id) VALUES ('Identidad gráfica · Jornada','identidad','Jornada',
  '[{"t":"enlace","e":"Logos","v":"https://drive.google.com/x"},{"t":"color","e":"Azul","v":"#1A4FA0"},{"t":"fuente","e":"Títulos","v":"Montserrat Bold"}]','${M2}', 999, '08-02', 12345)`, 'una persona aprobada añade una identidad gráfica (enlace + color + tipografía)');
const f = (await q(`SELECT * FROM recursos`))[0];
ok(f.creado_por === M1 && f.rol_id === ROL1 && f.distrito === '08-01' && String(f.gestion_id) === String(G) && f.banco_id === null, 'aunque mande otro autor/rol/distrito/origen, queda con los suyos, la gestión activa y sin origen');
for (const t of ['imagen', 'video', 'enlace', 'identidad', 'documento', 'plantilla', 'audio', 'otro']) await allowed(`INSERT INTO recursos(titulo, tipo, partes) VALUES ('Tipo ${t}','${t}',${LINK})`, `tipo «${t}» admitido`);
await rejects(`INSERT INTO recursos(titulo, tipo, partes) VALUES ('Tipo raro','archivo',${LINK})`, 'check|violates', 'un tipo fuera de la lista se rechaza');
await rejects(`INSERT INTO recursos(titulo, partes) VALUES ('ab',${LINK})`, 'check|violates', 'el título tiene al menos 3 caracteres');
await rejects(`INSERT INTO recursos(titulo, partes) VALUES ('Sin partes','[]')`, 'check|violates', 'necesita al menos una parte');
await rejects(`INSERT INTO recursos(titulo, partes) VALUES ('Parte no lista','{"t":"enlace"}')`, 'check|violates', 'las partes deben ser una lista');
await rejects(`INSERT INTO recursos(titulo, partes) VALUES ('Enlace ftp','[{"t":"enlace","v":"ftp://x.cl/a"}]')`, 'check|violates', 'el enlace debe ser http(s)');
await rejects(`INSERT INTO recursos(titulo, partes) VALUES ('Enlace espacios','[{"t":"enlace","v":"https://x.cl/a b"}]')`, 'check|violates', 'el enlace no admite espacios');
await rejects(`INSERT INTO recursos(titulo, partes) VALUES ('Color malo','[{"t":"color","v":"azul"}]')`, 'check|violates', 'el color debe ser #RRGGBB');
await rejects(`INSERT INTO recursos(titulo, partes) VALUES ('Color corto','[{"t":"color","v":"#FFF"}]')`, 'check|violates', 'el color de 3 cifras se rechaza (se normaliza en el cliente)');
await rejects(`INSERT INTO recursos(titulo, partes) VALUES ('Fuente vacia','[{"t":"fuente","v":"  "}]')`, 'check|violates', 'la tipografía no puede ir vacía');
await rejects(`INSERT INTO recursos(titulo, partes) VALUES ('Parte rara','[{"t":"script","v":"x"}]')`, 'check|violates', 'una clase de parte desconocida se rechaza');
await rejects(`INSERT INTO recursos(titulo, partes) VALUES ('Valor numero','[{"t":"color","v":123}]')`, 'check|violates', 'el valor debe ser texto');
await rejects(`INSERT INTO recursos(titulo, partes) SELECT 'Demasiadas', jsonb_agg(jsonb_build_object('t','color','v','#112233')) FROM generate_series(1,21)`, 'check|violates', 'más de 20 partes se rechazan');
await rejects(`INSERT INTO recursos(titulo, partes, etiquetas) VALUES ('Muchas etiquetas',${LINK},ARRAY['a','b','c','d','e','f','g','h','i'])`, 'check|violates', 'más de 8 etiquetas se rechazan');
await rejects(`INSERT INTO recursos(titulo, partes, categoria) VALUES ('Categoria larga',${LINK},repeat('x',61))`, 'check|violates', 'categoría de más de 60 caracteres se rechaza');
await rejects(`INSERT INTO recursos(titulo, partes, gestion_id) VALUES ('Archivada',${LINK},${GA})`, 'row-level|policy', 'no se escribe en una gestión archivada');
await db.exec(`INSERT INTO recursos(titulo, partes, etiquetas) VALUES ('Etiquetas limpias',${LINK},ARRAY['  Logo ','logo','','Paleta', repeat('z',50)])`);
const et = (await q(`SELECT etiquetas FROM recursos WHERE titulo='Etiquetas limpias'`))[0].etiquetas;
ok(et.length === 3 && et[0] === 'Logo' && et[1] === 'Paleta' && et[2].length === 30, 'las etiquetas se limpian: sin vacías ni repetidas, de 30 como máximo → ' + JSON.stringify(et));

console.log('\n[leer: toda persona aprobada ve todo; la pendiente y anon, nada]');
await as(M2);
ok((await q(`SELECT count(*)::int n FROM recursos`))[0].n >= 9, 'otra persona aprobada ve los recursos de Ana');
await as(PEND);
ok((await q(`SELECT count(*)::int n FROM recursos`))[0].n === 0, 'una cuenta pendiente de aprobación no ve nada');
await rejects(`INSERT INTO recursos(titulo, partes) VALUES ('Pendiente',${LINK})`, 'row-level|policy', 'ni escribe');
await as(null, 'anon');
await rejects(`SELECT * FROM recursos`, 'permission', 'sin sesión no se lee');

console.log('\n[editar y borrar: quien lo subió o la administración]');
await as(M2);
const antes = (await q(`SELECT count(*)::int n FROM recursos`))[0].n;
await db.exec(`UPDATE recursos SET titulo='Intento ajeno'`);
ok((await q(`SELECT count(*)::int n FROM recursos WHERE titulo='Intento ajeno'`))[0].n === 0, 'otra persona no puede editar el recurso de Ana');
await db.exec(`DELETE FROM recursos`);
ok((await q(`SELECT count(*)::int n FROM recursos`))[0].n === antes, 'ni borrarlo');
await as(M1);
await db.exec(`UPDATE recursos SET titulo='Identidad gráfica 2026', tipo='identidad', creado_por='${M2}', rol_id=${ROL1 + 1}, banco_id=7 WHERE titulo='Identidad gráfica · Jornada'`);
const g = (await q(`SELECT titulo, creado_por, rol_id, banco_id, updated_at >= created_at AS tocado FROM recursos WHERE titulo LIKE 'Identidad gráfica 2026'`))[0];
ok(g && g.creado_por === M1 && g.rol_id === ROL1 && g.banco_id === null && g.tocado, 'la autora edita y no puede reasignar autoría, rol ni origen');
await rejects(`UPDATE recursos SET partes='[]' WHERE creado_por='${M1}'`, 'check|violates', 'al editar también se validan las partes');
await as(ADMIN);
await db.exec(`UPDATE recursos SET descripcion='Corregida por administración' WHERE titulo='Identidad gráfica 2026'`);
ok((await q(`SELECT descripcion FROM recursos WHERE titulo='Identidad gráfica 2026'`))[0].descripcion === 'Corregida por administración', 'la administración corrige cualquier recurso');
await db.exec(`DELETE FROM recursos`);
ok((await q(`SELECT count(*)::int n FROM recursos`))[0].n === 0, 'y los borra');

console.log('\n[sin 0058: la migración sigue aplicándose]');
const db2 = new PGlite();
await db2.exec(fs.readFileSync(DIR + 'stub.sql', 'utf8'));
await db2.exec(`ALTER TABLE public.profiles ADD COLUMN aprobado BOOLEAN DEFAULT true; INSERT INTO gestiones(nombre, activa) VALUES ('2026-2027', true);`);
try { await db2.exec(m); ok(true, '0071 se aplica aunque banco_imagenes no exista'); } catch (e) { ok(false, '0071 sin 0058 → ' + e.message.slice(0, 120)); }

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
