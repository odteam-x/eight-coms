// Pruebas de 0055 (Centro de auditoría: registro global + lectura unificada) contra Postgres real (PGlite), con RLS.
import { crear, montar, CADENA_BASE, sql, J } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, allowed, fin } = t;
const CADENA = [...CADENA_BASE, '0031_equipos.sql', '0032_tareas_equipo.sql', '0033_calificaciones.sql', '0034_calificacion_tareas.sql',
  '0035_resultados_integrados.sql', '0053_rectificacion_evaluaciones.sql'];
const X = await montar(t, CADENA);
const { P, PE1, PE2, G, FOTO } = X;
// La base de pruebas no trae evaluaciones_distrito: una mínima para probar su trigger.
await db.exec(`CREATE TABLE public.evaluaciones_distrito (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, periodo_id UUID, distrito_id TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador', puntajes JSONB NOT NULL DEFAULT '{}', comentarios JSONB NOT NULL DEFAULT '{}')`);

const antes = (await q('SELECT count(*)::int n FROM profiles'))[0].n;
const m = sql('0055_auditoria_global.sql');
await db.exec(m);
await db.exec(m);
console.log('— 0055 aplicada sin errores (dos veces: es idempotente)');
ok((await q('SELECT count(*)::int n FROM profiles'))[0].n === antes, 'aplicarla no toca ningún dato');
ok((await q('SELECT count(*)::int n FROM auditoria_global'))[0].n === 0, 'y no inventa historia anterior');
const lista = async (args = '') => q(`SELECT * FROM auditoria_listar(${args})`);

console.log('\n[personas: privilegios y borrado]');
await as(P.ADMIN);
await db.exec(`UPDATE profiles SET distrito='08-02' WHERE id='${P.M1}'`);
await db.exec(`UPDATE profiles SET tipo_miembro='secretario' WHERE id='${P.M5}'`);
await db.exec(`UPDATE profiles SET nombre='M1 renombrado' WHERE id='${P.M1}'`);
let r = await lista(`NULL, NULL, 'Personas'`);
ok(r.length === 2, 'un cambio de distrito y uno de tipo quedan registrados; cambiar solo el nombre NO');
const rd = r.find(x => /distrito/.test(x.resumen));
ok(rd && rd.accion === 'persona_cambio' && rd.actor_id === P.ADMIN && rd.actor_nombre === 'Admin', 'con la acción, quién y su nombre');
ok(rd.detalle.antes.distrito === '08-01' && rd.detalle.despues.distrito === '08-02', 'valor anterior y nuevo del distrito');
ok(!JSON.stringify(r).includes('@'), 'no guarda correos');
await db.exec(`DELETE FROM profiles WHERE id='${P.M4}'`);
r = await lista(`NULL, NULL, 'Personas', 'borrada'`);
ok(r.length === 1 && /M4/.test(r[0].objeto), 'borrar una persona también queda');

console.log('\n[períodos y gestiones]');
await db.exec(`UPDATE periodos_evaluacion SET activo=true WHERE id='${PE1}'`);
r = await lista(`NULL, NULL, 'Períodos', 'activado'`);
ok(r.length >= 1 && r.some(x => /PE1/.test(x.objeto)), 'activar un período queda registrado');
await root();
await db.exec(`UPDATE gestiones SET archivada=true WHERE activa`);
await as(P.ADMIN);
r = await lista(`NULL, NULL, 'Gestiones'`);
ok(r.some(x => x.accion === 'gestion_archivada' && x.actor_id === null), 'archivar una gestión sin sesión queda con actor vacío (mantenimiento)');
await root();
await db.exec(`UPDATE gestiones SET archivada=false WHERE activa`);

console.log('\n[evaluación de distrito]');
await db.exec(`INSERT INTO evaluaciones_distrito(periodo_id, distrito_id, estado, puntajes, comentarios) VALUES ('${PE1}', '08-01', 'borrador', '{"cgo":5}', '{"general":"texto privado"}')`);
await db.exec(`UPDATE evaluaciones_distrito SET estado='publicado', puntajes='{"cgo":6}' WHERE distrito_id='08-01'`);
await as(P.ADMIN);
r = await lista(`NULL, NULL, 'Distritos'`);
ok(r.length === 2 && r.some(x => x.accion === 'distrito_estado'), 'crear y publicar una evaluación de distrito quedan');
ok(!JSON.stringify(r).includes('texto privado'), 'sin los textos de los comentarios');

console.log('\n[une los historiales que ya existían]');
await root();
await db.exec(`UPDATE profiles SET rol_id=${FOTO} WHERE id='${P.M2}'`);
const perfil = (await q(`SELECT public.perfil_vigente(${FOTO}, '${PE1}') id`))[0].id;
const nuc = (await q(`SELECT key FROM criterios_v2 WHERE gestion_id=${G} AND tipo='nucleo' AND tipo_campo='escala' AND activo`)).map(x => x.key);
const tec = await q(`SELECT criterio_key k, peso FROM perfil_criterios WHERE perfil_id=${perfil}`);
const pun = f => J(Object.fromEntries([...nuc.map(k => [k, Math.round(10 * f)]), ...tec.map(x => [x.k, Math.floor(x.peso * f)])]));
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${P.M2}','${pun(0.8)}','publicado')`);
const EV = (await q(`SELECT id FROM evaluaciones WHERE evaluado_id='${P.M2}'`))[0].id;
await as(P.ADMIN);
await db.exec(`SELECT public.rectificar_evaluacion(${EV}, '${pun(0.9)}', '{}', 'Error de digitación')`);
await db.exec(`INSERT INTO tareas(periodo_id,titulo,asignada_a,fecha_limite) VALUES ('${PE1}','Cobertura','${P.M2}', current_date+5)`);
await db.exec(`SELECT public.calif_config_guardar('${PE1}', 30, 1, 1, 1, false, false, 'Acuerdo del comité')`);
r = await lista();
const por = o => r.filter(x => x.origen === o).length;
ok(por('Evaluaciones') >= 2 && por('Tareas') >= 1 && por('Reglas del PE') >= 1, 'aparecen evaluaciones (publicada y rectificada), tareas y reglas del PE en la misma lista');
const rect = r.find(x => x.accion === 'evaluacion_rectificada');
ok(rect && rect.motivo === 'Error de digitación' && /M2/.test(rect.objeto) && rect.actor_nombre === 'Admin', 'la rectificación trae motivo, persona y responsable');
ok(r.every((x, i) => i === 0 || x.creado_en <= r[i - 1].creado_en), 'ordenado de lo más reciente a lo más antiguo');

console.log('\n[filtros y páginas]');
ok((await lista(`NULL, NULL, 'Tareas'`)).every(x => x.origen === 'Tareas'), 'filtra por origen');
ok((await lista(`NULL, NULL, NULL, 'digitación'`)).length >= 1 && (await lista(`NULL, NULL, NULL, 'zzzz-no-existe'`)).length === 0, 'busca en acción, objeto, resumen, motivo y persona');
ok((await lista(`NULL, NULL, NULL, '%'`)).length === r.length, 'un % en la búsqueda no es comodín');
const tot = Number(r[0].total);
const p1 = await lista('NULL, NULL, NULL, NULL, 3, 0'), p2 = await lista('NULL, NULL, NULL, NULL, 3, 3');
ok(p1.length === 3 && Number(p1[0].total) === tot && (tot <= 3 || p2[0].id === undefined) && p2.every(x => !p1.some(y => y.creado_en === x.creado_en && y.objeto === x.objeto && y.accion === x.accion)), 'pagina sin repetir filas y dice el total');
ok((await lista('NULL, NULL, NULL, NULL, 100000, 0')).length === tot, 'el límite se acota (máx. 200)');
ok((await lista(`'2999-01-01'::timestamptz`)).length === 0, 'filtra por fecha');

console.log('\n[quién puede leer]');
await as(P.SEC1);
await rejects('SELECT * FROM auditoria_listar()', 'administracion', 'una secretaría no');
await as(P.M1);
await rejects('SELECT * FROM auditoria_listar()', 'administracion', 'un miembro no');
await rejects('SELECT * FROM auditoria_global', 'permission|denied', 'ni la tabla directa');
await as(P.ADMIN);
await rejects('SELECT * FROM auditoria_global', 'permission|denied', 'ni la administración por la tabla directa (solo por la función)');
await rejects("DELETE FROM auditoria_global", 'permission|denied', 'nadie borra la auditoría');
await rejects("INSERT INTO auditoria_global(origen, accion, objeto) VALUES ('x','y','z')", 'permission|denied', 'ni la escribe a mano');
await rejects("SELECT public._auditar('x','y','z',NULL,NULL,NULL,NULL)", 'permission|denied', 'ni llama al registro interno');
await as(null, 'anon');
await rejects('SELECT * FROM auditoria_listar()', 'permission|denied', 'anon no ejecuta la función');

console.log('\n[tolerancia: sin las migraciones de equipos/versiones]');
await root();
await db.exec('ALTER TABLE evaluaciones_versiones RENAME TO evaluaciones_versiones_x');
await as(P.ADMIN);
await allowed('SELECT * FROM auditoria_listar()', 'si falta un historial, la lista sigue funcionando con los demás');
ok((await lista()).every(x => x.origen !== 'Evaluaciones'), '...y simplemente no muestra ese origen');

fin();
