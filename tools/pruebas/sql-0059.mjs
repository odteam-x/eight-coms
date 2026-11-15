// Pruebas de 0059: evaluaciones.id es UUID en producción (el stub de las demás pruebas lo tiene BIGINT, por eso 0053 pasó
// sus pruebas y aun así falló al publicar). Aquí se convierte el id a UUID ANTES de aplicar 0053 para reproducir el defecto,
// y se comprueba que 0059 lo arregla: publicar, rectificar, retirar y leer el historial.
import { crear, montar, CADENA_BASE, sql, J } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, allowed, fin } = t;
const ANTES = [...CADENA_BASE, '0031_equipos.sql', '0032_tareas_equipo.sql', '0033_calificaciones.sql', '0034_calificacion_tareas.sql', '0035_resultados_integrados.sql'];
const X = await montar(t, ANTES);
const { P, PE1, G, FOTO } = X;

// Como producción: id UUID.
await db.exec(`ALTER TABLE evaluaciones ALTER COLUMN id DROP IDENTITY`);
await db.exec(`ALTER TABLE evaluaciones ALTER COLUMN id TYPE UUID USING gen_random_uuid()`);
await db.exec(`ALTER TABLE evaluaciones ALTER COLUMN id SET DEFAULT gen_random_uuid()`);
ok((await q(`SELECT data_type FROM information_schema.columns WHERE table_name='evaluaciones' AND column_name='id'`))[0].data_type === 'uuid', 'el escenario: evaluaciones.id es UUID, como en producción');

await db.exec(`UPDATE profiles SET rol_id=${FOTO} WHERE id IN ('${P.M1}','${P.M2}')`);
const perfil = (await q(`SELECT public.perfil_vigente(${FOTO}, '${PE1}') id`))[0].id;
const nuc = (await q(`SELECT key FROM criterios_v2 WHERE gestion_id=${G} AND tipo='nucleo' AND tipo_campo='escala' AND activo`)).map(x => x.key);
const tec = await q(`SELECT criterio_key k, peso FROM perfil_criterios WHERE perfil_id=${perfil}`);
const pun = f => J(Object.fromEntries([...nuc.map(k => [k, Math.round(10 * f)]), ...tec.map(x => [x.k, Math.floor(x.peso * f)])]));
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${P.M1}','${pun(0.8)}','borrador'), ('${PE1}','${P.M2}','${pun(0.6)}','borrador')`);
const E1 = (await q(`SELECT id FROM evaluaciones WHERE evaluado_id='${P.M1}'`))[0].id;
const E2 = (await q(`SELECT id FROM evaluaciones WHERE evaluado_id='${P.M2}'`))[0].id;

console.log('\n[el defecto: 0053 sobre ids UUID]');
await db.exec(sql('0053_rectificacion_evaluaciones.sql'));
await as(P.ADMIN);
await rejects(`UPDATE evaluaciones SET estado='publicado' WHERE id='${E1}'`, 'bigint|uuid|invalid input', 'con solo 0053, PUBLICAR falla (el síntoma que vio el usuario)');
await allowed(`UPDATE evaluaciones SET puntajes='${pun(0.7)}' WHERE id='${E1}'`, '...pero guardar un BORRADOR sigue funcionando (por eso no se notó antes)');
await root();

console.log('\n[0059 lo corrige]');
const m = sql('0059_evaluaciones_versiones_uuid.sql');
await db.exec(m);
ok(true, '0059 se aplica sin errores');
await db.exec(m);
ok(true, 'reaplicar 0059 es idempotente');
ok((await q(`SELECT data_type FROM information_schema.columns WHERE table_name='evaluaciones_versiones' AND column_name='evaluacion_id'`))[0].data_type === 'uuid', 'evaluaciones_versiones.evaluacion_id ahora es UUID');
ok((await q(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname='public' AND p.proname IN ('rectificar_evaluacion','retirar_evaluacion','evaluacion_versiones')`))[0].n === 3, 'quedan solo las tres funciones (sin sobrecarga BIGINT)');

await as(P.ADMIN);
await allowed(`UPDATE evaluaciones SET estado='publicado' WHERE id='${E1}'`, 'PUBLICAR funciona');
await allowed(`UPDATE evaluaciones SET estado='publicado' WHERE id='${E2}'`, 'publicar otra también');
await root();
const h = await q(`SELECT evaluacion_id::text, accion, version FROM evaluaciones_versiones WHERE evaluacion_id='${E1}'`);
ok(h.length === 1 && h[0].accion === 'publicada' && h[0].version === 1 && h[0].evaluacion_id === E1, 'la publicación queda registrada con el id UUID (versión 1)');

await as(P.ADMIN);
const rv = (await q(`SELECT public.rectificar_evaluacion('${E1}', '${pun(0.9)}', '{}', 'Corrección de prueba') v`))[0].v;
ok(rv === 2, 'rectificar con un id UUID devuelve la versión 2');
const rt = (await q(`SELECT public.retirar_evaluacion('${E2}', 'Retirada de prueba') v`))[0].v;
ok(rt === 2 && (await q(`SELECT estado FROM evaluaciones WHERE id='${E2}'`))[0].estado === 'borrador', 'retirar con un id UUID la devuelve a borrador (versión 2)');
const hist = await q(`SELECT accion FROM public.evaluacion_versiones('${E1}') ORDER BY id`);
ok(hist.map(x => x.accion).join() === 'publicada,rectificada', 'evaluacion_versiones(uuid) lista el historial: ' + hist.map(x => x.accion).join());
await as(P.M1);
await rejects(`SELECT public.rectificar_evaluacion('${E1}', '${pun(0.5)}', '{}', 'Intento de miembro')`, 'administracion', 'un miembro sigue sin poder rectificar');
await as(null, 'anon');
await rejects(`SELECT public.rectificar_evaluacion('${E1}', '${pun(0.5)}', '{}', 'Intento anónimo')`, 'denied|permission', 'ni anon');
await root();
fin();
