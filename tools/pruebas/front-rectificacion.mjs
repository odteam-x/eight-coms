// Pruebas del lado cliente de 0053: una evaluación publicada se rectifica con motivo, nunca con un upsert silencioso.
import fs from 'node:fs';
import vm from 'node:vm';
const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rd = f => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };

// ── API.guardarEvaluacion con un SB de mentira ──
const llamadas = [];
let previa = null, versionCol = true;
const SB = {
  from: t => ({
    select: () => ({
      limit: async () => ({ error: versionCol ? null : { message: 'column evaluaciones.version does not exist' } }),
      eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: previa }) }) }),
    }),
    upsert: p => { llamadas.push(['upsert', p.estado]); return { select: () => ({ single: async () => ({ data: { id: 1, ...p }, error: null }) }) }; },
  }),
  rpc: async (n, a) => { llamadas.push([n, a]); return { data: 2, error: null }; },
};
const ctx = vm.createContext({ SB, console, Intl, AbortController, setTimeout, SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'y' });
const src = rd('api.js').replace(/^'use strict';/m, '');
vm.runInContext(src + '\nglobalThis.__API = API;', ctx);
const API = ctx.__API;
const D = { periodo_id: 'p', evaluado_id: 'u', evaluador_id: 'a', puntajes: { a: 1 }, comentarios: {}, bono_ext: 0 };
const motivos = [];
const pedir = acc => { motivos.push(acc); return Promise.resolve('Error de digitación'); };
const nada = () => Promise.resolve(null);

console.log('[guardar una evaluación]');
previa = null; llamadas.length = 0;
let r = await API.guardarEvaluacion({ ...D, estado: 'publicado' }, pedir);
ok(llamadas.length === 1 && llamadas[0][0] === 'upsert' && motivos.length === 0, 'una evaluación nueva se publica con el upsert de siempre, sin pedir motivo');
previa = { id: 7, estado: 'borrador' }; llamadas.length = 0;
await API.guardarEvaluacion({ ...D, estado: 'publicado' }, pedir);
ok(llamadas[0][0] === 'upsert' && motivos.length === 0, 'un borrador se publica sin motivo');

console.log('\n[ya publicada]');
previa = { id: 7, estado: 'publicado' }; llamadas.length = 0;
r = await API.guardarEvaluacion({ ...D, estado: 'publicado' }, pedir);
ok(llamadas.length === 1 && llamadas[0][0] === 'rectificar_evaluacion' && motivos.at(-1) === 'rectificar', 'confirmar cambios llama a rectificar_evaluacion (no a un upsert) y pide motivo');
ok(llamadas[0][1].p_id === 7 && llamadas[0][1].p_motivo === 'Error de digitación', 'con el id y el motivo');
ok(r.ok && r.rectificada && r.version === 2, 'devuelve la nueva versión');
llamadas.length = 0;
r = await API.guardarEvaluacion({ ...D, estado: 'publicado' }, nada);
ok(r.cancelado === true && llamadas.length === 0, 'sin motivo (se cierra el cuadro) no se hace nada');
llamadas.length = 0;
r = await API.guardarEvaluacion({ ...D, estado: 'borrador' }, pedir);
ok(llamadas[0][0] === 'retirar_evaluacion' && llamadas[1][0] === 'upsert' && motivos.at(-1) === 'retirar', 'volver a borrador = retirar con motivo y luego guardar lo editado');
llamadas.length = 0;
r = await API.guardarEvaluacion({ ...D, estado: 'borrador' }, nada);
ok(r.cancelado && llamadas.length === 0, 'retirar sin motivo tampoco hace nada');

console.log('\n[base sin 0053]');
const api2 = vm.runInContext('(() => { API._rectDisp = null; return API; })()', ctx);
versionCol = false; ctx.__API._rectDisp = null; llamadas.length = 0; previa = { id: 7, estado: 'publicado' };
await API.guardarEvaluacion({ ...D, estado: 'publicado' }, pedir);
ok(llamadas.length === 1 && llamadas[0][0] === 'upsert', 'sin 0053 se conserva el guardado de siempre (el front puede salir antes que el SQL)');

console.log('\n[admin.js y api.js]');
const adm = rd('admin.js'), api = rd('api.js');
ok(!/API\.upsertEvaluacion\(/.test(adm), 'admin.js ya no llama a upsertEvaluacion directamente');
ok((adm.match(/API\.guardarEvaluacion\(/g) || []).length === 2, 'las dos rutas (clásica y por roles) pasan por guardarEvaluacion');
ok((adm.match(/pedirMotivoEvaluacion\)/g) || []).length >= 2 && /function pedirMotivoEvaluacion/.test(adm), 'y piden el motivo con un cuadro propio');
ok(/rectificarEvaluacion|retirarEvaluacion|getVersionesEvaluacion/.test(api), 'api.js expone rectificar, retirar e historial');
ok(!/onclick|innerHTML\s*=.*motivo/.test(adm.slice(adm.indexOf('function pedirMotivoEvaluacion'), adm.indexOf('async function saveEvaluacion'))), 'el cuadro no usa onclick ni inyecta el motivo');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
