// Pruebas de 0032 (tareas colectivas para equipos) contra Postgres real (PGlite), con RLS.
import { crear, montar, CADENA_BASE, sql } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, allowed, fin } = t;
const X = await montar(t, [...CADENA_BASE, '0031_equipos.sql', '0032_tareas_equipo.sql']);
const { P, PE1, ARCH, LEG } = X;
console.log('— 0032 aplicada sin errores');
await db.exec(sql('0032_tareas_equipo.sql'));
ok(true, 'reaplicar 0032 es idempotente');

const equipo = async (nombre, miembros, dist = null) => {
  await as(P.ADMIN);
  const id = (await q(`SELECT public.equipo_guardar(NULL, '${PE1}', '${nombre}', '', NULL, ${dist ? `'${dist}'` : 'NULL'}) id`))[0].id;
  await db.exec(`SELECT public.equipo_agregar_miembros(${id}, ARRAY[${miembros.map(m => `'${m}'`).join(',')}]::uuid[], true, 'Prueba de excepción de ámbito')`);
  return id;
};
const E1 = await equipo('Transversal', [P.M1, P.M2, P.M3]);               // sin distrito: solo la administración asigna
const E2 = await equipo('Distrito 08-01', [P.M1, P.M2, P.M5], '08-01');   // ámbito 08-01: la secretaría 08-01 asigna

const crearT = async (quien, eq, extra = '') => {
  await as(quien);
  return (await q(`INSERT INTO tareas_equipo(equipo_id, periodo_id, titulo, descripcion, fecha_limite ${extra ? ',' + extra.split('|')[0] : ''})
                   VALUES (${eq}, '${LEG}', 'Cobertura en vivo', 'Cubrir la jornada', current_date + 7 ${extra ? ',' + extra.split('|')[1] : ''}) RETURNING id`))[0].id;
};

console.log('\n[asignar: una sola fila para todo el equipo]');
const T1 = await crearT(P.ADMIN, E1);
ok(Number(T1) > 0, 'la administración asigna una tarea al equipo');
const row = (await q(`SELECT periodo_id, estado, asignada_por FROM tareas_equipo WHERE id=${T1}`))[0];
ok(row.periodo_id === PE1, 'el PE de la tarea es el del equipo (se ignoró el LEG que mandó el cliente)');
ok(row.estado === 'asignada' && row.asignada_por === P.ADMIN, 'estado y autor los fija el servidor');
ok((await q(`SELECT count(*)::int n FROM tareas_equipo`))[0].n === 1, 'es UNA fila, no una copia por integrante');
const part = await q(`SELECT persona_id FROM tarea_equipo_participantes WHERE tarea_id=${T1} ORDER BY 1`);
ok(part.length === 3, 'los tres integrantes vigentes participan');
ok((await q(`SELECT count(*)::int n FROM tarea_equipo_eventos WHERE tarea_id=${T1} AND tipo='creada'`))[0].n === 1, 'queda el evento «creada» (punto de emisión tarea_colectiva_asignada)');

await as(P.M1);
await rejects(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo) VALUES (${E1},'${PE1}','Me la asigno')`, 'new row violates|puede_asignar|No puedes', 'un miembro no asigna tareas a un equipo');
await as(P.SEC1);
await rejects(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo) VALUES (${E1},'${PE1}','Equipo transversal')`, 'new row violates|No puedes', 'la secretaría NO asigna a un equipo sin su distrito como ámbito');
await allowed(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo,fecha_limite) VALUES (${E2},'${PE1}','Del distrito', current_date+3)`, 'la secretaría 08-01 sí asigna al equipo de su distrito');
const T2 = (await q(`SELECT id FROM tareas_equipo WHERE titulo='Del distrito'`))[0].id;
await as(P.SEC2);
await rejects(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo) VALUES (${E2},'${PE1}','Intrusa')`, 'new row violates|No puedes', 'la secretaría de otro distrito no asigna ahí');
await as(P.ADMIN);
await rejects(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo,responsable_id) VALUES (${E1},'${PE1}','Resp ajeno','${P.M5}')`, 'integrante vigente', 'el responsable de seguimiento debe ser integrante del equipo');
await allowed(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo,responsable_id,instrucciones,criterios_evaluacion,prioridad,peso) VALUES (${E1},'${PE1}','Con todo','${P.M2}','Paso a paso','Claridad y a tiempo','alta',2)`, 'tarea con responsable, instrucciones, criterios, prioridad y peso');
await db.exec(`SELECT public.equipo_cambiar_estado(${E2}, 'inactivo')`);
await rejects(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo) VALUES (${E2},'${PE1}','A inactivo')`, 'equipo activo', 'a un equipo inactivo no se asigna');
await db.exec(`SELECT public.equipo_cambiar_estado(${E2}, 'activo')`);
await rejects(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo,criterios) VALUES (${E1},'${PE1}','Mala','{inventado}')`, 'Criterios desconocidos', 'criterios fuera del catálogo se rechazan');
await root();
await db.exec(`INSERT INTO equipos(periodo_id,nombre) VALUES ('${PE1}','Vacío')`);
await as(P.ADMIN);
const EV = (await q(`SELECT id FROM equipos WHERE nombre='Vacío'`))[0].id;
await rejects(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo) VALUES (${EV},'${PE1}','Sin gente')`, 'integrantes vigentes', 'un equipo sin integrantes no recibe tareas');

console.log('\n[quién la ve]');
await as(P.M2);
ok((await q(`SELECT count(*)::int n FROM tareas_equipo WHERE equipo_id=${E1}`))[0].n >= 1, 'M2 (integrante) la ve desde su cuenta');
await as(P.M3);
ok((await q(`SELECT count(*)::int n FROM tareas_equipo WHERE id=${T1}`))[0].n === 1, 'M3 también: todos los integrantes ven la MISMA tarea');
ok((await q(`SELECT count(*)::int n FROM tareas_equipo WHERE id=${T2}`))[0].n === 0, 'pero no ve la de un equipo al que no pertenece');
await as(P.M4);
ok((await q(`SELECT count(*)::int n FROM tareas_equipo`))[0].n === 0, 'M4 (sin equipos) no ve ninguna');
await as(null, 'anon');
await rejects(`SELECT count(*) FROM tareas_equipo`, 'denied|permission|denegado', 'anónimo no lee');

console.log('\n[trabajar la tarea: solo por transiciones persistidas]');
await as(P.M1);
await allowed(`UPDATE tareas_equipo SET estado='en_curso' WHERE id=${T1}`, 'M1 la pone en curso');
await rejects(`UPDATE tareas_equipo SET titulo='Otro título' WHERE id=${T1}`, 'contenido', 'un integrante no edita el contenido');
await rejects(`UPDATE tareas_equipo SET fecha_limite = current_date + 30 WHERE id=${T1}`, 'prorrogando', 'ni mueve el plazo');
await rejects(`UPDATE tareas_equipo SET estado='aprobada', puntos=10 WHERE id=${T1}`, 'no permitida', 'ni se la aprueba a sí mismo');
await rejects(`UPDATE tareas_equipo SET estado='entregada' WHERE id=${T1}`, 'enlace o escribe', 'entregar exige enlace o nota');
await rejects(`UPDATE tareas_equipo SET puntos=9 WHERE id=${T1}`, 'puntos', 'los puntos no se tocan por la libre');
await allowed(`UPDATE tareas_equipo SET estado='entregada', entrega_nota='Subido a Drive', entrega_url='https://drive.example/x', entregada_por='${P.M2}' WHERE id=${T1}`, 'M1 entrega (mandó entregada_por = M2 a propósito)');
const ent = (await q(`SELECT entregada_por, entregada_en IS NOT NULL e, estado FROM tareas_equipo WHERE id=${T1}`))[0];
ok(ent.entregada_por === P.M1 && ent.e && ent.estado === 'entregada', 'quién entregó lo fija el servidor: M1, no M2');
await as(P.M2);
await rejects(`UPDATE tareas_equipo SET entrega_nota='Cambio la entrega' WHERE id=${T1}`, 'al entregar|entrega', 'otro integrante no reescribe la entrega ya hecha');
await as(P.SEC1);
ok((await q(`SELECT count(*)::int n FROM tareas_equipo WHERE id=${T1}`))[0].n === 1, 'la secretaría ve (solo lectura) la tarea del equipo con gente de su distrito');
await db.exec(`UPDATE tareas_equipo SET estado='devuelta', revision_nota='Falta audio' WHERE id=${T1}`);
ok((await q(`SELECT estado FROM tareas_equipo WHERE id=${T1}`))[0].estado === 'entregada', 'pero no puede revisar un equipo transversal (la RLS ni le deja tocar la fila)');
await as(P.ADMIN);
await rejects(`UPDATE tareas_equipo SET estado='devuelta' WHERE id=${T1}`, 'explica que hay que corregir', 'devolver exige explicar');
await allowed(`UPDATE tareas_equipo SET estado='devuelta', revision_nota='Falta el audio' WHERE id=${T1}`, 'la administración devuelve con observación');
ok((await q(`SELECT rondas_revision r FROM tareas_equipo WHERE id=${T1}`))[0].r === 1, 'cuenta una ronda de revisión');
await as(P.M3);
await allowed(`UPDATE tareas_equipo SET estado='en_curso' WHERE id=${T1}`, 'M3 retoma la corrección');
await allowed(`UPDATE tareas_equipo SET estado='entregada', entrega_nota='Audio añadido' WHERE id=${T1}`, 'y la vuelve a entregar');
ok((await q(`SELECT entregada_por FROM tareas_equipo WHERE id=${T1}`))[0].entregada_por === P.M3, 'la última entrega es de M3');
await as(P.ADMIN);
await rejects(`UPDATE tareas_equipo SET estado='aprobada' WHERE id=${T1}`, 'asigna sus puntos', 'aprobar exige los puntos');
await rejects(`UPDATE tareas_equipo SET estado='aprobada', puntos=11 WHERE id=${T1}`, 'check|violates', 'puntos fuera de 0–10 rechazados');
await allowed(`UPDATE tareas_equipo SET estado='aprobada', puntos=8 WHERE id=${T1}`, 'la administración aprueba con 8');
const ap = (await q(`SELECT puntos, puntos_original, aprobada_por FROM tareas_equipo WHERE id=${T1}`))[0];
ok(ap.puntos === 8 && ap.puntos_original === 8 && ap.aprobada_por === P.ADMIN, 'nota actual, nota original y quién aprobó quedan guardados');
await as(P.M1);
await rejects(`UPDATE tareas_equipo SET puntos=10 WHERE id=${T1}`, 'aprobada|no se modifica', 'una tarea aprobada es historia para el integrante');
const ev1 = (await q(`SELECT tipo, a FROM tarea_equipo_eventos WHERE tarea_id=${T1} AND tipo='estado' ORDER BY id`)).map(e => e.a).join('>');
ok(ev1 === 'en_curso>entregada>devuelta>en_curso>entregada>aprobada', 'historial de estados completo: ' + ev1);

console.log('\n[plazo: solo prorrogando, con motivo]');
await as(P.M5);
await allowed(`UPDATE tareas_equipo SET estado='en_curso' WHERE id=${T2}`, 'M5 pone en curso la del distrito');
await rejects(`SELECT public.tarea_equipo_prorrogar(${T2}, current_date + 20, 'quiero mas tiempo')`, 'No puedes cambiar', 'un integrante no se prorroga a sí mismo');
await as(P.SEC1);
await rejects(`SELECT public.tarea_equipo_prorrogar(${T2}, current_date + 20, 'x')`, 'motivo', 'la prórroga exige motivo');
await allowed(`SELECT public.tarea_equipo_prorrogar(${T2}, current_date + 20, 'Se movió la jornada del distrito')`, 'la secretaría del ámbito prorroga');
const pr = (await q(`SELECT fecha_limite, fecha_limite_original FROM tareas_equipo WHERE id=${T2}`))[0];
ok(String(pr.fecha_limite) !== String(pr.fecha_limite_original), 'la fecha cambió y la original NO');
ok((await q(`SELECT count(*)::int n FROM tarea_equipo_eventos WHERE tarea_id=${T2} AND tipo='prorroga'`))[0].n === 1, 'queda el evento «prorroga» con su motivo');

console.log('\n[aportes: cada quien firma los suyos]');
await as(P.M5);
const a1 = (await q(`SELECT public.tarea_equipo_aportar(${T2}, 'avance', 'Guion terminado', NULL, 40) id`))[0].id;
await allowed(`SELECT public.tarea_equipo_aportar(${T2}, 'evidencia', 'Borrador', 'https://drive.example/borrador', NULL)`, 'M5 aporta un avance y una evidencia');
ok((await q(`SELECT persona_id FROM tarea_equipo_aportes WHERE id=${a1}`))[0].persona_id === P.M5, 'el aporte queda firmado por quien llamó (no hay forma de firmar por otro)');
await rejects(`INSERT INTO tarea_equipo_aportes(tarea_id,persona_id,tipo,nota) VALUES (${T2},'${P.M1}','avance','Falso')`, 'denied|permission|denegado', 'tampoco se inserta directo a nombre de otro');
await rejects(`SELECT public.tarea_equipo_aportar(${T2}, 'avance', 'x', NULL, NULL)`, 'porcentaje', 'un avance necesita su porcentaje');
await rejects(`SELECT public.tarea_equipo_aportar(${T2}, 'avance', 'x', NULL, 150)`, 'check|violates|between', 'el porcentaje va de 0 a 100');
await as(P.M3);
await rejects(`SELECT public.tarea_equipo_aportar(${T2}, 'comentario', 'Me cuelo')`, 'acceso', 'quien no participa no aporta');
await as(P.SEC1);
await allowed(`SELECT public.tarea_equipo_aportar(${T2}, 'comentario', 'Revisar el encuadre de la intro')`, 'quien revisa deja comentarios');
await rejects(`SELECT public.tarea_equipo_aportar(${T2}, 'evidencia', 'No soy del equipo', 'https://x.example/a')`, 'avances y evidencias', 'pero no avances ni evidencias');
await as(P.M2);
const pa = await q(`SELECT nombre, aportes, entrego FROM tarea_equipo_participacion(${T2}) ORDER BY nombre`);
ok(pa.find(p => p.nombre === 'M5')?.aportes === 2 && pa.find(p => p.nombre === 'M1')?.aportes === 0, 'progreso individual visible: M5 aportó 2, M1 ninguno');
ok((await q(`SELECT count(*)::int n FROM tarea_equipo_participacion(${T2}) WHERE puntos_individual IS NOT NULL`))[0].n === 0, 'sin notas individuales de otros a la vista');

console.log('\n[altas y bajas con tareas abiertas]');
await as(P.ADMIN);
await db.exec(`SELECT public.equipo_agregar_miembros(${E2}, ARRAY['${P.M4}']::uuid[], true, 'Refuerzo para la jornada del distrito')`);
ok((await q(`SELECT count(*)::int n FROM tarea_equipo_participantes WHERE tarea_id=${T2} AND persona_id='${P.M4}' AND hasta IS NULL`))[0].n === 1, 'quien entra se suma a la tarea ABIERTA');
ok((await q(`SELECT count(*)::int n FROM tarea_equipo_participantes WHERE tarea_id=${T1} AND persona_id='${P.M4}'`))[0].n === 0, '...pero no a la aprobada del otro equipo');
await db.exec(`SELECT public.equipo_agregar_miembros(${E1}, ARRAY['${P.M5}']::uuid[], true, 'Cubre vacante de edición en el equipo')`);
ok((await q(`SELECT count(*)::int n FROM tarea_equipo_participantes WHERE tarea_id=${T1} AND persona_id='${P.M5}'`))[0].n === 0, 'ni a una tarea ya APROBADA de su nuevo equipo (historia cerrada)');
await db.exec(`SELECT public.equipo_retirar_miembro(${E2}, '${P.M5}', 'Cambia de proyecto')`);
const m5 = (await q(`SELECT hasta IS NOT NULL h FROM tarea_equipo_participantes WHERE tarea_id=${T2} AND persona_id='${P.M5}'`))[0];
ok(m5.h, 'quien sale deja de participar en lo abierto (la fila se conserva con fecha de salida)');
await as(P.M5);
ok((await q(`SELECT count(*)::int n FROM tareas_equipo WHERE id=${T2}`))[0].n === 1, 'M5 sigue viendo la tarea en la que participó (su historia)');
await db.exec(`UPDATE tareas_equipo SET estado='entregada', entrega_nota='Ya no soy del equipo' WHERE id=${T2}`);
ok((await q(`SELECT estado FROM tareas_equipo WHERE id=${T2}`))[0].estado === 'en_curso', 'pero ya no la mueve (la RLS no le deja tocar la fila)');
await rejects(`SELECT public.tarea_equipo_aportar(${T2}, 'comentario', 'Sigo aportando')`, 'acceso', 'ni aporta');
ok((await q(`SELECT count(*)::int n FROM tarea_equipo_aportes WHERE tarea_id=${T2} AND persona_id='${P.M5}'`))[0].n === 2, 'sus aportes anteriores siguen ahí y a su nombre');

console.log('\n[anular, bloquear, reabrir]');
await as(P.ADMIN);
const T3 = await crearT(P.ADMIN, E1);
await as(P.M1);
await rejects(`UPDATE tareas_equipo SET estado='bloqueada' WHERE id=${T3}`, 'necesita un motivo', 'bloquear exige motivo');
await allowed(`UPDATE tareas_equipo SET estado='bloqueada', bloqueo_motivo='Esperando el permiso del lugar' WHERE id=${T3}`, 'bloquear con motivo');
await rejects(`UPDATE tareas_equipo SET estado='anulada', anulacion_motivo='ya no hace falta' WHERE id=${T3}`, 'no permitida', 'un integrante no anula');
await as(P.ADMIN);
await rejects(`UPDATE tareas_equipo SET estado='anulada' WHERE id=${T3}`, 'necesita un motivo', 'anular exige motivo');
await allowed(`UPDATE tareas_equipo SET estado='anulada', anulacion_motivo='Se canceló la cobertura' WHERE id=${T3}`, 'la administración anula con motivo');
await as(P.M1);
await rejects(`UPDATE tareas_equipo SET estado='en_curso' WHERE id=${T3}`, 'no se modifica', 'una anulada no la revive un integrante');
await as(P.ADMIN);
await allowed(`UPDATE tareas_equipo SET estado='asignada' WHERE id=${T3}`, 'solo la administración la reabre');
ok((await q(`SELECT anulada_en IS NULL a FROM tareas_equipo WHERE id=${T3}`))[0].a, 'reabrir limpia la marca de anulación (el evento conserva la historia)');
await allowed(`DELETE FROM tareas_equipo WHERE id=${T3}`, 'una tarea sin tocar aún puede borrarla la administración');
await db.exec(`DELETE FROM tareas_equipo WHERE id=${T1}`);
ok((await q(`SELECT count(*)::int n FROM tareas_equipo WHERE id=${T1}`))[0].n === 1, 'la tarea aprobada sigue ahí (no se borra)');

console.log('\n[archivar un equipo con tareas abiertas]');
await rejects(`SELECT public.equipo_cambiar_estado(${E2}, 'archivado', 'Cierre del PE')`, 'tarea\\(s\\) colectiva', 'no se archiva con tareas colectivas abiertas');
await db.exec(`UPDATE tareas_equipo SET estado='anulada', anulacion_motivo='Se cierra el PE' WHERE equipo_id=${E2} AND estado NOT IN ('aprobada','anulada')`);
await allowed(`SELECT public.equipo_cambiar_estado(${E2}, 'archivado', 'Cierre del PE')`, 'ya cerradas, se archiva');

console.log('\n[gestión archivada]');
await root();
await db.exec(`INSERT INTO equipos(periodo_id,nombre) VALUES ('${ARCH}','Histórico')`);
const EH = (await q(`SELECT id FROM equipos WHERE nombre='Histórico'`))[0].id;
await db.exec(`INSERT INTO equipo_miembros(equipo_id,persona_id) VALUES (${EH},'${P.M1}')`);
await as(P.ADMIN);
await rejects(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo) VALUES (${EH},'${ARCH}','En archivada')`, 'archivada', 'no se asigna en una gestión archivada');

fin();
