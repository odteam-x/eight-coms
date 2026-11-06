/**
 * EIGHT CREATORS LABs — Tablero de pendientes («Qué me toca»)
 * ─────────────────────────────────────────────────────────────────────────────
 * Lo primero que se ve en Entregas (miembro y secretaría). Junta en UNA lista las tareas individuales y las de equipo del
 * período y contesta, sin entrar a cada tarjeta: ¿cuáles son de equipo?, ¿cuáles están vencidas?, ¿qué vence esta semana?,
 * ¿qué me devolvieron para corregir?
 *
 * Solo LEE y agrupa (fechas y estados tal como los entrega la base); no calcula notas ni cambia nada. Cada fila lleva a su
 * tarjeta (las acciones siguen siendo las de Tareas / Equipos, que ya validan permisos y la base impone las reglas).
 *
 *   Pendientes.montar(host, { periodoId, yo })   dibuja (o redibuja) el tablero
 *   Pendientes.accion('filtro'|'abrir', arg…)    desde ACCIONES.pd
 */
'use strict';

const Pendientes = (() => {
  const ABIERTA = ['asignada', 'en_curso', 'devuelta', 'bloqueada'];
  const SEMANA = 7;

  const FILTROS = [
    { k: 'vencidas', t: 'Vencidas',          ic: 'alarm-clock',   tono: 'coral' },
    { k: 'semana',   t: 'Vencen esta semana', ic: 'calendar-days', tono: 'ambar' },
    { k: 'corregir', t: 'Por corregir',      ic: 'alert-triangle', tono: 'violeta' },
    { k: 'revision', t: 'En revisión',       ic: 'inbox',         tono: 'azul' },
  ];
  const GRUPOS = [
    { k: 'corregir', t: 'Por corregir',       d: 'Te las devolvieron con una observación.' },
    { k: 'vencidas', t: 'Vencidas',           d: 'Pasó su fecha límite y siguen abiertas.' },
    { k: 'semana',   t: 'Vencen esta semana', d: 'En los próximos 7 días.' },
    { k: 'despues',  t: 'Más adelante',       d: 'Con más de una semana, o sin fecha.' },
    { k: 'pausa',    t: 'En pausa',           d: 'Esperan algo de otra persona; no cuentan como atrasadas.' },
    { k: 'revision', t: 'En revisión',        d: 'Ya las entregaste; falta que alguien las revise.' },
  ];

  const S = { host: null, periodoId: null, yo: null, filtro: 'todas', items: [], ok: true };

  const hoy = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const dias = f => { if (!f) return null; const [a, m, d] = String(f).slice(0, 10).split('-').map(Number); return Math.round((new Date(a, m - 1, d) - hoy()) / 864e5); };
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const corta = f => { const [, m, d] = String(f).slice(0, 10).split('-').map(Number); return `${d} ${MES[m - 1]}`; };
  const estTxt = e => (typeof Tareas !== 'undefined' && Tareas.ESTADOS?.[e]?.txt) || e;

  /** En qué grupo cae una tarea según su estado y su fecha. */
  function grupoDe(t) {
    if (t.estado === 'devuelta') return 'corregir';
    if (t.estado === 'entregada') return 'revision';
    if (t.estado === 'bloqueada') return 'pausa';
    const n = dias(t.fecha);
    if (n != null && n < 0) return 'vencidas';
    if (n != null && n <= SEMANA) return 'semana';
    return 'despues';
  }

  /** ¿Entra la tarea en esa situación? Una devuelta y ya vencida cuenta en «Por corregir» Y en «Vencidas»: son dos preguntas distintas. */
  function pasa(k, t) {
    const n = dias(t.fecha), activa = ['asignada', 'en_curso', 'devuelta'].includes(t.estado);
    return k === 'vencidas' ? activa && n != null && n < 0
      : k === 'semana' ? activa && n != null && n >= 0 && n <= SEMANA
      : k === 'corregir' ? t.estado === 'devuelta'
      : k === 'revision' ? t.estado === 'entregada' : true;
  }

  /** Cuándo vence, dicho como una persona: «Vence hoy», «En 3 días», «Hace 2 días». */
  function cuando(t) {
    if (!t.fecha) return { txt: 'Sin fecha límite', cls: 'nada' };
    const n = dias(t.fecha);
    if (t.estado === 'bloqueada') return { txt: `Plazo ${corta(t.fecha)}`, cls: 'nada' };
    if (n < 0) return { txt: `Vencida hace ${-n} día${n === -1 ? '' : 's'}`, cls: 'vencida' };
    if (n === 0) return { txt: 'Vence hoy', cls: 'pronto' };
    if (n === 1) return { txt: 'Vence mañana', cls: 'pronto' };
    if (n <= SEMANA) return { txt: `En ${n} días`, cls: 'semana' };
    return { txt: corta(t.fecha), cls: 'nada' };
  }

  function normalizar(indiv, equipo) {
    const a = (indiv || []).filter(t => ABIERTA.includes(t.estado) || t.estado === 'entregada').map(t => ({
      tipo: 'i', id: t.id, titulo: t.titulo, estado: t.estado, fecha: t.fecha_limite ? String(t.fecha_limite).slice(0, 10) : null, de: '',
    }));
    const b = (equipo || []).filter(t => (ABIERTA.includes(t.estado) || t.estado === 'entregada') && t.soy_participante !== false).map(t => ({
      tipo: 'e', id: t.id, titulo: t.titulo, estado: t.estado, fecha: t.fecha_limite ? String(t.fecha_limite).slice(0, 10) : null, de: t.equipo_nombre || '',
    }));
    return [...a, ...b].map(x => ({ ...x, grupo: grupoDe(x) }));
  }

  const porOrden = (x, y) => (x.fecha || '9999').localeCompare(y.fecha || '9999') || x.titulo.localeCompare(y.titulo, 'es');

  function filaHTML(t) {
    const c = cuando(t), eq = t.tipo === 'e';
    return `<li><button type="button" class="pd-fila" data-act="pd" data-arg="abrir" data-arg2="${eq ? 'e' : 'i'}:${escHtml(t.id)}"
        aria-label="${escHtml(`${t.titulo}. ${eq ? 'Tarea de equipo ' + t.de : 'Tarea individual'}. ${c.txt}. Ir a la tarea`)}">
      <span class="pd-tipo pd-tipo--${eq ? 'equipo' : 'indiv'}" aria-hidden="true"><i data-lucide="${eq ? 'users' : 'user'}"></i></span>
      <span class="pd-txt">
        <span class="pd-titulo">${escHtml(t.titulo)}</span>
        <span class="pd-sub"><b>${eq ? 'De equipo' : 'Individual'}</b>${eq && t.de ? ` · ${escHtml(t.de)}` : ''} · ${escHtml(estTxt(t.estado))}</span>
      </span>
      <span class="pd-cuando pd-cuando--${c.cls}">${escHtml(c.txt)}</span>
    </button></li>`;
  }

  function render() {
    if (!S.host) return;
    const todos = S.items, cuenta = k => todos.filter(t => pasa(k, t)).length;
    const abiertas = todos.filter(t => t.grupo !== 'revision').length, nEq = todos.filter(t => t.tipo === 'e').length;
    if (!todos.length) {
      S.host.innerHTML = `<section class="pd" aria-labelledby="pd-h"><h3 class="pf-h" id="pd-h">Qué me toca</h3>
        <p class="pd-vacio"><i data-lucide="check-circle" aria-hidden="true"></i> No tienes tareas pendientes en este período. Cuando te asignen una (o se la asignen a tu equipo), aparecerá aquí.</p></section>`;
      const d = document.getElementById('pd-detalle'); if (d) d.open = true;   // sin tareas, el detalle es donde está «+ Mi iniciativa»: que no quede escondido
      renderIconos(S.host); return;
    }
    const visibles = S.filtro === 'todas' ? todos : todos.filter(t => pasa(S.filtro, t));
    const grupos = GRUPOS.map(g => ({ g, l: visibles.filter(t => t.grupo === g.k).sort(porOrden) })).filter(x => x.l.length);   // un filtro conserva los grupos: se ve POR QUÉ entra cada tarea
    S.host.innerHTML = `
      <section class="pd" aria-labelledby="pd-h">
        <div class="pd-cab">
          <h3 class="pf-h" id="pd-h">Qué me toca <small>${abiertas} abierta${abiertas === 1 ? '' : 's'}${nEq ? ` · ${nEq} de equipo` : ''}</small></h3>
          ${S.filtro !== 'todas' ? '<button type="button" class="btn-texto pd-limpiar" data-act="pd" data-arg="filtro" data-arg2="todas">Ver todas</button>' : ''}
        </div>
        <div class="pd-tiles" role="group" aria-label="Filtrar por situación">
          ${FILTROS.map(f => { const n = cuenta(f.k), on = S.filtro === f.k; return `
            <button type="button" class="pd-tile pd-tile--${f.tono}${on ? ' pd-tile--on' : ''}${n ? '' : ' pd-tile--cero'}" aria-pressed="${on}" data-act="pd" data-arg="filtro" data-arg2="${f.k}">
              <i data-lucide="${f.ic}" aria-hidden="true"></i><b>${n}</b><span>${f.t}</span></button>`; }).join('')}
        </div>
        ${grupos.length ? grupos.map(({ g, l }) => `
          <div class="pd-grupo pd-grupo--${g.k}">
            <h4 class="pd-grupo-t">${g.t} <span>${l.length}</span></h4>
            <ul class="pd-lista">${l.map(filaHTML).join('')}</ul>
          </div>`).join('') : '<p class="pd-vacio">Nada en esta situación.</p>'}
        <p class="pd-pie">Toca una fila para ir a la tarea y usar sus botones. «De equipo» = una sola tarea compartida por todo el equipo.</p>
      </section>`;
    renderIconos(S.host);
  }

  async function montar(host, { periodoId, yo } = {}) {
    if (!host) return;
    Object.assign(S, { host, periodoId, yo });
    if (!periodoId) { host.innerHTML = ''; return; }
    const [a, b] = await Promise.all([
      API.getTareas({ periodoId, userId: yo }),
      typeof API.getTareasEquipo === 'function' ? API.getTareasEquipo({ periodoId }) : Promise.resolve({ ok: false }),
    ]);
    if (S.host !== host || S.periodoId !== periodoId) return;          // llegó tarde: el usuario ya cambió de período
    if (!a.ok && !b.ok) { host.innerHTML = ''; const d = document.getElementById('pd-detalle'); if (d) d.open = true; return; }   // sin tablero, el detalle es lo único que hay: a la vista
    S.items = normalizar(a.ok ? a.tareas : [], b.ok ? b.tareas : []);
    render();
  }

  /** Lleva a la tarjeta de la tarea y la resalta un momento. */
  function abrir(ref) {
    const [tipo, id] = String(ref).split(':');
    const sel = tipo === 'e' ? `[data-tarea-eq="${CSS.escape(id)}"]` : `[data-tarea="${CSS.escape(id)}"]`;
    const det = document.getElementById('pd-detalle');
    if (det && !det.open) det.open = true;                 // el detalle va plegado: hay que abrirlo antes de poder llegar a la tarjeta
    const el = document.querySelector(sel);
    if (!el) { showToast('Esa tarea no está en esta lista.', 'info'); return; }
    const calmado = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: calmado ? 'auto' : 'smooth', block: 'center' });
    el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true });
    el.classList.add('pd-resalte'); setTimeout(() => el.classList.remove('pd-resalte'), 1800);
  }

  function accion(a, arg) {
    if (a === 'filtro') { S.filtro = S.filtro === arg ? 'todas' : arg; render(); }
    else if (a === 'abrir') abrir(arg);
  }

  return { montar, accion, grupoDe, cuando, normalizar, pasa };
})();
