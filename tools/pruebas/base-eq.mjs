// Base común de las pruebas de equipos / tareas colectivas / calificaciones (0031–0036).
// Monta un Postgres real (PGlite) con el esquema mínimo + las migraciones previas, y expone los ayudantes de siempre.
// Las pruebas corren como `authenticated`/`anon` (SET ROLE), así que la RLS cuenta.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DIR = fileURLToPath(new URL('.', import.meta.url));
export const R = DIR + '../../supabase/migrations/';

export function crear() {
  const db = new PGlite();
  const c = { pass: 0, fail: 0 };
  const ok = (cond, m) => { cond ? c.pass++ : (c.fail++, console.log('  ✗ FALLA:', m)); if (cond) console.log('  ✓', m); };
  const q = async s => (await db.query(s)).rows;
  const as = async (uid, role = 'authenticated') => {
    await db.exec('RESET ROLE');
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid ?? ''}',false)`);
    await db.exec(`SET ROLE ${role}`);
  };
  const root = async () => { await db.exec('RESET ROLE'); await db.exec(`SELECT set_config('request.jwt.claim.sub','',false)`); };
  async function rejects(sql, patron, msg) {
    try { await db.exec(sql); ok(false, msg + ' (NO fue rechazado)'); }
    catch (e) { ok(!patron || new RegExp(patron, 'i').test(e.message), msg + ' → ' + String(e.message).slice(0, 110)); }
  }
  async function allowed(sql, msg) {
    try { await db.exec(sql); ok(true, msg); } catch (e) { ok(false, msg + ' → ' + String(e.message).slice(0, 200)); }
  }
  const fin = () => { console.log(`\n${c.pass} correctas, ${c.fail} fallidas`); process.exit(c.fail ? 1 : 0); };
  return { db, c, ok, q, as, root, rejects, allowed, fin };
}

export const uid = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
export const J = o => JSON.stringify(o).replace(/'/g, "''");
export const sql = f => fs.readFileSync(R + f, 'utf8');

/**
 * Esquema base + migraciones hasta `hasta` (lista de archivos de supabase/migrations, en orden).
 * Crea la gestión activa, una archivada, y personas: ADMIN, SEC1 (08-01), SEC2 (08-02), M1..M4.
 */
export async function montar(t, migraciones) {
  const { db, q } = t;
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
  for (const f of migraciones) await db.exec(sql(f));
  await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
                 GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;`);
  const ids = {
    G:  (await q(`SELECT id FROM gestiones WHERE activa`))[0].id,
    GA: (await q(`SELECT id FROM gestiones WHERE archivada`))[0].id,
    FOTO: (await q(`SELECT id FROM roles WHERE nombre='Fotografía'`))[0].id,
    REDA: (await q(`SELECT id FROM roles WHERE nombre='Redacción'`))[0].id,
  };
  const P = { ADMIN: uid(90), SEC1: uid(91), SEC2: uid(92), M1: uid(1), M2: uid(2), M3: uid(3), M4: uid(4), M5: uid(5) };
  await db.exec(`
    INSERT INTO profiles(id,nombre,es_admin) VALUES ('${P.ADMIN}','Admin',true);
    INSERT INTO profiles(id,nombre,tipo_miembro,distrito,rol_id) VALUES ('${P.SEC1}','Sec1','secretario','08-01',${ids.REDA}),('${P.SEC2}','Sec2','secretario','08-02',${ids.REDA});
    INSERT INTO profiles(id,nombre,distrito,rol_id) VALUES ('${P.M1}','M1','08-01',${ids.FOTO}),('${P.M2}','M2','08-01',${ids.FOTO}),
      ('${P.M3}','M3','08-02',${ids.FOTO}),('${P.M4}','M4','08-02',${ids.REDA}),('${P.M5}','M5','08-01',${ids.REDA});
    INSERT INTO periodos_evaluacion(gestion_id,nombre,modelo) VALUES (${ids.G},'PE1','v2'),(${ids.G},'PE2','v2'),(${ids.GA},'ARCH','v2');
  `);
  const per = async n => (await q(`SELECT id FROM periodos_evaluacion WHERE nombre='${n}'`))[0].id;
  return { ...ids, P, per, LEG: await per('LEG'), PE1: await per('PE1'), PE2: await per('PE2'), ARCH: await per('ARCH') };
}

// Cadena de migraciones que necesitan todas las pruebas nuevas, en el orden de aplicación en producción.
export const CADENA_BASE = [
  '0015_rubrica_v2.sql', '0015_seed_perfiles.PENDIENTE.sql', '0016_tareas.sql', '0017_tareas_puntos.sql',
  '0020_criterios_dinamicos.sql', '0023_puntuacion_por_peso.sql', '0018_actividades.sql',
  '0021_roles_preferencias.sql', '0024_actividades_alcance.sql', '0025_seguimiento_bienvenida.sql',
];
