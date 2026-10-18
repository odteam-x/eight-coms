// Pruebas de 0034 (cálculo de la nota de tareas): fórmula ponderada, qué cuenta y qué no, grupal vs individual.
import { crear, montar, CADENA_BASE, sql } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, allowed, fin } = t;
const X = await montar(t, [...CADENA_BASE, '0031_equipos.sql', '0032_tareas_equipo.sql', '0033_calificaciones.sql', '0034_calificacion_tareas.sql']);
const { P, PE1, PE2, LEG } = X;
console.log('— 0034 aplicada sin errores');
await db.exec(sql('0034_calificacion_tareas.sql'));
ok(true, 'reaplicar 0034 es idempotente');

// El cálculo interno solo lo puede llamar la base: aquí se consulta como dueño para comprobar la fórmula y,
// aparte, se comprueba que el cliente no pueda.
const nota = async (persona, per = PE1) => {
  await root();                                                      // dueño de la base (para llamar a la función interna)...
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${P.ADMIN}',false)`);   // ...pero con sesión (calif_config la exige)
  const r = (await q(`SELECT nota::float n, n_cuentan, n_individuales, n_colectivas, suficiente FROM calif_puntaje('${per}') WHERE persona_id='${persona}'`))[0];
  return r ?? { n: null, n_cuentan: 0, n_individuales: 0, n_colectivas: 0, suficiente: false };
};
const crearI = async (para, titulo, extra = {}) => {
  await as(P.ADMIN);
  return (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,peso,fecha_limite) VALUES ('${PE1}','${titulo}','${para}',${extra.peso ?? 1},${extra.limite ?? 'current_date+10'}) RETURNING id`))[0].id;
};
const aprobarI = async (id, quien, pts) => {
  await root();
  const dueno = (await q(`SELECT asignada_a a FROM tareas WHERE id=${id}`))[0].a;
  await as(dueno);
  await db.exec(`UPDATE tareas SET estado='en_curso' WHERE id=${id}`);
  await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='listo' WHERE id=${id}`);
  await as(quien);
  await db.exec(`UPDATE tareas SET estado='aprobada', puntos=${pts} WHERE id=${id}`);
};

// Reglas: 30 % tareas, colectivas ×2.
await as(P.ADMIN);
await db.exec(`SELECT public.calif_config_guardar('${PE1}', 30, 1, 2, 1, true, false)`);

console.log('\n[fórmula: promedio PONDERADO de lo que cuenta]');
const A = await crearI(P.M1, 'A'); await aprobarI(A, P.SEC1, 8);                   // peso 1, 8
const B = await crearI(P.M1, 'B', { peso: 3 }); await aprobarI(B, P.SEC1, 4);      // peso 3, 4
let n = await nota(P.M1);
// 100 × (1·0.8 + 3·0.4) / 4 = 50.0   (¡no (8+4)/2 = 60!)
ok(n.n === 50 && n.n_cuentan === 2, 'A(peso 1, 8) + B(peso 3, 4) = 50.0: pondera por peso, no promedia simple (60) → ' + n.n);

console.log('\n[lo que NO cuenta]');
const C = await crearI(P.M1, 'C entregada'); await as(P.M1);
await db.exec(`UPDATE tareas SET estado='en_curso' WHERE id=${C}`); await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='ya listo' WHERE id=${C}`);
n = await nota(P.M1);
ok(n.n === 50 && n.n_cuentan === 2, 'una tarea entregada y sin revisar NO baja la nota (no es un 0)');
await crearI(P.M1, 'D vencida', { limite: 'current_date-3' });
n = await nota(P.M1);
ok(n.n === 50, 'una vencida sin entregar tampoco cuenta mientras la regla «vencidas como 0» esté apagada');
const E = await crearI(P.M1, 'E a anular');
await as(P.ADMIN);
await db.exec(`UPDATE tareas SET estado='anulada', anulacion_motivo='Se canceló la actividad' WHERE id=${E}`);
const F = await crearI(P.M1, 'F nota anulada'); await aprobarI(F, P.SEC1, 10);
n = await nota(P.M1);
// A(1,.8) B(3,.4) F(1,1.0) → 100·(0.8+1.2+1.0)/5 = 60
ok(n.n === 60 && n.n_cuentan === 3, 'F aprobada con 10 entra: 100·3.0/5 = 60 → ' + JSON.stringify(n));
await as(P.ADMIN);
await db.exec(`SELECT public.anular_nota_tarea('individual', ${F}, 'Duplicada con la tarea A')`);
n = await nota(P.M1);
ok(n.n === 50 && n.n_cuentan === 2, 'anular la nota de F la saca del numerador Y del denominador');
await as(P.M1);
const it = await q(`SELECT titulo, razon FROM tareas_calificacion_detalle('${PE1}','${P.M1}') ORDER BY titulo`);
const raz = Object.fromEntries(it.map(i => [i.titulo, i.razon]));
ok(raz['C entregada'] === 'pendiente_de_evaluacion' && raz['D vencida'] === 'vencida' && raz['E a anular'] === 'tarea_anulada' && raz['F nota anulada'] === 'nota_anulada' && raz.A === 'calificada',
   'el detalle explica cada una: ' + JSON.stringify(raz));

console.log('\n[iniciativa propia]');
await as(P.M1);
const G = (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,peso) VALUES ('${PE1}','G propia','${P.M1}',50) RETURNING id`))[0].id;
await db.exec(`UPDATE tareas SET estado='en_curso' WHERE id=${G}`); await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='hecho' WHERE id=${G}`);
await as(P.SEC1); await db.exec(`UPDATE tareas SET estado='aprobada', puntos=10 WHERE id=${G}`);
n = await nota(P.M1);
// peso 50 en la propia se ignora → 1: A(1,.8) B(3,.4) G(1,1.0) → 60
ok(n.n === 60, 'una tarea PROPIA pesa 1 aunque se intentara 50 (no infla el promedio): ' + n.n);
await as(P.ADMIN);
await db.exec(`SELECT public.calif_config_guardar('${PE1}', 30, 1, 2, 1, false, false, 'Las iniciativas no cuentan este PE')`);
n = await nota(P.M1);
ok(n.n === 50, 'con contar_propias apagado, la iniciativa deja de contar');
await as(P.ADMIN);
await db.exec(`SELECT public.calif_config_guardar('${PE1}', 30, 1, 2, 1, true, true, 'Se activa la regla institucional de vencidas')`);
n = await nota(P.M1);
// A(1,.8) B(3,.4) G(1,1.0) D vencida(1, 0) → 100·3.0/6 = 50
ok(n.n === 50, 'con «vencidas como 0» la vencida D entra con 0: 100·3.0/6 = 50 → ' + n.n);
await as(P.ADMIN);
await db.exec(`SELECT public.calif_config_guardar('${PE1}', 30, 1, 2, 1, true, false, 'Se apaga la regla de vencidas')`);

console.log('\n[mínimo de tareas]');
await db.exec(`SELECT public.calif_config_guardar('${PE1}', 30, 1, 2, 4, true, false, 'Se exigen al menos 4 tareas')`);
n = await nota(P.M1);
ok(n.n === null && n.suficiente === false && n.n_cuentan === 3, 'con menos tareas que el mínimo, la nota es NULL (no 0): ' + JSON.stringify(n));
await as(P.ADMIN);
await db.exec(`SELECT public.calif_config_guardar('${PE1}', 30, 1, 2, 1, true, false, 'Mínimo vuelve a 1')`);

console.log('\n[tarea colectiva: una vez por persona, con su multiplicador]');
await as(P.ADMIN);
const EQ = (await q(`SELECT public.equipo_guardar(NULL,'${PE1}','Cobertura') id`))[0].id;
await db.exec(`SELECT public.equipo_agregar_miembros(${EQ}, ARRAY['${P.M1}','${P.M2}','${P.M3}','${P.M4}']::uuid[], true, 'Prueba de excepción de ámbito')`);
const TE = (await q(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo,peso) VALUES (${EQ},'${PE1}','Grupal',2) RETURNING id`))[0].id;
// M4 aporta y luego sale antes de la aprobación; M3 sale sin aportar
await as(P.M4); await db.exec(`SELECT public.tarea_equipo_aportar(${TE}, 'evidencia', 'Hice las tomas', 'https://x.example/tomas', NULL)`);
await as(P.ADMIN);
await db.exec(`SELECT public.equipo_retirar_miembro(${EQ}, '${P.M4}', 'Cambia de proyecto en el PE')`);
await db.exec(`SELECT public.equipo_retirar_miembro(${EQ}, '${P.M3}', 'Cambia de proyecto en el PE')`);
await as(P.M1); await db.exec(`UPDATE tareas_equipo SET estado='entregada', entrega_nota='Entrega grupal' WHERE id=${TE}`);
await as(P.ADMIN); await db.exec(`UPDATE tareas_equipo SET estado='aprobada', puntos=5 WHERE id=${TE}`);
// M1: A(1,.8) B(3,.4) G(1,1.0) + colectiva(peso 2×2 = 4, .5) → 100·(0.8+1.2+1.0+2.0)/9 = 55.6
n = await nota(P.M1);
ok(n.n === 55.6 && n.n_colectivas === 1, 'M1: la colectiva entra UNA vez con peso 2×2 = 4 → 55.6: ' + JSON.stringify(n));
const m2 = await nota(P.M2);
ok(m2.n === 50 && m2.n_cuentan === 1 && m2.n_colectivas === 1, 'M2 (solo la colectiva, nota 5) = 50.0');
ok((await nota(P.M4)).n === 50, 'M4 salió antes de aprobarse pero APORTÓ: cuenta');
const m3 = await nota(P.M3);
ok(m3.n === null && m3.n_cuentan === 0, 'M3 salió sin aportar nada: no cuenta');
await as(P.M3);
ok((await q(`SELECT razon FROM tareas_calificacion_detalle('${PE1}')`))[0].razon === 'no_participo', 'el detalle de M3 dice «no_participo»');
await as(P.ADMIN);
await db.exec(`SELECT public.equipo_agregar_miembros(${EQ}, ARRAY['${P.M5}']::uuid[], true, 'Cubre vacante tras la entrega')`);
ok((await nota(P.M5)).n_cuentan === 0, 'quien entra DESPUÉS de aprobada la tarea no cuenta');

console.log('\n[nota individual dentro del grupo]');
await as(P.ADMIN);
await db.exec(`SELECT public.nota_individual_equipo(${TE}, '${P.M2}', 3, 'No participó en la edición final, ver aportes')`);
ok((await nota(P.M2)).n === 30, 'la nota individual 3 reemplaza a la del grupo (5) SOLO para M2');
await as(P.M2);
const d2 = (await q(`SELECT individual_en_grupo i, nota_grupo g, puntos p, razon r FROM tareas_calificacion_detalle('${PE1}','${P.M2}')`))[0];
ok(d2.i && d2.g === 5 && d2.p === 3 && d2.r === 'individual_en_grupo', 'el detalle distingue «individual en el grupo» de la nota del grupo');
ok((await nota(P.M1)).n === 55.6, 'y no cambia la nota de las demás personas');
await as(P.ADMIN);
await db.exec(`SELECT public.corregir_nota_tarea('equipo', ${TE}, 10, 'El grupo cumplió la totalidad del guion')`);
// M1: (0.8+1.2+1.0+4.0)/9 = 77.8
ok((await nota(P.M1)).n === 77.8, 'corregir la nota del grupo (5 → 10) actualiza a M1 al instante: ' + (await nota(P.M1)).n);
ok((await nota(P.M2)).n === 30, 'M2 conserva su nota individual');
await as(P.ADMIN);
await db.exec(`SELECT public.anular_nota_tarea('equipo', ${TE}, 'Se repite en otra tarea del PE')`);
ok((await nota(P.M1)).n === 60 && (await nota(P.M2)).n_cuentan === 0, 'anular la nota del grupo la quita de TODAS las personas (M1 vuelve a 60: A, B y su iniciativa)');
await as(P.ADMIN);
await db.exec(`SELECT public.restaurar_nota_tarea('equipo', ${TE}, 'Se confirmó que no se repite')`);
ok((await nota(P.M1)).n === 77.8, 'restaurarla la devuelve');

console.log('\n[quién ve qué]');
await as(P.M2);
ok((await q(`SELECT count(*)::int n FROM tareas_calificacion_detalle('${PE1}','${P.M1}')`))[0].n === 0, 'M2 no ve el desglose de M1');
ok((await q(`SELECT count(*)::int n FROM tareas_calificacion_detalle('${PE1}')`))[0].n >= 1, 'pero sí el propio');
ok((await q(`SELECT count(*)::int n FROM tareas_calificacion_resumen('${PE1}')`))[0].n === 1, 'el resumen solo trae su fila');
await as(P.SEC1);
ok((await q(`SELECT count(*)::int n FROM tareas_calificacion_resumen('${PE1}')`))[0].n >= 2, 'la secretaría 08-01 ve a su distrito');
ok((await q(`SELECT count(*)::int n FROM tareas_calificacion_resumen('${PE1}') WHERE persona_id='${P.M3}'`))[0].n === 0, 'y no a M3 (08-02)');
await as(P.SEC2);
ok((await q(`SELECT count(*)::int n FROM tareas_calificacion_detalle('${PE1}','${P.M1}')`))[0].n === 0, 'la secretaría del otro distrito no ve a M1');
await as(P.ADMIN);
ok((await q(`SELECT count(*)::int n FROM tareas_calificacion_resumen('${PE1}')`))[0].n >= 4, 'la administración ve a todos');
await as(null, 'anon');
await rejects(`SELECT * FROM tareas_calificacion_resumen('${PE1}')`, 'denied|permission|denegado', 'anónimo no ejecuta');
await as(P.M1);
await rejects(`SELECT * FROM calif_puntaje('${PE1}')`, 'denied|permission|denegado', 'el cliente no llama a la función interna calif_puntaje');
await rejects(`SELECT * FROM calif_items('${PE1}')`, 'denied|permission|denegado', 'ni a calif_items');
ok((await q(`SELECT count(*)::int n FROM calif_config('${PE2}')`))[0].n === 1, 'las reglas son legibles para cualquiera con sesión');
ok((await q(`SELECT count(*)::int n FROM tareas_calificacion_resumen('${LEG}')`))[0].n === 0, 'un PE clásico no tiene nota de tareas');

fin();
