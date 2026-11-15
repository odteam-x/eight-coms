// Cableado de la sincronización en tiempo real (core/sync.js) en las tres portales: orden de scripts, CSP, que cada tabla escuchada
// esté publicada por 0062 (y al revés), que cada tema y cada vista que usan los portales EXISTAN (un tema mal escrito nunca dispara y nadie se entera),
// reglas del repositorio (sin onclick, sin hex, sin barras de acento) y que lo que se vio como parpadeo/escritura pisada esté cubierto.
import fs from 'node:fs';
import vm from 'node:vm';
const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rd = f => fs.readFileSync(ROOT + f, 'utf8').split('\r\n').join('\n');   // la copia de trabajo puede tener CRLF (autocrlf)
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };

const syncJs = rd('core/sync.js'), mig = rd('supabase/migrations/0062_sincronizacion_tiempo_real.sql');
const ctx = vm.createContext({ console, setTimeout, clearTimeout, Promise, Date, Math, JSON, Object, Array, Set, Map, window: {}, document: {} });
vm.runInContext(syncJs + '\nglobalThis.__S = Sync;', ctx);
const S = ctx.__S, mapa = S.mapa();
const temasValidos = new Set(Object.values(mapa).flatMap(t => t.temas));
['perfil'].forEach(t => temasValidos.add(t));            // «perfil» también lo emite la revalidación de acceso

console.log('[carga de scripts y CSP]');
for (const [f, idx] of [['admin.html', 'admin.js'], ['user.html', 'user.js'], ['secretario.html', 'secretario.js']]) {
  const h = rd(f), pos = s => h.indexOf(`src="${s}"`);
  ok(pos('core/sync.js') > pos('core/render.js') && pos('core/sync.js') > pos('core/store.js') && pos('core/sync.js') < pos('core/notificaciones.js') && pos('core/sync.js') < pos(idx) && pos('core/sync.js') > 0,
    `${f}: core/sync.js carga tras render.js/store.js y ANTES de notificaciones.js y de ${idx}`);
  ok(/<script defer src="core\/sync\.js"><\/script>/.test(h), `${f}: con defer, como el resto (sin script en línea)`);
}
const vj = JSON.parse(rd('vercel.json'));
const csp = vj.headers.flatMap(h => h.headers).find(h => h.key === 'Content-Security-Policy').value;
ok(/connect-src [^;]*https:\/\/\*\.supabase\.co[^;]*wss:\/\/\*\.supabase\.co/.test(csp), 'CSP: connect-src admite wss://*.supabase.co (el WebSocket de Realtime; «https:» NO cubre «wss:»)');
ok(!/script-src[^;]*unsafe-inline/.test(csp), 'CSP: script-src sigue sin unsafe-inline');
ok(/wss:\/\/\*\.supabase\.co/.test(rd('CLAUDE.md')), 'CLAUDE.md documenta el connect-src con wss');
const verPortales = ['admin.html', 'user.html', 'secretario.html'].map(rd);
ok(verPortales.every(h => !/<script>/.test(h)), 'ningún portal tiene script en línea');
ok(!/core\/sync\.js/.test(rd('index.html')) && !/core\/sync\.js/.test(rd('verificar.html')), 'el login y la verificación pública NO cargan Sync (sin sesión no hay nada que escuchar)');

console.log('\n[tablas: lo que se escucha = lo que 0062 publica]');
const listaSql = [...mig.match(/tablas TEXT\[\] := ARRAY\[([\s\S]*?)\];/)[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
const escuchadas = Object.keys(mapa);
ok(escuchadas.filter(t => !listaSql.includes(t)).length === 0, 'toda tabla que Sync escucha está en la lista de 0062' + (escuchadas.filter(t => !listaSql.includes(t)).length ? ' → faltan: ' + escuchadas.filter(t => !listaSql.includes(t)) : ''));
ok(listaSql.filter(t => !escuchadas.includes(t) && t !== 'profiles').length === 0, 'toda tabla publicada por 0062 la usa alguna vista' + (listaSql.filter(t => !escuchadas.includes(t)).length ? ' → sobran: ' + listaSql.filter(t => !escuchadas.includes(t)) : ''));
const migs = fs.readdirSync(ROOT + 'supabase/migrations').map(f => rd('supabase/migrations/' + f)).join('\n');
const sinCrear = escuchadas.filter(t => t !== 'notif_senal' && !new RegExp(`CREATE TABLE( IF NOT EXISTS)? (public\\.)?${t}\\b`, 'i').test(migs + rd('supabase-schema.sql')));
ok(sinCrear.length === 0, 'cada tabla escuchada existe en alguna migración' + (sinCrear.length ? ' → sin definición en el repo: ' + sinCrear : ''));
ok(!escuchadas.includes('notificaciones') && !escuchadas.includes('gafetes') && !escuchadas.includes('credenciales') && !escuchadas.includes('manuales_privados'),
  'no se escucha notificaciones (cerrada), gafetes, credenciales ni manuales privados');
ok(mapa.auditoria_global.solo === 'admin', 'la auditoría solo se escucha siendo administración');
ok(/REVOKE ALL ON public\.%I FROM anon/.test(mig) && /relrowsecurity/.test(mig) && /indisprimary/.test(mig), '0062: REVOKE a anon, exige RLS activa y clave primaria antes de publicar');
ok(/-- ── REVERSA/.test(mig), '0062 lleva bloque de reversa');
const reg = rd('docs/auditoria/06-registro-migraciones.md');
ok(/0062/.test(reg) && /sincronizacion_tiempo_real/.test(reg), 'registrada en docs/auditoria/06-registro-migraciones.md');
const pkg = JSON.parse(rd('tools/pruebas/package.json'));
ok(/sql-0062\.mjs/.test(pkg.scripts.sql) && /front-sync\.mjs/.test(pkg.scripts.front) && /sync-multisesion\.mjs/.test(pkg.scripts.sync), 'sql-0062, front-sync y sync-multisesion están en los scripts de npm');
ok(/'sync'/.test(rd('tools/pruebas/correr.mjs')), '`npm run todo` incluye el grupo sync');

console.log('\n[temas y vistas que usan los portales existen]');
const portales = { 'admin.js': ['admin.html', /\.atab-content/], 'user.js': ['user.html'], 'secretario.js': ['secretario.html'] };
for (const [js, [html]] of Object.entries(portales)) {
  const src = rd(js), h = rd(html);
  ok(/Sync\.iniciar\(\{ perfil: CU \}\)/.test(src), `${js}: inicia Sync con el perfil de la sesión`);
  ok(/initSync\(\);/.test(src) && !/initRevalidacion/.test(src), `${js}: llama a initSync() y ya no usa la revalidación antigua por visibilitychange`);
  // temas: todo literal entre comillas dentro de initSync / constantes _TEMAS_
  const bloque = src.slice(src.indexOf('const _TEMAS_'), src.indexOf('\n}\n', src.indexOf('function initSync')) + 3);
  const temas = [...new Set([...bloque.replace(/vista: \[[^\]]*\]/g, '').matchAll(/\[((?:'[a-z_]+'(?:,\s*)?)+)\]/g)].flatMap(m => [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1])))];
  const malos = temas.filter(t => !temasValidos.has(t));
  ok(temas.length > 8 && malos.length === 0, `${js}: ${temas.length} temas distintos, todos existen en el mapa de Sync` + (malos.length ? ' → desconocidos: ' + malos : ''));
  // vistas
  const vistas = js === 'admin.js'
    ? [...bloque.matchAll(/\bv\('(\w+)'/g)].map(m => m[1])
    : [...bloque.matchAll(/vista: (?:\[([^\]]+)\]|'([\w-]+)')/g)].flatMap(m => (m[1] ? [...m[1].matchAll(/'([\w-]+)'/g)].map(x => x[1]) : [m[2]]));
  const sinPanel = vistas.filter(v => !new RegExp(`id="tab-${v}"`).test(h));
  ok(vistas.length >= 5 && sinPanel.length === 0, `${js}: ${vistas.length} vistas registradas, todas con su panel #tab-… en ${html}` + (sinPanel.length ? ' → sin panel: ' + sinPanel : ''));
  const ids = [...bloque.matchAll(/id: '([\w:-]+)'/g)].map(m => m[1]);
  ok(new Set(ids).size === ids.length, `${js}: ningún id de registro repetido (un id repetido REEMPLAZA al anterior)`);
}
ok(/if \(typeof Sync !== 'undefined'\) Sync\.tab\(tab\);/.test(rd('core/render.js')), 'switchTabCore avisa a Sync de la vista visible (un único punto para todos los portales)');

console.log('\n[concurrencia y escritura propia]');
const adm = rd('admin.js');
ok(/Sync\.vigilar\('evaluaciones'/.test(adm) && /avisarCambioEval/.test(adm), 'Evaluar vigila la evaluación abierta: si otra persona la cambia o borra, se avisa sin tocar lo escrito');
ok(/function _confirmarSobreCambioAjeno/.test(adm) && /if \(!_confirmarSobreCambioAjeno\(\)\) return;/.test(adm.slice(adm.indexOf('async function saveEvaluacionV2'), adm.indexOf('async function saveEvaluacionV2') + 300)) && /if \(!_confirmarSobreCambioAjeno\(\)\) return;/.test(adm.slice(adm.indexOf('async function saveEvaluacion(estado'), adm.indexOf('async function saveEvaluacion(estado') + 200)),
  'guardar una evaluación (clásica y v2) pide confirmar si otra persona la modificó desde que se abrió: no se sobrescribe en silencio');
ok(/evalRecargar/.test(rd('config.js')) && /data-act="evalRecargar"/.test(adm) && !/onclick/.test(adm.slice(adm.indexOf('function avisarCambioEval'), adm.indexOf('function avisarCambioEval') + 900)), 'el aviso de conflicto actúa por ACCIONES (config.js), sin onclick');
const tk = rd('core/tareas.js');
ok(/mismo = !!\(prev && prev\.el === el/.test(tk) && /filtro: mismo \? prev\.filtro/.test(tk), 'volver a montar la misma lista de tareas conserva el filtro y la persona elegidos');

console.log('\n[sin parpadeos]');
const rn = rd('core/render.js');
ok(/Sync\.silencioso\(\) && cont\.firstElementChild/.test(rn), 'renderCargando no vacía lo que ya se ve durante un refresco en vivo (afecta a todos los módulos que lo usan)');
ok(/Sync\.silencioso\(\)/.test(rd('core/perfil.js')) && /Sync\.silencioso\(\)/.test(rd('core/inicio.js')) && /Sync\.silencioso\(\)/.test(rd('core/calendario.js')) && /Sync\.silencioso\(\)/.test(rd('core/notificaciones.js')), 'perfil, inicio, calendario y avisos no ponen su esqueleto encima en un refresco en vivo');
ok(/Perfil\.refrescarTodos/.test(adm) && /refrescarTodos/.test(rd('core/perfil.js')), 'las fichas de personas abiertas se refrescan conservando pestaña y período');
const nt = rd('core/notificaciones.js');
ok(/Sync\.on\('notificaciones'/.test(nt) && /REFRESCO_SEGURIDAD_MS/.test(nt), 'la campana se mueve por la señal en tiempo real (el reloj queda de red de seguridad, más espaciado)');

console.log('\n[reglas del repositorio]');
const css = rd('sync.css');
ok(!/#[0-9a-fA-F]{3,8}\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'sync.css: sin colores hex (solo tokens de shared.css)');
ok(!/border-(left|right|top|bottom)\s*:\s*[3-9]px/.test(css) && !/inset\s+[1-9]px\s+0\s+0/.test(css), 'sync.css: sin barras de acento en un borde');
ok(!/:hover[^{]*\{[^}]*(box-shadow|outline|border-color)/.test(css), 'sync.css: sin contornos al pasar el ratón');
ok(!/onclick|oninput|onchange/.test(syncJs) && !/<script/.test(syncJs), 'sync.js: nada ejecutable desde el marcado');
const innerSync = [...syncJs.matchAll(/innerHTML\s*=\s*([^;\n]+)/g)].map(m => m[1]);
ok(innerSync.every(x => /^'<span class="sync-punto"[^']*><\/span><span class="sync-txt"><\/span>'$/.test(x.trim())), 'sync.js: su único innerHTML es una plantilla fija (ningún dato humano entra en el marcado)');
ok(/escHtml\(evaluadoId\)/.test(adm), 'el aviso de conflicto escapa el id con escHtml');
ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(syncJs + css), 'sin emojis como indicadores');
ok(/role', 'status'\)/.test(syncJs) && /aria-live', 'polite'/.test(syncJs), 'el indicador de conexión es role=status / aria-live=polite (se anuncia sin interrumpir)');

console.log('\n[documentación]');
const doc = rd('docs/sincronizacion-tiempo-real.md');
ok(/Solicito tu ayuda/.test(doc) && /no existe/i.test(doc), 'el documento dice que «Solicito tu ayuda» no existe en el repositorio');
ok(/No se pudo verificar|NO se pudo verificar|no se puede verificar/i.test(doc) && /publicación/.test(doc), 'el documento dice qué NO se pudo verificar contra la base viva');
ok(/Sync\.on\(/.test(doc) && /Sync\.vigilar/.test(doc), 'el documento explica la API mínima (Sync.on, Sync.vigilar)');
ok(/sincronizacion-tiempo-real/.test(rd('CLAUDE.md')), 'CLAUDE.md apunta al documento');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
