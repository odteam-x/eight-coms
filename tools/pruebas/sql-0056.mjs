// Pruebas de 0056 (cobertura de una evaluación: criterios puntuados de los que aplicaban), contra Postgres real (PGlite), con RLS.
import { crear, montar, CADENA_BASE, sql, J } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, allowed, fin } = t;
const CADENA = [...CADENA_BASE, '0031_equipos.sql', '0032_tareas_equipo.sql', '0033_calificaciones.sql', '0034_calificacion_tareas.sql', '0035_resultados_integrados.sql'];
const X = await montar(t, CADENA);
const { P, PE1, G, FOTO } = X;

await db.exec(`UPDATE profiles SET rol_id=${FOTO} WHERE id IN ('${P.M1}','${P.M2}','${P.M3}')`);
const perfil = (await q(`SELECT public.perfil_vigente(${FOTO}, '${PE1}') id`))[0].id;
const nuc = (await q(`SELECT key FROM criterios_v2 WHERE gestion_id=${G} AND tipo='nucleo' AND tipo_campo='escala' AND activo ORDER BY orden`)).map(x => x.key);
const tec = await q(`SELECT criterio_key k, peso FROM perfil_criterios WHERE perfil_id=${perfil} ORDER BY criterio_key`);
const nTec = tec.length, nNuc = nuc.length;
const pesoTot = tec.reduce((a, x) => a + Number(x.peso), 0);
const completo = J(Object.fromEntries([...nuc.map(k => [k, 8]), ...tec.map(x => [x.k, Math.floor(x.peso * 0.8)])]));
// Un criterio núcleo y uno técnico pasan a opcionales: se puede publicar sin puntuarlos (regla de 0020/0023).
const nucOpc = nuc[0], tecOpc = tec[0];
await db.exec(`UPDATE criterios_v2 SET obligatorio=false WHERE gestion_id=${G} AND key IN ('${nucOpc}','${tecOpc.k}')`);
const incompleto = J(Object.fromEntries([...nuc.filter(k => k !== nucOpc).map(k => [k, 8]), ...tec.filter(x => x.k !== tecOpc.k).map(x => [x.k, Math.floor(x.peso * 0.8)])]));
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES
  ('${PE1}','${P.M1}','${completo}','publicado'), ('${PE1}','${P.M2}','${incompleto}','publicado'), ('${PE1}','${P.M3}','${completo}','borrador')`);

const antes = JSON.stringify(await (async () => { await as(P.ADMIN); const r = await q(`SELECT evaluado_id, individual, general FROM resultados_periodo('${PE1}', true) ORDER BY evaluado_id`); await root(); return r; })());
const m = sql('0056_cobertura_evaluacion.sql');
await db.exec(m);
await db.exec(m);
console.log('— 0056 aplicada sin errores (dos veces: es idempotente)');
await as(P.ADMIN);
ok(JSON.stringify(await q(`SELECT evaluado_id, individual, general FROM resultados_periodo('${PE1}', true) ORDER BY evaluado_id`)) === antes, 'aplicarla no cambia ningún resultado');
await root();
const cob = async (persona, quien) => { await as(quien); const r = await q(`SELECT * FROM evaluacion_cobertura('${PE1}', '${persona}')`); await root(); return r; };

console.log('\n[evaluación completa]');
let r = (await cob(P.M1, P.ADMIN))[0];
ok(r && r.nucleo_aplicables === nNuc && r.nucleo_puntuados === nNuc && r.tecnico_aplicables === nTec && r.tecnico_puntuados === nTec, `núcleo ${nNuc} de ${nNuc} y técnicos ${nTec} de ${nTec}`);
ok(Number(r.peso_tecnico) === pesoTot && Number(r.peso_puntuado) === pesoTot, 'peso técnico puntuado = el total (un perfil suma 100)');

console.log('\n[evaluación con criterios sin puntuar (opcionales)]');
r = (await cob(P.M2, P.ADMIN))[0];
ok(r.nucleo_aplicables === nNuc && r.nucleo_puntuados === nNuc - 1, `núcleo ${nNuc - 1} de ${nNuc}`);
ok(r.tecnico_aplicables === nTec && r.tecnico_puntuados === nTec - 1, `técnicos ${nTec - 1} de ${nTec}`);
ok(Number(r.peso_puntuado) === pesoTot - Number(tecOpc.peso) && Number(r.peso_tecnico) === pesoTot, `peso puntuado ${pesoTot - Number(tecOpc.peso)} de ${pesoTot}: lo no puntuado se EXCLUYE, no vale 0`);
ok((await cob(P.M2, P.M2))[0]?.tecnico_puntuados === nTec - 1, 'la propia persona ve la suya');

console.log('\n[quién puede verla]');
ok((await cob(P.M1, P.M2)).length === 0, 'un miembro no ve la cobertura de otro');
ok((await cob(P.M1, P.SEC1)).length === 1, 'la secretaría ve la de su distrito');
ok((await cob(P.M3, P.SEC2)).length === 0, 'y no la de otro distrito (ni un borrador)');
ok((await cob(P.M3, P.M3)).length === 0, 'un borrador no se muestra a la propia persona');
ok((await cob(P.M3, P.ADMIN)).length === 1 && (await cob(P.M3, P.ADMIN))[0].estado === 'borrador', 'la administración sí ve el borrador');
ok((await cob(P.M4, P.ADMIN)).length === 0, 'sin evaluación: nada');
await as(null, 'anon');
await rejects(`SELECT * FROM evaluacion_cobertura('${PE1}', '${P.M1}')`, 'denied|permission', 'anon no ejecuta la función');
await as(P.ADMIN, 'authenticated');
await db.exec(`SELECT set_config('request.jwt.claim.sub','',false)`);
await rejects(`SELECT * FROM evaluacion_cobertura('${PE1}', '${P.M1}')`, 'iniciar sesion', 'sin sesión: error');

fin();
