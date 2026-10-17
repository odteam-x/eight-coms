// Pruebas de 0021 (roles operativos: descripción, permitidos, preferencias, rol en la tarea, personas asignables)
// contra Postgres real (PGlite), con RLS. Mismo patrón que sql-0023.mjs.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const R = DIR + '../../supabase/migrations/';
const db = new PGlite();
let pass = 0, fail = 0, _quien = null;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };
const q = async s => (await db.query(s)).rows;
const as = async (uid, role = 'authenticated') => {
  _quien = role === 'authenticated' ? uid : null;
  await db.exec('RESET ROLE');
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid ?? ''}',false)`);
  await db.exec(`SET ROLE ${role}`);
};
const root = async () => { _quien = null; await db.exec('RESET ROLE'); await db.exec(`SELECT set_config('request.jwt.claim.sub','',false)`); };
async function rejects(sql, patron, msg) {
  try { await db.exec(sql); ok(false, msg + ' (NO fue rechazado)'); }
  catch (e) { ok(!patron || new RegExp(patron, 'i').test(e.message), msg + ' → ' + String(e.message).slice(0, 100)); }
}
async function allowed(sql, msg) {
  try { await db.exec(sql); ok(true, msg); } catch (e) { ok(false, msg + ' → ' + String(e.message).slice(0, 160)); }
}
const uid = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const ADMIN = uid(90), SEC1 = uid(91), SEC2 = uid(92), M1 = uid(1), M2 = uid(2), M3 = uid(3);

// ── Esquema base: stub + lo mínimo de producción que usan 0016/0017/0018/0021 ──
await db.exec(fs.readFileSync(DIR + 'stub.sql', 'utf8'));
await db.exec(`
  ALTER TABLE public.profiles ADD COLUMN aprobado BOOLEAN DEFAULT true;
  CREATE TABLE public.config (gestion_id BIGINT, clave TEXT, valor TEXT, PRIMARY KEY (gestion_id, clave));
  CREATE TABLE public.periodo_participantes (periodo_id UUID, user_id UUID, activo BOOLEAN DEFAULT true, PRIMARY KEY (periodo_id, user_id));
  CREATE TABLE public.trabajos_entregados (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id UUID, periodo_id UUID,
     titulo TEXT DEFAULT '', descripcion TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
  INSERT INTO gestiones(nombre, activa) VALUES ('2026-2027', true);
  INSERT INTO gestiones(nombre, activa, archivada) VALUES ('2025-2026', false, true);
  INSERT INTO roles(nombre) VALUES ('Fotografía'),('Redacción'),('Edición'),('Diseño');
  -- Las políticas de producción sobre roles (supabase-schema.sql): leen todas las autenticadas, escribe solo admin.
  ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
  CREATE POLICY roles_auth_read ON public.roles FOR SELECT TO authenticated USING (true);
  CREATE POLICY roles_admin_write ON public.roles FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
`);
const rid = async n => (await q(`SELECT id FROM roles WHERE nombre='${n}'`))[0].id;
const FOTO = await rid('Fotografía'), REDA = await rid('Redacción'), EDIC = await rid('Edición'), DISE = await rid('Diseño');
await db.exec(`
  INSERT INTO profiles(id,nombre,es_admin) VALUES ('${ADMIN}','Admin',true);
  INSERT INTO profiles(id,nombre,tipo_miembro,distrito,rol_id) VALUES ('${SEC1}','Sec1','secretario','08-01',${REDA}),('${SEC2}','Sec2','secretario','08-02',${REDA});
  INSERT INTO profiles(id,nombre,distrito,rol_id,email) VALUES ('${M1}','M1','08-01',${FOTO},'m1@x.cl'),('${M2}','M2','08-01',${REDA},'m2@x.cl'),('${M3}','M3','08-02',${FOTO},'m3@x.cl');
  INSERT INTO periodos_evaluacion(gestion_id,nombre) SELECT id,'LEG' FROM gestiones WHERE activa;
`);
await db.exec(fs.readFileSync(R + '0015_rubrica_v2.sql', 'utf8'));
await db.exec(`INSERT INTO periodos_evaluacion(gestion_id,nombre,modelo) SELECT id,'PE1','v2' FROM gestiones WHERE activa`);
await db.exec(`INSERT INTO periodos_evaluacion(gestion_id,nombre,modelo) SELECT id,'OLD','v2' FROM gestiones WHERE archivada`);
await db.exec(fs.readFileSync(R + '0016_tareas.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0017_tareas_puntos.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0018_actividades.sql', 'utf8'));
const PE = (await q(`SELECT id FROM periodos_evaluacion WHERE nombre='PE1'`))[0].id;
const G = (await q(`SELECT id FROM gestiones WHERE activa`))[0].id;
const GA = (await q(`SELECT id FROM gestiones WHERE archivada`))[0].id;

// Una tarea que ya existía ANTES de 0021: debe sobrevivir intacta.
await as(ADMIN);
await db.exec(`INSERT INTO tareas(periodo_id,titulo,asignada_a) VALUES ('${PE}','Tarea previa','${M1}')`);
await root();
const antes = (await q(`SELECT id, titulo, estado FROM tareas WHERE titulo='Tarea previa'`))[0];

await db.exec(fs.readFileSync(R + '0021_roles_preferencias.sql', 'utf8'));
await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
               GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;`);
await db.exec(fs.readFileSync(R + '0021_roles_preferencias.sql', 'utf8'));
console.log('— 0021 aplicada sin errores (dos veces: es idempotente)');
// Lo que en Supabase sale de REVOKE explícito (las migraciones lo hacen; el GRANT masivo de arriba solo emula el entorno).
await db.exec(`REVOKE EXECUTE ON FUNCTION public.roles_permitidos_de(UUID), public.persona_roles_fijar(), public.preferencias_rol_validar(),
               public.tareas_rol_validar(), public.preferencias_limpiar_predeterminado() FROM PUBLIC, anon, authenticated;
               REVOKE ALL ON public.persona_roles, public.preferencias_rol FROM anon;
               REVOKE INSERT, UPDATE, DELETE ON public.preferencias_rol FROM authenticated;`);

console.log('\n[nada se pierde]');
await root();
const despues = (await q(`SELECT id, titulo, estado, rol_id, rol_excepcion, actividad_id FROM tareas WHERE id=${antes.id}`))[0];
ok(despues.titulo === antes.titulo && despues.estado === antes.estado, 'la tarea previa conserva título y estado');
ok(despues.rol_id === null && despues.rol_excepcion === false && despues.actividad_id === null, 'y empieza sin rol ni actividad (columnas nuevas opcionales)');
ok((await q(`SELECT count(*)::int n FROM persona_roles`))[0].n === 0, 'persona_roles empieza vacía: cada persona solo tiene su rol principal');
ok((await q(`SELECT descripcion, responsabilidades, requisitos FROM roles WHERE id=${FOTO}`))[0].descripcion === '', 'los roles existentes quedan con descripción vacía');

console.log('\n[descripción, responsabilidades y requisitos del rol]');
await as(ADMIN);
await allowed(`UPDATE roles SET descripcion='Cubre los eventos', responsabilidades='Cobertura\nEdición básica', requisitos='Cámara propia' WHERE id=${FOTO}`, 'admin edita los tres textos del rol');
await as(M1);
ok((await q(`SELECT descripcion FROM roles WHERE id=${FOTO}`))[0].descripcion === 'Cubre los eventos', 'cualquier persona los lee');
await db.exec(`UPDATE roles SET descripcion='Hackeado' WHERE id=${FOTO}`);   // sin política de escritura: 0 filas, sin error
await root();
ok((await q(`SELECT descripcion FROM roles WHERE id=${FOTO}`))[0].descripcion === 'Cubre los eventos', 'y el texto sigue intacto');
await as(ADMIN);
await rejects(`UPDATE roles SET descripcion='${'x'.repeat(1001)}' WHERE id=${FOTO}`, 'roles_textos_chk|check', 'una descripción de más de 1000 caracteres se rechaza');
await rejects(`UPDATE roles SET responsabilidades='${'x'.repeat(2001)}' WHERE id=${FOTO}`, 'roles_textos_chk|check', 'responsabilidades de más de 2000 se rechazan');

console.log('\n[roles permitidos]');
await root();
// Función interna: solo la puede llamar el dueño, así que se consulta como superusuario y se vuelve al rol anterior.
const permitidos = async p => { const prev = _quien; await root(); const r = (await q(`SELECT roles_permitidos_de('${p}') r`)).map(x => Number(x.r)).sort(); if (prev) await as(prev); return r; };
ok(JSON.stringify(await permitidos(M1)) === JSON.stringify([FOTO]), 'sin nada extra, lo permitido es solo el rol principal');
await as(ADMIN);
await allowed(`INSERT INTO persona_roles(persona_id,rol_id) VALUES ('${M1}',${EDIC})`, 'admin habilita un rol más a M1');
ok((await q(`SELECT asignado_por FROM persona_roles WHERE persona_id='${M1}'`))[0].asignado_por === ADMIN, 'asignado_por lo fija el servidor');
await rejects(`INSERT INTO persona_roles(persona_id,rol_id) VALUES ('${M1}',${EDIC})`, 'duplicate|unique|violates', 'no se repite el mismo permitido');
await root();
await db.exec(`INSERT INTO roles(nombre, activo) VALUES ('Archivado', false)`);
await as(ADMIN);
await rejects(`INSERT INTO persona_roles(persona_id,rol_id) SELECT '${M1}', id FROM roles WHERE nombre='Archivado'`, 'inactivo', 'no se habilita un rol inactivo');
await root();
ok(JSON.stringify(await permitidos(M1)) === JSON.stringify([FOTO, EDIC].sort()), 'permitidos = principal + habilitados');
await as(M1);
await rejects(`INSERT INTO persona_roles(persona_id,rol_id) VALUES ('${M1}',${DISE})`, 'row-level|policy', 'un miembro NO se habilita roles a sí mismo');
ok((await q(`SELECT count(*)::int n FROM persona_roles`))[0].n === 1, 've los suyos');
await as(M2);
ok((await q(`SELECT count(*)::int n FROM persona_roles`))[0].n === 0, 'otro miembro no ve los de M1');
await as(SEC1);
ok((await q(`SELECT count(*)::int n FROM persona_roles`))[0].n === 1, 'la secretaría del distrito sí los ve');
await rejects(`INSERT INTO persona_roles(persona_id,rol_id) VALUES ('${M2}',${EDIC})`, 'row-level|policy', 'pero la secretaría tampoco habilita roles');
await as(SEC2);
ok((await q(`SELECT count(*)::int n FROM persona_roles`))[0].n === 0, 'la secretaría de otro distrito no los ve');
await as(null, 'anon');
await rejects(`SELECT * FROM persona_roles`, 'permission', 'anon no lee persona_roles');

console.log('\n[preferencias: no son una restricción]');
await as(M1);
await allowed(`SELECT guardar_preferencias_rol(ARRAY[${REDA},${FOTO},${DISE}]::bigint[], ${FOTO})`, 'M1 ordena 3 preferencias y deja Fotografía (permitido) como predeterminado');
let pr = await q(`SELECT rol_id, prioridad, es_predeterminado FROM preferencias_rol WHERE persona_id='${M1}' ORDER BY prioridad`);
ok(pr.length === 3 && Number(pr[0].rol_id) === REDA && pr[0].prioridad === 1 && Number(pr[2].rol_id) === DISE, 'se guardan en el orden dado (Redacción, Fotografía, Diseño)');
ok(pr.filter(x => x.es_predeterminado).length === 1 && Number(pr.find(x => x.es_predeterminado).rol_id) === FOTO, 'un solo predeterminado');
ok(pr.some(x => Number(x.rol_id) === REDA) && !(await permitidos(M1)).includes(REDA), 'prefiere Redacción SIN tenerlo permitido: la preferencia no concede nada');
await rejects(`SELECT guardar_preferencias_rol(ARRAY[${REDA},${FOTO}]::bigint[], ${REDA})`, 'permitidos', 'pero el predeterminado debe ser un rol que tiene permitido');
ok((await q(`SELECT count(*)::int n FROM preferencias_rol WHERE persona_id='${M1}'`))[0].n === 3, 'el intento fallido no borra lo anterior (atómico)');
await rejects(`SELECT guardar_preferencias_rol(ARRAY[${FOTO}]::bigint[], ${REDA})`, 'preferencia', 'el predeterminado tiene que estar entre las preferencias');
await allowed(`SELECT guardar_preferencias_rol(ARRAY[${FOTO},${FOTO},${REDA}]::bigint[], NULL)`, 'repetidos se colapsan y el predeterminado es opcional');
ok((await q(`SELECT count(*)::int n FROM preferencias_rol WHERE persona_id='${M1}'`))[0].n === 2, 'quedan 2 (sin duplicados)');
await rejects(`SELECT guardar_preferencias_rol(ARRAY[${FOTO},${REDA},${EDIC},${DISE},1000001,1000002,1000003,1000004,1000005]::bigint[], NULL)`, 'hasta 8', 'más de 8 preferencias se rechazan');
await rejects(`SELECT guardar_preferencias_rol(ARRAY[999999]::bigint[], NULL)`, 'foreign|violates|inactivo|existe', 'un rol que no existe se rechaza');
await rejects(`INSERT INTO preferencias_rol(persona_id,rol_id,prioridad) VALUES ('${M1}',${DISE},9)`, 'permission|policy', 'no se escribe la tabla directamente');
await rejects(`UPDATE preferencias_rol SET es_predeterminado=true WHERE persona_id='${M1}'`, 'permission', 'ni se actualiza directamente');
await allowed(`SELECT guardar_preferencias_rol(ARRAY[]::bigint[], NULL)`, 'vaciar las preferencias es válido');
ok((await q(`SELECT count(*)::int n FROM preferencias_rol WHERE persona_id='${M1}'`))[0].n === 0, '… y las borra');

console.log('\n[preferencias: quién las ve]');
await as(M1);
await db.exec(`SELECT guardar_preferencias_rol(ARRAY[${EDIC},${FOTO}]::bigint[], ${EDIC})`);
await as(M2);
await db.exec(`SELECT guardar_preferencias_rol(ARRAY[${REDA}]::bigint[], ${REDA})`);
ok((await q(`SELECT count(*)::int n FROM preferencias_rol`))[0].n === 1, 'cada miembro ve solo las suyas');
await as(SEC1);
ok((await q(`SELECT count(*)::int n FROM preferencias_rol`))[0].n === 3, 'la secretaría ve las de su distrito');
await as(SEC2);
ok((await q(`SELECT count(*)::int n FROM preferencias_rol`))[0].n === 0, 'la de otro distrito no ve las ajenas');
await as(ADMIN);
ok((await q(`SELECT count(*)::int n FROM preferencias_rol`))[0].n === 3, 'admin ve todas');
await as(null, 'anon');
await rejects(`SELECT guardar_preferencias_rol(ARRAY[${FOTO}]::bigint[], NULL)`, 'permission', 'anon no puede guardar preferencias');
await as(M1);
await db.exec(`SELECT guardar_preferencias_rol(ARRAY[${EDIC},${FOTO}]::bigint[], ${EDIC})`);

console.log('\n[quitar un permitido limpia el predeterminado, no la preferencia]');
await as(ADMIN);
await db.exec(`DELETE FROM persona_roles WHERE persona_id='${M1}' AND rol_id=${EDIC}`);
await root();
pr = await q(`SELECT rol_id, es_predeterminado FROM preferencias_rol WHERE persona_id='${M1}'`);
ok(pr.length === 2 && !pr.some(x => x.es_predeterminado), 'la preferencia por Edición se conserva pero deja de ser el predeterminado');
await db.exec(`INSERT INTO persona_roles(persona_id,rol_id) VALUES ('${M1}',${EDIC})`);

console.log('\n[rol en la tarea]');
await as(ADMIN);
await allowed(`INSERT INTO tareas(periodo_id,titulo,asignada_a,rol_id) VALUES ('${PE}','Foto del evento','${M1}',${FOTO})`, 'admin asigna con el rol principal de la persona');
await allowed(`INSERT INTO tareas(periodo_id,titulo,asignada_a,rol_id) VALUES ('${PE}','Edición del video','${M1}',${EDIC})`, 'o con un rol que le habilitó');
await allowed(`INSERT INTO tareas(periodo_id,titulo,asignada_a,rol_id) VALUES ('${PE}','Diseño excepcional','${M1}',${DISE})`, 'admin puede asignar FUERA de lo permitido');
await root();
const rx = await q(`SELECT titulo, rol_excepcion FROM tareas WHERE titulo IN ('Foto del evento','Edición del video','Diseño excepcional') ORDER BY titulo`);
ok(rx.find(x => x.titulo === 'Diseño excepcional').rol_excepcion === true && rx.filter(x => x.rol_excepcion).length === 1, 'solo la de fuera de lo permitido queda marcada rol_excepcion');
await as(SEC1);
await allowed(`INSERT INTO tareas(periodo_id,titulo,asignada_a,rol_id) VALUES ('${PE}','Cobertura','${M1}',${FOTO})`, 'la secretaría asigna a su distrito con un rol permitido');
await rejects(`INSERT INTO tareas(periodo_id,titulo,asignada_a,rol_id) VALUES ('${PE}','Fuera de permitido','${M1}',${DISE})`, 'no tiene permitido', 'la secretaría NO asigna un rol que la persona no tiene permitido');
await rejects(`INSERT INTO tareas(periodo_id,titulo,asignada_a,rol_id) VALUES ('${PE}','Rol inactivo','${M1}',(SELECT id FROM roles WHERE nombre='Archivado'))`, 'inactivo', 'ni un rol inactivo');
await rejects(`INSERT INTO tareas(periodo_id,titulo,asignada_a,rol_id) VALUES ('${PE}','Otro distrito','${M3}',${FOTO})`, 'row-level|policy|distrito|42501|permitido', 'ni a otro distrito (eso ya lo prohibía 0016)');
await allowed(`INSERT INTO tareas(periodo_id,titulo,asignada_a) VALUES ('${PE}','Sin rol','${M2}')`, 'el rol es opcional');
await as(M1);
await allowed(`INSERT INTO tareas(periodo_id,titulo,asignada_a,rol_id) VALUES ('${PE}','Mi iniciativa','${M1}',${EDIC})`, 'un miembro registra una tarea propia con un rol permitido');
await rejects(`INSERT INTO tareas(periodo_id,titulo,asignada_a,rol_id) VALUES ('${PE}','Mi iniciativa 2','${M1}',${DISE})`, 'no tiene permitido', 'pero no con uno que no tiene permitido');

console.log('\n[cambiar el rol de una tarea]');
await as(M1);
const tCop = (await q(`SELECT id FROM tareas WHERE titulo='Cobertura'`))[0].id;
await rejects(`UPDATE tareas SET rol_id=${EDIC} WHERE id=${tCop}`, 'no puedes cambiar el rol', 'el receptor no cambia el rol de una tarea que le asignaron');
await allowed(`UPDATE tareas SET estado='en_curso' WHERE id=${tCop}`, 'pero sí avanza su estado');
await as(SEC1);
await allowed(`UPDATE tareas SET rol_id=${EDIC} WHERE id=${tCop}`, 'la secretaría revisora cambia el rol a otro permitido');
await root();
ok((await q(`SELECT de, a FROM tarea_eventos WHERE tarea_id=${tCop} AND tipo='rol'`)).some(e => e.de === 'Fotografía' && e.a === 'Edición'), 'el cambio queda en el historial de la tarea (Fotografía → Edición)');
await as(M1);
const tPro = (await q(`SELECT id FROM tareas WHERE titulo='Mi iniciativa'`))[0].id;
await allowed(`UPDATE tareas SET rol_id=${FOTO} WHERE id=${tPro}`, 'el autor cambia el rol de su tarea propia abierta');
await as(ADMIN);
const tExc = (await q(`SELECT id FROM tareas WHERE titulo='Diseño excepcional'`))[0].id;
await db.exec(`UPDATE tareas SET rol_excepcion=false WHERE id=${tExc}`);
await root();
ok((await q(`SELECT rol_excepcion FROM tareas WHERE id=${tExc}`))[0].rol_excepcion === true, 'rol_excepcion no se puede borrar a mano: lo decide el servidor');
await as(M1);
await allowed(`UPDATE tareas SET estado='en_curso' WHERE id=${tExc}`, 'una tarea fuera de lo permitido sigue pudiendo avanzar (el rol no se revalida si no cambia)');
await as(ADMIN);
await db.exec(`UPDATE tareas SET rol_id=NULL WHERE id=${tExc}`);
await root();
ok((await q(`SELECT rol_excepcion FROM tareas WHERE id=${tExc}`))[0].rol_excepcion === false, 'quitar el rol limpia la excepción');

console.log('\n[actividad de la tarea]');
await as(ADMIN);
await db.exec(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio) VALUES (${G},'Jornada','2026-11-02')`);
await root();
await db.exec(`UPDATE gestiones SET archivada=false WHERE id=${GA}`);   // se «archiva» después de crear su actividad
await as(ADMIN);
await db.exec(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio) VALUES (${GA},'De archivo','2025-11-02')`);
await root();
await db.exec(`UPDATE gestiones SET archivada=true WHERE id=${GA}`);
const AC = (await q(`SELECT id FROM actividades WHERE titulo='Jornada'`))[0].id;
const ACA = (await q(`SELECT id FROM actividades WHERE titulo='De archivo'`))[0].id;
await as(ADMIN);
await allowed(`INSERT INTO tareas(periodo_id,titulo,asignada_a,actividad_id) VALUES ('${PE}','Para la jornada','${M2}',${AC})`, 'una tarea se vincula a una actividad de su gestión');
await rejects(`INSERT INTO tareas(periodo_id,titulo,asignada_a,actividad_id) VALUES ('${PE}','Actividad ajena','${M2}',${ACA})`, 'gestion', 'pero no a la de otra gestión');
await as(M2);
const tJor = (await q(`SELECT id FROM tareas WHERE titulo='Para la jornada'`))[0].id;
await rejects(`UPDATE tareas SET actividad_id=NULL WHERE id=${tJor}`, 'no puedes cambiar la actividad', 'el receptor no cambia la actividad de una tarea que le asignaron');
await as(ADMIN);
await rejects(`DELETE FROM actividades WHERE id=${AC}`, 'tarea.*vinculada', 'una actividad con tareas no se borra (mensaje claro, no un error de clave)');
await db.exec(`UPDATE tareas SET actividad_id=NULL WHERE id=${tJor}`);
await allowed(`DELETE FROM actividades WHERE id=${AC}`, 'desvinculada la tarea, la actividad se borra');
ok((await q(`SELECT count(*)::int n FROM tareas WHERE id=${tJor}`))[0].n === 1, 'y la tarea sigue existiendo');

console.log('\n[personas_asignables: filtrado por permisos]');
await as(ADMIN);
let pa = await q(`SELECT * FROM personas_asignables('${PE}', ${FOTO})`);
ok(pa.length === 5 && !pa.some(x => x.persona_id === ADMIN), 'admin ve a todas las personas aprobadas, menos administradores');
const p1 = pa.find(x => x.persona_id === M1), p2 = pa.find(x => x.persona_id === M2);
ok(p1.permitido === true && p2.permitido === false, 'compatibilidad con Fotografía: M1 sí (es su rol), M2 no');
ok(p1.tareas_abiertas >= 3, `carga de M1: ${p1.tareas_abiertas} tareas abiertas`);
await as(M1);
await db.exec(`SELECT guardar_preferencias_rol(ARRAY[${REDA},${FOTO}]::bigint[], ${FOTO})`);
await as(ADMIN);
pa = await q(`SELECT * FROM personas_asignables('${PE}', ${REDA})`);
ok(pa.find(x => x.persona_id === M1).prioridad === 1 && pa.find(x => x.persona_id === M1).permitido === false, 'M1 prefiere Redacción en 1.º lugar aunque no la tenga permitida (la preferencia no es permiso)');
ok(pa.find(x => x.persona_id === M2).permitido === true && pa.find(x => x.persona_id === M2).predeterminado === true, 'M2 la tiene permitida (es su rol) y la dejó como predeterminada');
ok(pa.find(x => x.persona_id === M3).permitido === false && pa.find(x => x.persona_id === M3).prioridad === null, 'M3 ni la tiene permitida ni la pidió');
pa = await q(`SELECT * FROM personas_asignables('${PE}', NULL)`);
ok(pa[0].permitido === null && pa[0].prioridad === null, 'sin rol, no calcula compatibilidad');
await as(SEC1);
pa = await q(`SELECT * FROM personas_asignables('${PE}', ${FOTO})`);
ok(pa.length === 2 && pa.every(x => x.distrito === '08-01') && !pa.some(x => x.persona_id === SEC1), 'la secretaría ve a su distrito, sin ella misma');
await as(M1);
ok((await q(`SELECT * FROM personas_asignables('${PE}', ${FOTO})`)).length === 0, 'un miembro no obtiene nada');
await as(null, 'anon');
await rejects(`SELECT * FROM personas_asignables('${PE}', NULL)`, 'permission', 'anon no puede llamarla');
await root();
await db.exec(`UPDATE profiles SET aprobado=false WHERE id='${M2}'`);
await as(ADMIN);
ok(!(await q(`SELECT persona_id FROM personas_asignables('${PE}', NULL)`)).some(x => x.persona_id === M2), 'quien aún no tiene acceso aprobado no se puede asignar');
await root();
await db.exec(`UPDATE profiles SET aprobado=true WHERE id='${M2}'`);
await db.exec(`INSERT INTO periodo_participantes(periodo_id,user_id,activo) VALUES ('${PE}','${M2}',false)`);
await as(ADMIN);
ok((await q(`SELECT activo_periodo FROM personas_asignables('${PE}', NULL) WHERE persona_id='${M2}'`))[0].activo_periodo === false, 'quien no participa en el período se marca activo_periodo = false');

console.log('\n[funciones internas cerradas]');
await as(M1);
await rejects(`SELECT roles_permitidos_de('${M2}')`, 'permission', 'roles_permitidos_de no es llamable desde el cliente');
await as(null, 'anon');
await rejects(`SELECT guardar_preferencias_rol(ARRAY[1]::bigint[], NULL)`, 'permission', 'anon no guarda preferencias');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
