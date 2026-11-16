// Lado cliente de 0065: nivel de la tarea, tipo de entrega, peso retirado y «quién evalúa mi iniciativa».
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const rd = f => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── API con un SB de mentira ──
const llamadas = [];
let colErr = null, rpcDev = { data: true, error: null };
const SB = {
  from: t => ({
    select: () => ({ limit: async () => ({ error: colErr }) }),
    insert: fila => { llamadas.push(['insert:' + t, fila]); return { select: () => ({ single: async () => ({ data: { id: 1, ...fila }, error: null }) }) }; },
  }),
  rpc: async (n, a) => { llamadas.push([n, a]); return rpcDev; },
};
const ctxApi = vm.createContext({ SB, console, Intl, AbortController, setTimeout, SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'y' });
vm.runInContext(rd('api.js').replace(/^'use strict';/m, '') + '\nglobalThis.__API = API;', ctxApi);
const API = ctxApi.__API;

console.log('[API]');
colErr = { message: 'column tareas.nivel does not exist', code: '42703' };
ok(await API.nivelTareasDisponible() === false, 'sin la columna nivel (0065 sin aplicar) → no disponible, y no se ofrece nada');
API._nivelTareasDisp = null; colErr = null;
ok(await API.nivelTareasDisponible() === true, 'con la columna → disponible');
API._nivelTareasDisp = null; colErr = { message: 'network error', code: '' };
ok(await API.nivelTareasDisponible() === false, 'un error de red no se toma por «disponible»');
API._nivelTareasDisp = null;
llamadas.length = 0;
await API.crearTarea({ periodo_id: 'p', titulo: 'T', asignada_a: 'u' });
ok(!('nivel' in llamadas[0][1]) && !('tipo_entrega' in llamadas[0][1]) && !('peso' in llamadas[0][1]), 'crearTarea sin nivel ni tipo no manda columnas nuevas (la base anterior no las conoce)');
llamadas.length = 0;
await API.crearTarea({ periodo_id: 'p', titulo: 'T', asignada_a: 'u', nivel: 'distrital', tipo_entrega: 'video' });
ok(llamadas[0][1].nivel === 'distrital' && llamadas[0][1].tipo_entrega === 'video', 'crearTarea manda nivel y tipo cuando la pantalla los eligió');
llamadas.length = 0;
await API.crearTareaEquipo({ equipo_id: 1, titulo: 'E', nivel: 'regional', peso: 5 });
ok(!('peso' in llamadas[0][1]) && llamadas[0][1].nivel === 'regional', 'crearTareaEquipo ya no manda peso');
ok(await API.instanciaDistritalDisponible() === true, 'instanciaDistritalDisponible lee mi_instancia_distrital_disponible()');
rpcDev = { data: null, error: { message: 'Could not find the function' } };
ok(await API.instanciaDistritalDisponible() === false, 'sin la función, no se ofrece «Distrital»');
rpcDev = { data: true, error: null };
llamadas.length = 0;
await API.guardarCalifConfig('p', { peso_tareas: 20, mult_individual: 1, mult_colectiva: 1, minimo_tareas: 1, contar_propias: true, vencidas_como_cero: false, sin_tareas_pierde_puntos: false, mult_distrital: 1, mult_regional: 2 }, 'motivo largo');
const g = llamadas.find(l => l[0] === 'calif_config_guardar')[1];
ok(g.p_mult_distrital === 1 && g.p_mult_regional === 2 && g.p_sin_tareas_pierde_puntos === false, 'guardarCalifConfig manda los multiplicadores por nivel cuando la base los trae');
llamadas.length = 0;
await API.guardarCalifConfig('p', { peso_tareas: 20, mult_individual: 1, mult_colectiva: 1, minimo_tareas: 1, contar_propias: true, vencidas_como_cero: false }, null);
const g2 = llamadas.find(l => l[0] === 'calif_config_guardar')[1];
ok(!('p_mult_distrital' in g2) && !('p_mult_regional' in g2), 'sin 0065 (config sin mult_distrital) no manda parámetros que la función no conoce');

// ── core/tareas.js: ayudantes ──
const ctxT = vm.createContext({ escHtml: esc, textoLargoHTML: (t, o = {}) => `<p class="${o.clase || "tk-desc"}">${esc(String(t || ""))}</p>`, console, document: { body: { classList: { contains: () => false } } }, Store: { get: () => [] }, API: {} });
vm.runInContext(rd('core/tareas.js').replace(/^'use strict';/m, '') + '\nglobalThis.__T = Tareas;', ctxT);
const T = ctxT.__T;

console.log('\n[tipo de entrega]');
ok(T.tipoSugerido('https://www.youtube.com/watch?v=1') === 'video' && T.tipoSugerido('https://x.com/a.png') === 'imagen' && T.tipoSugerido('https://docs.google.com/document/d/1') === 'documento' && T.tipoSugerido('https://drive.example/carpeta') === 'enlace' && T.tipoSugerido('') === '', 'el tipo se sugiere según el enlace (video, imagen, documento, enlace)');
const h1 = T.entregaHTML({ entrega_url: 'https://y.be/1', tipo_entrega: 'video', entrega_nota: 'Corte final' });
ok(/tk-tag--tipo[^>]*>Video</.test(h1) && /Corte final/.test(h1) && !/href=/.test(h1) && T.enlaceTxt({ tipo_entrega: 'video' }) === 'Ver video', 'la entrega muestra su tipo y su nota; el enlace es el botón de acción «Ver video» de la tarjeta');
ok(T.enlaceTxt({ tipo_entrega: 'documento' }) === 'Abrir documento' && T.enlaceTxt({ tipo_entrega: 'imagen' }) === 'Ver imagen', 'documento → «Abrir documento»; imagen → «Ver imagen»');
ok(T.enlaceTxt({}) === 'Abrir enlace' && !/tk-tag--tipo/.test(T.entregaHTML({ entrega_url: 'https://d/3' })), 'una entrega anterior sin tipo no inventa etiqueta');
ok(!/<img|<script/.test(T.entregaHTML({ entrega_url: 'https://d/"><script>', tipo_entrega: 'otro', entrega_nota: '<img src=x>' })), 'el enlace y la nota se escapan (nada humano llega sin escapar)');
ok(T.entregaHTML({}) === '', 'sin entrega no se pinta nada');

console.log('\n[quién puede revisar una iniciativa]');
const sec = { revisor: true, esAdmin: false, yo: 'sec' }, adm = { revisor: true, esAdmin: true, yo: 'adm' }, mie = { revisor: false, esAdmin: false, yo: 'm' };
const dist = { asignada_a: 'm', origen: 'propia', nivel: 'distrital' }, reg = { asignada_a: 'm', origen: 'propia', nivel: 'regional' }, asg = { asignada_a: 'm', origen: 'asignada', nivel: 'regional' };
ok(T.puedeRevisar(dist, sec) && !T.puedeRevisar(reg, sec), 'la secretaría revisa la iniciativa distrital y NO la regional');
ok(T.puedeRevisar(asg, sec), 'la secretaría sigue revisando tareas asignadas, sea cual sea su nivel');
ok(T.puedeRevisar(reg, adm) && T.puedeRevisar(dist, adm), 'la administración revisa ambas');
ok(!T.puedeRevisar(dist, mie), 'un miembro no revisa');
ok(!T.puedeRevisar({ asignada_a: 'sec', origen: 'propia', nivel: 'regional' }, sec), 'nadie revisa lo propio');

console.log('\n[el peso se retiró de las pantallas]');
const tareas = rd('core/tareas.js'), equipos = rd('core/equipos.js'), asignar = rd('core/asignar.js'), perfil = rd('core/evaluacion-perfil.js');
ok(!/id: 'peso'/.test(tareas) && !/id: 'peso'/.test(equipos), 'aprobar, crear y editar tareas (individuales y de equipo) ya no piden «peso»');
ok(!/peso: Number\(v\.peso\)|patch\.peso/.test(tareas + equipos), 'ningún formulario envía peso');
ok(/id: 'nivel'.*¿Quién te evalúa\?/s.test(tareas) && /Distrital: la secretaría de mi distrito/.test(tareas) && /Regional: la administración/.test(tareas), 'la iniciativa pregunta «¿Quién te evalúa?» con Distrital / Regional');
ok(/c\.distritalOk \? \[\{ v: 'distrital'/.test(tareas), '«Distrital» solo se ofrece si la persona tiene secretaría de distrito');
ok(/campo\('nivel'/.test(asignar) && /E\.c\.esAdmin \? campo\('nivel'/.test(asignar) && /nivel: E\.c\.esAdmin \? E\.datos\.nivel : 'distrital'/.test(asignar), 'el asistente de asignar deja elegir el nivel solo a la administración (la secretaría siempre distrital)');
ok(/num\('md'/.test(perfil) && /num\('mr'/.test(perfil) && /Ya no se elige un peso al aprobar/.test(perfil), 'Reglas de calificación: multiplicadores por nivel y la fórmula explica que ya no hay peso al aprobar');
ok(/typeof c\.mult_distrital === 'number'/.test(rd('api.js')) && /c\.mult_distrital != null/.test(perfil), 'las reglas por nivel dependen de que la base ya las tenga (0065)');
ok(!/\bon(click|input|change|submit)\s*=/.test(tareas + equipos + asignar + perfil), 'sin handlers inline (CSP)');

console.log('\n[migración y registro]');
const mig = rd('supabase/migrations/0065_tareas_nivel_tipo_entrega.sql');
ok(/CHECK \(nivel IN \('distrital', 'regional'\)\)/.test(mig) && /tipo_entrega IN \('enlace', 'documento', 'imagen', 'video', 'otro'\)/.test(mig), 'la migración impone nivel y tipo de entrega con CHECK');
ok(/REVOKE EXECUTE ON FUNCTION public\.puede_revisar_tarea_fila/.test(mig) && /GRANT  EXECUTE ON FUNCTION public\.puede_revisar_tarea_fila/.test(mig) && /REVERSA/.test(mig), 'la migración revoca/concede y trae su reversa');
ok(/0065/.test(rd('docs/auditoria/06-registro-migraciones.md')), 'el registro de migraciones menciona 0065');
ok(/sql-0065\.mjs/.test(rd('tools/pruebas/package.json')) && /front-nivel\.mjs/.test(rd('tools/pruebas/package.json')), 'package.json corre sql-0065 y front-nivel');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
