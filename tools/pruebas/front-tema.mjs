// Tema rosa, selector de tema, tarjetas con una sola receta de vidrio y barra de estado del iPhone (notch).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const rd = f => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };

console.log('[tarjetas: una sola receta]');
const v = rd('vidrio.css'), mov = rd('movil.css');
ok(!/saturate\(\s*\d+%?\s*\)\s*;/.test(v.replace(/\/\*[\s\S]*?\*\//g, '')), 'ninguna tarjeta lleva saturate(): era lo que volvía azul intenso unas y dejaba grises otras');
ok(/\.pf-card--cian, \.pf-card--azul \{ background: var\(--v-fill\); \}/.test(v), 'las variantes --cian/--azul de la tarjeta ya no cambian el relleno');
ok(/\.inicio-cuenta \{[^}]*backdrop-filter: blur\(var\(--v-blur\)\)/.test(mov), 'la tarjeta de «días para…» del Inicio tiene el mismo desenfoque que las demás');

console.log('\n[iPhone con notch]');
for (const f of ['user.html', 'secretario.html', 'admin.html', 'index.html']) {
  ok(/apple-mobile-web-app-status-bar-style" content="black-translucent"/.test(rd(f)) && /viewport-fit=cover/.test(rd(f)), f + ': barra de estado translúcida con viewport-fit=cover (la malla llega al borde, sin banda oscura)');
}
ok(/\.login-layout \{ padding-top: env\(safe-area-inset-top\)/.test(v) && /theme-toggle-fixed \{ top: calc\(var\(--sp-3\) \+ env\(safe-area-inset-top\)\)/.test(v), 'acceso: el contenido y el botón de tema dejan el hueco del notch');

ok(/html::after \{[^}]*position: fixed[^}]*env\(safe-area-inset-top/.test(v) && /var\(--v-1\) 0, var\(--v-1\) env\(safe-area-inset-top/.test(v), 'franja superior: arriba la malla es --v-1 liso (el color que Safari pinta bajo la hora) y se aclara hacia su color real');
console.log('\n[tema rosa]');
const th = rd('core/theme.js');
ok(/TEMAS = \['dark', 'light', 'rosa'\]/.test(th) && /window\.setTheme/.test(th) && /rosa: '#3D0A27'/.test(th), 'theme.js: tres temas, setTheme y color de la barra del navegador');
ok(/if \(TEMAS\.indexOf\(t\) < 0\) t = 'dark'/.test(th), 'un valor ajeno en localStorage cae a oscuro');
ok(/data-act="tema"/.test(rd('core/cuenta.js')) && /tema: +\(arg\)/.test(rd('config.js')), 'Mi cuenta → App: selector Oscuro / Claro / Rosa con su acción');
const i = v.indexOf('[data-theme="rosa"] {'); const bloque = v.slice(i, v.indexOf('}', i));
ok(i > 0 && !/\[data-theme="light"\]/.test(bloque), 'el bloque rosa existe y no es un tema claro (hereda las reglas oscuras)');

// Contraste medido: texto sobre el vidrio en la peor zona de la malla (v3 con el brillo coral) y sobre el fondo sólido.
const tok = n => (bloque.match(new RegExp('--' + n + ':[ ]*(#[0-9A-Fa-f]{6})')) || [])[1];
const rgb = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
const lum = c => { const f = x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
const cr = (a, b) => { let [x, y] = [lum(a), lum(b)]; if (x < y) [x, y] = [y, x]; return (x + .05) / (y + .05); };
const mez = (b, o, a) => b.map((x, k) => Math.round(x * (1 - a) + o[k] * a));
const B = rgb('#FFFFFF'), coral = rgb('#FF6063');
const peor = mez(mez(rgb(tok('v-3')), coral, .12), B, .10), solido = rgb(tok('v-solido'));
for (const n of ['v-t', 'v-t2', 'v-tm', 'action', 'data-txt', 'sex-txt', 'sbu-txt', 'spr-txt', 'sba-txt', 'alert']) {
  const c = tok(n); const m = Math.min(cr(rgb(c), peor), cr(rgb(c), solido));
  ok(c && m >= 4.5, `--${n} ${c}: contraste ${m.toFixed(2)} (mín. 4.5) en la peor zona`);
}
ok(cr(rgb(tok('action-on')), rgb('#FF6063')) >= 4.5, 'texto del botón primario sobre coral ≥ 4.5');
for (const n of ['sex', 'sbu', 'spr', 'sba', 'data']) ok(cr(rgb(tok(n)), rgb(tok('v-1'))) >= 3, `relleno --${n} ${tok(n)} ≥ 3:1 sobre el fondo`);
console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
