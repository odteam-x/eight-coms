// Descarga los iconos Remix Icon (Apache-2.0) que usa el sitio y los empaqueta en
// core/iconos.js. Solo desarrollo: el sitio sigue sin build ni CDN de iconos.
//   node tools/generar-iconos.mjs
// Fuente: @iconify-json/ri (los mismos SVG de Remix Icon, en un solo JSON).
import fs from 'node:fs';
const VER = '1.2.10';
// nombre que usa el código (data-lucide) → icono Remix (sin el sufijo -line)
const MAPA = {
  'alarm-clock':'alarm','alert-triangle':'error-warning','archive':'archive','arrow-right':'arrow-right','arrow-left':'arrow-left',
  'calendar':'calendar','calendar-days':'calendar-event','calendar-plus':'calendar-check','camera':'camera','chevrons-left':'arrow-left-double',
  'chevron-left':'arrow-left-s','chevron-right':'arrow-right-s','chevron-down':'arrow-down-s','circle-check':'checkbox-circle',
  'clipboard-check':'clipboard','clipboard-list':'file-list-3','clock':'time','eye':'eye','eye-off':'eye-off','file-bar-chart':'bar-chart-box',
  'file-pen':'file-edit','folder-open':'folder-open','house':'home-5','inbox':'inbox','layout-dashboard':'dashboard','layout-grid':'layout-grid',
  'list':'list-unordered','list-checks':'list-check-2','log-out':'logout-box-r','map':'map-2','map-pin':'map-pin','moon':'moon','pause':'pause-circle',
  'plus-circle':'add-circle','plus':'add','printer':'printer','ruler':'ruler','send':'send-plane','settings':'settings-3','shield':'shield-check',
  'sliders-horizontal':'equalizer','star':'star','sun':'sun','sun-moon':'contrast-2','table-2':'table','tag':'price-tag-3','trash-2':'delete-bin',
  'trending-up':'arrow-right-up','trending-down':'arrow-right-down','minus':'subtract','trophy':'trophy','user-round':'account-circle',
  'user-x':'user-unfollow','user':'user','users':'group','x':'close','bar-chart-2':'bar-chart','award':'medal','activity':'pulse','zap':'flashlight',
  'message-square':'chat-1','lock':'lock','pencil':'pencil','check':'check','search':'search','more-horizontal':'more','layers':'stack',
  'history':'history','file-text':'file-text','sparkles':'sparkling','command':'command','target':'focus-3','flag':'flag','link':'link',
  'external-link':'external-link','copy':'file-copy','check-circle':'checkbox-circle','bell':'notification-3','info':'information',
  'filter':'filter-3','refresh':'refresh','upload':'upload-2','download':'download-2',
  // nuevos (rediseño)
  'medal-gold':'medal-2','medal':'medal','crown':'vip-crown','pie-chart':'pie-chart-2','radar':'radar','funnel':'filter-3','label':'price-tag-3',
  'grid-heat':'grid','id-card':'profile','graduation':'graduation-cap','swap':'arrow-left-right','drag':'draggable','calendar-range':'calendar-2',
  'file-add':'file-add','flag-2':'flag-2','notes':'sticky-note','shield-user':'user-star','bookmark':'bookmark','group-2':'team','mail':'mail',
  // nuevos (criterios dinámicos, preferencias, asignación, notificaciones, onboarding, manuales)
  'chevron-up':'arrow-up-s','arrow-up':'arrow-up','arrow-down':'arrow-down','book-open':'book-open','question':'question','rocket':'rocket-2',
  'check-double':'check-double','file-excel':'file-excel-2','file-pdf':'file-pdf-2','timeline':'timeline-view','compass':'compass-3','user-add':'user-add',
  'user-settings':'user-settings','lightbulb':'lightbulb','heart':'heart','list-ordered':'list-ordered','line-chart':'line-chart','file-download':'file-download',
  'checkbox':'checkbox-blank','team':'team','at':'at','scales':'scales-3','history-2':'history','mail-open':'mail-open','notification-off':'notification-off',
};
// variantes rellenas (estado activo, medallas): clave nueva = nombre + '-fill'
const RELLENAS = ['home-5','dashboard','calendar','trophy','medal','medal-2','star','user','group','bookmark','flag','notification-3','checkbox-circle','clipboard'];
const r = await fetch(`https://cdn.jsdelivr.net/npm/@iconify-json/ri@${VER}/icons.json`);
if (!r.ok) throw new Error('no se pudo descargar el pack: ' + r.status);
const ri = (await r.json()).icons;
const cuerpo = n => ri[n]?.body;
const out = {};
let faltan = 0;
for (const [k, nombre] of Object.entries(MAPA)) {
  const body = cuerpo(nombre + '-line') || cuerpo(nombre);
  if (!body) { console.error('FALTA', k, '→', nombre); faltan++; continue; }
  out[k] = body.replace(/\s*fill="currentColor"/g, '');
}
for (const nombre of RELLENAS) {
  const body = cuerpo(nombre + '-fill');
  if (body) out[nombre + '-fill'] = body.replace(/\s*fill="currentColor"/g, '');
}
const js = fs.readFileSync(new URL('../core/iconos.js', import.meta.url), 'utf8');
const tail = js.slice(js.indexOf('const lucide = {'));   // conserva el shim
const cab = `'use strict';
/**
 * Pack de iconos: Remix Icon v4 (Apache-2.0) vía @iconify-json/ri v${VER}. Generado por
 * tools/generar-iconos.mjs — no editar a mano. Alojado en el propio sitio:
 * sin CDN de iconos, sin permiso nuevo en la CSP.
 * La clave es el nombre que usan los data-lucide del marcado; '<nombre>-fill' es la
 * variante rellena (estado activo, medallas). Cuadrícula de 24.
 */
const ICONOS_SVG = ${JSON.stringify(out)};

/* Nombre del archivo ya no importa: el marcado conserva data-lucide="…" y este
   shim lo sustituye por un <svg> en línea (sin CDN). Si falta un nombre, se
   quita el atributo y la página sigue. */
`;
fs.writeFileSync(new URL('../core/iconos.js', import.meta.url), cab + tail);
console.log(Object.keys(out).length, 'iconos,', faltan, 'faltan');
