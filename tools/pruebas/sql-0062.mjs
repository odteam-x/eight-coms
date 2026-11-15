// Pruebas de 0062: publicación Realtime y señal de avisos. PGlite con roles reales (SET ROLE), así la RLS y los REVOKE cuentan.
// Lo que NO se puede probar aquí (y está dicho en docs/sincronizacion-tiempo-real.md): que Realtime esté habilitado en el proyecto de
// Supabase y que el servicio entregue los eventos; aquí se prueba la parte que es SQL: qué tablas se publican, quién las puede leer y la señal.
import fs from 'node:fs';
import { crear, montar, CADENA_BASE, sql, J, R } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, allowed, fin } = t;
// Como Supabase: la publicación ya existe, vacía.
await db.exec(`CREATE PUBLICATION supabase_realtime`);
const CADENA = [...CADENA_BASE, '0031_equipos.sql', '0032_tareas_equipo.sql', '0033_calificaciones.sql', '0034_calificacion_tareas.sql', '0035_resultados_integrados.sql'];
const X = await montar(t, CADENA);
const { P, PE1 } = X;

// notificaciones como en producción (0019 + leida_en de 0022/0040), sin pg_cron/pg_net: cerrada a authenticated.
const m19 = fs.readFileSync(R + '0019_notificaciones.sql', 'utf8');
await db.exec(m19.match(/CREATE TABLE IF NOT EXISTS public\.notificaciones \([\s\S]*?\n\);/)[0] + `
  ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS leida_en TIMESTAMPTZ;
  REVOKE ALL ON public.notificaciones FROM anon, authenticated;`);
// Una tabla de las publicables SIN RLS (trabajos_entregados nace así en el esquema de prueba) y una SIN clave primaria.
await db.exec(`ALTER TABLE public.trabajos_entregados DISABLE ROW LEVEL SECURITY`);
// El esquema mínimo de prueba no activa RLS en sus tablas; en producción TODAS la tienen (docs/auditoria/06). Se imita aquí.
for (const tb of ['evaluaciones', 'periodos_evaluacion', 'profiles', 'roles', 'criterios', 'rubrica', 'calendario', 'gestiones', 'config', 'periodo_participantes']) {
  await db.exec(`ALTER TABLE public.${tb} ENABLE ROW LEVEL SECURITY; CREATE POLICY todo_${tb} ON public.${tb} FOR ALL TO authenticated USING (true) WITH CHECK (true)`);
}
await db.exec(`CREATE TABLE public.etiquetas_sin_pk (x INT)`);

const publicadas = async () => (await q(`SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' ORDER BY 1`)).map(r => r.tablename);

console.log('[la migración]');
const m = sql('0062_sincronizacion_tiempo_real.sql');
await allowed(m, '0062 se aplica sin errores sobre el esquema real hasta 0035');
await allowed(m, 'reaplicar 0062 es idempotente');
const pub = await publicadas();
ok(JSON.stringify(pub) === JSON.stringify([...new Set(pub)]), 'ninguna tabla queda publicada dos veces');

console.log('\n[qué se publica]');
for (const tabla of ['tareas', 'tareas_equipo', 'evaluaciones', 'periodos_evaluacion', 'profiles', 'equipos', 'equipo_miembros', 'actividades', 'notif_senal'])
  ok(pub.includes(tabla), `se publica ${tabla}`);
ok(!pub.includes('notificaciones'), 'NO se publica notificaciones (cerrada a authenticated: lleva errores de correo e intentos)');
ok(!pub.includes('notificaciones_eventos'), 'NO se publica notificaciones_eventos');
ok(!pub.includes('trabajos_entregados'), 'una tabla SIN RLS no se publica (Realtime enviaría sus filas a quien pueda leerla)');
ok(!pub.includes('etiquetas_sin_pk'), 'una tabla sin clave primaria no se publica (rompería sus UPDATE/DELETE)');
ok(!pub.includes('credenciales') && !pub.includes('gafetes') && !pub.includes('manuales_privados') && !pub.includes('bienvenida_estado'), 'lo privado (gafetes, manuales, bienvenida) no está en la lista');
const sinRLS = await q(`SELECT c.relname FROM pg_class c JOIN pg_publication_tables p ON p.tablename=c.relname AND p.schemaname='public' WHERE p.pubname='supabase_realtime' AND NOT c.relrowsecurity`);
ok(sinRLS.length === 0, 'TODA tabla publicada tiene RLS activada' + (sinRLS.length ? ' → ' + sinRLS.map(r => r.relname) : ''));

console.log('\n[anon no recibe nada]');
const conAnon = [];
for (const tabla of pub) if ((await q(`SELECT has_table_privilege('anon', 'public.${tabla}', 'SELECT') p`))[0].p) conAnon.push(tabla);
ok(conAnon.length === 0, 'anon no tiene SELECT sobre ninguna tabla publicada' + (conAnon.length ? ' → ' + conAnon : ''));
await as(null, 'anon');
await rejects(`SELECT * FROM tareas`, 'permission denied', 'anon no puede leer tareas');
await rejects(`SELECT * FROM notif_senal`, 'permission denied', 'anon no puede leer la señal de avisos');
await root();

console.log('\n[publicar no rompe las escrituras]');
await as(P.ADMIN);
const tid = (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,peso) VALUES ('${PE1}','Reportaje','${P.M1}',1) RETURNING id`))[0].id;
await allowed(`UPDATE tareas SET titulo='Reportaje 2' WHERE id=${tid}`, 'UPDATE de una tarea (tabla publicada) sigue funcionando');
await allowed(`DELETE FROM tareas WHERE id=${tid}`, 'DELETE de una tarea sigue funcionando');
await allowed(`UPDATE profiles SET nombre='M1 nuevo' WHERE id='${P.M1}'`, 'UPDATE de profiles (publicada) sigue funcionando');
await root();

console.log('\n[la señal de avisos]');
const sen = async uid => { await as(uid); const r = await q(`SELECT destinatario_id, tic::int tic FROM notif_senal`); await root(); return r; };
await db.exec(`INSERT INTO notificaciones(destinatario_id, tipo, datos) VALUES ('${P.M1}', 'tarea_asignada', '{"secreto":"no debe salir"}')`);
let s1 = await sen(P.M1);
ok(s1.length === 1 && s1[0].destinatario_id === P.M1 && s1[0].tic === 1, 'un aviso nuevo crea la señal de su destinatario (tic 1)');
await db.exec(`INSERT INTO notificaciones(destinatario_id, tipo, datos) VALUES ('${P.M1}', 'tarea_asignada', '{}')`);
ok((await sen(P.M1))[0].tic === 2, 'otro aviso sube el contador');
ok((await sen(P.M2)).length === 0, 'otra persona NO ve la señal de M1 (RLS)');
ok((await sen(P.ADMIN)).length === 0, 'ni siquiera la administración ve la señal de M1: es personal');
const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name='notif_senal' ORDER BY 1`)).map(r => r.column_name).join();
ok(cols === 'actualizado,destinatario_id,tic', 'la señal no contiene ningún dato del aviso: ' + cols);
await db.exec(`UPDATE notificaciones SET leida_en = now() WHERE destinatario_id='${P.M1}'`);
ok((await sen(P.M1))[0].tic >= 3, 'leer avisos mueve la señal (la campana de otro dispositivo se actualiza)');
await as(P.M1);
await rejects(`UPDATE notif_senal SET tic = 0`, 'permission denied', 'nadie escribe la señal desde el cliente');
await rejects(`INSERT INTO notif_senal(destinatario_id) VALUES ('${P.M2}')`, 'permission denied', 'ni la inserta');
await rejects(`SELECT * FROM notificaciones`, 'permission denied', 'notificaciones sigue cerrada a authenticated (no se abrió nada)');
await root();

console.log('\n[sin la publicación (entorno distinto)]');
const t2 = crear();
await t2.db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid'`);
await t2.db.exec(`CREATE TABLE public.x (id INT PRIMARY KEY)`);
// La migración crea la publicación si falta y omite lo que no existe, sin fallar.
try { await t2.db.exec(`CREATE TABLE public.profiles (id UUID PRIMARY KEY)`); await t2.db.exec(m); ok(true, 'sin publicación previa y con casi nada creado: crea la publicación y omite lo que no existe'); }
catch (e) { ok(false, 'falló en un entorno mínimo → ' + e.message.slice(0, 160)); }
ok((await t2.q(`SELECT count(*)::int n FROM pg_publication WHERE pubname='supabase_realtime'`))[0].n === 1, 'la publicación supabase_realtime existe');

fin();
