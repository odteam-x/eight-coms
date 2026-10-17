import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

import { fileURLToPath } from 'node:url';
const DIR = fileURLToPath(new URL('.', import.meta.url));
const R = DIR + '../../supabase/migrations/';
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };

async function rejects(sql, patron, msg) {
  try { await db.exec(sql); ok(false, msg + ' (no fue rechazado)'); }
  catch (e) { ok(!patron || new RegExp(patron, 'i').test(e.message), msg + ' → ' + e.message.slice(0, 90)); }
}
const q = async (s, p) => (await db.query(s, p)).rows;
const as = async (uid) => db.exec(`SELECT set_config('request.jwt.claim.sub','${uid ?? ''}',false)`);

await db.exec(fs.readFileSync(DIR + 'stub.sql', 'utf8'));
await db.exec(`INSERT INTO gestiones(nombre,activa) VALUES ('2026-2027',true)`);
// Un período que YA existe cuando se aplica la migración (debe quedar fuera de v2).
await db.exec(`INSERT INTO periodos_evaluacion(gestion_id,nombre) SELECT id,'ANTERIOR' FROM gestiones WHERE activa`);
await db.exec(fs.readFileSync(R + '0015_rubrica_v2.sql', 'utf8'));
console.log('— migración 0015 aplicada sin errores');

console.log('\n[solo períodos nuevos]');
let rr = await q(`SELECT modelo, v2_permitido FROM periodos_evaluacion WHERE nombre='ANTERIOR'`);
ok(rr[0].modelo === 'legacy' && rr[0].v2_permitido === false, 'el período existente queda legacy y bloqueado');
const ANT = (await q(`SELECT id FROM periodos_evaluacion WHERE nombre='ANTERIOR'`))[0].id;
await rejects(`UPDATE periodos_evaluacion SET modelo='v2' WHERE id='${ANT}'`, 'anterior', 'un período anterior NO puede pasar a v2');
await rejects(`UPDATE periodos_evaluacion SET v2_permitido=true WHERE id='${ANT}'`, 'no se puede cambiar', 'nadie reabre esa puerta cambiando v2_permitido');
await db.exec(`UPDATE periodos_evaluacion SET descripcion='editado' WHERE id='${ANT}'`);
ok(true, 'el resto de sus datos se sigue pudiendo editar');
await db.exec(`INSERT INTO periodos_evaluacion(gestion_id,nombre,v2_permitido) SELECT id,'NUEVO',false FROM gestiones WHERE activa`);
rr = await q(`SELECT v2_permitido FROM periodos_evaluacion WHERE nombre='NUEVO'`);
ok(rr[0].v2_permitido === true, 'un período nuevo nace pudiendo usar v2 (el cliente no decide)');
await db.exec(`UPDATE periodos_evaluacion SET modelo='v2' WHERE nombre='NUEVO'`);
ok(true, 'un período nuevo sí pasa a v2');
await db.exec(fs.readFileSync(R + '0015_rubrica_v2.sql', 'utf8'));
rr = await q(`SELECT nombre, v2_permitido FROM periodos_evaluacion WHERE nombre IN ('ANTERIOR','NUEVO') ORDER BY nombre`);
ok(rr[0].v2_permitido === false && rr[1].v2_permitido === true, 'reaplicar la migración no cambia quién está bloqueado (idempotente)');
await db.exec(`DELETE FROM periodos_evaluacion WHERE nombre='NUEVO'`);

console.log('\n[catálogo]');
let r = await q(`SELECT tipo, count(*)::int n FROM criterios_v2 GROUP BY 1 ORDER BY 1`);
ok(r.find(x => x.tipo === 'nucleo').n === 5 && r.find(x => x.tipo === 'tecnico').n === 19, '5 núcleo + 19 técnicos');
r = await q(`SELECT count(*)::int n FROM criterios_v2 WHERE desc_1='' OR desc_3='' OR desc_5=''`);
ok(r[0].n === 0, 'los 24 llevan descriptores 1/3/5');

// seed (PENDIENTE) ejecutado tal cual: valida pesos y triggers diferidos
await db.exec(fs.readFileSync(R + '0015_seed_perfiles.PENDIENTE.sql', 'utf8'));
// Regresión: las mismas pruebas de 0015 con 0020 encima (node sql-0015.mjs --con-0020; también vale CON_0020=1).
if (process.env.CON_0020 || process.argv.includes('--con-0020')) { await db.exec(fs.readFileSync(R + '0020_criterios_dinamicos.sql', 'utf8')); console.log('— (con 0020 aplicada)'); }
console.log('\n[seed]');
r = await q(`SELECT r.nombre, sum(pc.peso)::int total FROM perfiles_rol pr JOIN roles r ON r.id=pr.rol_id
             JOIN perfil_criterios pc ON pc.perfil_id=pr.id GROUP BY 1`);
ok(r.length === 8 && r.every(x => x.total === 100), '8 perfiles, todos suman 100');
await db.exec(fs.readFileSync(R + '0015_seed_perfiles.PENDIENTE.sql', 'utf8'));
r = await q(`SELECT count(*)::int n FROM perfiles_rol`);
ok(r[0].n === 8, 'seed idempotente');

console.log('\n[reglas de perfil]');
const rolFoto = (await q(`SELECT id FROM roles WHERE nombre='Fotografía'`))[0].id;
const g = (await q(`SELECT id FROM gestiones WHERE activa`))[0].id;
await rejects(`BEGIN; WITH p AS (INSERT INTO perfiles_rol(gestion_id,rol_id,version) VALUES (${g},${rolFoto},9) RETURNING id)
  INSERT INTO perfil_criterios SELECT id,'encuadre',60 FROM p; COMMIT;`, 'sumar 100', 'perfil que suma 60 es rechazado');
await db.exec('ROLLBACK').catch(() => {});
await rejects(`BEGIN; WITH p AS (INSERT INTO perfiles_rol(gestion_id,rol_id,version) VALUES (${g},${rolFoto},9) RETURNING id)
  INSERT INTO perfil_criterios SELECT id,k,50 FROM p, (VALUES ('encuadre'),('plazos')) v(k); COMMIT;`,
  'tecnicos', 'criterio de núcleo dentro de un perfil es rechazado');
await db.exec('ROLLBACK').catch(() => {});
await rejects(`BEGIN; INSERT INTO perfiles_rol(gestion_id,rol_id,version) VALUES (${g},${rolFoto},9); COMMIT;`,
  'sumar 100', 'perfil vacío es rechazado');
await db.exec('ROLLBACK').catch(() => {});

// Usuarios
const ADMIN = '00000000-0000-0000-0000-00000000000a';
const uid = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
await db.exec(`INSERT INTO profiles(id,nombre,es_admin) VALUES ('${ADMIN}','Admin',true)`);
const rolRed = (await q(`SELECT id FROM roles WHERE nombre='Redacción'`))[0].id;
// 5 fotógrafos (distrito 08-01 los 3 primeros) y 3 redactores (rol pequeño)
for (let i = 1; i <= 5; i++) await db.exec(`INSERT INTO profiles(id,nombre,rol_id,distrito) VALUES ('${uid(i)}','Foto${i}',${rolFoto},'${i <= 3 ? '08-01' : '08-02'}')`);
for (let i = 6; i <= 8; i++) await db.exec(`INSERT INTO profiles(id,nombre,rol_id,distrito) VALUES ('${uid(i)}','Red${i}',${rolRed},'08-01')`);
await db.exec(`UPDATE profiles SET tipo_miembro='secretario' WHERE id='${uid(1)}'`);

await db.exec(`INSERT INTO periodos_evaluacion(gestion_id,nombre,activo) VALUES (${g},'PE1',false)`);
const pe = (await q(`SELECT id FROM periodos_evaluacion WHERE nombre='PE1'`))[0].id;
await db.exec(`INSERT INTO periodos_evaluacion(gestion_id,nombre) VALUES (${g},'PE2')`);
// PE2 es posterior a PE1 de verdad: dos inserciones seguidas pueden empatar en created_at (reloj de PGlite).
await db.exec(`UPDATE periodos_evaluacion SET created_at = created_at + interval '1 minute' WHERE nombre='PE2'`);
const pe2 = (await q(`SELECT id FROM periodos_evaluacion WHERE nombre='PE2'`))[0].id;

console.log('\n[evaluaciones en período legacy: nada cambia]');
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,bono_ext,estado) VALUES ('${pe2}','${uid(1)}','{"pla":0,"rev":4}',1,'publicado')`);
r = await q(`SELECT modelo, perfil_id FROM evaluaciones`);
ok(r[0].modelo === 'legacy' && r[0].perfil_id === null, 'legacy acepta 0, bono y claves viejas; modelo=legacy');
await db.exec(`DELETE FROM evaluaciones`);

await db.exec(`UPDATE periodos_evaluacion SET modelo='v2' WHERE id='${pe}'`);
const nuc = (k) => `"plazos":${k},"respuesta":${k},"colaboracion":${k},"iniciativa":${k},"calidad":${k}`;
const fotoTec = (a, b, c, d, e) => `"encuadre":${a},"tecnico":${b},"diseno":${c},"planificacion":${d},"revision":${e}`;
const ins = (i, json, estado = 'publicado', extra = '') =>
  `INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado${extra ? ',bono_ext' : ''}) VALUES ('${pe}','${uid(i)}','${json}','${estado}'${extra ? ',' + extra : ''})`;

console.log('\n[validación de evaluación v2]');
await rejects(ins(1, `{${nuc(0)},${fotoTec(3, 3, 3, 3, 3)}}`), '1 a 5', 'puntaje 0 rechazado (nunca se puntúa 0)');
await rejects(ins(1, `{${nuc(6)},${fotoTec(3, 3, 3, 3, 3)}}`), '1 a 5', 'puntaje 6 rechazado');
await rejects(ins(1, `{${nuc(3)},${fotoTec(3, 3, 3, 3, 3)},"marca":3}`), 'no aplica', 'criterio fuera del perfil (marca) rechazado');
await rejects(ins(1, `{${nuc(3)},${fotoTec(3, 3, 3, 3, 3)},"pla":3}`), 'no aplica', 'clave legacy rechazada');
await rejects(ins(1, `{${nuc(3)},${fotoTec(3.5, 3, 3, 3, 3)}}`), '1 a 5', 'decimal rechazado');
await rejects(ins(1, `{${nuc(3)},${fotoTec(3, 3, 3, 3, 3)}}`, 'publicado', '1'), 'bono', 'bono distinto de 0 rechazado');
await rejects(ins(1, `{${nuc(3)},"encuadre":4}`), 'faltan', 'publicar incompleto rechazado');
await db.exec(ins(1, `{${nuc(3)},"encuadre":4}`, 'borrador'));
ok(true, 'borrador incompleto permitido');
await db.exec(`DELETE FROM evaluaciones`);
// persona sin rol
await db.exec(`INSERT INTO profiles(id,nombre) VALUES ('${uid(20)}','SinRol')`);
await rejects(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${pe}','${uid(20)}','{}','borrador')`, 'rol', 'persona sin rol rechazada');

console.log('\n[perfil lo fija el servidor y no cambia]');
await db.exec(ins(1, `{${nuc(4)},${fotoTec(4, 4, 4, 4, 4)}}`));
r = await q(`SELECT e.perfil_id, p.rol_id FROM evaluaciones e JOIN perfiles_rol p ON p.id=e.perfil_id`);
ok(r.length === 1 && r[0].rol_id === rolFoto, 'perfil asignado = el vigente de su rol');
await db.exec(`UPDATE evaluaciones SET perfil_id = NULL WHERE evaluado_id='${uid(1)}'`);
r = await q(`SELECT perfil_id FROM evaluaciones`);
ok(r[0].perfil_id !== null, 'intentar poner perfil_id=NULL no surte efecto');
await rejects(`UPDATE perfil_criterios SET peso = peso WHERE perfil_id = (SELECT perfil_id FROM evaluaciones LIMIT 1)`,
  'ya se uso', 'perfil usado por una evaluación es inmutable');
await rejects(`DELETE FROM perfil_criterios WHERE perfil_id = (SELECT perfil_id FROM evaluaciones LIMIT 1)`,
  'ya se uso', 'tampoco se puede borrar');
await rejects(`UPDATE criterios_v2 SET key='x1' WHERE key='encuadre'`, 'en uso', 'criterio en uso no se renombra');
await rejects(`UPDATE periodos_evaluacion SET modelo='legacy' WHERE id='${pe}'`, 'modelo', 'el modelo de un período con evaluaciones no cambia');

console.log('\n[crear_perfil_rol: versionado]');
await as(uid(3));
await rejects(`SELECT crear_perfil_rol(${g},${rolFoto},'{"encuadre":100}'::jsonb,'${pe2}')`, 'administrador', 'un miembro no puede crear perfiles');
await as(ADMIN);
await rejects(`SELECT crear_perfil_rol(${g},${rolFoto},'{"encuadre":100}'::jsonb,NULL)`, 'desde que periodo', 'versión nueva exige período de entrada');
await rejects(`SELECT crear_perfil_rol(${g},${rolFoto},'{"encuadre":100}'::jsonb,'${pe}')`, 'evaluaciones', 'no se puede entrar en vigor en un período que ya tiene evaluaciones');
await rejects(`SELECT crear_perfil_rol(${g},${rolFoto},'{"encuadre":60}'::jsonb,'${pe2}')`, 'sumar 100', 'versión con suma 60 rechazada (y revertida)');
r = await q(`SELECT count(*)::int n FROM perfiles_rol WHERE rol_id=${rolFoto}`);
ok(r[0].n === 1, 'la versión fallida no dejó rastro');
const nuevo = (await q(`SELECT crear_perfil_rol(${g},${rolFoto},'{"encuadre":50,"tecnico":50}'::jsonb,'${pe2}') id`))[0].id;
ok(!!nuevo, 'versión 2 creada para PE2');
r = await q(`SELECT perfil_vigente(${rolFoto},'${pe}') a, perfil_vigente(${rolFoto},'${pe2}') b`);
ok(r[0].a !== r[0].b && r[0].b === nuevo, 'PE1 sigue con v1; PE2 usa v2');
await as(null);

console.log('\n[cálculo: resultados_periodo]');
// Foto1..5 con técnico creciente; núcleo distinto; 3 redactores (rol pequeño)
await db.exec(`DELETE FROM evaluaciones`);
const tecN = { 1: 2, 2: 3, 3: 3, 4: 4, 5: 5 };      // Foto3 empata con Foto2
const nucN = { 1: 5, 2: 3, 3: 3, 4: 3, 5: 1 };
for (let i = 1; i <= 5; i++) {
  const t = tecN[i];
  await db.exec(ins(i, `{${nuc(nucN[i])},${fotoTec(t, t, t, t, t)}}`));
}
const redTec = { 6: 2, 7: 4, 8: 5 };
const redT = (t) => `"narrativa":${t},"ortografia":${t},"revision":${t},"planificacion":${t}`;
for (const i of [6, 7, 8]) await db.exec(ins(i, `{${nuc(3)},${redT(redTec[i])}}`));

await as(ADMIN);
const res = await q(`SELECT * FROM resultados_periodo('${pe}')`);
const por = Object.fromEntries(res.map(x => [x.nombre, x]));
const n = x => Number(x);
// (s-1)/4*100: 2→25, 3→50, 4→75, 5→100
ok(n(por.Foto1.tecnico) === 25 && n(por.Foto5.tecnico) === 100, 'técnico normalizado 0–100');
ok(n(por.Foto1.nucleo) === 100 && n(por.Foto5.nucleo) === 0, 'núcleo normalizado (5→100, 1→0)');
ok(n(por.Foto1.individual) === 0.6 * 25 + 0.4 * 100, 'individual = 0.6·téc + 0.4·núcleo');
ok(n(por.Foto1.percentil) === 0 && n(por.Foto5.percentil) === 100, 'percentil: último 0, primero 100 (pos−1)/(n−1)');
ok(n(por.Foto2.percentil) === 37.5 && n(por.Foto3.percentil) === 37.5, 'empate → media de posiciones (2 y 3 → 37,5)');
ok(n(por.Foto4.percentil) === 75, 'percentil intermedio exacto');
ok(n(por.Foto5.general) === 0.4 * 0 + 0.6 * 100, 'general = 0.4·núcleo + 0.6·percentil');
ok(por.Foto5.rol_pequeno === false && por.Foto5.n_rol === 5, 'rol de 5: no es pequeño');
ok(por.Red6.rol_pequeno === true && por.Red6.percentil === null, 'rol de 3: pequeño, sin percentil');
ok(n(por.Red8.general) === 0.4 * 50 + 0.6 * 100, 'rol pequeño: el percentil se sustituye por el técnico absoluto');
ok(n(por.Red7.general) === 0.4 * 50 + 0.6 * 75, 'rol pequeño, otra persona');

console.log('\n[visibilidad]');
await as(uid(1));   // secretario del 08-01
let vis = (await q(`SELECT nombre FROM resultados_periodo('${pe}')`)).map(x => x.nombre).sort();
ok(vis.join() === 'Foto1,Foto2,Foto3,Red6,Red7,Red8', 'secretario ve su distrito: ' + vis.join());
ok(n((await q(`SELECT percentil FROM resultados_periodo('${pe}') WHERE nombre='Foto2'`))[0].percentil) === 37.5,
   'su percentil cuenta a pares de otro distrito');
await as(uid(5));   // miembro de otro distrito
vis = (await q(`SELECT nombre FROM resultados_periodo('${pe}')`)).map(x => x.nombre);
ok(vis.length === 1 && vis[0] === 'Foto5', 'miembro ve solo lo suyo');
await as(uid(5));
vis = await q(`SELECT 1 FROM resultados_periodo('${pe}', true)`);
ok(vis.length === 1, 'el flag de borradores no amplía lo que ve un miembro');
await as(null);
await rejects(`SELECT * FROM resultados_periodo('${pe}')`, 'sesion', 'sin sesión se deniega (guardia en el sentido correcto)');

console.log('\n[borradores y período legacy]');
await db.exec(`DELETE FROM evaluaciones WHERE evaluado_id='${uid(4)}'`);
await db.exec(ins(4, `{${nuc(3)},"encuadre":4}`, 'borrador'));
await as(ADMIN);
r = await q(`SELECT 1 FROM resultados_periodo('${pe}') WHERE nombre='Foto4'`);
ok(r.length === 0, 'borrador no cuenta por defecto');
r = await q(`SELECT 1 FROM resultados_periodo('${pe}', true) WHERE nombre='Foto4'`);
ok(r.length === 1, 'el admin puede previsualizar borradores');
r = await q(`SELECT 1 FROM resultados_periodo('${pe2}')`);
ok(r.length === 0, 'período sin v2 → sin resultados');

console.log('\n[abrir_gestion clona v2]');
await db.exec(`INSERT INTO criterios(gestion_id,key,label,abbr,color,orden,activo,max) VALUES (${g},'pla','P','PLA','#fff',0,true,4)`);
const ng = (await q(`SELECT abrir_gestion('2027-2028') id`))[0].id;
r = await q(`SELECT (SELECT count(*)::int FROM criterios_v2 WHERE gestion_id=${ng}) c,
                    (SELECT count(*)::int FROM perfiles_rol WHERE gestion_id=${ng}) p,
                    (SELECT count(*)::int FROM perfil_criterios pc JOIN perfiles_rol pr ON pr.id=pc.perfil_id WHERE pr.gestion_id=${ng}) pc,
                    (SELECT max(version) FROM perfiles_rol WHERE gestion_id=${ng}) v,
                    (SELECT count(*)::int FROM periodos_evaluacion WHERE gestion_id=${ng} AND modelo='v2') pv`);
ok(r[0].c === 24 && r[0].p === 8 && r[0].v === 1 && r[0].pv === 3, `clonados (los 3 períodos de la gestión nueva son v2): ${JSON.stringify(r[0])}`);
r = await q(`SELECT sum(peso)::int s FROM perfil_criterios pc JOIN perfiles_rol pr ON pr.id=pc.perfil_id
              WHERE pr.gestion_id=${ng} AND pr.rol_id=${rolFoto}`);
ok(r[0].s === 100, 'el perfil clonado de Fotografía es el último (v2: suma 100)');
await as(null);

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
