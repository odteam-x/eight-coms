// Pruebas de 0050 (reporte general consolidado de todos los PE) contra Postgres real (PGlite), con RLS.
// Lo importante: (1) que SIEMPRE salga una fila por PE, también los vacíos; (2) que cada cifra coincida con la
// FUENTE DE VERDAD (seguimiento_global, resultados_periodo, resumen_tareas_periodo): no hay fórmula paralela;
// (3) que los permisos se apliquen igual que en la vista individual; (4) que ningún filtro amplíe lo visible y que
// no haya duplicados (una persona en varias relaciones no se cuenta dos veces).
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
const ADMIN = uid(90), SEC1 = uid(91), SEC2 = uid(92), M1 = uid(1), M2 = uid(2), M3 = uid(3), M4 = uid(4), M5 = uid(5), M6 = uid(6);
const J = o => JSON.stringify(o).replace(/'/g, "''");
const num = v => Number(v);

// ── Esquema base: stub + 0015 + 0016 + 0017 + 0018 + 0020 + 0021 + 0023 + 0024 + 0025 ──
await db.exec(fs.readFileSync(DIR + 'stub.sql', 'utf8'));
await db.exec(`
  ALTER TABLE public.profiles ADD COLUMN aprobado BOOLEAN DEFAULT true;
  ALTER TABLE public.periodos_evaluacion ADD COLUMN fecha_inicio DATE, ADD COLUMN fecha_fin_trabajo DATE, ADD COLUMN fecha_entrega DATE, ADD COLUMN fecha_jornada DATE;
  CREATE TABLE public.config (gestion_id BIGINT, clave TEXT, valor TEXT, PRIMARY KEY (gestion_id, clave));
  CREATE TABLE public.periodo_participantes (periodo_id UUID, user_id UUID, activo BOOLEAN DEFAULT true, PRIMARY KEY (periodo_id, user_id));
  CREATE TABLE public.trabajos_entregados (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id UUID, periodo_id UUID,
     titulo TEXT DEFAULT '', descripcion TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
  INSERT INTO gestiones(nombre, activa) VALUES ('2026-2027', true);
  INSERT INTO gestiones(nombre, activa, archivada) VALUES ('2025-2026', false, true);
  INSERT INTO gestiones(nombre, activa) VALUES ('2027-2028', false);
  INSERT INTO periodos_evaluacion(gestion_id,nombre) SELECT id,'LEG' FROM gestiones WHERE nombre='2026-2027';
`);
for (const f of ['0015_rubrica_v2.sql', '0015_seed_perfiles.PENDIENTE.sql', '0016_tareas.sql', '0017_tareas_puntos.sql', '0020_criterios_dinamicos.sql',
  '0023_puntuacion_por_peso.sql', '0018_actividades.sql', '0021_roles_preferencias.sql', '0024_actividades_alcance.sql', '0025_seguimiento_bienvenida.sql'])
  await db.exec(fs.readFileSync(R + f, 'utf8'));
await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
               GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;`);
const G = (await q(`SELECT id FROM gestiones WHERE nombre='2026-2027'`))[0].id;
const GA = (await q(`SELECT id FROM gestiones WHERE archivada`))[0].id;
const GV = (await q(`SELECT id FROM gestiones WHERE nombre='2027-2028'`))[0].id;   // gestión sin ningún período
const FOTO = (await q(`SELECT id FROM roles WHERE nombre='Fotografía'`))[0].id;
const REDA = (await q(`SELECT id FROM roles WHERE nombre='Redacción'`))[0].id;
await db.exec(`
  INSERT INTO profiles(id,nombre,es_admin) VALUES ('${ADMIN}','Admin',true);
  INSERT INTO profiles(id,nombre,tipo_miembro,distrito,rol_id) VALUES ('${SEC1}','Sec1','secretario','08-01',${REDA}),('${SEC2}','Sec2','secretario','08-02',${REDA});
  INSERT INTO profiles(id,nombre,distrito,rol_id) VALUES ('${M1}','M1','08-01',${FOTO}),('${M2}','M2','08-01',${FOTO}),('${M3}','M3','08-02',${FOTO}),('${M4}','M4','08-02',${REDA});
  INSERT INTO profiles(id,nombre,distrito,rol_id,aprobado) VALUES ('${M5}','M5 pendiente','08-01',${FOTO},false);
  INSERT INTO profiles(id,nombre) VALUES ('${M6}','M6 sin distrito ni rol');
  INSERT INTO periodos_evaluacion(gestion_id,nombre,modelo,activo,fecha_inicio,fecha_entrega) VALUES (${G},'PE1','v2',true,CURRENT_DATE - 10, CURRENT_DATE + 20);
  INSERT INTO periodos_evaluacion(gestion_id,nombre,modelo,fecha_inicio,fecha_entrega) VALUES (${G},'PE2','v2',CURRENT_DATE + 30, CURRENT_DATE + 60);
  INSERT INTO periodos_evaluacion(gestion_id,nombre,modelo) VALUES (${G},'PE3','v2'),(${GA},'ARCH','v2');
  UPDATE periodos_evaluacion SET created_at = now() + (CASE nombre WHEN 'LEG' THEN 0 WHEN 'PE1' THEN 1 WHEN 'PE2' THEN 2 WHEN 'PE3' THEN 3 ELSE 4 END || ' seconds')::interval;
  UPDATE periodos_evaluacion SET fecha_inicio = CURRENT_DATE - 90, fecha_entrega = CURRENT_DATE - 60 WHERE nombre = 'LEG';
`);
const per = async n => (await q(`SELECT id FROM periodos_evaluacion WHERE nombre='${n}'`))[0].id;
const LEG = await per('LEG'), PE1 = await per('PE1'), PE2 = await per('PE2'), PE3 = await per('PE3'), ARCH = await per('ARCH');

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

// Actividades y tareas del PE1
await db.exec(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio) VALUES (${G},'Jornada A','2026-11-02'),(${G},'Taller','2026-11-09')`);
const AJ = (await q(`SELECT id FROM actividades WHERE titulo='Jornada A'`))[0].id;
const AT = (await q(`SELECT id FROM actividades WHERE titulo='Taller'`))[0].id;
const ins = (a, titulo, lim, extra = '') => `INSERT INTO tareas(periodo_id,titulo,asignada_a,fecha_limite${extra ? ',actividad_id' : ''}) VALUES ('${PE1}','${titulo}','${a}',${lim}${extra ? ',' + extra : ''}) RETURNING id`;
const idDe = async s => (await q(s))[0].id;
const tA = await idDe(ins(M1, 'tA aprobada a tiempo', 'CURRENT_DATE + 5', AJ));
const tB = await idDe(ins(M1, 'tB vencida', 'CURRENT_DATE - 3'));
const tC = await idDe(ins(M3, 'tC abierta', 'CURRENT_DATE + 2'));
const tD = await idDe(ins(M2, 'tD bloqueada', 'CURRENT_DATE + 3', AT));
const tE = await idDe(ins(M3, 'tE tarde y devuelta', 'CURRENT_DATE - 1'));
const tG = await idDe(ins(M2, 'tG entregada sin plazo', 'NULL'));
await as(M1);
await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='listo' WHERE id=${tA}`);
const tF = await idDe(`INSERT INTO tareas(periodo_id,titulo,asignada_a) VALUES ('${PE1}','tF propia','${M1}') RETURNING id`);
await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='por iniciativa' WHERE id=${tF}`);
await as(M2);
await db.exec(`UPDATE tareas SET estado='bloqueada', bloqueo_motivo='Espera el guion' WHERE id=${tD}`);
await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='hecho' WHERE id=${tG}`);
await as(M3);
await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='tarde' WHERE id=${tE}`);
await as(SEC2);
await db.exec(`UPDATE tareas SET estado='devuelta', revision_nota='Falta el audio' WHERE id=${tE}`);
await as(ADMIN);
await db.exec(`UPDATE tareas SET estado='aprobada', puntos=8 WHERE id=${tA}`);

await root();
await db.exec(`INSERT INTO periodo_participantes(periodo_id,user_id,activo) VALUES ('${PE2}','${M4}',false)`);
await db.exec(`INSERT INTO periodo_participantes(periodo_id,user_id,activo)
               SELECT '${PE3}', id, false FROM profiles WHERE NOT es_admin`);
// Una persona en DOS relaciones de rol (persona_roles): no debe contarse dos veces.
await db.exec(`INSERT INTO persona_roles(persona_id,rol_id) VALUES ('${M1}',${FOTO}),('${M1}',${REDA})`);

await db.exec(fs.readFileSync(R + '0050_reporte_general_pe.sql', 'utf8'));
await db.exec(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;
               REVOKE EXECUTE ON FUNCTION public.reporte_general_pe(BIGINT, TEXT, BIGINT) FROM anon;`);
await db.exec(fs.readFileSync(R + '0050_reporte_general_pe.sql', 'utf8'));
console.log('— 0050 aplicada sin errores (dos veces: es idempotente)');

const rg = async (u, args = '') => { await as(u); return q(`SELECT * FROM reporte_general_pe(${args}) ORDER BY orden`); };
const pe = (rows, n) => rows.find(r => r.periodo_nombre === n);

console.log('\n[existencia de varios PE: sale una fila por cada uno, también los vacíos]');
let r = await rg(ADMIN);
ok(r.length === 4 && r.map(x => x.periodo_nombre).join() === 'LEG,PE1,PE2,PE3', `administración: ${r.length} PE de la gestión activa en orden de creación (${r.map(x => x.periodo_nombre)})`);
ok(new Set(r.map(x => x.periodo_id)).size === r.length, 'ningún PE aparece dos veces');
ok(!r.some(x => x.periodo_nombre === 'ARCH'), 'los PE de otra gestión no se mezclan');
ok(pe(r, 'PE3').personas === 7 && pe(r, 'PE3').participan === 0 && pe(r, 'PE3').no_participan === 7, 'PE3 (todas las personas marcadas inactivas) aparece: 7 personas, 0 participan');
ok(pe(r, 'PE3').eval_publicadas === 0 && pe(r, 'PE3').tareas_total === 0 && pe(r, 'PE3').n_resultados === 0, 'y sin datos: todo en 0, no desaparece ni inventa');
ok(r.every(x => x.vista === 'todo'), 'la administración recibe vista «todo»');
ok(new Set(r.map(x => String(x.generado_en))).size === 1, 'todas las filas comparten la misma hora de generación (una sola foto de los datos)');

console.log('\n[personas: sin duplicados ni pendientes de aprobación]');
ok(pe(r, 'PE1').personas === 7, 'PE1: 7 personas (SEC1, SEC2, M1, M2, M3, M4, M6)');
ok(!(await q(`SELECT 1 FROM seguimiento_global() WHERE nombre LIKE 'M5%'`)).length, 'M5 (acceso sin aprobar) no entra ni en la fuente');
ok(r.every(x => x.g_personas === 7), 'g_personas: 7 personas DISTINTAS en la gestión (no 7 × 4 períodos)');
ok(r[0].g_participan_alguno === 7 && r[0].g_con_publicada === 2, '7 participan en algún PE; 2 personas distintas con alguna evaluación publicada (M1 está en dos PE y cuenta una vez)');
ok(pe(r, 'PE1').personas === 7, 'M1 tiene dos filas en persona_roles y NO se cuenta dos veces');
ok(pe(r, 'PE2').participan === 6 && pe(r, 'PE2').no_participan === 1, 'PE2: M4 se marcó inactivo solo ahí');
const sumJson = (j, k) => j.reduce((s, x) => s + x[k], 0);
for (const p of r) ok(sumJson(p.por_distrito, 'personas') === p.personas && sumJson(p.por_rol, 'personas') === p.personas && sumJson(p.por_distrito, 'participan') === p.participan,
  `${p.periodo_nombre}: la distribución por distrito y por rol suma exactamente las personas del PE`);
ok(pe(r, 'PE1').por_distrito.find(d => d.distrito === '')?.personas === 1, 'M6 (sin distrito) sale agrupada como «» (la pantalla la nombra «Sin distrito»)');

console.log('\n[evaluaciones: coinciden con la fuente de verdad]');
const pe1 = pe(r, 'PE1');
ok(pe1.eval_publicadas === 2 && pe1.eval_no_publicadas === 1 && pe1.eval_sin_evaluar === 4, `PE1: 2 publicadas, 1 borrador (no publicada), 4 sin evaluar (${pe1.eval_publicadas}/${pe1.eval_no_publicadas}/${pe1.eval_sin_evaluar})`);
ok(pe1.eval_publicadas + pe1.eval_no_publicadas + pe1.eval_sin_evaluar === pe1.participan, 'publicadas + no publicadas + sin evaluar = participan (nadie queda fuera ni se cuenta dos veces)');
const fuente1 = (await q(`SELECT COUNT(*)::int n, SUM(individual) s, SUM(nucleo) sn, SUM(tecnico) st FROM resultados_periodo('${PE1}', false)`))[0];
ok(pe1.n_resultados === fuente1.n && num(pe1.suma_resultado) === num(fuente1.s), `suma y n de resultados = resultados_periodo() (n=${pe1.n_resultados}, suma=${pe1.suma_resultado}): ninguna fórmula paralela`);
ok(num(pe1.suma_nucleo) === num(fuente1.sn) && num(pe1.suma_tecnico) === num(fuente1.st), 'y la suma de núcleo y de técnico también');
ok(num(pe1.suma_resultado) / pe1.n_resultados > 0 && num(pe1.suma_resultado) / pe1.n_resultados < 100, 'el promedio (suma ÷ n) del PE1 es un número entre 0 y 100');
const leg = pe(r, 'LEG');
ok(leg.modelo === 'legacy' && leg.n_resultados === 1 && num(leg.suma_resultado) === 8, 'LEG (rúbrica clásica): un solo resultado publicado = 3 + 4 + bono 1 = 8; el borrador no entra');
ok(leg.eval_publicadas === 1 && leg.eval_no_publicadas === 1 && leg.n_nucleo === 0, 'LEG: 1 publicada, 1 borrador, y sin núcleo (la clásica no tiene)');
ok(pe(r, 'PE2').n_resultados === 0 && num(pe(r, 'PE2').suma_resultado) === 0, 'PE2 sin evaluaciones: n=0 (la pantalla debe mostrar «—», no 0)');

console.log('\n[tareas: coinciden con la vista individual del PE]');
ok(pe1.tareas_total === 7 && pe1.tareas_asignadas === 6 && pe1.tareas_propias === 1, `PE1: 7 tareas = 6 asignadas + 1 propia (${pe1.tareas_total}/${pe1.tareas_asignadas}/${pe1.tareas_propias})`);
ok(pe1.tareas_abiertas === 4 && pe1.tareas_en_revision === 2 && pe1.tareas_aprobadas === 1, `abiertas 4 (asignada, bloqueada, devuelta, vencida) + en revisión 2 + aprobada 1 (${pe1.tareas_abiertas}/${pe1.tareas_en_revision}/${pe1.tareas_aprobadas})`);
ok(pe1.tareas_abiertas + pe1.tareas_en_revision + pe1.tareas_aprobadas === pe1.tareas_total, 'abiertas + en revisión + aprobadas = total: cada tarea cae en un solo grupo');
ok(pe1.tareas_vencidas === 1 && pe1.tareas_devueltas === 1 && pe1.tareas_bloqueadas === 1, 'una vencida (la tardía ya se entregó: no es «vencida»), una devuelta, una bloqueada (no cuenta como vencida)');
ok(pe1.tareas_entregadas === 3 && pe1.con_plazo === 2 && pe1.a_tiempo === 1, 'entregadas 3 (de las asignadas), con plazo 2, a tiempo 1 (la tardía no)');
ok(pe1.puntos_suma === 8 && pe1.puntos_n === 1, 'puntos: 8 en 1 tarea puntuada');
await as(ADMIN);
const resumen = (await q(`SELECT SUM(asignadas)::int a, SUM(entregadas)::int e, SUM(con_plazo)::int cp, SUM(a_tiempo)::int at, SUM(vencidas_abiertas)::int v, SUM(bloqueadas)::int b, SUM(abiertas)::int ab FROM resumen_tareas_periodo('${PE1}')`))[0];
ok(resumen.a === pe1.tareas_asignadas && resumen.e === pe1.tareas_entregadas && resumen.cp === pe1.con_plazo && resumen.at === pe1.a_tiempo
  && resumen.v === pe1.tareas_vencidas && resumen.b === pe1.tareas_bloqueadas && resumen.ab === pe1.tareas_abiertas,
  'asignadas, entregadas, con plazo, a tiempo, vencidas, bloqueadas y abiertas = la suma de resumen_tareas_periodo() del PE (la vista individual)');
const seg = await q(`SELECT periodo_nombre, SUM(tareas_total)::int t, COUNT(*) FILTER (WHERE participa)::int p, COUNT(*) FILTER (WHERE estado_eval='publicado' AND participa)::int pub FROM seguimiento_global() GROUP BY 1`);
ok(r.every(x => { const s = seg.find(y => y.periodo_nombre === x.periodo_nombre); return s && s.t === x.tareas_total && s.p === x.participan && s.pub === x.eval_publicadas; }),
  'por cada PE: tareas, participantes y publicadas = las de seguimiento_global()');
ok(pe(r, 'LEG').tareas_aplican === false && pe(r, 'LEG').tareas_total === 0 && pe1.tareas_aplican === true, 'el PE clásico dice que las tareas NO aplican (distinto de «cero tareas»)');
ok(pe(r, 'PE2').tareas_aplican === true && pe(r, 'PE2').tareas_total === 0, 'un PE nuevo sin tareas SÍ las admite y tiene 0');
ok(pe1.actividades_con_tareas === 2 && pe1.tareas_en_actividades === 2 && pe1.tareas_en_actividades_aprobadas === 1, 'actividades: 2 con tareas en el PE1, 2 tareas vinculadas, 1 aprobada');
ok(pe(r, 'PE2').actividades_con_tareas === 0, 'PE2 no tiene actividades con tareas');

console.log('\n[estado del PE]');
ok(pe(r, 'PE1').estado_pe === 'activo' && pe(r, 'PE2').estado_pe === 'proximo' && pe(r, 'LEG').estado_pe === 'cerrado' && pe(r, 'PE3').estado_pe === 'sin_fechas',
  'activo / próximo (empieza en el futuro) / cerrado (su fecha final pasó) / sin fechas');

console.log('\n[permisos: igual que en la vista individual]');
r = await rg(SEC1);
ok(r.length === 4 && r.every(x => x.vista === 'distrito'), 'secretaría 1: ve los 4 PE, con vista «distrito»');
ok(pe(r, 'PE1').personas === 3 && pe(r, 'PE1').participan === 3, 'solo las 3 personas de su distrito (ella, M1, M2)');
ok(pe(r, 'PE1').tareas_total === 5 && pe(r, 'PE1').tareas_asignadas === 4 && pe(r, 'PE1').tareas_propias === 1, 'solo las tareas de M1 (3) y M2 (2), no las de M3 (otro distrito)');
ok(!r.some(x => x.g_personas !== 3), 'g_personas = 3: no hay fuga de personas de otros distritos');
const segSec = (await q(`SELECT COUNT(*)::int n FROM seguimiento_global() WHERE periodo_nombre='PE1'`))[0].n;
ok(segSec === 3, 'coincide con lo que seguimiento_global() entrega a esa secretaría');
ok(pe(r, 'PE1').eval_publicadas === 1 && pe(r, 'PE1').eval_no_publicadas === 1 && pe(r, 'PE1').n_resultados === 1, 'la secretaría ve a M1 publicada y a M2 «sin publicar»; el borrador no aporta puntaje');
await as(SEC1);
const sinPuntajeBorrador = (await q(`SELECT suma_resultado FROM reporte_general_pe() WHERE periodo_nombre='PE1'`))[0].suma_resultado;
ok(num(sinPuntajeBorrador) === 100, 'su suma de resultados es solo la de M1 (100): el borrador de M2 NO se filtra');
r = await rg(M1);
ok(r.length === 4 && r.every(x => x.vista === 'propio' && x.personas === 1), 'un miembro: ve cada PE pero solo se cuenta él (vista «propio»)');
ok(pe(r, 'PE1').tareas_total === 3 && pe(r, 'PE1').eval_publicadas === 1 && pe(r, 'LEG').eval_publicadas === 1, 'sus tareas (3) y sus evaluaciones publicadas, y nada de otras personas');
r = await rg(M4);
ok(pe(r, 'PE1').personas === 1 && pe(r, 'PE1').tareas_total === 0 && pe(r, 'PE1').eval_sin_evaluar === 1, 'otro miembro, sin tareas ni evaluación: sus propios 0 (no los de M1)');
ok(pe(r, 'PE2').participan === 0 && pe(r, 'PE2').no_participan === 1, 'y M4 aparece como «no participa» en PE2');
await as(null, 'authenticated');
await rejects(`SELECT * FROM reporte_general_pe()`, 'sesion', 'sin sesión se rechaza');
await as(null, 'anon');
await rejects(`SELECT * FROM reporte_general_pe()`, 'permission', 'anon no puede llamarla');

console.log('\n[filtros: se recalculan en la base y nunca amplían lo visible]');
r = await rg(ADMIN, `NULL, '08-01'`);
ok(r.length === 4 && pe(r, 'PE1').personas === 3 && pe(r, 'PE1').tareas_total === 5, `distrito 08-01 (administración): las mismas 3 personas y SUS 5 tareas (${pe(r, 'PE1').tareas_total})`);
ok(r.every(x => x.g_personas === 3), 'las cifras de la gestión también se recalculan con el filtro');
r = await rg(ADMIN, `NULL, '08-02'`);
ok(pe(r, 'PE1').personas === 3 && pe(r, 'PE1').tareas_total === 2 && pe(r, 'PE1').eval_publicadas === 1, 'distrito 08-02: Sec2, M3, M4 → 2 tareas de M3, 1 publicada');
const t0801 = (await rg(ADMIN, `NULL, '08-01'`)), t0802 = r;
ok(pe(t0801, 'PE1').tareas_total + pe(t0802, 'PE1').tareas_total === 7 && pe(t0801, 'PE1').personas + pe(t0802, 'PE1').personas + 1 === 7,
  'los dos distritos + la persona sin distrito = el total sin filtro (7 tareas; 7 personas)');
r = await rg(ADMIN, `NULL, ''`);
ok(pe(r, 'PE1').personas === 1 && pe(r, 'PE1').tareas_total === 0, `'' = personas sin distrito: solo M6`);
r = await rg(ADMIN, `NULL, 'no-existe'`);
ok(r.length === 4 && r.every(x => x.personas === 0 && x.tareas_total === 0 && x.participan === 0), 'un distrito sin nadie: los 4 PE siguen saliendo, con todo en 0 (no desaparecen)');
r = await rg(ADMIN, `NULL, NULL, ${FOTO}`);
ok(pe(r, 'PE1').personas === 3 && pe(r, 'PE1').eval_publicadas === 2, 'rol Fotografía: M1, M2, M3 (M5 está sin aprobar); 2 publicadas');
r = await rg(ADMIN, `NULL, '08-01', ${FOTO}`);
ok(pe(r, 'PE1').personas === 2 && pe(r, 'PE1').tareas_total === 5, 'distrito + rol se combinan: M1 y M2');
r = await rg(SEC1, `NULL, '08-02'`);
ok(r.every(x => x.personas === 0 && x.tareas_total === 0), 'una secretaría que pide OTRO distrito no ve nada: el filtro no amplía lo que ya puede ver');
r = await rg(M1, `NULL, NULL, ${REDA}`);
ok(r.every(x => x.personas === 0), 'un miembro filtrando otro rol: nada (ni siquiera a sí mismo)');

console.log('\n[otras gestiones]');
r = await rg(ADMIN, `${GA}`);
ok(r.length === 1 && r[0].periodo_nombre === 'ARCH' && r[0].personas === 7, 'se puede pedir una gestión archivada: sus PE');
r = await rg(ADMIN, `${GV}`);
ok(r.length === 0, 'una gestión sin ningún PE devuelve cero filas (la pantalla dice «no hay PE»)');
r = await rg(M1, `${GA}`);
ok(r.length === 1 && r[0].personas === 1, 'y un miembro sigue viendo solo lo suyo ahí también');

console.log('\n[solo lectura]');
await as(ADMIN);
const antes = (await q(`SELECT (SELECT count(*) FROM tareas)::int t, (SELECT count(*) FROM evaluaciones)::int e, (SELECT count(*) FROM periodos_evaluacion)::int p`))[0];
await db.exec(`SELECT * FROM reporte_general_pe(); SELECT * FROM reporte_general_pe(NULL,'08-01',${FOTO});`);
const despues = (await q(`SELECT (SELECT count(*) FROM tareas)::int t, (SELECT count(*) FROM evaluaciones)::int e, (SELECT count(*) FROM periodos_evaluacion)::int p`))[0];
ok(JSON.stringify(antes) === JSON.stringify(despues), 'consultar el reporte no cambia ninguna tabla');
ok((await q(`SELECT provolatile FROM pg_proc WHERE proname='reporte_general_pe'`))[0].provolatile === 's', 'la función está marcada STABLE (solo lee)');

console.log('\n[el consolidado del front, sobre las filas REALES de la base]');
const vm = (await import('node:vm')).default;
const ctxR = { escHtml: x => String(x ?? ''), console, document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] }, window: {},
  renderIconos() {}, renderCargando() {}, renderError() {}, showToast() {}, ReporteEquipo: { descargar() {}, imprimir() {} } };
vm.createContext(ctxR);
vm.runInContext(fs.readFileSync(DIR + '../../core/reporte-general.js', 'utf8') + ';globalThis.__R = ReporteGeneral;', ctxR);
const RG = ctxR.__R;
const plano = rows => JSON.parse(JSON.stringify(rows));   // fuera de PGlite: objetos simples
r = plano(await rg(ADMIN));
let c = RG.consolidar(r);
await as(ADMIN);
const verdad = (await q(`SELECT (SELECT count(*) FROM tareas)::int tareas,
    (SELECT count(*) FROM tareas WHERE estado='aprobada')::int aprobadas,
    (SELECT SUM(vencidas_abiertas) FROM resumen_tareas_periodo('${PE1}'))::int vencidas,
    (SELECT count(*) FROM seguimiento_global() WHERE participa AND estado_eval='publicado')::int publicadas,
    (SELECT count(*) FROM seguimiento_global() WHERE participa)::int participaciones,
    (SELECT SUM(individual) FROM resultados_periodo('${PE1}', false)) suma_v2,
    (SELECT count(*) FROM resultados_periodo('${PE1}', false))::int n_v2`))[0];
ok(c.tareas.total === verdad.tareas && c.tareas.aprobadas === verdad.aprobadas && c.tareas.vencidas === verdad.vencidas, `tareas totales/aprobadas/vencidas del consolidado = las de la base (${c.tareas.total}/${c.tareas.aprobadas}/${c.tareas.vencidas})`);
ok(c.publicadas === verdad.publicadas && c.participaciones === verdad.participaciones, `evaluaciones publicadas ${c.publicadas} de ${c.participaciones} participaciones = seguimiento_global()`);
ok(c.v2.n === verdad.n_v2 && Math.abs(c.v2.suma - num(verdad.suma_v2)) < 1e-9 && Math.abs(c.v2.promedio - num(verdad.suma_v2) / verdad.n_v2) < 1e-9, 'el promedio ponderado de la rúbrica por roles = el de resultados_periodo()');
ok(c.clasico.n === 1 && c.clasico.promedio === 8 && c.peClasicos === 1, 'la clásica va aparte: 1 resultado = 8');
ok(c.personas === 7 && c.participanAlguno === 7 && c.pe === 4 && c.peSinDatos === 2, 'personas distintas 7 (no 7×4); 4 PE, 2 sin datos (PE2 y PE3)');
// La suma de las partes = el todo: lo que dice cada PE, sumado, es lo que dice el total.
ok(r.reduce((x, p) => x + p.tareas_total, 0) === c.tareas.total && r.reduce((x, p) => x + p.eval_publicadas, 0) === c.publicadas, 'Σ de las filas de cada PE = el total global (ninguna tarea ni evaluación se cuenta dos veces ni se pierde)');
// Con filtros: el total es la suma de los dos distritos y la persona sin distrito.
const d1 = RG.consolidar(plano(await rg(ADMIN, `NULL, '08-01'`))), d2 = RG.consolidar(plano(await rg(ADMIN, `NULL, '08-02'`))), d0 = RG.consolidar(plano(await rg(ADMIN, `NULL, ''`)));
ok(d1.tareas.total + d2.tareas.total + d0.tareas.total === c.tareas.total && d1.publicadas + d2.publicadas + d0.publicadas === c.publicadas, 'con filtro de distrito, la suma de los tres cortes (08-01, 08-02, sin distrito) = el total sin filtro');
ok(d1.personas + d2.personas + d0.personas === c.personas, 'y las personas también cuadran (sin repetir a nadie)');
// Secretaría: lo que baja en CSV es lo que ve.
r = plano(await rg(SEC1));
const csvSec = RG.csvTexto(r, {});
ok(!/M3|08-02/.test(csvSec) && RG.consolidar(r).personas === 3, 'el CSV de la secretaría 1 sale del mismo conjunto que su pantalla: solo su distrito (3 personas)');
r = plano(await rg(M1));
ok(RG.consolidar(r).personas === 1 && RG.consolidar(r).tareas.total === 3, 'y un miembro exporta solo lo suyo');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
