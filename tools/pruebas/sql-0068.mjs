// Pruebas de 0068 («Solicito tu ayuda»): RLS real (SET ROLE), toma atómica, permisos por rol, historial append-only, auditoría y avisos.
// Cadena: esquema real hasta 0062 + 0055 (auditoría) + 0019/0022/0040 (avisos). Lo que NO se puede probar aquí: la entrega real de eventos Realtime
// ni la concurrencia real entre dos conexiones (PGlite atiende una a la vez): se prueba que la sentencia de toma es condicional y que la segunda pierde.
import fs from 'node:fs';
import { crear, montar, CADENA_BASE, sql, R } from './base-eq.mjs';

const t = crear();
const { db, ok, q, as, root, rejects, allowed, fin } = t;
await db.exec(`CREATE PUBLICATION supabase_realtime`);
const CADENA = [...CADENA_BASE, '0031_equipos.sql', '0032_tareas_equipo.sql', '0033_calificaciones.sql', '0034_calificacion_tareas.sql', '0035_resultados_integrados.sql',
  '0053_rectificacion_evaluaciones.sql', '0061_tareas_sin_tareas_pierde_puntos.sql', '0062_dos_roles_por_persona.sql', '0055_auditoria_global.sql'];
const X = await montar(t, CADENA);
const { P, FOTO, REDA } = X;
const otros = (await q(`SELECT id FROM roles WHERE id NOT IN (${FOTO}, ${REDA}) ORDER BY id LIMIT 1`)).map(x => x.id);
const ROL3 = otros[0];

// Avisos como en producción (sin pg_cron / pg_net): 0019 parcial + 0022 + 0040.
const m19 = sql('0019_notificaciones.sql');
const fn19 = n => { const i = m19.indexOf(`CREATE OR REPLACE FUNCTION public.${n}(`); const a = m19.indexOf('$$', i), b = m19.indexOf('$$', a + 2); return m19.slice(i, m19.indexOf(';', b) + 1); };
await db.exec(`CREATE ROLE service_role NOLOGIN; GRANT USAGE ON SCHEMA public TO service_role;`);
await db.exec(m19.match(/CREATE TABLE IF NOT EXISTS public\.notificaciones \([\s\S]*?\n\);/)[0] + `ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.notificaciones FROM anon, authenticated;`);
for (const f of ['notif_fecha', 'notif_zona', 'notif_encolar']) await db.exec(fn19(f));
await db.exec(sql('0022_notificaciones_app.sql'));
await db.exec(sql('0040_notificaciones_integral.sql'));

// Datos: M1 (Fotografía, 08-01), M2 (Fotografía, 08-01), M3 (Fotografía, 08-02), M4 (Redacción, 08-02), M5 (Redacción, 08-01), SEC1 (08-01), SEC2 (08-02).
await db.exec(`UPDATE profiles SET rol_id=${FOTO} WHERE id IN ('${P.M1}','${P.M2}','${P.M3}'); UPDATE profiles SET rol_id=${REDA} WHERE id IN ('${P.M4}','${P.M5}')`);

// ── antes de la migración: huella de lo que NO debe cambiar ─────────────────────────────────────────
const huella = async () => (await q(`SELECT
    (SELECT md5(string_agg(id::text || coalesce(rol_id::text,'') || coalesce(distrito,'') || es_admin::text, ',' ORDER BY id)) FROM profiles) pf,
    (SELECT count(*)::int FROM persona_roles) pr, (SELECT count(*)::int FROM roles) ro, (SELECT count(*)::int FROM notificaciones) no,
    (SELECT md5(string_agg(tipo || claves::text, ',' ORDER BY tipo)) FROM notif_tipos) nt`))[0];
const H0 = await huella();
const NT0 = (await q(`SELECT count(*)::int n FROM notif_tipos`))[0].n;

console.log('[la migración]');
const m = sql('0068_solicito_ayuda.sql');
await allowed(m, '0068 se aplica sin errores sobre la cadena hasta 0062 + auditoría + avisos');
await allowed(m, 'reaplicar 0068 es idempotente');
const H1 = await huella();
ok(H0.pf === H1.pf && H0.pr === H1.pr && H0.ro === H1.ro && H0.no === H1.no, 'PARIDAD: personas, roles, segundos roles y avisos quedan idénticos');
ok(H0.nt === H1.nt || (await q(`SELECT count(*)::int n FROM notif_tipos WHERE tipo NOT LIKE 'ayuda_%'`))[0].n === NT0, 'PARIDAD: los 20 tipos de aviso existentes no cambian (solo se añaden los de ayuda)');
ok((await q(`SELECT count(*)::int n FROM notif_tipos WHERE tipo LIKE 'ayuda_%'`))[0].n === 5, 'se añaden 5 tipos: ayuda_solicitada, tomada, resuelta, cancelada, reabierta');
const tipos = Object.fromEntries((await q(`SELECT tipo, esencial, correo_default, claves FROM notif_tipos WHERE tipo LIKE 'ayuda_%'`)).map(x => [x.tipo, x]));
ok(tipos.ayuda_tomada.esencial === true && tipos.ayuda_solicitada.esencial === false, 'ayuda_tomada es esencial; ayuda_solicitada es opcional por correo');
ok(!Object.values(tipos).some(x => x.claves.some(k => /descripcion|nota|motivo|enlace/.test(k))), 'ningún tipo deja pasar descripción, nota ni enlace en los datos del aviso');
ok((await q(`SELECT count(*)::int n FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='ayuda_pedidos'`))[0].n === 1, 'ayuda_pedidos está en la publicación Realtime (una vez)');
ok((await q(`SELECT relrowsecurity FROM pg_class WHERE oid='public.ayuda_pedidos'::regclass`))[0].relrowsecurity, 'ayuda_pedidos tiene RLS activada');

// ── ayudantes ──────────────────────────────────────────────────────────────────────────────────────
const fut = (d = 5) => `CURRENT_DATE + ${d}`;
const crearP = async (uid, titulo, rol, o = {}) => {
  await as(uid);
  const r = (await q(`SELECT public.ayuda_crear('${titulo}', '${o.desc ?? 'Necesito apoyo con esto'}', ${rol}, '${o.pri ?? 'normal'}', ${o.fecha ?? 'NULL'}, ${o.enlace ? `'${o.enlace}'` : 'NULL'}, '${o.alc ?? 'todos'}') id`))[0].id;
  await root(); return Number(r);
};
const ver = async (uid) => { await as(uid); const r = (await q(`SELECT id::int, estado FROM ayuda_pedidos ORDER BY id`)); await root(); return r; };
const ids = async uid => (await ver(uid)).map(r => r.id);
const estado = async id => (await q(`SELECT estado, tomada_por, confirmada_en FROM ayuda_pedidos WHERE id=${id}`))[0];
const avisos = async cond => (await q(`SELECT tipo, destinatario_id d, datos, ref_tipo, ref_id FROM notificaciones WHERE tipo LIKE 'ayuda_%' ${cond ? 'AND ' + cond : ''} ORDER BY id`));

console.log('\n[crear: validaciones y lo que fija el servidor]');
await as(P.M2);
await rejects(`SELECT public.ayuda_crear('ab', 'x', ${FOTO})`, 'entre 3 y 120', 'un título de 2 letras se rechaza');
await rejects(`SELECT public.ayuda_crear('Con ayuda', 'x', 99999)`, 'rol que exista', 'un rol inexistente se rechaza');
await rejects(`SELECT public.ayuda_crear('Con ayuda', 'x', ${REDA}, 'critica')`, 'prioridad', 'una prioridad inventada se rechaza');
await rejects(`SELECT public.ayuda_crear('Con ayuda', 'x', ${REDA}, 'normal', NULL, 'javascript:alert(1)')`, 'http', 'un enlace que no es http(s) se rechaza');
await rejects(`SELECT public.ayuda_crear('Con ayuda', 'x', ${REDA}, 'normal', CURRENT_DATE - 10)`, 'ya pasó', 'una fecha límite ya pasada se rechaza');
await rejects(`SELECT public.ayuda_crear('Con ayuda', '${'x'.repeat(1001)}', ${REDA})`, '1000', 'una descripción de más de 1000 caracteres se rechaza');
await root();
await db.exec(`UPDATE profiles SET distrito = NULL WHERE id='${P.M2}'`);
await as(P.M2); await rejects(`SELECT public.ayuda_crear('Con ayuda', 'x', ${REDA}, 'normal', NULL, NULL, 'distrito')`, 'no tiene distrito', 'pedir «solo mi distrito» sin tener distrito se rechaza');
await root(); await db.exec(`UPDATE profiles SET distrito = '08-01' WHERE id='${P.M2}'`);
await as(null, 'anon'); await rejects(`SELECT public.ayuda_crear('Anónimo', 'x', ${REDA})`, 'permission denied', 'anon no puede ni llamar a ayuda_crear'); await root();
await db.exec(`UPDATE profiles SET aprobado = false WHERE id='${P.M3}'`);
await as(P.M3); await rejects(`SELECT public.ayuda_crear('Sin acceso', 'x', ${REDA})`, 'acceso aprobado', 'una persona sin acceso aprobado no pide ayuda'); await root();
await db.exec(`UPDATE profiles SET aprobado = true WHERE id='${P.M3}'`);

const A = await crearP(P.M2, 'Cobertura del acto cívico', REDA, { pri: 'alta', fecha: fut(5), enlace: 'https://drive.example.com/x', desc: 'Necesito el texto antes del viernes' });
const a1 = (await q(`SELECT * FROM ayuda_pedidos WHERE id=${A}`))[0];
ok(a1.estado === 'abierta' && a1.solicitante_id === P.M2 && a1.distrito === '08-01' && a1.alcance === 'todos' && a1.gestion_id == X.G, 'queda abierta, con el solicitante, su distrito y la gestión activa fijados por el servidor');
ok((await q(`SELECT tipo FROM ayuda_eventos WHERE pedido_id=${A}`)).map(x => x.tipo).join() === 'creada', 'el historial registra «creada»');

console.log('\n[RLS: quién ve qué]');
ok(JSON.stringify(await ids(P.M2)) === `[${A}]`, 'quien pidió lo ve');
ok((await ids(P.M4)).includes(A) && (await ids(P.M5)).includes(A), 'las personas de Redacción (de cualquier distrito, pedido «a todo el equipo») lo ven abierto');
ok(!(await ids(P.M1)).includes(A) && !(await ids(P.M3)).includes(A), 'quien NO tiene el rol (Fotografía) no lo ve, aunque sea del mismo distrito');
ok((await ids(P.ADMIN)).includes(A), 'la administración ve todo');
ok((await ids(P.SEC1)).includes(A), 'la secretaría del distrito de quien pidió (08-01) lo ve aunque no tenga el rol');
await as(null, 'anon'); await rejects(`SELECT * FROM ayuda_pedidos`, 'permission denied', 'anon no lee la tabla'); await root();
await as(P.M2);
await rejects(`INSERT INTO ayuda_pedidos(gestion_id,titulo,rol_id,solicitante_id) VALUES (${X.G},'Directo',${REDA},'${P.M2}')`, 'permission denied', 'no se puede insertar directo en la tabla');
await rejects(`UPDATE ayuda_pedidos SET estado='resuelta' WHERE id=${A}`, 'permission denied', 'no se puede actualizar directo (todo pasa por las funciones)');
await rejects(`DELETE FROM ayuda_pedidos WHERE id=${A}`, 'permission denied', 'no se puede borrar directo');
await rejects(`INSERT INTO ayuda_eventos(pedido_id,tipo) VALUES (${A},'creada')`, 'permission denied', 'el historial no se escribe desde el cliente');
await root();
// Pedido de distrito: solo ven el rol del MISMO distrito.
const D = await crearP(P.M1, 'Fotos del taller del distrito', REDA, { alc: 'distrito' });
ok((await ids(P.M5)).includes(D) && !(await ids(P.M4)).includes(D), 'pedido «solo mi distrito»: lo ve Redacción de 08-01 (M5) y NO Redacción de 08-02 (M4)');
ok((await ids(P.SEC1)).includes(D) && !(await ids(P.SEC2)).includes(D), 'la secretaría ve los pedidos de SU distrito y no los de otro');
// El historial sigue la visibilidad del pedido.
await as(P.M4); ok((await q(`SELECT count(*)::int n FROM ayuda_eventos WHERE pedido_id=${D}`))[0].n === 0, 'M4 no ve el historial de un pedido que no ve'); await root();
await as(P.M5); ok((await q(`SELECT count(*)::int n FROM ayuda_historial(${D})`))[0].n === 1 && (await q(`SELECT count(*)::int n FROM ayuda_historial(${A})`))[0].n === 1, 'ayuda_historial devuelve lo del pedido visible'); await root();
await as(P.M3); ok((await q(`SELECT count(*)::int n FROM ayuda_historial(${A})`))[0].n === 0, 'ayuda_historial no devuelve nada de un pedido que no se ve'); await root();

console.log('\n[ayuda_listar: nombres y puedo_tomar]');
await as(P.M5);
const lst = await q(`SELECT id::int, solicitante_nombre, rol_nombre, puedo_tomar FROM ayuda_listar() ORDER BY id`);
ok(lst.length === 2 && lst.every(x => x.puedo_tomar === true && x.rol_nombre === 'Redacción') && lst.find(x => x.id === A).solicitante_nombre === 'M2', 'M5 ve 2 pedidos con nombre de quien pidió y puede tomarlos');
await root();
await as(P.ADMIN);
ok((await q(`SELECT count(*)::int n FROM ayuda_listar() WHERE puedo_tomar`))[0].n === 0, 'la administración ve todo pero no «puede tomar» (no tiene el rol)');
await root();
await as(null, 'anon'); await rejects(`SELECT * FROM ayuda_listar()`, 'permission denied', 'anon no puede listar'); await root();

console.log('\n[avisos al crear]');
const av1 = await avisos(`ref_id='${A}'`);
ok(av1.length === 4 && av1.every(x => x.tipo === 'ayuda_solicitada' && x.ref_tipo === 'ayuda') && [P.M4, P.M5, P.SEC1, P.SEC2].every(u => av1.some(x => x.d === u)), 'ayuda_solicitada llega a las 4 personas con el rol Redacción (M4, M5 y las dos secretarías, que también lo tienen)');
const dsts = av1.map(x => x.d).sort();
ok(!dsts.includes(P.M2) && !dsts.includes(P.M1) && !dsts.includes(P.M3), 'no se avisa a quien pidió ni a quienes no tienen el rol');
ok(dsts.includes(P.SEC1) && dsts.includes(P.SEC2), 'la secretaría con el rol también recibe el aviso (SEC1 y SEC2 son de Redacción en esta base)');
const d1 = av1[0].datos;
ok(d1.titulo === 'Cobertura del acto cívico' && d1.solicitante === 'M2' && d1.rol === 'Redacción' && d1.prioridad === 'alta' && d1.fecha_limite && !('descripcion' in d1) && !JSON.stringify(d1).includes('antes del viernes'), 'el aviso lleva título, quién, rol, prioridad y fecha — NUNCA la descripción');
const avD = await avisos(`ref_id='${D}'`);
ok(avD.map(x => x.d).sort().join() === [P.M5, P.SEC1].sort().join(), 'pedido de distrito: el aviso llega solo a Redacción de 08-01 (M5 y SEC1)');
ok((await q(`SELECT count(*)::int n FROM notificaciones_eventos WHERE evento='rechazado'`))[0].n === 0, 'ninguna emisión fue rechazada por el catálogo');

console.log('\n[tomar: permisos]');
await as(P.M1); await rejects(`SELECT public.ayuda_tomar(${A})`, 'no existe o no puedes verla', 'quien NO tiene el rol no puede tomarla (ni siquiera la ve)'); await root();
await as(P.M2); await rejects(`SELECT public.ayuda_tomar(${A})`, 'otro rol|propia', 'quien pidió no puede tomar su propia solicitud'); await root();
await as(P.M4); await rejects(`SELECT public.ayuda_tomar(${D})`, 'no existe o no puedes verla', 'Redacción de otro distrito no toma un pedido de distrito'); await root();
await as(null, 'anon'); await rejects(`SELECT public.ayuda_tomar(${A})`, 'permission denied', 'anon no toma'); await root();
await as(P.M5); await rejects(`SELECT public.ayuda_tomar(999999)`, 'no existe', 'una solicitud inexistente se rechaza'); await root();

console.log('\n[tomar: atómico, una sola persona (la carrera)]');
// Dos personas con el rol intentan tomarla «a la vez». PGlite atiende una consulta cada vez, así que se prueba el efecto: la sentencia es condicional
// (WHERE estado='abierta'): la primera gana, la segunda NO actualiza nada y recibe un mensaje claro; queda exactamente una tomada_por.
const res = [];
for (const u of [P.M4, P.M5]) { try { await as(u); await db.exec(`SELECT public.ayuda_tomar(${A})`); res.push({ u, ok: true }); } catch (e) { res.push({ u, ok: false, e: e.message }); } }
await root();
ok(res.filter(x => x.ok).length === 1 && res.filter(x => !x.ok).length === 1, 'exactamente UNA toma tiene éxito');
const perdio = res.find(x => !x.ok);
ok(/Ya la tomó alguien más/.test(perdio.e), 'quien llega segunda recibe «Ya la tomó alguien más»');
const gan = res.find(x => x.ok).u;
ok((await estado(A)).estado === 'tomada' && (await estado(A)).tomada_por === gan, 'la solicitud queda tomada por quien ganó (' + gan.slice(-2) + ')');
ok((await q(`SELECT count(*)::int n FROM ayuda_eventos WHERE pedido_id=${A} AND tipo='tomada'`))[0].n === 1, 'un solo evento «tomada» en el historial');
// El segundo intento de la MISMA persona también falla (no se «retoma»).
await as(gan); await rejects(`SELECT public.ayuda_tomar(${A})`, 'Ya la tomó', 'repetir la toma no hace nada raro'); await root();
// Con un UPDATE condicional contra una fila que ya no está abierta, no hay filas afectadas (la propiedad que da la atomicidad en Postgres real).
ok((await db.query(`UPDATE ayuda_pedidos SET tomada_por='${P.M4}' WHERE id=${A} AND estado='abierta'`)).affectedRows === 0, 'el UPDATE condicional sobre una fila ya tomada no afecta ninguna fila');
const otro = gan === P.M4 ? P.M5 : P.M4;

console.log('\n[tomada: quién la ve y los avisos]');
ok(!(await ids(otro)).includes(A), 'quien no la tomó ya no la ve en su bandeja de «abiertas»');
ok((await ids(gan)).includes(A), 'quien la tomó la ve');
const avT = await avisos(`tipo='ayuda_tomada'`);
ok(avT.length === 1 && avT[0].d === P.M2 && avT[0].datos.persona === (gan === P.M4 ? 'M4' : 'M5') && avT[0].ref_id === String(A), 'ayuda_tomada llega a quien pidió, con el nombre de quien tomó');

console.log('\n[resolver / confirmar / reabrir]');
await as(otro); await rejects(`SELECT public.ayuda_resolver(${A}, 'x')`, 'no existe o no puedes verla|Solo quien la tom', 'quien no la tomó no la resuelve'); await root();
await as(P.M2); await rejects(`SELECT public.ayuda_resolver(${A}, 'x')`, 'Solo quien la tom', 'quien pidió no la marca resuelta'); await root();
await as(P.M2); await rejects(`SELECT public.ayuda_confirmar(${A})`, 'ya está resuelta', 'no se confirma lo que no está resuelto'); await root();
await as(gan); await allowed(`SELECT public.ayuda_resolver(${A}, 'Listo, texto enviado por correo')`, 'quien la tomó la marca resuelta'); await root();
ok((await estado(A)).estado === 'resuelta' && (await estado(A)).confirmada_en === null, 'queda «resuelta», sin confirmar');
const avR = await avisos(`tipo='ayuda_resuelta'`);
ok(avR.length === 1 && avR[0].d === P.M2 && !JSON.stringify(avR[0].datos).includes('texto enviado'), 'ayuda_resuelta llega a quien pidió y NO lleva la nota');
await as(gan); await rejects(`SELECT public.ayuda_confirmar(${A})`, 'Solo quien pidió', 'quien resolvió no se confirma a sí mismo'); await root();
await as(P.M2); await rejects(`SELECT public.ayuda_reabrir(${A}, '')`, 'qué falta', 'reabrir exige una nota'); await root();
await as(P.M2); await allowed(`SELECT public.ayuda_reabrir(${A}, 'Falta el último párrafo')`, 'quien pidió la reabre con una nota'); await root();
ok((await estado(A)).estado === 'tomada' && (await estado(A)).tomada_por === gan, 'reabierta vuelve a «tomada» con la misma persona');
const avB = await avisos(`tipo='ayuda_reabierta'`);
ok(avB.length === 1 && avB[0].d === gan && !JSON.stringify(avB[0].datos).includes('último párrafo'), 'ayuda_reabierta llega a quien tomó (sin la nota)');
await as(gan); await allowed(`SELECT public.ayuda_resolver(${A}, 'Ya está el párrafo')`, 'se resuelve de nuevo'); await root();
await as(P.M2); await allowed(`SELECT public.ayuda_confirmar(${A})`, 'quien pidió la confirma'); await allowed(`SELECT public.ayuda_confirmar(${A})`, 'confirmar dos veces no falla (idempotente)'); await root();
ok((await estado(A)).confirmada_en !== null && (await estado(A)).estado === 'resuelta', 'queda resuelta y confirmada');
await as(P.M2); await rejects(`SELECT public.ayuda_cancelar(${A})`, 'abierta o tomada', 'una resuelta no se cancela'); await root();
ok((await avisos(`tipo='ayuda_resuelta'`)).length === 2, 'la segunda resolución es un hecho nuevo: avisa otra vez (sin duplicar la primera)');

console.log('\n[soltar y volver a abrir al rol]');
const B = await crearP(P.M1, 'Retoque de fotos del escudo', REDA, { pri: 'baja' });
await as(P.M5); await db.exec(`SELECT public.ayuda_tomar(${B})`); await root();
await as(P.M4); await rejects(`SELECT public.ayuda_soltar(${B})`, 'no existe o no puedes verla|Solo quien la tom', 'otra persona no puede soltar lo que tomó M5'); await root();
await as(P.M5); await allowed(`SELECT public.ayuda_soltar(${B}, 'No me alcanza el tiempo')`, 'quien la tomó la suelta'); await root();
ok((await estado(B)).estado === 'abierta' && (await estado(B)).tomada_por === null, 'vuelve a abierta y sin dueña');
ok((await ids(P.M4)).includes(B), 'el rol vuelve a verla');
await as(P.M4); await allowed(`SELECT public.ayuda_tomar(${B})`, 'otra persona del rol puede tomarla'); await root();

console.log('\n[cancelar]');
const C = await crearP(P.M1, 'Fotos para el boletín', REDA);
await as(P.M2); await rejects(`SELECT public.ayuda_cancelar(${C})`, 'no existe o no puedes verla|Solo quien pidió', 'otra persona no cancela lo ajeno'); await root();
await as(P.M5); await db.exec(`SELECT public.ayuda_tomar(${C})`); await root();
await as(P.M5); await rejects(`SELECT public.ayuda_cancelar(${C})`, 'Solo quien pidió', 'quien la tomó no la cancela (la suelta)'); await root();
await as(P.M1); await allowed(`SELECT public.ayuda_cancelar(${C}, 'Ya no hace falta')`, 'quien pidió la cancela'); await root();
ok((await estado(C)).estado === 'cancelada', 'queda cancelada');
const avC = await avisos(`tipo='ayuda_cancelada' AND ref_id='${C}'`);
ok(avC.length === 1 && avC[0].d === P.M5 && !JSON.stringify(avC[0].datos).includes('Ya no hace falta'), 'ayuda_cancelada llega a quien la había tomado (no a quien canceló) y sin la nota');
await as(P.M5); await rejects(`SELECT public.ayuda_tomar(${C})`, 'no está abierta|no existe', 'una cancelada ya no se toma'); await root();
// Un abierto cancelado no avisa a nadie (no hay quien la tenga).
const C2 = await crearP(P.M1, 'Pedido que se cancela abierto', REDA);
await as(P.M1); await db.exec(`SELECT public.ayuda_cancelar(${C2})`); await root();
ok((await avisos(`tipo='ayuda_cancelada' AND ref_id='${C2}'`)).length === 0, 'cancelar una solicitud que nadie tomó no avisa a nadie');

console.log('\n[administración: ver todo, reasignar, cerrar]');
const E = await crearP(P.M3, 'Diseño del afiche', REDA, { alc: 'distrito' });   // M3 es de 08-02: lo ve Redacción 08-02 (M4)
await as(P.M2); await rejects(`SELECT public.ayuda_reasignar(${E}, '${P.M4}')`, 'Solo la administración', 'un miembro no reasigna'); await root();
await as(P.SEC1); await rejects(`SELECT public.ayuda_reasignar(${E}, '${P.M4}')`, 'Solo la administración', 'la secretaría no reasigna'); await root();
await as(P.ADMIN); await rejects(`SELECT public.ayuda_reasignar(${E}, '${P.M1}')`, 'no tiene el rol', 'se reasigna solo a quien tiene el rol'); await root();
await as(P.ADMIN); await rejects(`SELECT public.ayuda_reasignar(${E}, '${P.M3}')`, 'no tiene el rol|quien la pidió', 'no se asigna a quien pidió'); await root();
ok((await ids(P.ADMIN)).includes(E), 'la administración ve el pedido de distrito de otro distrito');
await as(P.ADMIN);
const cand = await q(`SELECT id FROM ayuda_candidatas(${E})`);
ok(cand.some(x => x.id === P.M4) && !cand.some(x => x.id === P.M1), 'ayuda_candidatas lista a quienes tienen el rol (M4) y no a los que no');
await allowed(`SELECT public.ayuda_reasignar(${E}, '${P.M5}', 'M4 está de viaje')`, 'la administración reasigna a una persona del rol (aunque sea de otro distrito)');
await root();
ok((await estado(E)).estado === 'tomada' && (await estado(E)).tomada_por === P.M5, 'queda tomada por la persona asignada');
const avE = await avisos(`ref_id='${E}' AND tipo IN ('ayuda_tomada','ayuda_solicitada') AND destinatario_id IN ('${P.M5}','${P.M3}')`);
ok(avE.some(x => x.tipo === 'ayuda_solicitada' && x.d === P.M5) && avE.some(x => x.tipo === 'ayuda_tomada' && x.d === P.M3), 'se avisa a la persona asignada (le piden ayuda) y a quien pidió (ya la tomó alguien)');
await as(P.ADMIN); await allowed(`SELECT public.ayuda_resolver(${E}, 'Cerrado por administración')`, 'la administración puede marcarla resuelta'); await allowed(`SELECT public.ayuda_confirmar(${E})`, 'y confirmarla'); await root();
const F = await crearP(P.M2, 'Pedido para cerrar', REDA);
await as(P.ADMIN); await allowed(`SELECT public.ayuda_cancelar(${F}, 'Duplicado')`, 'la administración cancela cualquier solicitud abierta'); await root();
ok((await avisos(`tipo='ayuda_cancelada' AND ref_id='${F}'`)).map(x => x.d).join() === P.M2, 'si cancela la administración, se avisa a quien pidió');

console.log('\n[segundo rol (0062): quien lo tiene también puede tomar]');
await db.exec(`INSERT INTO persona_roles(persona_id, rol_id) VALUES ('${P.M1}', ${REDA})`);
const G2 = await crearP(P.M2, 'Redactar la nota de prensa', REDA);
ok((await ids(P.M1)).includes(G2), 'M1 (Fotografía + segundo rol Redacción) ve los pedidos de Redacción');
ok((await avisos(`ref_id='${G2}'`)).some(x => x.d === P.M1), 'y se le avisa');
await as(P.M1); await allowed(`SELECT public.ayuda_tomar(${G2})`, 'M1 toma una solicitud de su SEGUNDO rol'); await root();
const H = await crearP(P.M2, 'Fotos del evento', FOTO);
await as(P.M1); await allowed(`SELECT public.ayuda_tomar(${H})`, 'y las de su rol principal'); await root();

console.log('\n[límite de solicitudes en curso]');
await db.exec(`UPDATE profiles SET distrito='08-01' WHERE id='${P.M3}'`);
let lim = 0; try { for (let i = 0; i < 12; i++) { await crearP(P.M5, 'Pedido de relleno ' + i, FOTO); lim++; } } catch (e) { /* esperado */ }
await root();
ok(lim === 10 || lim === 9, 'una persona no acumula más de 10 solicitudes en curso (' + lim + ' creadas antes de rechazar)');

console.log('\n[historial append-only]');
await rejects(`UPDATE ayuda_eventos SET nota='manipulada' WHERE pedido_id=${A}`, 'no se modifica', 'ni el dueño modifica un evento (trigger)');
await as(P.ADMIN);
await rejects(`UPDATE ayuda_eventos SET nota='x'`, 'permission denied', 'la administración tampoco puede modificar el historial desde el cliente');
await rejects(`DELETE FROM ayuda_eventos`, 'permission denied', 'ni borrarlo');
await root();
const evA = (await q(`SELECT tipo FROM ayuda_eventos WHERE pedido_id=${A} ORDER BY id`)).map(x => x.tipo).join();
ok(evA === 'creada,tomada,resuelta,reabierta,resuelta,confirmada', 'el historial cuenta toda la historia en orden: ' + evA);

console.log('\n[auditoría global]');
const au = await q(`SELECT accion, objeto, resumen, antes, despues FROM auditoria_global WHERE origen='Ayuda' ORDER BY id`);
ok(au.length >= 12 && ['ayuda_creada', 'ayuda_tomada', 'ayuda_soltada', 'ayuda_resuelta', 'ayuda_confirmada', 'ayuda_reabierta', 'ayuda_cancelada', 'ayuda_reasignada'].every(a => au.some(x => x.accion === a)), 'cada tipo de cambio queda en auditoria_global con origen «Ayuda» (' + au.length + ' registros)');
ok(!JSON.stringify(au).includes('antes del viernes') && !JSON.stringify(au).includes('Falta el último párrafo') && !JSON.stringify(au).includes('Ya no hace falta'), 'la auditoría no guarda descripciones ni notas');
await as(P.ADMIN); const lis = await q(`SELECT total::int t, origen FROM auditoria_listar(NULL, NULL, 'Ayuda', NULL, 50, 0)`); await root();
ok(lis.length > 0 && lis.every(x => x.origen === 'Ayuda'), 'auditoria_listar(origen «Ayuda») devuelve estos movimientos a la administración');
await as(P.M2); await rejects(`SELECT * FROM auditoria_listar()`, 'Solo la administracion', 'un miembro no lee la auditoría'); await root();

console.log('\n[funciones: permisos]');
const fnsPublicas = ['ayuda_crear', 'ayuda_tomar', 'ayuda_soltar', 'ayuda_resolver', 'ayuda_confirmar', 'ayuda_reabrir', 'ayuda_cancelar', 'ayuda_reasignar', 'ayuda_listar', 'ayuda_historial', 'ayuda_candidatas'];
const perm = await q(`SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u, p.prosecdef d
                        FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY(ARRAY['${fnsPublicas.join("','")}'])`);
ok(perm.length === fnsPublicas.length && perm.every(x => !x.a && x.u && x.d), `las ${fnsPublicas.length} funciones públicas: SECURITY DEFINER, authenticated sí, anon no`);
const internas = await q(`SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u FROM pg_proc p
                           WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('_ayuda_evento','_ayuda_auditar','_ayuda_avisar','_ayuda_audiencia','_ayuda_nombre','_ayuda_datos','_ayuda_cargar','ayuda_roles_de','ayuda_mi_distrito','ayuda_puede_tomar','ayuda_eventos_inmutable')`);
ok(internas.length === 11 && internas.every(x => !x.a && !x.u), 'las 11 funciones internas no las puede llamar nadie desde el cliente');
await as(P.M2); await rejects(`SELECT public._ayuda_evento(${A}, 'creada', NULL, NULL, NULL, 'x')`, 'permission denied', 'un cliente no puede forjar eventos de historial llamando a la interna'); await root();
await as(P.M2); await rejects(`SELECT public.ayuda_roles_de('${P.M1}')`, 'permission denied', 'ni averiguar los roles de otra persona'); await root();

console.log('\n[sin 0040 ni 0055: la ayuda sigue funcionando]');
const t2 = crear();
await t2.db.exec(`CREATE PUBLICATION supabase_realtime`);
const X2 = await montar(t2, [...CADENA_BASE]);
await t2.db.exec(sql('0058_banco_imagenes.sql'));
await t2.db.exec(m);
ok(true, '0068 se aplica sin 0040 ni 0055 (avisa por NOTICE que no hay catálogo)');
await t2.as(X2.P.M1);
const id2 = (await t2.q(`SELECT public.ayuda_crear('Solo con la base', 'x', ${X2.REDA}) id`))[0].id;
await t2.root(); await t2.as(X2.P.M5);
await t2.db.exec(`SELECT public.ayuda_tomar(${id2})`);
ok((await t2.q(`SELECT estado FROM ayuda_pedidos WHERE id=${id2}`))[0].estado === 'tomada', 'se crea y se toma sin catálogo de avisos ni auditoría (no fallan, simplemente no avisan)');
await t2.root();

fin();
