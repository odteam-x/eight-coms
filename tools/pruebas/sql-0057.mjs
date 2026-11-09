// Pruebas de 0057 (correo: los avisos opcionales vuelven a salir encendidos por defecto; la persona los apaga a mano). Parte de 0042 aplicada. (Original: 0042 contra Postgres real (PGlite), con RLS.
// Mismo esquema base que sql-0040.mjs (0015–0019, 0022, 0024 + 0040 aplicada); aquí se aplica 0042 encima y se comprueba
// que el correo por defecto solo sea de los esenciales, que correo_default de verdad decida el envío, y que la campana no cambie.
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

// ── Aplicar 0042 (dos veces) ──
const m42 = fs.readFileSync(R + '0042_correo_opcionales_apagados.sql', 'utf8');
await root();
await db.exec(m42);
await db.exec(m42);
console.log('— 0042 aplicada');
const m57 = fs.readFileSync(R + '0057_correo_opcionales_encendidos.sql', 'utf8');
await root();
await db.exec(m57);
await db.exec(m57);
console.log('— 0057 aplicada sin errores (dos veces: es idempotente)');


console.log('\n[catalogo: todo va por correo por defecto]');
const cat = await q(`SELECT tipo, esencial, correo_default FROM notif_tipos`);
ok(cat.length === 20, 'siguen los 20 tipos');
ok(cat.every(t => t.correo_default === true), 'los 20 tipos (11 esenciales + 9 opcionales) salen por correo por defecto');

console.log('\n[preferencias: encendidas hasta que la persona las apague]');
await as(M1);
const pf = await q(`SELECT tipo, esencial, correo FROM mis_preferencias_notif()`);
ok(pf.every(p => p.correo === true), 'todas se ven encendidas, tambien los opcionales');
await rejects(`SELECT guardar_preferencias_notif('{"tarea_asignada": false}')`, 'esencial', 'un esencial sigue sin poder apagarse');
await allowed(`SELECT guardar_preferencias_notif('{"tarea_por_vencer": false}')`, 'una persona puede APAGAR un opcional');
ok((await q(`SELECT correo FROM mis_preferencias_notif() WHERE tipo='tarea_por_vencer'`))[0].correo === false, 'y se ve apagado solo para ella');
await as(M2);
ok((await q(`SELECT correo FROM mis_preferencias_notif() WHERE tipo='tarea_por_vencer'`))[0].correo === true, 'sin afectar a otra persona');

console.log('\n[envio: sin preferencia sale; apagado a mano no sale]');
await root();
await db.exec(`DELETE FROM notificaciones`);
const O1 = await idDe(`SELECT notif_encolar('${M1}','tarea_por_vencer','{"tarea":"X","cuando":"hoy"}'::jsonb,'o1') id`);
const O2 = await idDe(`SELECT notif_encolar('${M2}','tarea_por_vencer','{"tarea":"Z","cuando":"hoy"}'::jsonb,'o3') id`);
const O3 = await idDe(`SELECT notif_encolar('${M3}','tarea_aprobada','{"tarea":"W"}'::jsonb,'o5') id`);
const E1 = await idDe(`SELECT notif_encolar('${M1}','tarea_asignada','{"tarea":"Y"}'::jsonb,'o2') id`);
await as(null, 'service_role');
const lote = await q(`SELECT * FROM notif_reclamar(25)`);
await root();
const ids = lote.map(l => String(l.id)).sort();
ok(JSON.stringify(ids) === JSON.stringify([String(E1), String(O2), String(O3)].sort()), 'salen el esencial y los dos opcionales sin preferencia (3 de 4)');
const e1 = (await q(`SELECT correo_estado, correo_motivo FROM notificaciones WHERE id=${O1}`))[0];
ok(e1.correo_estado === 'omitido' && e1.correo_motivo === 'preferencia', 'el opcional que la persona apago se omite por preferencia');

console.log('\n[la campana NO cambia]');
await as(M1);
ok((await q(`SELECT count(*)::int n FROM mis_notificaciones(50) WHERE tipo='tarea_por_vencer'`))[0].n === 1, 'el aviso apagado por correo sigue en la campana');
await root();

console.log('\n[volumen: una tarea de equipo + nota publicada, 25 personas]');
await db.exec(`DELETE FROM notificaciones`);
for (let i = 10; i < 31; i++) await db.exec(`INSERT INTO profiles(id,nombre,email,distrito) VALUES ('${uid(i)}','P${i}','p${i}@x.cl','08-01')`);
const todas = (await q(`SELECT id FROM profiles WHERE COALESCE(btrim(email),'') <> '' AND NOT es_admin`)).map(r => r.id);
for (const p of todas) {
  await db.exec(`SELECT notif_encolar('${p}','tarea_colectiva_asignada','{"tarea":"Equipo","equipo":"Alfa"}'::jsonb,'v1:${p}')`);
  await db.exec(`SELECT notif_encolar('${p}','tarea_por_vencer','{"tarea":"Equipo","cuando":"hoy"}'::jsonb,'v2:${p}')`);
  await db.exec(`SELECT notif_encolar('${p}','tarea_aprobada','{"tarea":"Equipo"}'::jsonb,'v3:${p}')`);
  await db.exec(`SELECT notif_encolar('${p}','calificacion_nueva','{}'::jsonb,'v4:${p}')`);
}
await as(null, 'service_role');
let salen = 0;
for (let i = 0; i < 8; i++) { const l = await q(`SELECT * FROM notif_reclamar(100)`); salen += l.length; if (!l.length) break; }
await root();
ok(salen === todas.length * 4 - 1, `de ${todas.length * 4} avisos salen por correo ${salen} (todos menos el que M1 apago): vigilar el tope diario del remitente`);

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
