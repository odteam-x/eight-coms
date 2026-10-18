// Pruebas de 0043 (estadísticas de Instagram del distrito, subidas por la secretaría con captura) contra Postgres real (PGlite), con RLS.
// Storage de Supabase no existe en PGlite: se monta una copia MÍNIMA (buckets, objects con RLS y foldername) para probar de verdad
// las políticas de las capturas con SET ROLE, no solo que el SQL parsee.
import { crear, montar, uid } from './base-eq.mjs';
import { sql } from './base-eq.mjs';

const t = crear();
const { db, q, ok, as, root, rejects, allowed, fin } = t;
const ids = await montar(t, ['0015_rubrica_v2.sql', '0015_seed_perfiles.PENDIENTE.sql']);
const { P, PE1, PE2, ARCH } = ids;
const SEC3 = uid(93);

await db.exec(`
  CREATE TABLE public.distritos (id TEXT PRIMARY KEY, nombre TEXT, activo BOOLEAN DEFAULT true);
  CREATE FUNCTION public.get_my_distrito() RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT distrito FROM profiles WHERE id = auth.uid() $$;
  INSERT INTO public.distritos(id, nombre) VALUES ('08-01','Distrito 08-01'),('08-02','Distrito 08-02'),('08-03','Distrito 08-03');
  INSERT INTO public.profiles(id,nombre,tipo_miembro,distrito) VALUES ('${SEC3}','Sec3','secretario','08-01');

  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN DEFAULT false, file_size_limit BIGINT, allowed_mime_types TEXT[]);
  CREATE TABLE storage.objects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT, name TEXT);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS
    $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  GRANT USAGE ON SCHEMA storage TO anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
`);

const m43 = sql('0043_estadisticas_distrito.sql');
await db.exec(m43);
await db.exec(m43);
console.log('— 0043 aplicada sin errores (dos veces: es idempotente)');

const ruta = (dist, per, f = 'captura-1.webp') => `${dist}/${per}/${f}`;
const ins = (dist, per, extra = {}) => {
  const c = { visualizaciones: 41937, cuentas_alcanzadas: 9251, visitas_perfil: 1325, seguidores_neto: 125,
    pct_publicaciones: 53.7, pct_historias: 23.7, pct_reels: 22.6, captura_path: ruta(dist, per), ...extra };
  return `INSERT INTO estadisticas_distrito(periodo_id, distrito_id, visualizaciones, cuentas_alcanzadas, visitas_perfil, seguidores_neto,
    pct_publicaciones, pct_historias, pct_reels, captura_path${c.subido_por ? ', subido_por' : ''})
    VALUES ('${per}', '${dist}', ${c.visualizaciones}, ${c.cuentas_alcanzadas}, ${c.visitas_perfil}, ${c.seguidores_neto},
    ${c.pct_publicaciones}, ${c.pct_historias}, ${c.pct_reels}, ${c.captura_path === null ? 'NULL' : `'${c.captura_path}'`}${c.subido_por ? `, '${c.subido_por}'` : ''})`;
};
const cuenta = async () => (await q(`SELECT count(*)::int n FROM estadisticas_distrito`))[0].n;

console.log('\n[quién puede escribir]');
await as(P.SEC1);
await allowed(ins('08-01', PE1), 'la secretaría de 08-01 sube las estadísticas de SU distrito');
await rejects(ins('08-02', PE1, { captura_path: ruta('08-02', PE1) }), 'row-level security', 'no puede subir las de otro distrito');
await as(P.M1);
await rejects(ins('08-01', PE2), 'row-level security', 'un miembro no puede subir estadísticas aunque sea de su distrito');
await as(null, 'anon');
await rejects(`SELECT count(*) FROM estadisticas_distrito`, 'permission', 'anon no tiene acceso a la tabla');
await root();

console.log('\n[quién ve qué]');
await as(P.SEC1);
ok(await cuenta() === 1, 'la secretaría ve la entrega de su distrito');
await as(P.SEC2);
ok(await cuenta() === 0, 'la secretaría de otro distrito no ve nada');
await as(P.M1);
ok(await cuenta() === 0, 'un miembro no ve nada');
await as(SEC3);
ok(await cuenta() === 1, 'otra secretaría del mismo distrito ve la misma entrega (es una por distrito y PE)');
await as(P.ADMIN);
ok(await cuenta() === 1, 'el admin ve todo');
await root();

console.log('\n[lo que el servidor fija]');
await as(P.SEC1);
await allowed(ins('08-01', PE2, { subido_por: P.M2 }), 'una entrega nueva con subido_por inventado…');
await root();
{ const r = (await q(`SELECT subido_por, subido_por_nombre FROM estadisticas_distrito WHERE periodo_id='${PE2}'`))[0];
  ok(r.subido_por === P.SEC1 && r.subido_por_nombre === 'Sec1', '…queda a nombre de quien la subió de verdad, con su nombre (el servidor lo fija)'); }

console.log('\n[validación de cifras y captura]');
await as(P.SEC2);
const malo = (extra, msg, pat) => rejects(ins('08-02', PE1, extra), pat, msg);
await malo({ visualizaciones: -1 }, 'visualizaciones negativas rechazadas', 'check|violates');
await malo({ pct_reels: 100.5 }, 'un porcentaje sobre 100 rechazado', 'check|violates');
await malo({ pct_historias: -0.1 }, 'un porcentaje bajo 0 rechazado', 'check|violates');
await malo({ captura_path: null }, 'sin captura de prueba no se guarda', 'captura|null');
await malo({ captura_path: ruta('08-01', PE1) }, 'una captura en la carpeta de OTRO distrito rechazada', 'captura');
await malo({ captura_path: ruta('08-02', PE2) }, 'una captura en la carpeta de OTRO período rechazada', 'captura');
await malo({ captura_path: ruta('08-02', PE1, 'foto.png') }, 'solo .webp / .jpg', 'captura');
await malo({ captura_path: ruta('08-02', PE1, '../x.webp') }, 'sin recorrer carpetas', 'captura');
await allowed(ins('08-02', PE1, { seguidores_neto: -40 }), 'seguidores netos pueden ser negativos (una baja)');
await root();

console.log('\n[corregir y repetir]');
await as(SEC3);
await allowed(`INSERT INTO estadisticas_distrito(periodo_id, distrito_id, visualizaciones, cuentas_alcanzadas, visitas_perfil, seguidores_neto, pct_publicaciones, pct_historias, pct_reels, captura_path)
  VALUES ('${PE1}','08-01', 50000, 9251, 1325, 125, 53.7, 23.7, 22.6, '${ruta('08-01', PE1, 'captura-2.webp')}')
  ON CONFLICT (periodo_id, distrito_id) DO UPDATE SET visualizaciones = EXCLUDED.visualizaciones, captura_path = EXCLUDED.captura_path`, 'otra secretaría del distrito corrige la misma entrega (upsert)');
await root();
const fila = (await q(`SELECT visualizaciones, subido_por, captura_path FROM estadisticas_distrito WHERE periodo_id='${PE1}' AND distrito_id='08-01'`))[0];
ok(Number(fila.visualizaciones) === 50000 && fila.subido_por === SEC3 && fila.captura_path.endsWith('captura-2.webp'), 'quedó una sola fila con la corrección y a nombre de quien la corrigió');
await as(P.SEC1);
await rejects(`UPDATE estadisticas_distrito SET distrito_id='08-02' WHERE periodo_id='${PE1}' AND distrito_id='08-01'`, 'row-level security|cambiar', 'no se puede mover una entrega a otro distrito');
await root();
await as(P.SEC2);
await db.exec(`UPDATE estadisticas_distrito SET visualizaciones = 1 WHERE distrito_id='08-01'`);
await root();
ok(Number((await q(`SELECT visualizaciones FROM estadisticas_distrito WHERE periodo_id='${PE1}' AND distrito_id='08-01'`))[0].visualizaciones) === 50000, 'la secretaría de otro distrito no modifica la entrega ajena (0 filas afectadas)');
await as(P.SEC1);
await db.exec(`DELETE FROM estadisticas_distrito WHERE distrito_id='08-01'`);
await root();
ok(await cuenta() === 3, 'una secretaría no borra entregas (solo el admin)');

console.log('\n[gestión archivada = solo lectura]');
await as(P.SEC1);
await rejects(ins('08-01', ARCH, { captura_path: ruta('08-01', ARCH) }), 'row-level security', 'no se sube nada en una gestión archivada');
await as(P.ADMIN);
await rejects(ins('08-03', ARCH, { captura_path: ruta('08-03', ARCH) }), 'row-level security', 'ni siquiera el admin');
await db.exec(`DELETE FROM estadisticas_distrito WHERE distrito_id='08-02' AND periodo_id='${PE1}'`);
await root();
ok(await cuenta() === 2, 'el admin sí borra una entrega de una gestión abierta');

console.log('\n[el bucket de capturas]');
const b = (await q(`SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id='capturas-distrito'`))[0];
ok(b && b.public === false, 'el bucket existe y es PRIVADO');
ok(Number(b.file_size_limit) === 614400, 'tope de 600 KB en el propio bucket');
ok(JSON.stringify([...b.allowed_mime_types].sort()) === JSON.stringify(['image/jpeg', 'image/webp']), 'solo WebP y JPEG');
const obj = (nombre, bucket = 'capturas-distrito') => `INSERT INTO storage.objects(bucket_id, name) VALUES ('${bucket}', '${nombre}')`;
await as(P.SEC1);
await allowed(obj(ruta('08-01', PE1, 'a.webp')), 'la secretaría sube a la carpeta de su distrito y período');
await rejects(obj(ruta('08-02', PE1, 'b.webp')), 'row-level security', 'no sube a la carpeta de otro distrito');
await rejects(obj(ruta('08-01', ARCH, 'c.webp')), 'row-level security', 'no sube a una gestión archivada');
await rejects(obj('08-01/no-es-uuid/d.webp'), 'row-level security', 'una carpeta de período que no es uuid se rechaza sin error de conversión');
await rejects(obj(ruta('08-01', PE1, 'e.webp'), 'avatars'), 'row-level security', 'no escribe en otros buckets con estas reglas');
await as(P.M1);
await rejects(obj(ruta('08-01', PE1, 'f.webp')), 'row-level security', 'un miembro no sube capturas');
await as(P.ADMIN);
await allowed(obj(ruta('08-03', PE1, 'g.webp')), 'el admin sube en cualquier distrito');
await root();
const ven = async uid => { await as(uid); const r = (await q(`SELECT count(*)::int n FROM storage.objects WHERE bucket_id='capturas-distrito'`))[0].n; await root(); return r; };
ok(await ven(P.SEC1) === 1, 'la secretaría ve las capturas de SU distrito (1)');
ok(await ven(P.SEC2) === 0, 'la de otro distrito no ve las ajenas');
ok(await ven(P.M1) === 0, 'un miembro no ve capturas');
ok(await ven(P.ADMIN) === 2, 'el admin ve todas');
await as(P.SEC2);
await db.exec(`DELETE FROM storage.objects WHERE name LIKE '08-01/%'`);
await root();
ok((await q(`SELECT count(*)::int n FROM storage.objects WHERE name LIKE '08-01/%'`))[0].n === 1, 'otra secretaría no borra capturas ajenas');
await as(P.SEC1);
await db.exec(`DELETE FROM storage.objects WHERE name LIKE '08-01/%'`);
await root();
ok((await q(`SELECT count(*)::int n FROM storage.objects WHERE name LIKE '08-01/%'`))[0].n === 0, 'la secretaría reemplaza su captura (borra la anterior)');

fin();
