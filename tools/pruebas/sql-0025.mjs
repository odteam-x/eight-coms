// Pruebas de 0025 (seguimiento global de los períodos y asistente de bienvenida) contra Postgres real
// (PGlite), con RLS. Lo importante: quién ve qué, y que los borradores no se filtren.
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
  catch (e) { ok(!patron || new RegExp(patron, 'i').test(e.message), msg + ' → ' + String(e.message).slice(0, 100)); }
}
async function allowed(sql, msg) {
  try { await db.exec(sql); ok(true, msg); } catch (e) { ok(false, msg + ' → ' + String(e.message).slice(0, 160)); }
}
const uid = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const ADMIN = uid(90), SEC1 = uid(91), SEC2 = uid(92), M1 = uid(1), M2 = uid(2), M3 = uid(3), M4 = uid(4);
const J = o => JSON.stringify(o).replace(/'/g, "''");

// ── Esquema base: stub + 0015 + 0016 + 0017 + 0020 + 0023 ──
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
  INSERT INTO periodos_evaluacion(gestion_id,nombre) SELECT id,'LEG' FROM gestiones WHERE activa;
`);
await db.exec(fs.readFileSync(R + '0015_rubrica_v2.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0015_seed_perfiles.PENDIENTE.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0016_tareas.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0017_tareas_puntos.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0020_criterios_dinamicos.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0023_puntuacion_por_peso.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0018_actividades.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0021_roles_preferencias.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0024_actividades_alcance.sql', 'utf8'));
await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
               GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;`);
const G = (await q(`SELECT id FROM gestiones WHERE activa`))[0].id;
const GA = (await q(`SELECT id FROM gestiones WHERE archivada`))[0].id;
const FOTO = (await q(`SELECT id FROM roles WHERE nombre='Fotografía'`))[0].id;
const REDA = (await q(`SELECT id FROM roles WHERE nombre='Redacción'`))[0].id;
await db.exec(`
  INSERT INTO profiles(id,nombre,es_admin) VALUES ('${ADMIN}','Admin',true);
  INSERT INTO profiles(id,nombre,tipo_miembro,distrito,rol_id) VALUES ('${SEC1}','Sec1','secretario','08-01',${REDA}),('${SEC2}','Sec2','secretario','08-02',${REDA});
  INSERT INTO profiles(id,nombre,distrito,rol_id) VALUES ('${M1}','M1','08-01',${FOTO}),('${M2}','M2','08-01',${FOTO}),('${M3}','M3','08-02',${FOTO}),('${M4}','M4','08-02',${REDA});
  INSERT INTO periodos_evaluacion(gestion_id,nombre,modelo) VALUES (${G},'PE1','v2'),(${G},'PE2','v2'),(${GA},'ARCH','v2');
`);
const per = async n => (await q(`SELECT id FROM periodos_evaluacion WHERE nombre='${n}'`))[0].id;
const LEG = await per('LEG'), PE1 = await per('PE1'), PE2 = await per('PE2'), ARCH = await per('ARCH');

// Evaluaciones
const perfil = (await q(`SELECT public.perfil_vigente(${FOTO}, '${PE1}') id`))[0].id;
const tec = await q(`SELECT criterio_key k, peso FROM perfil_criterios WHERE perfil_id=${perfil}`);
const nuc = (await q(`SELECT key FROM criterios_v2 WHERE gestion_id=${G} AND tipo='nucleo' AND tipo_campo='escala' AND activo`)).map(x => x.key);
const todo = full => ({ ...Object.fromEntries(nuc.map(k => [k, full ? 10 : 5])), ...Object.fromEntries(tec.map(x => [x.k, full ? x.peso : Math.floor(x.peso / 2)])) });
await as(ADMIN);
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,bono_ext,estado) VALUES ('${LEG}','${M1}','{"pla":3,"rev":4}',1,'publicado')`);
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,bono_ext,estado) VALUES ('${LEG}','${M2}','{"pla":2,"rev":2}',0,'borrador')`);
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${M1}','${J(todo(true))}','publicado')`);
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${M3}','${J(todo(false))}','publicado')`);
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${M2}','${J(todo(true))}','borrador')`);
// Tareas de M1 en PE1: una entregada a tiempo y aprobada con 8, otra vencida sin entregar.
await db.exec(`INSERT INTO tareas(periodo_id,titulo,asignada_a,fecha_limite) VALUES ('${PE1}','Entregada a tiempo','${M1}', CURRENT_DATE + 5),('${PE1}','Vencida','${M1}', CURRENT_DATE - 3),('${PE1}','De M3','${M3}', CURRENT_DATE + 2)`);
await as(M1);
const tOk = (await q(`SELECT id FROM tareas WHERE titulo='Entregada a tiempo'`))[0].id;
await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='listo' WHERE id=${tOk}`);
await as(ADMIN);
await db.exec(`UPDATE tareas SET estado='aprobada', puntos=8 WHERE id=${tOk}`);
// Actividades y tareas vinculadas (reporte por actividad)
await as(ADMIN);
await db.exec(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio) VALUES (${G},'Jornada A','2026-11-02')`);
await db.exec(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio,distrito) VALUES (${G},'Taller del distrito 1','2026-11-09','08-01')`);
await db.exec(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio) VALUES (${G},'Sin tareas','2026-12-01')`);
const AJ = (await q(`SELECT id FROM actividades WHERE titulo='Jornada A'`))[0].id;
const AT = (await q(`SELECT id FROM actividades WHERE titulo='Taller del distrito 1'`))[0].id;
await db.exec(`UPDATE tareas SET actividad_id=${AJ} WHERE titulo IN ('Entregada a tiempo','Vencida')`);
await db.exec(`UPDATE tareas SET actividad_id=${AJ} WHERE titulo='De M3'`);
await db.exec(`INSERT INTO tareas(periodo_id,titulo,asignada_a,actividad_id,fecha_limite) VALUES ('${PE1}','Para el taller','${M2}',${AT}, CURRENT_DATE + 3)`);
await root();
await db.exec(`INSERT INTO periodo_participantes(periodo_id,user_id,activo) VALUES ('${PE2}','${M4}',false)`);

// Personas que ya existen ANTES de aplicar 0025
await db.exec(fs.readFileSync(R + '0025_seguimiento_bienvenida.sql', 'utf8'));
await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
               GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;`);
await db.exec(fs.readFileSync(R + '0025_seguimiento_bienvenida.sql', 'utf8'));
// Regresión (0031–0035): con --con-equipos se aplican DESPUÉS de 0025, sobre datos que ya existían (PE, tareas, notas):
// el resultado visible tiene que ser el mismo, porque los PE anteriores quedan con peso_tareas = 0.
if (process.argv.includes('--con-equipos') || process.env.CON_EQUIPOS) {
  for (const f of ['0031_equipos.sql', '0032_tareas_equipo.sql', '0033_calificaciones.sql', '0034_calificacion_tareas.sql', '0035_resultados_integrados.sql'])
    await db.exec(fs.readFileSync(R + f, 'utf8'));
  console.log('— 0031–0035 aplicadas sobre los datos existentes');
  await root();
  ok((await q(`SELECT puntos_original FROM tareas WHERE titulo='Entregada a tiempo'`))[0].puntos_original === 8, 'migración de datos: la tarea ya aprobada conserva sus 8 puntos como nota original');
  ok((await q(`SELECT count(*)::int n FROM periodo_calif_config WHERE peso_tareas = 0 AND NOT confirmado`))[0].n >= 2, 'migración de datos: los PE que ya existían quedan con peso_tareas = 0 (no cambian sus resultados)');
}
await db.exec(`REVOKE ALL ON public.bienvenida_estado FROM anon; REVOKE INSERT, UPDATE, DELETE ON public.bienvenida_estado FROM authenticated;`);
console.log('— 0025 aplicada sin errores (dos veces: es idempotente)');

const seg = async (u, g = '') => { await as(u); return q(`SELECT * FROM seguimiento_global(${g}) ORDER BY nombre, periodo_orden`); };
const fila = (rows, n, p) => rows.find(r => r.nombre === n && r.periodo_nombre === p);

console.log('\n[quién ve a quién]');
let r = await seg(ADMIN);
ok(r.length === 18, `administración: 6 personas × 3 períodos = ${r.length} filas`);
ok(!r.some(x => x.nombre === 'Admin'), 'el administrador no se evalúa: no aparece');
ok(new Set(r.map(x => x.periodo_nombre)).size === 3 && !r.some(x => x.periodo_nombre === 'ARCH'), 'solo los períodos de la gestión activa por defecto');
r = await seg(SEC1);
ok(r.length === 9 && new Set(r.map(x => x.nombre)).size === 3 && r.every(x => x.distrito === '08-01'), 'secretaría 1: solo su distrito (ella, M1, M2)');
r = await seg(M1);
ok(r.length === 3 && r.every(x => x.persona_id === M1), 'un miembro: solo su propia fila de cada período (su historial)');
r = await seg(M4);
ok(r.length === 3 && r.every(x => x.persona_id === M4), 'otro miembro: solo la suya');
await as(null, 'authenticated');
await rejects(`SELECT * FROM seguimiento_global()`, 'sesion', 'sin sesión se rechaza');
await as(null, 'anon');
await rejects(`SELECT * FROM seguimiento_global()`, 'permission', 'anon no puede llamarla');
r = await seg(ADMIN, GA);
ok(r.length === 6 && r.every(x => x.periodo_nombre === 'ARCH'), 'se puede pedir otra gestión (archivada): sus períodos');
r = await seg(M1, GA);
ok(r.length === 1 && r[0].persona_id === M1, 'y un miembro sigue viendo solo lo suyo ahí también');

console.log('\n[los borradores no se filtran]');
r = await seg(ADMIN);
ok(fila(r, 'M2', 'PE1').estado_eval === 'borrador' && Number(fila(r, 'M2', 'PE1').individual) > 0, 'la administración ve el borrador de M2 en PE1 con su puntaje, marcado como borrador');
ok(fila(r, 'M2', 'LEG').estado_eval === 'borrador' && fila(r, 'M2', 'LEG').total_clasico !== null, 'y el borrador clásico de M2 con su total');
r = await seg(SEC1);
ok(fila(r, 'M2', 'PE1').estado_eval === 'sin_publicar' && fila(r, 'M2', 'PE1').individual === null && fila(r, 'M2', 'PE1').general === null, 'la secretaría ve que M2 está «sin publicar» y NINGÚN puntaje');
ok(fila(r, 'M2', 'LEG').estado_eval === 'sin_publicar' && fila(r, 'M2', 'LEG').total_clasico === null, 'tampoco el total clásico de un borrador');
r = await seg(M2);
ok(fila(r, 'M2', 'PE1').estado_eval === 'sin_publicar' && fila(r, 'M2', 'PE1').individual === null, 'M2 tampoco ve su propio borrador');
ok(fila(r, 'M2', 'PE2').estado_eval === 'sin_evaluar', 'y un período sin evaluación dice «sin_evaluar»');

console.log('\n[resultados publicados]');
r = await seg(M1);
ok(fila(r, 'M1', 'PE1').estado_eval === 'publicado' && Number(fila(r, 'M1', 'PE1').individual) === 100 && Number(fila(r, 'M1', 'PE1').nucleo) === 100, 'M1 en PE1 (todo al máximo) = 100 / núcleo 100');
ok(Number(fila(r, 'M1', 'LEG').total_clasico) === 8, 'M1 en el período clásico: 3 + 4 + bono 1 = 8');
ok(fila(r, 'M1', 'LEG').nucleo === null && fila(r, 'M1', 'LEG').modelo === 'legacy', 'el clásico no mezcla escalas: sin núcleo, modelo «legacy»');
const resV2 = (await q(`SELECT individual FROM resultados_periodo('${PE1}') WHERE evaluado_id='${M1}'`))[0];
ok(Number(fila(r, 'M1', 'PE1').individual) === Number(resV2.individual), 'coincide con resultados_periodo(): no hay una segunda fórmula');
r = await seg(ADMIN);
ok(fila(r, 'M3', 'PE1').rol_nombre === 'Fotografía' && fila(r, 'M1', 'PE1').rol_nombre === 'Fotografía', 'cada fila trae el rol');

console.log('\n[hechos de las tareas]');
r = await seg(M1);
const t = fila(r, 'M1', 'PE1');
ok(t.tareas_total === 2 && t.tareas_aprobadas === 1 && t.tareas_vencidas === 1, `M1: 2 tareas, 1 aprobada, 1 vencida (${t.tareas_total}/${t.tareas_aprobadas}/${t.tareas_vencidas})`);
ok(t.con_plazo === 1 && t.a_tiempo === 1, 'con plazo entregadas = 1, a tiempo = 1 (numerador y denominador separados)');
ok(t.puntos_suma === 8 && t.puntos_n === 1, 'puntos: suma 8 sobre 1 tarea puntuada');
ok(fila(r, 'M1', 'PE2').tareas_total === 0 && fila(r, 'M1', 'LEG').tareas_total === 0, 'en períodos sin tareas todo en 0');
r = await seg(SEC1);
ok(!r.some(x => x.nombre === 'M3'), 'la secretaría 1 no ve las tareas de M3 (otro distrito)');
r = await seg(ADMIN);
ok(fila(r, 'M3', 'PE1').tareas_total === 1, 'la administración sí');

console.log('\n[participación]');
r = await seg(ADMIN);
ok(fila(r, 'M4', 'PE2').participa === false && fila(r, 'M4', 'PE1').participa === true, 'quien se marcó inactivo en un período aparece como no participa solo ahí');

console.log('\n[reporte por actividad]');
const ra = async (u, g = '') => { await as(u); return q(`SELECT * FROM reporte_actividades(${g}) ORDER BY titulo, nombre`); };
let a = await ra(ADMIN);
const suma = (rows, t, k) => rows.filter(x => x.titulo === t).reduce((s, x) => s + x[k], 0);
ok(suma(a, 'Jornada A', 'asignadas') === 3 && suma(a, 'Jornada A', 'entregadas') === 1 && suma(a, 'Jornada A', 'con_plazo') === 1 && suma(a, 'Jornada A', 'a_tiempo') === 1, 'Jornada A: 3 asignadas, 1 entregada (con plazo) y a tiempo — numerador y denominador salen por separado');
ok(suma(a, 'Jornada A', 'vencidas') === 1 && suma(a, 'Jornada A', 'aprobadas') === 1 && suma(a, 'Jornada A', 'puntos_suma') === 8 && suma(a, 'Jornada A', 'puntos_n') === 1, '1 vencida, 1 aprobada con 8 puntos');
ok(a.filter(x => x.titulo === 'Jornada A').length === 2, 'una fila por persona que tiene tareas en la actividad (M1 con 2 tareas, M3 con 1)');
const sin = a.find(x => x.titulo === 'Sin tareas');
ok(sin && sin.persona_id === null && sin.asignadas === 0, 'una actividad sin tareas aparece una vez, sin persona y en 0');
ok(a.find(x => x.titulo === 'Jornada A' && x.persona_id === M1).rol_nombre === 'Fotografía', 'cada fila trae el rol de la persona');
a = await ra(SEC1);
ok(!a.some(x => x.persona_id === M3), 'la secretaría 1 no ve las tareas de M3 (otro distrito)');
ok(suma(a, 'Jornada A', 'asignadas') === 2 && a.some(x => x.titulo === 'Taller del distrito 1'), 've las de su distrito y las actividades de su distrito');
ok(a.some(x => x.titulo === 'Sin tareas'), 'y las actividades de todo el equipo, aunque aún no tengan tareas');
a = await ra(M1);
ok(a.length === 1 && a[0].titulo === 'Jornada A' && a[0].persona_id === M1 && a[0].asignadas === 2, 'un miembro solo ve sus propias tareas, y solo las actividades donde las tiene');
await as(null, 'authenticated');
await rejects(`SELECT * FROM reporte_actividades()`, 'sesion', 'sin sesión se rechaza');
await as(null, 'anon');
await rejects(`SELECT * FROM reporte_actividades()`, 'permission', 'anon no puede llamarla');

console.log('\n[bienvenida: quién escribe y qué]');
await root();
ok((await q(`SELECT count(*)::int n FROM bienvenida_estado WHERE origen='existente' AND NOT omitida AND completada_en IS NULL AND cardinality(pasos_hechos)=0`))[0].n === 7, 'las 7 personas que ya existían quedan como «existente», sin empezar (les toca «Novedades», no la bienvenida de quien llega)');
ok((await q(`SELECT perfil FROM bienvenida_estado WHERE persona_id='${SEC1}'`))[0].perfil === 'secretario' && (await q(`SELECT perfil FROM bienvenida_estado WHERE persona_id='${ADMIN}'`))[0].perfil === 'admin', 'con el perfil que corresponde a su rol funcional');
await db.exec(`INSERT INTO profiles(id,nombre,distrito) VALUES ('${uid(5)}','M5','08-01')`);
ok((await q(`SELECT count(*)::int n FROM bienvenida_estado WHERE persona_id='${uid(5)}'`))[0].n === 0, 'una persona que llega después no tiene fila: le corresponde la bienvenida completa');
await as(uid(5));
await allowed(`SELECT bienvenida_guardar(ARRAY['rol','foto'], 'preferencias', false, false)`, 'guarda su avance (pasos hechos y paso actual)');
ok((await q(`SELECT origen FROM bienvenida_estado`))[0].origen === 'nuevo', 'quien llega después queda con origen «nuevo» (lo fija el servidor)');
await as(M1);
await db.exec(`SELECT bienvenida_guardar(ARRAY['novedad-rol'], 'novedad-rol', false, false)`);
ok((await q(`SELECT origen FROM bienvenida_estado WHERE persona_id='${M1}'`))[0].origen === 'existente', 'guardar su avance no cambia el origen de quien ya existía');
await as(uid(5));
let b = (await q(`SELECT * FROM bienvenida_estado`));
ok(b.length === 1 && b[0].persona_id === uid(5) && b[0].paso_actual === 'preferencias' && b[0].pasos_hechos.length === 2 && b[0].perfil === 'miembro' && !b[0].omitida && !b[0].completada_en, 'solo ve su fila: perfil «miembro» (lo fija el servidor), 2 pasos, en «preferencias»');
await allowed(`SELECT bienvenida_guardar(ARRAY['rol','foto','preferencias'], 'calendario', false, false)`, 'reanuda y avanza');
ok((await q(`SELECT array_length(pasos_hechos,1) n FROM bienvenida_estado`))[0].n === 3, 'se conserva el avance');
await rejects(`SELECT bienvenida_guardar(ARRAY['Paso Raro!'], NULL, false, false)`, 'no validos', 'un nombre de paso inválido se rechaza');
await rejects(`SELECT bienvenida_guardar(ARRAY['a'], 'DROP TABLE', false, false)`, 'no valido', 'y un paso actual inválido también');
await rejects(`INSERT INTO bienvenida_estado(persona_id,perfil) VALUES ('${uid(5)}','admin')`, 'permission', 'no se escribe la tabla directamente');
await rejects(`UPDATE bienvenida_estado SET perfil='admin' WHERE persona_id='${uid(5)}'`, 'permission', 'ni se actualiza (nadie se declara admin)');
await allowed(`SELECT bienvenida_guardar(ARRAY['rol','foto','preferencias','calendario'], NULL, false, true)`, 'termina el asistente');
ok((await q(`SELECT completada_en FROM bienvenida_estado`))[0].completada_en !== null, 'queda la fecha en que lo terminó');
await allowed(`SELECT bienvenida_guardar(ARRAY['rol'], NULL, false, false)`, 'guardar de nuevo no borra la fecha de término');
ok((await q(`SELECT completada_en FROM bienvenida_estado`))[0].completada_en !== null, 'la fecha de término se conserva');
await as(SEC1);
await db.exec(`SELECT bienvenida_guardar(ARRAY['distrito'], 'tareas', false, false)`);
ok((await q(`SELECT perfil FROM bienvenida_estado WHERE persona_id='${SEC1}'`))[0].perfil === 'secretario', 'la secretaría guarda con perfil «secretario»');
ok((await q(`SELECT count(*)::int n FROM bienvenida_estado`))[0].n === 1, 'y no ve la de nadie más');
await as(ADMIN);
ok((await q(`SELECT count(*)::int n FROM bienvenida_estado`))[0].n === 8, 'la administración ve todas (para saber quién va por dónde)');
await db.exec(`SELECT bienvenida_guardar(ARRAY[]::text[], NULL, true, false)`);
ok((await q(`SELECT omitida FROM bienvenida_estado WHERE persona_id='${ADMIN}'`))[0].omitida === true, 'omitir se guarda');
await as(uid(5));
await db.exec(`SELECT bienvenida_reiniciar()`);
ok((await q(`SELECT count(*)::int n FROM bienvenida_estado`))[0].n === 0, 'reiniciar borra el avance de quien lo pide');
await root();
ok((await q(`SELECT count(*)::int n FROM bienvenida_estado`))[0].n === 8 - 1 + 0 || (await q(`SELECT count(*)::int n FROM bienvenida_estado`))[0].n === 7, 'y no toca el de nadie más');
await as(null, 'anon');
await rejects(`SELECT bienvenida_guardar(ARRAY['a'], NULL, false, false)`, 'permission', 'anon no guarda');
await rejects(`SELECT * FROM bienvenida_estado`, 'permission', 'ni lee');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
