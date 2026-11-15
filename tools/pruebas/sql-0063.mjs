// Pruebas de 0063: las tareas de iniciativa propia nacen «En curso»; las asignadas por otra persona, «Asignada».
import { crear, montar, CADENA_BASE, sql } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, fin } = t;
const CADENA = [...CADENA_BASE, '0031_equipos.sql', '0032_tareas_equipo.sql', '0033_calificaciones.sql', '0034_calificacion_tareas.sql', '0035_resultados_integrados.sql'];
const X = await montar(t, CADENA);
const { P, PE1 } = X;
const nueva = async (quien, para, titulo) => { await as(quien); const r = await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a) VALUES ('${PE1}','${titulo}','${para}') RETURNING id, estado, origen`); await root(); return r[0]; };

console.log('[antes de 0063]');
const a0 = await nueva(P.M1, P.M1, 'Propia antes');
ok(a0.origen === 'propia' && a0.estado === 'asignada', 'antes: una propia nace «asignada» (' + a0.estado + ')');

const m = sql('0063_tareas_propias_en_curso.sql');
await db.exec(m);
ok(true, '0063 se aplica sin errores');
await db.exec(m);
ok(true, 'reaplicar 0063 es idempotente');

console.log('\n[después de 0063]');
const p = await nueva(P.M1, P.M1, 'Propia después');
ok(p.origen === 'propia' && p.estado === 'en_curso', 'una tarea de iniciativa propia nace «en_curso»');
const b = await nueva(P.ADMIN, P.M1, 'Asignada por la administración');
ok(b.origen === 'asignada' && b.estado === 'asignada', 'una asignada por otra persona sigue naciendo «asignada»');
const c = await nueva(P.SEC1, P.M1, 'Asignada por secretaría').catch(() => null);
if (c) ok(c.estado === 'asignada', 'una asignada por la secretaría sigue «asignada»');
const d = await nueva(P.ADMIN, P.ADMIN, 'Propia de la administración');
ok(d.estado === 'en_curso', 'la administración también: lo suyo nace «en_curso»');

console.log('\n[la propia se puede entregar sin «Empezar»]');
await as(P.M1);
await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='listo' WHERE id=${p.id}`);
await root();
ok((await q(`SELECT estado FROM tareas WHERE id=${p.id}`))[0].estado === 'entregada', 'en_curso → entregada, directo');

console.log('\n[reglas que no cambian]');
await as(P.M1);
await rejects(`UPDATE tareas SET estado='aprobada', puntos=8 WHERE id=${p.id}`, 'puntos|aprob|revis|permis|denied|row-level|nadie', 'nadie aprueba su propia tarea');
await rejects(`INSERT INTO tareas(periodo_id,titulo,asignada_a) VALUES ('${PE1}','Para otra persona','${P.M2}')`, 'para ti|asignar', 'un miembro no crea tareas para otros');
await root();
const ev = await q(`SELECT tipo, detalle FROM tarea_eventos WHERE tarea_id=${p.id} ORDER BY id LIMIT 1`).catch(() => []);
ok(ev.length === 0 || ev[0].tipo === 'creada', 'el historial sigue empezando con «creada»');
fin();
