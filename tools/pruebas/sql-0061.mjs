// Pruebas de 0061: «sin tareas calificadas, se pierden los puntos de tareas» (regla por PE, apagada por defecto).
import { crear, montar, CADENA_BASE, sql, J } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, fin } = t;
const CADENA = [...CADENA_BASE, '0031_equipos.sql', '0032_tareas_equipo.sql', '0033_calificaciones.sql', '0034_calificacion_tareas.sql', '0035_resultados_integrados.sql'];
const X = await montar(t, CADENA);
const { P, PE1, G, FOTO } = X;

const perfil = (await q(`SELECT public.perfil_vigente(${FOTO}, '${PE1}') id`))[0].id;
const tec = await q(`SELECT criterio_key k, peso FROM perfil_criterios WHERE perfil_id=${perfil}`);
const nuc = (await q(`SELECT key FROM criterios_v2 WHERE gestion_id=${G} AND tipo='nucleo' AND tipo_campo='escala' AND activo`)).map(x => x.key);
const pun = f => J(Object.fromEntries([...nuc.map(k => [k, Math.round(10 * f)]), ...tec.map(x => [x.k, Math.floor(x.peso * f)])]));
await db.exec(`UPDATE profiles SET rol_id=${FOTO} WHERE id IN ('${P.M1}','${P.M2}','${P.M3}')`);
await as(P.ADMIN);
// M1, M2 y M3 con la MISMA evaluación (0.8); el PE nace con peso de tareas 20 %.
for (const m of [P.M1, P.M2, P.M3]) await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${m}','${pun(0.8)}','publicado')`);
const aprobar = async (para, pts) => {
  await as(P.ADMIN);
  const id = (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,peso) VALUES ('${PE1}','Reportaje','${para}',1) RETURNING id`))[0].id;
  await as(para); await db.exec(`UPDATE tareas SET estado='en_curso' WHERE id=${id}`); await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='listo' WHERE id=${id}`);
  await as(P.ADMIN); await db.exec(`UPDATE tareas SET estado='aprobada', puntos=${pts} WHERE id=${id}`);
};
await aprobar(P.M1, 8);   // M1: una tarea con 8/10 (nota de tareas 80). M2 y M3: sin tareas.
const res = async () => { await as(P.ADMIN); const f = await q(`SELECT evaluado_id, individual::float i, general::float g, individual_eval::float ie, general_eval::float ge, tareas::float t, peso_tareas::float w FROM resultados_periodo('${PE1}')`); await root(); return Object.fromEntries(f.map(r => [r.evaluado_id, r])); };
const cerca = (a, b) => Math.abs(a - b) <= 0.11;
await root();
const antes = await res();

console.log('[antes de 0061]');
ok(antes[P.M2].t === null && antes[P.M2].w === 0 && antes[P.M2].i === antes[P.M2].ie, 'sin tareas: la nota de tareas es NULL, el peso 0 y el resultado es solo la evaluación (' + antes[P.M2].i + ')');

const m = sql('0061_tareas_sin_tareas_pierde_puntos.sql');
await db.exec(m);
ok(true, '0061 se aplica sin errores');
await db.exec(m);
ok(true, 'reaplicar 0061 es idempotente');

console.log('\n[paridad: con la regla apagada nada cambia]');
const des = await res();
ok(JSON.stringify(des) === JSON.stringify(antes), 'los resultados de las tres personas son idénticos antes y después de aplicar 0061');
await as(P.ADMIN);
const cfg = (await q(`SELECT sin_tareas_pierde_puntos s, peso_tareas::float w FROM calif_config('${PE1}')`))[0];
ok(cfg.s === false && cfg.w === 20, 'calif_config() trae la regla nueva, apagada, y el peso 20 %');
await root();

console.log('\n[regla encendida: se pierden los puntos]');
await as(P.ADMIN);
await db.exec(`SELECT public.calif_config_guardar('${PE1}', 20, 1, 1, 1, true, false, 'Las tareas son un apartado con puntos propios', true)`);
await root();
const on = await res();
ok(on[P.M2].t === 0 && on[P.M2].w === 20, 'M2 (sin tareas): nota de tareas 0 y peso 20 % → ' + JSON.stringify({ t: on[P.M2].t, w: on[P.M2].w }));
ok(cerca(on[P.M2].i, 0.8 * on[P.M2].ie), `individual de M2 = 0.8·${on[P.M2].ie} = ${on[P.M2].i} (pierde el 20 % de tareas)`);
ok(cerca(on[P.M2].g, 0.8 * on[P.M2].ge), 'general de M2 = 0.8·general_eval');
ok(on[P.M2].i < antes[P.M2].i, `M2 baja: ${antes[P.M2].i} → ${on[P.M2].i}`);
ok(on[P.M2].i === on[P.M3].i, 'M3 (también sin tareas) queda igual que M2: la misma regla para todos');
ok(JSON.stringify(on[P.M1]) === JSON.stringify(antes[P.M1]), 'M1 (con tarea 8/10) NO cambia: ya tenía nota de tareas');
ok(cerca(on[P.M1].i, 0.8 * on[P.M1].ie + 0.2 * 80), 'M1 sigue = 0.8·evaluación + 0.2·80');
ok(on[P.M1].i > on[P.M2].i, 'con la misma evaluación, quien hizo la tarea queda por encima de quien no la hizo');

console.log('\n[el mínimo de tareas también cuenta]');
await as(P.ADMIN);
await db.exec(`SELECT public.calif_config_guardar('${PE1}', 20, 1, 1, 2, true, false, 'Mínimo de dos tareas', true)`);
await root();
const min2 = await res();
ok(min2[P.M1].t === 0 && cerca(min2[P.M1].i, 0.8 * min2[P.M1].ie), 'con mínimo 2 y una sola tarea, M1 tampoco llega: nota de tareas 0 (el mismo trato)');
await as(P.ADMIN);
await db.exec(`SELECT public.calif_config_guardar('${PE1}', 20, 1, 1, 1, true, false, 'Mínimo de una tarea', true)`);
await root();

console.log('\n[apagarla devuelve lo de antes]');
await as(P.ADMIN);
await db.exec(`SELECT public.calif_config_guardar('${PE1}', 20, 1, 1, 1, true, false, 'Se vuelve a la regla anterior', false)`);
await root();
const off = await res();
ok(JSON.stringify(off) === JSON.stringify(antes), 'con la regla apagada otra vez, los resultados vuelven EXACTAMENTE a los de antes');

console.log('\n[permisos y registro]');
await as(P.M1);
await rejects(`SELECT public.calif_config_guardar('${PE1}', 20, 1, 1, 1, true, false, 'Intento de miembro', true)`, 'administracion', 'un miembro no cambia la regla');
await as(P.SEC1);
await rejects(`SELECT public.calif_config_guardar('${PE1}', 20, 1, 1, 1, true, false, 'Intento de secretaría', true)`, 'administracion', 'una secretaría tampoco');
await as(null, 'anon');
await rejects(`SELECT public.calif_config_guardar('${PE1}', 20, 1, 1, 1, true, false, 'Intento anónimo', true)`, 'denied|permission', 'anon no ejecuta la función');
await as(P.ADMIN);
await rejects(`SELECT public.calif_config_guardar('${PE1}', 20, 1, 1, 1, true, false, NULL, true)`, 'motivo', 'con evaluaciones publicadas, cambiar la regla exige motivo');
await root();
const hist = await q(`SELECT (despues->>'sin_tareas_pierde_puntos')::boolean s FROM periodo_calif_config_hist WHERE periodo_id='${PE1}' ORDER BY id`);
ok(hist.length >= 4 && hist.some(h => h.s === true) && hist[hist.length - 1].s === false, 'cada cambio queda en el historial con la regla antes/después (' + hist.map(h => h.s).join(',') + ')');
const nsobre = (await q(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname='public' AND p.proname='calif_config_guardar'`))[0].n;
ok(nsobre === 1, 'solo queda una versión de calif_config_guardar (sin sobrecarga ambigua)');
fin();
