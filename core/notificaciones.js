'use strict';
/**
 * EIGHT CREATORS LABs — Campana y centro de avisos
 * ────────────────────────────────────────────────
 * Los mismos avisos que salen por correo (cola `notificaciones`, migración 0019) se ven aquí, con estado
 * leído / sin leer (migración 0022). No calcula nada ni inventa avisos: lee lo que la base le devuelve
 * para la persona con sesión (`mis_notificaciones`) y la base ya filtra por destinatario.
 *
 *   · La campana (`.campana`) vive en la cabecera móvil y en el pie del rail de escritorio. Muestra el
 *     contador de sin leer; con 0 no muestra insignia. Se actualiza cada minuto y al volver a la pestaña.
 *   · Al tocarla se abre el panel (`abrirPanel` de core/ui.js: hoja inferior en móvil, lateral en escritorio).
 *   · Tocar un aviso lo marca como leído y lleva a la sección donde se resuelve (no hay enlaces por aviso:
 *     el destino sale del tipo y del portal).
 *   · Si 0022 todavía no está aplicada, el panel lo dice con claridad (los correos no se ven afectados).
 *
 * Depende de: config.js (escHtml, renderIconos), api.js, core/render.js (timeAgo, showToast), core/ui.js (abrirPanel).
 */
const Notif = (() => {
  const POR_PAGINA = 30;
  const REFRESCO_MS = 60000;

  /* tipo → { icono, título, detalle(datos) }. Los textos usan solo los campos que 0019 ya guarda en `datos`. */
  const _t = (v, d = '') => (v == null || v === '' ? d : String(v));
  const TIPOS = {
    nota_publicada:      { icono: 'award',          t: () => 'Tu evaluación está publicada',       d: x => _t(x.periodo) },
    nota_corregida:      { icono: 'pencil',         t: () => 'Actualizaron tu evaluación',         d: x => _t(x.periodo) },
    tarea_asignada:      { icono: 'list-checks',    t: x => 'Nueva tarea: ' + _t(x.tarea),         d: x => [_t(x.asignador), x.fecha_limite ? 'vence ' + x.fecha_limite : ''].filter(Boolean).join(' · ') },
    tarea_por_vencer:    { icono: 'alarm-clock',    t: x => `Vence ${_t(x.cuando, 'pronto')}: ` + _t(x.tarea), d: x => _t(x.fecha_limite) },
    tarea_vencida:       { icono: 'alert-triangle', t: x => 'Tarea vencida: ' + _t(x.tarea),       d: x => x.dias ? `${x.dias} ${Number(x.dias) === 1 ? 'día' : 'días'} de atraso` : '' },
    tarea_devuelta:      { icono: 'refresh',        t: x => 'Te devolvieron: ' + _t(x.tarea),      d: x => _t(x.observacion) },
    tarea_aprobada:      { icono: 'circle-check',   t: x => 'Aprobaron: ' + _t(x.tarea),           d: x => x.puntos != null ? `${x.puntos} de 10 puntos` : '' },
    plazo_movido:        { icono: 'clock',          t: x => 'Cambió el plazo: ' + _t(x.tarea),     d: x => x.fecha_nueva ? 'Ahora vence ' + x.fecha_nueva : '' },
    entrega_por_revisar: { icono: 'inbox',          t: x => `${_t(x.persona, 'Alguien')} entregó: ` + _t(x.tarea), d: x => x.a_tiempo ? 'A tiempo: ' + x.a_tiempo : '' },
    tarea_bloqueada:     { icono: 'pause',          t: x => 'Tarea bloqueada: ' + _t(x.tarea),     d: x => _t(x.motivo) },
    solicitud_acceso:    { icono: 'user-add',       t: x => 'Solicitud de acceso: ' + _t(x.persona, 'alguien'), d: x => _t(x.correo) },
    acceso_aprobado:     { icono: 'check',          t: () => 'Tu acceso fue aprobado',             d: () => 'Ya puedes usar el portal' },
    actividad_nueva:     { icono: 'calendar-plus',  t: x => 'Nueva actividad: ' + _t(x.actividad), d: x => _t(x.fecha) },
    actividad_recordatorio: { icono: 'calendar',    t: x => 'Mañana: ' + _t(x.actividad),          d: x => _t(x.fecha) },
    evaluaciones_sin_publicar: { icono: 'clipboard-list', t: () => 'Faltan evaluaciones por publicar', d: x => x.pendientes ? `${x.pendientes} pendientes en ${_t(x.periodo)}` : _t(x.periodo) },
  };

  /* Categoría visual: el color del icono agrupa de un vistazo (tareas, evaluaciones, actividades, accesos). */
  const _cat = (tipo) => /^(tarea_|plazo_|entrega_)/.test(tipo) ? 'tarea'
    : /^nota_|^evaluaciones_/.test(tipo) ? 'nota'
    : /^actividad_/.test(tipo) ? 'actividad' : 'acceso';

  /* Sección donde se resuelve cada aviso, por portal. Los nombres de pestaña son los de initNav de cada portal. */
  const DESTINOS = {
    miembro:    { nota_publicada: 'perfil', nota_corregida: 'perfil', acceso_aprobado: 'inicio',
                  tarea_asignada: 'trabajos', tarea_por_vencer: 'trabajos', tarea_vencida: 'trabajos', tarea_devuelta: 'trabajos',
                  tarea_aprobada: 'trabajos', plazo_movido: 'trabajos', actividad_nueva: 'calendario', actividad_recordatorio: 'calendario' },
    secretario: { entrega_por_revisar: 'tareas', tarea_bloqueada: 'tareas' },
    admin:      { solicitud_acceso: 'usuarios', entrega_por_revisar: 'tareas', tarea_bloqueada: 'tareas', evaluaciones_sin_publicar: 'evaluar',
                  actividad_nueva: 'agenda', actividad_recordatorio: 'agenda', acceso_aprobado: 'overview' },
  };
  const _destino = (tipo) => (DESTINOS[_cfg.portal] || {})[tipo] || DESTINOS.miembro[tipo] || (_cfg.inicio || 'inicio');

  let _cfg = { portal: 'miembro', inicio: 'inicio' };
  let _n = 0, _disponible = true, _lista = [], _solo = false, _hayMas = false, _cargando = false, _timer = null;

  function configurar(cfg) { _cfg = { ..._cfg, ...cfg }; }

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

  /** Arranca el contador. Lo llama initNav() cuando ya existe la cabecera. */
  function iniciar() {
    refrescarContador();
    clearInterval(_timer);
    _timer = setInterval(refrescarContador, REFRESCO_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescarContador(); });
  }

  /* ── Panel ─────────────────────────────────────────────────────────── */
  const _dia = (iso) => { const d = new Date(iso); d.setHours(0, 0, 0, 0); const h = new Date(); h.setHours(0, 0, 0, 0); return Math.round((h - d) / 86400000); };
  const _grupo = (iso) => { const n = _dia(iso); return n <= 0 ? 'Hoy' : n === 1 ? 'Ayer' : n < 7 ? 'Esta semana' : 'Antes'; };

  function _itemHTML(a) {
    const def = TIPOS[a.tipo] || { icono: 'bell', t: () => 'Aviso', d: () => '' };
    const x = a.datos || {};
    const sinLeer = !a.leida_en;
    const detalle = def.d(x);
    return `<li class="aviso-li"><button type="button" class="aviso${sinLeer ? ' aviso--nuevo' : ''}" data-act="avisoIr" data-arg="${a.id}">
      <span class="aviso-ico aviso-ico--${_cat(a.tipo)}" aria-hidden="true"><i data-lucide="${escHtml(def.icono)}"></i></span>
      <span class="aviso-txt">
        <span class="aviso-fila">
          <span class="aviso-t">${escHtml(def.t(x))}${sinLeer ? '<span class="sr-only"> (sin leer)</span>' : ''}</span>
          <span class="aviso-h">${escHtml(timeAgo(a.creada))}</span>
        </span>
        ${detalle ? `<span class="aviso-d">${escHtml(detalle)}</span>` : ''}
      </span>
    </button></li>`;
  }

  function _pintarPanel() {
    const host = document.getElementById('avisos-cuerpo');
    if (!host) return;
    if (!_disponible) {
      host.innerHTML = `<div class="aviso-estado" role="status"><i data-lucide="info" aria-hidden="true"></i>
        <div><b>Los avisos dentro de la plataforma aún no están activos.</b><p>Se activan con la actualización de la base de datos. Mientras tanto, los avisos siguen llegando a tu correo.</p></div></div>`;
      renderIconos(host); return;
    }
    const lista = _solo ? _lista.filter(a => !a.leida_en) : _lista;
    const sinLeer = _lista.filter(a => !a.leida_en).length;
    const sub = document.getElementById('panel-lateral-sub');
    if (sub) { sub.textContent = sinLeer ? (sinLeer === 1 ? '1 aviso sin leer' : sinLeer + ' avisos sin leer') : 'Estás al día'; sub.hidden = false; }
    const barra = `<div class="avisos-barra">
      <div class="chip-row" role="group" aria-label="Filtrar avisos">
        <button type="button" class="chip${_solo ? '' : ' active'}" data-act="avisosFiltro" data-arg="todas" aria-pressed="${!_solo}">Todos</button>
        <button type="button" class="chip${_solo ? ' active' : ''}" data-act="avisosFiltro" data-arg="nuevas" aria-pressed="${_solo}">Sin leer${sinLeer ? ` (${sinLeer})` : ''}</button>
      </div>
      <button type="button" class="btn-texto avisos-todas" data-act="avisosTodas"${sinLeer ? '' : ' disabled'}><i data-lucide="check-double" aria-hidden="true"></i>Marcar todo</button>
    </div>`;
    if (!lista.length) {
      host.innerHTML = barra + `<div class="aviso-estado" role="status"><i data-lucide="${_solo ? 'check-double' : 'bell'}" aria-hidden="true"></i>
        <div><b>${_solo ? 'Estás al día.' : 'Todavía no tienes avisos.'}</b><p>${_solo ? 'No hay avisos sin leer.' : 'Aquí aparecerán tus tareas nuevas, plazos, evaluaciones y actividades.'}</p></div></div>`;
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
    const r = await API.getNotificaciones({ limite: POR_PAGINA, antes });
    _cargando = false;
    if (!r.ok) {
      if (r.noDisponible) { _disponible = false; _pintarPanel(); return; }
      if (host) renderError(host, r.error, () => _cargar(false));
      return;
    }
    _disponible = true;
    _lista = mas ? _lista.concat(r.data) : r.data;
    _hayMas = r.data.length === POR_PAGINA;
    _pintarPanel();
    refrescarContador();
  }

  function abrir() {
    const cuerpo = abrirPanel({ titulo: 'Avisos', subtitulo: 'Lo que pasó en tu cuenta' });
    cuerpo.innerHTML = '<div id="avisos-cuerpo" class="avisos"></div>';
    _solo = false; _lista = []; _hayMas = false;
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
    const tab = _destino(a.tipo);
    if (typeof switchTab === 'function') switchTab(tab, null);
  }
  async function todas() {
    const r = await API.marcarNotifTodas();
    if (!r.ok) { showToast('No se pudo marcar: ' + r.error, 'error'); return; }
    const ahora = new Date().toISOString();
    _lista.forEach(a => { if (!a.leida_en) a.leida_en = ahora; });
    _n = 0; _pintarContador(); _pintarPanel();
    if (r.n) showToast('Marcaste ' + r.n + (r.n === 1 ? ' aviso' : ' avisos') + ' como leído' + (r.n === 1 ? '.' : 's.'), 'success');
  }
  function filtro(modo) { _solo = modo === 'nuevas'; _pintarPanel(); }

  return { configurar, campanaHTML, iniciar, refrescarContador, abrir, ir, todas, filtro, mas: () => _cargar(true), TIPOS, DESTINOS };
})();
