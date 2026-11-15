// Une los capítulos de docs/sistema/ en un solo archivo: docs/DOCUMENTACION-COMPLETA-DEL-SISTEMA.md
//   node tools/compilar-documentacion.mjs
// Se edita cada capítulo (docs/sistema/NN-*.md); el archivo único se regenera, no se edita a mano.
import fs from 'node:fs';
const DIR = new URL('../docs/sistema/', import.meta.url);
const SALIDA = new URL('../docs/DOCUMENTACION-COMPLETA-DEL-SISTEMA.md', import.meta.url);
const capitulos = fs.readdirSync(DIR).filter(x => /^\d\d-.*\.md$/.test(x)).sort();
let out = '# DOCUMENTACIÓN COMPLETA DEL SISTEMA · EIGHT CREATORS LABs\n\n> Versión de un solo archivo. Los capítulos separados están en [`docs/sistema/`](sistema/00-indice.md). Generado con `node tools/compilar-documentacion.mjs`; **edita los capítulos, no este archivo**.\n\n---\n\n';
for (const c of capitulos) {
  const t = fs.readFileSync(new URL(c, DIR), 'utf8')
    .replace(/\]\((\d\d-[^)]*\.md)\)/g, '](sistema/$1)')
    .replace(/\]\(\.\.\/DOCUMENTACION-COMPLETA-DEL-SISTEMA\.md\)/g, '](DOCUMENTACION-COMPLETA-DEL-SISTEMA.md)');
  out += t.trimEnd() + '\n\n---\n\n';
}
fs.writeFileSync(SALIDA, out);
console.log(capitulos.length + ' capítulos · ' + out.split('\n').length + ' líneas · ' + Math.round(Buffer.byteLength(out) / 1024) + ' KB');
