// Evaluar con más espacio: modo enfoque, resumen fijo de una línea y criterios compactos.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const rd = f => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA: ' + m)); if (c) console.log('  ✓', m); };

const html = rd('admin.html'), js = rd('admin.js'), cfg = rd('config.js'), css = rd('vidrio.css');
console.log('[modo enfoque]');
ok(/id="eval-enfoque-btn"[^>]*data-act="evEnfoque"[^>]*aria-pressed="true"/.test(html), 'botón «Mostrar/Ocultar resumen» en la cabecera de Evaluar, accesible (aria-pressed)');
ok(/<div id="tab-evaluar" class="atab-content eval-enfoque">/.test(html), 'por defecto el enfoque está activo');
ok(/evEnfoque: \(\) => alternarEnfoqueEvaluar\(\)/.test(cfg), 'acción registrada en ACCIONES (sin onclick)');
ok(/function iniciarEnfoqueEvaluar/.test(js) && /initPersonas\(\);\s*iniciarEnfoqueEvaluar\(\);/.test(js), 'se aplica la preferencia guardada al iniciar el panel');
ok(/try \{ on = localStorage\.getItem\(_K_ENFOQUE\) !== '0'; \} catch/.test(js) && /try \{ localStorage\.setItem\(_K_ENFOQUE/.test(js), 'localStorage siempre dentro de try/catch');
ok(/#tab-evaluar\.eval-enfoque:has\(\.eval-form-card\) \.eval-chips-host,\s*#tab-evaluar\.eval-enfoque:has\(\.eval-form-card\) \.pantalla-cab > p \{ display: none; \}/.test(css), 'el resumen y la descripción se ocultan SOLO con una evaluación abierta (sin nadie elegido todo queda a la vista)');
console.log('\n[resumen fijo y criterios]');
ok(/\.v2-resumen \{ flex-wrap: nowrap;[^}]*white-space: nowrap/.test(css) && /@media \(max-width: 1099px\) \{ \.v2-resumen \{ flex-wrap: wrap; white-space: normal; \} \}/.test(css), 'el resumen fijo es de una línea en escritorio y envuelve en pantallas pequeñas');
ok(/\.v2-crit > details\.v2-det\[open\] \{ grid-column: 1 \/ -1;/.test(css) && /\.v2-crit:has\(details\.v2-det\[open\]\) > \.eval-com-inp \{ grid-column: 1 \/ -1; \}/.test(css), 'descriptores abiertos ocupan todo el ancho y el comentario baja');
ok(!/#[0-9a-fA-F]{3,8}\b/.test(css.slice(css.indexOf('/* 34. Evaluar con más espacio'))), 'la sección nueva de vidrio.css no usa colores literales');
console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
