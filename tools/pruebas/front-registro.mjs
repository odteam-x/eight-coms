// El registro pide distrito (o invitado externo) y hasta 2 roles como SOLICITUD; nunca el tipo de acceso. Pruebas de marcado y de código.
import fs from 'node:fs';
const ROOT = new URL('../../', import.meta.url);
const rd = f => fs.readFileSync(new URL(f, ROOT), 'utf8');
let n = 0, mal = 0;
const ok = (c, t) => { n++; if (c) console.log('  ✓ ' + t); else { mal++; console.log('  ✗ ' + t); } };
const html = rd('index.html'), reg = rd('registro.js'), api = rd('api.js'), adm = rd('admin-personas.js');
ok(/id="r-distrito"/.test(html) && /id="r-rol"/.test(html) && /id="r-rol2"/.test(html), 'el formulario tiene distrito, rol y segundo rol');
ok(!/id="r-tipo"/.test(html) && !/tipo:\s*document/.test(reg), 'el registro NO ofrece tipo de acceso: solo miembro (secretaría y administración las asigna la administración)');
ok(/id="r-solicitud" hidden/.test(html) && /getOpcionesRegistro/.test(reg), 'el bloque nace oculto y solo se muestra si la base ofrece las opciones (0070)');
ok(/rol2 === rol/.test(reg) && /Elige tu distrito/.test(reg) && /Elige el rol/.test(reg), 'valida distrito, rol y que el segundo sea distinto');
ok(/registro_opciones/.test(api) && /data\.rol2_id = String\(rol2_id\)/.test(api) && !/data\.tipo/.test(api), 'api: manda distrito y roles en los datos del alta, no el tipo');
ok(/Invitado externo/.test(reg) && /Invitado externo/.test(adm), 'el invitado externo se llama así en el formulario y en la solicitud');
ok(/function renderSolicitudes/.test(adm) && /solAprobar/.test(adm) && /id="usr-solicitudes"/.test(rd('admin.html')) && /solAprobar/.test(rd('config.js')), 'Personas y accesos muestra las solicitudes con su botón Aprobar');
ok(/rail-pend/.test(adm) && /rail-pend/.test(rd('vidrio.css')), 'el menú marca cuántos accesos esperan');
ok(/0070/.test(rd('docs/auditoria/06-registro-migraciones.md')), 'la migración 0070 está en el registro');
console.log('\n' + (n - mal) + ' correctas, ' + mal + ' fallidas'); process.exit(mal ? 1 : 0);
