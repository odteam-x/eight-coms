import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const R = DIR + '../../supabase/migrations/';
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };
const q = async s => (await db.query(s)).rows;
const as = async (uid, role = 'authenticated') => {
  await db.exec('RESET ROLE');
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid ?? ''}',false)`);
  await db.exec(`SET ROLE ${role}`);
};
const root = async () => { await db.exec('RESET ROLE'); await db.exec(`SELECT set_config('request.jwt.claim.sub','',false)`); };
async function rejects(sql, patron, msg) {
  try { await db.exec(sql); ok(false, msg + ' (NO fue rechazado)'); }
  catch (e) { ok(!patron || new RegExp(patron, 'i').test(e.message), msg + ' → ' + String(e.message).slice(0, 90)); }
}
async function allowed(sql, msg) {
  try { await db.exec(sql); ok(true, msg); } catch (e) { ok(false, msg + ' → ' + String(e.message).slice(0, 140)); }
}
const uid = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const ADMIN = uid(90), SEC1 = uid(91), M1 = uid(1), M2 = uid(2);

await db.exec(fs.readFileSync(DIR + 'stub.sql', 'utf8'));
await db.exec(`
  INSERT INTO gestiones(nombre, activa) VALUES ('2026-2027', true);
  INSERT INTO gestiones(nombre, activa, archivada) VALUES ('2025-2026', false, true);
  INSERT INTO periodos_evaluacion(gestion_id,nombre) SELECT id,'LEG' FROM gestiones WHERE activa;
`);
await db.exec(fs.readFileSync(R + '0015_rubrica_v2.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0015_seed_perfiles.PENDIENTE.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0020_criterios_dinamicos.sql', 'utf8'));
console.log('— 0015 + 0020 aplicadas sin errores');
await db.exec(fs.readFileSync(R + '0020_criterios_dinamicos.sql', 'utf8'));
console.log('— 0020 reaplicada (idempotente)');
// Permisos de tabla como en Supabase (la RLS es lo que decide quién escribe)
await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
               GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;`);

const G = (await q(`SELECT id FROM gestiones WHERE activa`))[0].id;
const GA = (await q(`SELECT id FROM gestiones WHERE archivada`))[0].id;
const rolFoto = (await q(`SELECT id FROM roles WHERE nombre='Fotografía'`))[0].id;
await db.exec(`
  INSERT INTO profiles(id,nombre,es_admin) VALUES ('${ADMIN}','Admin',true);
  INSERT INTO profiles(id,nombre,tipo_miembro,distrito) VALUES ('${SEC1}','Sec1','secretario','08-01');
  INSERT INTO profiles(id,nombre,rol_id,distrito) VALUES ('${M1}','M1',${rolFoto},'08-01'),('${M2}','M2',${rolFoto},'08-01'),
         ('${uid(3)}','M3',${rolFoto},'08-01'),('${uid(4)}','M4',${rolFoto},'08-01');
  INSERT INTO periodos_evaluacion(gestion_id,nombre,modelo) VALUES (${G},'PE1','v2'),(${G},'PE2','v2');
  -- PE2 es posterior a PE1 de verdad: dos filas del mismo INSERT pueden empatar en created_at (reloj de PGlite) y la prueba dependía de la suerte.
  UPDATE periodos_evaluacion SET created_at = created_at + interval '1 minute' WHERE nombre = 'PE2';
`);
const PE = (await q(`SELECT id FROM periodos_evaluacion WHERE nombre='PE1'`))[0].id;
const PE2 = (await q(`SELECT id FROM periodos_evaluacion WHERE nombre='PE2'`))[0].id;

console.log('\n[lo existente no cambia]');
let r = await q(`SELECT count(*)::int n, bool_and(tipo_campo='escala') esc, bool_and(obligatorio) obl, bool_and(opciones='[]'::jsonb) op
                   FROM criterios_v2 WHERE gestion_id=${G}`);
ok(r[0].n === 24 && r[0].esc && r[0].obl && r[0].op, 'los 24 criterios de 0015 quedan de escala, obligatorios y sin opciones');

console.log('\n[crear criterios: quién y cómo]');
await as(ADMIN);
await allowed(`INSERT INTO criterios_v2(gestion_id,nombre,tipo) VALUES (${G},'Trato con el público','tecnico')`, 'admin crea un criterio técnico sin clave');
r = await q(`SELECT key, orden, created_by, tipo_campo, obligatorio FROM criterios_v2 WHERE nombre='Trato con el público'`);
ok(r[0].key === 'trato_con_el_publico', `la clave se deriva del nombre sin tildes: ${r[0].key}`);
ok(r[0].orden === 25 && r[0].created_by === ADMIN && r[0].tipo_campo === 'escala' && r[0].obligatorio === true, 'orden al final, created_by fijado por el servidor, escala y obligatorio por defecto');
await allowed(`INSERT INTO criterios_v2(gestion_id,nombre,tipo) VALUES (${G},'Trato con el público','tecnico')`, 'mismo nombre de nuevo');
r = await q(`SELECT key FROM criterios_v2 WHERE nombre='Trato con el público' ORDER BY id`);
ok(r.map(x => x.key).join() === 'trato_con_el_publico,trato_con_el_publico_2', 'la clave repetida se desambigua: ' + r.map(x => x.key).join());
await allowed(`INSERT INTO criterios_v2(gestion_id,nombre,tipo,tipo_campo,descripcion,obligatorio) VALUES (${G},'Observaciones del evaluador','nucleo','texto','Contexto libre',false)`, 'campo de registro de texto, opcional');
await allowed(`INSERT INTO criterios_v2(gestion_id,nombre,tipo,tipo_campo,obligatorio) VALUES (${G},'Asistió a la jornada','nucleo','si_no',true)`, 'campo sí/no obligatorio');
await allowed(`INSERT INTO criterios_v2(gestion_id,nombre,tipo,tipo_campo,opciones,obligatorio) VALUES (${G},'Modalidad','nucleo','opcion','["Presencial"," Remota ","Mixta"]',false)`, 'campo de opciones, opcional');
r = await q(`SELECT opciones FROM criterios_v2 WHERE key='modalidad'`);
ok(JSON.stringify(r[0].opciones) === '["Presencial","Remota","Mixta"]', 'las opciones se guardan sin espacios sobrantes');

console.log('\n[validación de la definición]');
await rejects(`INSERT INTO criterios_v2(gestion_id,nombre,tipo) VALUES (${G},'   ','tecnico')`, 'nombre', 'nombre vacío');
await rejects(`INSERT INTO criterios_v2(gestion_id,nombre,tipo) VALUES (${G},'${'x'.repeat(81)}','tecnico')`, 'nombre', 'nombre de más de 80 caracteres');
await rejects(`INSERT INTO criterios_v2(gestion_id,nombre,tipo,descripcion) VALUES (${G},'Larga','tecnico','${'d'.repeat(501)}')`, 'descripcion|check|violates', 'descripción de más de 500');
await rejects(`INSERT INTO criterios_v2(gestion_id,nombre,tipo,tipo_campo,opciones) VALUES (${G},'Una sola','nucleo','opcion','["Única"]')`, 'entre 2 y 12', 'opciones: mínimo 2');
await rejects(`INSERT INTO criterios_v2(gestion_id,nombre,tipo,tipo_campo,opciones) VALUES (${G},'Repetidas','nucleo','opcion','["A","a"]')`, 'repetida', 'opciones repetidas (sin distinguir mayúsculas)');
await rejects(`INSERT INTO criterios_v2(gestion_id,nombre,tipo,tipo_campo,opciones) VALUES (${G},'Vacía','nucleo','opcion','["A","  "]')`, 'entre 1 y 60', 'opción en blanco');
await rejects(`INSERT INTO criterios_v2(gestion_id,nombre,tipo,tipo_campo,opciones) VALUES (${G},'Larga op','nucleo','opcion','["A","${'o'.repeat(61)}"]')`, 'entre 1 y 60', 'opción de más de 60');
await rejects(`INSERT INTO criterios_v2(gestion_id,nombre,tipo,tipo_campo) VALUES (${G},'Sin opciones','nucleo','opcion')`, 'entre 2 y 12', 'tipo opción sin opciones');
await rejects(`INSERT INTO criterios_v2(gestion_id,nombre,tipo,tipo_campo) VALUES (${G},'Técnico de texto','tecnico','texto')`, 'comunes a todos', 'un técnico no puede ser campo de registro');
await rejects(`INSERT INTO criterios_v2(gestion_id,nombre,tipo,tipo_campo) VALUES (${G},'Raro','nucleo','fecha')`, 'check|violates', 'tipo de campo desconocido');
await rejects(`INSERT INTO criterios_v2(gestion_id,key,nombre,tipo) VALUES (${G},'Con Mayusculas','Mal','tecnico')`, 'check|violates', 'clave mal formada');
await db.exec(`INSERT INTO criterios_v2(gestion_id,nombre,tipo,tipo_campo,opciones,obligatorio) VALUES (${G},'Texto con opciones','nucleo','texto','["A","B"]',false)`);
r = await q(`SELECT opciones FROM criterios_v2 WHERE key='texto_con_opciones'`);
ok(JSON.stringify(r[0].opciones) === '[]', 'las opciones que no corresponden al tipo se descartan');

console.log('\n[quién puede escribir]');
await rejects(`INSERT INTO criterios_v2(gestion_id,nombre,tipo) VALUES (${GA},'En archivo','tecnico')`, 'row-level|policy', 'no se crea en una gestión archivada');
await as(SEC1);
await rejects(`INSERT INTO criterios_v2(gestion_id,nombre,tipo) VALUES (${G},'De secretaría','tecnico')`, 'row-level|policy', 'la secretaría no crea criterios');
await as(M1);
await rejects(`INSERT INTO criterios_v2(gestion_id,nombre,tipo) VALUES (${G},'De miembro','tecnico')`, 'row-level|policy', 'un miembro no crea criterios');
ok((await q(`SELECT count(*)::int n FROM criterios_v2 WHERE gestion_id=${G}`))[0].n >= 24, 'cualquiera autenticado lee el catálogo');
await as(null, 'anon');
await rejects(`SELECT count(*) FROM criterios_v2`, 'permission|denied', 'sin sesión no se lee nada');
await root();

console.log('\n[perfiles con criterios nuevos]');
await as(ADMIN);
await allowed(`SELECT crear_perfil_rol(${G}, ${rolFoto}, '{"trato_con_el_publico":60,"encuadre":40}'::jsonb, '${PE2}')`, 'un criterio técnico nuevo entra en una versión nueva del perfil (rige desde PE2)');
await root();
r = await q(`SELECT perfil_vigente(${rolFoto},'${PE}') a, perfil_vigente(${rolFoto},'${PE2}') b`);
ok(r[0].a !== r[0].b, 'PE1 sigue con el perfil anterior; PE2 usa el que pesa el criterio nuevo');

console.log('\n[evaluar con campos nuevos]');
const nuc = k => `"plazos":${k},"respuesta":${k},"colaboracion":${k},"iniciativa":${k},"calidad":${k}`;
const fotoTec = k => `"encuadre":${k},"tecnico":${k},"diseno":${k},"planificacion":${k},"revision":${k}`;
const ev = (i, punt, resp = '{}', estado = 'publicado', pe = PE) =>
  `INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,respuestas,estado) VALUES ('${pe}','${uid(i)}','${punt}','${resp}','${estado}')`;
const base = `{${nuc(4)},${fotoTec(4)}}`;
await rejects(ev(1, base), 'faltan', 'publicar sin el campo obligatorio de registro');
await allowed(ev(1, base, '{"asistio_a_la_jornada":true}'), 'publicar con el sí/no respondido (los opcionales se omiten)');
await rejects(ev(2, base, '{"asistio_a_la_jornada":"si"}'), 'si o no', 'sí/no con un texto');
await rejects(ev(2, base, '{"asistio_a_la_jornada":true,"modalidad":"Híbrida"}'), 'opciones', 'una opción que no existe');
await rejects(ev(2, base, '{"asistio_a_la_jornada":true,"modalidad":7}'), 'opciones', 'opción que no es texto');
await rejects(ev(2, base, '{"asistio_a_la_jornada":true,"observaciones_del_evaluador":"   "}'), 'texto', 'texto en blanco');
await rejects(ev(2, base, `{"asistio_a_la_jornada":true,"observaciones_del_evaluador":"${'a'.repeat(1001)}"}`), 'texto', 'texto de más de 1000');
await rejects(ev(2, base, '{"asistio_a_la_jornada":true,"inventado":1}'), 'no aplica', 'un campo que no existe');
await rejects(ev(2, `{${nuc(4)},${fotoTec(4)},"asistio_a_la_jornada":3}`, '{"asistio_a_la_jornada":true}'), 'no aplica', 'un campo de registro no puede ir en los puntajes');
await allowed(ev(2, base, '{"asistio_a_la_jornada":false,"modalidad":"Remota","observaciones_del_evaluador":"Llegó tarde por transporte."}'), 'respuestas de los tres tipos');
r = await q(`SELECT respuestas FROM evaluaciones WHERE evaluado_id='${uid(2)}'`);
ok(r[0].respuestas.modalidad === 'Remota', 'las respuestas se guardan y se recuperan');

console.log('\n[opcional de escala: queda fuera, no vale 0]');
await db.exec(`UPDATE criterios_v2 SET obligatorio=false WHERE key='iniciativa'`);
const sinIni = `{"plazos":4,"respuesta":4,"colaboracion":4,"calidad":4,${fotoTec(4)}}`;
await db.exec(`DELETE FROM evaluaciones WHERE evaluado_id='${uid(1)}'`);
await allowed(ev(1, sinIni, '{"asistio_a_la_jornada":true}'), 'publicar sin el criterio de escala opcional');
await as(ADMIN);
r = await q(`SELECT nucleo FROM resultados_periodo('${PE}') WHERE nombre='M1'`);
ok(Number(r[0].nucleo) === 75, `el núcleo promedia solo lo puntuado (4→75): ${r[0].nucleo}`);
await root();
await db.exec(`UPDATE criterios_v2 SET obligatorio=true WHERE key='iniciativa'`);
await rejects(ev(3, sinIni, '{"asistio_a_la_jornada":true}'), 'faltan', 'con el criterio otra vez obligatorio, faltar bloquea');

console.log('\n[historia: desactivar no reescribe lo evaluado]');
await db.exec(`UPDATE criterios_v2 SET activo=false WHERE key IN ('modalidad','encuadre')`);
await allowed(`UPDATE evaluaciones SET comentarios='{"general":"revisado"}' WHERE evaluado_id='${uid(2)}'`, 'una evaluación que contiene criterios ya desactivados se puede seguir guardando');
await rejects(`UPDATE evaluaciones SET respuestas = respuestas || '{"modalidad":"Mixta"}' WHERE evaluado_id='${uid(1)}'`, 'no aplica', 'pero no se agrega un campo desactivado donde no estaba');
await allowed(ev(3, `{${nuc(4)},"tecnico":4,"diseno":4,"planificacion":4,"revision":4}`, '{"asistio_a_la_jornada":true}'), 'una evaluación nueva no exige un criterio desactivado (encuadre)');
await rejects(ev(4, `{${nuc(4)},${fotoTec(4)}}`, '{"asistio_a_la_jornada":true}'), 'no aplica', 'ni deja puntuarlo');
await db.exec(`UPDATE criterios_v2 SET activo=true WHERE key IN ('modalidad','encuadre')`);

console.log('\n[uso: no se borra ni se reinterpreta]');
await as(ADMIN);
await allowed(`DELETE FROM criterios_v2 WHERE key='texto_con_opciones'`, 'un criterio sin uso se elimina');
await rejects(`DELETE FROM criterios_v2 WHERE key='asistio_a_la_jornada'`, 'en uso', 'uno usado por evaluaciones no se elimina');
await rejects(`DELETE FROM criterios_v2 WHERE key='trato_con_el_publico'`, 'en uso', 'uno que un perfil pesa tampoco');
await rejects(`UPDATE criterios_v2 SET tipo_campo='texto' WHERE key='modalidad'`, 'en uso', 'no cambia de tipo de campo si hay evaluaciones');
await rejects(`UPDATE criterios_v2 SET opciones='["Presencial","Mixta"]' WHERE key='modalidad'`, 'Remota', 'no se quita una opción ya usada');
await allowed(`UPDATE criterios_v2 SET opciones='["Presencial","Remota","Mixta","Híbrida"]' WHERE key='modalidad'`, 'sí se pueden agregar opciones');
await allowed(`UPDATE criterios_v2 SET nombre='Modalidad de asistencia', descripcion='Cómo asistió', obligatorio=false, orden=40 WHERE key='modalidad'`, 'nombre, descripción, obligatorio y orden se editan libremente');
await rejects(`UPDATE criterios_v2 SET key='otra' WHERE key='modalidad'`, 'en uso', 'la clave de uno usado no cambia');
await allowed(`UPDATE criterios_v2 SET nombre='Trato con el público (2)' WHERE key='trato_con_el_publico_2'`, 'uno sin uso se edita');
await allowed(`UPDATE criterios_v2 SET tipo='nucleo' WHERE key='trato_con_el_publico_2'`, 'uno sin uso puede cambiar de tipo');

console.log('\n[perfil: solo escala]');
await root();
const rolRed = (await q(`SELECT id FROM roles WHERE nombre='Redacción'`))[0].id;
await rejects(`BEGIN; WITH p AS (INSERT INTO perfiles_rol(gestion_id,rol_id,version) VALUES (${G},${rolRed},9) RETURNING id)
  INSERT INTO perfil_criterios SELECT id,k,50 FROM p, (VALUES ('narrativa'),('modalidad')) v(k); COMMIT;`, 'escala|tecnicos', 'un campo de registro no entra en un perfil');
await db.exec('ROLLBACK').catch(() => {});

console.log('\n[abrir_gestion clona los campos nuevos]');
await as(ADMIN);
const ng = (await q(`SELECT abrir_gestion('2027-2028') id`))[0].id;
r = await q(`SELECT key, tipo_campo, obligatorio, opciones, descripcion FROM criterios_v2 WHERE gestion_id=${ng} AND key IN ('modalidad','asistio_a_la_jornada','observaciones_del_evaluador') ORDER BY key`);
ok(r.length === 3 && r.find(x => x.key === 'modalidad').tipo_campo === 'opcion'
   && JSON.stringify(r.find(x => x.key === 'modalidad').opciones) === '["Presencial","Remota","Mixta","Híbrida"]'
   && r.find(x => x.key === 'observaciones_del_evaluador').obligatorio === false
   && r.find(x => x.key === 'observaciones_del_evaluador').descripcion === 'Contexto libre', 'tipo, opciones, obligatorio y descripción viajan a la gestión nueva');
await root();

console.log('\n[legacy intacto]');
const LEG = (await q(`SELECT id FROM periodos_evaluacion WHERE nombre='LEG'`))[0].id;
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,bono_ext,respuestas,estado) VALUES ('${LEG}','${M2}','{"pla":0}',1,'{"x":1}','publicado')`);
r = await q(`SELECT modelo, respuestas FROM evaluaciones WHERE periodo_id='${LEG}'`);
ok(r[0].modelo === 'legacy' && JSON.stringify(r[0].respuestas) === '{}', 'un período clásico no guarda respuestas y conserva su regla');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
