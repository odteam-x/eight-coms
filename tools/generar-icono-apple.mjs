// Genera icono-180.png (apple-touch-icon) a partir de icono-512.png, sin dependencias.
// iOS exige 180×180 opaco; el icono-512 ya trae el isotipo sobre el fondo navy de la marca.
// Uso: node tools/generar-icono-apple.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const ORIGEN = new URL('../icono-512.png', import.meta.url);
const DESTINO = new URL('../icono-180.png', import.meta.url);
const LADO = 180;

function decodificar(buf) {
  let p = 8, w, h, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), tipo = buf.toString('ascii', p + 4, p + 8), dat = buf.subarray(p + 8, p + 8 + len);
    if (tipo === 'IHDR') { w = dat.readUInt32BE(0); h = dat.readUInt32BE(4); if (dat[8] !== 8 || dat[9] !== 6 || dat[12] !== 0) throw new Error('Se esperaba RGBA de 8 bits sin entrelazado'); }
    if (tipo === 'IDAT') idat.push(dat);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), bpp = 4, fila = w * bpp, out = Buffer.alloc(h * fila);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (fila + 1)], src = raw.subarray(y * (fila + 1) + 1, (y + 1) * (fila + 1));
    for (let x = 0; x < fila; x++) {
      const a = x >= bpp ? out[y * fila + x - bpp] : 0, b = y ? out[(y - 1) * fila + x] : 0, c = x >= bpp && y ? out[(y - 1) * fila + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      out[y * fila + x] = v & 255;
    }
  }
  return { w, h, px: out };
}

const crc = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return (b) => { let c = ~0; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; }; })();
const trozo = (tipo, dat) => { const b = Buffer.alloc(12 + dat.length); b.writeUInt32BE(dat.length, 0); b.write(tipo, 4, 'ascii'); dat.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + dat.length)), 8 + dat.length); return b; };

const { w, h, px } = decodificar(readFileSync(ORIGEN));
const esc = w / LADO, sal = Buffer.alloc(LADO * (LADO * 3 + 1));
for (let y = 0; y < LADO; y++) {
  for (let x = 0; x < LADO; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = Math.floor(y * esc); yy < Math.min(h, Math.ceil((y + 1) * esc)); yy++)
      for (let xx = Math.floor(x * esc); xx < Math.min(w, Math.ceil((x + 1) * esc)); xx++) {
        const i = (yy * w + xx) * 4, a = px[i + 3] / 255;     // sobre navy si hubiera transparencia
        r += px[i] * a + 0x00 * (1 - a); g += px[i + 1] * a + 0x22 * (1 - a); b += px[i + 2] * a + 0x47 * (1 - a); n++;
      }
    const o = y * (LADO * 3 + 1) + 1 + x * 3;
    sal[o] = Math.round(r / n); sal[o + 1] = Math.round(g / n); sal[o + 2] = Math.round(b / n);
  }
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(LADO, 0); ihdr.writeUInt32BE(LADO, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(DESTINO, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', deflateSync(sal, { level: 9 })), trozo('IEND', Buffer.alloc(0))]));
console.log('icono-180.png generado');
