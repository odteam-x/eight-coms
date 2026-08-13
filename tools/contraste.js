#!/usr/bin/env node
'use strict';
/**
 * EIGHT CREATORS LABs — Red de seguridad de color
 * ───────────────────────────────────────────────
 * CLAUDE.md afirmaba que todos los contrastes estaban medidos. Diez pares
 * no llegaban a 4.5:1. La frase solo es cierta si algo la comprueba, así
 * que esto lo comprueba.
 *
 *   node tools/contraste.js
 *
 * Qué hace:
 *   1. Lee los tokens de shared.css (:root y [data-theme="light"]) y
 *      resuelve las cadenas de var() hasta llegar a un color real.
 *   2. Compone cada par texto × superficie de LOS DOS temas y falla si
 *      baja de 4.5:1 (texto) o de 3:1 (borde e indicador).
 *   3. Busca hex fuera de :root en los CSS, contra una lista explícita de
 *      excepciones.
 *
 * Sin dependencias: el proyecto no tiene build ni node_modules.
 *
 * Salida: código 0 si todo pasa, 1 si algo falla.
 */

const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const CSS  = ['shared.css', 'admin.css', 'user.css', 'secretario.css', 'login.css'];

/* ══ EXCEPCIONES DE HEX ════════════════════════════════════════════════
 * Cada una necesita motivo. Si añades una sin motivo, el siguiente que lea
 * esto no sabrá si puede tocarla.
 */
const EXCEPCIONES_HEX = [
  { archivo: 'login.css',  patron: /#fff\b/i,
    motivo: 'blanco puro sobre el panel de marca --navy-900 (15.91:1)' },
  { archivo: 'admin.css',  patron: /@media print/,  bloque: true,
    motivo: 'la impresión no tiene tema: el papel es siempre blanco' },
  { archivo: 'shared.css', patron: /--medalla-(oro|plata|bronce)/,
    motivo: 'oro, plata y bronce son semánticos, no decorativos' },
  { archivo: 'admin.css',  patron: /--medalla-(oro|plata|bronce)/,
    motivo: 'ídem, variante de tema claro' },
  { archivo: 'secretario.css', patron: /--medalla-(oro|plata|bronce)/,
    motivo: 'ídem' },
];

/* ══ COLOR ═════════════════════════════════════════════════════════════ */

/** #rgb | #rrggbb | rgb()/rgba() → [r,g,b,a]. Devuelve null si no es color. */
function aRgba(v) {
  if (!v) return null;
  v = String(v).trim();

  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return [...m[1]].map(c => parseInt(c + c, 16)).concat(1);

  m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1);

  m = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (m) {
    const p = m[1].split(/[,/]/).map(x => parseFloat(x.trim()));
    return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 && !Number.isNaN(p[3]) ? p[3] : 1];
  }
  return null;
}

/** Compone un color con alfa sobre un fondo opaco. */
function componer(frente, fondo) {
  const a = frente[3];
  if (a >= 1) return frente;
  return [0, 1, 2].map(i => Math.round(frente[i] * a + fondo[i] * (1 - a))).concat(1);
}

function luminancia([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Ratio WCAG. `frente` puede llevar alfa: se compone sobre `fondo`. */
function ratio(frente, fondo) {
  const f = componer(frente, fondo);
  const [hi, lo] = [luminancia(f), luminancia(fondo)].sort((a, b) => b - a);
  return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
}

/* ══ TOKENS ════════════════════════════════════════════════════════════ */

/** Quita comentarios. Sin esto, un comentario que mencione `--surface-3`
 *  y termine antes de la siguiente declaración se lee como si fuera un
 *  token, el valor sale basura y ESE PAR SE SALTA EN SILENCIO. Es
 *  exactamente el falso negativo que este script existe para evitar. */
const sinComentarios = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Igual, pero conservando la longitud y los saltos de línea, para que los
 *  números de línea sigan correspondiendo al archivo real. Sin esto, el
 *  informe apunta a líneas que no tienen nada que ver. */
const cegarComentarios = css =>
  css.replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' '));

/** Extrae `--nombre: valor;` de un bloque de texto CSS. */
function leerBloque(cssConComentarios, selector) {
  const css = sinComentarios(cssConComentarios);
  const i = css.indexOf(selector);
  if (i < 0) return {};
  // Primer '{' tras el selector, y su '}' de cierre a profundidad 0.
  const ini = css.indexOf('{', i);
  let prof = 0, fin = ini;
  for (let j = ini; j < css.length; j++) {
    if (css[j] === '{') prof++;
    else if (css[j] === '}') { prof--; if (prof === 0) { fin = j; break; } }
  }
  const cuerpo = css.slice(ini + 1, fin);
  const out = {};
  for (const m of cuerpo.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].split('/*')[0].trim();
  }
  return out;
}

/** Resuelve var(--x) encadenados. Devuelve [r,g,b,a] o null. */
function resolver(nombre, tokens, visto = new Set()) {
  if (visto.has(nombre)) return null;          // ciclo
  visto.add(nombre);
  let v = tokens[nombre];
  if (!v) return null;
  const m = /^var\(\s*(--[\w-]+)/.exec(v);
  if (m) return resolver(m[1], tokens, visto);
  return aRgba(v);
}

/* ══ MATRIZ DE PARES ═══════════════════════════════════════════════════
 * Qué token se usa como TEXTO y sobre qué superficies aparece de verdad.
 * Si un token cambia de papel, se actualiza aquí — es el sitio donde vive
 * la afirmación "esto se usa como texto".
 */
const SUPERFICIES = ['--bg', '--surface-1', '--surface-2', '--surface-3'];

/* token → superficies donde SE USA de verdad como texto. Es el sitio donde
 * vive la afirmación "esto se pinta como texto ahí": si un token empieza a
 * usarse en una superficie nueva, se añade aquí y el script lo mide.
 *
 * --action solo aparece como color de texto en la página y en tarjetas:
 * sobre --surface-2 da 4.40 y sobre --surface-3 3.87, y dentro de la
 * paleta cerrada no hay un azul que pase ahí sin invadir --data. Por eso
 * el estado activo del rail y de la barra NO lo usa como texto — lleva la
 * barra en --marca y la etiqueta en --txt. */
const TEXTO = {
  '--txt':          SUPERFICIES,
  '--txt-2':        SUPERFICIES,
  '--txt-muted':    SUPERFICIES,
  '--alert':        SUPERFICIES,
  '--data-txt':     SUPERFICIES,
  '--criterio-txt': SUPERFICIES,
  '--sex-txt':      SUPERFICIES,
  '--sbu-txt':      SUPERFICIES,
  '--spr-txt':      SUPERFICIES,
  '--sba-txt':      SUPERFICIES,
  '--action':       ['--bg', '--surface-1'],
};

/** Pares "sobre su propio relleno": texto y fondo van en pareja. */
const PARES_FIJOS = [
  ['--action-on', '--action-fill', 4.5, 'etiqueta del botón primario'],
  ['--nivel-on',  '--sex',         4.5, 'píldora Excelente'],
  ['--nivel-on',  '--sbu',         4.5, 'píldora Bueno'],
  ['--nivel-on',  '--spr',         4.5, 'píldora En Proceso'],
  ['--nivel-on',  '--sba',         4.5, 'píldora Bajo'],
];

/** Rellenos y ornamentos: umbral 3:1 contra la página. */
const GRAFICOS = [
  ['--data',   '3:1 relleno de barra'],
  ['--sex',    '3:1 relleno de nivel'],
  ['--sbu',    '3:1 relleno de nivel'],
  ['--spr',    '3:1 relleno de nivel'],
  ['--sba',    '3:1 relleno de nivel'],
  ['--marca',  '3:1 ornamento de marca'],
  ['--action', '3:1 anillo de foco'],
];

/* ══ EJECUCIÓN ═════════════════════════════════════════════════════════ */

const shared = fs.readFileSync(path.join(RAIZ, 'shared.css'), 'utf8');
const oscuro = leerBloque(shared, ':root');
const claro  = { ...oscuro, ...leerBloque(shared, '[data-theme="light"]') };

const fallos = [];
const avisos = [];
let comprobados = 0;

for (const [tema, tokens] of [['oscuro', oscuro], ['claro', claro]]) {
  // ── texto sobre superficie ──
  for (const [t, superficies] of Object.entries(TEXTO)) {
    const fg = resolver(t, tokens);
    if (!fg) continue;                       // token opcional que no existe
    for (const s of superficies) {
      const bg = resolver(s, tokens);
      if (!bg) continue;
      comprobados++;
      const r = ratio(fg, bg);
      if (r < 4.5) fallos.push(`${tema}  texto ${t} sobre ${s} = ${r} (mín 4.5)`);
    }
  }
  // ── texto sobre su propio relleno ──
  for (const [fgN, bgN, min, nota] of PARES_FIJOS) {
    const fg = resolver(fgN, tokens), bg = resolver(bgN, tokens);
    if (!fg || !bg) continue;
    comprobados++;
    const r = ratio(fg, bg);
    if (r < min) fallos.push(`${tema}  ${fgN} sobre ${bgN} = ${r} (mín ${min}) — ${nota}`);
  }
  // ── rellenos y ornamentos contra la página ──
  for (const [n, nota] of GRAFICOS) {
    const fg = resolver(n, tokens);
    if (!fg) continue;
    for (const s of ['--bg', '--surface-3']) {
      const bg = resolver(s, tokens);
      if (!bg) continue;
      comprobados++;
      const r = ratio(fg, bg);
      if (r < 3) fallos.push(`${tema}  ${n} sobre ${s} = ${r} (mín 3.0) — ${nota}`);
    }
  }
}

/* ── Hex fuera de :root ── */
function dentroDeBloqueDeTokens(css, pos) {
  for (const sel of [':root', '[data-theme="light"]']) {
    let i = -1;
    while ((i = css.indexOf(sel, i + 1)) >= 0) {
      const ini = css.indexOf('{', i);
      let prof = 0, fin = ini;
      for (let j = ini; j < css.length; j++) {
        if (css[j] === '{') prof++;
        else if (css[j] === '}') { prof--; if (prof === 0) { fin = j; break; } }
      }
      if (pos > ini && pos < fin) return true;
    }
  }
  return false;
}

for (const archivo of CSS) {
  const ruta = path.join(RAIZ, archivo);
  if (!fs.existsSync(ruta)) continue;
  // Un hex citado en una explicación no es un hex usado, pero los números
  // de línea deben seguir siendo los del archivo.
  const css = cegarComentarios(fs.readFileSync(ruta, 'utf8'));

  // Rango de @media print, si lo hay: excepción documentada.
  const rangosExentos = [];
  for (const m of css.matchAll(/@media\s+print\s*\{/g)) {
    let prof = 0, fin = m.index;
    for (let j = css.indexOf('{', m.index); j < css.length; j++) {
      if (css[j] === '{') prof++;
      else if (css[j] === '}') { prof--; if (prof === 0) { fin = j; break; } }
    }
    rangosExentos.push([m.index, fin]);
  }

  for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const pos = m.index;
    if (dentroDeBloqueDeTokens(css, pos)) continue;
    if (rangosExentos.some(([a, b]) => pos > a && pos < b)) continue;

    const linea = css.slice(0, pos).split('\n').length;
    const contexto = css.slice(Math.max(0, pos - 90), pos + 30);
    const exenta = EXCEPCIONES_HEX.find(e => e.archivo === archivo && e.patron.test(contexto) && !e.bloque);
    if (exenta) continue;
    avisos.push(`${archivo}:${linea}  hex fuera de :root → ${m[0]}`);
  }
}

/* ── Informe ── */
const linea = '─'.repeat(66);
console.log(linea);
console.log(`Contraste: ${comprobados} pares comprobados en los dos temas`);
console.log(linea);

if (fallos.length) {
  console.log('\nFALLOS DE CONTRASTE:\n');
  for (const f of fallos) console.log('  ✗ ' + f);
}
if (avisos.length) {
  console.log('\nHEX FUERA DE :root:\n');
  for (const a of avisos) console.log('  ✗ ' + a);
}
if (!fallos.length && !avisos.length) {
  console.log('\n  ✓ sin fallos\n');
  process.exit(0);
}
console.log(`\n${fallos.length} fallo(s) de contraste, ${avisos.length} hex fuera de :root\n`);
process.exit(1);
