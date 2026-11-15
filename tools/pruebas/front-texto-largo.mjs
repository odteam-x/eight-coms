// Texto largo en tareas: topes de pantalla alineados con la base (0060) y «Ver todo» seguro.
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const rd = f => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA: ' + m)); if (c) console.log('  ✓', m); };

console.log('[topes de pantalla = topes de la base (0060)]');
ok(/id="asig-desc" rows="6" maxlength="20000"/.test(rd('core/asignar.js')), 'Nueva tarea (asignar): «Qué se espera» admite 20 000 caracteres');
ok(/label: 'Qué se espera', filas: 6, max: 20000/.test(rd('core/tareas.js')), 'Editar tarea: «Qué se espera» admite 20 000');
const eq = rd('core/equipos.js');
ok((eq.match(/label: 'Descripción', filas: 6, max: 20000/g) || []).length === 2, 'Tarea de equipo (crear y editar): descripción 20 000');
ok((eq.match(/label: 'Instrucciones', filas: 6, max: 20000/g) || []).length === 2, 'Tarea de equipo (crear y editar): instrucciones 20 000');
ok((eq.match(/label: 'Criterios de evaluación', filas: 3, max: 5000/g) || []).length === 2, 'Criterios de evaluación 5 000');
const mig = rd('supabase/migrations/0060_tareas_texto_largo.sql');
ok(/'tareas',\s+'descripcion',\s+20000/.test(mig) && /'tareas_equipo',\s+'instrucciones',\s+20000/.test(mig), 'la migración 0060 sube los mismos topes en la base');

console.log('\n[«Ver todo»]');
const ctx = { escHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') };
vm.createContext(ctx);
const ui = rd('core/ui.js');
const ini = ui.indexOf('function textoLargoHTML');
vm.runInContext(ui.slice(ini), ctx);
const f = ctx.textoLargoHTML;
ok(f('') === '' && f(null) === '', 'vacío → nada');
ok(f('Corto').startsWith('<p class="tk-desc">Corto</p>'), 'texto corto: un párrafo, sin desplegable');
const largo = ('Documentación de la página. ').repeat(600);
const h = f(largo);
ok(/<details class="tk-mas">/.test(h) && h.includes(largo.trim()), 'texto largo: <details> y el texto COMPLETO dentro');
ok(/Ver todo \(\d[\d.,\s]*caracteres\)/.test(h), 'dice cuántos caracteres tiene');
ok(!/<script/i.test(f('<script>alert(1)</script>' + 'x'.repeat(900))) && f('<b>hola</b>').includes('&lt;b&gt;'), 'todo se escapa (no entra HTML)');
ok(f('a'.repeat(400)).includes('<details'), 'sin espacios también se recorta (sin romper)');
ok(/white-space: pre-line/.test(rd('tareas.css')), 'los saltos de línea de la documentación se respetan (pre-line)');
console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
