// Pruebas del frontend de las estadísticas de Instagram del distrito (core/estadisticas-distrito.js, 0043).
// Sin navegador: lectura de cifras, formato, que nada humano llegue sin escapar, cableado en las páginas y coherencia con la migración.
// El comportamiento con datos se ve en el simulador (`npm run ui`: secretaría → Distrito → Estadísticas; admin → Distritos).
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const rd = f => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };

const src = rd('core/estadisticas-distrito.js');
const cfg = rd('config.js');
const escSrc = cfg.match(/function escHtml\(s\) \{[\s\S]*?\n\}/)[0];
const ctx = vm.createContext({ console, Intl });
vm.runInContext(escSrc + '\n' + src + '\nthis.ED = EstadisticasDistrito;', ctx);
const ED = ctx.ED;
const C = k => ED.CAMPOS.find(c => c.k === k);

console.log('[leer las cifras: lo que la gente escribe]');
const v = (t, k) => ED.leer(t, C(k));
ok(v('41,937', 'visualizaciones').valor === 41937 && v('41.937', 'visualizaciones').valor === 41937, 'enteros: «41,937» y «41.937» son 41937');
ok(v('1325', 'visitas_perfil').valor === 1325 && v(' 9 251 ', 'cuentas_alcanzadas').valor === 9251, 'enteros sin separador o con espacios');
ok(v('', 'visualizaciones').error && v('abc', 'visualizaciones').error, 'vacío o letras: error que dice qué corregir');
ok(v('-5', 'visualizaciones').error, 'un entero de conteo no puede ser negativo');
ok(v('12,34', 'visualizaciones').error, 'un conteo no admite decimales');
ok(v('+125', 'seguidores_neto').valor === 125 && v('-40', 'seguidores_neto').valor === -40 && v('−40', 'seguidores_neto').valor === -40 && v('1.200', 'seguidores_neto').valor === 1200, 'seguidores netos: «+125», «-40», «−40» (signo menos de Word) y «1.200»');
ok(v('53.7', 'pct_reels').valor === 53.7 && v('53,7', 'pct_reels').valor === 53.7 && v('22,6 %', 'pct_reels').valor === 22.6, 'porcentajes con punto, coma y símbolo %');
ok(v('100', 'pct_reels').valor === 100 && v('0', 'pct_reels').valor === 0, 'el 0 y el 100 son válidos');
ok(v('100,5', 'pct_reels').error && v('1.234,5', 'pct_reels').error && v('53.777', 'pct_reels').error, 'porcentaje sobre 100 o con más de 2 decimales: error');
ok(v('1000000001', 'visualizaciones').error, 'un número absurdo se rechaza (la base también: CHECK)');

console.log('\n[mostrar]');
ok(ED.fmt(41937, C('visualizaciones')) === '41.937', 'miles con punto (es-CL): 41.937');
ok(ED.fmt(125, C('seguidores_neto')) === '+125' && ED.fmt(-40, C('seguidores_neto')) === '−40', 'neto con signo: +125 y −40');
ok(ED.fmt(53.7, C('pct_reels')) === '53,7 %' && ED.fmt(null, C('pct_reels')) === '—', 'porcentaje con coma y símbolo; sin dato = «—»');
const fila = { visualizaciones: 41937, cuentas_alcanzadas: 9251, visitas_perfil: 1325, seguidores_neto: 125, pct_publicaciones: 53.7, pct_historias: 23.7, pct_reels: 22.6 };
const ig = ED.igDeFila(fila);
ok(ig.seguidores === '+125' && ig.pct_reels === '22,6' && ig.visualizaciones === '41.937' && Object.keys(ig).length === 7, 'igDeFila: las 7 cifras con las claves del formulario de evaluación (seguidores_neto → seguidores)');
ok(JSON.stringify(ED.igDeFila(null)) === '{}', 'sin entrega no se inventa nada');
const adminSrc = rd('admin.js');
ok(ED.CAMPOS.map(c => c.ig).every(k => adminSrc.includes(`{ key:'${k}'`)), 'las claves coinciden con _IG_FIELDS del admin (así la precarga cae en el campo correcto)');

console.log('\n[nada humano sin escapar]');
const malo = '<img src=x onerror=alert(1)>';
const html = ED.bloqueAdminHTML({ ...fila, subido_por_nombre: malo, captura_path: 'a"b<c', actualizado_en: new Date().toISOString() });
ok(!html.includes('<img src=x') && html.includes('&lt;img src=x'), 'el nombre de quien subió se escapa en el bloque del admin');
ok(html.includes('data-path="a&quot;b&lt;c"'), 'la ruta de la captura va escapada en el atributo');
ok(/aún no está activada/.test(ED.bloqueAdminHTML(null, { disponible: false })) && /todavía no las ha enviado/.test(ED.bloqueAdminHTML(null)), 'sin 0043 y sin entrega, el admin lo lee en claro');
ok(!/\son(click|input|change|submit|error|load)\s*=/.test(src), 'el módulo no escribe handlers en línea (CSP)');

console.log('\n[cableado]');
for (const p of ['admin.html', 'secretario.html']) {
  const h = rd(p);
  ok(/core\/equipos\.js[\s\S]*core\/estadisticas-distrito\.js/.test(h), p + ': el módulo se carga después de equipos.js');
  ok(/equipos\.css[\s\S]*estadisticas-distrito\.css[\s\S]*movil\.css/.test(h), p + ': estadisticas-distrito.css va después de equipos.css y antes de movil.css');
  ok(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/.test(h.replace(/<script type="application\/ld\+json"[\s\S]*?<\/script>/g, '')), p + ': ningún <script> en línea (CSP)');
}
ok(/id="dist-panel-estadisticas"[\s\S]*id="dist-estadisticas-cuerpo"/.test(rd('secretario.html')), 'secretario.html: panel «Estadísticas» en la pestaña Distrito');
const sec = rd('secretario.js');
ok(/k: 'estadisticas'/.test(sec) && /montarEstadisticasDistrito/.test(sec) && /EstadisticasDistrito\.montarSecretaria/.test(sec), 'secretario.js: tercera sección y montaje con el período elegido');
ok(/getEstadisticasDistrito\(_activePEDist\.id, distId\)/.test(adminSrc) && /EstadisticasDistrito\.bloqueAdminHTML/.test(adminSrc), 'admin.js: el formulario de evaluación lee y muestra la entrega de la secretaría');
const lista = cfg.slice(0, cfg.indexOf('const ACCIONES'));
ok(lista.includes("'estDistArchivo'") && lista.includes("'estDistCampo'"), 'estDistArchivo y estDistCampo están en la lista blanca de data-input / data-change');
ok(/^\s{2}estDist:\s+\(a, el\) => EstadisticasDistrito\.accion/m.test(cfg), 'ACCIONES.estDist existe');
ok(/function estDistArchivo\(/.test(src) && /function estDistCampo\(/.test(src), 'las dos funciones globales existen');
ok(rd('core/render.js').includes("'estDistArchivo'"), 'en una gestión archivada el selector de archivo queda deshabilitado');
const usadas = new Set([...src.matchAll(/data-act="([a-zA-Z]+)"/g)].map(m => m[1]));
ok([...usadas].every(a => new RegExp(`^\\s{2}${a}:`, 'm').test(cfg)), 'toda data-act usada existe en ACCIONES: ' + [...usadas].join(', '));

console.log('\n[estilo]');
const css = rd('estadisticas-distrito.css').replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'estadisticas-distrito.css: ningún hex (solo tokens)');
ok(/\.ed-visor[^}]*var\(--z-modal\)/.test(css), 'el visor usa la capa de modales del sistema');
ok(/@media \(prefers-reduced-motion: reduce\)/.test(css), 'respeta prefers-reduced-motion');

console.log('\n[reducir la captura]');
const rend = rd('core/render.js');
ok(/async function reducirCaptura\(/.test(rend) && /LADO_CAPTURA\s*=\s*1280/.test(rend) && /TOPE_CAPTURA\s*=\s*250 \* 1024/.test(rend), 'reducirCaptura: lado mayor 1280 px y tope de ~250 KB');
const cuerpo = rend.slice(rend.indexOf('async function reducirCaptura('), rend.indexOf('/** Perfil en curso'));
ok(!cuerpo.includes('Math.min(w, h)') && cuerpo.includes('Math.max(w, h)'), 'no recorta: conserva la proporción (a diferencia de la foto de perfil)');
ok(cuerpo.includes('image/webp') && cuerpo.includes('image/jpeg'), 'WebP y, si el navegador no sabe, JPEG (los dos permitidos por el bucket)');
ok(250 * 1024 < 614400, 'el tope del cliente (250 KB) queda por debajo del tope del bucket (600 KB)');

console.log('\n[api y migración: la misma forma de ruta]');
const api = rd('api.js'), mig = rd('supabase/migrations/0043_estadisticas_distrito.sql');
for (const m of ['getEstadisticasDistrito', 'getEstadisticasDistritosByPE', 'guardarEstadisticasDistrito', 'subirCapturaDistrito', 'borrarCapturaDistrito', 'urlCapturaDistrito'])
  ok(new RegExp(`async ${m}\\(`).test(api), 'API.' + m);
ok(api.includes("from('capturas-distrito')") && mig.includes("'capturas-distrito'"), 'API y migración usan el mismo bucket');
const re = new RegExp(mig.match(/NEW\.captura_path !~ '([^']+)'/)[1]);
const uuid = 'aaaaaaaa-0000-0000-0000-000000000002';
ok(re.test(`08-01/${uuid}/captura-${Date.now()}.webp`) && re.test(`08-01/${uuid}/captura-${Date.now()}.jpg`), 'las rutas que arma API.subirCapturaDistrito cumplen el CHECK de la base');
ok(!re.test(`08-01/${uuid}/captura.png`) && !re.test('08-01/x/captura.webp') && !re.test(`08-01/${uuid}/../captura.webp`), '…y lo que no debe pasar, no pasa');
ok(/upsert:\s*false/.test(api.slice(api.indexOf('async subirCapturaDistrito'))), 'cada subida es un archivo nuevo (nunca se pisa una captura ni se sirve una vieja desde caché)');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
