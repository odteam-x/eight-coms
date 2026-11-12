// Regla «sin tareas calificadas, se pierden los puntos» (0061): el front solo la ofrece y la envía si la base ya la tiene.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const rd = f => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA: ' + m)); if (c) console.log('  ✓', m); };

const api = rd('api.js'), ev = rd('core/evaluacion-perfil.js'), mig = rd('supabase/migrations/0061_tareas_sin_tareas_pierde_puntos.sql');
ok(/typeof c\.sin_tareas_pierde_puntos === 'boolean' \? \{ p_sin_tareas_pierde_puntos: c\.sin_tareas_pierde_puntos \} : \{\}/.test(api), 'api.js: el parámetro nuevo solo se envía si la configuración ya lo trae (antes de aplicar 0061 la función no lo conoce)');
ok((ev.match(/typeof c\.sin_tareas_pierde_puntos === 'boolean'/g) || []).length === 3, 'evaluacion-perfil.js: la fila de reglas, el selector del editor y el guardado dependen de que la base tenga la regla');
ok(/id: 'pierde', tipo: 'select'.*Sí: tiene 0 en tareas y pierde esos puntos/.test(ev), 'el editor ofrece «No: conserva su evaluación completa» / «Sí: tiene 0 en tareas y pierde esos puntos»');
ok(/aplica a quien no tenga tareas calificadas|Aplica a quien no tenga tareas calificadas/.test(ev) && /también pierden los puntos/.test(ev), 'el editor avisa que con «Sí» también pierden quienes no tuvieron tareas asignadas');
ok(/sin_tareas_pierde_puntos BOOLEAN NOT NULL DEFAULT false/.test(mig), 'la migración deja la regla APAGADA por defecto (nada cambia hasta que la administración la active)');
console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
