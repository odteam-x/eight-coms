'use strict';
/**
 * EIGHT CREATORS LABs — Mi rol y mis preferencias de rol (migración 0021)
 * ───────────────────────────────────────────────────────────────────────
 * Tres cosas que NO se mezclan:
 *   · tu rol PRINCIPAL y los roles que la administración te HABILITÓ → lo que puedes asumir;
 *   · tus PREFERENCIAS, en orden, y un rol predeterminado → lo que TÚ quieres hacer.
 * La preferencia le sirve a quien asigna tareas para repartir mejor; NO te da permisos ni te impide
 * recibir un trabajo de otro rol. Por eso puedes preferir un rol que aún no tienes habilitado (se avisa),
 * pero el predeterminado debe ser uno que sí tienes (lo exige la base).
 * Los roles funcionales (administración, secretaría, miembro) no aparecen aquí: son otra cosa.
 *
 * Todo texto humano pasa por escHtml. Las acciones van por el despachador (ACCIONES en config.js).
 * Depende de: config.js, core/render.js (showToast), core/ui.js (acordeonHTML, lineasDeTexto), api.js.
 */
const Preferencias = (() => {
  const MAX = 8;
  let S = null;   // { perfil, roles:[], habilitados:Set, pref:[rolId], pred:rolId|null, sucio:bool, disponible:bool }

  const rol = id => S.roles.find(r => Number(r.id) === Number(id));
  const habilitado = id => S.habilitados.has(Number(id));

  async function cargar(perfil) {
    S = { perfil, roles: [], habilitados: new Set(), pref: [], pred: null, sucio: false, disponible: true };
    const [roles, extra, pref] = await Promise.all([API.getRoles(true), API.getPersonaRoles(perfil.id), API.getPreferenciasRol(perfil.id)]);
    S.roles = roles;
    S.disponible = !(extra.noDisponible || pref.noDisponible) && API.rolesAmpliados(roles);
    if (perfil.rol_id != null) S.habilitados.add(Number(perfil.rol_id));
    for (const r of extra.rows || []) S.habilitados.add(Number(r.rol_id));
    S.pref = (pref.rows || []).map(r => Number(r.rol_id));
    S.pred = (pref.rows || []).find(r => r.es_predeterminado)?.rol_id ?? null;
    if (S.pred != null) S.pred = Number(S.pred);
  }

  const chipHabilitado = id => habilitado(id)
    ? '<span class="etiqueta etq-verde">Habilitado</span>'
    : '<span class="etiqueta etq-gris" title="Puedes preferirlo, pero la administración aún no te lo habilitó">Aún no habilitado</span>';

  function rolDetalleHTML(r, abierto = false) {
    if (!r) return '';
    const resp = lineasDeTexto(r.responsabilidades), req = lineasDeTexto(r.requisitos);
    if (!r.descripcion && !resp.length && !req.length) return '<p class="cfg-hint">La administración aún no escribió la descripción de este rol.</p>';
    return `${r.descripcion ? `<p class="rol-desc">${escHtml(r.descripcion)}</p>` : ''}
      ${resp.length ? acordeonHTML({ id: 'pref-resp-' + r.id, titulo: 'Qué se espera de este rol', cuerpo: `<ul class="rol-lista">${resp.map(x => `<li>${escHtml(x)}</li>`).join('')}</ul>`, abierto, extra: 'acordeon--compacto' }) : ''}
      ${req.length ? acordeonHTML({ id: 'pref-req-' + r.id, titulo: 'Qué necesitas', cuerpo: `<ul class="rol-lista">${req.map(x => `<li>${escHtml(x)}</li>`).join('')}</ul>`, extra: 'acordeon--compacto' }) : ''}`;
  }

  function filaPref(id, i) {
    const r = rol(id);
    if (!r) return '';
    const nombre = escHtml(r.nombre);
    return `<li class="pref-fila">
      <span class="pref-n" aria-hidden="true">${i + 1}</span>
      <div class="pref-txt"><b>${nombre}</b>${chipHabilitado(id)}${S.pred === Number(id) ? '<span class="etiqueta etq-azul">Predeterminado</span>' : ''}</div>
      <div class="pref-acc">
        <button type="button" class="btn-icon" data-act="prefMover" data-arg="${i}" data-arg2="-1" aria-label="Subir ${nombre}"${i === 0 ? ' disabled' : ''}><i data-lucide="arrow-up"></i></button>
        <button type="button" class="btn-icon" data-act="prefMover" data-arg="${i}" data-arg2="1" aria-label="Bajar ${nombre}"${i === S.pref.length - 1 ? ' disabled' : ''}><i data-lucide="arrow-down"></i></button>
        <button type="button" class="btn-icon${S.pred === Number(id) ? ' btn-icon--on' : ''}" data-act="prefPred" data-arg="${id}" aria-pressed="${S.pred === Number(id)}"
          aria-label="${S.pred === Number(id) ? 'Quitar' : 'Poner'} ${nombre} como rol predeterminado"${habilitado(id) ? '' : ' disabled title="Solo puede ser predeterminado un rol que tengas habilitado"'}><i data-lucide="star"></i></button>
        <button type="button" class="btn-icon btn-icon--danger" data-act="prefQuitar" data-arg="${i}" aria-label="Quitar ${nombre} de mis preferencias"><i data-lucide="x"></i></button>
      </div></li>`;
  }

  function pintar() {
    const host = document.getElementById('cuenta-roles'); if (!host || !S) return;
    if (!S.disponible) {
      host.innerHTML = `<h3 class="cuenta-t" id="cu-t-roles">Mi rol y mis preferencias</h3>
        <div class="lista-aj"><div class="fila-aj"><div class="fila-aj-txt"><div class="fila-aj-t">Aún no disponible</div>
        <div class="fila-aj-d">Tus preferencias de rol se activan con una actualización de la base de datos (migración 0021).</div></div></div></div>`;
      return;
    }
    const principal = rol(S.perfil.rol_id);
    const extras = [...S.habilitados].filter(id => Number(id) !== Number(S.perfil.rol_id)).map(rol).filter(Boolean);
    const libres = S.roles.filter(r => !S.pref.includes(Number(r.id)));
    host.innerHTML = `
      <h3 class="cuenta-t" id="cu-t-roles">Mi rol y mis preferencias</h3>
      <div class="lista-aj pref-caja">
        <div class="fila-aj pref-bloque">
          <div class="fila-aj-txt">
            <div class="fila-aj-t">Tu rol principal: ${principal ? escHtml(principal.nombre) : 'sin asignar'}</div>
            <div class="fila-aj-d">Lo asigna la administración y define con qué perfil te evalúan.</div>
            ${principal ? rolDetalleHTML(principal) : ''}
            ${extras.length ? `<div class="pref-extras"><span class="pref-extras-t">También habilitado:</span> ${extras.map(r => `<span class="etiqueta etq-verde">${escHtml(r.nombre)}</span>`).join(' ')}</div>` : ''}
          </div>
        </div>
        <div class="fila-aj pref-bloque">
          <div class="fila-aj-txt">
            <div class="fila-aj-t">Qué rol me gustaría hacer</div>
            <div class="fila-aj-d">Ordénalos del que más quieres al que menos. Quien reparte tareas lo tiene en cuenta; <b>no te da permisos ni te impide recibir otro trabajo</b>.</div>
            ${S.pref.length ? `<ol class="pref-lista">${S.pref.map(filaPref).join('')}</ol>`
              : '<p class="cfg-hint">Todavía no elegiste ninguno. Agrega los roles que te interesan.</p>'}
            ${S.pref.length < MAX && libres.length ? `<div class="pref-agregar">
              <label class="sr-only" for="pref-nuevo">Agregar un rol a mis preferencias</label>
              <select class="cfg-inp cfg-select" id="pref-nuevo">${libres.map(r => `<option value="${escHtml(r.id)}">${escHtml(r.nombre)}</option>`).join('')}</select>
              <button type="button" class="btn-ghost" data-act="prefAgregar"><i data-lucide="plus"></i>Agregar</button>
            </div>` : (S.pref.length >= MAX ? `<p class="cfg-hint">Llegaste al máximo de ${MAX} roles.</p>` : '')}
            <div class="pref-guardar">
              <button type="button" class="btn-save" data-act="prefGuardar"${S.sucio ? '' : ' disabled'}>Guardar preferencias</button>
              <span class="cuenta-msg" id="pref-msg" role="status" aria-live="polite">${S.sucio ? 'Hay cambios sin guardar.' : ''}</span>
            </div>
          </div>
        </div>
      </div>`;
    if (typeof renderIconos === 'function') renderIconos(host);
  }

  async function montar(host, perfil) {
    if (!host || !perfil) return;
    host.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';
    try { await cargar(perfil); } catch (e) { S = null; host.innerHTML = '<p class="cfg-hint">No se pudieron cargar tus roles. Recarga la página.</p>'; return; }
    pintar();
  }

  /* ── Acciones (despachador) ── */
  const marcar = () => { S.sucio = true; pintar(); };
  function mover(i, d) {
    const j = i + d;
    if (j < 0 || j >= S.pref.length) return;
    [S.pref[i], S.pref[j]] = [S.pref[j], S.pref[i]];
    marcar();
    document.querySelector(`.pref-fila:nth-child(${j + 1}) [data-arg="${j}"][data-arg2="${d}"]`)?.focus();
  }
  function quitar(i) {
    const [id] = S.pref.splice(i, 1);
    if (S.pred === Number(id)) S.pred = null;
    marcar();
  }
  function agregar() {
    const v = Number(document.getElementById('pref-nuevo')?.value);
    if (!v || S.pref.includes(v) || S.pref.length >= MAX) return;
    S.pref.push(v);
    marcar();
  }
  function predeterminado(id) {
    id = Number(id);
    if (!habilitado(id)) return;
    S.pred = S.pred === id ? null : id;
    marcar();
  }
  async function guardar(btn) {
    if (!S?.sucio) return;
    if (btn) btn.disabled = true;
    const r = await API.guardarPreferenciasRol(S.pref, S.pred);
    if (!r.ok) {
      if (btn) btn.disabled = false;
      const m = document.getElementById('pref-msg');
      if (m) { m.textContent = r.error; m.classList.add('cuenta-msg--error'); }
      return;
    }
    S.sucio = false;
    pintar();
    showToast('Preferencias guardadas.', 'success');
  }

  return { montar, mover, quitar, agregar, predeterminado, guardar, rolDetalleHTML };
})();
