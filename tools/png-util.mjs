// PNG mínimo sin dependencias: decodifica RGBA de 8 bits sin entrelazado y codifica RGBA/RGB. Lo usan los generadores de iconos.
import { inflateSync, deflateSync } from 'node:zlib';

export function decodificar(buf) {
  let p = 8, w, h; const idat = [];
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

/** @param {number} canales 3 (RGB) o 4 (RGBA); `datos` = filas sin filtro, w*canales bytes por fila */
export function codificar(w, h, datos, canales = 4) {
  const fila = w * canales, raw = Buffer.alloc(h * (fila + 1));
  for (let y = 0; y < h; y++) datos.copy(raw, y * (fila + 1) + 1, y * fila, (y + 1) * fila);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = canales === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', deflateSync(raw, { level: 9 })), trozo('IEND', Buffer.alloc(0))]);
}

/**
 * Recorta un cuadrado centrado (`zoom` = fracción del lado que se conserva), lo baja a `lado` px promediando y lo
 * enmascara con un círculo de borde suavizado (supermuestreo 4×4). Devuelve RGBA con las esquinas transparentes.
 */
export function circulo({ w, h, px }, lado, zoom = 1) {
  const corte = Math.min(w, h) * zoom, ox = (w - corte) / 2, oy = (h - corte) / 2, esc = corte / lado, out = Buffer.alloc(lado * lado * 4);
  const ss = 4, r = lado / 2;
  for (let y = 0; y < lado; y++) for (let x = 0; x < lado; x++) {
    let rr = 0, gg = 0, bb = 0, aa = 0, n = 0, dentro = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const fx = x + (sx + .5) / ss, fy = y + (sy + .5) / ss;
      if ((fx - r) ** 2 + (fy - r) ** 2 <= r * r) dentro++;
    }
    const x0 = Math.floor(ox + x * esc), x1 = Math.max(x0 + 1, Math.ceil(ox + (x + 1) * esc)), y0 = Math.floor(oy + y * esc), y1 = Math.max(y0 + 1, Math.ceil(oy + (y + 1) * esc));
    for (let yy = y0; yy < Math.min(h, y1); yy++) for (let xx = x0; xx < Math.min(w, x1); xx++) {
      const i = (yy * w + xx) * 4, a = px[i + 3] / 255;
      rr += px[i] * a; gg += px[i + 1] * a; bb += px[i + 2] * a; aa += a; n++;
    }
    const o = (y * lado + x) * 4;
    out[o] = aa ? Math.round(rr / aa) : 0; out[o + 1] = aa ? Math.round(gg / aa) : 0; out[o + 2] = aa ? Math.round(bb / aa) : 0;
    out[o + 3] = Math.round(255 * (dentro / (ss * ss)) * (n ? aa / n : 0));
  }
  return out;
}

/** ICO con PNG incrustados (Vista+ y todos los navegadores). `imagenes` = [{ lado, png }] */
export function ico(imagenes) {
  const cab = Buffer.alloc(6 + 16 * imagenes.length); cab.writeUInt16LE(0, 0); cab.writeUInt16LE(1, 2); cab.writeUInt16LE(imagenes.length, 4);
  let desp = cab.length;
  imagenes.forEach((im, i) => {
    const o = 6 + 16 * i;
    cab[o] = im.lado >= 256 ? 0 : im.lado; cab[o + 1] = im.lado >= 256 ? 0 : im.lado; cab[o + 2] = 0; cab[o + 3] = 0;
    cab.writeUInt16LE(1, o + 4); cab.writeUInt16LE(32, o + 6); cab.writeUInt32LE(im.png.length, o + 8); cab.writeUInt32LE(desp, o + 12);
    desp += im.png.length;
  });
  return Buffer.concat([cab, ...imagenes.map(i => i.png)]);
}
