// Descarga los iconos Phosphor (regular) que usa el sitio y los empaqueta en
// core/iconos.js. Solo desarrollo: el sitio sigue sin build ni CDN de iconos.
//   node tools/generar-iconos.mjs
import fs from 'node:fs';
const VER = '2.1.1';
// nombre que usa el código (data-lucide) → icono Phosphor
const MAPA = {
  'alarm-clock':'alarm','alert-triangle':'warning','archive':'archive','arrow-right':'arrow-right','arrow-left':'arrow-left',
  'calendar':'calendar-blank','calendar-days':'calendar-dots','calendar-plus':'calendar-plus','camera':'camera','chevrons-left':'caret-double-left',
  'chevron-left':'caret-left','chevron-right':'caret-right','chevron-down':'caret-down','circle-check':'check-circle','clipboard-check':'clipboard-text',
  'clipboard-list':'clipboard-text','clock':'clock','eye':'eye','eye-off':'eye-slash','file-bar-chart':'chart-bar','file-pen':'note-pencil',
  'folder-open':'folder-open','house':'house','inbox':'tray','layout-dashboard':'squares-four','layout-grid':'squares-four','list':'list',
  'list-checks':'list-checks','log-out':'sign-out','map':'map-trifold','map-pin':'map-pin','moon':'moon','pause':'pause','plus-circle':'plus-circle',
  'plus':'plus','printer':'printer','ruler':'ruler','send':'paper-plane-tilt','settings':'gear','shield':'shield-check','sliders-horizontal':'sliders-horizontal',
  'star':'star','sun':'sun','sun-moon':'circle-half','table-2':'table','tag':'tag','trash-2':'trash','trending-up':'trend-up','trending-down':'trend-down',
  'minus':'minus','trophy':'trophy','user-round':'user-circle','user-x':'user-minus','user':'user','users':'users','x':'x','bar-chart-2':'chart-bar',
  'award':'medal','activity':'pulse','zap':'lightning','message-square':'chat-text','lock':'lock','pencil':'pencil-simple','check':'check',
  'search':'magnifying-glass','more-horizontal':'dots-three','layers':'stack','history':'clock-counter-clockwise','file-text':'file-text',
  'sparkles':'sparkle','command':'command','target':'target','flag':'flag','link':'link','external-link':'arrow-square-out','copy':'copy',
  'check-circle':'check-circle','bell':'bell','info':'info','filter':'funnel','refresh':'arrow-clockwise','upload':'upload','download':'download-simple',
};
const out = {};
for (const [k, ph] of Object.entries(MAPA)) {
  const r = await fetch(`https://cdn.jsdelivr.net/npm/@phosphor-icons/core@${VER}/assets/regular/${ph}.svg`);
  if (!r.ok) { console.error('FALTA', k, ph); continue; }
  const svg = await r.text();
  out[k] = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
}
const js = `'use strict';
/**
 * Pack de iconos: Phosphor (regular), v${VER}, MIT. Generado por
 * tools/generar-iconos.mjs — no editar a mano. Alojado en el propio sitio:
 * sin CDN de iconos, sin permiso nuevo en la CSP.
 * La clave es el nombre que ya usan los data-lucide del marcado.
 */
const ICONOS_SVG = ${JSON.stringify(out)};
`;
fs.writeFileSync(new URL('../core/iconos.js', import.meta.url), js);
console.log(Object.keys(out).length, 'iconos');
