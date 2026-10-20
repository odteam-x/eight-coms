// Pruebas de 0052 (gafetes con QR verificable). Postgres real (PGlite) con RLS y permisos de función.
import { crear, montar, sql } from './base-eq.mjs';

const t = crear();
const { db, q, ok, as, root, rejects, fin } = t;
const ids = await montar(t, ['0015_rubrica_v2.sql', '0015_seed_perfiles.PENDIENTE.sql']);
const { P, PE1, PE2 } = ids;
await db.exec(`CREATE OR REPLACE FUNCTION public.gen_random_uuid() RETURNS uuid LANGUAGE sql AS $$ SELECT md5(random()::text || clock_timestamp()::text)::uuid $$`).catch(() => {});
await db.exec(`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT, ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()`); // el stub de pruebas no las trae; en producción ya existen
const m = sql('0052_gafetes.sql');
await db.exec(m);
await db.exec(m);
console.log('— 0052 aplicada sin errores (dos veces: es idempotente)');

const un = async (uid, role, s) => { await as(uid, role); try { return (await q(s))[0]; } catch (e) { return { error: e.message }; } finally { await root(); } };
const val = r => Object.values(r)[0];

console.log('\n[obtener]');
const tok = val(await un(P.M1, 'authenticated', `SELECT obtener_gafete()`));
ok(/^[0-9a-f]{24}$/.test(tok), 'cada persona obtiene su token de 24 hex (96 bits): ' + tok);
ok(val(await un(P.M1, 'authenticated', `SELECT obtener_gafete()`)) === tok, 'pedirlo otra vez devuelve el mismo token');
ok(/Sin permiso/.test((await un(P.M2, 'authenticated', `SELECT obtener_gafete('${P.M1}')`)).error || ''), 'un miembro no pide el gafete de otro');
ok(/Sin permiso/.test((await un(P.SEC1, 'authenticated', `SELECT obtener_gafete('${P.M1}')`)).error || ''), 'ni una secretaría');
ok(/^[0-9a-f]{24}$/.test(val(await un(P.ADMIN, 'authenticated', `SELECT obtener_gafete('${P.M2}')`))), 'la administración sí lo pide para cualquiera');
ok(/iniciar sesión/.test((await un(null, 'anon', `SELECT obtener_gafete()`)).error || '') || /permission denied/.test((await un(null, 'anon', `SELECT obtener_gafete()`)).error || ''), 'sin sesión no se puede');

console.log('\n[tabla cerrada]');
ok(/permission denied/.test((await un(P.M1, 'authenticated', `SELECT * FROM gafetes`)).error || ''), 'nadie lee la tabla directamente (authenticated)');
ok(/permission denied/.test((await un(null, 'anon', `SELECT * FROM gafetes`)).error || ''), 'ni anon');
await rejects(`SET ROLE authenticated; INSERT INTO gafetes(perfil_id, token) VALUES ('${P.M3}', 'aaaaaaaaaaaaaaaaaaaaaaaa')`, 'permission', 'nadie inserta directo');
await root();

console.log('\n[verificar: público]');
await db.exec(`ALTER TABLE evaluaciones DISABLE TRIGGER USER`); // aquí solo importa el estado; las reglas de publicación ya las prueban otras suites
await db.exec(`INSERT INTO evaluaciones(periodo_id, evaluado_id, puntajes, estado) VALUES ('${PE1}','${P.M1}','{}','publicado'),('${PE2}','${P.M1}','{}','borrador')`);
await db.exec(`ALTER TABLE evaluaciones ENABLE TRIGGER USER`);
const vr = await un(null, 'anon', `SELECT verificar_gafete('${tok}') AS r`); const v = vr.r;
ok(v && v.valido === true && v.nombre === 'M1', 'anon verifica un token válido y ve el nombre');
ok(v.distrito === '08-01' && v.cargo === 'miembro', 'distrito y cargo');
ok(!('email' in v) && !('id' in v) && !('puntajes' in v) && !('perfil_id' in v), 'NO expone correo, id ni notas');
ok(v.pe_evaluados === 1, 'cuenta solo PE con evaluación publicada (el borrador no cuenta): ' + v.pe_evaluados);
ok((await un(null, 'anon', `SELECT verificar_gafete('${'0'.repeat(24)}') AS r`)).r.valido === false, 'token inexistente → no válido');
ok((await un(null, 'anon', `SELECT verificar_gafete('x'' OR 1=1 --') AS r`)).r.valido === false, 'token malformado → no válido');
ok((await un(null, 'anon', `SELECT verificar_gafete(NULL) AS r`)).r.valido === false, 'token nulo → no válido');
const rs = (await un(null, 'anon', `SELECT verificar_gafete('${'0'.repeat(24)}') AS r`)).r;
ok(Object.keys(rs).length === 1, 'la respuesta de «no válido» no filtra nada más');

console.log('\n[cuenta sin aprobar]');
await db.exec(`UPDATE profiles SET aprobado = false WHERE id = '${P.M1}'`);
ok((await un(null, 'anon', `SELECT verificar_gafete('${tok}') AS r`)).r.valido === false, 'sin aprobar → no válido');
await db.exec(`UPDATE profiles SET aprobado = true WHERE id = '${P.M1}'`);

console.log('\n[regenerar / revocar]');
const tok2 = val(await un(P.M1, 'authenticated', `SELECT regenerar_gafete()`));
ok(tok2 !== tok && /^[0-9a-f]{24}$/.test(tok2), 'regenerar da un token nuevo');
ok((await un(null, 'anon', `SELECT verificar_gafete('${tok}') AS r`)).r.valido === false, 'el QR viejo deja de valer');
ok((await un(null, 'anon', `SELECT verificar_gafete('${tok2}') AS r`)).r.valido === true, 'el nuevo vale');
ok(/Sin permiso/.test((await un(P.M2, 'authenticated', `SELECT regenerar_gafete('${P.M1}')`)).error || ''), 'otro miembro no regenera el mío');
ok(/Solo la administración/.test((await un(P.M1, 'authenticated', `SELECT revocar_gafete('${P.M1}')`)).error || ''), 'un miembro no revoca');
await un(P.ADMIN, 'authenticated', `SELECT revocar_gafete('${P.M1}')`);
ok((await un(null, 'anon', `SELECT verificar_gafete('${tok2}') AS r`)).r.valido === false, 'revocado → no válido');
ok(/revocado/.test((await un(P.M1, 'authenticated', `SELECT obtener_gafete()`)).error || ''), 'la persona no puede obtener uno nuevo si está revocado');
ok(/revocado/.test((await un(P.M1, 'authenticated', `SELECT regenerar_gafete()`)).error || ''), 'ni regenerarlo para saltarse la revocación');
const tok3 = val(await un(P.ADMIN, 'authenticated', `SELECT regenerar_gafete('${P.M1}')`));
ok((await un(null, 'anon', `SELECT verificar_gafete('${tok3}') AS r`)).r.valido === true, 'la administración lo reactiva con uno nuevo');

console.log('\n[borrar la persona borra el gafete]');
await db.exec(`DELETE FROM profiles WHERE id = '${P.M2}'`).catch(() => {});
ok((await q(`SELECT count(*)::int n FROM gafetes WHERE perfil_id = '${P.M2}'`))[0].n === 0, 'ON DELETE CASCADE');
fin();
