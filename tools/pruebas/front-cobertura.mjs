// Pruebas de la cobertura de la evaluación en el perfil (core/evaluacion-perfil.js · coberturaHTML; migración 0056).
import fs from 'node:fs';
import vm from 'node:vm';
const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rd = f => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };

const ctx = vm.createContext({ console, Intl, fmtNum: n => String(n), API: {}, Tareas: {} });
vm.runInContext(rd('config.js').match(/function escHtml\(s\) \{[\s\S]*?\n\}/)[0] + '\n' + rd('core/evaluacion-perfil.js') + '\nglobalThis.__E = EvaluacionPerfil;', ctx);
const E = ctx.__E;
const T = { tu: 'tu' };
const fila = (o = {}) => ({ nucleo_aplicables: 5, nucleo_puntuados: 5, tecnico_aplicables: 6, tecnico_puntuados: 6, peso_tecnico: 100, peso_puntuado: 100, ...o });

console.log('[cobertura]');
ok(E.coberturaHTML({ ok: true, fila: fila() }, T) === '', 'con todo puntuado no hay nada que explicar: no se pinta');
ok(E.coberturaHTML(null, T) === '' && E.coberturaHTML({ ok: false, noDisponible: true }, T) === '' && E.coberturaHTML({ ok: true, fila: null }, T) === '', 'sin 0056, sin permiso o sin evaluación: no se pinta nada (ni error)');
let h = E.coberturaHTML({ ok: true, fila: fila({ tecnico_puntuados: 5, peso_puntuado: 85 }) }, T);
ok(/5 de 6<\/b> competencias del rol \(85 % del peso técnico\)/.test(h) && !/competencias comunes/.test(h), 'dice cuántas competencias del rol se puntuaron y qué parte del peso técnico');
h = E.coberturaHTML({ ok: true, fila: fila({ nucleo_puntuados: 4, tecnico_puntuados: 5, peso_puntuado: 90 }) }, { tu: 'su' });
ok(/4 de 5<\/b> competencias comunes y <b>5 de 6/.test(h) && /Cobertura de su evaluación/.test(h), 'núcleo y técnicas juntas; «su» cuando la mira otra persona');
ok(/se excluye del cálculo/.test(h) && /no cuenta como 0/.test(h), 'explica la regla: lo no puntuado se excluye, no vale 0');
const x = E.coberturaHTML({ ok: true, fila: { nucleo_aplicables: '<img src=x onerror=1>', nucleo_puntuados: 0, tecnico_aplicables: 1, tecnico_puntuados: 0, peso_tecnico: 'x', peso_puntuado: 'y' } }, T);
ok(!/<img/.test(x), 'solo números llegan al HTML (nada de texto de la base)');
const src = rd('core/evaluacion-perfil.js'), api = rd('api.js');
ok(/coberturaHTML\(cb, T\)/.test(src) && /getCoberturaEvaluacion\(periodo\.id, personaId\)/.test(src), 'la sección «Cómo se compone tu evaluación» la muestra');
ok(/getCoberturaEvaluacion/.test(api) && /evaluacion_cobertura/.test(api), 'API.getCoberturaEvaluacion llama a evaluacion_cobertura');
const mig = rd('supabase/migrations/0056_cobertura_evaluacion.sql');
ok(!/CREATE OR REPLACE FUNCTION public\.resultados_periodo/.test(mig), 'la migración NO redefine resultados_periodo (no cambia ningún resultado)');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
