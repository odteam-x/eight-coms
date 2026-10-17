'use strict';
/**
 * EIGHT CREATORS LABs — Rúbrica v2: presentación compartida (migración 0015)
 * ──────────────────────────────────────────────────────────────────────────
 * El CÁLCULO vive en la base (resultados_periodo). Este archivo solo pinta:
 * ni una fórmula aquí. Si el cliente recalculara, los tres portales volverían
 * a divergir, que es justo lo que pasó con scoreClass (ver core/render.js).
 *
 * Los tres portales cargan este archivo después de core/render.js.
 * Depende de: config.js (escHtml), core/store.js, core/render.js.
 */

/* ══ NIVELES SOBRE 0–100 ═══════════════════════════════════════════════
 * Proporcionales a los umbrales legacy 26/20/11 sobre 30 (86.7 / 66.7 /
 * 36.7), redondeados: 87 / 67 / 37. Los colores son los mismos tokens que
 * ya validó tools/contraste.js (--sex … --sba y sus -txt).
 */
const NIVELES_V2 = [
  { min: 87,        key: 'sex', label: 'Excelente'  },
  { min: 67,        key: 'sbu', label: 'Bueno'      },
  { min: 37,        key: 'spr', label: 'En Proceso' },
  { min: -Infinity, key: 'sba', label: 'Bajo'       },
];
const nivelV2         = s => NIVELES_V2.find(n => Number(s) >= n.min) || NIVELES_V2[NIVELES_V2.length - 1];
const scoreColorV2    = s => `var(--${nivelV2(s).key})`;
const scoreColorTxtV2 = s => `var(--${nivelV2(s).key}-txt)`;

const esPeriodoV2 = p => p?.modelo === 'v2';

/** 87.5 → "87.5", 50 → "50", null → "—". */
const fmtV2 = n => (n == null || Number.isNaN(Number(n)))
  ? '—' : String(Math.round(Number(n) * 10) / 10);

/** Núcleo en «pesos» (0023): 0 a 10 por criterio, todos pesan igual. */
const ESCALA_NUCLEO_V2 = 10;

/**
 * Rango de puntaje de un criterio según CÓMO se guardó la evaluación.
 *   'cinco' (historia, y todo antes de 0023): 1 a 5.
 *   'pesos' (evaluaciones nuevas): técnico de 0 a su peso en el perfil; núcleo de 0 a 10.
 * Solo presentación: el cálculo oficial es resultados_periodo().
 */
function rangoPuntajeV2(c, escala) {
  if (escala !== 'pesos') return { min: 1, max: 5 };
  return { min: 0, max: c?.tipo === 'nucleo' ? ESCALA_NUCLEO_V2 : (Number(c?.peso) || 0) };
}

/** Un puntaje como porcentaje de barra dentro de SU rango (por defecto 1–5: 1 → 0 %, 5 → 100 %). */
const pctPuntajeV2 = (s, r = { min: 1, max: 5 }) =>
  r.max > r.min ? Math.max(0, Math.min(100, ((Number(s) || r.min) - r.min) / (r.max - r.min) * 100)) : 0;


/* ══ CATÁLOGO Y PERFILES ═══════════════════════════════════════════════ */

const catalogoV2 = () => Store.get('criteriosV2') || [];
const perfilesV2 = () => Store.get('perfiles')    || [];

/**
 * Perfil que rige para un rol en un período. Réplica de perfil_vigente() de
 * la base, solo para decidir QUÉ FORMULARIO mostrar: el servidor vuelve a
 * resolverlo al guardar y es quien manda.
 *
 * `periodos` debe venir en orden de creación (API.getPeriodos lo garantiza).
 */
function perfilVigenteDe(rolId, periodoId, perfiles = perfilesV2(), periodos = Store.periodos()) {
  const pos = id => periodos.findIndex(p => String(p.id) === String(id));
  const iP  = pos(periodoId);
  return perfiles
    .filter(pf => String(pf.rol_id) === String(rolId) && (
      pf.vigente_desde_periodo == null ||
      (pos(pf.vigente_desde_periodo) >= 0 && pos(pf.vigente_desde_periodo) <= iP)))
    .sort((a, b) => b.version - a.version)[0] || null;
}

/**
 * Criterios que aplican a un perfil: el núcleo (idéntico para todos) y los
 * técnicos del rol con su peso. Lo que no está aquí NO se muestra, no se
 * puntúa y no entra al denominador: un criterio que no aplica se excluye,
 * nunca vale cero.
 */
function criteriosAplicables(perfil, catalogo = catalogoV2(), { conservar = [] } = {}) {
  // `conservar`: claves que la evaluación ya contiene. Un criterio desactivado después se sigue mostrando
  // donde ya tiene un valor (historia), pero no se ofrece en evaluaciones nuevas (0020).
  const guardadas = new Set(conservar);
  const vigente   = c => c.activo !== false || guardadas.has(c.key);
  const escala    = c => (c.tipo_campo || 'escala') === 'escala';
  const nucleo = catalogo.filter(c => c.tipo === 'nucleo' && escala(c) && vigente(c))
                         .sort((a, b) => a.orden - b.orden);
  // Campos de registro (sí/no, opciones, texto): comunes a todos los roles, no puntúan.
  const registro = catalogo.filter(c => c.tipo === 'nucleo' && !escala(c) && vigente(c))
                           .sort((a, b) => a.orden - b.orden);
  const pesos  = Object.fromEntries((perfil?.perfil_criterios || []).map(x => [x.criterio_key, x.peso]));
  const tecnicos = catalogo
    .filter(c => c.tipo === 'tecnico' && pesos[c.key] != null && vigente(c))
    .map(c => ({ ...c, peso: pesos[c.key] }))
    .sort((a, b) => b.peso - a.peso || a.orden - b.orden);
  const fuera = catalogo.filter(c => c.tipo === 'tecnico' && pesos[c.key] == null && c.activo !== false);
  return { nucleo, tecnicos, fuera, registro };
}

/* ══ TIPOS DE CAMPO (0020) ═════════════════════════════════════════════ */
const TIPOS_CAMPO = {
  escala: { etiqueta: 'Escala 1–5',  ayuda: 'Un puntaje con anclas de conducta. Entra en el cálculo.' },
  si_no:  { etiqueta: 'Sí / No',     ayuda: 'Una respuesta de registro. No puntúa.' },
  opcion: { etiqueta: 'Opciones',    ayuda: 'Una opción de una lista. No puntúa.' },
  texto:  { etiqueta: 'Texto',       ayuda: 'Una nota libre de hasta 1000 caracteres. No puntúa.' },
};
const tipoCampoDe = c => (TIPOS_CAMPO[c?.tipo_campo] ? c.tipo_campo : 'escala');

/** Una respuesta de registro como texto legible. */
function respuestaTxt(c, v) {
  if (v == null || v === '') return '—';
  if (tipoCampoDe(c) === 'si_no') return v === true ? 'Sí' : 'No';
  return String(v);
}

/** Claves de todo lo puntuable para un perfil. */
const clavesAplicables = (perfil, catalogo) => {
  const a = criteriosAplicables(perfil, catalogo);
  return [...a.nucleo, ...a.tecnicos].map(c => c.key);
};


/* ══ DESCRIPTORES ══════════════════════════════════════════════════════ */

const _NIV_DESC = [[1, 'desc_1'], [3, 'desc_3'], [5, 'desc_5']];

/** Los tres anclajes de conducta de un criterio. 2 y 4 son intermedios. */
function descriptoresHTML(c) {
  return `<div class="v2-desc">
    ${_NIV_DESC.map(([n, k]) => `
      <div class="v2-desc-row">
        <span class="v2-desc-n${n === 5 ? ' v2-desc-n--top' : ''}">${n}</span>
        <p>${escHtml(c[k] || '—')}</p>
      </div>`).join('')}
    <p class="v2-desc-nota">El 2 y el 4 se usan cuando lo observado cae entre dos descriptores.</p>
  </div>`;
}


/**
 * La nota que explica dónde queda la persona dentro de su rol. Existe aparte
 * para que Mi Score y el perfil digan exactamente lo mismo: si la regla de
 * roles pequeños se explica distinto en dos pantallas, se lee como favoritismo.
 * `propio` = la lee la propia persona («tu rol»); si no, quien supervisa («su rol»).
 */
function notaRolV2HTML(fila, propio = true) {
  const pos = propio ? 'Tu' : 'Su';
  const posL = propio ? 'tu' : 'su';
  const n = fila.n_rol;
  return fila.rol_pequeno
    ? `<div class="v2-nota v2-nota--regla" role="note">
         <strong>Regla de roles pequeños.</strong>
         ${pos} rol (${escHtml(fila.rol_nombre || '—')}) tiene ${n} persona${n === 1 ? '' : 's'}
         evaluada${n === 1 ? '' : 's'} en este período, menos de 4: con tan pocos pares el percentil no
         significa nada. Por eso el componente relativo se sustituye por ${propio ? 'tu' : 'el'} score técnico en valor absoluto
         y se evalúa contra la rúbrica, no contra compañeros.
       </div>`
    : `<div class="v2-nota" role="note">
         ${propio ? 'Estás' : 'Está'} en el percentil <strong>${fmtV2(fila.percentil)}</strong> de ${posL} rol
         (${escHtml(fila.rol_nombre || '—')}, ${n} personas evaluadas).
       </div>`;
}

/* ══ RESULTADO DE UNA PERSONA ══════════════════════════════════════════
 * Para Mi Score (miembro y secretario) y para el admin al revisar a alguien.
 *   fila        : una fila de resultados_periodo
 *   puntajes    : { clave: 1..5 } de la evaluación
 *   comentarios : { clave: texto }  (opcional)
 *   perfil      : perfil_rol con perfil_criterios
 */
function resultadoV2HTML({ fila, puntajes = {}, comentarios = {}, respuestas = {}, perfil }) {
  const ap = criteriosAplicables(perfil, catalogoV2(), { conservar: [...Object.keys(puntajes || {}), ...Object.keys(respuestas || {})] });

  const nota = notaRolV2HTML(fila);

  const kpi = (lbl, val, sub, destacado) => `
    <div class="v2-kpi${destacado ? ' v2-kpi--main' : ''}">
      <div class="v2-kpi-val">${fmtV2(val)}<span>/100</span></div>
      <div class="v2-kpi-lbl">${lbl}</div>
      <div class="v2-kpi-sub">${sub}</div>
    </div>`;

  const barra = c => {
    const r = rangoPuntajeV2(c, fila?.escala);
    const v = Number(puntajes[c.key]);
    const tiene = puntajes[c.key] != null && Number.isFinite(v) && v >= r.min;
    const com = comentarios?.[c.key];
    return `
      <div class="cbar">
        <div class="cbar-top">
          <div>
            ${c.peso != null ? `<div class="cbar-tag" style="color:var(--criterio-txt)">PESO ${c.peso}</div>` : ''}
            <div class="cbar-name">${escHtml(c.nombre)}</div>
          </div>
          <div class="cbar-val" style="color:var(--criterio-txt)">${tiene ? v : '—'}<span>/${r.max}</span></div>
        </div>
        <div class="cbar-track"><div class="cbar-fill" style="width:${tiene ? pctPuntajeV2(v, r) : 0}%;background:var(--criterio)"></div></div>
        ${com ? `<div class="cbar-feedback"><span class="cbar-fb-txt">${escHtml(com)}</span></div>` : ''}
        <details class="v2-det"><summary>¿Cómo se puntúa?</summary>${descriptoresHTML(c)}</details>
      </div>`;
  };

  return `
    <div class="v2-kpis">
      ${kpi('Individual', fila.individual, '60 % técnico + 40 % núcleo', true)}
      ${kpi('General', fila.general, fila.rol_pequeno ? '40 % núcleo + 60 % técnico (rol pequeño)' : '40 % núcleo + 60 % percentil', false)}
      ${kpi('Núcleo', fila.nucleo, 'Igual para los ocho roles', false)}
      ${kpi('Técnico', fila.tecnico, escHtml(fila.rol_nombre || 'Criterios del rol'), false)}
    </div>
    ${nota}
    <div class="desglose-label">Núcleo transversal</div>
    <div class="v2-bars">${ap.nucleo.map(barra).join('')}</div>
    <div class="desglose-label">Criterios técnicos · ${escHtml(fila.rol_nombre || 'tu rol')}</div>
    <div class="v2-bars">${ap.tecnicos.map(barra).join('')}</div>
    ${registroHTML(ap.registro, respuestas, comentarios)}
    ${ap.fuera.length ? `<p class="v2-fuera"><strong>No se te evalúan estos ${ap.fuera.length} criterios</strong>
      (no son parte de tu rol y no entran a tu cálculo): ${escHtml(ap.fuera.map(c => c.nombre).join(' · '))}.</p>` : ''}`;
}


/** Campos de registro de una evaluación (solo lectura): lo que respondió quien evaluó. */
function registroHTML(campos, respuestas = {}, comentarios = {}) {
  const con = (campos || []).filter(c => respuestas?.[c.key] !== undefined);
  if (!con.length) return '';
  return `<div class="desglose-label">Registro de la evaluación</div>
    <dl class="v2-registro">${con.map(c => `
      <div class="v2-registro-fila"><dt>${escHtml(c.nombre)}${c.activo === false ? ' <small>(desactivado)</small>' : ''}</dt>
        <dd>${escHtml(respuestaTxt(c, respuestas[c.key]))}</dd></div>`).join('')}</dl>`;
}

/* ══ RANKINGS ══════════════════════════════════════════════════════════
 * Dos preguntas distintas, dos tablas distintas: mezclarlas en un solo
 * número es lo que rompía la evaluación anterior.
 *   · General: núcleo en valor absoluto + posición dentro del propio rol.
 *   · Dentro de su rol: solo compara a quien hace lo mismo.
 */
function rankingV2HTML(rows, { resaltarId = null } = {}) {
  if (!rows?.length) {
    return '<div class="empty-box"><div class="empty-txt">Aún no hay evaluaciones publicadas con la rúbrica v2 en este período.</div></div>';
  }
  const num = (a, b, k) => (b[k] ?? -1) - (a[k] ?? -1);
  const fila = (r, i, clave) => `
    <tr${r.evaluado_id === resaltarId ? ' class="v2-yo"' : ''}>
      <td class="v2-pos">${i + 1}</td>
      <td class="v2-nom">${escHtml(r.nombre || '—')}${r.estado === 'borrador' ? ' <span class="v2-borr">borrador</span>' : ''}
        <span class="v2-sub">${escHtml(r.rol_nombre || '—')}${r.distrito ? ' · ' + escHtml(r.distrito) : ''}</span></td>
      <td>${fmtV2(r.nucleo)}</td>
      <td>${fmtV2(r.tecnico)}</td>
      <td>${r.rol_pequeno ? '<span class="v2-peq" title="Rol con menos de 4 personas: se usa el técnico absoluto">—*</span>' : fmtV2(r.percentil)}</td>
      <td class="v2-tot" style="color:${r[clave] == null ? 'var(--txt-muted)' : scoreColorTxtV2(r[clave])}">${fmtV2(r[clave])}</td>
    </tr>`;
  const tabla = (lista, clave, etiqueta) => `
    <div class="v2-tabla-wrap"><table class="v2-tabla">
      <caption class="sr-only">${etiqueta}</caption>
      <thead><tr><th scope="col">#</th><th scope="col">Persona</th><th scope="col">Núcleo</th>
        <th scope="col">Técnico</th><th scope="col">Percentil</th><th scope="col">${etiqueta}</th></tr></thead>
      <tbody>${lista.map((r, i) => fila(r, i, clave)).join('')}</tbody>
    </table></div>`;

  const general = [...rows].sort((a, b) => num(a, b, 'general'));
  const porRol  = new Map();
  for (const r of rows) {
    const k = r.rol_nombre || '—';
    if (!porRol.has(k)) porRol.set(k, []);
    porRol.get(k).push(r);
  }
  const pequenos = rows.some(r => r.rol_pequeno);

  return `
    <h3 class="v2-h">Ranking general</h3>
    <p class="v2-p">Núcleo en valor absoluto y posición relativa <em>dentro del propio rol</em>. El mejor de cada rol llega arriba en igualdad de condiciones.</p>
    ${tabla(general, 'general', 'General')}
    ${pequenos ? `<p class="v2-pie">* Rol con menos de 4 personas evaluadas: el percentil se sustituye por el técnico en valor absoluto.</p>` : ''}
    <h3 class="v2-h">Ranking dentro de cada rol</h3>
    ${[...porRol.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([rol, lista]) => `
      <details class="v2-rol" open>
        <summary>${escHtml(rol)} <span class="v2-n">${lista.length} persona${lista.length === 1 ? '' : 's'}</span></summary>
        ${tabla([...lista].sort((a, b) => num(a, b, 'individual')), 'individual', 'Individual')}
      </details>`).join('')}`;
}


/* ══ HISTORIAL v2 DE UNA PERSONA ═══════════════════════════════════════
 * Los períodos v2 no entran en las gráficas legacy (otra escala, otros
 * criterios): se listan aparte, con lo que la base calculó en cada uno. */
async function historialV2HTML(miId) {
  const ps = (Store.periodos() || []).filter(esPeriodoV2);
  if (!ps.length) return '';
  const filas = (await Promise.all(ps.map(async p => {
    const r = await API.getResultadosV2(p.id);
    const f = r.ok ? r.rows.find(x => x.evaluado_id === miId) : null;
    return f ? { pe: p.pe, f } : null;
  }))).filter(Boolean);
  if (!filas.length) return '';
  return `
    <div class="urpt-section-lbl" style="margin-top:var(--sp-5)">Períodos con rúbrica por roles</div>
    <div class="v2-tabla-wrap"><table class="v2-tabla">
      <caption class="sr-only">Resultados por período con la rúbrica por roles</caption>
      <thead><tr><th scope="col">Período</th><th scope="col">Núcleo</th><th scope="col">Técnico</th>
        <th scope="col">Individual</th><th scope="col">General</th><th scope="col">Nivel</th></tr></thead>
      <tbody>${filas.map(({ pe, f }) => `
        <tr><td class="v2-nom">${escHtml(pe)}</td><td>${fmtV2(f.nucleo)}</td><td>${fmtV2(f.tecnico)}</td>
          <td class="v2-tot" style="color:${scoreColorTxtV2(f.individual)}">${fmtV2(f.individual)}</td>
          <td>${fmtV2(f.general)}</td>
          <td><span class="nivel-badge ${nivelV2(f.individual).key}" style="font-size:.55rem">${nivelV2(f.individual).label}</span></td></tr>`).join('')}
      </tbody></table></div>`;
}

/**
 * Mi Score en un período v2: pinta el héroe y devuelve el HTML del cuerpo.
 *   contenido : { v2: filas de resultados_periodo, scores, feedback }
 * Compartido por miembro y secretario.
 */
function miScoreV2({ contenido, miId, pe, periodo, calendario, contenedor }) {
  const fila = (contenido.v2 || []).find(r => r.evaluado_id === miId) || null;
  const heroEl = document.getElementById('hero-score');
  if (fila && fila.individual != null) {
    if (heroEl) { heroEl.textContent = fmtV2(fila.individual); heroEl.style.color = scoreColorV2(fila.individual); }
    setEl('hero-nivel', nivelV2(fila.individual).label);
  } else {
    setEl('hero-score', '—'); setEl('hero-nivel', '—');
    if (heroEl) heroEl.style.color = 'var(--muted)';
  }
  setEl('hero-max', 100);

  if (!fila) {
    renderVacio(contenedor, `Aún no hay evaluación para ${pe}.`, { periodo, calendario });
    return;
  }
  const mia = (contenido.scores || []).find(r => r.evaluado_id === miId);
  const fb  = (contenido.feedback || []).find(r => r.evaluado_id === miId)?.fb || {};
  const perfil = perfilesV2().find(p => String(p.id) === String(fila.perfil_id)) || null;
  contenedor.innerHTML = resultadoV2HTML({
    fila, puntajes: mia?.puntajes || {}, comentarios: fb, respuestas: mia?.respuestas || {}, perfil,
  });
}


/**
 * El párrafo «Cada criterio se evalúa del 1 al 4 · máximo 28» está escrito a
 * mano en user.html y secretario.html: en un período v2 sería falso.
 */
function ajustarIntroRubrica(v2) {
  document.querySelectorAll('.rubrica-intro').forEach(el => {
    if (el.dataset.legacy == null) el.dataset.legacy = el.innerHTML;
    el.innerHTML = v2
      ? 'Con la rúbrica por roles cada criterio se puntúa del <strong>1 al 5</strong> y el resultado se expresa sobre <strong>100</strong>.'
      : el.dataset.legacy;
  });
}
