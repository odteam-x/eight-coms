// Pruebas de 0035 (la nota de tareas entra en la evaluación): lo que antes fallaba —los puntos no llegaban a ningún
// resultado— y que ahora perfil, panel, reportes y seguimiento leen UNA sola fuente.
import { crear, montar, CADENA_BASE, sql, J } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, allowed, fin } = t;
const CADENA = [...CADENA_BASE, '0031_equipos.sql', '0032_tareas_equipo.sql', '0033_calificaciones.sql', '0034_calificacion_tareas.sql', '0035_resultados_integrados.sql'];
const X = await montar(t, CADENA);
const { P, PE1, PE2, LEG, G, FOTO } = X;
console.log('— 0035 aplicada sin errores');
await db.exec(sql('0035_resultados_integrados.sql'));
ok(true, 'reaplicar 0035 es idempotente');

// ── Evaluaciones publicadas (M1 completa, M2 a la mitad) y un borrador (M3) ──
const perfil = (await q(`SELECT public.perfil_vigente(${FOTO}, '${PE1}') id`))[0].id;
const tec = await q(`SELECT criterio_key k, peso FROM perfil_criterios WHERE perfil_id=${perfil}`);
const nuc = (await q(`SELECT key FROM criterios_v2 WHERE gestion_id=${G} AND tipo='nucleo' AND tipo_campo='escala' AND activo`)).map(x => x.key);
const todo = full => ({ ...Object.fromEntries(nuc.map(k => [k, full ? 10 : 5])), ...Object.fromEntries(tec.map(x => [x.k, full ? x.peso : Math.floor(x.peso / 2)])) });
await as(P.ADMIN);
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${P.M1}','${J(todo(true))}','publicado')`);
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${P.M2}','${J(todo(false))}','publicado')`);
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${P.M3}','${J(todo(false))}','borrador')`);

const res = async (quien, borr = false) => {
  await as(quien);
  return Object.fromEntries((await q(`SELECT evaluado_id, individual::float i, general::float g, individual_eval::float ie, general_eval::float ge,
        tareas::float t, tareas_n, peso_tareas::float w, percentil::float p FROM resultados_periodo('${PE1}', ${borr})`)).map(r => [r.evaluado_id, r]));
};
const aprobarI = async (para, titulo, pts, peso = 1) => {
  await as(P.ADMIN);
  const id = (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,peso) VALUES ('${PE1}','${titulo}','${para}',${peso}) RETURNING id`))[0].id;
  await as(para);
  await db.exec(`UPDATE tareas SET estado='en_curso' WHERE id=${id}`);
  await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='listo' WHERE id=${id}`);
  await as(P.ADMIN);
  await db.exec(`UPDATE tareas SET estado='aprobada', puntos=${pts} WHERE id=${id}`);
  return id;
};
const cerca = (a, b) => Math.abs(a - b) <= 0.11;

console.log('\n[antes de que haya tareas calificadas: nada cambia, a nadie se le resta]');
let r = await res(P.ADMIN, true);
ok(r[P.M1].t === null && r[P.M1].w === 0 && r[P.M1].i === r[P.M1].ie && r[P.M1].g === r[P.M1].ge, 'sin tareas calificadas: individual = individual_eval (peso efectivo 0), aunque el PE tenga 20 %');
ok(r[P.M1].i === 100, 'M1 (todo al máximo) = 100');
const pct0 = { M1: r[P.M1].p, M2: r[P.M2].p };

console.log('\n[LA CAUSA RAÍZ: una tarea aprobada con 8 puntos llega a la evaluación]');
await aprobarI(P.M1, 'Reportaje', 8);
r = await res(P.ADMIN, true);
ok(r[P.M1].t === 80 && r[P.M1].tareas_n === 1 && r[P.M1].w === 20, 'M1: nota de tareas 80, 1 tarea, pesa 20 % → ' + JSON.stringify({ t: r[P.M1].t, n: r[P.M1].tareas_n, w: r[P.M1].w }));
ok(cerca(r[P.M1].i, 0.8 * r[P.M1].ie + 0.2 * 80), `individual = 0.8·${r[P.M1].ie} + 0.2·80 = ${r[P.M1].i}  (antes del arreglo seguía en ${r[P.M1].ie})`);
ok(cerca(r[P.M1].g, 0.8 * r[P.M1].ge + 0.2 * 80), 'general = 0.8·general_eval + 0.2·80');
ok(r[P.M2].i === r[P.M2].ie && r[P.M2].t === null, 'M2 no tiene tareas calificadas: su resultado NO cambia');
ok(r[P.M1].p === pct0.M1 && r[P.M2].p === pct0.M2, 'el percentil (sobre el técnico) no se mueve con las tareas');

console.log('\n[todas las pantallas leen lo mismo]');
await as(P.M1);
const propio = (await q(`SELECT individual::float i FROM resultados_periodo('${PE1}')`))[0].i;
ok(propio === r[P.M1].i, 'el perfil propio (rpc de la persona) = el de la administración');
const seg = async quien => { await as(quien); return Object.fromEntries((await q(`SELECT persona_id, individual::float i, individual_eval::float ie, tareas_nota::float t, tareas_n, peso_tareas::float w FROM seguimiento_global(${G}) WHERE periodo_nombre='PE1'`)).map(x => [x.persona_id, x])); };
let s = await seg(P.ADMIN);
ok(s[P.M1].i === r[P.M1].i && s[P.M1].t === 80 && s[P.M1].tareas_n === 1, 'seguimiento_global (administración) = resultados_periodo: individual ' + s[P.M1].i);
s = await seg(P.SEC1);
ok(s[P.M1].i === r[P.M1].i, 'seguimiento_global (secretaría 08-01) = lo mismo');
s = await seg(P.M1);
ok(s[P.M1].i === r[P.M1].i && Object.keys(s).length === 1, 'seguimiento_global (la propia persona) = lo mismo, y solo su fila');
ok((await seg(P.ADMIN))[P.M3].i !== undefined, 'el borrador de M3 lo ve la administración');
s = await seg(P.SEC1);
ok(s[P.M3] === undefined || s[P.M3].i === null, 'pero la secretaría NO ve la nota de un borrador (M3 es 08-02: ni siquiera su fila)');

console.log('\n[corregir / anular se refleja al instante en todas partes]');
await as(P.ADMIN);
await db.exec(`SELECT public.corregir_nota_tarea('individual', (SELECT id FROM tareas WHERE titulo='Reportaje'), 4, 'El material estaba incompleto, ver revisión')`);
r = await res(P.ADMIN, true);
ok(r[P.M1].t === 40 && cerca(r[P.M1].i, 0.8 * r[P.M1].ie + 0.2 * 40), 'corregir 8 → 4: tareas 40 e individual recalculado: ' + r[P.M1].i);
s = await seg(P.ADMIN);
ok(s[P.M1].i === r[P.M1].i, 'seguimiento_global sigue idéntico');
await as(P.ADMIN);
await db.exec(`SELECT public.anular_nota_tarea('individual', (SELECT id FROM tareas WHERE titulo='Reportaje'), 'La tarea se duplicó con otra')`);
r = await res(P.ADMIN, true);
ok(r[P.M1].t === null && r[P.M1].i === r[P.M1].ie, 'anular la única nota: M1 vuelve a su evaluación pura (sin penalización, sin 0 inventado)');
await db.exec(`SELECT public.restaurar_nota_tarea('individual', (SELECT id FROM tareas WHERE titulo='Reportaje'), 'Se confirmó que no era duplicada')`);

console.log('\n[el peso lo decide la administración]');
await db.exec(`SELECT public.calif_config_guardar('${PE1}', 0, 1, 1, 1, true, false, 'Este PE no pondera tareas')`);
r = await res(P.ADMIN, true);
ok(r[P.M1].i === r[P.M1].ie && r[P.M1].w === 0 && r[P.M1].t === 40, 'con peso_tareas = 0 el resultado es el de siempre; la nota de tareas se sigue MOSTRANDO (' + r[P.M1].t + ')');
await db.exec(`SELECT public.calif_config_guardar('${PE1}', 100, 1, 1, 1, true, false, 'Prueba de extremo')`);
r = await res(P.ADMIN, true);
ok(r[P.M1].i === 40 && r[P.M1].g === 40, 'con peso 100 % el resultado es solo la nota de tareas (40, ya corregida)');
await db.exec(`SELECT public.calif_config_guardar('${PE1}', 25, 1, 1, 1, true, false, 'Acuerdo del comité')`);

console.log('\n[tarea colectiva: cada integrante la recibe una vez]');
await as(P.ADMIN);
const EQ = (await q(`SELECT public.equipo_guardar(NULL,'${PE1}','Cobertura') id`))[0].id;
await db.exec(`SELECT public.equipo_agregar_miembros(${EQ}, ARRAY['${P.M1}','${P.M2}']::uuid[], true, 'Prueba de excepción de ámbito')`);
const TE = (await q(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo) VALUES (${EQ},'${PE1}','Grupal') RETURNING id`))[0].id;
await as(P.M2); await db.exec(`UPDATE tareas_equipo SET estado='entregada', entrega_nota='Entrega del grupo' WHERE id=${TE}`);
await as(P.ADMIN); await db.exec(`UPDATE tareas_equipo SET estado='aprobada', puntos=10 WHERE id=${TE}`);
r = await res(P.ADMIN, true);
ok(r[P.M2].t === 100 && r[P.M2].tareas_n === 1, 'M2 (solo la colectiva, nota 10) → tareas 100');
ok(r[P.M1].tareas_n === 2 && r[P.M1].t === 70, 'M1: individual 4 + colectiva 10 con el mismo peso → 100·(0.4+1.0)/2 = 70: ' + r[P.M1].t);
ok(cerca(r[P.M2].i, 0.75 * r[P.M2].ie + 0.25 * 100), 'y M2 sube su individual: ' + r[P.M2].i);
s = await seg(P.ADMIN);
ok(s[P.M2].tareas_n === 1 && true, 'seguimiento_global cuenta la tarea del grupo una vez (tareas_n 1)');
const col = (await q(`SELECT colectivas_total c, colectivas_aprobadas a FROM seguimiento_global(${G}) WHERE persona_id='${P.M2}' AND periodo_nombre='PE1'`))[0];
ok(col.c === 1 && col.a === 1, 'y las columnas de tareas colectivas aparecen: total 1, aprobadas 1');

console.log('\n[quién ve qué]');
r = await res(P.M2);
ok(Object.keys(r).length === 1 && r[P.M2], 'un miembro recibe solo su fila (RLS dentro de la función)');
r = await res(P.SEC1);
ok(r[P.M3] === undefined && r[P.M1] && r[P.M2], 'la secretaría 08-01 ve a M1 y M2, no a M3 (08-02)');
r = await res(P.M2, true);
ok(r[P.M3] === undefined, 'pedir borradores siendo miembro no destapa nada (solo lo honra la administración)');
await as(P.M1);
ok((await q(`SELECT count(*)::int n FROM resultados_periodo('${LEG}')`))[0].n === 0, 'un PE clásico no devuelve resultados v2');
await as(null, 'anon');
await rejects(`SELECT * FROM resultados_periodo('${PE1}')`, 'denied|permission|denegado', 'anónimo no ejecuta resultados_periodo');
await rejects(`SELECT * FROM seguimiento_global(${G})`, 'denied|permission|denegado', 'ni seguimiento_global');

console.log('\n[anuladas fuera de los conteos]');
await as(P.ADMIN);
const idA = (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a) VALUES ('${PE1}','Para anular','${P.M2}') RETURNING id`))[0].id;
const antes = (await q(`SELECT asignadas FROM resumen_tareas_periodo('${PE1}') WHERE user_id='${P.M2}'`))[0].asignadas;
await db.exec(`UPDATE tareas SET estado='anulada', anulacion_motivo='Ya no hace falta' WHERE id=${idA}`);
const desp = (await q(`SELECT asignadas FROM resumen_tareas_periodo('${PE1}') WHERE user_id='${P.M2}'`))[0];
ok(desp === undefined || desp.asignadas === antes - 1, 'una tarea anulada ya no cuenta como asignada en el resumen de evidencia');

fin();
