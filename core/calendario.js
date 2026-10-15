'use strict';
/**
 * EIGHT CREATORS LABs — Calendario (para todos los usuarios)
 * ───────────────────────────────────────────────────────────
 * Un mes en cuadrícula + la agenda del día elegido. Reúne en un solo sitio lo
 * que antes estaba repartido entre «Fechas del período», el calendario de
 * actividades y las fechas límite de las tareas:
 *   · hitos de cada período (inicio, fin del trabajo, entrega de scores,
 *     jornada), con una franja que marca qué días pertenecen a cada PE;
 *   · tareas con fecha límite: las propias (miembro), las del distrito
 *     (secretario) o todas (admin). Qué ve cada quien lo decide RLS.
 *
 * Los períodos (PE) se leen del calendario, no al revés: el PE de un día es el
 * que lo contiene (de su inicio a la entrega o la jornada).
 *
 * PRESENTACIÓN: no calcula ninguna evaluación.
 * Depende de: config.js, core/store.js, core/render.js, core/ui.js,
 *             core/tareas.js, api.js.
 */
const Calendario = (() => {
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const HITOS = {
    inicio:     { etq: 'Inicio del período', cls: 'inicio',  icono: 'flag' },
    finTrabajo: { etq: 'Fin del trabajo',    cls: 'fin',     icono: 'clock' },
    entrega:    { etq: 'Entrega de scores',  cls: 'entrega', icono: 'target' },
    jornada:    { etq: 'Jornada',            cls: 'jornada', icono: 'star' },
  };

  let S = null;                       // estado de la instancia en pantalla

  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const deIso = s => { const [a, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(a, m - 1, d); };
  const hoyIso = () => iso(new Date());

  /** El período cuyo rango contiene la fecha (de su inicio a su entrega o jornada). */
  function periodoDe(fecha, periodos = Store.periodos() || []) {
    return periodos.find(p => p.inicio && fecha >= p.inicio && fecha <= (p.jornada || p.entrega || p.finTrabajo || p.inicio)) || null;
  }

  async function _cargar() {
    const periodos = Store.periodos() || [];
    const eventos = [];
    for (const p of periodos) {
      for (const [k, h] of Object.entries(HITOS)) {
        if (p[k]) eventos.push({ fecha: String(p[k]).slice(0, 10), tipo: 'hito', cls: h.cls, icono: h.icono, titulo: h.etq, sub: p.pe, pe: p.pe });
      }
    }
    // Tareas con fecha límite, de los períodos que las admiten.
    const v2 = periodos.filter(esPeriodoV2);
    const res = await Promise.all(v2.map(p => API.getTareas({ periodoId: p.id }).then(r => ({ p, r }))));
    for (const { p, r } of res) {
      if (!r.ok) continue;
      for (const t of r.tareas) {
        if (!t.fecha_limite) continue;
        const abierta = ['asignada', 'en_curso', 'devuelta', 'bloqueada'].includes(t.estado);
        const vencida = abierta && t.estado !== 'bloqueada' && String(t.fecha_limite).slice(0, 10) < hoyIso();
        eventos.push({
          fecha: String(t.fecha_limite).slice(0, 10), tipo: 'tarea',
          cls: vencida ? 'vencida' : t.estado === 'aprobada' ? 'aprobada' : t.estado === 'entregada' ? 'entregada' : 'tarea',
          icono: 'list-checks', titulo: t.titulo, sub: S.nombres.get(t.asignada_a) || '', pe: p.pe,
          tareaId: t.id, personaId: t.asignada_a, estado: t.estado,
        });
      }
    }
    S.eventos = eventos;
  }

  /* ── Pintado ─────────────────────────────────────────────────────────── */
  function _celdas() {
    const [a, m] = [S.mes.getFullYear(), S.mes.getMonth()];
    const primero = new Date(a, m, 1);
    const desfase = (primero.getDay() + 6) % 7;                 // lunes = 0
    const inicio = new Date(a, m, 1 - desfase);
    return Array.from({ length: 42 }, (_, i) => new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i));
  }

  function _filtrados() {
    return S.eventos.filter(e => (e.tipo === 'hito' ? S.ver.hitos : S.ver.tareas));
  }

  function _html() {
    const evs = _filtrados();
    const porDia = new Map();
    for (const e of evs) { if (!porDia.has(e.fecha)) porDia.set(e.fecha, []); porDia.get(e.fecha).push(e); }
    const hoy = hoyIso();
    const celdas = _celdas().map(d => {
      const f = iso(d), fuera = d.getMonth() !== S.mes.getMonth();
      const lista = porDia.get(f) || [];
      const pe = periodoDe(f);
      const primeroPe = pe && pe.inicio === f;
      return `<button type="button" class="cal2-dia${fuera ? ' cal2-dia--fuera' : ''}${f === hoy ? ' cal2-dia--hoy' : ''}${f === S.dia ? ' cal2-dia--sel' : ''}${pe ? ' cal2-dia--pe' : ''}"
          data-act="calDia" data-arg="${f}" aria-label="${escHtml(`${d.getDate()} de ${MESES[d.getMonth()]}${lista.length ? ', ' + lista.length + ' evento' + (lista.length === 1 ? '' : 's') : ''}`)}"
          aria-pressed="${f === S.dia}">
        <span class="cal2-num">${d.getDate()}</span>
        ${primeroPe ? `<span class="cal2-pe">${escHtml(pe.pe)}</span>` : ''}
        <span class="cal2-puntos">${lista.slice(0, 4).map(e => `<i class="cal2-punto cal2-punto--${e.cls}"></i>`).join('')}${lista.length > 4 ? `<b>+${lista.length - 4}</b>` : ''}</span>
      </button>`;
    }).join('');

    const peHoy = periodoDe(hoy);
    return `
      <div class="cal2">
        <section class="cal2-mes" aria-label="Calendario de ${MESES[S.mes.getMonth()]}">
          <header class="cal2-cab">
            <h2 class="cal2-titulo">${MESES[S.mes.getMonth()]} <span>${S.mes.getFullYear()}</span></h2>
            <div class="cal2-nav">
              <button type="button" class="cal2-btn" data-act="calMes" data-arg="-1" aria-label="Mes anterior"><i data-lucide="chevron-left"></i></button>
              <button type="button" class="cal2-btn cal2-btn--hoy" data-act="calMes" data-arg="0">Hoy</button>
              <button type="button" class="cal2-btn" data-act="calMes" data-arg="1" aria-label="Mes siguiente"><i data-lucide="chevron-right"></i></button>
            </div>
          </header>
          <div class="cal2-filtros" role="group" aria-label="Qué mostrar">
            <button type="button" class="cal2-chip${S.ver.hitos ? ' on' : ''}" aria-pressed="${S.ver.hitos}" data-act="calFiltro" data-arg="hitos"><i class="cal2-punto cal2-punto--entrega"></i>Fechas de los períodos</button>
            <button type="button" class="cal2-chip${S.ver.tareas ? ' on' : ''}" aria-pressed="${S.ver.tareas}" data-act="calFiltro" data-arg="tareas"><i class="cal2-punto cal2-punto--tarea"></i>${S.modo === 'miembro' ? 'Mis tareas' : S.modo === 'secretario' ? 'Tareas del distrito' : 'Todas las tareas'}</button>
            ${peHoy ? `<span class="cal2-hoy-pe">Hoy estás en <strong>${escHtml(peHoy.pe)}</strong></span>` : ''}
          </div>
          <div class="cal2-sem" aria-hidden="true">${DIAS.map(d => `<span>${d}</span>`).join('')}</div>
          <div class="cal2-grid">${celdas}</div>
        </section>
        <aside class="cal2-agenda" aria-live="polite">${_agendaHTML()}</aside>
      </div>`;
  }

  function _agendaHTML() {
    const lista = _filtrados().filter(e => e.fecha === S.dia);
    const d = deIso(S.dia);
    const pe = periodoDe(S.dia);
    const puedeCrear = !document.body.classList.contains('gestion-archivada') && pe && esPeriodoV2(pe);
    return `
      <h3 class="cal2-agenda-h"><span>${['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][d.getDay()]}</span>${d.getDate()} de ${MESES[d.getMonth()]}</h3>
      ${pe ? `<p class="cal2-agenda-pe">${escHtml(pe.pe)}${pe.nombre && pe.nombre !== pe.pe ? ' · ' + escHtml(pe.nombre) : ''}</p>` : '<p class="cal2-agenda-pe">Fuera de un período</p>'}
      ${lista.length ? `<ul class="cal2-lista">${lista.map(e => `
        <li class="cal2-ev cal2-ev--${e.cls}">
          <span class="cal2-ev-ico"><i data-lucide="${escHtml(e.icono)}"></i></span>
          <span class="cal2-ev-txt"><strong>${escHtml(e.titulo)}</strong><small>${escHtml(e.sub)}${e.tipo === 'tarea' ? ' · ' + escHtml((Tareas.ESTADOS[e.estado] || {}).txt || '') : ''}</small></span>
          ${e.tipo === 'tarea' ? `<button type="button" class="cal2-ver" data-act="calVer" data-arg="${escHtml(e.personaId)}" data-arg2="${e.tareaId}">${S.puedeRevisar ? 'Abrir perfil' : 'Ir a Entregas'}</button>` : ''}
        </li>`).join('')}</ul>`
        : '<p class="cal2-vacio">Nada programado este día.</p>'}
      ${puedeCrear ? `<button type="button" class="btn-save cal2-nueva" data-act="calNueva" data-arg="${S.dia}"><i data-lucide="plus"></i>${S.puedeRevisar ? 'Nueva tarea para este día' : 'Mi iniciativa para este día'}</button>` : ''}`;
  }

  function _pintar() {
    S.el.innerHTML = _html();
    animarEntrada(S.el);
  }

  /**
   * @param {object} o
   * @param {Element} o.el
   * @param {string} o.yo          id de la sesión
   * @param {'miembro'|'secretario'|'admin'} o.modo
   * @param {Array<{id,nombre}>} [o.personas]   a quién se le puede asignar (revisor)
   */
  async function montar({ el, yo, modo = 'miembro', personas = [] }) {
    const hoy = new Date();
    S = { el, yo, modo, puedeRevisar: modo !== 'miembro', esAdmin: modo === 'admin', personas,
          nombres: new Map(personas.map(p => [p.id, p.nombre])),
          mes: new Date(hoy.getFullYear(), hoy.getMonth(), 1), dia: hoyIso(), eventos: [], ver: { hitos: true, tareas: true } };
    el.innerHTML = esqueletoHTML();
    await _cargar();
    _pintar();
  }

  /* ── Acciones (data-act en config.js) ────────────────────────────────── */
  function mes(n) {
    if (!S) return;
    const d = Number(n);
    S.mes = d === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(S.mes.getFullYear(), S.mes.getMonth() + d, 1);
    if (d === 0) S.dia = hoyIso();
    _pintar();
  }
  function dia(f) { if (!S) return; S.dia = f; const d = deIso(f); S.mes = new Date(d.getFullYear(), d.getMonth(), 1); _pintar(); }
  function filtro(k) { if (!S) return; S.ver[k] = !S.ver[k]; _pintar(); }
  function nueva(f) {
    if (!S) return;
    const pe = periodoDe(f); if (!pe) return;
    Tareas.nueva({ periodoId: pe.id, yo: S.yo, revisor: S.puedeRevisar, esAdmin: S.esAdmin, personas: S.personas, fecha: f,
                   onCambio: () => _cargar().then(_pintar) });
  }
  function ver(personaId) {
    if (S?.puedeRevisar && typeof Perfil !== 'undefined') Perfil.abrir(personaId);
    else if (typeof switchTab === 'function') switchTab('trabajos', null);
  }

  return { montar, mes, dia, filtro, nueva, ver, periodoDe };
})();
