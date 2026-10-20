// Gafete con QR verificable (0052): la página pública, el rewrite, la CSP y el cableado en los tres portales.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const rd = f => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };

console.log('[página pública /v/<token>]');
const vf = rd('verificar.html'), js = rd('verificar.js'), vj = JSON.parse(rd('vercel.json'));
ok(vj.rewrites?.some(r => r.source === '/v/:token' && r.destination === '/verificar.html'), 'vercel.json reescribe /v/:token a verificar.html');
ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(vf), 'sin <script> en línea (CSP)');
ok(/name="robots" content="noindex, nofollow"/.test(vf), 'no se indexa');
ok(/href="\/shared\.css"/.test(vf) && /src="\/verificar\.js"/.test(vf) && /src="\/config\.js"/.test(vf), 'rutas absolutas (la URL tiene dos niveles)');
ok(/supabase-js@2\.\d+\.\d+[^>]*integrity="sha384-/.test(vf), 'supabase-js con versión fija e integridad');
ok(!/auth\.js|requireAuth|getProfile/.test(vf + js), 'no pide sesión: es pública');
ok(/rpc\('verificar_gafete', \{ p_token: t \}\)/.test(js) && /\^\[0-9a-f\]\{24\}\$/.test(js), 'valida el formato del token antes de consultar y usa solo verificar_gafete');
ok(!/from\('(profiles|gafetes|evaluaciones)'\)/.test(js), 'nunca consulta tablas: solo la función pública');
const interp = [...js.matchAll(/\$\{([^}]+)\}/g)].map(m => m[1]).filter(e => !/^escHtml\(|^foto$|^pe\b|^pe ===|^msg/.test(e) && !/^iniciales|^CARGOS/.test(e));
ok(interp.every(e => /escHtml|foto|pe/.test(e)), 'todo dato de la base pasa por escHtml: ' + (interp.join(' | ') || 'ok'));
ok(/supabase\\.co\$/.test(js), 'la foto solo se acepta del almacenamiento del proyecto');
const css = rd('verificar.css');
ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'verificar.css sin colores literales (solo tokens)');

console.log('\n[gafete en los portales]');
for (const f of ['user.html', 'secretario.html', 'admin.html']) {
  const h = rd(f);
  ok(h.indexOf('core/vendor/qrcode.js') > 0 && h.indexOf('core/vendor/qrcode.js') < h.indexOf('core/gafete.js') && h.indexOf('core/gafete.js') < h.indexOf('<script src="core/perfil.js">'), f + ': carga la librería de QR y el gafete antes del perfil');
}
const per = rd('core/perfil.js'), cfg = rd('config.js'), g = rd('core/gafete.js');
ok(/inst\.modo === 'propio' \|\| _cfg\.gafete\?\.esAdmin/.test(per), 'el botón aparece en el perfil propio y, para la administración, en el de cualquiera');
ok(/perfilGafete:\s+\(a\) => Gafete\.abrir\(a\)/.test(cfg), 'acción registrada');
ok(/gafete: \{ esAdmin: true \}/.test(rd('admin-personas.js')), 'la administración lo habilita en Personas');
ok(/\/v\/\$\{token\}/.test(g) && !/profile|\.id\b.*qr/i.test(g.split('function _qr')[1].split('async function dibujar')[0]), 'el QR lleva /v/<token>, no el id de la persona');
ok(/verificar_gafete/.test(g) && /obtener_gafete/.test(g), 'los datos del gafete salen de verificar_gafete (lo mismo que verá quien escanee)');
ok(fs.statSync(ROOT + 'core/vendor/qrcode.js').size > 40000 && /MIT license/.test(rd('core/vendor/qrcode.js')), 'qrcode-generator (MIT) vendorizado: sin depender de un CDN');
console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
