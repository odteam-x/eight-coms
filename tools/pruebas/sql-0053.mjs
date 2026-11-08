// Pruebas de 0053 (evaluaciones publicadas: versión, rectificación con motivo, registro).
// Incluye la PARIDAD: aplicar 0053 sobre datos existentes no cambia ningún resultado publicado.
import { crear, montar, CADENA_BASE, sql, J } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, allowed, fin } = t;
const ANTES = [...CADENA_BASE, '0031_equipos.sql', '0032_tareas_equipo.sql', '0033_calificaciones.sql', '0034_calificacion_tareas.sql', '0035_resultados_integrados.sql'];
const X = await montar(t, ANTES);
const { P, PE1, PE2, ARCH, G, FOTO } = X;

// Datos previos: dos evaluaciones PUBLICADAS y una en borrador, ANTES de 0053.
await db.exec(`UPDATE profiles SET rol_id=${FOTO} WHERE id IN ('${P.M1}','${P.M2}','${P.M3}')`);
const perfil = (await q(`SELECT public.perfil_vigente(${FOTO}, '${PE1}') id`))[0].id;
const nuc = (await q(`SELECT key FROM criterios_v2 WHERE gestion_id=${G} AND tipo='nucleo' AND tipo_campo='escala' AND activo`)).map(x => x.key);
const tec = await q(`SELECT criterio_key k, peso FROM perfil_criterios WHERE perfil_id=${perfil}`);
const pun = f => J(Object.fromEntries([...nuc.map(k => [k, Math.round(10 * f)]), ...tec.map(x => [x.k, Math.floor(x.peso * f)])]));
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES
  ('${PE1}','${P.M1}','${pun(0.8)}','publicado'), ('${PE1}','${P.M2}','${pun(0.6)}','publicado'), ('${PE1}','${P.M3}','${pun(0.5)}','borrador')`);
await as(P.ADMIN);
const foto = async () => JSON.stringify(await q(`SELECT evaluado_id, nucleo, tecnico, individual, percentil, general, estado FROM resultados_periodo('${PE1}', true) ORDER BY evaluado_id`));
const antes = await foto();
const mismo = (a, b) => { const n = o => JSON.stringify(Object.entries(o || {}).sort(([x], [y]) => x < y ? -1 : 1)); return n(a) === n(b); };
await root();

console.log('[paridad: aplicar 0053 no cambia ningún resultado]');
await db.exec(sql('0053_rectificacion_evaluaciones.sql'));
console.log('— 0053 aplicada sin errores');
await db.exec(sql('0053_rectificacion_evaluaciones.sql'));
ok(true, 'reaplicar 0053 es idempotente');
await as(P.ADMIN);
ok(await foto() === antes, 'los resultados (publicados y borrador) son idénticos antes y después');
await root();
ok((await q(`SELECT count(*)::int n FROM evaluaciones WHERE version=1`))[0].n === 3, 'las evaluaciones existentes quedan en versión 1');
ok((await q(`SELECT count(*)::int n FROM evaluaciones_versiones`))[0].n === 0, 'sin historial inventado para lo anterior');
const E1 = (await q(`SELECT id FROM evaluaciones WHERE evaluado_id='${P.M1}'`))[0].id;
const E3 = (await q(`SELECT id FROM evaluaciones WHERE evaluado_id='${P.M3}'`))[0].id;

console.log('\n[una publicada ya no se toca por la vía directa]');
await as(P.ADMIN);
await rejects(`UPDATE evaluaciones SET puntajes='${pun(0.1)}' WHERE id=${E1}`, 'rectificar_evaluacion', 'ni la administración cambia puntajes por UPDATE directo');
await rejects(`UPDATE evaluaciones SET estado='borrador' WHERE id=${E1}`, 'rectificar_evaluacion', 'ni la devuelve a borrador');
await rejects(`UPDATE evaluaciones SET comentarios='{"general":"x"}' WHERE id=${E1}`, 'rectificar_evaluacion', 'ni cambia los comentarios');
await rejects(`DELETE FROM evaluaciones WHERE id=${E1}`, 'retirar_evaluacion', 'ni la borra');
await rejects(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${P.M1}','${pun(0.1)}','publicado') ON CONFLICT (periodo_id,evaluado_id) DO UPDATE SET puntajes=EXCLUDED.puntajes`, 'rectificar_evaluacion', 'ni con un upsert (el camino del front antiguo)');
await allowed(`UPDATE evaluaciones SET evaluador_id='${P.ADMIN}' WHERE id=${E1}`, 'tocarla sin cambiar su contenido sí pasa (un upsert idéntico no rompe nada)');
await allowed(`UPDATE evaluaciones SET puntajes='${pun(0.3)}' WHERE id=${E3}`, 'un BORRADOR se sigue editando directo');
await as(P.M1);
try { await db.exec(`UPDATE evaluaciones SET puntajes='${pun(0.1)}' WHERE id=${E1}`); } catch { /* también vale que la base lo rechace */ }
await root();
ok(true, 'un miembro intenta cambiarla: rechazado por la base o sin filas (RLS)');
ok((await q(`SELECT count(*)::int n FROM evaluaciones WHERE id=${E1} AND version=1 AND rectificada_en IS NULL`))[0].n === 1, '...y la evaluación sigue intacta');

console.log('\n[rectificar: motivo, versión, antes/después, resultado]');
await as(P.SEC1);
await rejects(`SELECT public.rectificar_evaluacion(${E1}, '${pun(0.9)}', '{}', 'Corrección de prueba')`, 'administracion', 'una secretaría no rectifica');
await as(P.M1);
await rejects(`SELECT public.rectificar_evaluacion(${E1}, '${pun(0.9)}', '{}', 'Corrección de prueba')`, 'administracion', 'un miembro no rectifica');
await as(null, 'anon');
await rejects(`SELECT public.rectificar_evaluacion(${E1}, '${pun(0.9)}', '{}', 'Corrección de prueba')`, 'denied|permission', 'anon no ejecuta la función');
await as(P.ADMIN);
await rejects(`SELECT public.rectificar_evaluacion(${E1}, '${pun(0.9)}', '{}', '')`, 'motivo', 'sin motivo no se rectifica');
await rejects(`SELECT public.rectificar_evaluacion(${E1}, '${pun(0.9)}', '{}', 'abc')`, 'motivo', 'un motivo de 3 letras tampoco');
await rejects(`SELECT public.rectificar_evaluacion(${E3}, '${pun(0.9)}', '{}', 'Corrección de prueba')`, 'publicada', 'un borrador no se rectifica (se edita)');
await rejects(`SELECT public.rectificar_evaluacion(${E1}, '${pun(0.8)}', (SELECT comentarios FROM evaluaciones WHERE id=${E1}), 'Sin ningún cambio real')`, 'No hay cambios', 'sin cambios reales se rechaza');
const antesM1 = (await q(`SELECT individual::float i FROM resultados_periodo('${PE1}') WHERE evaluado_id='${P.M1}'`))[0].i;
const r = (await q(`SELECT public.rectificar_evaluacion(${E1}, '${pun(0.9)}', '{"general":"Revisión del comité"}', 'Error de digitación en la cuarta competencia') v`))[0].v;
ok(r === 2, 'rectificar devuelve la versión 2');
await root();
const ev = (await q(`SELECT version, rectificada_por, estado FROM evaluaciones WHERE id=${E1}`))[0];
ok(ev.version === 2 && ev.rectificada_por === P.ADMIN && ev.estado === 'publicado', 'queda en versión 2, con responsable, y SIGUE publicada');
const h = await q(`SELECT * FROM evaluaciones_versiones WHERE evaluacion_id=${E1} ORDER BY id`);
ok(h.length === 1 && h[0].accion === 'rectificada' && h[0].version === 2, 'una fila de historial: rectificada, versión 2');
ok(h[0].motivo === 'Error de digitación en la cuarta competencia' && h[0].actor === P.ADMIN, 'con motivo y responsable');
ok(mismo(h[0].antes.puntajes, JSON.parse(pun(0.8))) && mismo(h[0].despues.puntajes, JSON.parse(pun(0.9))), 'guarda los puntajes ANTERIORES y los NUEVOS');
ok(h[0].antes.comentarios && h[0].despues.comentarios.general === 'Revisión del comité', 'y los comentarios antes/después');
ok(h[0].resultado_antes && h[0].resultado_despues && Number(h[0].resultado_antes.individual) === antesM1 && Number(h[0].resultado_despues.individual) > antesM1, 'y el RESULTADO calculado antes y después (efecto en los reportes)');
await as(P.ADMIN);
ok((await q(`SELECT individual::float i FROM resultados_periodo('${PE1}') WHERE evaluado_id='${P.M1}'`))[0].i === Number(h[0].resultado_despues.individual), 'los reportes leen la versión vigente');

console.log('\n[historial: solo administración, solo por la función]');
ok((await q(`SELECT count(*)::int n FROM evaluacion_versiones(${E1})`))[0].n === 1, 'la administración lee el historial');
await as(P.M1);
await rejects(`SELECT * FROM evaluacion_versiones(${E1})`, 'administracion', 'un miembro no lo lee por la función');
await rejects(`SELECT * FROM evaluaciones_versiones`, 'denied|permission', 'ni por la tabla');
await as(P.SEC1);
await rejects(`SELECT * FROM evaluaciones_versiones`, 'denied|permission', 'una secretaría tampoco');
await as(P.ADMIN);
await rejects(`INSERT INTO evaluaciones_versiones(evaluacion_id,periodo_id,evaluado_id,version,accion) VALUES (1,'${PE1}','${P.M1}',9,'rectificada')`, 'denied|permission', 'nadie escribe el historial a mano (ni la administración)');
await rejects(`DELETE FROM evaluaciones_versiones`, 'denied|permission', 'ni lo borra');

console.log('\n[retirar y volver a publicar]');
await rejects(`SELECT public.retirar_evaluacion(${E1}, '')`, 'motivo', 'retirar exige motivo');
const rv = (await q(`SELECT public.retirar_evaluacion(${E1}, 'Se evaluó a la persona equivocada') v`))[0].v;
ok(rv === 3, 'retirar → versión 3');
ok((await q(`SELECT count(*)::int n FROM resultados_periodo('${PE1}') WHERE evaluado_id='${P.M1}'`))[0].n === 0, 'una evaluación retirada deja de contar (solo cuentan las publicadas)');
await allowed(`UPDATE evaluaciones SET estado='publicado' WHERE id=${E1}`, 'se vuelve a publicar con el UPDATE de siempre');
await root();
const h2 = await q(`SELECT accion, version FROM evaluaciones_versiones WHERE evaluacion_id=${E1} ORDER BY id`);
ok(JSON.stringify(h2.map(x => x.accion + x.version)) === JSON.stringify(['rectificada2', 'retirada3', 'publicada3']), 'historial: rectificada v2 → retirada v3 → publicada v3');

console.log('\n[publicar por primera vez registra la versión]');
await as(P.ADMIN);
await allowed(`UPDATE evaluaciones SET estado='publicado' WHERE id=${E3}`, 'publicar el borrador de M3');
await root();
const h3 = await q(`SELECT accion, version, antes, despues->>'estado' e FROM evaluaciones_versiones WHERE evaluacion_id=${E3}`);
ok(h3.length === 1 && h3[0].accion === 'publicada' && h3[0].version === 1 && h3[0].antes === null && h3[0].e === 'publicado', 'una fila «publicada», versión 1');
ok((await q(`SELECT publicada_en IS NOT NULL ok FROM evaluaciones WHERE id=${E3}`))[0].ok, 'con la fecha de publicación');

console.log('\n[el upsert del front (INSERT … ON CONFLICT DO UPDATE) registra UNA sola vez, con el id correcto]');
await root();
await db.exec(`UPDATE profiles SET rol_id=${FOTO} WHERE id='${P.M5}'`);
await as(P.ADMIN);
const up = (estado, f = 0.7) => db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${P.M5}','${pun(f)}','${estado}') ON CONFLICT (periodo_id,evaluado_id) DO UPDATE SET puntajes=EXCLUDED.puntajes, estado=EXCLUDED.estado`);
await up('borrador');
await up('publicado');
await root();
const E5 = (await q(`SELECT id FROM evaluaciones WHERE evaluado_id='${P.M5}'`))[0].id;
const n5 = async () => q(`SELECT evaluacion_id, accion, version FROM evaluaciones_versiones WHERE evaluado_id='${P.M5}'`);
let h5 = await n5();
ok(h5.length === 1 && h5[0].accion === 'publicada' && h5[0].version === 1 && h5[0].evaluacion_id === E5, 'borrador → publicado por upsert deja UNA fila «publicada», con el id de la evaluación real (no uno inexistente)');
await as(P.ADMIN);
await up('publicado');
await root();
ok((await n5()).length === 1, 'un upsert idéntico sobre una publicada no inventa historia');
await as(P.ADMIN);
await rejects(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${P.M5}','${pun(0.2)}','publicado') ON CONFLICT (periodo_id,evaluado_id) DO UPDATE SET puntajes=EXCLUDED.puntajes`, 'rectificar_evaluacion', 'y uno que cambia puntajes sigue rechazado');
await root();
ok((await n5()).length === 1, '...sin dejar historia del intento (la transacción se deshace)');

console.log('\n[gestión archivada y mantenimiento]');
await db.exec(`UPDATE profiles SET rol_id=${FOTO} WHERE id='${P.M4}'`);
await db.exec('ALTER TABLE evaluaciones DISABLE TRIGGER USER');   // la gestión archivada de la prueba no tiene perfiles
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${ARCH}','${P.M4}','${pun(0.7)}','publicado')`);
await db.exec('ALTER TABLE evaluaciones ENABLE TRIGGER USER');
const EA = (await q(`SELECT id FROM evaluaciones WHERE periodo_id='${ARCH}'`))[0].id;
await as(P.ADMIN);
await rejects(`SELECT public.rectificar_evaluacion(${EA}, '${pun(0.9)}', '{}', 'Corrección en gestión archivada')`, 'archivada', 'una gestión archivada es solo lectura también para rectificar');
await rejects(`SELECT public.retirar_evaluacion(${EA}, 'Retiro en gestión archivada')`, 'archivada', 'y para retirar');
await root();
await allowed(`UPDATE evaluaciones SET puntajes='${pun(0.2)}' WHERE id=${E1}`, 'sin sesión (SQL Editor / mantenimiento) el cambio pasa...');
const hm = (await q(`SELECT accion, motivo, actor, version FROM evaluaciones_versiones WHERE evaluacion_id=${E1} ORDER BY id DESC LIMIT 1`))[0];
ok(hm.accion === 'rectificada' && /mantenimiento/.test(hm.motivo) && hm.actor === null && hm.version === 4, '...pero deja rastro (sin responsable, versión 4)');
await allowed(`DELETE FROM evaluaciones WHERE id=${EA}`, 'sin sesión se puede borrar (mantenimiento); un cliente no');

fin();
