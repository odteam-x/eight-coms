// Un período que empieza después de hoy no se abre para quien no administra (renderPEBar); la administración sí entra.
import fs from 'node:fs';
const ROOT = new URL('../../', import.meta.url);
const cfg = fs.readFileSync(new URL('config.js', ROOT), 'utf8');
let n = 0, mal = 0;
const ok = (c, t) => { n++; if (c) console.log('  ✓ ' + t); else { mal++; console.log('  ✗ ' + t); } };
const fn = cfg.match(/function peNoIniciado\(p, hoy\) \{[\s\S]*?\n\}/);
ok(!!fn, 'config.js define peNoIniciado');
const peNoIniciado = new Function(fn[0] + '; return peNoIniciado;')();
ok(peNoIniciado({ inicio: '2099-01-01' }) === true, 'un PE que empieza en el futuro está «no iniciado»');
ok(peNoIniciado({ inicio: '2000-01-01' }) === false, 'un PE ya iniciado no lo está');
ok(peNoIniciado({ inicio: null }) === false && peNoIniciado(null) === false, 'sin fecha de inicio no se afirma nada');
ok(peNoIniciado({ inicio: '2026-12-03' }, '2026-12-03') === false && peNoIniciado({ inicio: '2026-12-04' }, '2026-12-03') === true, 'el día de inicio ya cuenta como iniciado; el siguiente no');
ok(/bloquearFuturos = opciones\.bloquearFuturos !== false/.test(cfg) && /aún no inicia/.test(cfg) && /pb--futuro/.test(cfg), 'renderPEBar bloquea por defecto, rotula «aún no inicia» y marca el botón');
const perfil = fs.readFileSync(new URL('core/perfil.js', ROOT), 'utf8');
ok(/bloquearFuturos: inst\.modo !== 'admin'/.test(perfil), 'el perfil que mira la administración no bloquea períodos futuros');
console.log('\n' + (n - mal) + ' correctas, ' + mal + ' fallidas'); process.exit(mal ? 1 : 0);
