// Pruebas de 0060: la descripción de una tarea admite documentación larga (hasta 20 000 caracteres).
import { crear, montar, CADENA_BASE, sql } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, allowed, fin } = t;
const X = await montar(t, [...CADENA_BASE, '0031_equipos.sql', '0032_tareas_equipo.sql']);
const { P, PE1 } = X;
const texto = n => 'Línea ñ ó.\n'.repeat(Math.ceil(n / 10)).slice(0, n);   // n caracteres exactos, con tildes y saltos de línea

const equipo = async () => {
  await as(P.ADMIN);
  const id = (await q(`SELECT public.equipo_guardar(NULL, '${PE1}', 'Docs', '', NULL, NULL) id`))[0].id;
  await db.exec(`SELECT public.equipo_agregar_miembros(${id}, ARRAY['${P.M1}','${P.M2}']::uuid[], true, 'Prueba de excepción de ámbito')`);
  await root();
  return id;
};
const E1 = await equipo();
const nueva = async (desc, instr = '', crit = '') => {
  await as(P.ADMIN);
  try { await db.exec(`INSERT INTO tareas_equipo(equipo_id, periodo_id, titulo, descripcion, instrucciones, criterios_evaluacion, fecha_limite) VALUES (${E1}, '${PE1}', 'Docs', '${desc}', '${instr}', '${crit}', current_date + 7)`); return null; }
  catch (e) { return e.message; } finally { await root(); }
};
const nuevaIndividual = async desc => {
  await as(P.ADMIN);
  try { await db.exec(`INSERT INTO tareas(periodo_id, titulo, descripcion, asignada_a) VALUES ('${PE1}', 'Docs', '${desc}', '${P.M1}')`); return null; }
  catch (e) { return e.message; } finally { await root(); }
};

console.log('[antes de 0060: el tope era 4000]');
ok(/violates check|descripcion/i.test(await nueva(texto(15000)) || ''), 'tarea de equipo: 15 000 caracteres de descripción se rechazan');
ok(/violates check|descripcion/i.test(await nuevaIndividual(texto(15000)) || ''), 'tarea individual: 15 000 caracteres se rechazan');

const m = sql('0060_tareas_texto_largo.sql');
await db.exec(m);
ok(true, '0060 se aplica sin errores');
await db.exec(m);
ok(true, 'reaplicar 0060 es idempotente');

console.log('\n[después de 0060]');
ok(await nueva(texto(15000), texto(19000), texto(4500)) === null, 'tarea de equipo: descripción 15 000, instrucciones 19 000 y criterios 4 500 caracteres entran');
ok(await nuevaIndividual(texto(20000)) === null, 'tarea individual: exactamente 20 000 caracteres entran');
const n = (await q(`SELECT max(char_length(descripcion))::int n FROM tareas_equipo`))[0].n;
ok(n === 15000, 'se guarda completo, sin recortar (' + n + ')');
ok(/violates check|descripcion/i.test(await nuevaIndividual(texto(20001)) || ''), 'a partir de 20 001 se rechaza (hay tope, no es ilimitado)');
ok(/violates check|descripcion/i.test(await nueva(texto(20001)) || ''), '...también en tareas de equipo');
ok(/violates check|criterios/i.test(await nueva('x', '', texto(5001)) || ''), 'criterios de evaluación: tope de 5 000');
const cons = await q(`SELECT conrelid::regclass::text t, conname FROM pg_constraint WHERE contype='c' AND conname LIKE '%\\_max' ESCAPE '\\' AND conname LIKE 'tareas%' ORDER BY 1,2`);
ok(cons.length === 4, 'quedan 4 restricciones con nombre fijo, sin duplicar las anteriores: ' + cons.map(c => c.conname).join(', '));
const viejas = await q(`SELECT conname FROM pg_constraint WHERE conrelid IN ('public.tareas'::regclass, 'public.tareas_equipo'::regclass) AND contype='c' AND pg_get_constraintdef(oid) ~ 'char_length\\(\\(?(descripcion|instrucciones|criterios_evaluacion)\\)?(::text)?\\) <= (4000|2000)([^0-9]|$)'`);
ok(viejas.length === 0, 'no queda ninguna restricción antigua de 4 000 / 2 000');
const otras = await q(`SELECT count(*)::int n FROM pg_constraint WHERE conrelid='public.tareas'::regclass AND contype='c' AND pg_get_constraintdef(oid) ~ 'char_length'`);
ok(otras[0].n >= 5, 'los demás topes de tareas (título, entrega, revisión, bloqueo) siguen: ' + otras[0].n);
fin();
