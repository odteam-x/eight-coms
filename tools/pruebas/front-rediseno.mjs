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

// ── Manuales de uso ───────────────────────────────────────────────────────
{
  for (const [m, portalJs, rutaAyuda] of [['miembro', 'user.js', 'ayuda/miembro.html'], ['secretario', 'secretario.js', 'ayuda/secretario.html'], ['admin', 'admin.js', 'ayuda/admin.html']]) {
    const h = fs.readFileSync(ROOT + 'ayuda/' + m + '.html', 'utf8');
    const ids = [...h.matchAll(/<section id="([a-z-]+)"/g)].map(x => x[1]);
    ok(ids.length >= 8 && ids.includes('acceso') && ids.includes('avisos') && ids.includes('cuenta') && ids.includes('proximamente') && ids.includes('permisos') && ids.includes('faq'), 'ayuda/' + m + '.html: tiene acceso, avisos, cuenta, «Próximamente», permisos y preguntas frecuentes (' + ids.length + ' secciones)');
    ok([...h.matchAll(/<li><a href="#([a-z-]+)">/g)].every(x => ids.includes(x[1])) && /<nav class="ay-toc"/.test(h), 'ayuda/' + m + '.html: el índice enlaza solo a secciones que existen');
    ok([...h.matchAll(/src="img\/([a-z-]+\.jpg)"/g)].every(x => fs.existsSync(ROOT + 'ayuda/img/' + x[1])), 'ayuda/' + m + '.html: todas las capturas existen');
    ok((h.match(/<ol class="pasos">/g) || []).length >= 4 && /class="faq"/.test(h), 'ayuda/' + m + '.html: procedimientos con pasos numerados y preguntas frecuentes');
    ok(new RegExp("ayuda: [^\\n]*" + rutaAyuda.replace(/\./g, '\\.')).test(fs.readFileSync(ROOT + portalJs, 'utf8')), portalJs + ': enlaza el manual desde el portal (' + rutaAyuda + ')');
    ok(!/<script/.test(h.replace(/<script src="\.\.\/core\/theme\.js"><\/script>/, '')), 'ayuda/' + m + '.html: sin scripts en línea (CSP)');
  }
  ok(/AYUDA_URL/.test(fs.readFileSync(ROOT + 'core/cuenta.js', 'utf8')) && /Ayuda y manual de uso/.test(fs.readFileSync(ROOT + 'core/rail.js', 'utf8')), 'Mi cuenta, el menú lateral y la hoja «Más» enlazan el manual');
  ok(fs.existsSync(ROOT + 'ayuda/ayuda.css') && fs.existsSync(ROOT + 'tools/generar-manuales.mjs'), 'existen ayuda.css y el generador');
  const man = fs.readFileSync(ROOT + 'ayuda/miembro.html', 'utf8') + fs.readFileSync(ROOT + 'ayuda/secretario.html', 'utf8') + fs.readFileSync(ROOT + 'ayuda/admin.html', 'utf8');
  ok(/Próximamente/.test(man) && !/Lo que aún no hace|todavía no existen|aún no puedes elegirlos/.test(man), 'los manuales presentan lo pendiente como «Próximamente», no como «no disponible»');
  // Cada captura de computadora tiene su par de celular, y el manual elige la que corresponde al dispositivo.
  const pcs = fs.readdirSync(ROOT + 'ayuda/img').filter(f => /-pc\.jpg$/.test(f));
  ok(pcs.length >= 20 && pcs.every(f => fs.existsSync(ROOT + 'ayuda/img/' + f.replace('-pc.jpg', '.jpg'))), 'ayuda/img: ' + pcs.length + ' capturas de computadora, cada una con su versión de celular');
  ok(/captura--dual/.test(man) && /media="\(min-width: 900px\)" srcset="img\/[a-z-]+-pc\.jpg"/.test(man) && /captura--dual/.test(fs.readFileSync(ROOT + 'ayuda/ayuda.css', 'utf8')), 'los manuales usan <picture>: vista de PC desde 900 px y de celular en pantallas chicas');
  ok(/Novedades del portal/.test(man) && /bienvenida/.test(man), 'los manuales explican los dos recorridos (bienvenida y novedades)');
}

// ── Eliminar borradores ───────────────────────────────────────────────────
{
  const api = fs.readFileSync(ROOT + 'api.js', 'utf8'), adm = fs.readFileSync(ROOT + 'admin.js', 'utf8'), cfg = fs.readFileSync(ROOT + 'config.js', 'utf8'), rnd = fs.readFileSync(ROOT + 'core/render.js', 'utf8');
  ok(/async deleteBorrador\(/.test(api) && /async deleteBorradores\(/.test(api), 'api.js: deleteBorrador y deleteBorradores');
  ok((api.match(/\.eq\('estado', 'borrador'\)\.select\('id'\)/g) || []).length === 2, 'api.js: las dos eliminaciones filtran estado = borrador (una publicada no se puede borrar desde aquí)');
  ok(/data-act="borrarEval"/.test(adm) && /ev\?\.estado === 'borrador'/.test(adm), 'admin.js: el botón «Eliminar borrador» solo aparece si la evaluación es un borrador');
  ok(/data-act="borrarBorradores"/.test(adm) && /cuenta\.borrador \?/.test(adm), 'admin.js: el botón masivo solo aparece si hay borradores');
  ok(/borrarEval:\s*\(arg\)\s*=>\s*borrarBorradorEval/.test(cfg) && /borrarBorradores:\s*\(\)\s*=>\s*borrarBorradoresEval/.test(cfg), 'config.js: acciones registradas');
  ok(/'borrarEval', 'borrarBorradores'/.test(rnd), 'render.js: los botones se desactivan en una gestión archivada');
  ok(/Tareas\.abrirModal\(\{\s*titulo: 'Eliminar borrador'/.test(adm) && /Las evaluaciones publicadas no se tocan/.test(adm), 'admin.js: pide confirmación y dice que lo publicado no se toca');
}

// ── Favicon redondo y fondo de perfil elegible ────────────────────────────
{
  const { decodificar } = await import('../png-util.mjs');
  for (const [arch, lado] of [['favicon-32.png', 32], ['favicon-64.png', 64], ['icono-redondo-192.png', 192], ['icono-redondo-512.png', 512]]) {
    const im = decodificar(fs.readFileSync(ROOT + arch));
    const a = (x, y) => im.px[(y * im.w + x) * 4 + 3];
    ok(im.w === lado && im.h === lado && a(0, 0) === 0 && a(lado - 1, lado - 1) === 0 && a(lado >> 1, lado >> 1) === 255, arch + ': ' + lado + ' px, esquinas transparentes y centro opaco (redondo)');
  }
  const ico = fs.readFileSync(ROOT + 'favicon.ico');
  ok(ico.readUInt16LE(2) === 1 && ico.readUInt16LE(4) === 3, 'favicon.ico: contiene 3 tamaños (16, 32, 48)');
  for (const p of ['index.html', 'user.html', 'secretario.html', 'admin.html']) {
    const t = fs.readFileSync(ROOT + p, 'utf8');
    ok(/rel="icon" type="image\/png" sizes="32x32" href="favicon-32\.png"/.test(t) && !/rel="icon"[^>]*icono-192/.test(t), p + ': la pestaña usa el favicon redondo (no el cuadrado)');
  }
  const man = JSON.parse(fs.readFileSync(ROOT + 'manifest.webmanifest', 'utf8'));
  ok(man.icons.filter(i => i.purpose === 'any').every(i => /redondo/.test(i.src)) && man.icons.filter(i => i.purpose === 'maskable').every(i => !/redondo/.test(i.src)), 'manifest: «any» redondo, «maskable» cuadrado a sangre');

  // Fondo de perfil
  const vm = (await import('node:vm')).default;
  const ctx = { document: { getElementById: () => null, querySelectorAll: () => [] }, CSS: { escape: x => x }, API: {}, showToast() {}, renderIconos() {}, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ROOT + 'core/fondo.js', 'utf8') + '\n;globalThis.__F = Fondo;', ctx);
  const F = ctx.__F;
  ok(F.N === 7, 'Fondo: siete patrones (los de la marca)');
  ok(F.clase({ id: 'x', fondo: 1 }) === 0 && F.clase({ id: 'x', fondo: 7 }) === 6 && F.clase({ id: 'x', fondo: 4 }) === 3, 'Fondo.clase: el patrón elegido N es la clase pat-(N-1)');
  const auto = F.clase({ id: 'abc' });
  ok(auto >= 0 && auto < 7 && auto === F.clase({ id: 'abc', fondo: null }) && auto === F.clase({ id: 'abc', fondo: 0 }) && auto === F.clase({ id: 'abc', fondo: 9 }), 'Fondo.clase: sin elección (o inválida) usa el automático por id, estable');
  const fh = fs.readFileSync(ROOT + 'core/fondo.js', 'utf8');
  ok(/role="radiogroup"/.test(fh) && /role="radio"/.test(fh) && /aria-checked/.test(fh), 'Fondo: grupo de radios accesible');
  ok(/updateMiFondo/.test(fs.readFileSync(ROOT + 'api.js', 'utf8')) && /fondoElegir:\s*\(arg\)\s*=>\s*Fondo\.elegir/.test(fs.readFileSync(ROOT + 'config.js', 'utf8')), 'api.js y config.js: updateMiFondo y la acción fondoElegir');
  for (const p of ['user.html', 'secretario.html', 'admin.html']) ok(/<script src="core\/fondo\.js"><\/script>/.test(fs.readFileSync(ROOT + p, 'utf8')), p + ': carga core/fondo.js');
  ok(/pat-\$\{typeof Fondo !== 'undefined' \? Fondo\.clase\(persona\)/.test(fs.readFileSync(ROOT + 'core/inicio.js', 'utf8')) && /Fondo\.clase\(p\)/.test(fs.readFileSync(ROOT + 'core/perfil.js', 'utf8')), 'Inicio y Mi perfil pintan el fondo elegido');
  const m30 = fs.readFileSync(ROOT + 'supabase/migrations/0030_fondo_perfil.sql', 'utf8');
  ok(/fondo IS NULL OR fondo BETWEEN 1 AND 7/.test(m30), 'migración 0030: solo 1–7 o NULL');
}


// ── Evolución integral: roles y preferencias, selector, nueva tarea, actividades, seguimiento, bienvenida, reportes ──
{
  const vm = (await import('node:vm')).default;
  const cfg = fs.readFileSync(ROOT + 'config.js', 'utf8');
  const acciones = new Set([...cfg.matchAll(/\n\s{2}([a-zA-Z0-9]+):\s/g)].map(m => m[1]));
  const simples = new Set([...cfg.match(/_ACCIONES_SIMPLES = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([A-Za-z0-9]+)'/g)].map(m => m[1]));
  const nuevos = ['core/selector.js', 'core/asignar.js', 'core/preferencias.js', 'core/actividad-form.js', 'core/seguimiento.js', 'core/bienvenida.js', 'core/reporte-equipo.js'];
  const todoJs = ['config.js', 'api.js', 'admin.js', 'admin-personas.js', 'admin-reportes.js', 'admin-actividades.js', 'core/tareas.js', 'core/calendario.js', 'core/cuenta.js', ...nuevos].map(f => fs.readFileSync(ROOT + f, 'utf8')).join('\n');

  console.log('\n[evolución integral: archivos, acciones y marcado]');
  for (const f of [...nuevos, 'evolucion.css', 'supabase/migrations/0021_roles_preferencias.sql', 'supabase/migrations/0024_actividades_alcance.sql', 'supabase/migrations/0025_seguimiento_bienvenida.sql',
                   'tools/pruebas/sql-0021.mjs', 'tools/pruebas/sql-0024.mjs', 'tools/pruebas/sql-0025.mjs']) ok(fs.existsSync(ROOT + f), 'existe ' + f);
  for (const f of nuevos) {
    const t = fs.readFileSync(ROOT + f, 'utf8');
    ok(!/\son[a-z]+\s*=\s*["']/i.test(t.replace(/data-on[a-z]+/g, '')), f + ': sin handlers inline (todo por data-act)');
    const act = [...new Set([...t.matchAll(/data-act="([A-Za-z0-9]+)"/g)].map(m => m[1]))].filter(a => a !== 'fn');
    const faltan = act.filter(a => !acciones.has(a));
    ok(!faltan.length, f + ': todas sus data-act están en ACCIONES' + (faltan.length ? ' (faltan: ' + faltan.join(', ') + ')' : ''));
    const sim = [...new Set([...t.matchAll(/data-(?:change|input)="([A-Za-z0-9]+)"/g)].map(m => m[1]))];
    const noPerm = sim.filter(a => !simples.has(a));
    ok(!noPerm.length, f + ': sus data-change / data-input están en la lista blanca' + (noPerm.length ? ' (faltan: ' + noPerm.join(', ') + ')' : ''));
  }
  for (const n of [...simples].filter(n => /^(sel|asig|actf|seg|gestionRol)/.test(n))) ok(new RegExp('function ' + n + '\\b').test(todoJs), 'existe la función global ' + n + '() de la lista blanca');
  ok(/'Selector'|const Selector/.test(fs.readFileSync(ROOT + 'core/selector.js', 'utf8')), 'selector: componente reutilizable');
  const portales = {
    'admin.html': ['selector', 'asignar', 'actividad-form', 'seguimiento', 'reporte-equipo', 'bienvenida', 'preferencias'],
    'secretario.html': ['selector', 'asignar', 'actividad-form', 'seguimiento', 'reporte-equipo', 'bienvenida', 'preferencias'],
    'user.html': ['seguimiento', 'bienvenida', 'preferencias'],
  };
  for (const [p, scripts] of Object.entries(portales)) {
    const h = fs.readFileSync(ROOT + p, 'utf8');
    for (const s of scripts) ok(h.includes(`<script src="core/${s}.js"></script>`), `${p}: carga core/${s}.js`);
    ok(/premium\.css[\s\S]*evolucion\.css[\s\S]*movil\.css/.test(h), p + ': evolucion.css va después de premium.css y antes de movil.css');
  }
  ok(/id="tab-seguimiento"/.test(fs.readFileSync(ROOT + 'admin.html', 'utf8')) && /id="tab-seguimiento"/.test(fs.readFileSync(ROOT + 'secretario.html', 'utf8')) && /id="tab-reportes"/.test(fs.readFileSync(ROOT + 'secretario.html', 'utf8')), 'pestañas Seguimiento (admin y secretaría) y Reportes (secretaría)');
  ok(/id="bv-slot"/.test(fs.readFileSync(ROOT + 'admin.html', 'utf8')) && /id="bv-slot"/.test(fs.readFileSync(ROOT + 'core/inicio.js', 'utf8')), 'la tarjeta «Primeros pasos» tiene su hueco en el Panel y en Inicio');
  const css = fs.readFileSync(ROOT + 'evolucion.css', 'utf8');
  ok(!/#[0-9a-fA-F]{3,8}\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'evolucion.css: ningún hex (solo tokens)');
  ok(/@media \(max-width: 767px\)/.test(css) && /\.seg-celda::before/.test(css), 'evolucion.css: las tablas pasan a tarjetas en celular');
  const ui = fs.readFileSync(ROOT + 'core/ui.js', 'utf8');
  ok(/function lineasDeTexto/.test(ui), 'core/ui.js: lineasDeTexto');

  console.log('\n[roles, preferencias y asignación: reglas del frontend]');
  const api = fs.readFileSync(ROOT + 'api.js', 'utf8');
  ok(/rolesAmpliados/.test(api) && /if \(rol_id != null\) fila\.rol_id/.test(api) && /if \(actividad_id != null\) fila\.actividad_id/.test(api), 'api.js: rol_id y actividad_id solo viajan si hay valor (se puede desplegar antes de 0021)');
  ok(/descripcion !== undefined/.test(api) && /responsabilidades !== undefined/.test(api) && /requisitos !== undefined/.test(api), 'api.js: los textos del rol solo se envían si se mandan');
  ok(!/!!puntaje/.test(todoJs), 'no hay !!puntaje: el 0 es un puntaje válido y se compara con != null');
  const asig = fs.readFileSync(ROOT + 'core/asignar.js', 'utf8');
  ok(/nivel: 'error'/.test(asig) && /E\.c\.esAdmin/.test(asig) && /rol_excepcion|excepción/.test(asig), 'asignar: la secretaría tiene un bloqueo y la administración un aviso de excepción');
  ok(/duplicad|mismo título/.test(asig) && /SOBRECARGA/.test(asig) && /No participa/.test(asig), 'asignar: valida duplicado, sobrecarga y participación');
  ok(/c\.revisor && typeof Asignar/.test(fs.readFileSync(ROOT + 'core/tareas.js', 'utf8')), 'tareas.js: quien revisa usa el flujo nuevo; la iniciativa propia conserva el formulario simple');
  const pref = fs.readFileSync(ROOT + 'core/preferencias.js', 'utf8');
  ok(/predeterminado\(id\)[\s\S]{0,120}habilitado\(id\)/.test(pref) && /no te dan permisos|no te da permisos/.test(pref), 'preferencias: el predeterminado exige un rol habilitado y se dice que la preferencia no es un permiso');
  ok(/!_p\.es_admin/.test(fs.readFileSync(ROOT + 'core/cuenta.js', 'utf8')), 'Mi cuenta: la administración (que no se evalúa) no ve «Mis preferencias de rol»');

  console.log('\n[componentes con lógica, en un contexto con stubs]');
  const ctx = { escHtml, initials: n => String(n).split(' ').map(x => x[0]).join(''), renderIconos() {}, document: { addEventListener() {} }, HTMLInputElement: class {}, console,
                fmtNum: (v, d = 1) => v == null ? '—' : Number(v).toFixed(d), fechaCortaISO: x => x, showToast() {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ROOT + 'core/selector.js', 'utf8') + ';globalThis.__S = Selector;', ctx);
  vm.runInContext(fs.readFileSync(ROOT + 'core/reporte-equipo.js', 'utf8') + ';globalThis.__R = ReporteEquipo;', ctx);
  const Sel = ctx.__S, Rep = ctx.__R;
  const gente = [
    { persona_id: 'a', nombre: 'Ana', distrito: '08-01', rol_nombre: 'Foto' }, { persona_id: 'b', nombre: 'Beto', distrito: '08-01', rol_nombre: 'Foto' },
    { persona_id: 'c', nombre: 'Carla', distrito: '08-02', rol_nombre: 'Redacción' }, { persona_id: 'd', nombre: 'Diego', distrito: '08-02', rol_nombre: 'Foto' },
  ];
  const eqs = Sel.equiposDe(gente.map(p => ({ id: p.persona_id, distrito: p.distrito, rol_nombre: p.rol_nombre })));
  ok(eqs.some(e => e.id === 'distrito:08-01' && e.miembros.length === 2) && eqs.some(e => e.id === 'rol:Foto' && e.miembros.length === 3), 'Selector.equiposDe: un equipo por distrito y por rol');
  ok(!eqs.some(e => e.id === 'rol:Redacción'), 'un equipo de una sola persona no es un equipo');
  ok(Sel.equiposDe([{ id: 'x', distrito: 'Distrito 08-01' }, { id: 'y', distrito: 'Distrito 08-01' }])[0].nombre === 'Distrito 08-01', 'el nombre del distrito no repite la palabra «Distrito»');
  let cambios = 0;
  const s = Sel.crear({ id: 't', personas: gente, equipos: eqs, onCambio: () => cambios++ });
  s.toggle('e:rol:Foto');
  ok(JSON.stringify(s.seleccion().sort()) === '["a","b","d"]', 'elegir un equipo agrega a sus miembros');
  s.toggle('e:rol:Foto');
  ok(s.seleccion().length === 0, 'volver a pulsarlo los quita a todos');
  s.toggle('p:c'); s.toggle('e:distrito:08-02');
  ok(JSON.stringify(s.seleccion().sort()) === '["c","d"]', 'una persona ya elegida no se duplica al elegir su equipo');
  s.quitar('c');
  ok(s.seleccion().join() === 'd' && cambios >= 4, 'quitar y el aviso de cambio funcionan');
  s.ninguna();
  const lim = Sel.crear({ id: 'l', personas: gente, equipos: eqs, max: 2 });
  lim.toggle('e:rol:Foto');
  ok(lim.seleccion().length === 2, 'el máximo de personas se respeta');
  const rowsP = [
    { periodo_id: 'p1', periodo_nombre: 'PE1', periodo_orden: 1, modelo: 'legacy', periodo_activo: false, participa: true, estado_eval: 'publicado', total_clasico: 20, individual: null, con_plazo: 0, a_tiempo: 0, tareas_vencidas: 0, tareas_total: 0, rol_nombre: 'Foto' },
    { periodo_id: 'p2', periodo_nombre: 'PE2', periodo_orden: 2, modelo: 'v2', periodo_activo: true, participa: true, estado_eval: 'publicado', individual: 80, total_clasico: null, con_plazo: 2, a_tiempo: 1, tareas_vencidas: 1, tareas_total: 3, rol_nombre: 'Foto' },
    { periodo_id: 'p2', periodo_nombre: 'PE2', periodo_orden: 2, modelo: 'v2', periodo_activo: true, participa: true, estado_eval: 'publicado', individual: 60, total_clasico: null, con_plazo: 1, a_tiempo: 1, tareas_vencidas: 0, tareas_total: 1, rol_nombre: 'Foto' },
    { periodo_id: 'p2', periodo_nombre: 'PE2', periodo_orden: 2, modelo: 'v2', periodo_activo: true, participa: true, estado_eval: 'borrador', individual: 99, total_clasico: null, con_plazo: 0, a_tiempo: 0, tareas_vencidas: 0, tareas_total: 0, rol_nombre: 'Foto' },
    { periodo_id: 'p2', periodo_nombre: 'PE2', periodo_orden: 2, modelo: 'v2', periodo_activo: true, participa: false, estado_eval: 'sin_evaluar', individual: null, total_clasico: null, con_plazo: 0, a_tiempo: 0, tareas_vencidas: 0, tareas_total: 0, rol_nombre: 'Foto' },
  ];
  const pp = Rep.porPeriodo(rowsP);
  ok(pp.length === 2 && pp[0].nombre === 'PE1' && pp[1].nombre === 'PE2', 'porPeriodo: un renglón por período, en orden');
  ok(pp[1].participan === 3 && pp[1].publicadas === 2, 'PE2: participan 3 (quien no participa no cuenta) y 2 publicadas → «2 de 3»');
  ok(pp[1].promedio === 70 && pp[1].n === 2, 'el promedio solo usa resultados PUBLICADOS (el borrador de 99 no entra): (80 + 60) / 2');
  ok(pp[1].con_plazo === 3 && pp[1].a_tiempo === 2 && pp[1].vencidas === 1, 'numerador y denominador de «a tiempo» se suman por separado (2 de 3)');
  ok(pp[0].promedio === 20, 'la rúbrica clásica tiene su propio promedio y no se mezcla con la de roles');
  const htmlP = Rep.periodosHTML(rowsP);
  ok(htmlP.includes('2 de 3 personas') && htmlP.includes('2 de 3 entregas con plazo') && htmlP.includes('sobre 100'), 'periodosHTML dice «2 de 3 personas», «2 de 3 entregas con plazo» y la escala');
  ok(Rep.periodosHTML([{ ...rowsP[0], con_plazo: 0, a_tiempo: 0 }]).includes('—'), 'un denominador en 0 se muestra «—», nunca 0 %');
  ok(!/<script/i.test(Rep.periodosHTML([{ ...rowsP[0], periodo_nombre: '<script>x</script>' }])), 'periodosHTML escapa el nombre del período');
  const filasA = [
    { actividad_id: 1, titulo: 'Jornada', fecha_inicio: '2026-11-02', alcance: 'equipo', persona_id: 'a', asignadas: 2, entregadas: 2, con_plazo: 2, a_tiempo: 1, aprobadas: 1, vencidas: 0, puntos_suma: 8, puntos_n: 1 },
    { actividad_id: 1, titulo: 'Jornada', fecha_inicio: '2026-11-02', alcance: 'equipo', persona_id: 'b', asignadas: 1, entregadas: 0, con_plazo: 0, a_tiempo: 0, aprobadas: 0, vencidas: 1, puntos_suma: 0, puntos_n: 0 },
    { actividad_id: 2, titulo: 'Sin tareas', fecha_inicio: '2026-12-01', alcance: 'equipo', persona_id: null, asignadas: 0, entregadas: 0, con_plazo: 0, a_tiempo: 0, aprobadas: 0, vencidas: 0, puntos_suma: 0, puntos_n: 0 },
  ];
  const pa = Rep.porActividad(filasA);
  ok(pa.length === 2 && pa[1].titulo === 'Jornada' && pa[1].asignadas === 3 && pa[1].entregadas === 2 && pa[1].personas === 2, 'porActividad: suma las filas por persona (3 asignadas, 2 entregadas, 2 personas)');
  ok(pa[0].personas === 0 && Rep.actividadesHTML(filasA).includes('Sin tareas vinculadas todavía'), 'una actividad sin tareas se dice como tal');
  ok(Rep.actividadesHTML(filasA).includes('2 de 3 asignadas') && Rep.actividadesHTML(filasA).includes('1 de 2 con plazo') && Rep.actividadesHTML(filasA).includes('1 de 2 entregadas'), 'actividadesHTML: «2 de 3 asignadas», «1 de 2 con plazo», «1 de 2 entregadas»');
  ok(Rep.csvPeriodos(rowsP).split('\n')[0].includes('Entregas con plazo') && Rep.csvActividades(filasA).split('\n')[0].includes('Tareas asignadas'), 'los CSV traen numerador y denominador en columnas separadas');

  console.log('\n[migraciones: idempotentes y sin pérdida de datos]');
  for (const f of ['0021_roles_preferencias', '0024_actividades_alcance', '0025_seguimiento_bienvenida', '0026_etiqueta_evento']) {
    const sql = fs.readFileSync(ROOT + 'supabase/migrations/' + f + '.sql', 'utf8');
    ok(/^BEGIN;/m.test(sql) && /^COMMIT;/m.test(sql), f + ': en una sola transacción');
    ok(!/DROP TABLE(?! IF EXISTS)[^;]*;/.test(sql.replace(/^--.*$/gm, '')), f + ': no borra tablas con datos (el deshacer va comentado)');
    ok(!/auth\.uid\(\) IS NOT NULL AND/.test(sql), f + ': ninguna guardia al revés (auth.uid() IS NOT NULL AND …)');
    const defs = [...sql.replace(/^--.*$/gm, '').matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\(/g)].map(m => m[1]);
    const revocadas = new Set([...sql.matchAll(/REVOKE EXECUTE ON FUNCTION public\.([\w,.\s()A-Z\[\]]+?) FROM/g)].flatMap(m => m[1].split(/\)\s*,\s*public\./)).map(x => x.replace(/^public\./, '').replace(/\(.*$/, '').trim()));
    const sinRevocar = defs.filter(d => !revocadas.has(d));
    ok(!sinRevocar.length, f + ': todas las funciones nuevas revocan EXECUTE a PUBLIC' + (sinRevocar.length ? ' (faltan: ' + sinRevocar.join(', ') + ')' : ''));
  }
}

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
