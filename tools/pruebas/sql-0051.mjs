// Pruebas de 0051 (reporte general con equipos, tareas colectivas y nota de tareas integrada) contra Postgres real
// (PGlite), con RLS. Se aplica sobre la cadena completa 0015…0036 + 0050. Lo importante:
//   · una tarea colectiva cuenta UNA vez (no una por integrante) y una persona en dos equipos cuenta una vez;
//   · las anuladas quedan fuera de los totales y se informan aparte;
//   · el resultado sigue saliendo de resultados_periodo() (que ya integra la nota de tareas);
//   · los permisos de equipo_visible() se respetan y un filtro nunca amplía lo visible.
import { crear, montar, CADENA_BASE, sql, J } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, allowed, fin } = t;
const CADENA = [...CADENA_BASE, '0031_equipos.sql', '0032_tareas_equipo.sql', '0033_calificaciones.sql', '0034_calificacion_tareas.sql',
  '0035_resultados_integrados.sql', '0036_equipos_vistas.sql', '0050_reporte_general_pe.sql'];
const X = await montar(t, CADENA);
const { P, PE1, PE2, LEG, G, FOTO } = X;
await db.exec(`ALTER TABLE public.periodos_evaluacion ADD COLUMN IF NOT EXISTS fecha_inicio DATE, ADD COLUMN IF NOT EXISTS fecha_fin_trabajo DATE,
  ADD COLUMN IF NOT EXISTS fecha_entrega DATE, ADD COLUMN IF NOT EXISTS fecha_jornada DATE;
  UPDATE periodos_evaluacion SET created_at = now() + (CASE nombre WHEN 'LEG' THEN 0 WHEN 'PE1' THEN 1 WHEN 'PE2' THEN 2 ELSE 3 END || ' seconds')::interval;`);
await db.exec(sql('0051_reporte_general_equipos.sql'));
await db.exec(sql('0051_reporte_general_equipos.sql'));
console.log('— 0051 aplicada sin errores (dos veces: es idempotente)');

// ── Evaluaciones (M1 y M2 publicadas, M3 borrador) ──
const perfil = (await q(`SELECT public.perfil_vigente(${FOTO}, '${PE1}') id`))[0].id;
const tec = await q(`SELECT criterio_key k, peso FROM perfil_criterios WHERE perfil_id=${perfil}`);
const nuc = (await q(`SELECT key FROM criterios_v2 WHERE gestion_id=${G} AND tipo='nucleo' AND tipo_campo='escala' AND activo`)).map(x => x.key);
const todo = full => ({ ...Object.fromEntries(nuc.map(k => [k, full ? 10 : 5])), ...Object.fromEntries(tec.map(x => [x.k, full ? x.peso : Math.floor(x.peso / 2)])) });
await as(P.ADMIN);
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${P.M1}','${J(todo(true))}','publicado')`);
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${P.M2}','${J(todo(false))}','publicado')`);
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${P.M3}','${J(todo(false))}','borrador')`);

// ── Equipos: M1 está en DOS equipos ──
const equipo = async (nombre, miembros, dist = null) => {
  await as(P.ADMIN);
  const id = (await q(`SELECT public.equipo_guardar(NULL, '${PE1}', '${nombre}', '', NULL, ${dist ? `'${dist}'` : 'NULL'}) id`))[0].id;
  await db.exec(`SELECT public.equipo_agregar_miembros(${id}, ARRAY[${miembros.map(m => `'${m}'`).join(',')}]::uuid[], true, 'Prueba de excepción de ámbito')`);
  return id;
};
const E1 = await equipo('Transversal', [P.M1, P.M2, P.M3]);
const E2 = await equipo('Distrito 08-01', [P.M1, P.M2, P.M5], '08-01');

// ── Tareas colectivas ──
const colectiva = async (eq, titulo, lim) => { await as(P.ADMIN); return (await q(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo,fecha_limite) VALUES (${eq},'${PE1}','${titulo}',current_date + (${lim})) RETURNING id`))[0].id; };
const C1 = await colectiva(E1, 'C1 aprobada', 5), C2 = await colectiva(E1, 'C2 vencida', -2), C3 = await colectiva(E2, 'C3 anulada', 3), C4 = await colectiva(E2, 'C4 en revisión', 4);
await as(P.M1);
for (const id of [C1, C4]) { await db.exec(`UPDATE tareas_equipo SET estado='en_curso' WHERE id=${id}`); await db.exec(`UPDATE tareas_equipo SET estado='entregada', entrega_nota='listo' WHERE id=${id}`); }
await as(P.ADMIN);
await db.exec(`UPDATE tareas_equipo SET estado='aprobada', puntos=8 WHERE id=${C1}`);
await db.exec(`UPDATE tareas_equipo SET estado='anulada', anulacion_motivo='Se canceló la cobertura' WHERE id=${C3}`);

// ── Tareas individuales: I1 aprobada (8), I2 vencida, I3 anulada ──
const indiv = async (a, titulo, lim) => { await as(P.ADMIN); return (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,fecha_limite) VALUES ('${PE1}','${titulo}','${a}',current_date + (${lim})) RETURNING id`))[0].id; };
const I1 = await indiv(P.M1, 'I1 aprobada', 5), I2 = await indiv(P.M2, 'I2 vencida', -3), I3 = await indiv(P.M1, 'I3 anulada', 6);
await as(P.M1);
await db.exec(`UPDATE tareas SET estado='en_curso' WHERE id=${I1}`);
await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='listo' WHERE id=${I1}`);
await as(P.ADMIN);
await db.exec(`UPDATE tareas SET estado='aprobada', puntos=8 WHERE id=${I1}`);
await db.exec(`UPDATE tareas SET estado='anulada', anulacion_motivo='Duplicada con otra' WHERE id=${I3}`);

await root();
await db.exec(`ALTER TABLE public.periodos_evaluacion ALTER COLUMN created_at SET DEFAULT now()`);
const rg = async (u, args = '') => { await as(u); return q(`SELECT * FROM reporte_general_pe(${args}) ORDER BY orden`); };
const pe = (rows, n) => rows.find(r => r.periodo_nombre === n);

console.log('\n[la fila del PE1 (administración)]');
let r = await rg(P.ADMIN);
let p1 = pe(r, 'PE1');
ok(r.length === 3, 'siguen saliendo todos los PE de la gestión (LEG, PE1, PE2; ARCH es de otra gestión)');
ok(p1.equipos_total === 2 && p1.equipos_activos === 2, `equipos: 2 (los dos activos) — ${p1.equipos_total}/${p1.equipos_activos}`);
ok(p1.equipos_integrantes === 4, `personas DISTINTAS en equipos: 4 (M1, M2, M3, M5), no 6 aunque M1 esté en dos (${p1.equipos_integrantes})`);
ok(p1.colectivas_total === 3 && p1.colectivas_anuladas === 1, `colectivas: 3 vigentes + 1 anulada aparte (${p1.colectivas_total}/${p1.colectivas_anuladas})`);
ok(p1.colectivas_aprobadas === 1 && p1.colectivas_en_revision === 1 && p1.colectivas_abiertas === 1 && p1.colectivas_vencidas === 1, 'colectivas: 1 aprobada, 1 en revisión, 1 abierta (la vencida)');
ok(p1.colectivas_aprobadas + p1.colectivas_en_revision + p1.colectivas_abiertas === p1.colectivas_total, 'aprobadas + en revisión + abiertas = total (cada colectiva en un solo grupo)');
ok(p1.colectivas_con_plazo === 2 && p1.colectivas_a_tiempo === 2, 'colectivas entregadas con plazo 2, a tiempo 2');
ok(p1.tareas_total === 2 && p1.tareas_asignadas === 2 && p1.tareas_anuladas === 1, `individuales: 2 vigentes (la anulada NO cuenta) y 1 anulada aparte (${p1.tareas_total}/${p1.tareas_anuladas})`);
ok(p1.tareas_abiertas + p1.tareas_en_revision + p1.tareas_aprobadas === p1.tareas_total, 'individuales: abiertas + en revisión + aprobadas = total, también con anuladas de por medio');
ok(p1.tareas_vencidas === 1 && p1.tareas_aprobadas === 1, 'individuales: 1 vencida, 1 aprobada');

console.log('\n[una tarea colectiva cuenta UNA vez, no una por integrante]');
await as(P.ADMIN);
const porPersona = (await q(`SELECT SUM(colectivas_total)::int s FROM seguimiento_global() WHERE periodo_nombre='PE1'`))[0].s;
ok(porPersona > p1.colectivas_total, `sumar lo que dice cada persona (${porPersona}) daría MÁS que las tareas reales (${p1.colectivas_total}): el reporte cuenta por tarea`);
const reales = (await q(`SELECT COUNT(*)::int n FROM tareas_equipo WHERE periodo_id='${PE1}' AND estado <> 'anulada'`))[0].n;
ok(reales === p1.colectivas_total, 'colectivas del reporte = filas de tareas_equipo no anuladas');
const unidades = p1.tareas_total + p1.colectivas_total;
ok(unidades === 5, 'unidades de tarea del PE = individuales + colectivas = 2 + 3');

console.log('\n[el resultado sigue saliendo de la fuente de verdad (que ya integra las tareas)]');
await as(P.ADMIN);
const fuente = (await q(`SELECT COUNT(*)::int n, SUM(individual) s, SUM(individual_eval) se FROM resultados_periodo('${PE1}', false)`))[0];
ok(p1.n_resultados === fuente.n && Number(p1.suma_resultado) === Number(fuente.s), `suma y n = resultados_periodo() (n=${p1.n_resultados}, suma=${p1.suma_resultado})`);
ok(Number(fuente.s) !== Number(fuente.se), 'y el resultado YA no es el de la evaluación sola: las tareas entraron (la causa raíz de 0033–0035), sin que el reporte tenga fórmula propia');
const notas = (await q(`SELECT COUNT(*)::int n, SUM(tareas_nota) s FROM seguimiento_global() WHERE periodo_nombre='PE1' AND participa AND estado_eval='publicado' AND tareas_nota IS NOT NULL`))[0];
ok(p1.n_nota_tareas === notas.n && Number(p1.suma_nota_tareas) === Number(notas.s) && p1.n_nota_tareas >= 1, `personas con nota de tareas: ${p1.n_nota_tareas} (= seguimiento_global)`);
ok(Number(p1.peso_tareas_regla) === 20 && p1.regla_confirmada === false, 'la regla del PE (20 %, sin confirmar) se lee de periodo_calif_config, no se recalcula');
ok(pe(r, 'LEG').peso_tareas_regla === null, 'un PE clásico no tiene regla de tareas (null, no 0)');

console.log('\n[PE sin equipos ni tareas]');
const p2 = pe(r, 'PE2');
ok(p2.equipos_total === 0 && p2.colectivas_total === 0 && p2.tareas_anuladas === 0 && p2.equipos_integrantes === 0, 'PE2: sin equipos, sin colectivas, sin anuladas — todo 0');

console.log('\n[permisos de equipos y tareas colectivas]');
r = await rg(P.SEC1); p1 = pe(r, 'PE1');
ok(p1.equipos_total === 2 && p1.colectivas_total === 3, 'secretaría 08-01: ve los 2 equipos (el de su distrito y el transversal donde están M1 y M2) y sus 3 tareas');
ok(p1.equipos_integrantes === 3, 'pero cuenta solo SUS personas (M1, M2, M5): M3, de otro distrito, no entra aunque comparta el equipo');
r = await rg(P.SEC2); p1 = pe(r, 'PE1');
ok(p1.equipos_total === 1 && p1.colectivas_total === 2 && p1.equipos_integrantes === 1, 'secretaría 08-02: solo el equipo donde está M3 (1 equipo, 2 tareas, 1 persona); no ve el del distrito 08-01');
r = await rg(P.M3); p1 = pe(r, 'PE1');
ok(p1.equipos_total === 1 && p1.colectivas_total === 2, 'un miembro ve los equipos y tareas colectivas de SU equipo');
r = await rg(P.M4); p1 = pe(r, 'PE1');
ok(p1.equipos_total === 0 && p1.colectivas_total === 0 && p1.tareas_total === 0, 'quien no está en ningún equipo: 0');
await as(null, 'anon');
await rejects(`SELECT * FROM reporte_general_pe()`, 'permission', 'anon no puede llamarla');
await as(null, 'authenticated');
await rejects(`SELECT * FROM reporte_general_pe()`, 'sesion', 'sin sesión se rechaza');

console.log('\n[filtros]');
r = await rg(P.ADMIN, `NULL, '08-02'`); p1 = pe(r, 'PE1');
ok(p1.equipos_total === 1 && p1.colectivas_total === 2 && p1.equipos_integrantes === 1, 'distrito 08-02: solo el equipo con alguien de 08-02 (el transversal)');
r = await rg(P.ADMIN, `NULL, '08-01'`); p1 = pe(r, 'PE1');
ok(p1.equipos_total === 2 && p1.colectivas_total === 3 && p1.equipos_integrantes === 3, 'distrito 08-01: los dos equipos, las tres tareas, 3 personas');
ok(true, 'NOTA: 08-01 (3 tareas) + 08-02 (2 tareas) = 5 ≠ 3, porque el equipo transversal cruza distritos: los cortes por distrito de las colectivas no se suman (el total sin filtro es el correcto)');
r = await rg(P.ADMIN, `NULL, 'nadie'`);
ok(pe(r, 'PE1').equipos_total === 0 && pe(r, 'PE1').colectivas_total === 0 && r.length === 3, 'un distrito sin nadie: 0 equipos y 0 tareas, los PE siguen saliendo');
r = await rg(P.SEC1, `NULL, '08-02'`);
ok(pe(r, 'PE1').equipos_total === 0 && pe(r, 'PE1').personas === 0, 'una secretaría que pide otro distrito no obtiene nada');

console.log('\n[solo lectura]');
await as(P.ADMIN);
const a0 = (await q(`SELECT (SELECT count(*) FROM tareas_equipo)::int a, (SELECT count(*) FROM equipos)::int b, (SELECT count(*) FROM calificaciones_historial)::int c`))[0];
await db.exec(`SELECT * FROM reporte_general_pe(); SELECT * FROM reporte_general_pe(NULL,'08-01',${FOTO});`);
const a1 = (await q(`SELECT (SELECT count(*) FROM tareas_equipo)::int a, (SELECT count(*) FROM equipos)::int b, (SELECT count(*) FROM calificaciones_historial)::int c`))[0];
ok(JSON.stringify(a0) === JSON.stringify(a1), 'consultar no cambia equipos, tareas ni calificaciones');

fin();
