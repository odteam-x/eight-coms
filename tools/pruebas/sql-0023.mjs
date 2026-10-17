// Pruebas de 0023 (puntuación por peso) contra Postgres real (PGlite), con RLS.
// Orden deliberado: primero se guardan evaluaciones con las migraciones 0015 + 0020 (1–5), LUEGO se aplica 0023
// y se comprueba que lo viejo se calcula igual y que lo nuevo puntúa de 0 a su peso.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const R = DIR + '../../supabase/migrations/';
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };
const q = async s => (await db.query(s)).rows;
const as = async (uid, role = 'authenticated') => {
  await db.exec('RESET ROLE');
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid ?? ''}',false)`);
  await db.exec(`SET ROLE ${role}`);
};
const root = async () => { await db.exec('RESET ROLE'); await db.exec(`SELECT set_config('request.jwt.claim.sub','',false)`); };
async function rejects(sql, patron, msg) {
  try { await db.exec(sql); ok(false, msg + ' (NO fue rechazado)'); }
  catch (e) { ok(!patron || new RegExp(patron, 'i').test(e.message), msg + ' → ' + String(e.message).slice(0, 100)); }
}
async function allowed(sql, msg) {
  try { await db.exec(sql); ok(true, msg); } catch (e) { ok(false, msg + ' → ' + String(e.message).slice(0, 140)); }
}
const uid = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const ADMIN = uid(90), M1 = uid(1), M2 = uid(2), M3 = uid(3), M4 = uid(4);
const J = o => JSON.stringify(o).replace(/'/g, "''");

await db.exec(fs.readFileSync(DIR + 'stub.sql', 'utf8'));
await db.exec(`
  INSERT INTO gestiones(nombre, activa) VALUES ('2026-2027', true);
  INSERT INTO periodos_evaluacion(gestion_id,nombre) SELECT id,'LEG' FROM gestiones WHERE activa;
`);
await db.exec(fs.readFileSync(R + '0015_rubrica_v2.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0015_seed_perfiles.PENDIENTE.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0020_criterios_dinamicos.sql', 'utf8'));
await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
               GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;`);
const G = (await q(`SELECT id FROM gestiones WHERE activa`))[0].id;
const rolFoto = (await q(`SELECT id FROM roles WHERE nombre='Fotografía'`))[0].id;
await db.exec(`
  INSERT INTO profiles(id,nombre,es_admin) VALUES ('${ADMIN}','Admin',true);
  INSERT INTO profiles(id,nombre,rol_id,distrito) VALUES ('${M1}','M1',${rolFoto},'08-01'),('${M2}','M2',${rolFoto},'08-01'),
         ('${M3}','M3',${rolFoto},'08-01'),('${M4}','M4',${rolFoto},'08-01');
  INSERT INTO periodos_evaluacion(gestion_id,nombre,modelo) VALUES (${G},'PE1','v2');
`);
const PE = (await q(`SELECT id FROM periodos_evaluacion WHERE nombre='PE1'`))[0].id;
const perfil = (await q(`SELECT public.perfil_vigente(${rolFoto}, '${PE}') id`))[0].id;
const tec = await q(`SELECT criterio_key k, peso FROM perfil_criterios WHERE perfil_id=${perfil} ORDER BY criterio_key`);
const nuc = (await q(`SELECT key FROM criterios_v2 WHERE gestion_id=${G} AND tipo='nucleo' AND tipo_campo='escala' AND activo`)).map(x => x.key);
ok(tec.reduce((s, x) => s + x.peso, 0) === 100 && nuc.length === 5, `el perfil de Fotografía suma 100 (${tec.map(x => x.k + ':' + x.peso).join(' ')}) y el núcleo tiene 5 criterios`);

// ── Antes de 0023: M1 evaluado en la escala de siempre (todo 3 de 5 → 50) ──
await as(ADMIN);
const todo = v => ({ ...Object.fromEntries(nuc.map(k => [k, v])), ...Object.fromEntries(tec.map(x => [x.k, v])) });
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE}','${M1}','${J(todo(3))}','publicado')`);
const antes = (await q(`SELECT nucleo, tecnico, individual, general FROM resultados_periodo('${PE}')`))[0];
ok(Number(antes.nucleo) === 50 && Number(antes.tecnico) === 50 && Number(antes.individual) === 50, 'antes de 0023: todo 3 de 5 = 50/50/50');

// ── Aplicar 0023 (dos veces) ──
await root();
await db.exec(fs.readFileSync(R + '0023_puntuacion_por_peso.sql', 'utf8'));
await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
               GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;`);
await db.exec(fs.readFileSync(R + '0023_puntuacion_por_peso.sql', 'utf8'));
console.log('— 0023 aplicada sin errores (dos veces: es idempotente)');

console.log('\n[la historia no cambia]');
await root();
ok((await q(`SELECT escala FROM evaluaciones WHERE evaluado_id='${M1}'`))[0].escala === 'cinco', 'la evaluación existente quedó en escala «cinco»');
await as(ADMIN);
let r = (await q(`SELECT nucleo, tecnico, individual, general, escala FROM resultados_periodo('${PE}')`))[0];
ok(Number(r.nucleo) === Number(antes.nucleo) && Number(r.tecnico) === Number(antes.tecnico) && Number(r.individual) === Number(antes.individual), 'su resultado es idéntico al de antes de 0023');
ok(r.escala === 'cinco', 'resultados_periodo informa la escala');
await allowed(`UPDATE evaluaciones SET puntajes='${J(todo(4))}' WHERE evaluado_id='${M1}'`, 'una evaluación «cinco» se sigue guardando de 1 a 5');
await rejects(`UPDATE evaluaciones SET puntajes='${J(todo(6))}' WHERE evaluado_id='${M1}'`, '1 a 5', 'y un 6 sigue rechazado');
await rejects(`UPDATE evaluaciones SET puntajes='${J({ ...todo(4), [nuc[0]]: 0 })}' WHERE evaluado_id='${M1}'`, '1 a 5', 'y un 0 también (en «cinco» el mínimo es 1)');
await db.exec(`UPDATE evaluaciones SET escala='pesos' WHERE evaluado_id='${M1}'`);
await root();
ok((await q(`SELECT escala FROM evaluaciones WHERE evaluado_id='${M1}'`))[0].escala === 'cinco', 'el cliente no puede cambiar la escala de una evaluación existente');

console.log('\n[evaluaciones nuevas: de 0 a su peso]');
await as(ADMIN);
const pesos = full => ({ ...Object.fromEntries(nuc.map(k => [k, full ? 10 : 0])), ...Object.fromEntries(tec.map(x => [x.k, full ? x.peso : 0])) });
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado,escala) VALUES ('${PE}','${M2}','${J(pesos(true))}','publicado','cinco')`);
await root();
ok((await q(`SELECT escala FROM evaluaciones WHERE evaluado_id='${M2}'`))[0].escala === 'pesos', 'una evaluación nueva es «pesos» aunque el cliente mande «cinco»');
await as(ADMIN);
r = (await q(`SELECT nucleo, tecnico, individual, escala FROM resultados_periodo('${PE}') WHERE evaluado_id='${M2}'`))[0];
ok(Number(r.nucleo) === 100 && Number(r.tecnico) === 100 && Number(r.individual) === 100 && r.escala === 'pesos', 'todo al máximo de su peso = 100/100/100');
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE}','${M3}','${J(pesos(false))}','publicado')`);
r = (await q(`SELECT nucleo, tecnico, individual FROM resultados_periodo('${PE}') WHERE evaluado_id='${M3}'`))[0];
ok(Number(r.nucleo) === 0 && Number(r.tecnico) === 0 && Number(r.individual) === 0, 'todo en 0 = 0 (el 0 es un puntaje válido en «pesos»)');

const t0 = tec[0], t1 = tec[1];
const mitad = { ...pesos(false), [t0.k]: t0.peso, [t1.k]: Math.floor(t1.peso / 2) };
await db.exec(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes,estado) VALUES ('${PE}','${M4}','${J(mitad)}','publicado')`);
const esperado = Math.round(((t0.peso + Math.floor(t1.peso / 2)) * 100 / tec.reduce((s, x) => s + x.peso, 0)) * 10) / 10;
r = (await q(`SELECT tecnico FROM resultados_periodo('${PE}') WHERE evaluado_id='${M4}'`))[0];
ok(Math.abs(Number(r.tecnico) - esperado) < 0.11, `técnico = Σ puntos · 100 / Σ pesos (${r.tecnico} ≈ ${esperado})`);

console.log('\n[límites]');
await db.exec(`DELETE FROM evaluaciones WHERE evaluado_id='${M4}'`);
await rejects(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes) VALUES ('${PE}','${M4}','${J({ [t0.k]: t0.peso + 1 })}')`, `0 a ${t0.peso}`, `un técnico no pasa de su peso (${t0.peso})`);
await rejects(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes) VALUES ('${PE}','${M4}','${J({ [nuc[0]]: 11 })}')`, '0 a 10', 'un núcleo no pasa de 10');
await rejects(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes) VALUES ('${PE}','${M4}','${J({ [t0.k]: -1 })}')`, '0 a', 'no hay negativos');
await rejects(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes) VALUES ('${PE}','${M4}','${J({ [t0.k]: 1.5 })}')`, 'entero', 'no hay decimales');
await rejects(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes) VALUES ('${PE}','${M4}','${J({ [t0.k]: '7' })}')`, 'numero', 'ni texto');
await rejects(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes) VALUES ('${PE}','${M4}','${J({ fluidez_fantasma: 3 })}')`, 'no aplica', 'un criterio que no es del perfil sigue rechazado');
await allowed(`INSERT INTO evaluaciones(periodo_id,evaluado_id,puntajes) VALUES ('${PE}','${M4}','${J({ [t0.k]: t0.peso, [nuc[0]]: 10 })}')`, 'el máximo exacto (peso / 10) sí vale');

console.log('\n[publicar sigue exigiendo lo obligatorio]');
await rejects(`UPDATE evaluaciones SET estado='publicado' WHERE evaluado_id='${M4}'`, 'faltan por puntuar', 'no se publica con criterios obligatorios sin puntuar');

console.log('\n[ranking mezclando escalas]');
await db.exec(`UPDATE evaluaciones SET puntajes='${J(pesos(true))}', estado='publicado' WHERE evaluado_id='${M4}'`);
const rk = await q(`SELECT nombre, tecnico, percentil, escala FROM resultados_periodo('${PE}') ORDER BY tecnico DESC, nombre`);
ok(rk.length === 4, 'las cuatro personas del rol entran en el cálculo (n_rol = 4, ya no es «rol pequeño»)');
ok(rk.find(x => x.nombre === 'M3').percentil !== null && Number(rk.find(x => x.nombre === 'M3').percentil) === 0, 'la persona con 0 queda en el percentil 0');
ok(Number(rk.find(x => x.nombre === 'M1').tecnico) === 75 && rk.find(x => x.nombre === 'M1').escala === 'cinco', 'la evaluación vieja (4 de 5 = 75) se compara normalizada junto a las nuevas');

console.log('\n[visibilidad intacta]');
await as(M1);
const v = await q(`SELECT nombre FROM resultados_periodo('${PE}')`);
ok(v.length === 1 && v[0].nombre === 'M1', 'un miembro sigue viendo solo lo suyo');
await as(null, 'anon');
await rejects(`SELECT * FROM resultados_periodo('${PE}')`, 'permission', 'anon no puede llamarla');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
