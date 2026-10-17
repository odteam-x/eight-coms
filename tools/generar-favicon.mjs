// Iconos REDONDOS a partir de icono-512.png (el isotipo sobre el fondo navy de la marca), sin dependencias.
//   node tools/generar-favicon.mjs
// Genera: favicon.ico (16/32/48), favicon-32.png, favicon-64.png, icono-redondo-192.png, icono-redondo-512.png.
// Se recorta al 74 % central antes de redondear para que el escudo llene el círculo (a 16 px, el margen navy lo volvía ilegible).
// icono-192/512.png NO se tocan: son cuadrados a sangre, para el propósito «maskable» del manifest.
import fs from 'node:fs';
import { decodificar, codificar, circulo, ico } from './png-util.mjs';

const RAIZ = new URL('../', import.meta.url);
const fuente = decodificar(fs.readFileSync(new URL('icono-512.png', RAIZ)));
const png = (lado, zoom = 0.74) => codificar(lado, lado, circulo(fuente, lado, zoom), 4);
const escribe = (nombre, buf) => { fs.writeFileSync(new URL(nombre, RAIZ), buf); console.log(nombre, buf.length + ' B'); };

escribe('favicon-32.png', png(32));
escribe('favicon-64.png', png(64));
escribe('icono-redondo-192.png', png(192, 0.9));
escribe('icono-redondo-512.png', png(512, 0.9));
escribe('favicon.ico', ico([16, 32, 48].map(lado => ({ lado, png: png(lado) }))));
