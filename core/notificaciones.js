'use strict';
/**
 * EIGHT CREATORS LABs — Campana y centro de notificaciones
 * ────────────────────────────────────────────────────────
 * Los avisos de la plataforma y los correos salen de la MISMA cola (`notificaciones`, migraciones 0019/0022/0040).
 * Esto no calcula nada ni inventa avisos: muestra lo que la base devuelve para la persona con sesión
 * (`mis_notificaciones`), que ya viene filtrado por destinatario.
 *
 *   · La campana (`.campana`) vive en la cabecera móvil y en el pie del rail de escritorio. Muestra el contador
 *     de sin leer (sin insignia cuando es 0); se actualiza cada minuto, al volver a la pestaña y al cambiar el
 *     estado de lectura. Su lugar y tamaño en la cabecera los decide la hoja del encabezado, no este archivo.
 *   · El panel (`abrirPanel`) lista los avisos con fecha y hora, categoría y estado de lectura; se filtra por
 *     «Sin leer» o por categoría; permite marcar uno o todos; y lleva a la pantalla —y al elemento— que lo originó.
 *   · «Preferencias» dentro del panel: los avisos ESENCIALES (asignaciones, calificaciones, equipos…) siempre
 *     llegan por correo; los OPCIONALES se activan o desactivan. En la campana siempre aparecen todos.
 *   · Enlaces de correo: `#ir/<pestaña>[/<objeto>/<id>]`. El portal exige sesión; si no la hay, el destino se
 *     recuerda (auth.js) y se abre al volver a entrar. La RLS decide qué se ve: un enlace no concede acceso.
 *   · Sin 0040 (o sin 0022) el panel lo dice con claridad; los correos no se ven afectados.
 *
 * Depende de: config.js (escHtml, renderIconos), api.js, core/render.js (timeAgo, showToast), core/ui.js (abrirPanel).
 */
const Notif = (() => {
  const POR_PAGINA = 30;
  const REFRESCO_MS = 60000;

  const _t = (v, d = '') => (v == null || v === '' ? d : String(v));
  const _dos = (...xs) => xs.map(x => _t(x)).filter(Boolean).join(' · ');

  /* tipo → { icono, t(datos), d(datos) }. Solo usan campos que el catálogo (notif_tipos.claves) deja pasar. */
  const TIPOS = {
    calificacion_nueva:    { icono: 'award',        t: () => 'Tienes una calificación nueva',        d: x => _dos(x.actividad || x.periodo, x.equipo, x.evaluador && 'de ' + x.evaluador) },
    calificacion_cambiada: { icono: 'pencil',       t: () => 'Modificaron una calificación tuya',   d: x => _dos(x.actividad || x.periodo, x.equipo) },
    observacion_nueva:     { icono: 'message-square', t: () => 'Tienes una observación nueva',     d: x => _dos(x.actividad || x.periodo, x.autor && 'de ' + x.autor) },
    tarea_asignada:        { icono: 'list-checks',  t: x => 'Nueva tarea: ' + _t(x.tarea),           d: x => _dos(x.asignador, x.fecha_limite && 'vence ' + x.fecha_limite) },
    tarea_colectiva_asignada: { icono: 'team',      t: x => 'Tarea para tu equipo: ' + _t(x.tarea),  d: x => _dos(x.equipo, x.fecha_limite && 'vence ' + x.fecha_limite) },
    tarea_cambio:          { icono: 'clock',        t: x => `Cambió ${_t(x.cambio, 'una tarea').toLowerCase()}: ` + _t(x.tarea), d: x => x.ahora ? (x.antes ? `${x.antes} → ${x.ahora}` : x.ahora) : _t(x.motivo) },
    tarea_por_vencer:      { icono: 'alarm-clock',  t: x => `Vence ${_t(x.cuando, 'pronto')}: ` + _t(x.tarea), d: x => _t(x.fecha_limite) },
    tarea_vencida:         { icono: 'alert-triangle', t: x => 'Tarea vencida: ' + _t(x.tarea),       d: x => x.dias ? `${x.dias} ${Number(x.dias) === 1 ? 'día' : 'días'} de atraso` : '' },
    correccion_solicitada: { icono: 'refresh',      t: x => 'Te devolvieron: ' + _t(x.tarea),        d: x => _t(x.observacion) },
    tarea_aprobada:        { icono: 'circle-check', t: x => 'Aprobaron: ' + _t(x.tarea),             d: x => x.puntos != null ? `${x.puntos} de 10 puntos` : '' },
    entrega_registrada:    { icono: 'inbox',        t: x => `${_t(x.persona, 'Alguien')} entregó: ` + _t(x.tarea), d: x => x.a_tiempo ? 'A tiempo: ' + x.a_tiempo : '' },
    tarea_bloqueada:       { icono: 'pause',        t: x => 'Tarea bloqueada: ' + _t(x.tarea),       d: x => _t(x.motivo) },
    estado_cambiado:       { icono: 'flag',         t: x => 'Cambió el estado: ' + _t(x.elemento),   d: x => x.ahora ? (x.antes ? `${x.antes} → ${x.ahora}` : x.ahora) : '' },
    equipo_incorporado:    { icono: 'user-add',     t: x => 'Te incorporaron al equipo ' + _t(x.equipo), d: x => _dos(x.rol_equipo && 'rol: ' + x.rol_equipo, x.agregado_por && 'por ' + x.agregado_por) },
    equipo_retiro:         { icono: 'user-x',       t: x => 'Te retiraron del equipo ' + _t(x.equipo), d: x => _dos(x.retirado_por && 'por ' + x.retirado_por, x.motivo) },
    solicitud_acceso:      { icono: 'user-add',     t: x => 'Solicitud de acceso: ' + _t(x.persona, 'alguien'), d: x => _t(x.correo) },
    acceso_aprobado:       { icono: 'check',        t: () => 'Tu acceso fue aprobado',                d: () => 'Ya puedes usar el portal' },
    actividad_nueva:       { icono: 'calendar-plus', t: x => 'Nueva actividad: ' + _t(x.actividad),  d: x => _t(x.fecha) },
    actividad_recordatorio: { icono: 'calendar',    t: x => 'Mañana: ' + _t(x.actividad),            d: x => _t(x.fecha) },
    evaluaciones_sin_publicar: { icono: 'clipboard-list', t: () => 'Faltan evaluaciones por publicar', d: x => x.pendientes ? `${x.pendientes} pendientes en ${_t(x.periodo)}` : _t(x.periodo) },
  };
  /* Nombres anteriores a 0040: la campana sigue entendiendo una base que aún no los renombró. */
  const ALIAS = { nota_publicada: 'calificacion_nueva', nota_corregida: 'calificacion_cambiada', tarea_devuelta: 'correccion_solicitada',
                  plazo_movido: 'tarea_cambio', entrega_por_revisar: 'entrega_registrada' };
  const _def = (tipo) => TIPOS[ALIAS[tipo] || tipo] || { icono: 'bell', t: () => 'Aviso', d: () => '' };

  const CATEGORIAS = {
    tareas:         { t: 'Tareas' },
    equipos:        { t: 'Equipos' },
    calificaciones: { t: 'Calificaciones' },
    actividades:    { t: 'Actividades' },
    cuenta:         { t: 'Cuenta' },
  };
  const _cat = (a) => {
    if (a.categoria && CATEGORIAS[a.categoria]) return a.categoria;
    const t = ALIAS[a.tipo] || a.tipo || '';
    return /^(tarea_|entrega_|correccion_)/.test(t) ? 'tareas' : /^equipo_/.test(t) ? 'equipos'
      : /^(calificacion_|observacion_|nota_|evaluaciones_)/.test(t) ? 'calificaciones' : /^(actividad_|estado_)/.test(t) ? 'actividades' : 'cuenta';
  };

  /* Pestaña a la que lleva cada tipo, por portal. La base ya trae `destino` (catálogo 0040); esto es el respaldo
     para filas anteriores a 0040. Los nombres de pestaña son los de initNav de cada portal. */
  const DESTINOS = {
    miembro:    { calificacion_nueva: 'perfil', calificacion_cambiada: 'perfil', observacion_nueva: 'perfil', acceso_aprobado: 'inicio',
                  tarea_asignada: 'trabajos', tarea_colectiva_asignada: 'trabajos', tarea_cambio: 'trabajos', tarea_por_vencer: 'trabajos', tarea_vencida: 'trabajos',
                  correccion_solicitada: 'trabajos', tarea_aprobada: 'trabajos', estado_cambiado: 'trabajos',
                  actividad_nueva: 'calendario', actividad_recordatorio: 'calendario' },
    secretario: { entrega_registrada: 'tareas', tarea_bloqueada: 'tareas' },
    admin:      { solicitud_acceso: 'usuarios', entrega_registrada: 'tareas', tarea_bloqueada: 'tareas', evaluaciones_sin_publicar: 'evaluar',
                  calificacion_nueva: 'evaluar', calificacion_cambiada: 'evaluar', observacion_nueva: 'evaluar',
                  actividad_nueva: 'agenda', actividad_recordatorio: 'agenda', acceso_aprobado: 'overview' },
  };
  const _destino = (a) => {
    const t = ALIAS[a.tipo] || a.tipo;
    return a.destino || (DESTINOS[_cfg.portal] || {})[t] || DESTINOS.miembro[t] || (_cfg.inicio || 'inicio');
  };

  let _cfg = { portal: 'miembro', inicio: 'inicio' };
  let _n = 0, _disponible = true, _v40 = true, _lista = [], _solo = false, _categoria = null, _hayMas = false, _cargando = false, _timer = null;
  let _vista = 'lista', _prefs = null, _resumen = [];
  const _abridores = {};

  function configurar(cfg) { _cfg = { ..._cfg, ...cfg }; }

  /** Otros módulos (equipos, calificaciones…) enseñan cómo abrir su objeto: Notif.registrarAbridor('equipo', (id) => …). */
  function registrarAbridor(refTipo, fn) { if (/^[a-z_]{1,24}$/.test(refTipo) && typeof fn === 'function') _abridores[refTipo] = fn; }

  /** Botón de campana. `extra` = clases (cabecera móvil vs rail). */
  function campanaHTML(extra = '') {
    return `<button type="button" class="campana ${extra}" data-act="abrirAvisos" aria-haspopup="dialog" aria-label="Avisos">
      <i data-lucide="bell" aria-hidden="true"></i><span class="campana-n" aria-hidden="true" hidden></span></button>`;
  }

  function _pintarContador() {
    const txt = _n > 99 ? '99+' : String(_n);
    document.querySelectorAll('.campana').forEach(b => {
      const n = b.querySelector('.campana-n');
      if (n) { n.textContent = txt; n.hidden = _n === 0; }
      b.classList.toggle('campana--nueva', _n > 0);
      b.setAttribute('aria-label', _n > 0 ? `Avisos: ${_n} sin leer` : 'Avisos: no hay nada sin leer');
    });
  }

  async function refrescarContador() {
    if (document.hidden) return;
    const r = await API.getNotifNoLeidas();
    if (r.ok) { _n = r.n; _disponible = true; }
    else if (r.noDisponible) { _disponible = false; _n = 0; }
    _pintarContador();
  }

  function _asegurarEstilos() {
    if (document.getElementById('avisos-css')) return;
    const l = document.createElement('link');
    l.id = 'avisos-css'; l.rel = 'stylesheet'; l.href = 'avisos.css';
    document.head.appendChild(l);
  }

  /** Arranca el contador. Lo llama initNav() cuando ya existe la cabecera. */
  function iniciar() {
    _asegurarEstilos();
    refrescarContador();
    clearInterval(_timer);
    _timer = setInterval(refrescarContador, REFRESCO_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescarContador(); });
    irDesdeHash();
    // Un enlace de correo abierto en una pestaña que ya tiene el portal solo cambia el fragmento: no recarga.
    window.addEventListener('hashchange', () => { if (/^#ir\//.test(location.hash)) irDesdeHash(); });
  }

  /* ── Fechas ────────────────────────────────────────────────────────── */
  const _dia = (iso) => { const d = new Date(iso); d.setHours(0, 0, 0, 0); const h = new Date(); h.setHours(0, 0, 0, 0); return Math.round((h - d) / 86400000); };
  const _grupo = (iso) => { const n = _dia(iso); return n <= 0 ? 'Hoy' : n === 1 ? 'Ayer' : n < 7 ? 'Esta semana' : 'Antes'; };
  const _abs = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

  /* ── Lista ─────────────────────────────────────────────────────────── */
  function _itemHTML(a) {
    const def = _def(a.tipo);
    const x = a.datos || {};
    const sinLeer = !a.leida_en;
    const detalle = def.d(x);
    const cat = CATEGORIAS[_cat(a)];
    return `<li class="aviso-li"><button type="button" class="aviso${sinLeer ? ' aviso--nuevo' : ''}" data-act="avisoIr" data-arg="${escHtml(String(a.id))}">
      <span class="aviso-ico aviso-ico--${_cat(a)}" aria-hidden="true"><i data-lucide="${escHtml(def.icono)}"></i></span>
      <span class="aviso-txt">
        <span class="aviso-fila">
          <span class="aviso-t">${escHtml(def.t(x))}${sinLeer ? '<span class="sr-only"> (sin leer)</span>' : ''}</span>
        </span>
        ${detalle ? `<span class="aviso-d">${escHtml(detalle)}</span>` : ''}
        <span class="aviso-meta">
          <span class="aviso-cat">${escHtml(cat.t)}</span>
          <time class="aviso-h" datetime="${escHtml(new Date(a.creada).toISOString())}" title="${escHtml(_abs(a.creada))}">${escHtml(timeAgo(a.creada))} · ${escHtml(_abs(a.creada))}</time>
        </span>
      </span>
    </button></li>`;
  }

  function _chipsHTML(sinLeer) {
    const tot = (c) => (_resumen.find(r => r.categoria === c) || {}).total || 0;
    const cats = _v40 ? Object.keys(CATEGORIAS).filter(c => tot(c) > 0 || _categoria === c) : [];
    const chip = (act, arg, etq, activo, extra = '') =>
      `<button type="button" class="chip${activo ? ' active' : ''}" data-act="${act}" data-arg="${arg}" aria-pressed="${activo}">${etq}${extra}</button>`;
    return `<div class="chip-row aviso-chips" role="group" aria-label="Filtrar avisos">
      ${chip('avisosFiltro', 'todas', 'Todos', !_solo && !_categoria)}
      ${chip('avisosFiltro', 'nuevas', 'Sin leer', _solo, sinLeer ? ` (${sinLeer})` : '')}
      ${cats.map(c => chip('avisosFiltro', 'cat:' + c, escHtml(CATEGORIAS[c].t), _categoria === c)).join('')}
    </div>`;
  }

  function _barraHTML(sinLeer) {
    return `<div class="avisos-barra">
      ${_chipsHTML(sinLeer)}
      <div class="avisos-acciones">
        <button type="button" class="btn-texto avisos-todas" data-act="avisosTodas"${sinLeer ? '' : ' disabled'}><i data-lucide="check-double" aria-hidden="true"></i>Marcar todo${_categoria ? ' (esta categoría)' : ''}</button>
        ${_v40 ? '<button type="button" class="btn-texto avisos-prefs" data-act="avisosPrefs"><i data-lucide="settings" aria-hidden="true"></i>Preferencias</button>' : ''}
      </div>
    </div>`;
  }

  function _pintarPanel() {
    const host = document.getElementById('avisos-cuerpo');
    if (!host) return;
    if (!_disponible) {
      host.innerHTML = `<div class="aviso-estado" role="status"><i data-lucide="info" aria-hidden="true"></i>
        <div><b>Los avisos dentro de la plataforma aún no están activos.</b><p>Se activan con la actualización de la base de datos. Mientras tanto, los avisos siguen llegando a tu correo.</p></div></div>`;
      renderIconos(host); return;
    }
    if (_vista === 'prefs') { _pintarPrefs(host); return; }
    const lista = _lista.filter(a => (!_solo || !a.leida_en) && (!_categoria || _cat(a) === _categoria));
    const sinLeer = _lista.filter(a => !a.leida_en).length;
    const sub = document.getElementById('panel-lateral-sub');
    if (sub) { sub.textContent = _n ? (_n === 1 ? '1 aviso sin leer' : _n + ' avisos sin leer') : 'Estás al día'; sub.hidden = false; }
    const barra = _barraHTML(_n || sinLeer);
    if (!lista.length) {
      const vacio = _solo ? ['check-double', 'Estás al día.', 'No hay avisos sin leer.']
        : _categoria ? ['bell', 'Nada en esta categoría.', 'Cuando haya algo, aparecerá aquí.']
        : ['bell', 'Todavía no tienes avisos.', 'Aquí aparecerán tus tareas, equipos, calificaciones y actividades.'];
      host.innerHTML = barra + `<div class="aviso-estado" role="status"><i data-lucide="${vacio[0]}" aria-hidden="true"></i>
        <div><b>${vacio[1]}</b><p>${vacio[2]}</p></div></div>` + (_hayMas ? '<button type="button" class="btn-ghost avisos-mas" data-act="avisosMas">Ver avisos anteriores</button>' : '');
      renderIconos(host); return;
    }
    let html = barra, actual = '';
    for (const a of lista) {
      const g = _grupo(a.creada);
      if (g !== actual) { html += `${actual ? '</ul>' : ''}<h3 class="avisos-grupo">${g}</h3><ul class="avisos-lista">`; actual = g; }
      html += _itemHTML(a);
    }
    html += '</ul>';
    if (_hayMas) html += '<button type="button" class="btn-ghost avisos-mas" data-act="avisosMas">Ver avisos anteriores</button>';
    host.innerHTML = html;
    renderIconos(host);
  }

  async function _cargar(mas = false) {
    if (_cargando) return;
    _cargando = true;
    const host = document.getElementById('avisos-cuerpo');
    if (host && !mas) host.innerHTML = esqueletoHTML('bloques');
    const antes = mas && _lista.length ? _lista[_lista.length - 1].creada : null;
    const [r, res] = await Promise.all([
      API.getNotificaciones({ limite: POR_PAGINA, antes, categoria: _categoria, soloSinLeer: _solo }),
      mas ? Promise.resolve(null) : API.getNotifResumen(),
    ]);
    _cargando = false;
    if (!r.ok) {
      if (r.noDisponible) { _disponible = false; _pintarPanel(); return; }
      if (host) renderError(host, r.error, () => _cargar(false));
      return;
    }
    _disponible = true;
    _v40 = r.data.length ? ('categoria' in r.data[0]) : (res ? res.ok : _v40);
    if (res && res.ok) _resumen = res.data;
    _lista = mas ? _lista.concat(r.data) : r.data;
    _hayMas = r.data.length === POR_PAGINA;
    _pintarPanel();
    refrescarContador();
  }

  function abrir() {
    const cuerpo = abrirPanel({ titulo: 'Avisos', subtitulo: 'Lo que pasó en tu cuenta', compacto: true });
    cuerpo.innerHTML = '<div id="avisos-cuerpo" class="avisos"></div>';
    _solo = false; _categoria = null; _lista = []; _hayMas = false; _vista = 'lista'; _prefs = null;
    _cargar(false);
  }

  /* ── Acciones ──────────────────────────────────────────────────────── */
  async function ir(id) {
    const a = _lista.find(x => String(x.id) === String(id));
    if (!a) return;
    if (!a.leida_en) {
      a.leida_en = new Date().toISOString(); _n = Math.max(0, _n - 1); _pintarContador();
      API.marcarNotifLeida(a.id).then(r => { if (!r.ok) { a.leida_en = null; _n++; _pintarContador(); } });
    }
    cerrarPanel();
    _navegar(_destino(a), a.ref_tipo, a.ref_id);
  }

  async function todas() {
    const r = await API.marcarNotifTodas(_v40 ? _categoria : null);
    if (!r.ok) { showToast('No se pudo marcar: ' + r.error, 'error'); return; }
    const ahora = new Date().toISOString();
    _lista.forEach(a => { if (!a.leida_en && (!_categoria || _cat(a) === _categoria)) a.leida_en = ahora; });
    await refrescarContador();
    _resumen = (await API.getNotifResumen()).data || _resumen;
    _pintarPanel();
    if (r.n) showToast('Marcaste ' + r.n + (r.n === 1 ? ' aviso' : ' avisos') + ' como leído' + (r.n === 1 ? '.' : 's.'), 'success');
  }

  /** 'todas' | 'nuevas' | 'cat:<categoría>'. Con 0040 el filtro lo aplica la base; sin ella, se filtra lo ya cargado. */
  function filtro(modo) {
    _solo = modo === 'nuevas';
    _categoria = /^cat:[a-z]+$/.test(modo) && CATEGORIAS[modo.slice(4)] ? modo.slice(4) : null;
    _vista = 'lista';
    if (_v40) _cargar(false); else _pintarPanel();
  }

  /* ── Navegación al objeto del aviso ────────────────────────────────── */
  function _tabExiste(tab) { return !!document.getElementById('tab-' + tab); }

  function _navegar(tab, refTipo, refId) {
    const destino = _tabExiste(tab) ? tab : (_cfg.inicio || 'inicio');
    if (typeof switchTab === 'function') switchTab(destino, null);
    if (!refTipo || refId == null) return;
    if (_abridores[refTipo]) { try { _abridores[refTipo](String(refId)); } catch (e) { console.warn('[avisos] abridor', refTipo, e); } return; }
    _resaltar(refTipo, String(refId));
  }

  /** Busca el elemento del objeto (las tarjetas de tarea llevan data-tarea) y lo deja a la vista unos segundos. */
  function _resaltar(refTipo, refId) {
    if (refTipo !== 'tarea' || !/^[\w-]{1,64}$/.test(refId)) return;
    let intentos = 0;
    const t = setInterval(() => {
      const el = document.querySelector(`[data-tarea="${refId}"]`);
      if (el) {
        clearInterval(t);
        el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        el.classList.add('aviso-resalte');
        setTimeout(() => el.classList.remove('aviso-resalte'), 3500);
      } else if (++intentos > 16) clearInterval(t);
    }, 250);
  }

  /** Enlace de correo `#ir/<pestaña>[/<objeto>/<id>]`, o el destino que auth.js recordó antes de pedir la sesión. */
  function irDesdeHash() {
    let h = /^#ir\//.test(location.hash) ? location.hash : null;
    try {
      const j = JSON.parse(sessionStorage.getItem('ec-ir') || 'null');
      sessionStorage.removeItem('ec-ir');
      if (!h && j && j.p === location.pathname.split('/').pop() && /^#ir\//.test(j.h || '')) h = j.h;
    } catch { /* sessionStorage bloqueado: el enlace funciona con sesión abierta */ }
    const m = h && /^#ir\/([a-z_]{1,32})(?:\/([a-z_]{1,24})\/([\w-]{1,64}))?$/.exec(h);
    if (!m) return;
    if (/^#ir\//.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    // Espera a que el portal haya cargado su contexto (y, en administración, a que se elija gestión y período).
    let cancelado = false, t0 = Date.now();
    const cancelar = () => { cancelado = true; };
    ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, cancelar, { once: true, capture: true }));
    const espera = setInterval(() => {
      if (cancelado || Date.now() - t0 > 90000) { clearInterval(espera); return; }
      const listo = typeof Store !== 'undefined' && Store.periodoId && Store.periodoId() && typeof switchTab === 'function';
      if (!listo) return;
      clearInterval(espera);
      setTimeout(() => { if (!cancelado) _navegar(m[1], m[2], m[3]); }, 500);
    }, 400);
  }

  /* ── Preferencias ──────────────────────────────────────────────────── */
  async function prefs() {
    _vista = 'prefs';
    const host = document.getElementById('avisos-cuerpo');
    if (host) host.innerHTML = esqueletoHTML('bloques');
    const sub = document.getElementById('panel-lateral-sub');
    if (sub) { sub.textContent = 'Qué te llega por correo'; sub.hidden = false; }
    const r = await API.getPreferenciasNotif();
    if (!r.ok) {
      if (r.noDisponible) { _v40 = false; _vista = 'lista'; _pintarPanel(); return; }
      if (host) renderError(host, r.error, () => prefs());
      return;
    }
    _prefs = r.data;
    _pintarPanel();
    if (_cfg.portal === 'admin') _cargarEstado();
  }

  function volver() { _vista = 'lista'; _pintarPanel(); _cargar(false); }

  function _pintarPrefs(host) {
    const porCat = {};
    (_prefs || []).forEach(p => { (porCat[p.categoria] = porCat[p.categoria] || []).push(p); });
    let html = `<div class="avisos-barra"><button type="button" class="btn-texto" data-act="avisosLista"><i data-lucide="arrow-left" aria-hidden="true"></i>Volver a los avisos</button></div>
      <p class="pref-intro">Aquí eliges qué avisos te llegan <b>por correo</b>. Todos aparecen siempre en la campana. Los esenciales no se pueden apagar porque afectan tu trabajo o tus calificaciones.</p>`;
    for (const c of Object.keys(CATEGORIAS)) {
      const fs = porCat[c]; if (!fs) continue;
      html += `<h3 class="avisos-grupo">${escHtml(CATEGORIAS[c].t)}</h3><ul class="pref-lista">` + fs.map(p => {
        const def = _def(p.tipo);
        return `<li class="pref-fila">
          <span class="aviso-ico aviso-ico--${c}" aria-hidden="true"><i data-lucide="${escHtml(def.icono)}"></i></span>
          <span class="pref-txt"><span class="pref-t" id="pref-t-${escHtml(p.tipo)}">${escHtml(p.titulo)}</span><span class="pref-d">${escHtml(p.descripcion)}</span></span>
          ${p.esencial
            ? '<span class="pref-esencial"><i data-lucide="lock" aria-hidden="true"></i>Siempre</span>'
            : `<button type="button" class="pref-sw" role="switch" aria-checked="${p.correo}" aria-labelledby="pref-t-${escHtml(p.tipo)}" data-act="avisoPref" data-arg="${escHtml(p.tipo)}"><span class="sr-only">${p.correo ? 'Correo activado' : 'Correo desactivado'}</span><span class="pref-sw-txt" aria-hidden="true">${p.correo ? 'Activado' : 'Apagado'}</span></button>`}
        </li>`;
      }).join('') + '</ul>';
    }
    if (_cfg.portal === 'admin') html += '<div id="avisos-estado" class="pref-estado"></div>';
    host.innerHTML = html;
    renderIconos(host);
  }

  async function pref(tipo) {
    const p = (_prefs || []).find(x => x.tipo === tipo);
    if (!p || p.esencial) return;
    const nuevo = !p.correo;
    p.correo = nuevo; _pintarPanel();                                  // optimista
    const r = await API.guardarPreferenciasNotif({ [tipo]: nuevo });
    if (!r.ok) { p.correo = !nuevo; _pintarPanel(); showToast('No se pudo guardar: ' + r.error, 'error'); return; }
    showToast(nuevo ? 'Recibirás este aviso por correo.' : 'Ya no te llegará por correo (seguirá en la campana).', 'success');
    const b = document.querySelector(`.pref-sw[data-arg="${CSS.escape(tipo)}"]`); b?.focus();
  }

  /* ── Estado de los correos (solo administración) ───────────────────── */
  const ESTADOS = {
    enviado:   ['Enviado', 'Salió al proveedor de correo.'],
    pendiente: ['Pendiente', 'Espera su turno o un reintento.'],
    omitido:   ['Omitido', 'Sin correo registrado o apagado por la persona: solo campana.'],
    simulado:  ['Simulado', 'Modo de prueba: NO salió ningún correo real.'],
    fallido:   ['Fallido', 'Se agotaron los reintentos o la dirección no es válida.'],
  };
  async function _cargarEstado() {
    const host = document.getElementById('avisos-estado'); if (!host) return;
    const r = await API.getEstadoEnvios(7);
    if (!r.ok) { host.innerHTML = ''; return; }
    const tot = {}; r.data.forEach(x => { tot[x.correo_estado] = (tot[x.correo_estado] || 0) + Number(x.total); });
    host.innerHTML = `<h3 class="avisos-grupo">Estado de los correos · últimos 7 días</h3>
      <ul class="pref-lista">${Object.keys(ESTADOS).map(k => `<li class="pref-fila"><span class="pref-txt"><span class="pref-t">${ESTADOS[k][0]}</span><span class="pref-d">${ESTADOS[k][1]}</span></span><b class="pref-n">${tot[k] || 0}</b></li>`).join('')}</ul>`;
  }

  return { configurar, campanaHTML, iniciar, refrescarContador, abrir, ir, todas, filtro, mas: () => _cargar(true),
           prefs, volver, pref, registrarAbridor, irDesdeHash, TIPOS, ALIAS, DESTINOS, CATEGORIAS };
})();
