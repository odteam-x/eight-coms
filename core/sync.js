'use strict';
/**
 * EIGHT CREATORS LABs — Sincronización de datos en tiempo real
 * ─────────────────────────────────────────────────────────────
 * UN solo módulo decide cuándo se vuelven a pedir los datos. Las pantallas no se suscriben a nada: se registran con
 *
 *     const off = Sync.on(['tareas', 'kpis'], async ({ cambios }) => { … vuelve a pintar … }, { id: 'admin:tareas', vista: 'tareas' });
 *
 * y Sync se ocupa de lo demás: suscripciones (Supabase Realtime, postgres_changes), mapa de dependencias (una tabla invalida
 * también las vistas derivadas), agrupar ráfagas, no repetir peticiones, no refrescar lo que no se ve, no pisar un diálogo
 * abierto ni un texto a medio escribir, conservar el scroll, reconectar con espera creciente y resincronizar lo perdido.
 *
 * SEGURIDAD. Realtime aplica la RLS de cada tabla con el rol de QUIEN escucha: nadie recibe filas que no podría leer con
 * un SELECT. Aquí además se filtran las tablas de administración (`solo: 'admin'`) y el perfil propio (`id=eq.<yo>`).
 * Los eventos DELETE solo llevan la clave primaria (Realtime no puede aplicar RLS a un borrado), nunca datos.
 * Migración 0064: publicación `supabase_realtime`, señal de avisos y REVOKE a anon.
 *
 * Depende de: SB (supabase-client.js). Usa, si existen: Auth, showToast. Cárgalo después de core/render.js y antes de los portales.
 */
const Sync = (() => {

  /* ── Mapa de dependencias: tabla → vistas (temas) que quedan viejas cuando cambia ─────────────────────────
   * Una tarea aprobada no solo cambia «tareas»: mueve el seguimiento, el desempeño, el ranking, los indicadores del panel
   * y los reportes, porque todos salen de resultados_periodo() en SQL. Por eso el tema derivado va en la misma fila.
   * `solo: 'admin'` → no se escucha si la persona no es administradora (la RLS igualmente no le enviaría nada). */
  const DERIVADOS_NOTA = ['desempeno', 'ranking', 'kpis', 'seguimiento', 'reportes'];
  const TABLAS = {
    tareas:                    { temas: ['tareas', ...DERIVADOS_NOTA] },
    tareas_equipo:             { temas: ['tareas', 'equipos', ...DERIVADOS_NOTA] },
    tarea_equipo_participantes:{ temas: ['tareas', 'equipos', ...DERIVADOS_NOTA] },
    tarea_equipo_aportes:      { temas: ['tareas', 'equipos'] },
    calificaciones_historial:  { temas: ['tareas', ...DERIVADOS_NOTA] },
    periodo_calif_config:      { temas: ['tareas', ...DERIVADOS_NOTA] },
    evaluaciones:              { temas: ['evaluaciones', ...DERIVADOS_NOTA] },
    evaluaciones_versiones:    { temas: ['evaluaciones'] },
    evaluaciones_distrito:     { temas: ['distritos', 'ranking', 'reportes'] },
    estadisticas_distrito:     { temas: ['estadisticas', 'distritos', 'reportes'] },
    periodos_evaluacion:       { temas: ['periodos', 'perfil', 'evaluaciones', ...DERIVADOS_NOTA] },
    periodo_participantes:     { temas: ['periodos', 'perfil', 'personas', 'evaluaciones', ...DERIVADOS_NOTA] },
    gestiones:                 { temas: ['periodos', 'catalogo'] },
    profiles:                  { temas: ['personas', 'evaluaciones', 'equipos', 'distritos', ...DERIVADOS_NOTA] },
    roles:                     { temas: ['catalogo', 'personas', 'evaluaciones', 'desempeno'] },
    persona_roles:             { temas: ['personas', 'perfil', 'evaluaciones', 'desempeno'] },
    perfiles_rol:              { temas: ['catalogo', 'evaluaciones', 'desempeno'] },
    perfil_criterios:          { temas: ['catalogo', 'evaluaciones', 'desempeno'] },
    criterios_v2:              { temas: ['catalogo', 'evaluaciones', 'desempeno'] },
    criterios:                 { temas: ['catalogo', 'evaluaciones'] },
    rubrica:                   { temas: ['catalogo'] },
    calendario:                { temas: ['calendario', 'kpis'] },
    actividades:               { temas: ['calendario', 'kpis'] },
    actividad_destinatarios:   { temas: ['calendario'] },
    etiquetas:                 { temas: ['calendario'] },
    equipos:                   { temas: ['equipos', 'tareas', 'reportes'] },
    equipo_miembros:           { temas: ['equipos', 'tareas', 'reportes'] },
    distritos:                 { temas: ['distritos', 'personas'] },
    banco_imagenes:            { temas: ['banco'] },
    ayuda_pedidos:             { temas: ['apoyo'] },
    trabajos_entregados:       { temas: ['tareas', 'kpis'] },
    notif_senal:               { temas: ['notificaciones'] },
    auditoria_global:          { temas: ['auditoria'], solo: 'admin' },
  };

  const CFG = {
    debounce: 350,        // agrupa ráfagas: el último evento espera esto antes de refrescar
    maxWait: 2500,        // …pero nunca más que esto desde el primero (una ráfaga larga no aplaza para siempre)
    ocupado: 1200,        // cada cuánto se reintenta un refresco aplazado por un diálogo abierto o un texto a medias
    reintentoMin: 1000, reintentoMax: 30000,   // espera creciente al reconectar un canal caído
    revalidarTrasOculta: 20000,                // volver a la pestaña tras más de esto → se revalida
    fallos: 3,                                 // un refresco que falla se reintenta como mucho esto
  };

  /* ── Estado ────────────────────────────────────────────────────────── */
  const _regs = new Map();          // id → registro
  const _canales = new Map();       // tabla → { ch, estado, intentos, timer, cerrando, huboCaida }
  const _vigilados = new Map();     // 'tabla:id' → Set(fn)
  const _unicos = new Map();        // clave → Promise en vuelo
  const _escuchas = new Set();      // onEstado
  let _sb = null, _perfil = null, _tab = null, _iniciado = false;
  let _conexion = 'iniciando';      // iniciando | ok | sin-red | reconectando
  let _ultima = null;               // Date de la última verificación completa
  let _oculta = null;               // cuándo se ocultó la pestaña
  let _n = 0;
  let _ejecutando = 0;              // refrescos en curso: mientras > 0, renderCargando() no vacía lo que ya se ve
  let _extra = {};                  // en pruebas: relojes/ganchos

  const _ahora = () => Date.now();
  const _timer = (fn, ms) => setTimeout(fn, ms);
  const _arr = x => (Array.isArray(x) ? x : [x]);

  /* ── API: registrar una vista ──────────────────────────────────────── */
  /**
   * Sync.on(temas, fn, opciones) → off()
   *   temas:   'tareas' | ['tareas','kpis']   (ver TABLAS: los temas son las vistas, no las tablas)
   *   fn:      ({ cambios, temas, motivo }) => Promise|void      cambios = [{ tabla, tipo, id, nuevo, viejo }]
   *   opciones.id      identificador único (si se repite, reemplaza al anterior: no se acumulan registros al volver a montar)
   *   opciones.vista   solo es «visible» cuando Sync.tab() es esta (string o lista); sin esto, siempre
   *   opciones.visible () => boolean   condición propia además de la vista
   *   opciones.alEntrar true → al volver a la vista se refresca si pasó tiempo (para vistas que NO se vuelven a pedir al abrirlas)
   *   opciones.diferible false → no esperar a que se cierre un diálogo (por defecto se espera)
   */
  function on(temas, fn, o = {}) {
    if (typeof fn !== 'function') return () => {};
    const id = o.id || ('sync-' + (++_n));
    const prev = _regs.get(id); if (prev) clearTimeout(prev.timer);
    const reg = {
      id, temas: new Set(_arr(temas)), fn, vista: o.vista == null ? null : new Set(_arr(o.vista)), visible: o.visible || null,
      alEntrar: !!o.alEntrar, diferible: o.diferible !== false,
      cambios: [], sucio: false, obsoleto: false, enCurso: false, repetir: false, t0: 0, timer: null, ultima: _ahora(), fallos: 0, motivo: 'evento',
    };
    _regs.set(id, reg);
    if (_iniciado) _conciliar();
    return () => { clearTimeout(reg.timer); if (_regs.get(id) === reg) _regs.delete(id); if (_iniciado) _conciliar(); };
  }

  /** La vista (pestaña) visible ahora. La llama switchTabCore: al entrar se abren sus canales y al salir se cierran. */
  function tab(nombre) {
    if (_tab === nombre) return;
    _tab = nombre;
    for (const r of _regs.values()) {
      if (!_activa(r)) continue;
      if (r.alEntrar && !r.enCurso && _ahora() - r.ultima > CFG.debounce * 4) { r.obsoleto = true; r.motivo = 'entrada'; }
      if (r.obsoleto || r.sucio) _programar(r);
    }
    if (_iniciado) _conciliar();
  }

  /** Marca vistas como viejas a mano (p. ej. tras una escritura propia que no genera evento) y las refresca si se ven. */
  function invalidar(temas, motivo = 'manual') {
    const set = new Set(_arr(temas));
    for (const r of _regs.values()) {
      if (![...r.temas].some(t => set.has(t))) continue;
      r.obsoleto = true; r.motivo = motivo; _programar(r);
    }
  }

  /** Comparte una petición en vuelo: dos llamadas con la misma clave reciben la misma promesa (dedupe de peticiones). */
  function unico(clave, fn) {
    if (_unicos.has(clave)) return _unicos.get(clave);
    const p = Promise.resolve().then(fn).finally(() => { _unicos.delete(clave); });
    _unicos.set(clave, p);
    return p;
  }

  /**
   * Control de concurrencia en la pantalla: avisa si OTRA persona cambia (o borra) una fila mientras se edita.
   *   const v = Sync.vigilar('actividades', id, ({ tipo, nuevo }) => mostrarAviso());   …   v.silenciar(4000) al guardar lo propio;   v.off()
   * No bloquea ni sobrescribe nada: solo permite avisar y no perder lo que la persona está escribiendo.
   */
  function vigilar(tabla, id, fn) {
    const k = tabla + ':' + id;
    if (!_vigilados.has(k)) _vigilados.set(k, new Set());
    const w = { fn, hasta: 0 };
    _vigilados.get(k).add(w);
    if (_iniciado) _conciliar();
    return {
      silenciar: (ms = 3000) => { w.hasta = _ahora() + ms; },
      off: () => { const s = _vigilados.get(k); if (s) { s.delete(w); if (!s.size) _vigilados.delete(k); } },
    };
  }

  /* ── Quién está activo y qué canales hacen falta ───────────────────── */
  function _activa(r) {
    if (r.vista && !r.vista.has(_tab)) return false;
    if (r.visible) { try { if (!r.visible()) return false; } catch (e) { return false; } }
    return true;
  }

  function _tablasNecesarias() {
    const need = new Set();
    for (const [tabla, t] of Object.entries(TABLAS)) {
      if (t.solo === 'admin' && !(_perfil && _perfil.es_admin)) continue;
      for (const r of _regs.values()) {
        if (_activa(r) && t.temas.some(x => r.temas.has(x))) { need.add(tabla); break; }
      }
    }
    for (const k of _vigilados.keys()) { const t = k.split(':')[0]; if (TABLAS[t]) need.add(t); }
    return need;
  }

  /** Abre los canales que hacen falta y cierra los que ya no. Es lo que da el «suscribir al entrar / desuscribir al salir». */
  function _conciliar() {
    if (!_sb || !_perfil) return;
    const need = _tablasNecesarias();
    for (const t of need) if (!_canales.has(t)) _abrir(t);
    for (const t of [..._canales.keys()]) if (!need.has(t) && t[0] !== '@') _cerrar(t);   // «@perfil» es del propio Sync: no depende de las vistas
    _estadoCambio();
  }

  function _abrir(tabla) {
    const c = { ch: null, estado: 'abriendo', intentos: 0, timer: null, cerrando: false, huboCaida: false };
    _canales.set(tabla, c);
    _suscribir(tabla, c);
  }

  function _suscribir(tabla, c) {
    if (c.cerrando) return;
    if (c.ch) { try { _sb.removeChannel(c.ch); } catch (e) { /* ya cerrado */ } c.ch = null; }
    let ch;
    try {
      ch = _sb.channel('sync:' + tabla + ':' + (++_n));
      ch.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, p => _evento(tabla, p));
      ch.subscribe((status, err) => _estadoCanal(tabla, c, ch, status, err));
    } catch (e) {
      console.warn('[Sync] no se pudo suscribir a', tabla, e && e.message);
      c.ch = ch || null; c.estado = 'caido'; _reintentar(tabla, c); return;
    }
    c.ch = ch;
  }

  function _cerrar(tabla) {
    const c = _canales.get(tabla); if (!c) return;
    c.cerrando = true; clearTimeout(c.timer);
    if (c.ch) { try { _sb.removeChannel(c.ch); } catch (e) { /* ignorar */ } }
    _canales.delete(tabla);
  }

  function _estadoCanal(tabla, c, ch, status, err) {
    if (c.cerrando || c.ch !== ch) return;       // un canal ya reemplazado o cerrado a propósito no cuenta
    if (status === 'SUBSCRIBED') {
      const recupera = c.huboCaida;
      c.estado = 'ok'; c.intentos = 0; c.huboCaida = false; clearTimeout(c.timer);
      if (recupera) _resincronizarTabla(tabla, 'conexion');   // lo ocurrido mientras el canal estuvo caído no llegó: se vuelve a pedir
      _estadoCambio();
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      c.estado = 'caido'; c.huboCaida = true;
      if (err && status === 'CHANNEL_ERROR') console.warn('[Sync]', tabla, 'error de canal:', err && err.message || err);
      _reintentar(tabla, c);
      _estadoCambio();
    }
  }

  /** Espera creciente con algo de azar (para que mil clientes no vuelvan a la vez). Sin red no se insiste: espera al evento «online». */
  function _reintentar(tabla, c) {
    if (c.cerrando) return;
    clearTimeout(c.timer);
    if (_sinRed()) return;
    const base = Math.min(CFG.reintentoMax, CFG.reintentoMin * Math.pow(2, c.intentos++));
    const espera = Math.round(base * (0.75 + (_extra.azar ? _extra.azar() : Math.random()) * 0.5));
    c.timer = _timer(() => { if (!c.cerrando && _canales.get(tabla) === c) _suscribir(tabla, c); }, espera);
  }

  const _sinRed = () => (typeof navigator !== 'undefined' && navigator.onLine === false);

  /* ── Llegada de eventos ────────────────────────────────────────────── */
  function _evento(tabla, p) {
    try {
      const def = TABLAS[tabla]; if (!def) return;
      const nuevo = p && p.new && Object.keys(p.new).length ? p.new : null;
      const viejo = p && p.old && Object.keys(p.old).length ? p.old : null;
      const fila = nuevo || viejo || {};
      const cambio = { tabla, tipo: (p && p.eventType) || '?', id: fila.id != null ? fila.id : (fila.persona_id || fila.destinatario_id || null), nuevo, viejo };
      if (tabla === 'notif_senal' && !_esMio(fila.destinatario_id)) return;     // la señal ya viene filtrada por RLS; esto es cinturón y tirantes

      const w = _vigilados.get(tabla + ':' + cambio.id);
      if (w) for (const v of [...w]) { if (_ahora() >= v.hasta) { try { v.fn(cambio); } catch (e) { console.error('[Sync] vigilante:', e); } } }

      for (const r of _regs.values()) {
        if (!def.temas.some(t => r.temas.has(t))) continue;
        r.cambios.push(cambio); if (r.cambios.length > 200) r.cambios.splice(0, r.cambios.length - 200);
        r.sucio = true; r.motivo = 'evento';
        _programar(r);
      }
    } catch (e) { console.error('[Sync] evento:', e); }
  }

  const _esMio = id => !!(_perfil && id && String(id) === String(_perfil.id));

  /* ── Refresco acotado ──────────────────────────────────────────────── */
  function _programar(r) {
    if (!_activa(r)) { r.obsoleto = r.obsoleto || r.sucio; return; }     // no se ve: se queda marcada y se refresca al volver
    if (r.enCurso) { r.repetir = true; return; }
    if (!r.t0) r.t0 = _ahora();
    const espera = Math.max(0, Math.min(CFG.debounce, r.t0 + CFG.maxWait - _ahora()));
    clearTimeout(r.timer);
    r.timer = _timer(() => _ejecutar(r), espera);
  }

  /** ¿Hay algo que un repintado destrozaría? Un diálogo abierto o un campo de texto con cambios sin guardar. */
  function _ocupado() {
    try {
      if (_extra.ocupado) return _extra.ocupado();
      if (typeof document === 'undefined') return false;
      const dlg = document.querySelectorAll('[aria-modal="true"]');
      for (const d of dlg) { if (d.style && d.style.display && d.style.display !== 'none') return true; }
      const a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'search' && a.type !== 'checkbox' && a.type !== 'radio' && a.value !== a.defaultValue) return true;
    } catch (e) { /* sin DOM */ }
    return false;
  }

  function _scroll() {
    if (typeof document === 'undefined') return null;
    try {
      const els = [...document.querySelectorAll('.amain, #contenido, .panel-cuerpo')].map(e => [e, e.scrollTop]);
      return { y: window.scrollY, els };
    } catch (e) { return null; }
  }
  function _restaurar(s) {
    if (!s) return;
    try {
      const f = () => { s.els.forEach(([e, t]) => { if (e.scrollTop !== t) e.scrollTop = t; }); if (window.scrollY !== s.y) window.scrollTo(0, s.y); };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(f); else f();
    } catch (e) { /* ignorar */ }
  }

  async function _ejecutar(r) {
    if (_regs.get(r.id) !== r) return;
    if (!_activa(r)) { r.obsoleto = true; r.t0 = 0; return; }
    if (_sinRed()) { r.obsoleto = true; r.t0 = 0; return; }                    // sin red no se pide nada: se marca y se resincroniza al volver
    if (r.enCurso) { r.repetir = true; return; }
    if (r.diferible && _ocupado()) { clearTimeout(r.timer); r.timer = _timer(() => _ejecutar(r), CFG.ocupado); return; }

    const cambios = r.cambios; r.cambios = []; r.sucio = false; r.obsoleto = false; r.t0 = 0; r.enCurso = true; r.repetir = false;
    const sc = _scroll(); _ejecutando++;
    let bien = true;
    try { await r.fn({ cambios, temas: [...r.temas], motivo: r.motivo }); r.fallos = 0; }
    catch (e) {
      bien = false; console.error('[Sync] refresco de', r.id, 'falló:', e && e.message || e);
      if (++r.fallos <= CFG.fallos) { r.obsoleto = true; r.timer = _timer(() => _programar(r), CFG.reintentoMin * Math.pow(2, r.fallos)); }
      else _estadoCambio();
    }
    r.enCurso = false; r.ultima = _ahora(); _ejecutando--;
    _restaurar(sc);
    if (bien) { _ultima = new Date(_ahora()); _estadoCambio(); }
    if (r.repetir || r.sucio) { r.repetir = false; _programar(r); }
  }

  function _resincronizarTabla(tabla, motivo) {
    const def = TABLAS[tabla]; if (!def) return;
    invalidar(def.temas, motivo);
    if (tabla === 'profiles') _revalidarAcceso(motivo);
  }

  /** Vuelve a pedir TODO lo que se ve (y revalida el acceso). Tras reconectar, recuperar internet, volver a la pestaña o cambiar de rol. */
  function resincronizar(motivo = 'manual') {
    for (const r of _regs.values()) { r.obsoleto = true; r.motivo = motivo; _programar(r); }
    _revalidarAcceso(motivo);
  }

  /* ── Acceso y permisos: nunca se confía en lo cargado al entrar ────── */
  function _portalActual() {
    const f = (typeof location !== 'undefined' && location.pathname || '').split('/').pop() || '';
    return f === 'admin.html' || f === 'secretario.html' || f === 'user.html' ? f : null;
  }
  function _destino(p) { return p.es_admin ? 'admin.html' : p.tipo_miembro === 'secretario' ? 'secretario.html' : 'user.html'; }
  function _permitido(portal, p) {
    if (portal === 'admin.html') return !!p.es_admin;
    if (p.es_admin) return false;
    if (portal === 'user.html') return p.tipo_miembro === 'miembro';
    if (portal === 'secretario.html') return p.tipo_miembro === 'secretario' || p.tipo_miembro === 'miembro';
    return true;
  }
  const _CLAVES = ['es_admin', 'tipo_miembro', 'distrito', 'rol_id', 'aprobado'];

  function _irA(url) { if (_extra.irA) return _extra.irA(url); if (typeof location !== 'undefined') location.replace(url); }

  /**
   * Relee el perfil y actúa: sin sesión o sin aprobar → fuera; portal que ya no le corresponde → a su portal;
   * cambió el rol/distrito/tipo dentro de lo permitido → se invalida todo lo que se ve (la RLS ya devuelve otros datos).
   */
  function _revalidarAcceso(motivo) {
    return unico('acceso', async () => {
      if (typeof Auth === 'undefined' || !Auth.getProfile) return;
      let p;
      try { p = await Auth.getProfile(true); } catch (e) { return; }   // sin red: no se toca nada, ya hay estado «sin conexión»
      if (!p) { _irA('index.html'); return; }
      if (!p.es_admin && p.aprobado === false) {
        try { await _sb.auth.signOut(); } catch (e) { /* da igual */ }
        _irA('index.html?pendiente=1'); return;
      }
      const portal = _extra.portal !== undefined ? _extra.portal : _portalActual();
      if (portal && !_permitido(portal, p)) { _irA(_destino(p)); return; }
      const antes = _perfil || {};
      const cambio = _CLAVES.some(k => antes[k] !== p[k]);
      _perfil = p;
      if (cambio) {
        invalidar(['perfil', 'personas', 'evaluaciones', 'tareas', 'equipos', 'calendario', 'distritos', 'catalogo', ...DERIVADOS_NOTA, 'kpis', 'periodos'], 'rol');
        _conciliar();
        if (typeof showToast === 'function') showToast('Tus permisos cambiaron: se actualizó lo que ves.', '');
      }
    });
  }

  /* ── Conexión ──────────────────────────────────────────────────────── */
  function _estadoCambio() {
    let e;
    if (_sinRed()) e = 'sin-red';
    else if (!_canales.size) e = _iniciado ? 'ok' : 'iniciando';
    else {
      const caidos = [..._canales.values()].some(c => c.estado === 'caido');
      const abriendo = [..._canales.values()].some(c => c.estado === 'abriendo');
      e = caidos ? 'reconectando' : abriendo && _conexion !== 'ok' ? 'iniciando' : 'ok';
    }
    if (e === _conexion) { _pintar(); return; }
    const antes = _conexion; _conexion = e;
    _pintar();
    _escuchas.forEach(f => { try { f(e, antes); } catch (x) { /* ignorar */ } });
  }

  function onEstado(fn) { _escuchas.add(fn); return () => _escuchas.delete(fn); }
  /** true mientras Sync refresca una vista: los repintados NO deben mostrar el spinner ni el esqueleto encima de lo que ya se ve. */
  const silencioso = () => _ejecutando > 0;
  const estado = () => ({ conexion: _conexion, ultima: _ultima, verificado: _conexion === 'ok' });

  const _TXT = {
    'sin-red': 'Sin conexión. Lo que ves puede estar desactualizado.',
    'reconectando': 'Reconectando… Lo que ves puede estar desactualizado.',
  };
  function _pintar() {
    if (typeof document === 'undefined' || !document.body) return;
    try {
      let el = document.getElementById('sync-estado');
      const malo = _conexion === 'sin-red' || _conexion === 'reconectando';
      if (!malo) { if (el) el.hidden = true; return; }
      if (!el) {
        el = document.createElement('div');
        if (!document.getElementById('sync-css')) { const l = document.createElement('link'); l.id = 'sync-css'; l.rel = 'stylesheet'; l.href = 'sync.css'; (document.head || document.body).appendChild(l); }
        el.id = 'sync-estado'; el.className = 'sync-estado'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
        el.innerHTML = '<span class="sync-punto" aria-hidden="true"></span><span class="sync-txt"></span>';
        document.body.appendChild(el);
      }
      const hora = _ultima ? ' Última comprobación: ' + _ultima.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) + '.' : '';
      el.querySelector('.sync-txt').textContent = _TXT[_conexion] + hora;
      el.dataset.estado = _conexion; el.hidden = false;
    } catch (e) { /* sin DOM */ }
  }

  function _enLinea() {
    try { if (_sb && _sb.realtime && typeof _sb.realtime.connect === 'function') _sb.realtime.connect(); } catch (e) { /* ya conectado */ }
    for (const [t, c] of _canales) { if (c.estado === 'caido') { c.intentos = 0; clearTimeout(c.timer); _suscribir(t, c); } }
    _estadoCambio();
    resincronizar('en-linea');
  }
  function _sinLinea() { _estadoCambio(); }
  function _visibilidad() {
    if (typeof document === 'undefined') return;
    if (document.hidden) { _oculta = _ahora(); return; }
    const fuera = _oculta ? _ahora() - _oculta : 0; _oculta = null;
    if (fuera > CFG.revalidarTrasOculta) resincronizar('visible');
  }
  // Volver desde la caché de ida y vuelta (iOS/Safari): pagehide cerró los canales; se reabren y se revalida todo.
  function _pageshow(e) { if (e && e.persisted && _iniciado) { if (!_canales.has('@perfil')) _abrirPerfil(); _conciliar(); resincronizar('visible'); } }

  /* ── Arranque ──────────────────────────────────────────────────────── */
  /**
   * Sync.iniciar({ perfil })  — una vez por página, tras Auth.requireAuth/requireRole.
   * Abre el canal del PERFIL PROPIO (cambios de rol, acceso y distrito se reflejan sin reiniciar sesión) y escucha la red,
   * la visibilidad de la pestaña y la sesión.
   */
  function iniciar({ perfil, sb, cfg, extra } = {}) {
    if (_iniciado) return;
    _sb = sb || (typeof SB !== 'undefined' ? SB : null); _perfil = perfil || null;
    if (cfg) Object.assign(CFG, cfg);
    if (extra) _extra = extra;
    if (!_sb || !_perfil) return;
    _iniciado = true;
    _abrirPerfil();
    _conciliar();
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', _enLinea); window.addEventListener('offline', _sinLinea);
      window.addEventListener('pageshow', _pageshow); window.addEventListener('pagehide', parar);
    }
    if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', _visibilidad);
    try {
      _sb.auth.onAuthStateChange((ev, ses) => {
        if (ev === 'SIGNED_OUT') { _irA('index.html'); }
        else if (ev === 'SIGNED_IN' && ses && ses.user && _perfil && String(ses.user.id) !== String(_perfil.id)) {
          // Otra pestaña entró con otra cuenta: esta ya no es de quien la abrió.
          if (typeof location !== 'undefined') location.reload();
        }
      });
    } catch (e) { /* cliente sin auth: pruebas */ }
    _estadoCambio();
  }

  /** Canal propio: solo MI fila de perfiles. Cualquier cambio vuelve a validar el acceso al instante. */
  function _abrirPerfil() {
    const c = { ch: null, estado: 'abriendo', intentos: 0, timer: null, cerrando: false, huboCaida: false, propio: true };
    _canales.set('@perfil', c);
    const abrir = () => {
      if (c.cerrando) return;
      if (c.ch) { try { _sb.removeChannel(c.ch); } catch (e) { /* ignorar */ } }
      const ch = _sb.channel('sync:perfil:' + (++_n));
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: 'id=eq.' + _perfil.id }, () => _revalidarAcceso('perfil'));
      ch.subscribe((status) => {
        if (c.cerrando || c.ch !== ch) return;
        if (status === 'SUBSCRIBED') { const r = c.huboCaida; c.estado = 'ok'; c.intentos = 0; c.huboCaida = false; if (r) _revalidarAcceso('conexion'); _estadoCambio(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          c.estado = 'caido'; c.huboCaida = true; clearTimeout(c.timer);
          if (!_sinRed()) { const base = Math.min(CFG.reintentoMax, CFG.reintentoMin * Math.pow(2, c.intentos++)); c.timer = _timer(abrir, Math.round(base * (0.75 + (_extra.azar ? _extra.azar() : Math.random()) * 0.5))); }
          _estadoCambio();
        }
      });
      c.ch = ch;
    };
    c.abrir = abrir; abrir();
  }

  function parar() {
    for (const t of [..._canales.keys()]) { const c = _canales.get(t); c.cerrando = true; clearTimeout(c.timer); if (c.ch) { try { _sb.removeChannel(c.ch); } catch (e) { /* ignorar */ } } _canales.delete(t); }
    for (const r of _regs.values()) clearTimeout(r.timer);
  }

  // _enLinea reabre también el canal del perfil si estaba caído (su reintento es propio).
  const _enLineaPerfil = () => { const c = _canales.get('@perfil'); if (c && c.estado === 'caido' && c.abrir) { c.intentos = 0; clearTimeout(c.timer); c.abrir(); } };
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('online', _enLineaPerfil);

  return {
    iniciar, on, tab, invalidar, resincronizar, unico, vigilar, onEstado, estado, silencioso, parar,
    mapa: () => JSON.parse(JSON.stringify(TABLAS)), tablasAbiertas: () => [..._canales.keys()],
    _cfg: CFG,
  };
})();
