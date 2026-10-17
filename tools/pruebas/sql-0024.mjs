// Pruebas de 0024 (actividades: alcance equipo / distrito / selección, destinatarias, guardar_actividad, avisos)
// contra Postgres real (PGlite), con RLS. Las funciones de avisos se toman del propio 0019.
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
  catch (e) { ok(!patron || new RegExp(patron, 'i').test(e.message), msg + ' → ' + String(e.message).slice(0, 100)); }
}
async function allowed(sql, msg) {
  try { await db.exec(sql); ok(true, msg); } catch (e) { ok(false, msg + ' → ' + String(e.message).slice(0, 160)); }
}
const uid = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const ADMIN = uid(90), SEC1 = uid(91), SEC2 = uid(92), M1 = uid(1), M2 = uid(2), M3 = uid(3), M4 = uid(4);
const arr = ids => `ARRAY[${ids.map(i => `'${i}'`).join(',')}]::uuid[]`;

// Una función de 0019 por nombre (desde su CREATE hasta el `$$;` de cierre).
const m19 = fs.readFileSync(R + '0019_notificaciones.sql', 'utf8');
const fn19 = nombre => {
  const ini = m19.indexOf(`CREATE OR REPLACE FUNCTION public.${nombre}(`);
  if (ini < 0) throw new Error('no está en 0019: ' + nombre);
  const a = m19.indexOf('$$', ini), b = m19.indexOf('$$', a + 2);
  return m19.slice(ini, m19.indexOf(';', b) + 1);
};

// ── Esquema base ──
await db.exec(fs.readFileSync(DIR + 'stub.sql', 'utf8'));
await db.exec(`
  ALTER TABLE public.profiles ADD COLUMN aprobado BOOLEAN DEFAULT true;
  ALTER TABLE public.periodos_evaluacion ADD COLUMN fecha_entrega DATE;
  CREATE TABLE public.config (gestion_id BIGINT, clave TEXT, valor TEXT, PRIMARY KEY (gestion_id, clave));
  CREATE TABLE public.periodo_participantes (periodo_id UUID, user_id UUID, activo BOOLEAN DEFAULT true, PRIMARY KEY (periodo_id, user_id));
  CREATE TABLE public.trabajos_entregados (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id UUID, periodo_id UUID,
     titulo TEXT DEFAULT '', descripcion TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
  INSERT INTO gestiones(nombre, activa) VALUES ('2026-2027', true);
  INSERT INTO gestiones(nombre, activa, archivada) VALUES ('2025-2026', false, true);
  INSERT INTO profiles(id,nombre,email,es_admin) VALUES ('${ADMIN}','Admin','admin@x.cl',true);
  INSERT INTO profiles(id,nombre,email,tipo_miembro,distrito) VALUES ('${SEC1}','Sec1','s1@x.cl','secretario','08-01'),('${SEC2}','Sec2','s2@x.cl','secretario','08-02');
  INSERT INTO profiles(id,nombre,email,distrito) VALUES ('${M1}','M1','m1@x.cl','08-01'),('${M2}','M2','m2@x.cl','08-01'),('${M3}','M3','m3@x.cl','08-02'),('${M4}','M4','m4@x.cl','08-02');
`);
await db.exec(fs.readFileSync(R + '0015_rubrica_v2.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0016_tareas.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0018_actividades.sql', 'utf8'));
const G = (await q(`SELECT id FROM gestiones WHERE activa`))[0].id;
const GA = (await q(`SELECT id FROM gestiones WHERE archivada`))[0].id;
const ET = (await q(`SELECT id FROM etiquetas WHERE gestion_id=${G} AND nombre='Jornada'`))[0].id;

// Datos «de antes» de 0024: uno de todo el equipo y uno de distrito (con el trigger de 0018, sin alcance).
await as(ADMIN);
await db.exec(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio) VALUES (${G},'Vieja del equipo','2026-11-02')`);
await db.exec(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio,distrito) VALUES (${G},'Vieja del distrito 2','2026-11-03','08-02')`);
await root();

// Avisos de 0019, tal como están en producción (la tabla y las funciones, sin pg_cron/pg_net).
const tabla = m19.match(/CREATE TABLE IF NOT EXISTS public\.notificaciones \([\s\S]*?\n\);/)[0];
await db.exec(tabla + `
  ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.notificaciones FROM anon, authenticated;`);
for (const f of ['notif_fecha', 'notif_zona', 'notif_encolar', 'notif_audiencia', 'notif_trg_actividad', 'notif_generar_recordatorios']) await db.exec(fn19(f));
await db.exec(`CREATE TRIGGER notif_actividad AFTER INSERT ON public.actividades FOR EACH ROW EXECUTE FUNCTION public.notif_trg_actividad()`);

await db.exec(fs.readFileSync(R + '0024_actividades_alcance.sql', 'utf8'));
await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
               GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;`);
await db.exec(fs.readFileSync(R + '0024_actividades_alcance.sql', 'utf8'));
await db.exec(`REVOKE EXECUTE ON FUNCTION public.notif_audiencia_actividad(BIGINT, UUID), public.actividades_fijar(), public.notif_encolar(UUID,TEXT,JSONB,TEXT,TIMESTAMPTZ),
               public.notif_audiencia(TEXT, UUID), public.notif_generar_recordatorios(), public.notif_trg_actividad() FROM PUBLIC, anon, authenticated;
               REVOKE ALL ON public.actividad_destinatarios FROM anon;
               REVOKE INSERT, UPDATE, DELETE ON public.actividad_destinatarios FROM authenticated;`);
console.log('— 0024 aplicada sin errores (dos veces: es idempotente)');

console.log('\n[nada se pierde]');
await root();
const al = async t => (await q(`SELECT alcance, distrito FROM actividades WHERE titulo='${t}'`))[0];
ok((await al('Vieja del equipo')).alcance === 'equipo', 'la actividad de todo el equipo sigue siendo «equipo»');
ok((await al('Vieja del distrito 2')).alcance === 'distrito' && (await al('Vieja del distrito 2')).distrito === '08-02', 'la de un distrito pasa a «distrito», con su distrito');
const noti0 = (await q(`SELECT count(*)::int n FROM notificaciones`))[0].n;

console.log('\n[un cliente anterior a 0024 sigue funcionando]');
await as(ADMIN);
await allowed(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio,distrito) VALUES (${G},'Insert viejo con distrito','2026-11-04','08-01')`, 'insertar con `distrito` y sin alcance es válido');
await root();
ok((await al('Insert viejo con distrito')).alcance === 'distrito', 'y queda como «distrito»');
await as(SEC1);
await allowed(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio,distrito) VALUES (${G},'Sec insert viejo','2026-11-04','08-01')`, 'la secretaría insertando su distrito a la antigua, también');
await rejects(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio) VALUES (${G},'Sec para todos','2026-11-04')`, 'administración|42501', 'y sigue sin poder crear para todo el equipo');

console.log('\n[guardar_actividad: administración]');
await as(ADMIN);
const idSel = (await q(`SELECT guardar_actividad(NULL,${G},'Taller de fotografía','Trae tu cámara',${ET},'2026-12-01','2026-12-02','seleccion',NULL,${arr([M1, M3])}) id`))[0].id;
ok(idSel > 0, 'admin crea una actividad para personas elegidas (de dos distritos distintos)');
ok((await q(`SELECT count(*)::int n FROM actividad_destinatarios WHERE actividad_id=${idSel}`))[0].n === 2, 'queda con 2 destinatarias');
await rejects(`SELECT guardar_actividad(NULL,${G},'Sin gente',NULL,NULL,'2026-12-01',NULL,'seleccion',NULL,'{}'::uuid[])`, 'al menos una', 'una «seleccion» sin personas se rechaza');
await rejects(`SELECT guardar_actividad(NULL,${G},'Fantasma',NULL,NULL,'2026-12-01',NULL,'seleccion',NULL,${arr(['00000000-0000-0000-0000-00000000ffff'])})`, 'no existe|aprobado', 'una persona inexistente se rechaza');
await rejects(`SELECT guardar_actividad(NULL,${GA},'En archivo',NULL,NULL,'2025-12-01',NULL,'equipo',NULL,NULL)`, 'archivada', 'no se crea en una gestión archivada');
await rejects(`SELECT guardar_actividad(NULL,${G},'Fechas al revés',NULL,NULL,'2026-12-05','2026-12-01','equipo',NULL,NULL)`, 'check|violates', 'una fecha final anterior a la inicial se rechaza');
await rejects(`SELECT guardar_actividad(NULL,${G},'Mal alcance',NULL,NULL,'2026-12-05',NULL,'galaxia',NULL,NULL)`, 'alcance', 'un alcance desconocido se rechaza');
const idEq = (await q(`SELECT guardar_actividad(NULL,${G},'Reunión general',NULL,NULL,'2026-12-10',NULL,'equipo',NULL,NULL) id`))[0].id;
const idDi = (await q(`SELECT guardar_actividad(NULL,${G},'Taller del distrito 1',NULL,NULL,'2026-12-11',NULL,'distrito','08-01',NULL) id`))[0].id;
await rejects(`SELECT guardar_actividad(NULL,${G},'Distrito sin distrito',NULL,NULL,'2026-12-11',NULL,'distrito',NULL,NULL)`, 'necesita el distrito', 'alcance «distrito» exige el distrito');

console.log('\n[visibilidad: quién ve qué]');
const titulos = async u => { await as(u); return (await q(`SELECT titulo FROM actividades ORDER BY titulo`)).map(x => x.titulo); };
let v = await titulos(M1);
ok(v.includes('Taller de fotografía') && v.includes('Reunión general') && v.includes('Taller del distrito 1'), 'M1 (destinataria, distrito 1) ve la selección, la del equipo y la de su distrito');
ok(!v.includes('Vieja del distrito 2'), 'M1 no ve lo del distrito 2');
v = await titulos(M2);
ok(!v.includes('Taller de fotografía'), 'M2 (mismo distrito, NO destinataria) no ve la actividad por selección');
ok(v.includes('Taller del distrito 1') && v.includes('Reunión general'), 'pero sí la de su distrito y la de todos');
v = await titulos(M3);
ok(v.includes('Taller de fotografía') && !v.includes('Taller del distrito 1'), 'M3 (destinataria de otro distrito) ve la selección y no lo del distrito 1');
v = await titulos(M4);
ok(!v.includes('Taller de fotografía') && v.includes('Vieja del distrito 2'), 'M4 no ve la selección y sí lo de su distrito');
v = await titulos(SEC2);
ok(v.includes('Taller de fotografía'), 'la secretaría del distrito 2 ve la selección porque M3 (su distrito) es destinataria');
v = await titulos(ADMIN);
ok(v.includes('Taller de fotografía') && v.length >= 7, 'admin ve todo');
await as(null, 'anon');
ok((await q(`SELECT * FROM actividades`)).length === 0, 'anon no ve ninguna actividad');
await rejects(`SELECT * FROM actividad_destinatarios`, 'permission', 'ni destinatarias');

console.log('\n[destinatarias: quién las lee]');
await as(M1);
ok((await q(`SELECT count(*)::int n FROM actividad_destinatarios`))[0].n === 1, 'M1 solo ve que ella es destinataria');
await as(M2);
ok((await q(`SELECT count(*)::int n FROM actividad_destinatarios`))[0].n === 0, 'M2 no ve ninguna');
await as(SEC1);
ok((await q(`SELECT count(*)::int n FROM actividad_destinatarios`))[0].n === 1, 'la secretaría 1 ve a las de su distrito (M1)');
await as(M1);
await rejects(`INSERT INTO actividad_destinatarios(actividad_id,persona_id) VALUES (${idSel},'${M2}')`, 'permission', 'no se agregan destinatarias a mano');
await rejects(`DELETE FROM actividad_destinatarios WHERE persona_id='${M1}'`, 'permission', 'ni se borran a mano');

console.log('\n[guardar_actividad: secretaría]');
await as(SEC1);
const idS = (await q(`SELECT guardar_actividad(NULL,${G},'Ensayo del grupo A','',NULL,'2026-12-15',NULL,'seleccion',NULL,${arr([M1, M2])}) id`))[0].id;
ok(idS > 0, 'la secretaría crea una actividad para personas de su distrito');
await root();
ok((await q(`SELECT distrito FROM actividades WHERE id=${idS}`))[0].distrito === '08-01', 'queda anclada a su distrito (es la dueña)');
await as(SEC1);
await rejects(`SELECT guardar_actividad(NULL,${G},'Con alguien de otro distrito','',NULL,'2026-12-15',NULL,'seleccion',NULL,${arr([M1, M3])})`, 'tu distrito', 'no puede incluir a personas de otro distrito');
await rejects(`SELECT guardar_actividad(NULL,${G},'Para todos','',NULL,'2026-12-15',NULL,'equipo',NULL,NULL)`, 'todo el equipo', 'no crea para todo el equipo');
await rejects(`SELECT guardar_actividad(NULL,${G},'Del distrito 2','',NULL,'2026-12-15',NULL,'distrito','08-02',NULL)`, 'tu distrito', 'ni de otro distrito');
await allowed(`SELECT guardar_actividad(NULL,${G},'De mi distrito','',NULL,'2026-12-16',NULL,'distrito','08-01',NULL)`, 'sí de su distrito');
await rejects(`SELECT guardar_actividad(${idSel},${G},'Secuestrada','',NULL,'2026-12-01',NULL,'seleccion',NULL,${arr([M1])})`, 'no puedes editar', 'no edita la actividad de la administración');
await allowed(`SELECT guardar_actividad(${idS},${G},'Ensayo del grupo A (nuevo horario)','',NULL,'2026-12-15',NULL,'seleccion',NULL,${arr([M1])})`, 'sí edita la suya y cambia sus destinatarias');
await root();
ok((await q(`SELECT count(*)::int n FROM actividad_destinatarios WHERE actividad_id=${idS}`))[0].n === 1, 'las destinatarias se reemplazaron (quedó 1)');
await as(SEC2);
ok(!(await q(`SELECT titulo FROM actividades`)).some(x => x.titulo.startsWith('Ensayo')), 'la secretaría 2 no ve la selección del distrito 1');
await rejects(`SELECT guardar_actividad(${idS},${G},'Robada','',NULL,'2026-12-15',NULL,'seleccion',NULL,${arr([M3])})`, 'no puedes editar', 'ni la edita');
await as(M1);
await rejects(`SELECT guardar_actividad(NULL,${G},'De un miembro','',NULL,'2026-12-15',NULL,'seleccion',NULL,${arr([M1])})`, 'secretarias', 'un miembro no crea actividades');
await as(null, 'anon');
await rejects(`SELECT guardar_actividad(NULL,${G},'Anon','',NULL,'2026-12-15',NULL,'equipo',NULL,NULL)`, 'permission', 'anon no puede llamar a guardar_actividad');

console.log('\n[de selección a otro alcance]');
await as(ADMIN);
await allowed(`SELECT guardar_actividad(${idSel},${G},'Taller de fotografía','',${ET},'2026-12-01','2026-12-02','equipo',NULL,NULL)`, 'admin pasa una selección a todo el equipo');
await root();
ok((await q(`SELECT count(*)::int n FROM actividad_destinatarios WHERE actividad_id=${idSel}`))[0].n === 0, 'y las destinatarias se limpian');
ok((await titulos(M2)).includes('Taller de fotografía'), 'ahora M2 la ve');

console.log('\n[avisos: solo a quien corresponde]');
await root();
const para = async t => (await q(`SELECT n.destinatario_id FROM notificaciones n WHERE n.tipo='actividad_nueva' AND n.datos->>'actividad'='${t}'`)).map(x => x.destinatario_id).sort();
ok(JSON.stringify(await para('Ensayo del grupo A')) === JSON.stringify([M1, M2].sort()) || JSON.stringify(await para('Ensayo del grupo A')) === JSON.stringify([M1]),
   'la selección avisa solo a sus destinatarias, no a todo el equipo: ' + (await para('Ensayo del grupo A')).length + ' aviso(s)');
ok(!(await para('Ensayo del grupo A')).includes(M3) && !(await para('Ensayo del grupo A')).includes(M4), 'M3 y M4 no recibieron el aviso de una selección que no las incluye');
ok((await para('Reunión general')).length >= 6, 'una actividad de todo el equipo avisa a todo el equipo (menos a quien la crea): ' + (await para('Reunión general')).length);
ok(!(await para('Reunión general')).includes(ADMIN), 'y no a quien la creó');
ok((await para('Taller del distrito 1')).every(p => [M1, M2, SEC1].includes(p)) && (await para('Taller del distrito 1')).length === 3, 'una de distrito avisa solo a ese distrito');
const aviso = (await q(`SELECT destinatario_id FROM notificaciones WHERE tipo='actividad_nueva' AND datos->>'actividad'='Taller de fotografía'`)).map(x => x.destinatario_id);
ok(aviso.includes(M1) && aviso.includes(M3) && !aviso.includes(M2), 'la selección «Taller de fotografía» avisó a M1 y M3 (y no a M2), aunque luego pasó a equipo');

console.log('\n[recordatorio de la víspera: respeta el alcance]');
await root();
const def = (await q(`SELECT pg_get_functiondef('public.notif_generar_recordatorios()'::regprocedure) d`))[0].d;
ok(def.includes('notif_audiencia_actividad(r.id)') && !def.includes('notif_audiencia(r.distrito)'), 'la función de recordatorios quedó parcheada para usar el alcance');
await db.exec(`DELETE FROM notificaciones`);
await as(ADMIN);
const manana = (await q(`SELECT (NOW() AT TIME ZONE 'America/Santiago')::date + 1 AS d`))[0].d.toISOString().slice(0, 10);
await db.exec(`SELECT guardar_actividad(NULL,${G},'Mañana solo ellas',NULL,NULL,'${manana}',NULL,'seleccion',NULL,${arr([M3])})`);
await root();
await db.exec(`DELETE FROM notificaciones`);
await db.exec(`SELECT notif_generar_recordatorios()`);
const rec = (await q(`SELECT destinatario_id FROM notificaciones WHERE tipo='actividad_recordatorio' AND datos->>'actividad'='Mañana solo ellas'`)).map(x => x.destinatario_id);
ok(rec.length === 1 && rec[0] === M3, 'el recordatorio de una selección llega solo a su destinataria');

console.log('\n[sin 0019 todo funciona igual, solo que sin avisos]');
const db2 = new PGlite();
await db2.exec(fs.readFileSync(DIR + 'stub.sql', 'utf8'));
await db2.exec(`
  ALTER TABLE public.profiles ADD COLUMN aprobado BOOLEAN DEFAULT true;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
  INSERT INTO gestiones(nombre, activa) VALUES ('2026-2027', true);
  INSERT INTO profiles(id,nombre,es_admin) VALUES ('${ADMIN}','Admin',true);
  INSERT INTO profiles(id,nombre,distrito) VALUES ('${M1}','M1','08-01');`);
await db2.exec(fs.readFileSync(R + '0018_actividades.sql', 'utf8'));
await db2.exec(fs.readFileSync(R + '0024_actividades_alcance.sql', 'utf8'));
await db2.exec(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
  SELECT set_config('request.jwt.claim.sub','${ADMIN}',false); SET ROLE authenticated;`);
const g2 = (await db2.query(`SELECT id FROM gestiones`)).rows[0].id;
const r2 = await db2.query(`SELECT guardar_actividad(NULL,${g2},'Sin avisos',NULL,NULL,'2026-12-01',NULL,'seleccion',NULL,ARRAY['${M1}']::uuid[]) id`);
ok(r2.rows[0].id > 0, '0024 se aplica y guardar_actividad funciona aunque no exista notif_encolar (0019)');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
