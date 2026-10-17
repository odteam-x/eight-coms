'use strict';
/**
 * EIGHT CREATORS LABs — Formulario de actividad (crear y editar)
 * ───────────────────────────────────────────────────────────────
 * Lo usan la pestaña Actividades de la administración y el Calendario (administración y secretaría), para que
 * una actividad se cree igual en todas partes:
 *   · Tipo        — la etiqueta de la actividad (Entrega, Jornada, Capacitación…). Colorea el calendario.
 *   · Para quién  — «Todo el equipo» (solo administración), «Un distrito» o «Personas y equipos», con el Selector
 *                   de core/selector.js. La secretaría solo ofrece su distrito y personas de su distrito.
 *
 * El alcance y las destinatarias los guarda guardar_actividad() (migración 0024) en una sola operación y la base
 * decide quién ve la actividad; aquí solo se ofrece lo que esa persona puede crear. Sin 0024, «Personas y
 * equipos» no se ofrece (y se explica), y equipo / distrito siguen funcionando como antes. Elegir personas
 * suelta también necesita personas_asignables() de 0021.
 * Depende de: core/selector.js, core/render.js, core/tareas.js (estilos del modal), api.js.
 */
const ActividadForm = (() => {
  const MODAL = 'actf-modal';
  let E = null;
  const hoyISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const nombreDistrito = d => (typeof _distritoNombre === 'function' ? _distritoNombre(d) : d);

  function asegurar() {
    if (document.getElementById(MODAL)) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="tk-overlay" id="${MODAL}" style="display:none" data-act="cerrarModalFondo" data-arg="${MODAL}">
        <div class="tk-box asig-box" role="document">
          <div class="modal-title" id="${MODAL}-title">Nueva actividad</div>
          <div id="${MODAL}-cuerpo"></div>
          <div class="tk-err" id="${MODAL}-err" role="alert"></div>
          <div class="tk-modal-acciones">
            <button type="button" class="btn-save" id="${MODAL}-ok" data-act="actfGuardar">Guardar</button>
            <button type="button" class="tk-btn" data-act="cerrarModal" data-arg="${MODAL}">Cancelar</button>
          </div>
        </div>
      </div>`);
  }
  const err = t => { document.getElementById(MODAL + '-err').textContent = t || ''; };

  /** Qué alcances puede ofrecer esta persona. */
  function alcancesPosibles() {
    const out = [];
    if (E.admin) out.push({ v: 'equipo', l: 'Todo el equipo', d: 'La ven todas las personas de la gestión.' });
    out.push(E.admin
      ? { v: 'distrito', l: 'Un distrito', d: 'La ven las personas de ese distrito.' }
      : { v: 'distrito', l: 'Mi distrito', d: 'La ven las personas de tu distrito.' });
    out.push({ v: 'seleccion', l: 'Personas y equipos', d: E.admin ? 'Solo las personas que elijas (y quien administra).' : 'Solo las personas de tu distrito que elijas.', bloqueada: !E.seleccionOk });
    return out;
  }

  function pintarPara() {
    const host = document.getElementById('actf-para'); if (!host) return;
    const opts = alcancesPosibles();
    const actual = opts.find(o => o.v === E.alcance) || opts[0];
    host.innerHTML = `
      <div class="tk-campo">
        <span class="asig-lbl" id="actf-para-t">Para quién</span>
        <div class="tk-filtros" role="radiogroup" aria-labelledby="actf-para-t">
          ${opts.map(o => `<button type="button" class="tk-chip${o.v === E.alcance ? ' tk-chip--on' : ''}" role="radio" aria-checked="${o.v === E.alcance}" data-act="actfAlcance" data-arg="${o.v}"${o.bloqueada ? ' disabled title="Necesita las migraciones 0021 y 0024"' : ''}>${escHtml(o.l)}</button>`).join('')}
        </div>
        <small class="tk-ayuda">${escHtml(actual.d)}${opts.some(o => o.bloqueada) ? ' Elegir personas concretas necesita una actualización de la base de datos (migraciones 0021 y 0024).' : ''}</small>
      </div>
      ${E.alcance === 'distrito' && E.admin ? `<div class="tk-campo"><label for="actf-distrito">Distrito</label>
        <select class="cfg-inp cfg-select" id="actf-distrito" data-change="actfDistrito">${E.distritos.map(d => `<option value="${escHtml(d.id)}"${String(d.id) === String(E.distrito) ? ' selected' : ''}>${escHtml(d.nombre)}</option>`).join('')}</select></div>` : ''}
      ${E.alcance === 'distrito' && !E.admin ? `<p class="tk-info">Se verá en el calendario de ${escHtml(nombreDistrito(E.miDistrito) || 'tu distrito')}.</p>` : ''}
      ${E.alcance === 'seleccion' ? '<div id="actf-selector"></div>' : ''}
      <p class="asig-aviso asig-aviso--aviso" id="actf-alcance-n" role="status"></p>`;
    if (E.alcance === 'seleccion') E.selector.montar(document.getElementById('actf-selector'));
    resumen();
  }

  /** Cuántas personas recibirán el aviso: se dice antes de guardar. */
  function resumen() {
    const el = document.getElementById('actf-alcance-n'); if (!el) return;
    let n = null, txt = '';
    if (E.alcance === 'equipo') txt = 'Se avisará a todo el equipo.';
    else if (E.alcance === 'distrito') {
      const d = E.admin ? (document.getElementById('actf-distrito')?.value || E.distrito) : E.miDistrito;
      n = E.personas.filter(p => String(p.distrito) === String(d)).length;
      txt = n ? `Se avisará a las ${n} personas de ese distrito.` : 'Se avisará a las personas de ese distrito.';
    } else {
      n = E.selector.seleccion().length;
      txt = n ? `Se avisará a ${n} ${n === 1 ? 'persona' : 'personas'}. Nadie más la verá.` : 'Elige al menos una persona: nadie más verá esta actividad.';
    }
    el.innerHTML = `<i data-lucide="info" aria-hidden="true"></i><span>${escHtml(txt)}</span>`;
    if (typeof renderIconos === 'function') renderIconos(el);
  }

  function cuerpo() {
    const x = E.act || {};
    document.getElementById(MODAL + '-cuerpo').innerHTML = `
      <div class="tk-campo"><label for="actf-titulo">Título *</label>
        <input class="cfg-inp" id="actf-titulo" type="text" maxlength="120" value="${escHtml(x.titulo || '')}" placeholder="Ej.: Capacitación de edición de video"></div>
      <div class="tk-campo"><label for="actf-desc">Descripción (opcional)</label>
        <textarea class="cfg-inp" id="actf-desc" rows="2" maxlength="2000">${escHtml(x.descripcion || '')}</textarea></div>
      <div class="tk-campo"><label for="actf-tipo">Tipo</label>
        <select class="cfg-inp cfg-select" id="actf-tipo"><option value="">Sin tipo</option>${E.etiquetas.map(e => `<option value="${escHtml(e.id)}"${String(e.id) === String(x.etiqueta_id) ? ' selected' : ''}>${escHtml(e.nombre)}</option>`).join('')}</select>
        <small class="tk-ayuda">El tipo da el color con que se ve en el calendario.</small></div>
      <div class="asig-fila2">
        <div class="tk-campo"><label for="actf-ini">Desde</label><input class="cfg-inp" id="actf-ini" type="date" value="${escHtml(x.fecha_inicio ? String(x.fecha_inicio).slice(0, 10) : E.fecha)}"></div>
        <div class="tk-campo"><label for="actf-fin">Hasta (si dura varios días)</label><input class="cfg-inp" id="actf-fin" type="date" value="${escHtml(x.fecha_fin ? String(x.fecha_fin).slice(0, 10) : '')}"></div>
      </div>
      <div id="actf-para"></div>`;
    pintarPara();
    document.getElementById('actf-titulo')?.focus();
  }

  async function guardar() {
    const v = id => document.getElementById('actf-' + id);
    const titulo = v('titulo').value.trim(), ini = v('ini').value, fin = v('fin').value;
    if (!titulo) return err('Escribe un título.');
    if (!ini) return err('Elige la fecha.');
    if (fin && fin < ini) return err('La fecha final no puede ser anterior a la inicial.');
    const personas = E.alcance === 'seleccion' ? E.selector.seleccion() : [];
    if (E.alcance === 'seleccion' && !personas.length) return err('Elige al menos una persona.');
    const distrito = E.alcance === 'distrito' ? (E.admin ? v('distrito')?.value : E.miDistrito) : null;
    if (E.alcance === 'distrito' && !distrito) return err('Elige el distrito.');
    const btn = document.getElementById(MODAL + '-ok'); btn.disabled = true; err('');
    const r = await API.guardarActividad({
      id: E.act?.id ?? null, titulo, descripcion: v('desc').value.trim(), etiqueta_id: v('tipo').value ? Number(v('tipo').value) : null,
      fecha_inicio: ini, fecha_fin: fin || null, alcance: E.alcance, distrito, personas,
    });
    btn.disabled = false;
    if (!r.ok) return err(r.error);
    closeModal(MODAL);
    showToast(E.act ? 'Actividad actualizada' : 'Actividad creada', 'ok');
    const cb = E.onGuardado; E = null;
    cb?.();
  }

  /**
   * @param {object} o
   * @param {object} [o.actividad]    la actividad a editar (sin ella, crea)
   * @param {string} [o.fecha]        fecha inicial al crear (desde el calendario)
   * @param {boolean} o.admin         administración (alcance «todo el equipo» y cualquier distrito)
   * @param {string} [o.miDistrito]   distrito de la secretaría
   * @param {Array} o.distritos       [{id, nombre}] (administración)
   * @param {Array} o.etiquetas       tipos disponibles
   * @param {Function} o.onGuardado
   */
  async function abrir({ actividad = null, fecha = '', admin = false, miDistrito = null, distritos = [], etiquetas = [], onGuardado }) {
    asegurar();
    const [asig, probe, dest] = await Promise.all([
      API.getPersonasAsignables(null, null), API.alcanceDisponible(),
      actividad && (actividad.alcance === 'seleccion') ? API.getDestinatariosActividad([actividad.id]) : Promise.resolve({ ok: true, porActividad: {} }),
    ]);
    const personas = asig.ok ? asig.rows.map(r => ({ ...r })) : [];
    const alcance = actividad ? (actividad.alcance || (actividad.distrito ? 'distrito' : 'equipo')) : (admin ? 'equipo' : 'distrito');
    E = {
      act: actividad, admin, miDistrito, distritos, etiquetas, onGuardado, fecha: fecha || hoyISO(),
      personas: personas.map(p => ({ id: p.persona_id, distrito: p.distrito })),
      seleccionOk: probe && asig.ok, alcance, distrito: actividad?.distrito || distritos[0]?.id || null,
    };
    if (alcance === 'seleccion' && !E.seleccionOk) E.alcance = admin ? 'equipo' : 'distrito';
    Selector.soltar('actf');
    E.selector = Selector.crear({
      id: 'actf', personas, equipos: Selector.equiposDe(personas.map(p => ({ id: p.persona_id, distrito: p.distrito, rol_nombre: p.rol_nombre })), { nombreDistrito }),
      seleccion: dest.porActividad?.[actividad?.id] || [], vacio: 'Nadie coincide con la búsqueda.', onCambio: () => resumen(),
    });
    setEl(MODAL + '-title', actividad ? 'Editar actividad' : 'Nueva actividad');
    document.getElementById(MODAL + '-ok').textContent = actividad ? 'Guardar' : 'Crear';
    err('');
    openModal(MODAL);
    cuerpo();
  }

  function alcance(a) {
    if (!E || E.alcance === a) return;
    if (a === 'seleccion' && !E.seleccionOk) return;
    E.alcance = a; pintarPara();
    document.querySelector(`#actf-para [data-arg="${a}"]`)?.focus();
  }
  return { abrir, guardar, alcance, resumen: () => E && resumen() };
})();

/** data-change del selector de distrito: actualiza el recuento de a quién se avisa. */
function actfDistrito() { ActividadForm.resumen(); }
