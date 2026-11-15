// Pruebas de 0070: el registro guarda una SOLICITUD (distrito o invitado externo, hasta 2 roles) y al aprobar se aplica a lo vacío; nunca da permisos ni secretaría.
import fs from 'node:fs';
import { crear, montar, CADENA_BASE, sql } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, allowed, fin } = t;
const X = await montar(t, CADENA_BASE);
const { P } = X;

// Lo que en producción ya existe y 0070 toca: auth.users, distritos, el disparador de privilegios de 0001 y las políticas de profiles.
await db.exec(`
  CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT, raw_user_meta_data JSONB);
  CREATE TABLE public.distritos (id TEXT PRIMARY KEY, nombre TEXT, activo BOOLEAN DEFAULT true);
  INSERT INTO public.distritos VALUES ('08-01', 'Distrito 08-01', true), ('08-02', 'Distrito 08-02', true), ('INV', 'Invitado externo', true), ('EXT', 'Antiguo', false);
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS aprobado BOOLEAN DEFAULT true;
`);
const bloq = fs.readFileSync(new URL('../../supabase/migrations/0001_seguridad_profiles.sql', import.meta.url), 'utf8');
const f1 = bloq.indexOf('CREATE OR REPLACE FUNCTION public.profiles_bloquear_campos_privilegiados()');
const f2 = bloq.indexOf('-- ── 4. Policies limpias');
await db.exec(bloq.slice(f1, f2));
const roles = (await q(`SELECT id FROM roles ORDER BY id LIMIT 3`)).map(r => r.id);
const [R1, R2, R3] = roles;

const m = sql('0070_registro_solicitud.sql');
await db.exec(m);
ok(true, '0070 se aplica sin errores');
await db.exec(m);
ok(true, 'reaplicar 0070 es idempotente');

const alta = async (id, meta) => {
  await db.exec(`INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ('${id}', '${id.slice(0, 8)}@x.cl', '${JSON.stringify(meta).replace(/'/g, "''")}'::jsonb)`);
  return (await q(`SELECT * FROM profiles WHERE id='${id}'`))[0];
};
const U = n => `00000000-0000-0000-0000-0000000007${String(n).padStart(2, '0')}`;

console.log('\n[el registro guarda la solicitud, no un permiso]');
let p = await alta(U(1), { nombre: 'Ana Nueva', distrito: '08-01', tipo: 'secretario', rol_id: String(R1), rol2_id: String(R2) });   // pide «secretario» en el metadata: se ignora
ok(p.tipo_miembro === 'miembro' && p.es_admin === false && p.aprobado === false && p.distrito === null && p.rol_id === null, 'el perfil nace como siempre: miembro, sin distrito, sin rol, sin aprobar');
ok(p.solicitud_distrito === '08-01' && Number(p.solicitud_rol_id) === R1 && Number(p.solicitud_rol2_id) === R2, 'la solicitud queda guardada (distrito y dos roles)');
p = await alta(U(2), { nombre: 'Mala', distrito: 'NO-EXISTE', tipo: 'admin', rol_id: '99999', rol2_id: 'abc', es_admin: true });
ok(p.solicitud_distrito === null && p.solicitud_rol_id === null && p.solicitud_rol2_id === null && p.es_admin === false, 'datos inválidos no entran: distrito inexistente, roles que no existen o no son números (y es_admin del metadata se ignora)');
p = await alta(U(3), { nombre: 'Ext', distrito: 'EXT', rol_id: String(R1), rol2_id: String(R1) });
ok(p.solicitud_distrito === null && Number(p.solicitud_rol_id) === R1 && p.solicitud_rol2_id === null, 'un distrito inactivo se ignora y el segundo rol igual al primero se descarta');
p = await alta(U(5), { nombre: 'Invitada', distrito: 'INV', rol_id: String(R1) });
ok(p.solicitud_distrito === 'INV', 'el «invitado externo» (un distrito más de la lista) se puede pedir');
p = await alta(U(4), { nombre: 'Solo segundo', rol2_id: String(R2) });
ok(p.solicitud_rol2_id === null, 'un segundo rol sin rol principal no se guarda');

console.log('\n[opciones del formulario (pública)]');
await as(null, 'anon');
const o = (await q(`SELECT public.registro_opciones() o`))[0].o;
ok(o.distritos.length === 3 && o.distritos.some(d => d.nombre === 'Invitado externo') && o.distritos.every(d => d.id !== 'EXT'), 'distritos activos, con el invitado externo (sin el inactivo)');
ok(o.roles.length >= 3 && o.roles.every(r => r.id && r.nombre), 'lista de roles');
await root();

console.log('\n[quien se registra no puede cambiar nada de eso]');
await db.exec(`INSERT INTO profiles(id, nombre, email, aprobado) VALUES ('${P.M1}', 'M1', 'm1@x.cl', true) ON CONFLICT (id) DO NOTHING`);
await as(U(1));
await rejects(`UPDATE profiles SET solicitud_distrito='08-02' WHERE id='${U(1)}'`, 'no se modifica|42501|permission', 'no puede reescribir su solicitud');
await rejects(`UPDATE profiles SET aprobado=true WHERE id='${U(1)}'`, 'No puedes modificar', 'no puede aprobarse a sí misma');
await rejects(`UPDATE profiles SET distrito='08-01' WHERE id='${U(1)}'`, 'No puedes modificar', 'no puede darse distrito');
await root();

console.log('\n[al aprobar se aplica la solicitud]');
await as(P.ADMIN);
await allowed(`UPDATE profiles SET aprobado=true WHERE id='${U(1)}'`, 'la administración aprueba');
await root();
p = (await q(`SELECT * FROM profiles WHERE id='${U(1)}'`))[0];
ok(p.distrito === '08-01' && Number(p.rol_id) === R1 && p.aprobado === true, 'distrito y rol principal quedan aplicados');
ok(p.tipo_miembro === 'miembro', 'SIEMPRE miembro: aunque haya pedido «secretario», esa asignación solo la hace la administración');
const rp = await q(`SELECT rol_id FROM persona_roles WHERE persona_id='${U(1)}'`);
ok(rp.length === 1 && Number(rp[0].rol_id) === R2, 'el segundo rol queda habilitado en persona_roles');

await as(P.ADMIN);
await db.exec(`UPDATE profiles SET distrito='08-02', rol_id=${R3} WHERE id='${U(3)}'`);
await db.exec(`UPDATE profiles SET aprobado=true WHERE id='${U(3)}'`);
await root();
p = (await q(`SELECT * FROM profiles WHERE id='${U(3)}'`))[0];
ok(p.distrito === '08-02' && Number(p.rol_id) === R3, 'lo que la administración ya fijó no se pisa con la solicitud');

await as(P.ADMIN);
await db.exec(`UPDATE profiles SET aprobado=true WHERE id='${U(2)}'`);
await root();
p = (await q(`SELECT * FROM profiles WHERE id='${U(2)}'`))[0];
ok(p.distrito === null && p.rol_id === null && p.tipo_miembro === 'miembro' && p.es_admin === false, 'una solicitud inválida/vacía no aplica nada al aprobar');

console.log('\n[paridad]');
const antes = (await q(`SELECT id, tipo_miembro, distrito, rol_id FROM profiles WHERE id = '${P.M1}'`))[0];
await as(P.ADMIN); await db.exec(`UPDATE profiles SET nombre = 'M1 editado' WHERE id='${P.M1}'`); await root();
const desp = (await q(`SELECT id, tipo_miembro, distrito, rol_id FROM profiles WHERE id = '${P.M1}'`))[0];
ok(JSON.stringify(antes) === JSON.stringify(desp), 'editar a una persona ya existente no cambia sus datos');
fin();
