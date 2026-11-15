// Lado cliente de 0062: hasta dos roles por persona y evaluación por rol.
import fs from 'node:fs';
import vm from 'node:vm';
const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rd = f => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };

// ── API con un SB de mentira ──
const llamadas = [];
let colErr = null, previa = null;
const SB = {
  from: t => ({
    select: col => ({
      limit: async () => ({ error: colErr }),
      eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: previa }) }) }),
    }),
    upsert: p => { llamadas.push(['upsert', p]); return { select: () => ({ single: async () => ({ data: { id: 1, ...p }, error: null }) }) }; },
  }),
  rpc: async (n, a) => { llamadas.push([n, a]); return { data: 2, error: null }; },
};
const ctx = vm.createContext({ SB, console, Intl, AbortController, setTimeout, SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'y' });
vm.runInContext(rd('api.js').replace(/^'use strict';/m, '') + '\nglobalThis.__API = API;', ctx);
const API = ctx.__API;
const D = { periodo_id: 'p', evaluado_id: 'u', evaluador_id: 'a', puntajes: { a: 1 }, comentarios: {}, bono_ext: 0 };
const pedir = () => Promise.resolve('Corrección del segundo rol');

console.log('[API: puntajes del segundo rol]');
llamadas.length = 0; previa = null;
await API.guardarEvaluacion({ ...D, estado: 'borrador' }, pedir);
ok(!('puntajes_rol2' in llamadas[0][1]), 'una persona SIN segundo rol no manda puntajes_rol2 (sin 0062 la columna no existe y el guardado fallaría)');
llamadas.length = 0;
await API.guardarEvaluacion({ ...D, estado: 'borrador', puntajes_rol2: { x: 3 } }, pedir);
ok(JSON.stringify(llamadas[0][1].puntajes_rol2) === '{"x":3}', 'con segundo rol, el borrador manda sus puntajes técnicos');
llamadas.length = 0; previa = { id: 7, estado: 'publicado', puntajes: { a: 1 }, comentarios: {}, puntajes_rol2: { x: 3 } };
const sin = await API.guardarEvaluacion({ ...D, estado: 'publicado', puntajes_rol2: { x: 3 } }, pedir);
ok(sin.sinCambios === true && llamadas.length === 0, 'publicada y sin cambios (rol 2 igual): no se pide motivo ni se llama a la base');
llamadas.length = 0;
const rect = await API.guardarEvaluacion({ ...D, estado: 'publicado', puntajes_rol2: { x: 9 } }, pedir);
const rpc = llamadas.find(l => l[0] === 'rectificar_evaluacion');
ok(rect.rectificada && rpc && JSON.stringify(rpc[1].p_puntajes_rol2) === '{"x":9}', 'cambiar solo el rol 2 de una publicada la RECTIFICA (con motivo) y manda p_puntajes_rol2');
llamadas.length = 0; previa = { id: 7, estado: 'publicado', puntajes: { a: 1 }, comentarios: {} };
await API.guardarEvaluacion({ ...D, estado: 'publicado', puntajes: { a: 2 } }, pedir);
const rpc1 = llamadas.find(l => l[0] === 'rectificar_evaluacion');
ok(rpc1 && !('p_puntajes_rol2' in rpc1[1]), 'una rectificación de un solo rol NO manda p_puntajes_rol2 (compatible con la base sin 0062)');

console.log('\n[API: ¿la base admite el segundo rol?]');
colErr = null; API._dosRolesDisp = null;
ok(await API.dosRolesDisponible() === true, 'con la columna perfil2_id, está disponible');
colErr = { message: 'column evaluaciones.perfil2_id does not exist' }; API._dosRolesDisp = null;
ok(await API.dosRolesDisponible() === false, 'sin 0062 (la columna no existe), no está disponible y la pantalla sigue con un rol');
colErr = { message: 'network' }; API._dosRolesDisp = null;
ok(await API.dosRolesDisponible() === false && API._dosRolesDisp === null, 'un fallo pasajero no se queda en memoria como «no disponible»');

console.log('\n[Evaluar: formulario del segundo rol]');
const js = rd('admin.js');
ok(/_rolesExtra\[x\.persona_id\] = Number\(x\.rol_id\)/.test(js) && /API\.dosRolesDisponible\(\)/.test(js), 'Evaluar carga quién tiene segundo rol solo si la base lo admite');
ok(/Criterios técnicos de \$\{escHtml\(rol2Nombre\)\} \(segundo rol\)/.test(js), 'el formulario muestra una sección técnica propia del segundo rol');
ok(/key: 'r2:' \+ c\.key/.test(js) && /key\.startsWith\('r2:'\)/.test(js), 'las claves del segundo rol llevan prefijo r2: y escriben en su propio bolsillo (no chocan con las del principal)');
ok(/ap2\.tecnicos\.map\(fila2\)/.test(js) && !/ap2\.nucleo/.test(js), 'el segundo rol solo tiene criterios técnicos: el núcleo se puntúa una vez');
ok(/puntajes_rol2: _formV2\.perfil2Id \? _formV2\.puntajes2 : undefined/.test(js), 'al guardar manda puntajes_rol2 solo si la persona tiene segundo rol');
ok(/faltan2\.length/.test(js) && /del segundo rol \(o déjalo todo sin puntuar\)/.test(js), 'publicar con el segundo rol a medias se bloquea con un mensaje claro (la base lo exige igual)');
ok(/evaluación incompleta/.test(js) && /\(pesa \$\{fmtV2\(r\.peso_rol2\)\} %\)/.test(js), 'el resumen de Evaluar muestra el técnico del segundo rol y su peso, o «evaluación incompleta»');
ok(/\$\{rol2Nombre \? ' \+ ' \+ escHtml\(rol2Nombre\)/.test(js), 'la cabecera del formulario muestra los dos roles («Fotografía + Redacción»)');

console.log('\n[Personas: segundo rol, máximo 2]');
const per = rd('admin-personas.js');
ok(/<select class="cfg-inp cfg-select" id="gp-rol2" data-change="gestionRolPermitido"/.test(per), 'el segundo rol se elige con un selector (uno solo), no con casillas');
ok(/máx\. 2 por persona/.test(per) && /Sin segundo rol/.test(per), 'el límite de 2 roles está visible y se puede dejar sin segundo rol');
ok(/const marcados = el\.value \? \[Number\(el\.value\)\] : \[\]/.test(per), 'guardar reemplaza el conjunto por UN solo rol extra (quita los demás)');
ok(/gp-aviso/.test(per) && /el máximo es 2/.test(per), 'quien ya tenía más de 2 roles ve un aviso y se le pide dejar uno');
ok(!/data-change="gestionRolPermitido"><span>/.test(per), 'ya no quedan casillas de varios roles');

console.log('\n[Perfil: cómo se compone]');
const ep = rd('core/evaluacion-perfil.js');
ok(/function dosRolesHTML\(fila, T\)/.test(ep) && /\$\{dosRolesHTML\(fila, T\)\}/.test(ep), 'la sección «Cómo se compone tu evaluación» explica los dos roles');
ok(/Evaluación incompleta de/.test(ep) && /Nunca se rellena con 0/.test(ep), 'explica la evaluación incompleta del segundo rol (nunca 0)');
ok(/El núcleo se evalúa una sola vez/.test(ep) && /sin tareas, no pesa/.test(ep), 'explica de dónde sale el peso de cada rol (las tareas) y que el núcleo no se repite');

console.log('\n[Migración]');
const m = rd('supabase/migrations/0062_dos_roles_por_persona.sql');
ok(/REVOKE EXECUTE ON FUNCTION public\.rol_secundario_de/.test(m) && /GRANT +EXECUTE ON FUNCTION public\.resultados_periodo/.test(m), 'la ayuda interna no es pública y los resultados solo para sesiones');
ok(/REVERSA/.test(m), 'la migración trae su reversa');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
