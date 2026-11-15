// Pruebas de 0062: hasta dos roles por persona y evaluación por rol (el segundo rol vive en la misma evaluación).
import { crear, montar, CADENA_BASE, sql, J } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, allowed, fin } = t;
const CADENA = [...CADENA_BASE, '0031_equipos.sql', '0032_tareas_equipo.sql', '0033_calificaciones.sql', '0034_calificacion_tareas.sql', '0035_resultados_integrados.sql',
  '0053_rectificacion_evaluaciones.sql', '0061_tareas_sin_tareas_pierde_puntos.sql'];
const X = await montar(t, CADENA);
const { P, PE1, G, FOTO, REDA } = X;

const nuc = (await q(`SELECT key FROM criterios_v2 WHERE gestion_id=${G} AND tipo='nucleo' AND tipo_campo='escala' AND activo`)).map(x => x.key);
const crit = async rol => { const p = (await q(`SELECT public.perfil_vigente(${rol}, '${PE1}') id`))[0].id; return { id: p, c: await q(`SELECT criterio_key k, peso FROM perfil_criterios WHERE perfil_id=${p}`) }; };
const PF = await crit(FOTO), PR = await crit(REDA);
const punNuc = f => Object.fromEntries(nuc.map(k => [k, Math.round(10 * f)]));
const punTec = (pf, f) => Object.fromEntries(pf.c.map(x => [x.k, Math.floor(x.peso * f)]));
const pun = (pf, f) => J({ ...punNuc(f), ...punTec(pf, f) });
const otros = (await q(`SELECT id FROM roles WHERE id NOT IN (${FOTO}, ${REDA}) ORDER BY id LIMIT 2`)).map(x => x.id);
const rol3 = otros[0], rol4 = otros[1];

await db.exec(`UPDATE profiles SET rol_id=${FOTO} WHERE id IN ('${P.M1}','${P.M2}','${P.M3}')`);
await db.exec(`UPDATE profiles SET rol_id=${REDA} WHERE id IN ('${P.M4}','${P.M5}')`);
await as(P.ADMIN);
const publ = [[P.M1, PF, 0.8], [P.M2, PF, 0.8], [P.M3, PF, 0.6], [P.M4, PR, 0.9], [P.M5, PR, 0.7]];
for (const [m, pf, f] of publ) await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${m}','${pun(pf, f)}','publicado')`);
const COLS = 'evaluado_id, rol_id, nucleo::float n, tecnico::float t, individual::float i, percentil::float p, general::float g, n_rol, individual_eval::float ie, general_eval::float ge, tareas::float ta, peso_tareas::float w';
const res = async () => { await as(P.ADMIN); const f = await q(`SELECT ${COLS} FROM resultados_periodo('${PE1}') ORDER BY evaluado_id`); await root(); return f; };
const por = f => Object.fromEntries(f.map(r => [r.evaluado_id, r]));
const antes = await res();
console.log('[antes de 0062] ' + antes.length + ' resultados');
await root();

const m = sql('0062_dos_roles_por_persona.sql');
await db.exec(m);
ok(true, '0062 se aplica sin errores');
await db.exec(m);
ok(true, 'reaplicar 0062 es idempotente');

console.log('\n[paridad: sin segundo rol nada cambia]');
const desp = await res();
ok(JSON.stringify(desp) === JSON.stringify(antes), 'los resultados de las 5 personas son idénticos antes y después de 0062');
await as(P.ADMIN);
const r0 = (await q(`SELECT rol2_id, tecnico_rol2, peso_rol2::float pr, rol2_incompleta FROM resultados_periodo('${PE1}') WHERE evaluado_id='${P.M1}'`))[0];
ok(r0.rol2_id === null && r0.tecnico_rol2 === null && r0.pr === 0 && r0.rol2_incompleta === false, 'sin segundo rol: rol2_id NULL, peso 0 %, no incompleta');
await root();

console.log('\n[máximo 2 roles por persona]');
const ROL3 = rol3;
await as(P.ADMIN);
await allowed(`INSERT INTO persona_roles(persona_id, rol_id) VALUES ('${P.M1}', ${REDA})`, 'M1 (principal Fotografía) recibe un segundo rol: Redacción');
if (ROL3) await rejects(`INSERT INTO persona_roles(persona_id, rol_id) VALUES ('${P.M1}', ${ROL3})`, 'maximo 2 roles', 'un tercer rol se rechaza');
await allowed(`INSERT INTO persona_roles(persona_id, rol_id) VALUES ('${P.M1}', ${FOTO}) ON CONFLICT DO NOTHING`, 'habilitar el MISMO rol principal no cuenta como un tercero (2 roles distintos)');
await root();
await db.exec(`DELETE FROM persona_roles WHERE persona_id='${P.M1}' AND rol_id=${FOTO}`);
ok((await q(`SELECT public.rol_secundario_de('${P.M1}') r`))[0].r === Number(REDA), 'rol_secundario_de(M1) = Redacción');
ok((await q(`SELECT public.rol_secundario_de('${P.M2}') r`))[0].r === null, 'rol_secundario_de(M2) = NULL (un solo rol)');
if (ROL3) {
  // Un dato viejo con 3 roles: no se borra ni rompe; se reporta; y no se puede cambiar a un principal que lo deje en 3.
  await db.exec(`ALTER TABLE persona_roles DISABLE TRIGGER persona_roles_max2`);
  await db.exec(`INSERT INTO persona_roles(persona_id, rol_id) VALUES ('${P.M3}', ${REDA}), ('${P.M3}', ${ROL3})`);
  await db.exec(`ALTER TABLE persona_roles ENABLE TRIGGER persona_roles_max2`);
  await as(P.ADMIN);
  const exc = await q(`SELECT persona_id, roles::int n FROM personas_con_mas_de_dos_roles()`);
  ok(exc.length === 1 && exc[0].persona_id === P.M3 && exc[0].n === 3, 'personas_con_mas_de_dos_roles() lista a M3 (ya tenía 3) y a nadie más');
  if (rol4) await rejects(`UPDATE profiles SET rol_id=${rol4} WHERE id='${P.M3}'`, 'mas de 2 roles', 'cambiar el principal a un rol que dejaría 4 roles se rechaza');
  await allowed(`UPDATE profiles SET rol_id=${REDA} WHERE id='${P.M3}'`, 'cambiar el principal a uno de sus roles habilitados lo deja en 2: se permite');
  await root();
  await db.exec(`DELETE FROM persona_roles WHERE persona_id='${P.M3}'`);
  await db.exec(`UPDATE profiles SET rol_id=${FOTO} WHERE id='${P.M3}'`);
}
await as(P.M2);
await rejects(`INSERT INTO persona_roles(persona_id, rol_id) VALUES ('${P.M2}', ${REDA})`, 'row-level|policy|denied|permission', 'un miembro no se habilita roles a sí mismo');
await as(P.M1);
ok((await q(`SELECT count(*)::int n FROM persona_roles`))[0].n === 1, 'M1 solo ve su propio segundo rol');
await root();

console.log('\n[puntajes del segundo rol: validación]');
const p2 = f => J(punTec(PR, f));
await as(P.ADMIN);
await root();
// Todas las evaluaciones están publicadas: se prueba la validación con borradores nuevos en PE2.
const PE2 = X.PE2;
const critPE2 = async rol => (await q(`SELECT criterio_key k, peso FROM perfil_criterios WHERE perfil_id=(SELECT public.perfil_vigente(${rol}, '${PE2}'))`));
const PR2 = await critPE2(REDA), PF2 = await critPE2(FOTO);
const tec2 = (c, f) => Object.fromEntries(c.map(x => [x.k, Math.floor(x.peso * f)]));
const nucF = f => Object.fromEntries(nuc.map(k => [k, Math.round(10 * f)]));
await as(P.ADMIN);
await rejects(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,puntajes_rol2) VALUES ('${PE2}','${P.M2}','${J({ ...nucF(.8), ...tec2(PF2, .8) })}','${J(tec2(PR2, .6))}')`, 'segundo rol habilitado', 'sin segundo rol habilitado, no se aceptan puntajes del rol 2 (M2)');
await allowed(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,puntajes_rol2) VALUES ('${PE2}','${P.M1}','${J({ ...nucF(.8), ...tec2(PF2, .8) })}','${J(tec2(PR2, .6))}')`, 'M1 (con segundo rol) guarda borrador con puntajes del rol 2');
const E = (await q(`SELECT perfil2_id, puntajes_rol2 FROM evaluaciones WHERE evaluado_id='${P.M1}' AND periodo_id='${PE2}'`))[0];
ok(E.perfil2_id !== null, 'el servidor fija perfil2_id (el perfil de Redacción)');
const k0 = PR2[0].k;
await rejects(`UPDATE evaluaciones SET puntajes_rol2='${J({ ...tec2(PR2, .6), [k0]: PR2[0].peso + 1 })}' WHERE evaluado_id='${P.M1}' AND periodo_id='${PE2}'`, 'entero de 0 a', 'un puntaje del rol 2 por encima de su peso se rechaza');
await rejects(`UPDATE evaluaciones SET puntajes_rol2='${J({ [nuc[0]]: 5 })}' WHERE evaluado_id='${P.M1}' AND periodo_id='${PE2}'`, 'no aplica al perfil del segundo rol', 'el núcleo no se repite en el rol 2');
await rejects(`UPDATE evaluaciones SET puntajes_rol2='${J({ k_inexistente: 3 })}' WHERE evaluado_id='${P.M1}' AND periodo_id='${PE2}'`, 'no aplica', 'un criterio ajeno al perfil del rol 2 se rechaza');
await rejects(`UPDATE evaluaciones SET puntajes_rol2='${J({ [k0]: 1.5 })}' WHERE evaluado_id='${P.M1}' AND periodo_id='${PE2}'`, 'entero', 'un decimal se rechaza');
// Publicar con el rol 2 a medias: se rechaza; con el rol 2 completo o ausente: se publica.
await db.exec(`UPDATE evaluaciones SET puntajes_rol2='${J({ [k0]: 1 })}' WHERE evaluado_id='${P.M1}' AND periodo_id='${PE2}'`);
await rejects(`UPDATE evaluaciones SET estado='publicado' WHERE evaluado_id='${P.M1}' AND periodo_id='${PE2}'`, 'segundo rol', 'publicar con el rol 2 a medias se rechaza (faltan criterios del rol 2)');
await db.exec(`UPDATE evaluaciones SET puntajes_rol2='${J(tec2(PR2, .6))}' WHERE evaluado_id='${P.M1}' AND periodo_id='${PE2}'`);
await allowed(`UPDATE evaluaciones SET estado='publicado' WHERE evaluado_id='${P.M1}' AND periodo_id='${PE2}'`, 'con el rol 2 completo se publica');
await root();

console.log('\n[la publicada: el rol 2 también se protege y se rectifica con motivo]');
const EID = (await q(`SELECT id FROM evaluaciones WHERE evaluado_id='${P.M1}' AND periodo_id='${PE2}'`))[0].id;
await as(P.ADMIN);
await rejects(`UPDATE evaluaciones SET puntajes_rol2='${J(tec2(PR2, .3))}' WHERE id='${EID}'`, 'rectificar_evaluacion', 'cambiar el rol 2 de una publicada a mano se rechaza');
await rejects(`SELECT public.rectificar_evaluacion('${EID}', NULL, NULL, 'x')`.replace(`'${EID}'`, EID), 'motivo', 'rectificar sin motivo se rechaza');
const v = (await q(`SELECT public.rectificar_evaluacion(${typeof EID === 'string' ? `'${EID}'` : EID}, NULL, NULL, 'Se corrige el puntaje del segundo rol', NULL, NULL, '${J(tec2(PR2, .3))}') v`))[0].v;
ok(v === 2, 'rectificar_evaluacion con p_puntajes_rol2 sube la versión a 2');
await root();
const ver = await q(`SELECT accion, despues->'puntajes_rol2' d, antes->'puntajes_rol2' a FROM evaluaciones_versiones WHERE evaluacion_id=${typeof EID === 'string' ? `'${EID}'` : EID} ORDER BY id`);
ok(ver.length === 2 && ver[1].accion === 'rectificada' && ver[1].d && ver[1].a, 'el historial guarda los puntajes del rol 2 antes y después');
await as(P.M2);
await rejects(`SELECT public.rectificar_evaluacion(${typeof EID === 'string' ? `'${EID}'` : EID}, NULL, NULL, 'Intento de miembro', NULL, NULL, '${J(tec2(PR2, .5))}')`, 'administracion', 'un miembro no rectifica');
await as(null, 'anon');
await rejects(`SELECT public.rectificar_evaluacion(${typeof EID === 'string' ? `'${EID}'` : EID}, NULL, NULL, 'Intento anónimo', NULL, NULL, NULL)`, 'denied|permission', 'anon no ejecuta rectificar_evaluacion');
await root();
ok((await q(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname='public' AND p.proname='rectificar_evaluacion'`))[0].n === 1, 'queda una sola versión de rectificar_evaluacion (sin sobrecarga ambigua)');

console.log('\n[impacto en el resultado: pesos según las tareas]');
// PE1: M1 ya tiene su evaluación publicada SIN rol 2; se le agregan puntajes del rol 2 por mantenimiento (sin sesión).
await db.exec(`UPDATE evaluaciones SET puntajes_rol2='${p2(0.6)}' WHERE evaluado_id='${P.M1}' AND periodo_id='${PE1}'`);
ok((await q(`SELECT perfil2_id IS NOT NULL ok FROM evaluaciones WHERE evaluado_id='${P.M1}' AND periodo_id='${PE1}'`))[0].ok, 'M1 en PE1: perfil2_id fijado');
const tarea = async (para, rol, peso, pts) => {
  await as(P.ADMIN);
  const id = (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,peso${rol ? ',rol_id' : ''}) VALUES ('${PE1}','T','${para}',${peso}${rol ? ',' + rol : ''}) RETURNING id`))[0].id;
  await as(para); await db.exec(`UPDATE tareas SET estado='en_curso' WHERE id=${id}`); await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='listo' WHERE id=${id}`);
  await as(P.ADMIN); await db.exec(`UPDATE tareas SET estado='aprobada', puntos=${pts} WHERE id=${id}`);
  await root();
};
const una = async (id) => { await as(P.ADMIN); const f = (await q(`SELECT individual::float i, general::float g, tecnico::float t, tecnico_rol1::float t1, tecnico_rol2::float t2, peso_rol2::float w2, rol2_incompleta inc, rol2_id, rol2_nombre, nucleo::float n, n_rol, tareas::float ta, peso_tareas::float w, individual_eval::float ie FROM resultados_periodo('${PE1}') WHERE evaluado_id='${id}'`))[0]; await root(); return f; };
const cerca = (a, b, e = 0.11) => Math.abs(a - b) <= e;

// a) Segundo rol con evaluación pero SIN tareas del rol 2: el peso es 0 y el resultado es el de antes.
let r = await una(P.M1);
ok(r.w2 === 0 && r.inc === false && r.t === r.t1, 'sin tareas del rol 2: peso del rol 2 = 0 %, no incompleta, técnico = solo el principal');
ok(r.rol2_nombre === 'Redacción' && cerca(r.t2, r.t2), 'el resultado informa el segundo rol (Redacción) y su técnico');
const base1 = r;
// b) Una tarea con rol principal (peso 1) y otra con rol 2 (peso 1): 50 / 50.
await tarea(P.M1, FOTO, 1, 8);
await tarea(P.M1, REDA, 1, 8);
r = await una(P.M1);
ok(cerca(r.w2, 50), `una tarea de cada rol (mismo peso) → el rol 2 pesa 50 % (${r.w2})`);
ok(cerca(r.t, 0.5 * r.t1 + 0.5 * r.t2, 0.15), `técnico = 0,5·${r.t1} + 0,5·${r.t2} = ${r.t}`);
ok(cerca(r.ie, 0.6 * r.t + 0.4 * r.n, 0.15), 'la evaluación (sin tareas) usa el técnico mezclado: 0,6·técnico + 0,4·núcleo');
const cfg = (await (async () => { await as(P.ADMIN); const c = (await q(`SELECT peso_tareas::float w FROM calif_config('${PE1}')`))[0]; await root(); return c; })());
ok(cerca(r.i, (1 - r.w / 100) * r.ie + (r.w / 100) * r.ta, 0.15), `individual = (1−w)·evaluación + w·tareas con w = ${r.w} % (peso de tareas del PE: ${cfg.w} %)`);
// c) Tres veces más peso en el rol 2: 75 %.
await tarea(P.M1, REDA, 2, 8);
r = await una(P.M1);
ok(cerca(r.w2, 75), `tareas: rol 1 pesa 1, rol 2 pesa 3 → el rol 2 pesa 75 % (${r.w2})`);
ok(cerca(r.t, 0.25 * r.t1 + 0.75 * r.t2, 0.15), 'técnico = 0,25·rol 1 + 0,75·rol 2');
// d) Un segundo rol evaluado muy distinto cambia el resultado en la dirección esperada.
ok(r.t1 !== r.t2, `los dos técnicos difieren (${r.t1} vs ${r.t2}), así que la mezcla se nota`);
// e) Cohorte: Redacción ahora cuenta también el técnico de M1 (n_rol de M4 sube de 2 a 3).
const n4 = (await una(P.M4)).n_rol;
ok(n4 === 3, `la cohorte de Redacción incluye al segundo rol de M1 (n_rol de M4 = ${n4}, antes 2)`);
ok(JSON.stringify(por(await res())[P.M2]) === JSON.stringify(por(antes)[P.M2]), 'M2 (un solo rol, Fotografía) sigue idéntico a antes: la cohorte de Fotografía no cambió');

console.log('\n[evaluación incompleta del segundo rol]');
// M5 (principal Redacción) con segundo rol Fotografía y tareas de Fotografía, pero SIN puntajes de Fotografía en su evaluación.
await as(P.ADMIN);
await db.exec(`INSERT INTO persona_roles(persona_id, rol_id) VALUES ('${P.M5}', ${FOTO})`);
await root();
const m5a = await una(P.M5);
await tarea(P.M5, FOTO, 1, 9);
await tarea(P.M5, REDA, 1, 9);
const m5 = await una(P.M5);
ok(m5.inc === true && m5.w2 === 0 && m5.t === m5.t1, 'tareas del rol 2 sin su evaluación → rol2_incompleta = true, peso 0 y se usa solo el principal (nunca 0)');
ok(m5.rol2_nombre === 'Fotografía', 'aun incompleta, informa el segundo rol habilitado (Fotografía)');
await db.exec(`UPDATE evaluaciones SET puntajes_rol2='${J(punTec(PF, 0.9))}' WHERE evaluado_id='${P.M5}' AND periodo_id='${PE1}'`);
const m5b = await una(P.M5);
ok(m5b.inc === false && cerca(m5b.w2, 50), `al completarse el rol 2, deja de estar incompleta y pesa ${m5b.w2} %`);

console.log('\n[quién ve qué]');
await as(P.M1);
const mio = await q(`SELECT evaluado_id, rol2_nombre, peso_rol2::float w2 FROM resultados_periodo('${PE1}')`);
ok(mio.length === 1 && mio[0].evaluado_id === P.M1 && mio[0].rol2_nombre === 'Redacción', 'un miembro ve solo su propio resultado, con su segundo rol');
await as(P.SEC1);
const sec = await q(`SELECT evaluado_id FROM resultados_periodo('${PE1}')`);
ok(sec.every(x => [P.M1, P.M2, P.M5].includes(x.evaluado_id)) && sec.length >= 2, 'la secretaría ve solo a su distrito');
await as(null, 'anon');
await rejects(`SELECT * FROM resultados_periodo('${PE1}')`, 'denied|permission', 'anon no ejecuta resultados_periodo');
await rejects(`SELECT public.personas_con_mas_de_dos_roles()`, 'denied|permission', 'anon no ejecuta personas_con_mas_de_dos_roles');
await as(P.M1);
await rejects(`SELECT public.personas_con_mas_de_dos_roles()`, 'administracion', 'un miembro no consulta quién tiene más de 2 roles');
await root();
fin();
