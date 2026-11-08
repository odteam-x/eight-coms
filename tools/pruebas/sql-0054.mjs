// Pruebas de 0054 (estadísticas de Instagram: el valor y la captura anteriores se conservan) contra Postgres real (PGlite), con RLS.
// Parte de la misma base que sql-0043 (distritos, storage mínimo) y aplica 0043 y luego 0054.
import { crear, montar, uid, sql } from './base-eq.mjs';

const t = crear();
const { db, q, ok, as, root, rejects, allowed, fin } = t;
const ids = await montar(t, ['0015_rubrica_v2.sql', '0015_seed_perfiles.PENDIENTE.sql']);
const { P, PE1, PE2 } = ids;

await db.exec(`
  CREATE TABLE public.distritos (id TEXT PRIMARY KEY, nombre TEXT, activo BOOLEAN DEFAULT true);
  CREATE FUNCTION public.get_my_distrito() RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT distrito FROM profiles WHERE id = auth.uid() $$;
  INSERT INTO public.distritos(id, nombre) VALUES ('08-01','Distrito 08-01'),('08-02','Distrito 08-02'),('08-03','Distrito 08-03');

  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN DEFAULT false, file_size_limit BIGINT, allowed_mime_types TEXT[]);
  CREATE TABLE storage.objects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT, name TEXT);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS
    $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  GRANT USAGE ON SCHEMA storage TO anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
`);
await db.exec(sql('0043_estadisticas_distrito.sql'));

const m54 = sql('0054_estadisticas_distrito_historial.sql');
await db.exec(m54);
await db.exec(m54);
console.log('— 0054 aplicada sin errores (dos veces: es idempotente)');

const ruta = (dist, per, f = 'captura-1.webp') => `${dist}/${per}/${f}`;
const ins = (dist, per) => `INSERT INTO estadisticas_distrito(periodo_id, distrito_id, visualizaciones, cuentas_alcanzadas, visitas_perfil, seguidores_neto,
  pct_publicaciones, pct_historias, pct_reels, captura_path)
  VALUES ('${per}', '${dist}', 41937, 9251, 1325, 125, 53.7, 23.7, 22.6, '${ruta(dist, per)}')`;
const nHist = async () => (await q('SELECT count(*)::int n FROM estadisticas_distrito_hist'))[0].n;

console.log('\n[corregir guarda lo anterior]');
await as(P.SEC1);
await allowed(ins('08-01', PE1), 'la secretaría sube las cifras de su distrito');
await root();
ok(await nHist() === 0, 'subir por primera vez no es historia');
await as(P.SEC1);
await allowed(`UPDATE estadisticas_distrito SET visualizaciones = 50000, captura_path = '${ruta('08-01', PE1, 'captura-2.webp')}' WHERE distrito_id='08-01' AND periodo_id='${PE1}'`, 'corrige las visualizaciones y reemplaza la captura');
await root();
let h = await q('SELECT * FROM estadisticas_distrito_hist');
ok(h.length === 1 && h[0].accion === 'corregida' && Number(h[0].visualizaciones) === 41937, 'queda el valor ANTERIOR (41 937)');
ok(h[0].captura_path === ruta('08-01', PE1), 'y la ruta de la captura anterior (no se pierde la prueba)');
ok(h[0].cambiado_por === P.SEC1 && !!h[0].subido_por, 'con quién la reemplazó y quién la había subido');
ok(Number((await q("SELECT visualizaciones FROM estadisticas_distrito WHERE distrito_id='08-01'"))[0].visualizaciones) === 50000, 'la fila vigente tiene el valor nuevo (sin cambios de comportamiento)');
await as(P.SEC1);
await db.exec(`UPDATE estadisticas_distrito SET visualizaciones = 50000 WHERE distrito_id='08-01' AND periodo_id='${PE1}'`);
await root();
ok(await nHist() === 1, 'una «corrección» sin cambios no agrega historia');

console.log('\n[borrar también deja rastro]');
await as(P.ADMIN);
await allowed(`DELETE FROM estadisticas_distrito WHERE distrito_id='08-01' AND periodo_id='${PE1}'`, 'la administración borra la entrega');
await root();
h = await q('SELECT accion, cambiado_por FROM estadisticas_distrito_hist ORDER BY id DESC LIMIT 1');
ok(h[0].accion === 'borrada' && h[0].cambiado_por === P.ADMIN, 'queda «borrada» con quién la borró');

console.log('\n[quién lee el historial]');
await as(P.SEC1);
await allowed(ins('08-01', PE2), 'nueva entrega en otro período');
await db.exec(`UPDATE estadisticas_distrito SET seguidores_neto = 7 WHERE distrito_id='08-01' AND periodo_id='${PE2}'`);
ok((await q(`SELECT count(*)::int n FROM estadisticas_distrito_historial('${PE2}','08-01')`))[0].n === 1, 'la secretaría ve el historial de SU distrito');
await rejects(`SELECT * FROM estadisticas_distrito_historial('${PE2}','08-02')`, 'administracion o la secretaria', 'no el de otro distrito');
await rejects('SELECT * FROM estadisticas_distrito_hist', 'permission|denied', 'ni la tabla directa');
await as(P.SEC2);
await rejects(`SELECT * FROM estadisticas_distrito_historial('${PE2}','08-01')`, 'administracion o la secretaria', 'otra secretaría no ve el de 08-01');
await as(P.M1);
await rejects(`SELECT * FROM estadisticas_distrito_historial('${PE2}','08-01')`, 'administracion o la secretaria', 'un miembro no lo ve');
await as(P.ADMIN);
ok((await q(`SELECT count(*)::int n FROM estadisticas_distrito_historial('${PE2}','08-01')`))[0].n === 1, 'la administración ve cualquiera');
await rejects('DELETE FROM estadisticas_distrito_hist', 'permission|denied', 'nadie borra la historia (ni la administración)');
await as(null, 'anon');
await rejects(`SELECT * FROM estadisticas_distrito_historial('${PE2}','08-01')`, 'permission|denied', 'anon no ejecuta la función');

fin();
