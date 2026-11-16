// Pruebas de 0065: nivel de la tarea (distrital/regional), tipo de entrega, peso retirado y «quién evalúa mi iniciativa».
import { crear, montar, CADENA_BASE, sql, J } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, allowed, fin } = t;
const CADENA = [...CADENA_BASE, '0031_equipos.sql', '0032_tareas_equipo.sql', '0033_calificaciones.sql', '0034_calificacion_tareas.sql', '0035_resultados_integrados.sql', '0036_equipos_vistas.sql', '0063_tareas_propias_en_curso.sql',
  '0053_rectificacion_evaluaciones.sql', '0061_tareas_sin_tareas_pierde_puntos.sql', '0062_dos_roles_por_persona.sql'];
const X = await montar(t, CADENA);
const { P, PE1, G, FOTO } = X;

// Piezas de avisos que 0065 parchea (0019/0040 no están en esta cadena): un notif_revisores y un notif_trg_tarea mínimos.
await db.exec(`
  CREATE OR REPLACE FUNCTION public.notif_revisores(p_persona UUID) RETURNS SETOF UUID LANGUAGE sql STABLE AS $$
    SELECT a.id FROM profiles a WHERE COALESCE(a.es_admin, false) AND a.id <> p_persona
    UNION SELECT s.id FROM profiles s JOIN profiles p ON p.id = p_persona
     WHERE s.tipo_miembro = 'secretario' AND p.distrito IS NOT NULL AND s.distrito = p.distrito AND s.id <> p_persona $$;
  CREATE OR REPLACE FUNCTION public.notif_trg_tarea() RETURNS TRIGGER LANGUAGE plpgsql AS $$
  DECLARE v_rev UUID;
  BEGIN
    FOR v_rev IN SELECT notif_revisores(NEW.asignada_a) LOOP NULL; END LOOP;
    RETURN NULL;
  END; $$;
`);

const perfil = (await q(`SELECT public.perfil_vigente(${FOTO}, '${PE1}') id`))[0].id;
const tec = await q(`SELECT criterio_key k, peso FROM perfil_criterios WHERE perfil_id=${perfil}`);
const nuc = (await q(`SELECT key FROM criterios_v2 WHERE gestion_id=${G} AND tipo='nucleo' AND tipo_campo='escala' AND activo`)).map(x => x.key);
const pun = f => J(Object.fromEntries([...nuc.map(k => [k, Math.round(10 * f)]), ...tec.map(x => [x.k, Math.floor(x.peso * f)])]));
await db.exec(`UPDATE profiles SET rol_id=${FOTO} WHERE id IN ('${P.M1}','${P.M2}','${P.M3}','${P.M5}')`);
await as(P.ADMIN);
for (const m of [P.M1, P.M2, P.M3, P.M5]) await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE1}','${m}','${pun(0.8)}','publicado')`);

// ── Datos de ANTES de 0065: tareas con pesos distintos (1, 2, 3), una de equipo, una propia ──
const tarea = async (para, titulo, peso, pts, por = P.ADMIN) => {
  await as(por);
  const id = (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,peso) VALUES ('${PE1}','${titulo}','${para}',${peso}) RETURNING id`))[0].id;
  await as(para); await db.exec(`UPDATE tareas SET estado='en_curso' WHERE id=${id}`); await db.exec(`UPDATE tareas SET estado='entregada', entrega_url='https://drive.example/x', entrega_nota='listo' WHERE id=${id}`);
  await as(por === P.SEC1 ? P.SEC1 : P.ADMIN); await db.exec(`UPDATE tareas SET estado='aprobada', puntos=${pts} WHERE id=${id}`);
  return id;
};
const T1 = await tarea(P.M1, 'Reportaje A', 1, 8);
const T2 = await tarea(P.M1, 'Reportaje B', 3, 4);          // peso 3: pesa el triple
const T3 = await tarea(P.M2, 'Cobertura', 2, 10, P.SEC1);   // asignada por una secretaría
await as(P.ADMIN);
const EQ = (await q(`SELECT public.equipo_guardar(NULL,'${PE1}','Cobertura') id`))[0].id;
await db.exec(`SELECT public.equipo_agregar_miembros(${EQ}, ARRAY['${P.M1}','${P.M2}']::uuid[], true, 'Prueba')`);
const TE = (await q(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo,peso) VALUES (${EQ},'${PE1}','Grupal',5) RETURNING id`))[0].id;
await as(P.M2); await db.exec(`UPDATE tareas_equipo SET estado='entregada', entrega_nota='Entrega del grupo' WHERE id=${TE}`);
await as(P.ADMIN); await db.exec(`UPDATE tareas_equipo SET estado='aprobada', puntos=6 WHERE id=${TE}`);
// una iniciativa propia ya aprobada por la administración
await as(P.M5);
const TP = (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a) VALUES ('${PE1}','Mi iniciativa','${P.M5}') RETURNING id`))[0].id;
await db.exec(`UPDATE tareas SET estado='en_curso' WHERE id=${TP}`); await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='hecho' WHERE id=${TP}`);
await as(P.ADMIN); await db.exec(`UPDATE tareas SET estado='aprobada', puntos=7 WHERE id=${TP}`);

const COLS = 'evaluado_id, nucleo::float n, tecnico::float t, individual::float i, percentil::float p, general::float g, individual_eval::float ie, general_eval::float ge, tareas::float ta, tareas_n, peso_tareas::float w';
const res = async () => { await as(P.ADMIN); const f = await q(`SELECT ${COLS} FROM resultados_periodo('${PE1}') ORDER BY evaluado_id`); await root(); return f; };
const detalle = async persona => { await as(P.ADMIN); const f = await q(`SELECT tarea_id, tipo, peso_tarea::float pt, peso_efectivo::float pe, aporte_pct::float ap, cuenta FROM tareas_calificacion_detalle('${PE1}','${persona}') ORDER BY tipo, tarea_id`); await root(); return f; };
const eqres = async () => { await as(P.ADMIN); const f = await q(`SELECT persona_id, nota::float n FROM equipo_resultados(${EQ}) ORDER BY persona_id NULLS FIRST`); await root(); return f; };
const resumen = async () => { await as(P.ADMIN); const f = await q(`SELECT persona_id, nota::float n, suma_pesos::float sp FROM tareas_calificacion_resumen('${PE1}') ORDER BY persona_id`); await root(); return f; };
await root();
const antes = await res(), dAntes = await detalle(P.M1), eAntes = await eqres(), sAntes = await resumen();
const nM1 = antes.find(r => r.evaluado_id === P.M1);
console.log('[antes de 0065] M1: nota de tareas ' + nM1.ta + ' (' + nM1.tareas_n + ' piezas), individual ' + nM1.i);
// 100 * (1*0.8 + 3*0.4 + 5*0.6 de equipo) / (1+3+5) — pesos heredados 1, 3 y 5
ok(nM1.ta !== null && nM1.tareas_n === 3, 'M1 tiene nota de tareas con 3 piezas (2 individuales + 1 de equipo)');

const m = sql('0065_tareas_nivel_tipo_entrega.sql');
await db.exec(m);
ok(true, '0065 se aplica sin errores');
await db.exec(m);
ok(true, 'reaplicar 0065 es idempotente');

console.log('\n[paridad: con multiplicadores 1 y 1 nada cambia]');
ok(JSON.stringify(await res()) === JSON.stringify(antes), 'resultados_periodo() es idéntico (todas las personas) antes y después de 0065');
ok(JSON.stringify((await detalle(P.M1)).map(({ tarea_id, tipo, pt, pe, ap, cuenta }) => ({ tarea_id, tipo, pt, pe, ap, cuenta }))) === JSON.stringify(dAntes), 'el desglose por tarea de M1 (peso, peso efectivo, aporte) es idéntico');
ok(JSON.stringify(await eqres()) === JSON.stringify(eAntes), 'equipo_resultados() es idéntico');
ok(JSON.stringify(await resumen()) === JSON.stringify(sAntes), 'tareas_calificacion_resumen() es idéntico');
await as(P.ADMIN);
const cfg = (await q(`SELECT mult_distrital::float d, mult_regional::float r FROM calif_config('${PE1}')`))[0];
ok(cfg.d === 1 && cfg.r === 1, 'calif_config() trae los multiplicadores por nivel en 1 y 1');
await root();

console.log('\n[lo existente quedó clasificado]');
const niv = Object.fromEntries((await q(`SELECT id, nivel, tipo_entrega te, peso::float p FROM tareas`)).map(r => [r.id, r]));
ok(niv[T1].nivel === 'regional' && niv[T2].nivel === 'regional', 'asignadas por la administración → regional');
ok(niv[T3].nivel === 'distrital', 'asignada por una secretaría → distrital');
ok(niv[TP].nivel === 'distrital', 'iniciativa de una persona con secretaría en su distrito → distrital');
ok((await q(`SELECT nivel FROM tareas_equipo WHERE id=${TE}`))[0].nivel === 'regional', 'tarea de un equipo SIN distrito → regional');
ok(niv[T1].te === 'enlace' && niv[TP].te === null, 'entregas con enlace anteriores → tipo «enlace»; sin enlace → sin indicar');
ok(niv[T2].p === 3, 'el peso heredado se conserva en las tareas existentes (3)');

console.log('\n[el peso ya no se elige]');
await as(P.ADMIN);
const N1 = (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,peso,nivel) VALUES ('${PE1}','Nueva con peso 5','${P.M2}',5,'regional') RETURNING id`))[0].id;
await root();
ok((await q(`SELECT peso::float p FROM tareas WHERE id=${N1}`))[0].p === 1, 'una tarea nueva con peso 5 enviado nace con peso 1 (se ignora)');
await as(P.ADMIN);
await db.exec(`UPDATE tareas SET peso=9 WHERE id=${N1}`);
await root();
ok((await q(`SELECT peso::float p FROM tareas WHERE id=${N1}`))[0].p === 1, 'cambiar el peso en una tarea existente no hace nada');
await as(P.ADMIN);
await db.exec(`UPDATE tareas SET peso=9 WHERE id=${T2}`);
await root();
ok((await q(`SELECT peso::float p FROM tareas WHERE id=${T2}`))[0].p === 3, 'ni siquiera la administración cambia el peso heredado (queda en 3)');
await as(P.ADMIN);
const NE = (await q(`INSERT INTO tareas_equipo(equipo_id,periodo_id,titulo,peso) VALUES (${EQ},'${PE1}','Equipo nueva',4) RETURNING id`))[0].id;
await root();
ok((await q(`SELECT peso::float p FROM tareas_equipo WHERE id=${NE}`))[0].p === 1, 'una tarea de equipo nueva nace con peso 1');

console.log('\n[multiplicadores por nivel]');
await as(P.ADMIN);
await db.exec(`SELECT public.calif_config_guardar('${PE1}', 20, 1, 1, 1, true, false, 'Regional pesa el doble', false, 1, 2)`);
const c2 = (await q(`SELECT mult_distrital::float d, mult_regional::float r, peso_tareas::float w FROM calif_config('${PE1}')`))[0];
ok(c2.d === 1 && c2.r === 2 && c2.w === 20, 'se guardan 1 (distrital) y 2 (regional); el resto de las reglas sigue igual');
await root();
const d2 = await detalle(P.M1);
const dT1 = d2.find(x => x.tarea_id === T1 && x.tipo === 'individual'), dT2 = d2.find(x => x.tarea_id === T2 && x.tipo === 'individual'), dTE = d2.find(x => x.tipo === 'equipo');
ok(dT1.pe === 2 && dT2.pe === 6, 'tareas regionales ×2: T1 peso 1→2, T2 (peso heredado 3) → 6');
ok(dTE.pe === 10, 'la tarea de equipo (regional, sin distrito) también ×2: 5 → 10');
const r2 = (await res()).find(r => r.evaluado_id === P.M1);
const esperada = Math.round(1000 * (2 * 0.8 + 6 * 0.4 + 10 * 0.6) / (2 + 6 + 10)) / 10;
ok(Math.abs(r2.ta - esperada) <= 0.11, `nota de tareas de M1 = Σ(peso_efectivo·puntos/10)/Σ(peso_efectivo) = ${esperada} (calculado: ${r2.ta})`);
const m2n = (await res()).find(r => r.evaluado_id === P.M2), m2a = antes.find(r => r.evaluado_id === P.M2);
ok(m2n.ta !== m2a.ta, `la nota de M2 (una tarea distrital y una de equipo regional) cambió: ${m2a.ta} → ${m2n.ta}`);
ok(Math.abs(r2.ta - nM1.ta) <= 0.11, 'M1 con TODAS sus tareas regionales conserva su promedio: multiplicar todo por igual no cambia la proporción');
// una iniciativa propia no se infla con el nivel
const rM5 = (await res()).find(r => r.evaluado_id === P.M5), aM5 = antes.find(r => r.evaluado_id === P.M5);
ok(JSON.stringify(rM5) === JSON.stringify(aM5), 'M5 (solo una iniciativa) no cambia: la iniciativa pesa ×1 sin importar el nivel');
await as(P.ADMIN);
await rejects(`SELECT public.calif_config_guardar('${PE1}', 20, 1, 1, 1, true, false, 'Mal valor', false, 0, 1)`, 'mayores que 0', 'un multiplicador 0 se rechaza');
await db.exec(`SELECT public.calif_config_guardar('${PE1}', 20, 1, 1, 1, true, false, 'Se vuelve a 1 y 1', false, 1, 1)`);
await root();
ok(JSON.stringify(await res()) === JSON.stringify(antes), 'volver a 1 y 1 devuelve EXACTAMENTE los resultados de antes de 0065');
await as(P.M1);
await rejects(`SELECT public.calif_config_guardar('${PE1}', 20, 1, 1, 1, true, false, 'Intento', false, 3, 3)`, 'administracion', 'un miembro no cambia los multiplicadores');
await as(P.SEC1);
await rejects(`SELECT public.calif_config_guardar('${PE1}', 20, 1, 1, 1, true, false, 'Intento', false, 3, 3)`, 'administracion', 'una secretaría tampoco');
await root();
ok((await q(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname='public' AND p.proname='calif_config_guardar'`))[0].n === 1, 'queda una sola versión de calif_config_guardar');

console.log('\n[quién clasifica: una secretaría solo asigna tareas distritales]');
await as(P.SEC1);
const NS = (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,nivel) VALUES ('${PE1}','De la secretaría','${P.M1}','regional') RETURNING id`))[0].id;
await root();
ok((await q(`SELECT nivel FROM tareas WHERE id=${NS}`))[0].nivel === 'distrital', 'la secretaría pidió «regional» y la base la dejó «distrital»');
await as(P.SEC1);
await rejects(`UPDATE tareas SET nivel='regional' WHERE id=${NS}`, 'administraci', 'la secretaría no cambia el nivel de una tarea ya creada');
await as(P.ADMIN);
await allowed(`UPDATE tareas SET nivel='regional' WHERE id=${NS}`, 'la administración sí cambia el nivel');
await db.exec(`UPDATE tareas SET nivel='distrital' WHERE id=${NS}`);
await root();

console.log('\n[tipo de entrega]');
await as(P.M2);
await db.exec(`UPDATE tareas SET estado='en_curso' WHERE id=${N1}`);
await allowed(`UPDATE tareas SET estado='entregada', entrega_url='https://drive.example/v', entrega_nota='ok', tipo_entrega='video' WHERE id=${N1}`, 'quien entrega indica el tipo (video) al entregar');
await rejects(`UPDATE tareas SET tipo_entrega='imagen' WHERE id=${N1}`, 'entregada la tarea', 'ya entregada, no se cambia el tipo');
await root();
await as(P.ADMIN);
await rejects(`UPDATE tareas SET tipo_entrega='gif' WHERE id=${NS}`, 'check|tipo_entrega', 'un tipo fuera de la lista se rechaza (CHECK)');
await root();
ok((await q(`SELECT tipo_entrega te FROM tareas WHERE id=${N1}`))[0].te === 'video', 'el tipo quedó guardado');
await as(P.M2);
await rejects(`INSERT INTO tareas(periodo_id,titulo,asignada_a,tipo_entrega) VALUES ('${PE1}','x','${P.M2}','mp3')`, 'check|tipo_entrega', 'un tipo inválido al crear se rechaza');
await root();
await as(P.ADMIN);
await allowed(`UPDATE tareas_equipo SET tipo_entrega='documento' WHERE id=${NE}`, 'una tarea de equipo también lleva tipo de entrega');
const est = (await q(`SELECT nivel, tipo_entrega FROM tareas_equipo_estado(${EQ}) WHERE tarea_id=${NE}`))[0];
ok(est.nivel === 'regional' && est.tipo_entrega === 'documento', 'tareas_equipo_estado() devuelve nivel y tipo_entrega');
await root();

console.log('\n[pedido 15: quién evalúa mi iniciativa]');
// M1 (08-01, con secretaría SEC1) y M3 (08-02, con secretaría SEC2). Un miembro sin distrito: MSIN.
const MSIN = '00000000-0000-0000-0000-000000000077';
await db.exec(`INSERT INTO profiles(id,nombre,rol_id) VALUES ('${MSIN}','Sin distrito',${FOTO})`);
await as(P.M1);
ok((await q(`SELECT public.mi_instancia_distrital_disponible() v`))[0].v === true, 'M1 (distrito con secretaría) puede elegir «Distrital»');
await as(MSIN);
ok((await q(`SELECT public.mi_instancia_distrital_disponible() v`))[0].v === false, 'sin distrito no hay instancia distrital');
await as(P.SEC1);
ok((await q(`SELECT public.mi_instancia_distrital_disponible() v`))[0].v === false, 'una secretaría no tiene instancia distrital sobre sí');
await as(P.M1);
const ID = (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,nivel) VALUES ('${PE1}','Iniciativa distrital','${P.M1}','distrital') RETURNING id`))[0].id;
const IR = (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,nivel) VALUES ('${PE1}','Iniciativa regional','${P.M1}','regional') RETURNING id`))[0].id;
await as(MSIN);
const IS = (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,nivel) VALUES ('${PE1}','Sin secretaría','${MSIN}','distrital') RETURNING id`))[0].id;
await as(P.SEC1);
const ISEC = (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,nivel) VALUES ('${PE1}','De la secretaría','${P.SEC1}','distrital') RETURNING id`))[0].id;
await as(P.ADMIN);
const IADM = (await q(`INSERT INTO tareas(periodo_id,titulo,asignada_a,nivel) VALUES ('${PE1}','De la administración','${P.ADMIN}','distrital') RETURNING id`))[0].id;
await root();
const nv = Object.fromEntries((await q(`SELECT id, nivel, estado, origen, peso::float p FROM tareas WHERE id IN (${ID},${IR},${IS},${ISEC},${IADM})`)).map(r => [r.id, r]));
ok(nv[ID].nivel === 'distrital' && nv[ID].origen === 'propia' && nv[ID].estado === 'en_curso', 'la iniciativa distrital queda distrital y nace «En curso» (0063 sigue vigente)');
ok(nv[IR].nivel === 'regional', 'la iniciativa regional queda regional');
ok(nv[IS].nivel === 'regional', 'persona SIN secretaría de distrito: pidió distrital y cae a regional');
ok(nv[ISEC].nivel === 'regional', 'una secretaría que crea su iniciativa: la evalúa la administración (regional)');
ok(nv[IADM].nivel === 'regional' && nv[ID].p === 1, 'la administración, regional; y el peso de toda iniciativa nueva es 1');

const entregar = async (quien, id) => { await as(quien); await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='Entrega de la iniciativa' WHERE id=${id}`); };
await entregar(P.M1, ID); await entregar(P.M1, IR);
await as(P.SEC1);
await allowed(`UPDATE tareas SET estado='devuelta', revision_nota='Falta la fuente' WHERE id=${ID}`, 'la secretaría del distrito devuelve la iniciativa DISTRITAL');
await rejects(`UPDATE tareas SET estado='aprobada', puntos=9 WHERE id=${IR}`, 'No tienes acceso', 'la secretaría NO aprueba una iniciativa REGIONAL');
await rejects(`UPDATE tareas SET estado='devuelta', revision_nota='No va' WHERE id=${IR}`, 'No tienes acceso', 'ni la devuelve');
await rejects(`UPDATE tareas SET revision_nota='algo' WHERE id=${IR}`, 'No tienes acceso', 'ni deja notas de revisión');
await as(P.SEC2);
await db.exec(`UPDATE tareas SET estado='aprobada', puntos=9 WHERE id=${ID}`);
await root();
ok((await q(`SELECT estado FROM tareas WHERE id=${ID}`))[0].estado === 'devuelta', 'la secretaría de OTRO distrito no ve ni toca la iniciativa distrital (sigue «devuelta»)');
await as(P.ADMIN);
await entregar(P.M1, ID);
await as(P.ADMIN);
await allowed(`UPDATE tareas SET estado='aprobada', puntos=9 WHERE id=${IR}`, 'la administración aprueba la iniciativa regional');
await allowed(`UPDATE tareas SET estado='aprobada', puntos=9 WHERE id=${ID}`, 'y la administración conserva acceso a la distrital (supervisa)');
await as(P.SEC1);
await rejects(`SELECT public.prorrogar_tarea(${IR}, CURRENT_DATE + 5, 'Más tiempo')`, 'No puedes cambiar la fecha', 'la secretaría no prorroga una iniciativa regional (prorrogar_tarea)');
await root();

console.log('\n[«nadie aprueba su propia tarea» sigue vigente]');
await as(P.SEC1);
await db.exec(`UPDATE tareas SET estado='entregada', entrega_nota='Entrega de la secretaría' WHERE id=${ISEC}`);
await rejects(`UPDATE tareas SET estado='aprobada', puntos=10 WHERE id=${ISEC}`, 'No tienes acceso|Transicion', 'la secretaría no aprueba su propia iniciativa');
await as(MSIN);
await rejects(`UPDATE tareas SET nivel='distrital' WHERE id=${IS}`, 'administraci', 'quien crea la iniciativa no cambia después quién la evalúa');
await as(P.M1);
await rejects(`UPDATE tareas SET estado='aprobada', puntos=10 WHERE id=${ID}`, 'No tienes acceso|Transicion|aprobada no', 'ni aprueba la suya (iniciativa propia)');
await root();

console.log('\n[avisos: solo la instancia elegida]');
const rev = async (p, o, n) => (await q(`SELECT x::text FROM public.notif_revisores_tarea('${p}','${o}','${n}') x`)).map(r => r.x).sort();
const dep = JSON.stringify;
ok(dep(await rev(P.M1, 'propia', 'distrital')) === dep([P.SEC1]), 'iniciativa DISTRITAL de M1 → avisa solo a la secretaría de 08-01');
ok(dep(await rev(P.M1, 'propia', 'regional')) === dep([P.ADMIN]), 'iniciativa REGIONAL de M1 → avisa solo a la administración');
ok(dep(await rev(MSIN, 'propia', 'distrital')) === dep([P.ADMIN]), 'distrital sin secretaría en el distrito → cae a la administración');
ok(dep(await rev(P.M1, 'asignada', 'regional')) === dep([P.ADMIN, P.SEC1].sort()), 'una tarea asignada avisa como siempre (administración y secretaría)');
const defNotif = (await q(`SELECT pg_get_functiondef('public.notif_trg_tarea'::regproc) d`))[0].d;
ok(defNotif.includes('notif_revisores_tarea(NEW.asignada_a, NEW.origen, NEW.nivel)') && !/notif_revisores\(NEW/.test(defNotif), 'notif_trg_tarea() quedó parcheada con el nuevo destinatario');

console.log('\n[permisos de las funciones]');
await as(null, 'anon');
await rejects(`SELECT public.mi_instancia_distrital_disponible()`, 'denied|permission', 'anon no ejecuta mi_instancia_distrital_disponible');
await rejects(`SELECT public.puede_revisar_tarea_fila('${P.M1}','propia','regional')`, 'denied|permission', 'anon no ejecuta puede_revisar_tarea_fila');
await as(P.M1);
await rejects(`SELECT public.calif_mult_nivel('regional','asignada',1,2)`, 'denied|permission', 'calif_mult_nivel es interna');
await rejects(`SELECT public.distrito_tiene_secretaria('08-01')`, 'denied|permission', 'distrito_tiene_secretaria es interna');
await rejects(`SELECT * FROM public.calif_items('${PE1}')`, 'denied|permission', 'calif_items sigue sin acceso desde el cliente');
await rejects(`SELECT * FROM public.notif_revisores_tarea('${P.M1}','propia','regional')`, 'denied|permission', 'notif_revisores_tarea es interna');
await root();
fin();
