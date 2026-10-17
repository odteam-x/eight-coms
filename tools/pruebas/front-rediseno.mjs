import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = DIR + '../../';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };

const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── core/ui.js: primitivas de presentación, en un contexto con stubs ──
const ctx = {
  escHtml, renderIconos: () => {}, openModal: () => {}, closeModal: () => {}, console,
  window: { matchMedia: () => ({ matches: false }) }, document: { addEventListener: () => {} },
  performance: { now: () => 0 }, requestAnimationFrame: () => {},
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(ROOT + 'core/ui.js', 'utf8') + `
;globalThis.__u = { anilloHTML, deltaHTML, fmtNum, segHTML, textoDias, diasDesdeHoy, proximosHitos, lineaTiempoHTML, esqueletoHTML };`, ctx);
const U = ctx.__u;

console.log('[core/ui.js]');
ok(U.fmtNum(87.456) === '87.5' && U.fmtNum(null) === '—' && U.fmtNum(50, 0) === '50', 'fmtNum');
ok(U.anilloHTML({ valor: 70 }).includes('--p:0.7000') && !U.anilloHTML({ valor: 70 }).includes('anillo--vacio'), 'anillo: 70/100 = 0.7');
ok(U.anilloHTML({ valor: null }).includes('anillo--vacio') && U.anilloHTML({ valor: null }).includes('—'), 'anillo vacío sin dato');
ok(U.anilloHTML({ valor: 500, max: 100 }).includes('--p:1.0000'), 'anillo: el valor no pasa de 1');
ok(U.deltaHTML(70, 60).includes('delta--sube') && U.deltaHTML(60, 70).includes('delta--baja') && U.deltaHTML(5, 5).includes('delta--igual'), 'variación: sube / baja / igual');
ok(U.deltaHTML(null, 5) === '' && U.deltaHTML(5, undefined) === '', 'variación sin dato previo no pinta nada');
ok(!U.deltaHTML(70, 60, { ref: '<b>x</b>' }).includes('<b>x</b>'), 'variación: la referencia va escapada');
const seg = U.segHTML([{ k: 'a', etiqueta: '<i>' }], 'a', 'perfilTab');
ok(seg.includes('aria-selected="true"') && !seg.includes('<i>'), 'pestañas segmentadas: aria y escape');
ok(U.textoDias(0) === 'hoy' && U.textoDias(1) === 'mañana' && U.textoDias(5) === 'en 5 días' && U.textoDias(-3) === 'hace 3 días', 'textoDias');
const iso = d => { const x = new Date(); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const hitos = U.proximosHitos([{ pe: 'PE1', entrega: iso(-2), jornada: iso(10) }, { pe: 'PE2', inicio: iso(3) }]);
ok(hitos.length === 2 && hitos[0].pe === 'PE2' && hitos[0].dias === 3, 'próximos hitos: solo futuros, el más cercano primero');
ok(U.lineaTiempoHTML([{ pe: '<PE>', nombre: 'x', inicio: iso(1) }]).includes('&lt;PE&gt;'), 'línea de tiempo: escapa el período');
ok(U.esqueletoHTML('perfil').includes('aria-busy="true"'), 'esqueleto avisa que está cargando');

// ── archivos, acciones y marcado ──
console.log('\n[archivos y acciones]');
for (const f of ['core/perfil.js', 'core/inicio.js', 'core/personas.js', 'core/ui.js', 'perfil.css', 'inicio.css', 'admin-personas.js'])
  ok(fs.existsSync(ROOT + f), f);
const cfg = fs.readFileSync(ROOT + 'config.js', 'utf8');
for (const a of ['perfilTab', 'perfilVer', 'cambiarAvatar', 'distritoTab', 'personasVista', 'evaluarDesdePerfil', 'gestionAprobar', 'gestionParticipante', 'borrarDesdePerfil'])
  ok(new RegExp(`\\n\\s+${a}:`).test(cfg), `ACCIONES.${a}`);

console.log('\n[marcado de los portales]');
const portales = {
  'user.html': ['inicio-host', 'perfil-host', 'tab-trabajos', 'linea-tiempo'],
  'secretario.html': ['inicio-host', 'perfil-host', 'tab-distrito', 'distrito-seg', 'distrito-members', 'ranking-dist-body', 'tab-tareas', 'tareas-lista', 'linea-tiempo'],
  'admin.html': ['ov-atencion', 'personas-seg', 'personas-cards', 'usuarios-list'],
};
for (const [f, ids] of Object.entries(portales)) {
  const h = fs.readFileSync(ROOT + f, 'utf8');
  for (const id of ids) ok(h.includes(`id="${id}"`), `${f} #${id}`);
  ok(!/\son[a-z]+\s*=/i.test(h.replace(/data-on[a-z]+/g, '')), `${f}: sin handlers inline`);
  ok(/core\/ui\.js/.test(h) && /perfil\.css/.test(h), `${f}: carga core/ui.js y perfil.css`);
}

console.log('\n[estructura de las pantallas: cabecera canónica, ids únicos, acciones]');
for (const f of ['user.html', 'secretario.html', 'admin.html']) {
  const h = fs.readFileSync(ROOT + f, 'utf8');
  ok(!/class="ptitle/.test(h), `${f}: sin la cabecera antigua .ptitle (se usa .pantalla-cab con h1)`);
  const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
  ok(!dup.length, `${f}: ids únicos${dup.length ? ' (repetidos: ' + dup.join(', ') + ')' : ''}`);
}
{
  const h = fs.readFileSync(ROOT + 'admin.html', 'utf8');
  const tabs = [...h.matchAll(/<div id="(tab-[a-z-]+)" class="atab-content">\s*(?:<!--[^>]*-->\s*)?<div class="([^"]+)"/g)];
  const sinCab = tabs.filter(m => !/pantalla-cab|eval-fijo/.test(m[2])).map(m => m[1]);
  ok(tabs.length >= 12 && !sinCab.length, `admin.html: todas las pestañas abren con la cabecera canónica${sinCab.length ? ' (faltan: ' + sinCab.join(', ') + ')' : ''}`);
  ok(!/class="btn-cfg-add"[^>]*>\s*(<i[^>]*><\/i>)?\s*\+? ?Nuev[oa] (rol|período|actividad)/.test(h), 'admin.html: «Nuevo rol/período/actividad» son acción primaria (.btn-save)');
}

console.log('\n[acceso: Entrar y Crear cuenta en una sola página]');
{
  const h = fs.readFileSync(ROOT + 'index.html', 'utf8');
  const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
  ok(h.includes('id="login-form"') && h.includes('id="register-form"'), 'index.html: formulario de acceso y de registro en la misma página');
  ok(h.includes('role="tablist"') && h.includes('id="pane-login"') && h.includes('id="pane-registro"'), 'index.html: selector con roles de pestaña y dos paneles');
  ok(/id="pane-registro"[^>]*\binert\b/.test(h), 'index.html: el panel inactivo parte con inert');
  ok(!dup.length, `index.html: ids únicos${dup.length ? ' (repetidos: ' + dup.join(', ') + ')' : ''}`);
  ok(!/\son[a-z]+\s*=/i.test(h.replace(/data-on[a-z]+/g, '')), 'index.html: sin handlers inline');
  ok(!/href="registro\.html"/.test(h), 'index.html: ya no enlaza a registro.html');
  ok(/login\.js[\s\S]*registro\.js/.test(h), 'index.html: login.js carga antes que registro.js (aporta cargando())');
  const reg = fs.readFileSync(ROOT + 'registro.html', 'utf8');
  ok(/http-equiv="refresh"[^>]*index\.html#registro/.test(reg) && !/<script/.test(reg), 'registro.html: solo redirige a index.html#registro');
  const rj = fs.readFileSync(ROOT + 'registro.js', 'utf8');
  ok(!/function cargando/.test(rj) && !/function authErrEs\b/.test(rj), 'registro.js: no redefine cargando() ni authErrEs() de login.js');
  ok(/#register-form \.btn-pass-toggle/.test(rj), 'registro.js: el ojo de contraseña solo se engancha en el formulario de registro');
  ok(/id="reset-aviso"[^>]*\bhidden\b/.test(h) && /Aquí eliges tu <strong>nueva<\/strong> contraseña/.test(h), 'index.html: aviso de «clave actual» y nota previa al envío del código');
  const lj = fs.readFileSync(ROOT + 'login.js', 'utf8');
  ok(/function esMismaClave/.test(lj) && /function resetErrEs/.test(lj) && !/Error al actualizar contraseña: ' \+/.test(lj), 'login.js: «misma contraseña» se explica y los errores del reinicio salen en español');
  const cfg = fs.readFileSync(ROOT + 'config.js', 'utf8');
  ok(/'entrarAlPortal'/.test(cfg), 'config.js: entrarAlPortal está en la lista blanca de acciones');
  ok(/modoAcceso:\s*\(arg\)\s*=>\s*setModoAcceso/.test(cfg), 'config.js: acción modoAcceso registrada');
}

// ── Instalable como app (PWA) ─────────────────────────────────────────────
{
  const man = JSON.parse(fs.readFileSync(ROOT + 'manifest.webmanifest', 'utf8'));
  ok(man.display === 'standalone' && man.id && man.start_url && man.scope === '/', 'manifest: standalone con id, start_url y scope');
  ok(man.icons.some(i => i.sizes === '192x192') && man.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'), 'manifest: iconos 192 y 512 (maskable incluido)');
  ok(man.icons.every(i => fs.existsSync(ROOT + i.src.replace(/^\//, ''))), 'manifest: todos los iconos existen');
  ok(fs.existsSync(ROOT + 'icono-180.png') && fs.existsSync(ROOT + 'offline.html') && fs.existsSync(ROOT + 'sw.js'), 'existen icono-180.png, offline.html y sw.js');
  const sw = fs.readFileSync(ROOT + 'sw.js', 'utf8');
  ok(/mode !== 'navigate'/.test(sw) && !/cache\.put/.test(sw), 'sw.js: solo intercepta navegaciones y no guarda respuestas');
  ok(!/<script/.test(fs.readFileSync(ROOT + 'offline.html', 'utf8')), 'offline.html: sin <script> (la CSP no los permite en línea)');
  for (const p of ['index.html', 'user.html', 'secretario.html', 'admin.html']) {
    const t = fs.readFileSync(ROOT + p, 'utf8');
    ok(/rel="manifest"/.test(t) && /rel="apple-touch-icon" sizes="180x180" href="icono-180\.png"/.test(t) && /apple-mobile-web-app-capable/.test(t) && /name="mobile-web-app-capable"/.test(t), p + ': manifest + meta de iOS y Android para añadir a inicio');
    ok(/<script src="core\/pwa\.js"><\/script>/.test(t), p + ': carga core/pwa.js');
  }
  ok(/instalarApp:\s*\(\)\s*=>\s*Pwa\.instalar/.test(fs.readFileSync(ROOT + 'config.js', 'utf8')), 'config.js: acción instalarApp registrada');
  ok(/id="cuenta-instalar"[^>]*data-act="instalarApp"/.test(fs.readFileSync(ROOT + 'core/cuenta.js', 'utf8')), 'Mi cuenta: fila «Instalar en tu celular»');
  const vj = JSON.parse(fs.readFileSync(ROOT + 'vercel.json', 'utf8'));
  ok(vj.headers.some(h => h.source === '/sw.js' && h.headers.some(x => /no-cache/.test(x.value))), 'vercel.json: sw.js sin caché');
}

// ── Diseño móvil, campana de avisos y escalas ─────────────────────────────
{
  for (const p of ['index.html', 'user.html', 'secretario.html', 'admin.html']) {
    const t = fs.readFileSync(ROOT + p, 'utf8');
    ok(/href="movil\.css" media="\(max-width: 767px\)"/.test(t), p + ': movil.css solo se aplica por debajo de 768 px (escritorio intacto)');
  }
  for (const p of ['user.html', 'secretario.html', 'admin.html']) {
    ok(/<script src="core\/notificaciones\.js"><\/script>/.test(fs.readFileSync(ROOT + p, 'utf8')), p + ': carga core/notificaciones.js');
  }
  const cfg = fs.readFileSync(ROOT + 'config.js', 'utf8');
  for (const a of ['abrirAvisos', 'avisoIr', 'avisosFiltro', 'avisosTodas', 'avisosMas', 'puntosPaso', 'cuentaDesdeHoja']) ok(new RegExp('\\b' + a + ':\\s').test(cfg), 'config.js: acción ' + a + ' registrada');
  ok(/'puntosInputV2'/.test(cfg), 'config.js: puntosInputV2 está en la lista blanca de data-input');
  const ui = fs.readFileSync(ROOT + 'core/ui.js', 'utf8');
  for (const fn of ['hojaArrastrable', 'acordeonHTML', 'escalaHTML', 'escalaActualizar', 'puntosHTML', 'puntosActualizar']) ok(new RegExp('function ' + fn + '\\b').test(ui), 'core/ui.js: ' + fn);
  const rail = fs.readFileSync(ROOT + 'core/rail.js', 'utf8');
  ok(/Notif\.campanaHTML\('cab-btn'\)/.test(rail) && /Notif\.iniciar\(\)/.test(rail), 'rail.js: la campana está en la cabecera móvil y arranca el contador');
  ok(/hojaArrastrable\(hoja\.querySelector\('\.bb-hoja-panel'\), cerrarHoja\)/.test(rail), 'rail.js: el tirador de «Más» se puede arrastrar de verdad');
  ok(/_TITULOS_EXTRA/.test(rail), 'rail.js: la cabecera no repite la marca en pantallas fuera del menú (Mi cuenta)');
  const nf = fs.readFileSync(ROOT + 'core/notificaciones.js', 'utf8');
  for (const t of ['nota_publicada', 'tarea_asignada', 'tarea_vencida', 'entrega_por_revisar', 'solicitud_acceso', 'actividad_nueva', 'evaluaciones_sin_publicar']) ok(nf.includes(t + ':'), 'notificaciones.js: sabe presentar «' + t + '»');
  const m19 = fs.readFileSync(ROOT + 'supabase/migrations/0019_notificaciones.sql', 'utf8');
  const tipos = [...m19.match(/CHECK \(tipo IN \(([\s\S]*?)\)\)/)[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
  ok(tipos.every(t => nf.includes(t + ':')), 'notificaciones.js cubre los ' + tipos.length + ' tipos de aviso de 0019 (ninguno cae en «Aviso» genérico)');
  const css = fs.readFileSync(ROOT + 'premium.css', 'utf8') + fs.readFileSync(ROOT + 'movil.css', 'utf8');
  ok(/\.campana-n\b/.test(css) && /\.aviso--nuevo\b/.test(css) && /\.acordeon\b/.test(css) && /\.escala-paso\b/.test(css) && /\.pts-rango\b/.test(css), 'CSS: campana, avisos, acordeón, escala y puntos por peso');
  ok(fs.existsSync(ROOT + 'supabase/migrations/0022_notificaciones_app.sql') && fs.existsSync(ROOT + 'supabase/migrations/0023_puntuacion_por_peso.sql'), 'existen las migraciones 0022 y 0023');
  const adm = fs.readFileSync(ROOT + 'admin.js', 'utf8');
  ok(!/class="score-btn/.test(adm.replace(/const rows[\s\S]*?\n/, '')), 'admin.js: ya no hay hileras de botones numéricos (escala/puntos)');
  ok(/\.pantalla-t \{ position: absolute/.test(fs.readFileSync(ROOT + 'movil.css', 'utf8')), 'movil.css: el título de pantalla no se repite bajo la cabecera (sigue para lectores de pantalla)');
}

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
