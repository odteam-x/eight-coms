// Pruebas de 0031 (equipos por PE) contra Postgres real (PGlite), con RLS.
import { crear, montar, CADENA_BASE, uid, sql } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, allowed, fin } = t;
const X = await montar(t, [...CADENA_BASE, '0031_equipos.sql']);
const { P, PE1, PE2, ARCH, LEG } = X;
console.log('— 0031 aplicada sin errores');
await db.exec(sql('0031_equipos.sql'));
ok(true, 'reaplicar 0031 es idempotente');

const nuevo = async (nombre, extra = {}) => {
  await as(P.ADMIN);
  const per = extra.per ?? PE1;
  return (await q(`SELECT public.equipo_guardar(NULL, '${per}', '${nombre}', '${extra.desc ?? ''}', ${extra.resp ? `'${extra.resp}'` : 'NULL'}, ${extra.dist ? `'${extra.dist}'` : 'NULL'}) id`))[0].id;
};

console.log('\n[crear: solo la administración, solo PE v2, datos válidos]');
const E1 = await nuevo('Cobertura Jornada', { desc: 'Equipo de cobertura' });
ok(Number(E1) > 0, 'la administración crea un equipo en un PE v2');
await as(P.SEC1);
await rejects(`SELECT public.equipo_guardar(NULL, '${PE1}', 'Intruso')`, 'administracion', 'una secretaría NO crea equipos');
await as(P.M1);
await rejects(`SELECT public.equipo_guardar(NULL, '${PE1}', 'Intruso')`, 'administracion', 'un miembro NO crea equipos');
await rejects(`INSERT INTO equipos(periodo_id,nombre) VALUES ('${PE1}','Directo')`, 'denied|permission|denegado', 'un miembro tampoco inserta directo (sin permisos de escritura)');
await as(null, 'anon');
await rejects(`SELECT count(*) FROM equipos`, 'denied|permission|denegado', 'anónimo no lee equipos');
await as(P.ADMIN);
await rejects(`SELECT public.equipo_guardar(NULL, '${LEG}', 'En legacy')`, 'rubrica por roles', 'un PE clásico (legacy) no admite equipos');
await rejects(`SELECT public.equipo_guardar(NULL, '${ARCH}', 'En archivada')`, 'archivada', 'una gestión archivada no admite equipos nuevos');
await rejects(`SELECT public.equipo_guardar(NULL, NULL, 'Sin PE')`, 'PE existente', 'sin PE se rechaza');
await rejects(`SELECT public.equipo_guardar(NULL, '${PE1}', 'x')`, '2 y 80', 'nombre demasiado corto se rechaza');
await rejects(`SELECT public.equipo_guardar(NULL, '${PE1}', '   ')`, '2 y 80', 'nombre en blanco se rechaza');
await rejects(`SELECT public.equipo_guardar(NULL, '${PE1}', 'cobertura jornada')`, 'ya hay un equipo', 'nombre repetido en el mismo PE (sin distinguir mayúsculas) se rechaza');
await allowed(`SELECT public.equipo_guardar(NULL, '${PE2}', 'Cobertura Jornada')`, 'el mismo nombre en OTRO PE sí se permite');
await rejects(`SELECT public.equipo_guardar(NULL, '${PE1}', 'Con admin responsable', '', '${P.ADMIN}')`, 'no es elegible', 'la administración no puede ser responsable (no se evalúa)');
await db.exec(`INSERT INTO periodo_participantes(periodo_id,user_id,activo) VALUES ('${PE1}','${P.M4}',false)`);
await rejects(`SELECT public.equipo_guardar(NULL, '${PE1}', 'Resp inactivo', '', '${P.M4}')`, 'no es elegible', 'quien no participa en el PE no puede ser responsable');

console.log('\n[editar]');
await allowed(`SELECT public.equipo_guardar(${E1}, NULL, 'Cobertura de Jornada', 'Descripción nueva', '${P.M1}', NULL)`, 'editar nombre, descripción y responsable');
ok((await q(`SELECT nombre, responsable_id FROM equipos WHERE id=${E1}`))[0].responsable_id === P.M1, 'el responsable queda guardado');
await rejects(`SELECT public.equipo_guardar(${E1}, '${PE2}', 'Cobertura de Jornada')`, 'no cambia de PE', 'un equipo no cambia de PE');
const ev = await q(`SELECT tipo FROM equipo_eventos WHERE equipo_id=${E1} ORDER BY id`);
ok(ev.map(e => e.tipo).join() === 'creado,editado,responsable', 'el historial registró: creado, editado, responsable → ' + ev.map(e => e.tipo).join());

console.log('\n[integrantes: varios, sin duplicar, elegibilidad]');
const r1 = (await q(`SELECT public.equipo_agregar_miembros(${E1}, ARRAY['${P.M1}','${P.M2}','${P.M3}']::uuid[]) r`))[0].r;
ok(r1.agregados.length === 3 && r1.omitidos.length === 0, 'agrega tres integrantes de una vez');
const r2 = (await q(`SELECT public.equipo_agregar_miembros(${E1}, ARRAY['${P.M1}','${P.M5}']::uuid[]) r`))[0].r;
ok(r2.agregados.length === 1 && r2.omitidos.length === 1 && r2.omitidos[0].razon === 'ya_integrante', 'un duplicado se omite («ya_integrante») y los demás entran');
ok((await q(`SELECT count(*)::int n FROM equipo_miembros WHERE equipo_id=${E1} AND persona_id='${P.M1}' AND hasta IS NULL`))[0].n === 1, 'M1 sigue una sola vez');
await root();
await rejects(`INSERT INTO equipo_miembros(equipo_id,persona_id) VALUES (${E1},'${P.M1}')`, 'duplicate|unique', 'el índice único impide el duplicado aunque se salte la función');
await as(P.ADMIN);
const r3 = (await q(`SELECT public.equipo_agregar_miembros(${E1}, ARRAY['${P.ADMIN}','${P.M4}']::uuid[]) r`))[0].r;
ok(r3.agregados.length === 0 && r3.omitidos.map(o => o.razon).sort().join() === 'administracion,no_participa', 'ni la administración ni quien no participa en el PE son elegibles: ' + JSON.stringify(r3.omitidos.map(o => o.razon)));
await db.exec(`UPDATE profiles SET aprobado=false WHERE id='${P.M4}'`);
await db.exec(`DELETE FROM periodo_participantes WHERE user_id='${P.M4}'`);
const r4 = (await q(`SELECT public.equipo_agregar_miembros(${E1}, ARRAY['${P.M4}']::uuid[]) r`))[0].r;
ok(r4.omitidos[0]?.razon === 'sin_aprobar', 'quien no está aprobado no es elegible');
await db.exec(`UPDATE profiles SET aprobado=true WHERE id='${P.M4}'`);
await rejects(`SELECT public.equipo_agregar_miembros(${E1}, ARRAY[]::uuid[])`, 'al menos una', 'lista vacía se rechaza');
await as(P.M1);
await rejects(`SELECT public.equipo_agregar_miembros(${E1}, ARRAY['${P.M4}']::uuid[])`, 'administracion', 'un integrante NO agrega gente (ni siquiera siendo responsable)');
await rejects(`SELECT public.equipo_retirar_miembro(${E1}, '${P.M2}', 'por que si')`, 'administracion', 'un integrante NO retira gente');

console.log('\n[ámbito de distrito y excepciones explícitas]');
const E2 = await nuevo('Distrito 08-01', { dist: '08-01' });
const a1 = (await q(`SELECT public.equipo_agregar_miembros(${E2}, ARRAY['${P.M1}','${P.M3}']::uuid[]) r`))[0].r;
ok(a1.agregados.length === 1 && a1.omitidos[0].razon === 'otro_distrito', 'M3 (08-02) queda fuera de un equipo del 08-01');
await rejects(`SELECT public.equipo_agregar_miembros(${E2}, ARRAY['${P.M3}']::uuid[], true, 'x')`, 'motivo', 'la excepción exige un motivo');
const a2 = (await q(`SELECT public.equipo_agregar_miembros(${E2}, ARRAY['${P.M3}']::uuid[], true, 'Experta en edición que el distrito no tiene') r`))[0].r;
ok(a2.agregados.length === 1, 'con excepción explícita y motivo, entra');
ok((await q(`SELECT excepcion, excepcion_motivo FROM equipo_miembros WHERE equipo_id=${E2} AND persona_id='${P.M3}'`))[0].excepcion === true, 'la fila queda marcada como excepción');
const a3 = (await q(`SELECT public.equipo_agregar_miembros(${E2}, ARRAY['${P.M4}']::uuid[], true, 'Intento saltarse la participación') r`))[0].r;
ok(a3.agregados.length === 1, 'M4 (reactivado) sí entra con excepción de ámbito');
await db.exec(`INSERT INTO periodo_participantes(periodo_id,user_id,activo) VALUES ('${PE1}','${P.M4}',false)`);
const E3 = await nuevo('Otro 08-01', { dist: '08-01' });
await as(P.ADMIN);
const a4 = (await q(`SELECT public.equipo_agregar_miembros(${E3}, ARRAY['${P.M4}']::uuid[], true, 'Excepción de ámbito, no de participación') r`))[0].r;
ok(a4.agregados.length === 0 && a4.omitidos[0].razon === 'no_participa', 'la excepción de ámbito NO salta «no participa en el PE»');

console.log('\n[política ante cambios de distrito o de participación: se avisa, no se cambia]');
await root();
const antes = (await q(`SELECT count(*)::int n FROM equipo_miembros WHERE hasta IS NULL`))[0].n;
await db.exec(`UPDATE profiles SET distrito='08-02' WHERE id='${P.M1}'`);
await db.exec(`UPDATE periodo_participantes SET activo=false WHERE user_id='${P.M4}'`);
ok((await q(`SELECT count(*)::int n FROM equipo_miembros WHERE hasta IS NULL`))[0].n === antes, 'las relaciones NO cambian en silencio');
const al = await q(`SELECT equipo_id, detalle->>'causa' causa FROM equipo_eventos WHERE tipo='alerta' ORDER BY id`);
ok(al.some(a => a.causa === 'cambio_distrito') , 'queda una alerta de cambio de distrito en el historial del equipo');
await as(P.ADMIN);
const integ = await q(`SELECT persona_id, alerta FROM equipo_integrantes(${E2})`);
ok(integ.find(i => i.persona_id === P.M1)?.alerta === 'otro_distrito', 'equipo_integrantes marca a M1 («otro_distrito») mientras siga vigente');
ok(integ.find(i => i.persona_id === P.M3)?.alerta === null, 'la persona con excepción explícita NO se marca');

console.log('\n[retirar: con motivo, sin borrar historia, reincorporar]');
await rejects(`SELECT public.equipo_retirar_miembro(${E1}, '${P.M2}', 'ya')`, 'motivo', 'retirar exige motivo');
await allowed(`SELECT public.equipo_retirar_miembro(${E1}, '${P.M2}', 'Pidió salir del equipo')`, 'la administración retira a M2');
ok((await q(`SELECT hasta IS NOT NULL h, motivo_retiro FROM equipo_miembros WHERE equipo_id=${E1} AND persona_id='${P.M2}'`))[0].h, 'la fila queda con fecha de salida (no se borra)');
await rejects(`SELECT public.equipo_retirar_miembro(${E1}, '${P.M2}', 'otra vez, por favor')`, 'no es integrante vigente', 'retirar a quien ya salió se rechaza');
await allowed(`SELECT public.equipo_agregar_miembros(${E1}, ARRAY['${P.M2}']::uuid[])`, 'reincorporar a M2 funciona');
ok((await q(`SELECT count(*)::int n FROM equipo_miembros WHERE equipo_id=${E1} AND persona_id='${P.M2}'`))[0].n === 2, 'M2 tiene DOS filas: la historia de la salida se conserva');
await allowed(`SELECT public.equipo_retirar_miembro(${E1}, '${P.M1}', 'Cambia de funciones')`, 'retirar al responsable');
ok((await q(`SELECT responsable_id FROM equipos WHERE id=${E1}`))[0].responsable_id === null, 'al salir el responsable, el equipo queda sin responsable (y se registra)');
ok((await q(`SELECT count(*)::int n FROM equipo_eventos WHERE equipo_id=${E1} AND tipo='miembro_baja'`))[0].n === 2, 'cada baja deja su evento');

console.log('\n[quién ve qué]');
await as(P.M2);
ok((await q(`SELECT count(*)::int n FROM equipos`))[0].n === 1, 'M2 ve solo su equipo (E1)');
ok((await q(`SELECT count(*)::int n FROM equipo_integrantes(${E1})`))[0].n === 3, 'M2 ve a los integrantes vigentes de su equipo (M2, M3, M5: M1 salió)');
ok((await q(`SELECT count(*)::int n FROM equipo_eventos`))[0].n === 0, 'M2 no ve el historial de gestión del equipo');
ok((await q(`SELECT count(*)::int n FROM equipo_integrantes(${E1}) WHERE alerta IS NOT NULL OR excepcion`))[0].n === 0, 'M2 no ve alertas ni excepciones de otros');
await as(P.M5);
ok((await q(`SELECT count(*)::int n FROM equipos WHERE id=${E2}`))[0].n === 0, 'M5 (no integrante de E2) no ve E2');
await as(P.SEC2);
ok((await q(`SELECT count(*)::int n FROM equipos WHERE id=${E2}`))[0].n === 1, 'la secretaría del 08-02 ve E2 (M3 es de su distrito)');
ok((await q(`SELECT count(*)::int n FROM equipo_miembros WHERE equipo_id=${E2}`))[0].n === 3, 'y solo las personas de su distrito dentro de él (M1 ahora 08-02, M3 y M4; no ve filas de otro distrito)');
await rejects(`SELECT public.equipo_cambiar_estado(${E2}, 'archivado', 'quiero')`, 'administracion', 'la secretaría no archiva');
await as(P.SEC1);
ok((await q(`SELECT count(*)::int n FROM equipo_eventos WHERE equipo_id=${E2}`))[0].n >= 1, 'la secretaría del distrito ámbito ve el historial del equipo de su distrito');

console.log('\n[estado: activo · inactivo · archivado]');
await as(P.ADMIN);
await allowed(`SELECT public.equipo_cambiar_estado(${E1}, 'inactivo')`, 'desactivar');
await rejects(`SELECT public.equipo_agregar_miembros(${E1}, ARRAY['${P.M5}']::uuid[])`, 'equipo activo', 'a un equipo inactivo no se agregan integrantes');
await rejects(`SELECT public.equipo_cambiar_estado(${E1}, 'archivado')`, 'motivo', 'archivar exige motivo');
await allowed(`SELECT public.equipo_cambiar_estado(${E1}, 'archivado', 'Terminó el PE y se cierra')`, 'archivar con motivo');
await rejects(`SELECT public.equipo_guardar(${E1}, NULL, 'Editado archivado')`, 'archivado', 'un equipo archivado no se edita');
await rejects(`SELECT public.equipo_cambiar_estado(${E1}, 'activo')`, 'inactivo', 'archivado → activo directo no se permite');
await allowed(`SELECT public.equipo_cambiar_estado(${E1}, 'inactivo')`, 'restaurar a inactivo');
ok((await q(`SELECT count(*)::int n FROM equipo_miembros WHERE equipo_id=${E1}`))[0].n >= 4, 'el archivado no borró a nadie');

console.log('\n[gestión archivada = solo lectura]');
await root();
await db.exec(`INSERT INTO equipos(periodo_id,nombre) VALUES ('${ARCH}','Histórico')`);
const EH = (await q(`SELECT id FROM equipos WHERE nombre='Histórico'`))[0].id;
await as(P.ADMIN);
await rejects(`SELECT public.equipo_agregar_miembros(${EH}, ARRAY['${P.M1}']::uuid[])`, 'archivada', 'no se compone un equipo de una gestión archivada');
await rejects(`SELECT public.equipo_guardar(${EH}, NULL, 'Histórico 2')`, 'archivada', 'ni se edita');

fin();
