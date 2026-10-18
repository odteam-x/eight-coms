'use strict';
/**
 * EIGHT CREATORS LABs — Tarjeta de persona
 * ─────────────────────────────────────────
 * La misma tarjeta para el distrito del secretario y para «Personas» del
 * admin: avatar, nombre, rol, el puntaje del período en un anillo pequeño y
 * avisos (tareas vencidas, por revisar). Al pulsarla se abre su perfil en el
 * panel lateral (data-act="perfilVer", ver core/perfil.js).
 *
 * PRESENTACIÓN. El puntaje ya viene calculado; aquí solo se pinta.
 * Todo dato humano pasa por escHtml().
 *
 * Depende de: config.js, core/render.js, core/rubrica.js, core/ui.js.
 */

/**
 * @param {object}  p
 * @param {string}  p.id
 * @param {string}  p.nombre
 * @param {string}  [p.avatar_url]
 * @param {string}  [p.rol]         nombre del rol
 * @param {number|null} p.valor     puntaje del período (null = sin evaluar)
 * @param {number}  [p.max]         100 en v2, 28/30 en clásica
 * @param {string}  [p.color]       token de relleno del anillo
 * @param {{key:string,label:string}} [p.nivel]
 * @param {Array<{txt:string, aviso?:boolean, icono?:string}>} [p.chips]
 * @param {boolean} [p.soyYo]
 * @param {string}  [p.estado]      texto bajo el anillo cuando no hay valor
 */
function personaCardHTML(p) {
  const tiene = p.valor != null && !Number.isNaN(Number(p.valor));
  const max = p.max || 100;
  const chips = (p.chips || []).map(c => `<span class="etiqueta ${c.aviso ? 'etq-coral' : 'etq-gris'}">${escHtml(c.txt)}</span>`).join('');
  const sub = [p.rol || '—', p.distrito].filter(Boolean).map(escHtml).join(' · ');
  return `
    <button type="button" class="pcard${p.soyYo ? ' pcard--yo' : ''}" data-act="perfilVer" data-arg="${escHtml(p.id)}"
            aria-label="Ver el perfil de ${escHtml(p.nombre || 'la persona')}">
      <span class="pcard-cab">
        ${Avatar.html(p, { tam: 'lg', clase: 'pcard-av' })}
        <span class="pcard-valor">${tiene ? `<b class="pcard-num" style="color:${escHtml(p.color || 'var(--txt)')}">${fmtNum(p.valor, 0)}</b><small>de ${max}</small>` : `<span class="pcard-sin">${escHtml(p.estado || 'Sin evaluar')}</span>`}</span>
      </span>
      <span class="pcard-nombre">${escHtml(p.nombre || 'Sin nombre')}${p.soyYo ? ' <span class="pcard-yo">tú</span>' : ''}</span>
      <span class="pcard-rol">${sub}</span>
      ${tiene ? `<span class="pcard-barra" aria-hidden="true"><i style="width:${Math.max(3, Math.min(100, Number(p.valor) / max * 100))}%;background:${escHtml(p.color || 'var(--data)')}"></i></span>` : ''}
      <span class="pcard-pie">${tiene && p.nivel ? `<span class="nivel-badge ${escHtml(p.nivel.key)}">${escHtml(p.nivel.label)}</span>` : ''}${chips}</span>
    </button>`;
}

/**
 * Tarjeta compacta de una persona (variante `.pcard--mini`): miembro de un PE, integrante de un equipo, cualquier lista
 * corta de personas. Misma base visual que personaCardHTML; el contenedor exterior lleva el fondo y el borde.
 * @param {object} p       { id, nombre, avatar_url?, fondo?, rol?, distrito? }
 * @param {object} [o]
 * @param {string} [o.detalle]  texto bajo el nombre (si falta: rol · distrito)
 * @param {string} [o.extra]    HTML ya escapado para el hueco de la derecha (etiquetas, un botón…)
 * @param {boolean}[o.abre]     true: toda la tarjeta abre el perfil (botón); false: tarjeta informativa (artículo)
 */
function personaMiniHTML(p, { detalle = '', extra = '', abre = true } = {}) {
  const sub = detalle || [p.rol, p.distrito].filter(Boolean).join(' · ');
  const cuerpo = `${Avatar.html(p, { tam: 'md' })}
    <span class="pcard-txt"><span class="pcard-nombre">${escHtml(p.nombre || 'Sin nombre')}</span>${sub ? `<span class="pcard-rol">${escHtml(sub)}</span>` : ''}</span>
    ${extra ? `<span class="pcard-extra">${extra}</span>` : ''}`;
  return abre
    ? `<button type="button" class="pcard pcard--mini" data-act="perfilVer" data-arg="${escHtml(p.id)}" aria-label="Ver el perfil de ${escHtml(p.nombre || 'la persona')}">${cuerpo}</button>`
    : `<article class="pcard pcard--mini">${cuerpo}</article>`;
}

/** Cuadrícula de tarjetas, con un mensaje si no hay nadie. */
function rosterHTML(personas, vacio = 'No hay personas que mostrar.') {
  if (!personas.length) return `<div class="empty-box"><div class="empty-txt">${escHtml(vacio)}</div></div>`;
  return `<div class="roster">${personas.map(personaCardHTML).join('')}</div>`;
}
