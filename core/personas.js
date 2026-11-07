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
    <button type="button" class="pcard sup-marca pat-${Fondo.clase(p)}${p.soyYo ? ' pcard--yo' : ''}" data-act="perfilVer" data-arg="${escHtml(p.id)}"
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
    ? `<button type="button" class="pcard pcard--mini sup-marca pat-${Fondo.clase(p)}" data-act="perfilVer" data-arg="${escHtml(p.id)}" aria-label="Ver el perfil de ${escHtml(p.nombre || 'la persona')}">${cuerpo}</button>`
    : `<article class="pcard pcard--mini sup-marca pat-${Fondo.clase(p)}">${cuerpo}</article>`;
}

/** Cuadrícula de tarjetas, con un mensaje si no hay nadie. */
function rosterHTML(personas, vacio = 'No hay personas que mostrar.') {
  if (!personas.length) return `<div class="empty-box"><div class="empty-txt">${escHtml(vacio)}</div></div>`;
  return `<div class="roster">${personas.map(personaCardHTML).join('')}</div>`;
}

/* ── Bandeja de trabajo de la secretaría ────────────────────────────────
 * Lo que ella puede resolver HOY, agrupado por persona y ordenado por urgencia. Solo reordena hechos que ya vienen de
 * `tareas` (filtradas por RLS a su distrito): no puntúa ni calcula notas.
 *   · vencida  = abierta (asignada / en curso / devuelta) con fecha límite anterior a hoy. «Bloqueada» NO cuenta como
 *     vencida (regla de 0016).
 *   · por revisar = entregada y NO suya (nadie revisa lo propio).
 * Orden: primero quien tiene más días de atraso; luego quien tiene entregas esperando más tiempo.
 * @param {object[]} tareas  filas de tareas del distrito
 * @param {{id:string,nombre?:string}[]} personas
 * @param {{hoy:string, yo:string}} o  hoy = 'YYYY-MM-DD'
 */
function bandejaDistrito(tareas, personas, { hoy, yo }) {
  const nombres = new Map((personas || []).map(p => [p.id, p.nombre || 'Sin nombre']));
  const dias = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  const por = new Map();
  const de = id => { if (!por.has(id)) por.set(id, { id, nombre: nombres.get(id) || 'Sin nombre', vencidas: 0, porRevisar: 0, atraso: 0, espera: 0 }); return por.get(id); };
  for (const t of tareas || []) {
    if (t.asignada_a === yo) continue;
    if (t.estado === 'entregada') {
      const f = de(t.asignada_a); f.porRevisar++;
      const desde = String(t.entregada_en || '').slice(0, 10);
      if (desde) f.espera = Math.max(f.espera, dias(desde, hoy));
    } else if (['asignada', 'en_curso', 'devuelta'].includes(t.estado) && t.fecha_limite && String(t.fecha_limite).slice(0, 10) < hoy) {
      const f = de(t.asignada_a); f.vencidas++;
      f.atraso = Math.max(f.atraso, dias(String(t.fecha_limite).slice(0, 10), hoy));
    }
  }
  const filas = [...por.values()].sort((a, b) => b.atraso - a.atraso || b.espera - a.espera || (b.vencidas + b.porRevisar) - (a.vencidas + a.porRevisar) || a.nombre.localeCompare(b.nombre, 'es'));
  return { filas, vencidas: filas.reduce((s, f) => s + f.vencidas, 0), porRevisar: filas.reduce((s, f) => s + f.porRevisar, 0) };
}

/** Bloque «Bandeja de trabajo»: una fila por persona que abre su perfil; máximo `tope` personas. */
function bandejaHTML(b, tope = 6) {
  if (!b.filas.length) return `<p class="pf-nota">Nada pendiente por ahora: no hay entregas por revisar ni tareas vencidas en tu distrito.</p>`;
  const plural = (n, u, p) => `${n} ${n === 1 ? u : p}`;
  const filas = b.filas.slice(0, tope).map(f => {
    const partes = [];
    if (f.vencidas) partes.push(plural(f.vencidas, 'vencida', 'vencidas') + (f.atraso ? ` (hasta ${plural(f.atraso, 'día', 'días')} de atraso)` : ''));
    if (f.porRevisar) partes.push(plural(f.porRevisar, 'entrega por revisar', 'entregas por revisar') + (f.espera > 0 ? ` (espera ${plural(f.espera, 'día', 'días')})` : ''));
    return `<button type="button" class="fila-aj" data-act="perfilVer" data-arg="${escHtml(f.id)}" aria-label="Abrir el perfil de ${escHtml(f.nombre)}">
      <span class="fila-aj-txt"><span class="fila-aj-t">${escHtml(f.nombre)}</span><span class="fila-aj-d">${escHtml(partes.join(' · '))}</span></span>
      <span class="fila-aj-ind">${f.vencidas + f.porRevisar}</span></button>`;
  }).join('');
  const mas = b.filas.length > tope ? `<p class="pf-nota">Y ${plural(b.filas.length - tope, 'persona más', 'personas más')}. <button type="button" class="pf-enlace" data-act="tab" data-arg="tareas">Ver todas en Tareas<i data-lucide="arrow-right" aria-hidden="true"></i></button></p>` : '';
  return `<div class="lista-aj" role="list" aria-label="Bandeja de trabajo">${filas}</div>${mas}`;
}
