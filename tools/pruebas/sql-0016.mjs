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
console.log('— 0016 aplicada sin errores');

console.log('\n[solo períodos nuevos: lo anterior no se toca]');
let r = await q(`SELECT count(*)::int n FROM tareas`);
ok(r[0].n === 0, 'la migración NO copia trabajos_entregados a tareas');
r = await q(`SELECT count(*)::int n FROM trabajos_entregados`);
ok(r[0].n === 2, 'trabajos_entregados queda intacta para los períodos anteriores');
await db.exec(fs.readFileSync(R + '0016_tareas.sql', 'utf8'));
ok((await q(`SELECT count(*)::int n FROM tareas`))[0].n === 0, 'reaplicar la migración es idempotente');
await as(ADMIN);
await rejects(`INSERT INTO tareas(periodo_id,titulo,asignada_a) VALUES ('${LEG}','En un período anterior','${M1}')`, 'rubrica por roles', 'NO se crean tareas en un período anterior (legacy)');
await as(M1);
await rejects(`INSERT INTO tareas(periodo_id,titulo,asignada_a) VALUES ('${LEG}','Mi iniciativa antigua','${M1}')`, 'rubrica por roles', 'ni siquiera por iniciativa propia');
await root();

const ins = (quien, asignadaA, extra = {}) => {
  const c = { titulo: 'Reel del evento', fecha_limite: "(current_date + 5)", ...extra };
  return `INSERT INTO tareas(periodo_id,titulo,asignada_a,fecha_limite${c.origen ? ',origen' : ''}${c.estado ? ',estado' : ''}${c.rondas ? ',rondas_revision' : ''}${c.criterios ? ',criterios' : ''})
          VALUES ('${c.periodo || PE}','${c.titulo}','${asignadaA}',${c.fecha_limite}${c.origen ? `,'${c.origen}'` : ''}${c.estado ? `,'${c.estado}'` : ''}${c.rondas ? `,${c.rondas}` : ''}${c.criterios ? `,'${c.criterios}'` : ''}) RETURNING id`;
};
const idDe = async sql => (await q(sql))[0].id;

console.log('\n[creación: el servidor decide]');
await as(ADMIN);
const t1 = await idDe(ins(ADMIN, M1, { estado: 'aprobada', rondas: 5 }));
r = (await q(`SELECT * FROM tareas WHERE id=${t1}`))[0];
ok(r.origen === 'asignada' && r.asignada_por === ADMIN, 'admin asigna: origen=asignada, asignada_por=admin');
ok(r.estado === 'asignada' && r.rondas_revision === 0 && r.entregada_en === null, 'estado/rondas/fechas del cliente se ignoran');
ok(String(r.fecha_limite_original) === String(r.fecha_limite), 'fecha_limite_original = la inicial');
ok((await q(`SELECT count(*)::int n FROM tarea_eventos WHERE tarea_id=${t1} AND tipo='creada'`))[0].n === 1, 'evento «creada» registrado');
await rejects(ins(ADMIN, M1, { criterios: '{inventado}' }), 'desconocidos', 'criterio fuera del catálogo rechazado');
await allowed(ins(ADMIN, M1, { criterios: '{plazos,calidad}' }), 'criterios válidos del catálogo aceptados');

await as(SEC1);
await allowed(ins(SEC1, M1), 'secretario asigna a un miembro de su distrito');
await rejects(ins(SEC1, M3), 'distrito|policy', 'secretario NO asigna fuera de su distrito');
const tSecProp = await idDe(ins(SEC1, SEC1, { origen: 'asignada' }));
ok((await q(`SELECT origen FROM tareas WHERE id=${tSecProp}`))[0].origen === 'propia', 'tarea para uno mismo = propia aunque diga «asignada»');

await as(M1);
await rejects(ins(M1, M2), 'policy|para ti', 'miembro NO crea tareas para otro');
const tProp = await idDe(ins(M1, M1, { origen: 'asignada' }));
ok((await q(`SELECT origen, asignada_por FROM tareas WHERE id=${tProp}`)).every(x => x.origen === 'propia' && x.asignada_por === M1), 'miembro: su tarea es «propia»');
await rejects(ins(M1, M1, { periodo: OLD }), 'archivada|policy', 'no se crea en una gestión archivada');

console.log('\n[visibilidad]');
await as(M2);
r = await q(`SELECT count(*)::int n FROM tareas WHERE asignada_a <> '${M2}'`);
ok(r[0].n === 0, 'M2 no ve tareas ajenas');
await as(SEC1);
r = await q(`SELECT DISTINCT asignada_a FROM tareas`);
ok(r.every(x => [M1, SEC1].includes(x.asignada_a)), 'Sec1 ve su distrito y nada del 08-02');
await as(ADMIN);
await db.exec(`INSERT INTO tareas(periodo_id,titulo,asignada_a) VALUES ('${PE}','De M3','${M3}')`);
await as(SEC1);
ok((await q(`SELECT count(*)::int n FROM tareas WHERE asignada_a='${M3}'`))[0].n === 0, 'Sec1 no ve a M3 (otro distrito)');
await as(SEC2);
ok((await q(`SELECT count(*)::int n FROM tareas WHERE asignada_a='${M3}'`))[0].n === 1, 'Sec2 sí ve a M3');
await as(null, 'anon');
await rejects(`SELECT * FROM tareas`, 'permission|denied', 'anon no lee tareas');
await as(null, 'anon');
await rejects(`SELECT * FROM resumen_tareas_periodo('${PE}')`, 'permission|denied', 'anon no ejecuta el resumen');

console.log('\n[flujo del miembro]');
await as(ADMIN);
const ta = await idDe(ins(ADMIN, M1, { titulo: 'Cobertura sábado', fecha_limite: "(current_date + 3)" }));
await as(M1);
await allowed(`UPDATE tareas SET estado='en_curso' WHERE id=${ta}`, 'asignada → en_curso');
await rejects(`UPDATE tareas SET estado='aprobada' WHERE id=${ta}`, 'no permitida', 'miembro NO aprueba');
await rejects(`UPDATE tareas SET estado='entregada' WHERE id=${ta}`, 'enlace|nota', 'no se entrega sin enlace ni nota');
await rejects(`UPDATE tareas SET estado='entregada', entrega_url='javascript:alert(1)' WHERE id=${ta}`, 'check|violates', 'URL javascript: rechazada');
await rejects(`UPDATE tareas SET fecha_limite=current_date+30 WHERE id=${ta}`, 'prorrogando', 'miembro NO mueve la fecha límite');
await rejects(`UPDATE tareas SET titulo='Otra cosa' WHERE id=${ta}`, 'asignaron', 'miembro NO edita una tarea asignada');
await rejects(`UPDATE tareas SET revision_nota='ya está' WHERE id=${ta}`, 'revision', 'miembro NO escribe notas de revisión');
await allowed(`UPDATE tareas SET estado='entregada', entrega_url='https://drive.example.com/x', entregada_en='2000-01-01' WHERE id=${ta}`, 'entrega con enlace');
r = (await q(`SELECT entregada_en FROM tareas WHERE id=${ta}`))[0];
ok(new Date(r.entregada_en).getFullYear() > 2020, 'entregada_en lo fija el servidor (ignora 2000-01-01)');
const primera = r.entregada_en;
await rejects(`UPDATE tareas SET asignada_a='${M2}' WHERE id=${ta}`, 'no se pueden cambiar', 'no se reasigna a escondidas');
await rejects(`UPDATE tareas SET entrega_url='https://otro.example.com/cambiado' WHERE id=${ta}`, 'solo se registra al entregar', 'la entrega NO se cambia después de entregar');

console.log('\n[revisión]');
await as(M1);
await rejects(`UPDATE tareas SET estado='devuelta' WHERE id=${ta}`, 'no permitida', 'el receptor no se devuelve la tarea');
await as(SEC2);
r = await q(`UPDATE tareas SET estado='aprobada' WHERE id=${ta} RETURNING id`);
ok(r.length === 0, 'secretario de OTRO distrito no ve ni revisa la tarea');
await as(SEC1);
await rejects(`UPDATE tareas SET estado='devuelta' WHERE id=${ta}`, 'explica', 'devolver exige explicar qué corregir');
await allowed(`UPDATE tareas SET estado='devuelta', revision_nota='Falta el audio' WHERE id=${ta}`, 'secretario devuelve con nota');
ok((await q(`SELECT rondas_revision r FROM tareas WHERE id=${ta}`))[0].r === 1, 'rondas_revision = 1');
await as(M1);
await allowed(`UPDATE tareas SET estado='entregada', entrega_nota='Audio corregido' WHERE id=${ta}`, 'miembro reentrega tras la devolución');
ok(String((await q(`SELECT entregada_en FROM tareas WHERE id=${ta}`))[0].entregada_en) === String(primera), 'entregada_en sigue siendo la PRIMERA entrega');
await as(SEC1);
await allowed(`UPDATE tareas SET estado='aprobada' WHERE id=${ta}`, 'secretario aprueba');
ok((await q(`SELECT aprobada_en FROM tareas WHERE id=${ta}`))[0].aprobada_en !== null, 'aprobada_en fijada');
await as(M1);
await rejects(`UPDATE tareas SET entrega_nota='cambio' WHERE id=${ta}`, 'aprobada', 'tarea aprobada no se modifica');
r = await q(`SELECT tipo, de, a FROM tarea_eventos WHERE tarea_id=${ta} ORDER BY id`);
ok(r.map(x => x.tipo + ':' + (x.de || '') + '>' + x.a).join(' | ') ===
   'creada:>asignada | estado:asignada>en_curso | estado:en_curso>entregada | estado:entregada>devuelta | estado:devuelta>entregada | estado:entregada>aprobada',
   'historial completo: ' + r.length + ' eventos');
await rejects(`INSERT INTO tarea_eventos(tarea_id,tipo) VALUES (${ta},'estado')`, 'permission|denied', 'el cliente NO escribe el historial');
await as(ADMIN);
await allowed(`UPDATE tareas SET estado='entregada' WHERE id=${ta}`, 'solo el admin reabre una aprobada');

console.log('\n[no se aprueba a sí mismo]');
await as(SEC1);
await allowed(`UPDATE tareas SET estado='entregada', entrega_nota='listo' WHERE id=${tSecProp}`, 'secretario entrega su propia tarea');
await rejects(`UPDATE tareas SET estado='aprobada' WHERE id=${tSecProp}`, 'no permitida', 'secretario NO aprueba la suya');
await as(M1);
await allowed(`UPDATE tareas SET estado='entregada', entrega_nota='hecho por iniciativa' WHERE id=${tProp}`, 'miembro entrega su tarea propia');
await rejects(`UPDATE tareas SET estado='aprobada' WHERE id=${tProp}`, 'no permitida', 'miembro NO aprueba la suya');
await as(SEC1);
await allowed(`UPDATE tareas SET estado='aprobada' WHERE id=${tProp}`, 'el secretario del distrito sí valida la iniciativa');

console.log('\n[prórrogas con motivo]');
await as(ADMIN);
const tp = await idDe(ins(ADMIN, M1, { titulo: 'Plazo', fecha_limite: "(current_date + 2)" }));
await as(M1);
await rejects(`SELECT prorrogar_tarea(${tp}, current_date + 9, 'quiero más tiempo')`, 'no puedes', 'el receptor NO se prorroga lo asignado');
await as(SEC1);
await rejects(`SELECT prorrogar_tarea(${tp}, current_date + 9, '')`, 'motivo', 'prórroga sin motivo rechazada');
await rejects(`SELECT prorrogar_tarea(${tp}, current_date + 2, 'mismo día')`, 'distinta', 'misma fecha rechazada');
await allowed(`SELECT prorrogar_tarea(${tp}, current_date + 9, 'El evento se movió al viernes')`, 'secretario prorroga con motivo');
r = (await q(`SELECT fecha_limite, fecha_limite_original FROM tareas WHERE id=${tp}`))[0];
ok(String(r.fecha_limite) !== String(r.fecha_limite_original), 'fecha_limite cambió y la original se conserva');
r = await q(`SELECT motivo FROM tarea_eventos WHERE tarea_id=${tp} AND tipo='prorroga'`);
ok(r.length === 1 && /viernes/.test(r[0].motivo), 'la prórroga queda en el historial con su motivo');
await as(SEC2);
await rejects(`SELECT prorrogar_tarea(${tp}, current_date + 20, 'no es mi distrito')`, 'no existe|no puedes', 'secretario de otro distrito NO prorroga');
await as(M1);
await allowed(`SELECT prorrogar_tarea(${tProp}, current_date + 1, 'cambio de plan propio')`.replace(String(tProp), String(await (async () => { await as(M1); return await idDe(ins(M1, M1)); })())), 'el autor sí mueve el plazo de SU tarea propia (con motivo)');

console.log('\n[bloqueo]');
await as(ADMIN);
const tb = await idDe(ins(ADMIN, M1, { titulo: 'Depende de otro' }));
await as(M1);
await rejects(`UPDATE tareas SET estado='bloqueada' WHERE id=${tb}`, 'motivo', 'bloquear exige motivo');
await allowed(`UPDATE tareas SET estado='bloqueada', bloqueo_motivo='Esperando el guion de Redacción' WHERE id=${tb}`, 'bloquear con motivo');
await allowed(`UPDATE tareas SET estado='en_curso' WHERE id=${tb}`, 'desbloquear');
ok((await q(`SELECT bloqueo_motivo FROM tareas WHERE id=${tb}`))[0].bloqueo_motivo === null, 'el motivo se limpia al desbloquear (queda en el historial)');

console.log('\n[borrado]');
await as(M1);
const td = await idDe(ins(M1, M1, { titulo: 'Borrable' }));
await db.exec(`DELETE FROM tareas WHERE id=${td}`);
ok((await q(`SELECT count(*)::int n FROM tareas WHERE id=${td}`))[0].n === 0, 'el autor borra su tarea mientras está «asignada»');
await db.exec(`UPDATE tareas SET estado='en_curso' WHERE id=${tb}`).catch(() => {});
await db.exec(`DELETE FROM tareas WHERE id=${tb}`);
ok((await q(`SELECT count(*)::int n FROM tareas WHERE id=${tb}`))[0].n === 1, 'una tarea asignada por otro no se borra');

console.log('\n[gestión archivada y participantes inactivos]');
await root();
await db.exec(`INSERT INTO tareas(periodo_id,titulo,asignada_a,estado) VALUES ('${OLD}','vieja','${M1}','asignada')`).catch(() => {});
// (insertar como dueño pasa por el trigger de insert → sin sesión se rechaza; es lo esperado)
await as(ADMIN);
await db.exec(`INSERT INTO periodo_participantes(periodo_id,user_id,activo) VALUES ('${PE}','${M2}',false)`).catch(() => {});
await root();
await db.exec(`INSERT INTO periodo_participantes(periodo_id,user_id,activo) VALUES ('${PE}','${M2}',false) ON CONFLICT DO NOTHING`);
await as(ADMIN);
await rejects(ins(ADMIN, M2), 'inactiva', 'no se asigna a alguien inactivo en el período');

console.log('\n[resumen: evidencia para evaluar]');
await root();
await db.exec(`DELETE FROM tareas`);
await as(ADMIN);
// M1: dos entregadas a tiempo, una tardía (plazo ayer), una vencida sin entregar, una devuelta una vez
const a1 = await idDe(ins(ADMIN, M1, { fecha_limite: "(current_date + 3)" }));
const a2 = await idDe(ins(ADMIN, M1, { fecha_limite: "(current_date + 3)" }));
const a3 = await idDe(ins(ADMIN, M1, { fecha_limite: "(current_date - 1)" }));
await idDe(ins(ADMIN, M1, { fecha_limite: "(current_date - 2)" }));         // vencida abierta
const a5 = await idDe(ins(ADMIN, M1, { fecha_limite: "(current_date + 3)" }));
await as(M1);
for (const t of [a1, a2, a3]) await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='ok listo' WHERE id=${t}`);
await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='ok listo' WHERE id=${a5}`);
await as(SEC1);
await db.exec(`UPDATE tareas SET estado='devuelta', revision_nota='Falta formato' WHERE id=${a5}`);
const propia1 = await idDe((await (async () => { await as(M1); return ins(M1, M1); })()));
await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='por iniciativa' WHERE id=${propia1}`);
await as(SEC1);
await db.exec(`UPDATE tareas SET estado='aprobada' WHERE id=${propia1}`);
await as(M1);
const propia2 = await idDe(ins(M1, M1));          // propia sin aprobar: no cuenta como iniciativa
const rm = (await q(`SELECT * FROM resumen_tareas_periodo('${PE}')`));
ok(rm.length === 1 && rm[0].user_id === M1, 'el miembro ve solo su fila');
const m = rm[0];
ok(m.asignadas === 5 && m.entregadas === 4, `asignadas 5 / entregadas 4 (${m.asignadas}/${m.entregadas})`);
ok(m.con_plazo === 4 && m.a_tiempo === 3, `con plazo 4, a tiempo 3 (la del plazo de ayer es tardía): ${m.con_plazo}/${m.a_tiempo}`);
ok(m.vencidas_abiertas === 1, `1 vencida sin entregar (${m.vencidas_abiertas})`);
ok(m.devoluciones === 1, `1 devolución (${m.devoluciones})`);
ok(m.propias_aprobadas === 1, `solo la propia APROBADA cuenta como iniciativa (${m.propias_aprobadas})`);
await as(SEC1);
ok((await q(`SELECT user_id FROM resumen_tareas_periodo('${PE}')`)).length === 1, 'secretario ve las filas de su distrito (M1; M3 no)');
await as(ADMIN);
ok((await q(`SELECT user_id FROM resumen_tareas_periodo('${PE}')`)).length >= 1, 'admin ve todas');
await as(SEC2);
ok((await q(`SELECT user_id FROM resumen_tareas_periodo('${PE}')`)).every(x => x.user_id !== M1), 'secretario de otro distrito no ve a M1');

console.log('\n[zona horaria]');
await root();
ok((await q(`SELECT zona_periodo('${PE}') z`))[0].z === 'America/Santiago', 'por defecto America/Santiago');
const g = (await q(`SELECT gestion_id g FROM periodos_evaluacion WHERE id='${PE}'`))[0].g;
await db.exec(`INSERT INTO config VALUES (${g},'zona_horaria','America/Santo_Domingo')`);
ok((await q(`SELECT zona_periodo('${PE}') z`))[0].z === 'America/Santo_Domingo', 'se lee de config');
await db.exec(`UPDATE config SET valor='No/Existe' WHERE clave='zona_horaria'`);
ok((await q(`SELECT zona_periodo('${PE}') z`))[0].z === 'America/Santiago', 'una zona inválida cae al valor por defecto (no rompe las consultas)');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
