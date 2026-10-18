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

  const _avatarHTML = () => Avatar.interior(_p, { bust: true });

  const TABS = [
    { k: 'perfil', etiqueta: 'Perfil', icono: 'user-round' },
    { k: 'rol', etiqueta: 'Mi rol', icono: 'group-2' },
    { k: 'seguridad', etiqueta: 'Seguridad', icono: 'lock' },
    { k: 'app', etiqueta: 'App', icono: 'settings' },
  ];
  const _tabsDe = () => TABS.filter(t => !(t.k === 'rol' && _p.es_admin));
  const _tabGuardada = () => { try { return sessionStorage.getItem('ec-cuenta-tab'); } catch { return null; } };

  /** Muestra un panel y oculta los demás (cada panel es un role=tabpanel; los ocultos salen del árbol de accesibilidad). */
  function tab(k) {
    if (!_tabsDe().some(t => t.k === k)) k = 'perfil';
    try { sessionStorage.setItem('ec-cuenta-tab', k); } catch { /* modo privado */ }
    document.querySelectorAll('#cuenta-tabs .seg-btn').forEach(b => {
      const on = b.dataset.arg === k;
      b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('.cuenta-panel').forEach(p => { p.hidden = p.dataset.panel !== k; });
  }

  function montar(host, perfil) {
    if (!host || !perfil) return;
    _p = perfil;
    const nombre = _p.nombre || _p.name || '';
    const tipo = _p.es_admin ? TIPO.admin : (TIPO[_p.tipo_miembro] || TIPO.miembro);
    const tabs = _tabsDe();
    const activa = tabs.some(t => t.k === _tabGuardada()) ? _tabGuardada() : 'perfil';
    const panel = (k, aria, cuerpo) => `<section class="cuenta-panel" id="cu-tab-panel-${k}" role="tabpanel" aria-labelledby="cu-tab-${k}" data-panel="${k}"${k === activa ? '' : ' hidden'}>${cuerpo}</section>`;
    host.innerHTML = `
      <section class="cuenta-cab">
        <div class="cuenta-foto avatar avatar--xl pat-${Fondo.clase(_p)}" id="cuenta-foto">${_avatarHTML()}</div>
        <div class="cuenta-id">
          <h2 class="cuenta-nombre" id="cuenta-nombre-txt">${escHtml(nombre)}</h2>
          <p class="cuenta-mail">${escHtml(_p.email || '')}</p>
          <p class="cuenta-chips"><span class="etiqueta etq-azul">${escHtml(tipo)}</span>${_p.es_admin || !_p.distrito ? '' : `<span class="etiqueta etq-gris">${escHtml(_p.distrito)}</span>`}</p>
        </div>
        <div class="cuenta-cab-acc">
          <button type="button" class="btn-ghost cuenta-btn" data-act="cuentaFoto"><i data-lucide="camera"></i>Cambiar foto</button>
        </div>
      </section>

      <div id="cuenta-tabs" class="cuenta-tabs">${segHTML(tabs, activa, 'cuentaTab', { etiqueta: 'Secciones de Mi cuenta', prefijo: 'cu-tab' })}</div>

      ${panel('perfil', '', `
        <div class="cuenta-grid">
          <div class="cuenta-bloque">
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
          </div>
          <div class="cuenta-bloque">
            <h3 class="cuenta-t" id="cu-t-tarjeta">Tu tarjeta</h3>
            <div id="cuenta-fondo" class="cuenta-fondo"></div>
          </div>
        </div>`)}

      ${_p.es_admin ? '' : panel('rol', '', `<section aria-labelledby="cu-t-roles" id="cuenta-roles" class="cuenta-un-col"></section>`)}

      ${panel('seguridad', '', `
        <div class="cuenta-un-col">
          <h3 class="cuenta-t" id="cu-t-seg">Cambiar la contraseña</h3>
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
          <p class="cfg-hint">Usa al menos 8 caracteres y que sea distinta de la actual.</p>
        </div>`)}

      ${panel('app', '', `
        <div class="cuenta-un-col">
          <h3 class="cuenta-t" id="cu-t-pref">Apariencia y aplicación</h3>
          <div class="lista-aj">
            <button type="button" class="fila-aj" data-act="fn" data-arg="toggleTheme">
              <div class="fila-aj-txt"><div class="fila-aj-t">Tema</div><div class="fila-aj-d">Cambia entre claro y oscuro.</div></div>
              <span class="fila-aj-ind"><i data-lucide="sun-moon"></i></span>
            </button>
            <button type="button" class="fila-aj" id="cuenta-instalar" data-act="instalarApp"></button>
          </div>
          <h3 class="cuenta-t" id="cu-t-ayuda">Ayuda</h3>
          <div class="lista-aj">
            ${typeof Bienvenida !== 'undefined' ? Bienvenida.filaCuentaHTML() : ''}
            ${window.AYUDA_URL ? `<a class="fila-aj" href="${escHtml(window.AYUDA_URL)}">
              <div class="fila-aj-txt"><div class="fila-aj-t">Ayuda y manual de uso</div><div class="fila-aj-d">Paso a paso de cada pantalla, en computadora y en celular.</div></div>
              <span class="fila-aj-ind"><i data-lucide="book-open"></i></span></a>` : ''}
          </div>
          <div class="lista-aj cuenta-salir">
            <button type="button" class="fila-aj" data-act="salir">
              <div class="fila-aj-txt"><div class="fila-aj-t">Cerrar sesión</div><div class="fila-aj-d">Sales de este dispositivo.</div></div>
              <span class="fila-aj-ind"><i data-lucide="log-out"></i></span>
            </button>
          </div>
        </div>`)}`;
    _pintarInstalar();
    if (typeof Fondo !== 'undefined') Fondo.montar(host.querySelector('#cuenta-fondo'), _p);
    if (typeof renderIconos === 'function') renderIconos(host);
    // Las personas evaluadas (no la administración) eligen sus preferencias de rol (migración 0021).
    if (!_p.es_admin && typeof Preferencias !== 'undefined') Preferencias.montar(document.getElementById('cuenta-roles'), _p);
    // Enter dentro de un formulario no recarga ni envía: dispara su botón.
    host.querySelectorAll('form').forEach(f => f.addEventListener('submit', e => {
      e.preventDefault();
      f.querySelector('[data-act]')?.click();
    }));
  }

  /** «Instalar en tu celular»: el texto y el icono dependen de dónde se abra (Android, iPhone, ya instalada). */
  function _pintarInstalar() {
    const fila = document.getElementById('cuenta-instalar');
    if (!fila || typeof Pwa === 'undefined') return;
    const m = Pwa.modo();
    const ya = m === 'instalada';
    fila.disabled = ya;
    fila.innerHTML = `
      <div class="fila-aj-txt"><div class="fila-aj-t">${ya ? 'App instalada' : 'Instalar en tu celular'}</div><div class="fila-aj-d">${escHtml(Pwa.descripcion())}</div></div>
      <span class="fila-aj-ind"><i data-lucide="${ya ? 'check' : 'smartphone'}"></i></span>`;
    if (typeof renderIconos === 'function') renderIconos(fila);
  }
  document.addEventListener('pwa:lista', _pintarInstalar);

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

  return { montar, tab, elegirFoto, refrescarFoto, guardarNombre, cambiarPass };
})();
