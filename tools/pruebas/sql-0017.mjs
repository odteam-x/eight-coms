import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

import { fileURLToPath } from 'node:url';
const DIR = fileURLToPath(new URL('.', import.meta.url));
const R = DIR + '../../supabase/migrations/';
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };

const q = async (s) => (await db.query(s)).rows;
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
const ADMIN = uid(90), SEC1 = uid(91), SEC2 = uid(92), M1 = uid(1), M2 = uid(2), M3 = uid(3);

// ── esquema base (stub + 0015) ──
await db.exec(fs.readFileSync(DIR + 'stub.sql', 'utf8'));
await db.exec(`
  CREATE TABLE public.config (gestion_id BIGINT, clave TEXT, valor TEXT, PRIMARY KEY (gestion_id, clave));
  CREATE TABLE public.periodo_participantes (periodo_id UUID, user_id UUID, activo BOOLEAN DEFAULT true, PRIMARY KEY (periodo_id, user_id));
  CREATE TABLE public.trabajos_entregados (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id UUID, periodo_id UUID,
     titulo TEXT DEFAULT '', descripcion TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
`);
await db.exec(`
  INSERT INTO gestiones(nombre, activa) VALUES ('2026-2027', true);
  INSERT INTO gestiones(nombre, activa, archivada) VALUES ('2025-2026', false, true);
  INSERT INTO profiles(id,nombre,es_admin) VALUES ('${ADMIN}','Admin',true);
  INSERT INTO profiles(id,nombre,tipo_miembro,distrito) VALUES ('${SEC1}','Sec1','secretario','08-01'),('${SEC2}','Sec2','secretario','08-02');
  INSERT INTO profiles(id,nombre,distrito) VALUES ('${M1}','M1','08-01'),('${M2}','M2','08-01'),('${M3}','M3','08-02');
`);
// Un período que ya existía antes de 0015 (queda legacy y bloqueado): sus trabajos viejos no se tocan.
await db.exec(`INSERT INTO periodos_evaluacion(gestion_id,nombre) SELECT id,'LEG' FROM gestiones WHERE activa`);
await db.exec(fs.readFileSync(R + '0015_rubrica_v2.sql', 'utf8'));
// Períodos nuevos: pueden usar v2.
await db.exec(`INSERT INTO periodos_evaluacion(gestion_id,nombre,modelo) SELECT id,'PE1','v2' FROM gestiones WHERE activa`);
await db.exec(`INSERT INTO periodos_evaluacion(gestion_id,nombre,modelo) SELECT id,'OLD','v2' FROM gestiones WHERE archivada`);
const PE  = (await q(`SELECT id FROM periodos_evaluacion WHERE nombre='PE1'`))[0].id;
const OLD = (await q(`SELECT id FROM periodos_evaluacion WHERE nombre='OLD'`))[0].id;
const LEG = (await q(`SELECT id FROM periodos_evaluacion WHERE nombre='LEG'`))[0].id;
await db.exec(`INSERT INTO trabajos_entregados(user_id,periodo_id,titulo,descripcion) VALUES
  ('${M1}','${LEG}','Video agosto','Edité el video'),('${M2}','${LEG}','','Sin título')`);
await db.exec(fs.readFileSync(R + '0016_tareas.sql', 'utf8'));

await db.exec(fs.readFileSync(R + '0017_tareas_puntos.sql', 'utf8'));
console.log('— 0017 aplicada sin errores');
await db.exec(fs.readFileSync(R + '0017_tareas_puntos.sql', 'utf8'));
ok(true, 'reaplicar 0017 es idempotente');

const ins = async (quien, para) => {
  await as(quien);
  return (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,fecha_limite) VALUES ('${PE}','T','${para}', current_date+5) RETURNING id`))[0].id;
};
const entregar = async (id, m) => {
  await as(m);
  await db.exec(`UPDATE tareas SET estado='en_curso' WHERE id=${id}`);
  await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='listo' WHERE id=${id}`);
};

console.log('\n[puntos por tarea]');
let t = await ins(ADMIN, M1);
ok((await q(`SELECT puntos FROM tareas WHERE id=${t}`))[0].puntos === null, 'una tarea nueva nace sin puntos');
await as(ADMIN);
await allowed(`INSERT INTO tareas(periodo_id,titulo,asignada_a,puntos) VALUES ('${PE}','X','${M1}',9)`, 'insertar con puntos: se ignoran');
ok((await q(`SELECT max(puntos) m FROM tareas`))[0].m === null, 'el cliente no puede nacer una tarea puntuada');

await entregar(t, M1);
await as(SEC1);
await rejects(`UPDATE tareas SET estado='aprobada' WHERE id=${t}`, 'puntos', 'aprobar SIN puntos se rechaza');
await rejects(`UPDATE tareas SET estado='aprobada', puntos=11 WHERE id=${t}`, 'check|violates', 'puntos fuera de 0–10 rechazados');
await rejects(`UPDATE tareas SET puntos=5 WHERE id=${t}`, 'se asignan al aprobar', 'no se puntúa una tarea sin aprobar');
await allowed(`UPDATE tareas SET estado='aprobada', puntos=8 WHERE id=${t}`, 'el secretario aprueba con 8 puntos');
ok((await q(`SELECT puntos FROM tareas WHERE id=${t}`))[0].puntos === 8, 'los puntos quedan guardados');

console.log('\n[tras aprobar]');
await as(SEC1);
await rejects(`UPDATE tareas SET puntos=3 WHERE id=${t}`, 'aprobada|administrador', 'el secretario no corrige puntos de una aprobada');
await as(M1);
await rejects(`UPDATE tareas SET puntos=10 WHERE id=${t}`, null, 'el miembro no se sube los puntos');
await as(ADMIN);
await allowed(`UPDATE tareas SET puntos=6 WHERE id=${t}`, 'el admin corrige los puntos');
await rejects(`UPDATE tareas SET puntos=NULL WHERE id=${t}`, 'necesita sus puntos', 'el admin no la deja aprobada sin puntos');
await allowed(`UPDATE tareas SET estado='entregada' WHERE id=${t}`, 'el admin la reabre');
ok((await q(`SELECT puntos FROM tareas WHERE id=${t}`))[0].puntos === null, 'reabrir borra los puntos');
await rejects(`UPDATE tareas SET estado='aprobada' WHERE id=${t}`, 'puntos', 'volver a aprobar exige puntuar otra vez');
await allowed(`UPDATE tareas SET estado='aprobada', puntos=10 WHERE id=${t}`, 'se vuelve a aprobar con 10');

console.log('\n[quién puede aprobar sigue igual]');
const t2 = await ins(SEC1, M1);
await entregar(t2, M1);
await as(M1);
await rejects(`UPDATE tareas SET estado='aprobada', puntos=10 WHERE id=${t2}`, 'no permitida', 'el miembro NO aprueba aunque ponga puntos');
await as(SEC2);
ok((await q(`SELECT count(*)::int n FROM tareas WHERE id=${t2}`))[0].n === 0, 'otro distrito ni la ve');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
