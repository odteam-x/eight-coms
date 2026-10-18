// Pruebas de 0041 (avisos de equipos, tareas colectivas y calificaciones) de extremo a extremo: el esquema REAL de
// 0031–0036 de la sesión A + 0019/0022/0040, con RLS (SET ROLE). Cada operación de negocio se hace como lo haría la
// persona, y se comprueba quién recibió qué aviso y quién NO.
import { crear, montar, CADENA_BASE, sql, R } from './base-eq.mjs';
import fs from 'node:fs';

const t = crear();
const { db, ok, rejects, allowed, fin } = t;
let ultimo = null;   // sesión activa: leer la cola (superusuario) no debe cambiar quién hace las operaciones siguientes
// q lee como superusuario (las tablas de avisos están cerradas al cliente) y devuelve la sesión a quien estaba.
const q = async (sqltxt) => { const cerrado = /notificaciones|notif_tipos|notif_pref/.test(sqltxt) && !/mis_notificaciones/.test(sqltxt); if (cerrado) await t.root(); const r = await t.q(sqltxt); if (cerrado && ultimo) await t.as(...ultimo); return r; };
const as = async (u, r = 'authenticated') => { ultimo = [u, r]; await t.as(u, r); };
const root = async () => { ultimo = null; await t.root(); };
const X = await montar(t, [...CADENA_BASE, '0031_equipos.sql', '0032_tareas_equipo.sql', '0033_calificaciones.sql', '0034_calificacion_tareas.sql', '0035_resultados_integrados.sql', '0036_equipos_vistas.sql']);
const { P, PE1 } = X;

// 0019 como en producción (sin pg_cron/pg_net) + disparadores de tareas, 0022 y 0040.
const m19 = sql('0019_notificaciones.sql');
const fn19 = n => { const i = m19.indexOf(`CREATE OR REPLACE FUNCTION public.${n}(`); const a = m19.indexOf('$$', i), b = m19.indexOf('$$', a + 2); return m19.slice(i, m19.indexOf(';', b) + 1); };
await db.exec(m19.match(/CREATE TABLE IF NOT EXISTS public\.notificaciones \([\s\S]*?\n\);/)[0] + `ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.notificaciones FROM anon, authenticated;
  CREATE ROLE service_role NOLOGIN; GRANT USAGE ON SCHEMA public TO service_role;`);
for (const f of ['notif_fecha', 'notif_zona', 'notif_encolar', 'notif_revisores', 'notif_trg_tarea', 'notif_generar_recordatorios']) await db.exec(fn19(f));
await db.exec(`CREATE TRIGGER notif_tarea AFTER INSERT OR UPDATE ON public.tareas FOR EACH ROW EXECUTE FUNCTION public.notif_trg_tarea();
  REVOKE EXECUTE ON FUNCTION public.notif_trg_tarea(), public.notif_encolar(UUID,TEXT,JSONB,TEXT,TIMESTAMPTZ), public.notif_revisores(UUID), public.notif_zona(), public.notif_generar_recordatorios() FROM PUBLIC, anon, authenticated;`);
await db.exec(sql('0022_notificaciones_app.sql'));
await db.exec(sql('0040_notificaciones_integral.sql'));
const m41 = sql('0041_avisos_equipos_calificaciones.sql');
await db.exec(m41);
await db.exec(m41);
console.log('— 0041 aplicada sin errores (dos veces: es idempotente)');
ok((await q(`SELECT count(*)::int n FROM pg_trigger WHERE tgname LIKE 'zz_notif_%'`))[0].n === 3, 'quedan instalados los 3 disparadores (equipo_eventos, tarea_equipo_eventos, calificaciones_historial)');

// Lee la cola como superusuario y devuelve el rol de la sesión que estaba activa (para no alterar el flujo).
const leer = async (sqltxt) => { const r = await db.query(sqltxt); return r.rows; };
const avisos = async (cond = 'true') => { await t.root(); const r = (await leer(`SELECT n.id, n.tipo, n.destinatario_id d, n.datos, n.ref_tipo, n.ref_id FROM notificaciones n WHERE ${cond} ORDER BY n.id`)); if (ultimo) await t.as(...ultimo); return r; };
const para = async tipo => (await avisos(`tipo='${tipo}'`)).map(a => a.d).sort();
const eq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const limpiar = async () => { await root(); await db.exec(`DELETE FROM notificaciones`); };
const mkEquipo = async (nombre, miembros, dist = null) => {
  await as(P.ADMIN);
  const id = (await q(`SELECT public.equipo_guardar(NULL, '${PE1}', '${nombre}', '', NULL, ${dist ? `'${dist}'` : 'NULL'}) id`))[0].id;
  await db.exec(`SELECT public.equipo_agregar_miembros(${id}, ARRAY[${miembros.map(m => `'${m}'`).join(',')}]::uuid[], true, 'Prueba de excepción de ámbito')`);
  return id;
};

console.log('\n[equipos: incorporación y retiro]');
await limpiar();
const E1 = await mkEquipo('Cobertura', [P.M1, P.M2, P.M5], '08-01');
let a = await avisos(`tipo='equipo_incorporado'`);
ok(eq(a.map(x => x.d), [P.M1, P.M2, P.M5]), 'incorporar a 3 personas avisa a esas 3, a nadie más (ni a la administración que lo hizo)');
ok(a.every(x => x.ref_tipo === 'equipo' && x.ref_id === String(E1) && x.datos.equipo === 'Cobertura' && x.datos.agregado_por === 'Admin'), 'cada aviso enlaza al equipo y dice quién la incorporó');
ok((await q(`SELECT count(*)::int n FROM notificaciones_eventos WHERE evento='rechazado'`))[0].n === 0, 'ninguna emisión fue rechazada (todos los datos y destinatarias son válidos)');
await as(P.ADMIN);
await db.exec(`SELECT public.equipo_retirar_miembro(${E1}, '${P.M5}', 'Cambió de proyecto')`);
a = await avisos(`tipo='equipo_retiro'`);
ok(a.length === 1 && a[0].d === P.M5 && a[0].datos.motivo === 'Cambió de proyecto' && a[0].datos.retirado_por === 'Admin', 'retirar a M5 la avisa solo a ella, con el motivo');
await root();
await db.exec(`INSERT INTO equipo_eventos(equipo_id, actor_id, tipo, persona_id, motivo) VALUES (${E1}, '${P.M2}', 'miembro_baja', '${P.M2}', 'Me retiro yo')`);
ok((await avisos(`tipo='equipo_retiro' AND destinatario_id='${P.M2}'`)).length === 0, 'si la persona se retira sola, no se avisa a sí misma');
await as(P.ADMIN);
await db.exec(`SELECT public.equipo_cambiar_estado(${E1}, 'inactivo', 'Pausa de la jornada')`);
await db.exec(`SELECT public.equipo_cambiar_estado(${E1}, 'activo', 'Se retoma')`);
a = await avisos(`tipo='estado_cambiado' AND datos->>'objeto'='Equipo'`);
ok(a.length >= 2 && eq([...new Set(a.map(x => x.d))], [P.M1, P.M2]), 'cambiar el estado del equipo avisa a sus integrantes vigentes (M1, M2; no a M5 que ya salió)');

console.log('\n[tarea colectiva: asignación, cambios, entrega, corrección]');
await limpiar();
await as(P.ADMIN);
const T1 = (await q(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo,descripcion,fecha_limite,responsable_id,prioridad) VALUES (${E1},'${PE1}','Reel de la jornada','x', current_date+5, '${P.M1}','alta') RETURNING id`))[0].id;
a = await avisos(`tipo='tarea_colectiva_asignada'`);
ok(eq(a.map(x => x.d), [P.M1, P.M2]), 'asignar una tarea al equipo avisa a sus integrantes vigentes (M1 y M2), no a M5 (retirada) ni a la administración');
ok(a.every(x => x.ref_tipo === 'tarea_equipo' && x.ref_id === String(T1) && x.datos.equipo === 'Cobertura' && x.datos.responsable === 'M1' && x.datos.asignador === 'Admin'), 'enlazan a la tarea de equipo con equipo, responsable y quién la asignó');
await limpiar();
await as(P.ADMIN);
await db.exec(`SELECT public.tarea_equipo_prorrogar(${T1}, current_date + 9, 'El evento se movió')`);
a = await avisos(`tipo='tarea_cambio'`);
ok(eq(a.map(x => x.d), [P.M1, P.M2]) && a[0].datos.cambio === 'Fecha límite' && a[0].datos.motivo === 'El evento se movió' && a[0].datos.antes && a[0].datos.ahora, 'prorrogar avisa a los integrantes con antes/ahora y el motivo');
await limpiar();
await as(P.ADMIN);
await db.exec(`UPDATE tareas_equipo SET instrucciones='Ahora con subtítulos' WHERE id=${T1}`);
a = await avisos(`tipo='tarea_cambio'`);
ok(a.length === 2 && a.every(x => x.datos.cambio === 'Instrucciones'), 'cambiar las instrucciones avisa a los integrantes');
await db.exec(`UPDATE tareas_equipo SET responsable_id='${P.M2}' WHERE id=${T1}`);
a = await avisos(`tipo='tarea_cambio' AND datos->>'cambio'='Responsable'`);
ok(a.length >= 1 && a.every(x => [P.M1, P.M2].includes(x.d)) && a[0].datos.ahora === 'M2', 'cambiar el responsable avisa a los integrantes y dice quién es ahora');
await limpiar();
await as(P.M1);
await db.exec(`UPDATE tareas_equipo SET estado='en_curso' WHERE id=${T1}`);
ok((await avisos()).length === 0, 'ponerla «en curso» no genera ruido');
await db.exec(`UPDATE tareas_equipo SET estado='entregada', entrega_nota='Primera entrega del reel' WHERE id=${T1}`);
a = await avisos(`tipo='entrega_registrada'`);
ok(eq(a.map(x => x.d), [P.ADMIN, P.SEC1, P.M2]), 'la entrega avisa a quien revisa: administración, secretaría del distrito del equipo (08-01) y la responsable de seguimiento (M2)');
ok(!a.some(x => [P.M1, P.SEC2, P.M5, P.M4].includes(x.d)), 'y NO a quien entregó, a otra secretaría ni a quien no pertenece');
await limpiar();
await as(P.SEC1);
await db.exec(`UPDATE tareas_equipo SET estado='devuelta', revision_nota='Falta el audio' WHERE id=${T1}`);
a = await avisos(`tipo='correccion_solicitada'`);
ok(eq(a.map(x => x.d), [P.M1, P.M2]) && a[0].datos.observacion === 'Falta el audio' && a[0].datos.revisor === 'Sec1', 'devolverla avisa a los integrantes con la observación y quién la pidió');
await limpiar();
await as(P.M2);
await db.exec(`UPDATE tareas_equipo SET estado='en_curso' WHERE id=${T1}`);
await db.exec(`UPDATE tareas_equipo SET estado='entregada', entrega_nota='Segunda entrega con audio' WHERE id=${T1}`);
ok(eq((await avisos(`tipo='entrega_registrada'`)).map(x => x.d), [P.ADMIN, P.SEC1]), 'una segunda ronda de revisión genera sus propios avisos (la clave incluye la ronda); M2, que entregó y es la responsable, no se avisa a sí misma');
await limpiar();
await as(P.ADMIN);
await db.exec(`UPDATE tareas_equipo SET estado='aprobada', puntos=8 WHERE id=${T1}`);
a = await avisos();
ok(eq(a.filter(x => x.tipo === 'calificacion_nueva').map(x => x.d), [P.M1, P.M2]), 'aprobar con nota avisa «calificación nueva» a los integrantes');
ok(!a.some(x => x.tipo === 'tarea_aprobada'), 'sin duplicar con «tarea aprobada» (una sola notificación por hecho)');
ok(!JSON.stringify(a).match(/"puntos|puntaje|\b8\b/) && a[0].datos.actividad === 'Reel de la jornada', 'el aviso NO lleva la nota: solo la actividad, el equipo y el evaluador');
await limpiar();
await as(P.ADMIN);
await db.exec(`SELECT public.corregir_nota_tarea('equipo', ${T1}, 9, 'La entrega incluía el material extra')`);
a = await avisos(`tipo='calificacion_cambiada'`);
ok(eq(a.map(x => x.d), [P.M1, P.M2]), 'corregir la nota del grupo avisa «calificación modificada» a los integrantes');
ok(!JSON.stringify(a).includes('material extra'), 'sin el motivo ni los puntos en el aviso');

console.log('\n[nota individual dentro del grupo: solo esa persona]');
await limpiar();
const ni = await q(`SELECT proname, pg_get_function_identity_arguments(oid) a FROM pg_proc WHERE proname='nota_individual_equipo'`);
await as(P.ADMIN);
try {
  await db.exec(`SELECT public.nota_individual_equipo(${T1}, '${P.M1}', 10, 'Cargó con el montaje y la edición final')`);
  a = await avisos(`tipo='calificacion_cambiada'`);
  ok(a.length === 1 && a[0].d === P.M1, 'la nota individual avisa solo a esa persona (' + ni[0]?.a + ')');
} catch (e) { ok(false, 'nota_individual_equipo: ' + e.message.slice(0, 120)); }

console.log('\n[tarea individual: sin avisos duplicados]');
await limpiar();
await as(P.ADMIN);
const I1 = (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,fecha_limite) VALUES ('${PE1}','Individual','${P.M4}',current_date+4) RETURNING id`))[0].id;
await as(P.M4);
await db.exec(`UPDATE tareas SET estado='en_curso' WHERE id=${I1}`);
await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='listo' WHERE id=${I1}`);
await as(P.ADMIN);
await db.exec(`UPDATE tareas SET estado='aprobada', puntos=7 WHERE id=${I1}`);
a = await avisos(`destinatario_id='${P.M4}'`);
ok(a.filter(x => x.tipo === 'tarea_aprobada').length === 1 && !a.some(x => x.tipo === 'calificacion_nueva'), 'aprobar una tarea individual: UN aviso «aprobada» y ningún «calificación nueva» duplicado');
await db.exec(`SELECT public.corregir_nota_tarea('individual', ${I1}, 9, 'Se reconoció el trabajo extra')`);
a = await avisos(`tipo='calificacion_cambiada'`);
ok(a.length === 1 && a[0].d === P.M4 && a[0].ref_tipo === 'tarea' && a[0].ref_id === String(I1), 'corregir la nota individual avisa solo a la persona, enlazando a su tarea');

console.log('\n[comentarios: observación nueva sin el texto]');
await limpiar();
const T2 = (await q(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo,fecha_limite) VALUES (${E1},'${PE1}','Guion','current_date+6') RETURNING id`).catch(() => []))[0]?.id;
await as(P.ADMIN);
const T3 = (await q(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo,fecha_limite) VALUES (${E1},'${PE1}','Guion',current_date+6) RETURNING id`))[0].id;
await limpiar();
await as(P.M1);
await db.exec(`SELECT public.tarea_equipo_aportar(${T3}, 'comentario', 'Mi comentario privado del equipo', NULL, NULL)`);
a = await avisos(`tipo='observacion_nueva'`);
ok(a.length >= 1 && !a.some(x => x.d === P.M1) && a.every(x => [P.M2, P.ADMIN, P.SEC1].includes(x.d)), 'el comentario de un integrante avisa al resto del grupo y a quien revisa, no a quien lo escribió');
ok(!JSON.stringify(a).includes('privado'), 'y el aviso no lleva el texto del comentario');

console.log('\n[quien salió ya no es audiencia]');
await limpiar();
await as(P.ADMIN);
await db.exec(`SELECT public.tarea_equipo_prorrogar(${T3}, current_date + 12, 'Cambio de fecha')`);
ok(!(await para('tarea_cambio')).includes(P.M5), 'M5 (retirada del equipo) no recibe cambios de las tareas del equipo');

console.log('\n[recordatorios por fecha de las tareas de equipo]');
await limpiar();
await as(P.ADMIN);
const TR = (await q(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo,fecha_limite) VALUES (${E1},'${PE1}','Vence mañana',(now() AT TIME ZONE 'America/Santiago')::date + 1) RETURNING id`))[0].id;
const TV = (await q(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo,fecha_limite) VALUES (${E1},'${PE1}','Venció ayer',(now() AT TIME ZONE 'America/Santiago')::date - 1) RETURNING id`))[0].id;
await limpiar();
const n1 = (await q(`SELECT public.notif_recordatorios_equipos() n`))[0].n;
const n2 = (await q(`SELECT public.notif_recordatorios_equipos() n`))[0].n;
ok(n1 >= 4 && n2 === 0, `por vencer: avisa a los integrantes una vez; correrlo otra vez no repite (${n1} / ${n2})`);
ok(eq((await avisos(`tipo='tarea_por_vencer' AND ref_id='${TR}'`)).map(x => x.d), [P.M1, P.M2]), 'por vencer: solo a los integrantes vigentes');
ok(eq((await avisos(`tipo='tarea_vencida' AND ref_id='${TV}'`)).map(x => x.d), [P.M1, P.M2]), 'vencida (ayer): a los integrantes vigentes, una sola vez');

console.log('\n[un fallo del sistema de avisos NUNCA rompe la operación de negocio]');
await limpiar();
await root();
await db.exec(`ALTER TABLE notificaciones RENAME TO notificaciones_x`);
await as(P.ADMIN);
await allowed(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo) VALUES (${E1},'${PE1}','Con avisos rotos')`, 'crear una tarea de equipo funciona aunque la cola de avisos esté rota');
await allowed(`SELECT public.equipo_agregar_miembros(${E1}, ARRAY['${P.M3}']::uuid[], true, 'Prueba de excepción de ámbito')`, 'y agregar a un integrante también');
await root();
await db.exec(`ALTER TABLE notificaciones_x RENAME TO notificaciones`);

console.log('\n[privacidad: nadie ve avisos ajenos]');
await as(P.M4);
const l4 = await q(`SELECT tipo FROM mis_notificaciones()`);
ok(l4.every(x => ['tarea_asignada', 'tarea_aprobada', 'calificacion_cambiada'].includes(x.tipo)), 'M4 (sin equipo) solo ve lo suyo: ' + l4.map(x => x.tipo).join(','));
await as(P.M1);
ok((await q(`SELECT count(*)::int n FROM mis_notificaciones() WHERE tipo='entrega_registrada'`))[0].n === 0, 'un integrante no ve los avisos de revisión de la administración');
await as(P.M1);
await rejects(`SELECT * FROM notificaciones_eventos`, 'permission', 'ni el registro de eventos');

console.log('\n[sin 0031–0036 no se instala nada]');
{
  const { PGlite } = await import('@electric-sql/pglite');
  const d2 = new PGlite();
  await d2.exec(`CREATE TABLE public.notif_tipos (tipo TEXT, destino JSONB)`);
  let err = null; try { await d2.exec(m41); } catch (e) { err = e; }
  ok(!err, '0041 sin las tablas de equipos termina sin error y avisa por NOTICE');
}
fin();
