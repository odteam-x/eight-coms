'use strict';
/**
 * EIGHT CREATORS LABs — Selector de personas y equipos
 * ────────────────────────────────────────────────────
 * Un solo componente para elegir a quién va algo: una tarea, una actividad, un reporte. Se busca escribiendo
 * (con o sin tildes), se filtra por Todos / Equipos / Personas y cada fila trae lo que hace falta para decidir:
 *   · rol de la persona (insignia);
 *   · si el rol para el que se elige está HABILITADO para ella y si lo PREFIERE (migración 0021);
 *   · su carga actual (tareas abiertas y vencidas).
 *
 * Un EQUIPO es un distrito o un rol. Elegir un equipo agrega a sus miembros de ese momento (la selección
 * siempre es una lista de personas; quien entre después al equipo no se suma sola).
 *
 * Es solo presentación y estado de la selección: NO decide permisos. Qué personas puede ver quien llama
 * lo decide la base (RLS / personas_asignables); aquí solo llega lo que ya venía filtrado.
 *
 * Uso:
 *   const s = Selector.crear({ id: 'asig', personas, equipos, seleccion: [], onCambio: ids => {} });
 *   s.montar(elemento);   s.seleccion();   s.setContexto({ rolId, personas });
 * Todo texto humano pasa por escHtml. Las acciones van por ACCIONES (config.js): selToggle, selFiltro, selQuitar,
 * selTodas, selNinguna; el buscador por data-input="selBuscar".
 * Depende de: config.js (escHtml), core/render.js (initials, renderIconos).
 */
const Selector = (() => {
  const reg = new Map();
  const SOBRECARGA = 5;   // tareas abiertas a partir de las cuales se avisa «carga alta»

  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  /** Normaliza una fila de personas_asignables() (o un {id, nombre} suelto) al formato del selector. */
  function persona(r) {
    return {
      id: r.persona_id ?? r.id, nombre: r.nombre || r.email || '—', email: r.email || '',
      distrito: r.distrito || '', rol_id: r.rol_id ?? null, rol_nombre: r.rol_nombre || r.rol || '',
      permitido: r.permitido ?? null, prioridad: r.prioridad ?? null, predeterminado: !!r.predeterminado,
      abiertas: Number(r.tareas_abiertas ?? r.abiertas ?? 0), vencidas: Number(r.tareas_vencidas ?? r.vencidas ?? 0),
      activo: r.activo_periodo !== false,
    };
  }

  /** Equipos a partir de las personas: un equipo por distrito y uno por rol (solo si tiene 2 o más). */
  function equiposDe(personas, { nombreDistrito = d => d } = {}) {
    const g = (clave, tipo, nombre) => {
      const m = new Map();
      for (const p of personas) {
        const k = clave(p); if (!k) continue;
        if (!m.has(k)) m.set(k, { id: tipo + ':' + k, tipo, nombre: nombre(k, p), miembros: [] });
        m.get(k).miembros.push(p.id);
      }
      return [...m.values()].filter(e => e.miembros.length >= 2);
    };
    return [
      ...g(p => p.distrito, 'distrito', k => { const n = String(nombreDistrito(k)); return /^distrito/i.test(n) ? n : 'Distrito ' + n; }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      ...g(p => p.rol_nombre, 'rol', (k) => 'Rol ' + k).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    ];
  }

  function crear(cfg) {
    const S = {
      id: cfg.id, el: null, q: '', filtro: 'todos',
      personas: (cfg.personas || []).map(persona), equipos: cfg.equipos || [],
      sel: new Set(cfg.seleccion || []), rolId: cfg.rolId ?? null, rolNombre: cfg.rolNombre || '',
      max: cfg.max || 500, onCambio: cfg.onCambio || (() => {}),
      vacio: cfg.vacio || 'Nadie coincide con la búsqueda.',
    };
    const byId = id => S.personas.find(p => p.id === id);

    function estadoEquipo(e) {
      const n = e.miembros.filter(id => S.sel.has(id)).length;
      return { n, todo: n === e.miembros.length, algo: n > 0 };
    }

    function insignias(p) {
      const out = [];
      if (p.rol_nombre) out.push(`<span class="etiqueta etq-gris">${escHtml(p.rol_nombre)}</span>`);
      if (S.rolId != null) {
        if (p.permitido === true) out.push('<span class="etiqueta etq-verde" title="El rol está entre los que tiene habilitados">Rol habilitado</span>');
        else if (p.permitido === false) out.push('<span class="etiqueta etq-ambar" title="No tiene habilitado ese rol: solo la administración puede asignárselo, como excepción">Rol no habilitado</span>');
        if (p.predeterminado) out.push('<span class="etiqueta etq-azul" title="Es el rol que más quiere hacer">Su rol predeterminado</span>');
        else if (p.prioridad != null) out.push(`<span class="etiqueta etq-azul" title="Lo puso entre sus preferencias">Prefiere este rol · n.º ${escHtml(p.prioridad)}</span>`);
      }
      if (!p.activo) out.push('<span class="etiqueta etq-gris" title="Está marcada como no participante en este período">No participa</span>');
      if (p.abiertas >= SOBRECARGA) out.push(`<span class="etiqueta etq-ambar" title="${escHtml(p.abiertas)} tareas abiertas en este período">Carga alta · ${escHtml(p.abiertas)}</span>`);
      else if (p.abiertas > 0) out.push(`<span class="etiqueta etq-gris">${escHtml(p.abiertas)} abierta${p.abiertas === 1 ? '' : 's'}</span>`);
      if (p.vencidas > 0) out.push(`<span class="etiqueta etq-rojo">${escHtml(p.vencidas)} vencida${p.vencidas === 1 ? '' : 's'}</span>`);
      return out.join('');
    }

    function filaPersona(p) {
      const on = S.sel.has(p.id);
      return `<li><button type="button" class="sel-fila${on ? ' sel-fila--on' : ''}" data-act="selToggle" data-arg="${escHtml(S.id)}" data-arg2="p:${escHtml(p.id)}" aria-pressed="${on}">
        <span class="sel-av" aria-hidden="true">${escHtml(initials(p.nombre) || '?')}</span>
        <span class="sel-txt"><b>${escHtml(p.nombre)}</b>${p.distrito ? `<small>${escHtml(p.distrito)}</small>` : ''}<span class="sel-insignias">${insignias(p)}</span></span>
        <span class="sel-check${on ? ' sel-check--on' : ''}" aria-hidden="true">${on ? '<i data-lucide="check"></i>' : ''}</span></button></li>`;
    }
    function filaEquipo(e) {
      const st = estadoEquipo(e);
      return `<li><button type="button" class="sel-fila sel-fila--equipo${st.todo ? ' sel-fila--on' : st.algo ? ' sel-fila--parcial' : ''}" data-act="selToggle" data-arg="${escHtml(S.id)}" data-arg2="e:${escHtml(e.id)}"
          aria-pressed="${st.todo ? 'true' : st.algo ? 'mixed' : 'false'}">
        <span class="sel-av sel-av--eq" aria-hidden="true"><i data-lucide="${e.tipo === 'rol' ? 'layers' : 'users'}"></i></span>
        <span class="sel-txt"><b>${escHtml(e.nombre)}</b><small>${escHtml(e.miembros.length)} personas${st.algo ? ' · ' + escHtml(st.n) + ' elegida' + (st.n === 1 ? '' : 's') : ''}</small></span>
        <span class="sel-check${st.todo ? ' sel-check--on' : st.algo ? ' sel-check--parcial' : ''}" aria-hidden="true">${st.todo ? '<i data-lucide="check"></i>' : st.algo ? '<i data-lucide="minus"></i>' : ''}</span></button></li>`;
    }

    function visibles() {
      const q = norm(S.q);
      const coincideP = p => !q || norm(p.nombre).includes(q) || norm(p.email).includes(q) || norm(p.rol_nombre).includes(q) || norm(p.distrito).includes(q);
      const coincideE = e => !q || norm(e.nombre).includes(q);
      return {
        equipos: S.filtro === 'personas' ? [] : S.equipos.filter(coincideE),
        personas: S.filtro === 'equipos' ? [] : S.personas.filter(coincideP),
      };
    }

    function pintarLista() {
      if (!S.el) return;
      const v = visibles();
      const lista = S.el.querySelector('.sel-lista');
      const filas = [...v.equipos.map(filaEquipo), ...v.personas.map(filaPersona)];
      lista.innerHTML = filas.length ? filas.join('') : `<li class="sel-vacio">${escHtml(S.vacio)}</li>`;
      // Chips de lo elegido
      const elegidas = [...S.sel].map(byId).filter(Boolean);
      const MAXCHIPS = 12;
      S.el.querySelector('.sel-elegidas').innerHTML = elegidas.length
        ? elegidas.slice(0, MAXCHIPS).map(p => `<span class="sel-chip">${escHtml(p.nombre)}<button type="button" class="sel-chip-x" data-act="selQuitar" data-arg="${escHtml(S.id)}" data-arg2="${escHtml(p.id)}" aria-label="Quitar a ${escHtml(p.nombre)}"><i data-lucide="x"></i></button></span>`).join('')
          + (elegidas.length > MAXCHIPS ? `<span class="sel-mas">y ${elegidas.length - MAXCHIPS} más</span>` : '')
        : '<span class="sel-nadie">Nadie elegida todavía.</span>';
      S.el.querySelector('.sel-n').textContent = `${S.sel.size} ${S.sel.size === 1 ? 'persona elegida' : 'personas elegidas'}`;
      S.el.querySelectorAll('.sel-filtros [data-arg2]').forEach(b => { const on = b.dataset.arg2 === S.filtro; b.classList.toggle('tk-chip--on', on); b.setAttribute('aria-pressed', String(on)); });
      if (typeof renderIconos === 'function') renderIconos(S.el);
    }

    const api = {
      id: S.id,
      /** Pinta el selector dentro de `el` (una sola vez; después solo se repinta la lista). */
      montar(el) {
        S.el = el; el.dataset.sel = S.id; el.classList.add('sel');
        el.innerHTML = `
          <div class="sel-barra">
            <label class="sr-only" for="${escHtml(S.id)}-q">Buscar personas o equipos</label>
            <input class="cfg-inp sel-q" id="${escHtml(S.id)}-q" type="search" autocomplete="off" placeholder="Buscar por nombre, rol o distrito…" value="${escHtml(S.q)}" data-input="selBuscar" data-sel-input="${escHtml(S.id)}">
            ${S.equipos.length ? `<div class="sel-filtros tk-filtros" role="group" aria-label="Mostrar">
              ${[['todos', 'Todos'], ['equipos', 'Equipos'], ['personas', 'Personas']].map(([k, l]) => `<button type="button" class="tk-chip" data-act="selFiltro" data-arg="${escHtml(S.id)}" data-arg2="${k}" aria-pressed="false">${l}</button>`).join('')}
            </div>` : '<div class="sel-filtros" hidden></div>'}
          </div>
          <div class="sel-elegidas" aria-live="polite"></div>
          <ul class="sel-lista" aria-label="Personas y equipos"></ul>
          <div class="sel-pie">
            <span class="sel-n" role="status"></span>
            <span class="sel-pie-acc">
              <button type="button" class="btn--texto" data-act="selTodas" data-arg="${escHtml(S.id)}">Elegir las que se ven</button>
              <button type="button" class="btn--texto" data-act="selNinguna" data-arg="${escHtml(S.id)}">Quitar todas</button>
            </span>
          </div>`;
        pintarLista();
      },
      seleccion: () => [...S.sel],
      setSeleccion(ids) { S.sel = new Set(ids); pintarLista(); },
      /** Cambia el contexto de rol: las insignias de compatibilidad y preferencia se recalculan con `personas`. */
      setContexto({ rolId = null, rolNombre = '', personas = null } = {}) {
        S.rolId = rolId; S.rolNombre = rolNombre;
        if (personas) S.personas = personas.map(persona);
        pintarLista();
      },
      persona: byId,
      personas: () => S.personas,
      buscar(q) { S.q = q; pintarLista(); },
      setFiltro(f) { S.filtro = f; pintarLista(); },
      toggle(clave) {
        const [t, ...r] = clave.split(':'); const id = r.join(':');
        if (t === 'p') {
          if (S.sel.has(id)) S.sel.delete(id); else if (S.sel.size < S.max) S.sel.add(id);
        } else {
          const e = S.equipos.find(x => x.id === id); if (!e) return;
          const todo = estadoEquipo(e).todo;
          for (const m of e.miembros) { if (todo) S.sel.delete(m); else if (S.sel.size < S.max) S.sel.add(m); }
        }
        pintarLista(); S.onCambio(api.seleccion());
      },
      quitar(id) { S.sel.delete(id); pintarLista(); S.onCambio(api.seleccion()); },
      todasLasVisibles() { for (const p of visibles().personas) if (S.sel.size < S.max) S.sel.add(p.id); pintarLista(); S.onCambio(api.seleccion()); },
      ninguna() { S.sel.clear(); pintarLista(); S.onCambio(api.seleccion()); },
    };
    reg.set(S.id, api);
    return api;
  }

  const de = id => reg.get(id);
  const soltar = id => reg.delete(id);

  // Enter en el buscador: alterna la primera coincidencia (se elige sin soltar el teclado).
  document.addEventListener('keydown', e => {
    const inp = e.target;
    if (e.key !== 'Enter' || !(inp instanceof HTMLInputElement) || !inp.dataset.selInput) return;
    e.preventDefault();
    const s = reg.get(inp.dataset.selInput); if (!s) return;
    const primera = s.el.querySelector('.sel-lista .sel-fila');
    if (primera) s.toggle(primera.dataset.arg2);
  });

  return { crear, de, soltar, equiposDe, persona, SOBRECARGA };
})();

/** data-input del buscador (lista blanca en config.js). */
function selBuscar(el) { Selector.de(el.dataset.selInput)?.buscar(el.value); }
