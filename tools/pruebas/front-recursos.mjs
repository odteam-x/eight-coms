// Recursos (0071, antes Banco de imágenes): lectura del formulario (enlaces, colores, tipografías, etiquetas), cableado en los tres portales,
// reglas de seguridad del módulo, migración y documentación. node tools/pruebas/front-recursos.mjs
import fs from 'node:fs';
import vm from 'node:vm';
const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rd = f => fs.readFileSync(ROOT + f, 'utf8').split('\r\n').join('\n');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };

const js = rd('core/recursos.js');
const ctx = vm.createContext({ console, Promise, Date, Math, JSON, Object, Array, Set, Map, URL, String, Number, RegExp, escHtml: s => String(s) });
vm.runInContext(js + '\nglobalThis.__R = Recursos;', ctx);
const U = ctx.__R.util;

console.log('[formulario → partes]');
const e1 = U.parsearEnlaces('Logos | https://drive.google.com/x\nhttps://canva.com/y\n\n');
ok(e1.partes.length === 2 && e1.partes[0].e === 'Logos' && e1.partes[0].v === 'https://drive.google.com/x' && e1.partes[1].e === '', 'enlaces: una línea por enlace, con nombre opcional y líneas vacías ignoradas');
ok(U.parsearEnlaces('ftp://x.cl/a').error && U.parsearEnlaces('https://x.cl/a b').error && U.parsearEnlaces('javascript:alert(1)').error, 'enlaces: solo http(s) y sin espacios (javascript:, ftp: rechazados)');
ok(U.parsearEnlaces('x'.repeat(61) + ' | https://x.cl').error, 'enlaces: el nombre admite hasta 60 caracteres');
const c1 = U.parsearColores('#1a4fa0 Azul institucional, #fc0, Verde #4ade9b');
ok(c1.partes.length === 3 && c1.partes[0].v === '#1A4FA0' && c1.partes[0].e === 'Azul institucional', 'colores: hex en mayúsculas y nombre separado');
ok(c1.partes[1].v === '#FFCC00' && c1.partes[2].v === '#4ADE9B' && c1.partes[2].e === 'Verde', 'colores: #RGB se expande a #RRGGBB y el nombre puede ir antes');
ok(U.parsearColores('azul').error && U.parsearColores('1A4FA0').error && U.parsearColores('#12345').error, 'colores: sin # o con cifras de más/menos se rechaza (no se confunde «bad» con un color)');
const f1 = U.parsearFuentes('Títulos: Montserrat Bold, Open Sans');
ok(f1.partes.length === 2 && f1.partes[0].e === 'Títulos' && f1.partes[0].v === 'Montserrat Bold' && f1.partes[1].e === '' && f1.partes[1].v === 'Open Sans', 'tipografías: «Uso: Nombre» opcional');
ok(U.parsearFuentes('Uso:').error, 'tipografías: falta el nombre → error');
ok(JSON.stringify(U.parsearEtiquetas(' Logo, logo ,, Paleta ')) === '["Logo","Paleta"]', 'etiquetas: sin vacías ni repetidas');
const base = { titulo: 'Identidad del evento', tipo: 'identidad', enlaces: 'https://x.cl/a', colores: '#112233', fuentes: 'Inter', etiquetas: 'a, b', evento: 'E', categoria: '', descripcion: '' };
const A = U.armar(base);
ok(A.dato && A.dato.partes.length === 3 && A.dato.partes.map(p => p.t).join() === 'enlace,color,fuente' && A.dato.etiquetas.length === 2 && A.dato.tipo === 'identidad', 'armar: enlaces, luego colores, luego tipografías');
ok(U.armar({ ...base, titulo: 'ab' }).error && U.armar({ ...base, enlaces: '', colores: '', fuentes: '' }).error, 'armar: título corto y recurso sin nada se rechazan');
ok(U.armar({ ...base, colores: Array.from({ length: 21 }, () => '#000000').join(',') }).error, 'armar: más de 20 elementos se rechaza');
ok(U.armar({ ...base, etiquetas: 'a,b,c,d,e,f,g,h,i' }).error, 'armar: más de 8 etiquetas se rechaza');
ok(U.armar({ ...base, enlaces: '', fuentes: '' }).dato, 'armar: una identidad solo con paleta es válida (no exige enlace)');
ok(U.TIPOS.map(t => t.v).join() === 'imagen,video,enlace,identidad,documento,plantilla,audio,otro', 'los 8 tipos del front son los del CHECK de la migración');

console.log('\n[cableado en los tres portales]');
for (const [h, s, nav] of [['admin.html', 'admin.js', /tab:'recursos'[^}]*etiqueta:'Recursos'/], ['user.html', 'user.js', /tab:'recursos'[^}]*etiqueta:'Recursos'/], ['secretario.html', 'secretario.js', /tab:'recursos'[^}]*etiqueta:'Recursos'/]]) {
  const H = rd(h), J = rd(s);
  ok(/<h1 class="pantalla-t">Recursos<\/h1>/.test(H) && /id="tab-recursos"/.test(H) && /src="core\/recursos\.js"/.test(H), `${h}: título «Recursos», pestaña y script`);
  ok(nav.test(J) && /icono:'folder-open'/.test(J), `${s}: el menú dice «Recursos» con icono folder-open`);
  ok(!/Banco|banco-host|tab-banco|banco_imagenes/.test(H + J), `${h} / ${s}: no queda «Banco» en el portal`);
}
ok(/recursos:\s+\(a, el\) => Recursos\.accion/.test(rd('config.js')), 'config.js: acción «recursos» en la lista blanca');
ok(/recursos:\s+\{ temas: \['recursos'\] \}/.test(rd('core/sync.js')) && !/banco_imagenes/.test(rd('core/sync.js')), 'sync.js: la tabla recursos se escucha (tema «recursos»)');
ok(/getRecursos/.test(rd('api.js')) && /saveRecurso/.test(rd('api.js')) && /deleteRecurso/.test(rd('api.js')) && !/banco_imagenes/.test(rd('api.js')), 'api.js: getRecursos/saveRecurso/deleteRecurso y ya no lee banco_imagenes');
ok(!fs.existsSync(ROOT + 'core/banco.js'), 'core/banco.js ya no existe');

console.log('\n[módulo: seguridad y diseño]');
ok(/esHex/.test(js) && /\^#\[0-9a-f\]\{6\}\$/i.test(js), 'un color solo se pinta si es #RRGGBB exacto (va a un style)');
ok(!/innerHTML\s*=\s*[^;`]*\+/.test(js.split('function pintar')[1] || ''), 'pintar() no concatena texto crudo en innerHTML');
const css = rd('vidrio.css');
ok(!/border-left\s*:\s*[3-9]px|inset\s+[3-9]px\s+0\s+0/.test(css.slice(css.indexOf('/* 57. Recursos'), css.indexOf('/* 58.'))), 'CSS de Recursos: sin barras de acento en bordes');
const sec = css.slice(css.indexOf('/* 57. Recursos'), css.indexOf('/* 58.'));
ok(!/:hover[^{]*\{[^}]*(border|outline|box-shadow)[^}]*\}/.test(sec), 'CSS de Recursos: el hover no cambia contornos ni sombras (solo el fondo)');
ok(/\.rec-color\s*\{[^}]*min-height:\s*44px/.test(sec) && /\.rec-tag\s*\{[^}]*min-height:\s*44px/.test(sec), 'CSS de Recursos: botones táctiles de 44 px');
ok(/\.lista-aj, \.rec-card,/.test(css) && /\[data-theme="light"\] \.rec-card/.test(css), 'vidrio.css: la tarjeta toma el vidrio, el sólido móvil y el tema claro');

console.log('\n[migración 0071, registro y pruebas]');
const mig = rd('supabase/migrations/0071_recursos.sql');
ok(/CHECK \(tipo IN \('imagen', 'video', 'enlace', 'identidad', 'documento', 'plantilla', 'audio', 'otro'\)\)/.test(mig), '0071: CHECK por tipo con los ocho tipos');
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON public\.recursos FROM anon/.test(mig) && /ALTER PUBLICATION supabase_realtime ADD TABLE public\.recursos/.test(mig), '0071: RLS, nada para anon y publicada en Realtime');
ok(/-- ── REVERSA/.test(mig), '0071 lleva bloque de reversa');
ok(fs.existsSync(ROOT + 'entrega-sql/0071_recursos.sql') && rd('entrega-sql/0071_recursos.sql') === mig, 'entrega-sql/0071_recursos.sql es copia exacta de la migración');
const reg = rd('docs/auditoria/06-registro-migraciones.md');
ok(/0071/.test(reg) && /recursos/.test(reg), 'registrada en docs/auditoria/06-registro-migraciones.md');
const pkg = JSON.parse(rd('tools/pruebas/package.json'));
ok(/sql-0071\.mjs/.test(pkg.scripts.sql) && /front-recursos\.mjs/.test(pkg.scripts.front) && /flujo-recursos/.test(pkg.scripts['ui:recursos']), 'sql-0071, front-recursos y ui:recursos están en los scripts de npm');
const claude = rd('CLAUDE.md');
ok(/### Recursos \(migración 0071/.test(claude) && !/### Banco de imágenes/.test(claude), 'CLAUDE.md documenta Recursos');
const cap09 = rd('docs/sistema/09-proceso-comunicacion.md');
ok(/Recursos/.test(cap09) && /identidad gráfica/i.test(cap09) && /NO se pudo verificar|no se pudo verificar/i.test(rd('docs/sistema/12-datos-seguridad-operacion.md')), 'capítulos 09 y 12 explican Recursos y lo que no se pudo verificar');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
