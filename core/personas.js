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
  const av = p.avatar_url
    ? `<img src="${escHtml(p.avatar_url)}" alt="" width="52" height="52" loading="lazy">`
    : `<span aria-hidden="true">${escHtml(initials(p.nombre || '') || '?')}</span>`;
  const chips = (p.chips || []).map(c => `
    <span class="pcard-chip${c.aviso ? ' pcard-chip--aviso' : ''}">${c.icono ? `<i data-lucide="${escHtml(c.icono)}" aria-hidden="true"></i>` : ''}${escHtml(c.txt)}</span>`).join('');
  return `
    <button type="button" class="pcard${p.soyYo ? ' pcard--yo' : ''}" data-act="perfilVer" data-arg="${escHtml(p.id)}"
            aria-label="Ver el perfil de ${escHtml(p.nombre || 'la persona')}">
      <span class="pcard-av">${av}</span>
      <span class="pcard-txt">
        <span class="pcard-nombre">${escHtml(p.nombre || 'Sin nombre')}${p.soyYo ? ' <span class="pcard-yo">tú</span>' : ''}</span>
        <span class="pcard-rol">${escHtml(p.rol || '—')}</span>
        ${chips ? `<span class="pcard-chips">${chips}</span>` : ''}
      </span>
      <span class="pcard-valor">
        ${tiene
          ? `${anilloHTML({ valor: p.valor, max: p.max || 100, color: p.color || 'var(--data)', etiqueta: `${fmtNum(p.valor)} de ${p.max || 100}`, decimales: 0 })}
             ${p.nivel ? `<span class="nivel-badge ${escHtml(p.nivel.key)}">${escHtml(p.nivel.label)}</span>` : ''}`
          : `<span class="pcard-sin">${escHtml(p.estado || 'Sin evaluar')}</span>`}
      </span>
    </button>`;
}

/** Cuadrícula de tarjetas, con un mensaje si no hay nadie. */
function rosterHTML(personas, vacio = 'No hay personas que mostrar.') {
  if (!personas.length) return `<div class="empty-box"><div class="empty-txt">${escHtml(vacio)}</div></div>`;
  return `<div class="roster">${personas.map(personaCardHTML).join('')}</div>`;
}
