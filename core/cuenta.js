'use strict';
/**
 * EIGHT CREATORS LABs — Mi cuenta
 * ───────────────────────────────
 * La sección de la persona consigo misma: ver y cambiar su foto, su nombre,
 * leer lo que la administración le asignó (rol, distrito, acceso), elegir el
 * tema, cambiar la contraseña y cerrar sesión. Es la misma en los tres portales.
 *
 * No decide permisos: el nombre y la foto se escriben con las mismas llamadas
 * de siempre (RLS manda) y rol, distrito y tipo son solo lectura, porque un
 * trigger de la base impide que una persona los cambie por su cuenta.
 * Depende de: config.js, core/render.js (montarAvatar, showToast), api.js.
 */
const Cuenta = (() => {
  const TIPO = { miembro: 'Creator', secretario: 'Secretaría de distrito', admin: 'Administración' };
  let _p = null;   // perfil de la sesión (el mismo objeto que usa cada portal)

  const _fila = (titulo, desc, ind = '') => `
    <div class="fila-aj">
      <div class="fila-aj-txt"><div class="fila-aj-t">${escHtml(titulo)}</div>${desc ? `<div class="fila-aj-d">${escHtml(desc)}</div>` : ''}</div>
      ${ind}
    </div>`;

  function _avatarHTML() {
    const nombre = _p.nombre || _p.name || _p.email || '';
    return _p.avatar_url
      ? `<img src="${escHtml(_p.avatar_url)}?t=${Date.now()}" alt="" width="96" height="96">`
      : escHtml(initials(nombre) || '?');
  }

  function montar(host, perfil) {
    if (!host || !perfil) return;
    _p = perfil;
    const nombre = _p.nombre || _p.name || '';
    const tipo = _p.es_admin ? TIPO.admin : (TIPO[_p.tipo_miembro] || TIPO.miembro);
    host.innerHTML = `
      <section class="cuenta-cab">
        <div class="cuenta-foto" id="cuenta-foto">${_avatarHTML()}</div>
        <div class="cuenta-id">
          <h2 class="cuenta-nombre" id="cuenta-nombre-txt">${escHtml(nombre)}</h2>
          <p class="cuenta-mail">${escHtml(_p.email || '')}</p>
          <div class="cuenta-cab-acc">
            <button type="button" class="btn-ghost cuenta-btn" data-act="cuentaFoto"><i data-lucide="camera"></i>Cambiar foto</button>
          </div>
        </div>
      </section>

      <div class="cuenta-cols">
        <section aria-labelledby="cu-t-datos">
          <h3 class="cuenta-t" id="cu-t-datos">Tus datos</h3>
          <div class="lista-aj">
            <form class="fila-aj cuenta-form" id="cuenta-form-nombre" novalidate>
              <div class="fila-aj-txt">
                <label class="fila-aj-t" for="cuenta-nombre">Nombre</label>
                <input class="cfg-inp" id="cuenta-nombre" type="text" maxlength="80" value="${escHtml(nombre)}" autocomplete="name">
              </div>
              <button type="button" class="btn-save cuenta-guardar" data-act="cuentaGuardarNombre">Guardar</button>
            </form>
            ${_fila('Correo', 'Con este correo entras al portal.', `<span class="fila-aj-ind cuenta-val">${escHtml(_p.email || '—')}</span>`)}
            ${_fila('Tipo de acceso', 'Lo asigna la administración.', `<span class="fila-aj-ind cuenta-val">${escHtml(tipo)}</span>`)}
            ${_p.es_admin ? '' : _fila('Distrito', 'Lo asigna la administración.', `<span class="fila-aj-ind cuenta-val">${escHtml(_p.distrito || 'Sin asignar')}</span>`)}
          </div>
        </section>

        <section aria-labelledby="cu-t-pref">
          <h3 class="cuenta-t" id="cu-t-pref">Preferencias</h3>
          <div class="lista-aj">
            <button type="button" class="fila-aj" data-act="fn" data-arg="toggleTheme">
              <div class="fila-aj-txt"><div class="fila-aj-t">Tema</div><div class="fila-aj-d">Cambia entre claro y oscuro.</div></div>
              <span class="fila-aj-ind"><i data-lucide="sun-moon"></i></span>
            </button>
          </div>

          <div class="lista-aj cuenta-salir">
            <button type="button" class="fila-aj" data-act="salir">
              <div class="fila-aj-txt"><div class="fila-aj-t">Cerrar sesión</div><div class="fila-aj-d">Sales de este dispositivo.</div></div>
              <span class="fila-aj-ind"><i data-lucide="log-out"></i></span>
            </button>
          </div>
        </section>

        <section aria-labelledby="cu-t-seg">
          <h3 class="cuenta-t" id="cu-t-seg">Seguridad</h3>
          <form class="lista-aj cuenta-pass" id="cuenta-form-pass" novalidate>
            <div class="fila-aj cuenta-campo">
              <div class="fila-aj-txt">
                <label class="fila-aj-t" for="cuenta-pass">Nueva contraseña</label>
                <input class="cfg-inp" id="cuenta-pass" type="password" minlength="8" autocomplete="new-password" placeholder="Mínimo 8 caracteres">
              </div>
            </div>
            <div class="fila-aj cuenta-campo">
              <div class="fila-aj-txt">
                <label class="fila-aj-t" for="cuenta-pass2">Repite la contraseña</label>
                <input class="cfg-inp" id="cuenta-pass2" type="password" minlength="8" autocomplete="new-password">
              </div>
            </div>
            <div class="fila-aj cuenta-acc">
              <button type="button" class="btn-save" data-act="cuentaCambiarPass">Cambiar contraseña</button>
              <span class="cuenta-msg" id="cuenta-pass-msg" role="status" aria-live="polite"></span>
            </div>
          </form>

        </section>
      </div>`;
    if (typeof renderIconos === 'function') renderIconos(host);
    // Enter dentro de un formulario no recarga ni envía: dispara su botón.
    host.querySelectorAll('form').forEach(f => f.addEventListener('submit', e => {
      e.preventDefault();
      f.querySelector('[data-act]')?.click();
    }));
  }

  /** Abre el selector de archivo (el mismo input que ya procesa handleAvatarUpload). */
  function elegirFoto() { document.getElementById('avatar-file-input')?.click(); }

  /** La foto cambió: repinta la de esta pantalla (el menú lo hace montarAvatar). */
  function refrescarFoto(perfil) {
    if (perfil) _p = perfil;
    const el = document.getElementById('cuenta-foto');
    if (el && _p) el.innerHTML = _avatarHTML();
  }

  async function guardarNombre(btn) {
    const inp = document.getElementById('cuenta-nombre');
    const nombre = (inp?.value || '').trim();
    if (nombre.length < 2) { showToast('Escribe tu nombre completo (al menos 2 letras).', 'error'); inp?.focus(); return; }
    if (nombre === (_p.nombre || '')) { showToast('Ese ya es tu nombre.', 'info'); return; }
    if (btn) btn.disabled = true;
    const r = await API.updateMiNombre(_p.id, nombre);
    if (btn) btn.disabled = false;
    if (!r.ok) { showToast('No se pudo guardar el nombre: ' + r.error, 'error'); return; }
    _p.nombre = nombre; _p.name = nombre;
    const t = document.getElementById('cuenta-nombre-txt'); if (t) t.textContent = nombre;
    if (typeof montarAvatar === 'function') montarAvatar(_p);
    showToast('Nombre guardado.', 'success');
  }

  async function cambiarPass(btn) {
    const a = document.getElementById('cuenta-pass')?.value || '';
    const b = document.getElementById('cuenta-pass2')?.value || '';
    const msg = document.getElementById('cuenta-pass-msg');
    const error = t => { if (msg) { msg.textContent = t; msg.classList.add('cuenta-msg--error'); } };
    if (msg) { msg.textContent = ''; msg.classList.remove('cuenta-msg--error'); }
    if (a.length < 8) return error('Usa al menos 8 caracteres.');
    if (a !== b) return error('Las dos contraseñas no coinciden.');
    if (btn) btn.disabled = true;
    const { error: e } = await SB.auth.updateUser({ password: a });
    if (btn) btn.disabled = false;
    if (e) return error('No se pudo cambiar: ' + e.message);
    document.getElementById('cuenta-pass').value = '';
    document.getElementById('cuenta-pass2').value = '';
    showToast('Contraseña actualizada.', 'success');
  }

  return { montar, elegirFoto, refrescarFoto, guardarNombre, cambiarPass };
})();
