// Pruebas de 0026: la etiqueta de partida «Hito» pasa a «Evento» sin tocar actividades ni colores.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const R = DIR + '../../supabase/migrations/';
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ FALLA:', m)); if (c) console.log('  ✓', m); };
const q = async s => (await db.query(s)).rows;

await db.exec(fs.readFileSync(DIR + 'stub.sql', 'utf8'));
await db.exec(`INSERT INTO gestiones(nombre, activa) VALUES ('2026-2027', true), ('2025-2026', false);`);
await db.exec(fs.readFileSync(R + '0018_actividades.sql', 'utf8'));   // siembra «Hito» en las dos gestiones
const G1 = (await q(`SELECT id FROM gestiones WHERE activa`))[0].id;
const G2 = (await q(`SELECT id FROM gestiones WHERE NOT activa`))[0].id;
// Una gestión que ya tiene su propio «Evento»: no se debe duplicar.
await db.exec(`DELETE FROM etiquetas WHERE gestion_id=${G2} AND nombre='Evento'; INSERT INTO etiquetas(gestion_id,nombre,tono,orden) VALUES (${G2},'Evento','azul',9)`);
await db.exec(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio,etiqueta_id) SELECT ${G1},'Con hito','2026-11-02',id FROM etiquetas WHERE gestion_id=${G1} AND nombre='Hito'`).catch(async () => {
  await db.exec(`ALTER TABLE actividades DISABLE TRIGGER actividades_fijar`);
  await db.exec(`INSERT INTO actividades(gestion_id,titulo,fecha_inicio,etiqueta_id) SELECT ${G1},'Con hito','2026-11-02',id FROM etiquetas WHERE gestion_id=${G1} AND nombre='Hito'`);
});

await db.exec(fs.readFileSync(R + '0026_etiqueta_evento.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '0026_etiqueta_evento.sql', 'utf8'));
console.log('— 0026 aplicada sin errores (dos veces: es idempotente)');

const nombres = async g => (await q(`SELECT nombre FROM etiquetas WHERE gestion_id=${g} ORDER BY orden`)).map(x => x.nombre);
ok((await nombres(G1)).includes('Evento') && !(await nombres(G1)).includes('Hito'), 'la gestión existente ya no tiene «Hito»: tiene «Evento»');
ok((await q(`SELECT tono FROM etiquetas WHERE gestion_id=${G1} AND nombre='Evento'`))[0].tono === 'cian', 'conserva su color');
ok((await q(`SELECT e.nombre FROM actividades a JOIN etiquetas e ON e.id=a.etiqueta_id WHERE a.titulo='Con hito'`))[0].nombre === 'Evento', 'las actividades que la usaban siguen con ella (ahora «Evento»)');
ok((await nombres(G1)).length === 5, 'siguen siendo 5 etiquetas');
const g2 = await nombres(G2);
ok(g2.filter(n => n === 'Evento').length === 1 && g2.includes('Hito'), 'una gestión con su propio «Evento» no se toca (sin duplicar nombres)');
await db.exec(`INSERT INTO gestiones(nombre) VALUES ('2027-2028')`);
const g3 = (await q(`SELECT id FROM gestiones WHERE nombre='2027-2028'`))[0].id;
ok((await nombres(g3)).join() === 'Entrega,Jornada,Capacitación,Reunión,Evento', 'una gestión nueva se siembra con «Evento»');

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
