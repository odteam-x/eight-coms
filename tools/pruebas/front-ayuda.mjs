// Lado cliente de 0068 («Pedir ayuda»): API, cableado en los tres portales, avisos (campana y correo), tiempo real, simulador y reglas de diseño.
// Lo que prueba el NAVEGADOR (flujo completo en admin, secretaría y miembro, celular) está en ui/flujo-ayuda.mjs; la base, en sql-0068.mjs.
import fs from 'node:fs';
import vm from 'node:vm';
const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rd = f => fs.readFileSync(ROOT + f, 'utf8').split('\r\n').join('\n');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };

console.log('[API]');
const llamadas = []; let respuesta = { data: null, error: null };
const SB = { rpc: async (n, a) => { llamadas.push([n, a]); return respuesta; }, from: () => ({}) };
const ctx = vm.createContext({ SB, console, Intl, AbortController, setTimeout, SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'y' });
vm.runInContext(rd('api.js').replace(/^'use strict';/m, '') + '\nglobalThis.__API = API;', ctx);
const API = ctx.__API;
await API.ayudaCrear({ titulo: 'Fotos', descripcion: 'x', rol_id: 2, prioridad: 'alta', fecha_limite: '2026-12-01', enlace: 'https://a.b', alcance: 'distrito' });
ok(llamadas[0][0] === 'ayuda_crear' && JSON.stringify(Object.keys(llamadas[0][1])) === '["p_titulo","p_descripcion","p_rol_id","p_prioridad","p_fecha_limite","p_enlace","p_alcance"]', 'ayudaCrear llama a ayuda_crear con los 7 parámetros de la base');
ok(!('solicitante_id' in llamadas[0][1]) && !('distrito' in llamadas[0][1]) && !('gestion_id' in llamadas[0][1]), 'el cliente NO manda autor, distrito ni gestión (los fija el servidor)');
llamadas.length = 0;
await API.ayudaAccion('tomar', 5); await API.ayudaAccion('confirmar', 5); await API.ayudaAccion('resolver', 5, 'nota'); await API.ayudaAccion('reabrir', 5, 'falta'); await API.ayudaAccion('soltar', 5); await API.ayudaAccion('cancelar', 5, 'x');
ok(llamadas.map(l => l[0]).join() === 'ayuda_tomar,ayuda_confirmar,ayuda_resolver,ayuda_reabrir,ayuda_soltar,ayuda_cancelar', 'cada acción llama a su función');
ok(!('p_nota' in llamadas[0][1]) && !('p_nota' in llamadas[1][1]) && llamadas[2][1].p_nota === 'nota', 'tomar y confirmar no llevan nota; resolver sí');
llamadas.length = 0;
const mala = await API.ayudaAccion('borrar_todo', 1);
ok(mala.ok === false && llamadas.length === 0, 'una acción fuera de la lista blanca no llega a la base');
respuesta = { data: null, error: { message: 'Ya la tomó alguien más.' } };
const r = await API.ayudaAccion('tomar', 5);
ok(r.ok === false && r.error === 'Ya la tomó alguien más.', 'el mensaje en español de la base llega tal cual a la pantalla');
respuesta = { data: null, error: { message: 'Could not find the function public.ayuda_listar', code: 'PGRST202' } };
ok((await API.ayudaListar()).disponible === false, 'sin 0068: ayudaListar dice «no disponible» (la pantalla explica qué migración falta)');
respuesta = { data: null, error: { message: 'boom' } };
ok((await API.ayudaListar()).disponible === true, 'otro error: disponible, con el error (se muestra con reintento)');

console.log('\n[cableado en los tres portales]');
for (const [h, js, pref] of [['user.html', 'user.js', 'user'], ['secretario.html', 'secretario.js', 'sec'], ['admin.html', 'admin.js', 'admin']]) {
  const H = rd(h), J = rd(js);
  ok(/id="tab-apoyo"/.test(H) && /id="apoyo-host"/.test(H), `${h}: tiene la pestaña y su contenedor`);
  const pos = s => H.indexOf(`src="${s}"`);
  ok(pos('core/apoyo.js') > pos('core/render.js') && pos('core/apoyo.js') > 0 && pos('core/apoyo.js') < pos('core/notificaciones.js'), `${h}: core/apoyo.js carga tras render.js y antes de notificaciones.js (el abridor se registra al terminar de cargar; Tareas.abrirModal se usa solo al pulsar)`);
  ok(/href="apoyo\.css"/.test(H) && H.indexOf('apoyo.css') > H.indexOf('vidrio.css'), `${h}: apoyo.css carga después de vidrio.css`);
  ok(/tab:'apoyo',\s+icono:'heart',\s+etiqueta:'Pedir ayuda'/.test(J), `${js}: destino «Pedir ayuda» en el menú (rail y barra inferior / «Más»)`);
  ok(/Apoyo\.montar\(/.test(J), `${js}: monta la pantalla al abrir la pestaña`);
  ok(new RegExp(`['"]${pref}:apoyo['"]|id: '${pref}:apoyo'|v\\('apoyo'`).test(J) && /Sync\.on\(\['apoyo'\]|v\('apoyo',\s+\['apoyo'\]/.test(J), `${js}: se registra en Sync (tema «apoyo», solo cuando se ve)`);
  ok(/apoyo\s*:\s*'apoyo'/.test(J), `${js}: la pestaña está en el mapa de padres del menú`);
}
ok(/apoyo:\s+\(a, el\) => Apoyo\.accion/.test(rd('config.js')), 'config.js: la acción «apoyo» está en la lista blanca del despachador');
ok(/Apoyo\.montar\(.*esAdmin: true/.test(rd('admin.js')) && /esSec: isSecretario\(\)/.test(rd('secretario.js')), 'cada portal dice quién es: administración / secretaría / miembro');

console.log('\n[tiempo real]');
const syncJs = rd('core/sync.js');
const sctx = vm.createContext({ console, setTimeout, clearTimeout, Promise, Date, Math, JSON, Object, Array, Set, Map, window: {}, document: {} });
vm.runInContext(syncJs + '\nglobalThis.__S = Sync;', sctx);
const mapa = sctx.__S.mapa();
ok(mapa.ayuda_pedidos && mapa.ayuda_pedidos.temas.includes('apoyo') && !mapa.ayuda_pedidos.solo, 'Sync escucha ayuda_pedidos y la deriva al tema «apoyo» (para todas las personas, no solo administración)');
ok(!('ayuda_eventos' in mapa), 'el historial no se publica ni se escucha (se pide al abrirlo)');
const mig = rd('supabase/migrations/0068_solicito_ayuda.sql');
ok(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.ayuda_pedidos/.test(mig) && /ENABLE ROW LEVEL SECURITY/.test(mig), '0068 publica ayuda_pedidos con RLS activa');
const apoyo = rd('core/apoyo.js');
ok(/pintarTabs\(\);\s*\n\s*if \(S\.tab !== 'pedir'\) pintarLista\(\)/.test(apoyo), 'un evento de Realtime repinta solo las listas y las pestañas: el formulario no se toca (no se pierde lo escrito)');

console.log('\n[avisos: campana y correo]');
const tipos = ['ayuda_solicitada', 'ayuda_tomada', 'ayuda_resuelta', 'ayuda_cancelada', 'ayuda_reabierta'];
const notif = rd('core/notificaciones.js');
ok(tipos.every(t => new RegExp(`\\b${t}:\\s+\\{ icono`).test(notif)), 'la campana sabe mostrar los 5 tipos');
ok(tipos.every(t => (notif.match(new RegExp(`${t}: 'apoyo'`, 'g')) || []).length === 3), 'los 5 tipos llevan a la pestaña «apoyo» en los tres portales (miembro, secretaría, administración)');
ok(/^[a-z_]{1,32}$/.test('apoyo') && /ayuda_/.test(notif.match(/_cat = [\s\S]*?: 'cuenta'/)[0]), 'el destino «apoyo» cumple el patrón de los enlaces de correo y la categoría de respaldo reconoce ayuda_*');
const pl = await import(ROOT.replace(/^[A-Za-z]:/, m => 'file:///' + m) + 'supabase/functions/enviar-notificaciones/plantillas.mjs');
ok(tipos.every(t => pl.AVISOS[t] && pl.AVISOS[t].etiqueta === 'Tareas'), 'los 5 tipos tienen plantilla de correo (categoría «Tareas»)');
const catalogo = mig.match(/\[CATALOGO-AVISOS-INICIO\][\s\S]*?\[CATALOGO-AVISOS-FIN\]/)[0];
ok(tipos.every(t => catalogo.includes(`'${t}'`)), 'la migración da de alta los 5 tipos en notif_tipos');
ok(!/'(descripcion|nota|motivo|enlace)'/.test(catalogo.replace(/'descripcion', 'tareas'/g, '')) && !/ARRAY\[[^\]]*'(descripcion|nota|enlace)'/.test(catalogo), 'ningún tipo deja pasar descripción, nota ni enlace en los datos');
ok(rd('docs/notificaciones-contrato.md').includes('ayuda_solicitada'), 'el contrato de avisos documenta los tipos nuevos');

console.log('\n[auditoría, simulador y reglas de diseño]');
ok(/'Ayuda'\]/.test(rd('core/auditoria.js')) && /ayuda_reasignada/.test(rd('core/auditoria.js')), 'el Centro de auditoría filtra por «Ayuda» y traduce sus acciones');
const fake = rd('tools/pruebas/ui/fake-extra-ayuda.js');
ok(['ayuda_listar', 'ayuda_crear', 'ayuda_tomar', 'ayuda_soltar', 'ayuda_resolver', 'ayuda_confirmar', 'ayuda_reabrir', 'ayuda_cancelar', 'ayuda_reasignar', 'ayuda_historial', 'ayuda_candidatas'].every(f => new RegExp(`${f}:`).test(fake)), 'el simulador implementa las 11 funciones');
const css = rd('apoyo.css');
ok(!/border-(left|right|top|bottom)\s*:\s*[3-9]px\s+solid/.test(css) && !/box-shadow\s*:\s*inset\s+[3-9]px/.test(css), 'apoyo.css: sin barras de acento en bordes');
ok(!/:hover[^{]*\{[^}]*(box-shadow|outline|border-color)/.test(css), 'apoyo.css: el hover no pinta halos ni contornos (solo fondo)');
ok(!/#[0-9a-fA-F]{3,8}\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'apoyo.css: sin colores hex (solo tokens)');
ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(apoyo + css), 'sin emojis');
ok(/font:\s*600 var\(--h3\)/.test(css) && /font:\s*600 var\(--h4\)/.test(css), 'los títulos usan la escala --h3/--h4 de vidrio.css §36');
ok(/min-height:\s*44px/.test(css), 'lo táctil mide 44 px');
ok(!/onclick=|onchange=|oninput=/.test(apoyo) && !/<form/.test(apoyo), 'sin handlers en línea (CSP) y sin <form> (Enter no recarga la página)');
const sinEsc = [...apoyo.matchAll(/\$\{([^}]+)\}/g)].map(m => m[1]).filter(e => /\br\.(titulo|descripcion|solicitante_nombre|tomada_nombre|rol_nombre|distrito|enlace)\b|\be\.(nota|actor_nombre|persona_nombre)\b/.test(e) && !/escHtml|esHttp/.test(e));
ok(sinEsc.length === 0, 'todo texto humano pasa por escHtml' + (sinEsc.length ? ' → sin escapar: ' + sinEsc.join(' | ') : ''));
ok(/rel="noopener noreferrer"/.test(apoyo) && /esHttp\(r\.enlace\)/.test(apoyo), 'el enlace solo se abre si es http(s), con noopener noreferrer');

console.log('\n[documentación y scripts]');
const pkg = JSON.parse(rd('tools/pruebas/package.json'));
ok(/sql-0068\.mjs/.test(pkg.scripts.sql) && /front-ayuda\.mjs/.test(pkg.scripts.front), 'sql-0068 y front-ayuda están en los scripts de npm');
ok(/0068/.test(rd('docs/auditoria/06-registro-migraciones.md')) && /solicito_ayuda/.test(rd('docs/auditoria/06-registro-migraciones.md')), '0068 está en docs/auditoria/06-registro-migraciones.md');
ok(/-- ── REVERSA/.test(mig) && /BEGIN;/.test(mig) && /COMMIT;/.test(mig), '0068: transacción y bloque de reversa');
ok(/Pedir ayuda|Solicito tu ayuda/.test(rd('CLAUDE.md')), 'CLAUDE.md documenta el módulo');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
