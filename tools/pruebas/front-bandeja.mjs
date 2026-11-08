// Pruebas de la Bandeja de trabajo de la secretaría (core/personas.js: bandejaDistrito / bandejaHTML).
import fs from 'node:fs';
import vm from 'node:vm';
const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rd = f => fs.readFileSync(ROOT + f, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };
const ctx = vm.createContext({ console, Intl, Fondo: { clase: () => 1 }, Avatar: {} });
vm.runInContext(rd('config.js').match(/function escHtml\(s\) \{[\s\S]*?\n\}/)[0] + '\n' + rd('core/personas.js') + '\nglobalThis.__B = { bandejaDistrito, bandejaHTML };', ctx);
const { bandejaDistrito: B, bandejaHTML: H } = ctx.__B;
const P = [{ id: 'yo', nombre: 'Secretaria' }, { id: 'a', nombre: 'Ana' }, { id: 'b', nombre: 'Beto' }, { id: 'c', nombre: 'Carla' }];
const o = { hoy: '2026-11-10', yo: 'yo' };
const T = [
  { asignada_a: 'a', estado: 'entregada', entregada_en: '2026-11-08T10:00:00Z' },                      // Ana: 1 por revisar, espera 2
  { asignada_a: 'b', estado: 'en_curso', fecha_limite: '2026-11-05' },                                 // Beto: vencida 5 días
  { asignada_a: 'b', estado: 'devuelta', fecha_limite: '2026-11-09' },                                 // Beto: vencida 1 día
  { asignada_a: 'c', estado: 'bloqueada', fecha_limite: '2026-11-01' },                                // bloqueada: NO es vencida
  { asignada_a: 'c', estado: 'aprobada', fecha_limite: '2026-11-01' },                                 // aprobada: nada
  { asignada_a: 'c', estado: 'en_curso', fecha_limite: '2026-11-10' },                                 // vence hoy: aún no vencida
  { asignada_a: 'yo', estado: 'entregada', entregada_en: '2026-11-01T10:00:00Z' },                    // lo suyo: nadie revisa lo propio
  { asignada_a: 'yo', estado: 'asignada', fecha_limite: '2026-10-01' },                               // lo suyo vencido: no es de su bandeja
];
const b = B(T, P, o);
console.log('[reglas]');
ok(b.filas.length === 2 && b.filas.map(f => f.id).join() === 'b,a', 'solo Beto y Ana; Beto (más atraso) primero');
ok(b.vencidas === 2 && b.porRevisar === 1, 'totales: 2 vencidas, 1 por revisar');
ok(b.filas[0].atraso === 5 && b.filas[1].espera === 2, 'atraso máximo 5 días; la entrega espera 2 días');
ok(!b.filas.some(f => f.id === 'c'), 'una tarea bloqueada, aprobada o que vence hoy no cuenta como vencida');
ok(!b.filas.some(f => f.id === 'yo'), 'lo propio nunca entra en la bandeja');
ok(B([], P, o).filas.length === 0 && B(null, null, o).filas.length === 0, 'sin tareas: bandeja vacía, sin errores');
const emp = B([{ asignada_a: 'a', estado: 'entregada', entregada_en: '2026-11-01T00:00:00Z' }, { asignada_a: 'b', estado: 'entregada', entregada_en: '2026-11-09T00:00:00Z' }], P, o);
ok(emp.filas[0].id === 'a', 'sin atraso, primero quien lleva más tiempo esperando revisión');

console.log('\n[presentación]');
const html = H(b);
ok(/data-act="perfilVer" data-arg="b"/.test(html) && /2 vencidas \(hasta 5 días de atraso\)/.test(html), 'una fila por persona que abre su perfil, con el detalle en texto');
ok(/1 entrega por revisar \(espera 2 días\)/.test(html), 'singular y plural correctos');
ok(!/onclick/.test(html), 'sin onclick');
const xss = H(B([{ asignada_a: 'x', estado: 'entregada', entregada_en: '2026-11-09T00:00:00Z' }], [{ id: 'x', nombre: '<img src=x onerror=alert(1)>' }], o));
ok(!/<img/.test(xss) && /&lt;img/.test(xss), 'el nombre de la persona se escapa (escHtml)');
ok(/Nada pendiente/.test(H(B([], P, o))), 'vacía: dice que no hay nada pendiente');
const muchas = H(B(Array.from({ length: 9 }, (_, i) => ({ asignada_a: 'p' + i, estado: 'entregada', entregada_en: '2026-11-09T00:00:00Z' })), [], o), 6);
ok((muchas.match(/class="fila-aj"/g) || []).length === 6 && /Y 3 personas más/.test(muchas), 'muestra 6 y dice cuántas más hay (enlace a Tareas)');
ok(/bandejaHTML\(bandejaDistrito\(/.test(rd('secretario.js')) && /tareas: lista\.tareas/.test(rd('secretario.js')), 'secretario.js monta la bandeja con las tareas del distrito');

console.log('\n[desempeño del distrito (secretaría)]');
const sj = rd('secretario.js'), sh = rd('secretario.html');
ok(/tab:'desempeno-distrito'/.test(sj) && /id="tab-desempeno-distrito"/.test(sh) && /id="desempeno-distrito-host"/.test(sh), 'hay entrada de menú, pestaña y contenedor');
ok(/tab === 'desempeno-distrito'\) && !isSecretario\(\)/.test(sj), 'un miembro que llega a esa pestaña vuelve a Inicio');
ok(/Desempeno\.montarAdmin\(document\.getElementById\('desempeno-distrito-host'\)\)/.test(sj), 'reutiliza el módulo Desempeño: ninguna fórmula nueva');
ok(!/montarAdmin/.test(rd('user.js')), 'el miembro no monta el modo de administración');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
