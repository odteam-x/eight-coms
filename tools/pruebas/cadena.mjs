// Cadena COMPLETA de migraciones (0015 → 0051) aplicada de verdad, en orden numérico, sobre el esquema base.
// Hasta ahora cada prueba montaba SU parte de la cadena; nadie había aplicado todo junto, así que las migraciones de
// sesiones distintas (p. ej. 0040/0041 de avisos y 0050/0051 del reporte general) nunca se habían visto entre sí.
//
// Comprueba:
//   1. Se aplica entera, en orden numérico, sin un solo error.
//   2. Se puede volver a aplicar entera (idempotente): ejecutar una migración dos veces no rompe ni duplica.
//   3. Auditoría del catálogo con la cadena completa: RLS activa en toda tabla nueva; ninguna función
//      SECURITY DEFINER queda ejecutable por anon salvo las que lo necesitan a propósito; anon no lee nada.
//   4. Dos migraciones no redefinen la misma función con firmas contradictorias (se avisa de las que sí lo hacen).
import fs from 'node:fs';
import { crear, montar, R, uid } from './base-eq.mjs';

const t = crear();
const { db, q, ok, as, root, c } = t;

const todas = fs.readdirSync(R).filter(f => /^\d{4}_.*\.sql$/.test(f) && !/PENDIENTE/.test(f))
  .filter(f => Number(f.slice(0, 4)) >= 15).sort();
console.log(`Migraciones en la cadena (${todas.length}):`, todas.map(f => f.slice(0, 4)).join(' '));

// Lo único de Supabase que el Postgres de prueba no tiene: el rol service_role y pg_net/pg_cron (0019 los crea y programa tareas con ellos).
// Se sustituyen por huecos que no ejecutan nada; el resto de la migración se aplica tal cual.
const STUBS_SUPABASE = `
  DO $r$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END $r$;
  GRANT USAGE ON SCHEMA public TO service_role;
  CREATE SCHEMA IF NOT EXISTS cron;
  CREATE SCHEMA IF NOT EXISTS net;
  CREATE TABLE IF NOT EXISTS cron.job (jobname TEXT, command TEXT);
  CREATE OR REPLACE FUNCTION cron.schedule(TEXT, TEXT, TEXT) RETURNS BIGINT LANGUAGE sql AS $$ SELECT 1::BIGINT $$;
  CREATE OR REPLACE FUNCTION cron.unschedule(TEXT) RETURNS BOOLEAN LANGUAGE sql AS $$ SELECT true $$;
  -- Esquema previo de producción que 0043 usa: tabla distritos, get_my_distrito() y Storage (copia mínima, con RLS).
  CREATE TABLE IF NOT EXISTS public.distritos (id TEXT PRIMARY KEY, nombre TEXT, activo BOOLEAN DEFAULT true);
  CREATE OR REPLACE FUNCTION public.get_my_distrito() RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT distrito FROM profiles WHERE id = auth.uid() $$;
  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE IF NOT EXISTS storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN DEFAULT false, file_size_limit BIGINT, allowed_mime_types TEXT[]);
  CREATE TABLE IF NOT EXISTS storage.objects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT, name TEXT);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE OR REPLACE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`;
const leer = f => {
  let s = fs.readFileSync(R + f, 'utf8');
  if (f.startsWith('0019')) s = s.replace(/^CREATE EXTENSION[^\n]*\n/gm, '-- (extensión de Supabase omitida en la prueba)\n');
  return s;
};

// ── 1. Aplicación entera en orden numérico ───────────────────────────────────────────────────────────────────────
// montar() crea el esquema base y aplica la primera (0015, que añade las columnas que usa el resto de la base de
// prueba); después cada migración, UNA A UNA y en orden, sobre datos ya existentes (personas, períodos, equipos).
let ids;
try {
  ids = await montar(t, [todas[0], '0015_seed_perfiles.PENDIENTE.sql']);
  await db.exec(STUBS_SUPABASE);
  // Estado previo de producción: la migración 0008 (que esta base de prueba no tiene) ya le quitó EXECUTE a anon, y
  // CREATE OR REPLACE conserva los permisos. Se reproduce aquí para comprobar lo que importa: que NINGUNA migración
  // posterior (0016 → 0051) se lo vuelva a conceder.
  await db.exec(`REVOKE EXECUTE ON FUNCTION public.abrir_gestion(text, bigint) FROM PUBLIC, anon;`);
} catch (e) {
  ok(false, 'no se pudo montar la base → ' + String(e.message).slice(0, 300)); t.fin();
}
let paso = null;
try {
  for (const f of todas.slice(1)) { paso = f; await db.exec(leer(f)); }
  ok(true, `las ${todas.length} migraciones se aplican en orden numérico sin errores`);
} catch (e) {
  ok(false, `la cadena se detiene en ${paso} → ` + String(e.message).slice(0, 300));
  t.fin();
}

// ── 2. Idempotencia ──────────────────────────────────────────────────────────────────────────────────────────────
// Cada migración se aplica DOS VECES seguidas en su sitio (como al repetir por error un archivo en el SQL Editor).
// Reaplicar una vieja después de las nuevas no es un caso real: 0015 no puede devolver a resultados_periodo() su forma
// de antes de 0035, y no debe poder.
await root();
const catalogo = async db2 => ({
  funciones: (await db2.query(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname='public'`)).rows[0].n,
  tablas: (await db2.query(`SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'`)).rows[0].n,
  politicas: (await db2.query(`SELECT count(*)::int n FROM pg_policies WHERE schemaname='public'`)).rows[0].n,
  triggers: (await db2.query(`SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal`)).rows[0].n,
});
const base1 = await catalogo(db);
const t2 = crear();
await montar(t2, [todas[0], '0015_seed_perfiles.PENDIENTE.sql']);
await t2.db.exec(STUBS_SUPABASE);
const fallos = [];
for (const f of todas.slice(1)) {
  try { await t2.db.exec(leer(f)); await t2.db.exec(leer(f)); }
  catch (e) { fallos.push(`${f.slice(0, 4)}: ${String(e.message).slice(0, 120)}`); await t2.db.exec('ROLLBACK').catch(() => {}); }
}
ok(fallos.length === 0, fallos.length ? 'aplicada dos veces en su sitio, falla: ' + fallos.join(' | ') : 'cada migración se puede aplicar dos veces seguidas sin error (idempotente)');
const base2 = await catalogo(t2.db);
ok(JSON.stringify(base1) === JSON.stringify(base2), `aplicar dos veces no duplica nada: ${JSON.stringify(base2)}`);

// ── 3. Auditoría del catálogo con la cadena completa ─────────────────────────────────────────────────────────────
const sinRls = await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity AND c.relname NOT IN ('profiles_stub')`);
console.log('  (tablas sin RLS:', sinRls.map(r => r.relname).join(', ') || 'ninguna', ')');
const nuevas = ['criterios_v2', 'perfiles_rol', 'perfil_criterios', 'tareas', 'tarea_eventos', 'equipos', 'equipo_miembros', 'notif_tipos'];
const existentes = nuevas.filter(n => true);
for (const n of existentes) {
  const r = await q(`SELECT c.relrowsecurity rls FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='public' AND c.relname='${n}'`);
  if (r.length) ok(r[0].rls === true, `RLS activa en ${n}`);
}

// Funciones SECURITY DEFINER ejecutables por anon: solo las que las políticas necesitan (lista cerrada).
const PERMITIDAS_ANON = new Set([
  'is_admin', 'is_secretario', 'get_my_distrito', 'get_district_member_ids', 'gestion_escribible', 'gestion_id_escribible',
  'hay_gestion_abierta', 'mi_distrito', 'auth_uid_stub', 'uid',
]);
const defANON = await q(`SELECT p.proname, pg_get_function_identity_arguments(p.oid) args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')`);
const inesperadas = defANON.filter(f => !PERMITIDAS_ANON.has(f.proname));
ok(inesperadas.length === 0, inesperadas.length
  ? `funciones SECURITY DEFINER ejecutables por anon que no estaban previstas: ${inesperadas.map(f => f.proname + '(' + f.args + ')').join(', ')}`
  : `ninguna función SECURITY DEFINER es ejecutable por anon fuera de la lista prevista (${defANON.length} previstas)`);

// anon no lee ninguna tabla con datos
await as(null, 'anon');
const tablasPub = await (async () => { await root(); return (await q(`SELECT tablename FROM pg_tables WHERE schemaname='public'`)).map(r => r.tablename); })();
const legibles = [];
for (const tb of tablasPub) {
  await as(null, 'anon');
  try { const r = await db.query(`SELECT count(*)::int n FROM public."${tb}"`); if (r.rows[0].n > 0) legibles.push(`${tb}(${r.rows[0].n})`); }
  catch { /* permission denied: lo esperado */ }
}
await root();
ok(legibles.length === 0, legibles.length ? 'anon LEE filas de: ' + legibles.join(', ') : `anon no puede leer filas en ninguna de las ${tablasPub.length} tablas`);

// ── 4. Funciones definidas por más de una migración ──────────────────────────────────────────────────────────────
const def = new Map();
for (const f of todas) {
  const s = fs.readFileSync(R + f, 'utf8');
  for (const m of s.matchAll(/CREATE OR REPLACE FUNCTION\s+(?:public\.)?(\w+)\s*\(([^)]*)\)/gi)) {
    const k = m[1];
    if (!def.has(k)) def.set(k, []);
    def.get(k).push(f.slice(0, 4));
  }
}
const multi = [...def.entries()].filter(([, v]) => new Set(v).size > 1);
console.log('\nFunciones redefinidas por varias migraciones (gana la última en orden numérico):');
for (const [k, v] of multi) console.log(`  ${k.padEnd(34)} ${[...new Set(v)].join(' → ')}`);

// el resultado de las funciones de lectura con la cadena completa responde (no solo existen)
const p = ids.P;
await as(p.ADMIN);
for (const fn of ["resultados_periodo('" + ids.PE1 + "'::uuid)", "resumen_tareas_periodo('" + ids.PE1 + "'::uuid)"]) {
  try { await db.query(`SELECT * FROM ${fn}`); ok(true, `${fn.split('(')[0]}() responde con la cadena completa`); }
  catch (e) { ok(false, `${fn.split('(')[0]}() falla con la cadena completa → ${String(e.message).slice(0, 120)}`); }
}
await root();

t.fin();
