// Pruebas de 0040 (notificaciones integrales) contra Postgres real (PGlite), con RLS.
// Se parte del esquema real de 0015–0018, 0019 (tabla, funciones y disparadores), 0022 y 0024, con avisos
// HISTÓRICOS creados por los disparadores de 0019 antes de aplicar 0040: así se prueba también la migración.
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
  catch (e) { ok(!patron || new RegExp(patron, 'i').test(e.message), msg + ' → ' + e.message.slice(0, 90)); }
}
async function allowed(sql, msg) { try { await db.exec(sql); ok(true, msg); } catch (e) { ok(false, msg + ' → ' + e.message.slice(0, 140)); } }
const uid = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const ADMIN = uid(90), SEC1 = uid(91), SEC2 = uid(92), M1 = uid(1), M2 = uid(2), M3 = uid(3), MSIN = uid(4);
const arr = ids => `ARRAY[${ids.map(i => `'${i}'`).join(',')}]::uuid[]`;
const m19 = fs.readFileSync(R + '0019_notificaciones.sql', 'utf8');
const fn19 = nombre => {
  const ini = m19.indexOf(`CREATE OR REPLACE FUNCTION public.${nombre}(`);
  if (ini < 0) throw new Error('no está en 0019: ' + nombre);
  const a = m19.indexOf('$$', ini), b = m19.indexOf('$$', a + 2);
  return m19.slice(ini, m19.indexOf(';', b) + 1);
};

// ── Esquema base ──
await db.exec(fs.readFileSync(DIR + 'stub.sql', 'utf8'));
await db.exec(`
  CREATE ROLE service_role NOLOGIN;
  GRANT USAGE ON SCHEMA public TO service_role;
  ALTER TABLE public.profiles ADD COLUMN aprobado BOOLEAN DEFAULT true;
  ALTER TABLE public.periodos_evaluacion ADD COLUMN fecha_entrega DATE;
  CREATE TABLE public.config (gestion_id BIGINT, clave TEXT, valor TEXT, PRIMARY KEY (gestion_id, clave));
  CREATE TABLE public.periodo_participantes (periodo_id UUID, user_id UUID, activo BOOLEAN DEFAULT true, PRIMARY KEY (periodo_id, user_id));
  CREATE TABLE public.trabajos_entregados (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id UUID, periodo_id UUID,
     titulo TEXT DEFAULT '', descripcion TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
  INSERT INTO gestiones(nombre, activa) VALUES ('2026-2027', true);
  INSERT INTO profiles(id,nombre,email,es_admin) VALUES ('${ADMIN}','Admin','admin@x.cl',true);
  INSERT INTO profiles(id,nombre,email,tipo_miembro,distrito) VALUES ('${SEC1}','Sec1','s1@x.cl','secretario','08-01'),('${SEC2}','Sec2','s2@x.cl','secretario','08-02');
  INSERT INTO profiles(id,nombre,email,distrito) VALUES ('${M1}','Ana','m1@x.cl','08-01'),('${M2}','Beto','m2@x.cl','08-01'),('${M3}','Carla','m3@x.cl','08-02'),('${MSIN}','Sin Correo','','08-01');
`);
await db.exec(`INSERT INTO periodos_evaluacion(gestion_id,nombre) SELECT id,'LEG' FROM gestiones WHERE activa`);
await db.exec(fs.readFileSync(R + '0015_rubrica_v2.sql', 'utf8'));
await db.exec(`INSERT INTO periodos_evaluacion(gestion_id,nombre,modelo) SELECT id,'PE1','v2' FROM gestiones WHERE activa`);
const PE = (await q(`SELECT id FROM periodos_evaluacion WHERE nombre='PE1'`))[0].id;
const LEG = (await q(`SELECT id FROM periodos_evaluacion WHERE nombre='LEG'`))[0].id;
await db.exec(fs.readFileSync(R + '0016_tareas.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0017_tareas_puntos.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0018_actividades.sql', 'utf8'));

// 0019 como está en producción (sin pg_cron / pg_net) …
const tabla = m19.match(/CREATE TABLE IF NOT EXISTS public\.notificaciones \([\s\S]*?\n\);/)[0];
await db.exec(tabla + `
  ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.notificaciones FROM anon, authenticated;`);
const F19 = ['notif_fecha', 'notif_zona', 'notif_encolar', 'notif_revisores', 'notif_audiencia', 'notif_trg_evaluacion', 'notif_trg_tarea',
  'notif_trg_profile', 'notif_trg_actividad', 'notif_generar_recordatorios', 'notif_reclamar', 'notif_marcar'];
for (const f of F19) await db.exec(fn19(f));
await db.exec(`
  CREATE TRIGGER notif_evaluacion AFTER INSERT OR UPDATE ON public.evaluaciones FOR EACH ROW EXECUTE FUNCTION public.notif_trg_evaluacion();
  CREATE TRIGGER notif_tarea AFTER INSERT OR UPDATE ON public.tareas FOR EACH ROW EXECUTE FUNCTION public.notif_trg_tarea();
  CREATE TRIGGER notif_profile AFTER INSERT OR UPDATE OF aprobado ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.notif_trg_profile();
  CREATE TRIGGER notif_actividad AFTER INSERT ON public.actividades FOR EACH ROW EXECUTE FUNCTION public.notif_trg_actividad();
  REVOKE EXECUTE ON FUNCTION public.notif_trg_evaluacion(), public.notif_trg_tarea(), public.notif_trg_profile(), public.notif_trg_actividad(),
    public.notif_encolar(UUID,TEXT,JSONB,TEXT,TIMESTAMPTZ), public.notif_revisores(UUID), public.notif_audiencia(TEXT,UUID),
    public.notif_zona(), public.notif_generar_recordatorios(), public.notif_reclamar(INT), public.notif_marcar(BIGINT,TEXT) FROM PUBLIC, anon, authenticated;`);
await db.exec(fs.readFileSync(R + '0022_notificaciones_app.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0024_actividades_alcance.sql', 'utf8'));
console.log('— base lista (0015–0019, 0022, 0024)');

// ── Avisos HISTÓRICOS, creados por los disparadores reales de 0019 ──
const insT = (por, a, titulo, dias = 5) => `INSERT INTO tareas(periodo_id,titulo,asignada_a,fecha_limite) VALUES ('${PE}','${titulo}','${a}',current_date + ${dias}) RETURNING id`;
const idDe = async sql => (await q(sql))[0].id;
await as(ADMIN);
const tH = await idDe(insT(ADMIN, M1, 'Reel histórico'));
await as(M1);
await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='primera entrega' WHERE id=${tH}`);
await as(SEC1);
await db.exec(`UPDATE tareas SET estado='devuelta', revision_nota='Falta el audio' WHERE id=${tH}`);
await root();
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,bono_ext,estado) VALUES ('${LEG}','${M1}','{"pla":3}',0,'publicado')`);
await db.exec(`UPDATE evaluaciones SET puntajes='{"pla":4}' WHERE evaluado_id='${M1}'`);
const antes = await q(`SELECT tipo, dedupe_key FROM notificaciones ORDER BY id`);
console.log('— avisos históricos de 0019:', antes.map(a => a.tipo).join(', '));
ok(['tarea_asignada', 'entrega_por_revisar', 'tarea_devuelta', 'nota_publicada', 'nota_corregida'].every(t => antes.some(a => a.tipo === t)), 'antes de 0040 existen los tipos viejos (entrega_por_revisar, tarea_devuelta, nota_publicada, nota_corregida)');
await db.exec(`UPDATE notificaciones SET enviada_en = now() WHERE tipo='tarea_asignada'`);   // uno ya enviado
await db.exec(`UPDATE notificaciones SET intentos = 5, ultimo_error = 'SMTP caído' WHERE tipo='entrega_por_revisar' AND destinatario_id='${ADMIN}'`);   // uno agotado
const nAntes = (await q(`SELECT count(*)::int n FROM notificaciones`))[0].n;

// ── Aplicar 0040 (dos veces) ──
const m40 = fs.readFileSync(R + '0040_notificaciones_integral.sql', 'utf8');
await db.exec(m40);
await db.exec(m40);
console.log('— 0040 aplicada sin errores (dos veces: es idempotente)');

console.log('\n[migración: los avisos históricos se conservan y se renombran]');
ok((await q(`SELECT count(*)::int n FROM notificaciones`))[0].n === nAntes, 'no se perdió ni se duplicó ningún aviso (' + nAntes + ')');
const tipos = (await q(`SELECT DISTINCT tipo FROM notificaciones`)).map(r => r.tipo);
ok(!tipos.some(t => ['nota_publicada', 'nota_corregida', 'tarea_devuelta', 'plazo_movido', 'entrega_por_revisar'].includes(t)), 'ningún aviso conserva un nombre antiguo');
ok(['calificacion_nueva', 'calificacion_cambiada', 'correccion_solicitada', 'entrega_registrada', 'tarea_asignada'].every(t => tipos.includes(t)), 'los renombres: calificacion_nueva, calificacion_cambiada, correccion_solicitada, entrega_registrada');
ok((await q(`SELECT count(*)::int n FROM notificaciones WHERE dedupe_key LIKE 'calificacion_nueva:%'`))[0].n === 1, 'la clave de deduplicación también se renombró');
ok((await q(`SELECT correo_estado FROM notificaciones WHERE tipo='tarea_asignada'`))[0].correo_estado === 'enviado', 'el ya enviado queda «enviado»');
ok((await q(`SELECT correo_estado, correo_motivo FROM notificaciones WHERE tipo='entrega_registrada' AND destinatario_id='${ADMIN}'`))[0].correo_estado === 'fallido', 'el de 5 intentos agotados queda «fallido» con su motivo');
ok((await q(`SELECT correo_estado FROM notificaciones WHERE tipo='correccion_solicitada'`))[0].correo_estado === 'pendiente', 'el pendiente sigue pendiente');
const ref = (await q(`SELECT ref_tipo, ref_id FROM notificaciones WHERE tipo='correccion_solicitada'`))[0];
ok(ref.ref_tipo === 'tarea' && ref.ref_id === String(tH), 'ref_tipo/ref_id se rellenan para los históricos (tarea ' + tH + ')');
ok((await q(`SELECT count(*)::int n FROM notif_tipos`))[0].n === 20, 'el catálogo tiene los 20 tipos');
ok((await q(`SELECT count(*)::int n FROM notif_tipos WHERE esencial`))[0].n === 11, 'hay 11 tipos esenciales y el resto opcionales');
await rejects(`INSERT INTO notificaciones(destinatario_id,tipo) VALUES ('${M1}','inventado')`, 'violates|foreign', 'un tipo fuera del catálogo no entra a la cola (FK)');

console.log('\n[las tablas siguen cerradas al cliente]');
await as(M1);
for (const t of ['notificaciones', 'notif_tipos', 'notif_preferencias', 'notificaciones_eventos'])
  await rejects(`SELECT * FROM ${t}`, 'permission', `authenticated no lee ${t} directamente`);
await rejects(`UPDATE notif_preferencias SET correo = false`, 'permission', 'ni escribe preferencias directamente');
for (const f of [`notif_emitir('tarea_asignada', ARRAY['${M1}']::uuid[], '{}', 'tarea', '1', 'x')`, `notif_encolar('${M1}','tarea_asignada','{}')`,
                 `notif_reclamar(5)`, `notif_marcar(1)`, `notif_log(1,'creado')`, `notif_hay_pendientes()`, `notif_mantenimiento()`])
  await rejects(`SELECT ${f}`, 'permission', 'authenticated NO puede llamar ' + f.split('(')[0]);
await as(null, 'anon');
for (const f of [`mis_notificaciones()`, `notif_resumen()`, `mis_preferencias_notif()`, `guardar_preferencias_notif('{}')`, `notif_estado_envios()`, `notif_reclamar(5)`])
  await rejects(`SELECT * FROM ${f}`, 'permission', 'anon NO puede llamar ' + f.split('(')[0]);
await root();

console.log('\n[notif_encolar valida: destinatarias, audiencia, datos]');
const log = async () => (await q(`SELECT evento, detalle FROM notificaciones_eventos WHERE notificacion_id IS NULL ORDER BY id DESC LIMIT 1`))[0] || {};
const enc = (d, t, datos, k, extra = '') => `SELECT notif_encolar('${d}','${t}','${datos}'::jsonb,${k ? `'${k}'` : 'NULL'}${extra}) id`;
ok((await q(enc(M1, 'inventado', '{}', 'k1')))[0].id === null && (await log()).detalle === 'Tipo desconocido', 'tipo desconocido: se rechaza y queda registrado');
ok((await q(enc(uid(77), 'acceso_aprobado', '{}', 'k2')))[0].id === null, 'destinataria inexistente: se rechaza');
await db.exec(`UPDATE profiles SET aprobado = false WHERE id='${M3}'`);
ok((await q(enc(M3, 'acceso_aprobado', '{}', 'k3')))[0].id === null && /sin acceso/.test((await log()).detalle), 'destinataria sin acceso aprobado: se rechaza');
await db.exec(`UPDATE profiles SET aprobado = true WHERE id='${M3}'`);
ok((await q(enc(M1, 'solicitud_acceso', '{"persona":"X"}', 'k4')))[0].id === null && /miembro no puede/.test((await log()).detalle), 'un tipo solo-administración no llega a un miembro');
ok((await q(enc(ADMIN, 'solicitud_acceso', '{"persona":"X"}', 'k5')))[0].id !== null, 'ese mismo tipo sí llega a la administración');
ok((await q(enc(M1, 'tarea_asignada', '{"periodo":"PE1"}', 'k6')))[0].id === null && /obligatorios/.test((await log()).detalle), 'falta un dato obligatorio (tarea): se rechaza');
const idD = (await q(enc(M1, 'tarea_asignada', JSON.stringify({ tarea: 'Mi tarea', puntaje: 7, secreto: 'x', nota_privada: 'y', periodo: 'a'.repeat(900) }), 'k7')))[0].id;
const dd = (await q(`SELECT datos FROM notificaciones WHERE id=${idD}`))[0].datos;
ok(!('puntaje' in dd) && !('secreto' in dd) && !('nota_privada' in dd), 'las claves fuera de la lista blanca se descartan (ningún puntaje se cuela)');
ok(dd.periodo.length === 500, 'los textos se recortan a 500 caracteres');
ok((await q(enc(M1, 'tarea_asignada', '{"tarea":"Mi tarea"}', 'k7')))[0].id === null && (await q(`SELECT count(*)::int n FROM notificaciones WHERE dedupe_key='k7'`))[0].n === 1, 'la misma clave no crea un segundo aviso');
ok((await q(`SELECT correo_estado FROM notificaciones WHERE id=${idD}`))[0].correo_estado === 'pendiente', 'un aviso nuevo nace «pendiente» de correo');
ok((await q(`SELECT count(*)::int n FROM notificaciones_eventos WHERE notificacion_id=${idD} AND evento='creado'`))[0].n === 1, 'la creación queda en el registro');
// Sin correo: igual aparece en la campana.
const idSC = (await q(enc(MSIN, 'tarea_asignada', '{"tarea":"Para quien no tiene correo"}', 'k8')))[0].id;
ok(idSC !== null, 'una persona SIN correo igual recibe el aviso de la campana (antes se perdía)');

console.log('\n[notif_emitir: sin repetidos, sin avisar al autor, nunca falla]');
const emit = (t, dests, datos, ev, actor = 'NULL', ref = '99') => `SELECT notif_emitir('${t}', ${dests}, '${datos}'::jsonb, 'equipo', '${ref}', '${ev}', ${actor}) n`;
let n = (await q(emit('equipo_incorporado', arr([M1, M1, M2, ADMIN, M3]), '{"equipo":"Foto","agregado_por":"Admin"}', 'ing1', `'${ADMIN}'`)))[0].n;
ok(n === 3, 'repetidas y el autor se descartan: 5 entradas → 3 avisos (M1, M2, M3)');
ok((await q(`SELECT count(*)::int n FROM notificaciones WHERE tipo='equipo_incorporado' AND destinatario_id='${ADMIN}'`))[0].n === 0, 'el autor del hecho no se avisa a sí mismo');
n = (await q(emit('equipo_incorporado', arr([M1, M2, M3]), '{"equipo":"Foto"}', 'ing1')))[0].n;
ok(n === 0, 'repetir el mismo hecho no crea avisos nuevos (idempotente)');
n = (await q(emit('equipo_incorporado', arr([M1]), '{"equipo":"Foto"}', 'ing2')))[0].n;
ok(n === 1, 'otro hecho del mismo equipo (otro «evento») sí avisa');
ok((await q(`SELECT ref_tipo, ref_id, dedupe_key FROM notificaciones WHERE tipo='equipo_incorporado' AND destinatario_id='${M2}'`))[0].dedupe_key === `equipo_incorporado:99:ing1:${M2}`, 'la clave es tipo:ref:evento:destinatario');
n = (await q(`SELECT notif_emitir('equipo_retiro', NULL, '{}'::jsonb, 'equipo', '1', 'x', NULL) n`))[0].n;
ok(n === 0, 'destinatarios NULL: devuelve 0 sin error');
n = (await q(`SELECT notif_emitir('equipo_retiro', ARRAY['${M1}']::uuid[], '{"equipo":"Foto"}'::jsonb, 'equipo', NULL, 'x', NULL) n`))[0].n;
ok(n === 0 && /sin ref_id/.test((await log()).detalle), 'sin ref_id/evento no se puede evitar el duplicado: se rechaza con registro');
n = (await q(`SELECT notif_emitir('solicitud_acceso', ${arr([M1, M2])}, '{"persona":"Z"}'::jsonb, 'persona', '5', 'e', NULL) n`))[0].n;
ok(n === 0, 'un tipo solo-administración emitido a miembros no crea ningún aviso');

console.log('\n[disparadores con los tipos nuevos]');
await root();
await db.exec(`DELETE FROM notificaciones`);   // limpiar para contar exacto
await as(ADMIN);
const t2 = await idDe(insT(ADMIN, M1, 'Reel del evento'));
await root();
let nt = await q(`SELECT destinatario_id, tipo, ref_tipo, ref_id FROM notificaciones WHERE ref_id='${t2}'`);
ok(nt.length === 1 && nt[0].tipo === 'tarea_asignada' && nt[0].destinatario_id === M1 && nt[0].ref_tipo === 'tarea', 'asignar una tarea avisa SOLO a la persona asignada (con ref tarea)');
await as(M1);
await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='listo el reel' WHERE id=${t2}`);
await root();
let ds = (await q(`SELECT destinatario_id FROM notificaciones WHERE tipo='entrega_registrada' AND ref_id='${t2}'`)).map(r => r.destinatario_id).sort();
ok(JSON.stringify(ds) === JSON.stringify([ADMIN, SEC1].sort()), 'la entrega avisa a la administración y a la secretaría de SU distrito, y a nadie más');
ok(!ds.includes(SEC2) && !ds.includes(M1) && !ds.includes(M2), 'no se avisa a otro distrito, a quien entregó ni a un compañero');
await as(SEC1);
await db.exec(`UPDATE tareas SET estado='devuelta', revision_nota='Falta el audio' WHERE id=${t2}`);
await root();
nt = await q(`SELECT destinatario_id, datos FROM notificaciones WHERE tipo='correccion_solicitada' AND ref_id='${t2}'`);
ok(nt.length === 1 && nt[0].destinatario_id === M1 && nt[0].datos.observacion === 'Falta el audio' && nt[0].datos.revisor === 'Sec1', 'la corrección va solo a la persona, con la observación y quién la pidió');
await as(M1);
await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='audio corregido' WHERE id=${t2}`);
await as(SEC1);
await db.exec(`UPDATE tareas SET estado='aprobada', puntos=9 WHERE id=${t2}`);
await root();
ok((await q(`SELECT count(*)::int n FROM notificaciones WHERE tipo='entrega_registrada' AND ref_id='${t2}'`))[0].n === 4, 'una segunda ronda de revisión genera sus propios avisos (2 + 2), sin pisar la primera');
ok((await q(`SELECT datos->>'puntos' p FROM notificaciones WHERE tipo='tarea_aprobada' AND ref_id='${t2}'`))[0].p === '9', 'aprobar avisa a la persona con sus puntos');
await as(ADMIN);
await db.exec(`UPDATE tareas SET estado='entregada' WHERE id=${t2}`);
await root();
nt = await q(`SELECT destinatario_id, datos FROM notificaciones WHERE tipo='estado_cambiado' AND ref_id='${t2}'`);
ok(nt.length === 1 && nt[0].destinatario_id === M1 && nt[0].datos.ahora === 'Por revisar', 'reabrir una tarea aprobada avisa a la persona (estado_cambiado)');
// fecha límite
await as(ADMIN);
const t3 = await idDe(insT(ADMIN, M1, 'Fotos del taller', 3));
await db.exec(`SELECT prorrogar_tarea(${t3}, current_date + 9, 'El taller se movió')`);
await root();
nt = await q(`SELECT destinatario_id, datos FROM notificaciones WHERE tipo='tarea_cambio' AND ref_id='${t3}'`);
ok(nt.length === 1 && nt[0].destinatario_id === M1 && nt[0].datos.cambio === 'Fecha límite' && nt[0].datos.motivo === 'El taller se movió', 'mover la fecha avisa a la persona, con el motivo; no a quien la movió');
ok(!nt.some(x => x.destinatario_id === ADMIN), 'quien hizo el cambio no recibe aviso de su propio cambio');
// instrucciones
await as(ADMIN);
await db.exec(`UPDATE tareas SET descripcion='Ahora son 20 fotos' WHERE id=${t3}`);
await db.exec(`UPDATE tareas SET descripcion='Ahora son 25 fotos' WHERE id=${t3}`);
await root();
nt = await q(`SELECT enviar_despues > now() AS futuro, datos->>'cambio' c FROM notificaciones WHERE tipo='tarea_cambio' AND ref_id='${t3}' AND datos->>'cambio'='Instrucciones'`);
ok(nt.length === 1 && nt[0].futuro, 'dos ediciones de instrucciones seguidas generan UN solo aviso, diferido 10 min (no spam)');
// calificaciones
await root();
await db.exec(`DELETE FROM notificaciones`);
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,evaluador_id,puntajes,bono_ext,estado) VALUES ('${LEG}','${M2}','${ADMIN}','{"pla":3}',0,'borrador')`);
ok((await q(`SELECT count(*)::int n FROM notificaciones`))[0].n === 0, 'un borrador no avisa a nadie');
await db.exec(`UPDATE evaluaciones SET estado='publicado' WHERE evaluado_id='${M2}'`);
nt = await q(`SELECT destinatario_id, datos FROM notificaciones WHERE tipo='calificacion_nueva'`);
ok(nt.length === 1 && nt[0].destinatario_id === M2, 'publicar avisa SOLO a la persona evaluada (calificacion_nueva)');
ok(!('puntajes' in nt[0].datos) && !JSON.stringify(nt[0].datos).includes('"pla"'), 'el aviso no lleva puntajes ni notas');
await db.exec(`UPDATE evaluaciones SET comentarios='{"pla":"Muy buen trabajo"}' WHERE evaluado_id='${M2}'`);
nt = await q(`SELECT destinatario_id, datos, enviar_despues > now() futuro FROM notificaciones WHERE tipo='observacion_nueva'`);
ok(nt.length === 1 && nt[0].destinatario_id === M2 && nt[0].futuro, 'cambiar solo los comentarios genera observacion_nueva (diferida 15 min)');
ok(!JSON.stringify(nt[0].datos).includes('Muy buen trabajo'), 'el aviso de observación NO lleva el texto de la observación');
await db.exec(`UPDATE evaluaciones SET puntajes='{"pla":4}' WHERE evaluado_id='${M2}'`);
ok((await q(`SELECT count(*)::int n FROM notificaciones WHERE tipo='calificacion_cambiada' AND destinatario_id='${M2}'`))[0].n === 1, 'corregir puntajes genera calificacion_cambiada para la persona');
await db.exec(`UPDATE evaluaciones SET puntajes='{"pla":2}' WHERE evaluado_id='${M2}'`);
ok((await q(`SELECT count(*)::int n FROM notificaciones WHERE tipo='calificacion_cambiada' AND destinatario_id='${M2}'`))[0].n === 1, 'dos correcciones en la misma hora = un solo aviso');
// solicitud / aprobación de acceso
await db.exec(`DELETE FROM notificaciones`);
await db.exec(`INSERT INTO profiles(id,nombre,email,aprobado) VALUES ('${uid(50)}','Nueva Persona','nueva@x.cl',false)`);
ds = (await q(`SELECT destinatario_id FROM notificaciones WHERE tipo='solicitud_acceso'`)).map(r => r.destinatario_id);
ok(ds.length === 1 && ds[0] === ADMIN, 'una solicitud de acceso avisa solo a la administración');
await db.exec(`UPDATE profiles SET aprobado = true WHERE id='${uid(50)}'`);
ok((await q(`SELECT destinatario_id FROM notificaciones WHERE tipo='acceso_aprobado'`))[0].destinatario_id === uid(50), 'aprobar el acceso avisa a esa persona');

console.log('\n[recordatorios: «mañana» y «hoy» ya son avisos distintos]');
const defRec = (await q(`SELECT pg_get_functiondef('public.notif_generar_recordatorios()'::regprocedure) d`))[0].d;
ok(defRec.includes("CASE WHEN r.fecha_limite = v_hoy THEN 'hoy' ELSE 'manana' END"), 'la clave del recordatorio distingue hoy / mañana');
ok(defRec.includes('notif_audiencia_actividad(r.id)'), 'y conserva el parche de alcance de 0024');
await db.exec(`DELETE FROM notificaciones`);
await as(ADMIN);
const tHoy = await idDe(`INSERT INTO tareas(periodo_id,titulo,asignada_a,fecha_limite) VALUES ('${PE}','Vence hoy','${M1}',(now() AT TIME ZONE 'America/Santiago')::date) RETURNING id`);
const tMan = await idDe(`INSERT INTO tareas(periodo_id,titulo,asignada_a,fecha_limite) VALUES ('${PE}','Vence mañana','${M2}',(now() AT TIME ZONE 'America/Santiago')::date + 1) RETURNING id`);
await root();
await db.exec(`DELETE FROM notificaciones`);
await db.exec(`SELECT notif_generar_recordatorios()`);
await db.exec(`SELECT notif_generar_recordatorios()`);
const rk = (await q(`SELECT dedupe_key FROM notificaciones WHERE tipo='tarea_por_vencer' ORDER BY dedupe_key`)).map(r => r.dedupe_key);
ok(rk.length === 2 && rk.some(k => k.endsWith(':hoy')) && rk.some(k => k.endsWith(':manana')), 'hoy y mañana generan su aviso; correr el recordatorio dos veces no duplica');

console.log('\n[preferencias: esenciales vs opcionales]');
await as(M1);
let pf = await q(`SELECT * FROM mis_preferencias_notif()`);
ok(pf.length === 17 && !pf.some(p => ['solicitud_acceso', 'evaluaciones_sin_publicar', 'tarea_bloqueada'].includes(p.tipo)), 'un miembro ve 17 tipos; los de administración y secretaría (revisión) no aparecen');
ok(pf.filter(p => p.esencial).every(p => p.correo === true), 'los esenciales figuran siempre activos');
ok(pf.find(p => p.tipo === 'tarea_por_vencer').correo === true, 'los opcionales parten activados (como hasta ahora)');
await rejects(`SELECT guardar_preferencias_notif('{"tarea_asignada": false}')`, 'esencial', 'un aviso esencial NO se puede desactivar');
await rejects(`SELECT guardar_preferencias_notif('{"tarea_por_vencer": false, "tarea_vencida": false}')`, 'esencial', 'y si el conjunto trae uno esencial se rechaza TODO');
ok((await q(`SELECT correo FROM mis_preferencias_notif() WHERE tipo='tarea_por_vencer'`))[0].correo === true, '… sin dejar el conjunto a medias (nada se guardó)');
await rejects(`SELECT guardar_preferencias_notif('{"inventado": false}')`, 'desconocido', 'tipo desconocido rechazado');
await rejects(`SELECT guardar_preferencias_notif('{"actividad_nueva": "no"}')`, 'verdadero o falso', 'valor que no es booleano rechazado');
await rejects(`SELECT guardar_preferencias_notif('{"solicitud_acceso": false}')`, 'no aplica a tu rol', 'un miembro no configura avisos de administración (y no se entera de que existen)');
await rejects(`SELECT guardar_preferencias_notif('[1]')`, 'objeto', 'el formato debe ser un objeto');
ok((await q(`SELECT guardar_preferencias_notif('{"tarea_por_vencer": false, "actividad_nueva": false}') n`))[0].n === 2, 'apagar dos opcionales funciona');
ok((await q(`SELECT correo FROM mis_preferencias_notif() WHERE tipo='tarea_por_vencer'`))[0].correo === false, 'y se refleja en la lista');
await as(M2);
ok((await q(`SELECT correo FROM mis_preferencias_notif() WHERE tipo='tarea_por_vencer'`))[0].correo === true, 'la preferencia de una persona no afecta a otra');
await as(ADMIN);
ok((await q(`SELECT count(*)::int n FROM mis_preferencias_notif()`))[0].n === 20, 'la administración ve los 20 tipos');

console.log('\n[envío: reclamar, omitir por preferencia / sin correo, marcar]');
await root();
await db.exec(`DELETE FROM notificaciones`);
const A = await idDe(`SELECT notif_encolar('${M1}','tarea_por_vencer','{"tarea":"X","cuando":"hoy"}'::jsonb,'e1') id`);       // opcional, M1 lo apagó
const B = await idDe(`SELECT notif_encolar('${M1}','tarea_asignada','{"tarea":"Y"}'::jsonb,'e2') id`);                           // esencial
const C = await idDe(`SELECT notif_encolar('${M2}','tarea_por_vencer','{"tarea":"Z","cuando":"hoy"}'::jsonb,'e3') id`);          // opcional, M2 no apagó
const D = await idDe(`SELECT notif_encolar('${MSIN}','tarea_asignada','{"tarea":"W"}'::jsonb,'e4') id`);                         // sin correo
const E = await idDe(`SELECT notif_encolar('${M3}','tarea_asignada','{"tarea":"V"}'::jsonb,'e5', now() + interval '1 hour') id`);  // futuro
ok((await q(`SELECT notif_hay_pendientes() h`))[0].h === true, 'notif_hay_pendientes() ve lo pendiente');
await as(null, 'service_role');
let lote = await q(`SELECT * FROM notif_reclamar(25)`);
await root();
const idsLote = lote.map(l => String(l.id)).sort();
ok(JSON.stringify(idsLote) === JSON.stringify([String(B), String(C)].sort()), 'solo se reclaman los que deben salir: el esencial de M1 y el opcional de M2');
ok(lote.every(l => l.email && l.intento === 1 && l.ref_tipo === 'tarea'), 'el lote trae correo, número de intento y destino');
ok(lote.find(l => String(l.id) === String(B)).destino === 'trabajos', 'el destino del enlace sale del catálogo según el rol (miembro → trabajos)');
const est = async id => (await q(`SELECT correo_estado, correo_motivo FROM notificaciones WHERE id=${id}`))[0];
ok((await est(A)).correo_estado === 'omitido' && (await est(A)).correo_motivo === 'preferencia', 'el opcional apagado se omite por «preferencia» (sigue en la campana)');
ok((await est(D)).correo_estado === 'omitido' && (await est(D)).correo_motivo === 'sin_correo', 'quien no tiene correo se omite por «sin_correo»');
ok((await est(E)).correo_estado === 'pendiente', 'un aviso programado a futuro no se toca');
await as(null, 'service_role');
ok((await q(`SELECT count(*)::int n FROM notif_reclamar(25)`))[0].n === 0, 'reclamar de nuevo no devuelve lo ya tomado (arrendamiento): no hay envío doble');
ok((await q(`SELECT notif_marcar(${B}, NULL, 'produccion', false, 'apps-script') r`))[0].r === true, 'marcar enviado con éxito');
ok((await q(`SELECT notif_marcar(${B}, NULL, 'produccion', false, 'apps-script') r`))[0].r === false, 'marcarlo otra vez no hace nada (idempotente)');
ok((await q(`SELECT notif_marcar(${B}, 'error tardío') r`))[0].r === false, 'un error tardío NO revierte un envío ya confirmado');
await root();
ok((await est(B)).correo_estado === 'enviado' && (await q(`SELECT enviada_en FROM notificaciones WHERE id=${B}`))[0].enviada_en !== null, 'quedó «enviado» con su fecha');
await as(null, 'service_role');
await db.exec(`SELECT notif_marcar(${C}, NULL, 'prueba')`);
await root();
const c = (await q(`SELECT correo_estado, enviada_en, correo_motivo FROM notificaciones WHERE id=${C}`))[0];
ok(c.correo_estado === 'simulado' && c.enviada_en === null && c.correo_motivo === 'modo_prueba', 'en modo prueba queda «simulado»: SIN fecha de envío (nunca se confunde con uno real)');
ok((await q(`SELECT count(*)::int n FROM notificaciones_eventos WHERE notificacion_id=${C} AND evento='correo_simulado'`))[0].n === 1, 'y el registro dice que fue simulación');

console.log('\n[reintentos con espera creciente y tope]');
await db.exec(`DELETE FROM notificaciones`);
const F = await idDe(`SELECT notif_encolar('${M2}','tarea_asignada','{"tarea":"Reintento"}'::jsonb,'r1') id`);
const esperas = [];
for (let i = 1; i <= 5; i++) {
  await db.exec(`UPDATE notificaciones SET enviar_despues = now() WHERE id=${F} AND correo_estado='pendiente'`);
  await as(null, 'service_role');
  const l = await q(`SELECT * FROM notif_reclamar(5)`);
  if (!l.length) { await root(); break; }
  await db.exec(`SELECT notif_marcar(${F}, 'SMTP 421 temporal', 'produccion', false, 'smtp')`);
  await root();
  const r = (await q(`SELECT correo_estado, intentos, extract(epoch FROM enviar_despues - now())/60 AS min FROM notificaciones WHERE id=${F}`))[0];
  esperas.push(r.correo_estado === 'pendiente' ? Math.round(r.min) : r.correo_estado);
}
console.log('    esperas tras cada fallo (min):', esperas.join(', '));
ok(esperas[0] >= 4 && esperas[0] <= 5 && esperas[1] >= 14 && esperas[1] <= 15 && esperas[2] >= 59 && esperas[2] <= 60 && esperas[3] >= 179 && esperas[3] <= 180, 'la espera crece: ≈5, 15, 60 y 180 minutos');
ok(esperas[4] === 'fallido', 'al quinto fallo queda «fallido» (no se reintenta más)');
ok((await est(F)).correo_estado === 'fallido' && /SMTP 421/.test((await est(F)).correo_motivo), 'con el motivo guardado');
const ev = (await q(`SELECT evento FROM notificaciones_eventos WHERE notificacion_id=${F} ORDER BY id`)).map(e => e.evento);
ok(ev.filter(e => e === 'correo_fallo').length === 4 && ev.includes('correo_agotado'), 'el registro muestra 4 fallos y el agotamiento');
const G = await idDe(`SELECT notif_encolar('${M2}','tarea_asignada','{"tarea":"Permanente"}'::jsonb,'r2') id`);
await as(null, 'service_role');
await db.exec(`SELECT * FROM notif_reclamar(5)`);
await db.exec(`SELECT notif_marcar(${G}, 'Destinatario no válido', 'produccion', true, 'apps-script')`);
await root();
ok((await est(G)).correo_estado === 'fallido', 'un error permanente (dirección inválida) no se reintenta');
// Arrendamiento vencido con intentos gastados
const H = await idDe(`SELECT notif_encolar('${M2}','tarea_asignada','{"tarea":"Colgado"}'::jsonb,'r3') id`);
await db.exec(`UPDATE notificaciones SET intentos = 5, enviar_despues = now() WHERE id=${H}`);
await as(null, 'service_role');
await db.exec(`SELECT * FROM notif_reclamar(5)`);
await root();
ok((await est(H)).correo_estado === 'fallido', 'un aviso con el arrendamiento vencido y 5 intentos pasa a «fallido» (no se queda colgado)');

console.log('\n[la campana: lista, categoría, destino, contador]');
await root();
await db.exec(`DELETE FROM notificaciones`);
const sembrar = async (d, t, datos, k, despues = 'now()') => idDe(`SELECT notif_encolar('${d}','${t}','${datos}'::jsonb,'${k}',${despues}) id`);
const n1 = await sembrar(M1, 'tarea_asignada', '{"tarea":"Uno"}', 'c1', "now() - interval '3 hours'");
const n2 = await sembrar(M1, 'calificacion_nueva', '{"periodo":"PE1"}', 'c2', "now() - interval '2 hours'");
const n3 = await sembrar(M1, 'equipo_incorporado', '{"equipo":"Foto"}', 'c3', "now() - interval '1 hour'");
const n4 = await sembrar(M1, 'tarea_vencida', '{"tarea":"Futuro"}', 'c4', "now() + interval '1 hour'");
const n5 = await sembrar(M2, 'tarea_asignada', '{"tarea":"De Beto"}', 'c5', "now() - interval '1 hour'");
const n6 = await sembrar(MSIN, 'tarea_asignada', '{"tarea":"Sin correo igual ve"}', 'c6', "now() - interval '1 hour'");
const n7 = await sembrar(ADMIN, 'calificacion_nueva', '{"periodo":"PE1"}', 'c7', "now() - interval '1 hour'");
await as(M1);
let li = await q(`SELECT * FROM mis_notificaciones()`);
ok(li.length === 3 && li[0].tipo === 'equipo_incorporado', 'Ana ve sus 3 avisos ya vigentes, el más reciente primero (el de dentro de 1 h no)');
ok(li.every(l => l.categoria && typeof l.esencial === 'boolean'), 'cada aviso trae categoría y si es esencial');
ok(li.find(l => l.tipo === 'calificacion_nueva').destino === 'perfil' && li.find(l => l.tipo === 'tarea_asignada').destino === 'trabajos', 'y la pantalla a la que lleva');
ok(li.find(l => l.tipo === 'tarea_asignada').ref_tipo === 'tarea', 'y el tipo de objeto relacionado');
ok(!JSON.stringify(li).includes('Beto') && !JSON.stringify(li).includes('Sin correo'), 'no se cuela nada de otra persona');
ok((await q(`SELECT notif_no_leidas() n`))[0].n === 3, 'contador = 3');
let rs = await q(`SELECT * FROM notif_resumen() ORDER BY categoria`);
ok(rs.length === 3 && rs.find(r => r.categoria === 'tareas').total === 1 && rs.find(r => r.categoria === 'equipos').sin_leer === 1, 'el resumen cuenta por categoría');
ok((await q(`SELECT * FROM mis_notificaciones(40, NULL, 'tareas')`)).length === 1, 'se filtra por categoría');
ok((await q(`SELECT notif_marcar_leida(${n1}) r`))[0].r === true && (await q(`SELECT notif_no_leidas() n`))[0].n === 2, 'marcar una baja el contador a 2');
ok((await q(`SELECT * FROM mis_notificaciones(40, NULL, NULL, true)`)).length === 2, 'el filtro «sin leer» devuelve solo 2');
ok((await q(`SELECT notif_marcar_leida(${n5}) r`))[0].r === false, 'no se puede marcar el aviso de otra persona');
ok((await q(`SELECT notif_marcar_todas('equipos') n`))[0].n === 1 && (await q(`SELECT notif_no_leidas() n`))[0].n === 1, 'marcar todas SOLO de una categoría');
ok((await q(`SELECT notif_marcar_todas() n`))[0].n === 1 && (await q(`SELECT notif_no_leidas() n`))[0].n === 0, 'marcar todas deja el contador en 0');
await root();
ok((await q(`SELECT leida_en FROM notificaciones WHERE id=${n4}`))[0].leida_en === null, 'el aviso futuro no se marcó por adelantado');
await as(MSIN);
ok((await q(`SELECT * FROM mis_notificaciones()`)).length === 1, 'quien no tiene correo ve su aviso en la campana');
await as(ADMIN);
ok((await q(`SELECT destino FROM mis_notificaciones() WHERE tipo='calificacion_nueva'`))[0].destino === 'evaluar', 'el destino depende del rol (administración → evaluar)');
await root();
await db.exec(`SELECT set_config('request.jwt.claim.sub','',false)`);
await rejects(`SET ROLE authenticated; SELECT * FROM mis_notificaciones()`, 'sesion', 'sin sesión se rechaza');
await root();

console.log('\n[estado de los envíos: solo administración]');
await as(M1);
await rejects(`SELECT * FROM notif_estado_envios()`, 'administraci', 'un miembro no ve el estado de los envíos');
await as(SEC1);
await rejects(`SELECT * FROM notif_estado_envios()`, 'administraci', 'ni la secretaría');
await as(ADMIN);
const ee = await q(`SELECT * FROM notif_estado_envios(7)`);
ok(ee.length > 0 && ee.every(e => e.tipo && e.correo_estado), 'la administración ve el resumen por tipo y estado');
await root();
ok((await q(`SELECT notif_mantenimiento() n`))[0].n === 0, 'el mantenimiento corre (no hay registros de más de 90 días)');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
