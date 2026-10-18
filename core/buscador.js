'use strict';
/**
 * EIGHT CREATORS LABs — Buscador (Ctrl/⌘ + K)
 * ────────────────────────────────────────────
 * Llega a cualquier sitio desde cualquier sección: saltar a un destino del
 * menú, lanzar una acción (nueva tarea, evaluar…) o abrir el perfil de una
 * persona sin tener que ir primero a la lista donde vive.
 *
 * Cada portal declara sus fuentes con Buscador.registrar(() => [items]); aquí
 * no se sabe nada de roles. Un item es:
 *   { grupo, icono, titulo, sub?, ir: () => void }
 * Qué puede hacer cada quien lo siguen decidiendo RLS y los triggers: el
 * buscador solo ofrece atajos a pantallas y acciones que ya existen.
 *
 * Usa openModal/closeModal (trampa de Tab, Escape y foco devuelto).
 * Depende de: config.js, core/render.js, core/rail.js.
 */
const Buscador = (() => {
  const fuentes = [];
  let _items = [];       // lo que se muestra ahora
  let _sel = 0;

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /** El menú del portal como destinos. */
  function _destinos() {
    const base = typeof _railCfg !== 'undefined' && _railCfg ? (_railCfg.grupos || []).flatMap(g => g.items) : [];
    return base.map(i => ({ grupo: 'Ir a', icono: i.icono, titulo: i.etiqueta, ir: () => switchTab(i.tab, null) }));
  }

  const registrar = fn => { fuentes.push(fn); };

  function _todos() {
    const extra = fuentes.flatMap(f => { try { return f() || []; } catch (e) { console.error('[Buscador]', e); return []; } });
    return [..._destinos(), ...extra];
  }

  function _asegurar() {
    if (document.getElementById('buscador')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="bus-overlay" id="buscador" style="display:none" data-act="cerrarModalFondo" data-arg="buscador">
        <div class="bus-box">
          <div class="bus-campo">
            <i data-lucide="search"></i>
            <input id="bus-q" type="search" autocomplete="off" spellcheck="false" placeholder="Buscar personas o ir a…"
                   aria-label="Buscar personas, secciones y acciones" role="combobox" aria-expanded="true" aria-controls="bus-lista">
            <kbd>Esc</kbd>
          </div>
          <div class="bus-lista" id="bus-lista" role="listbox" aria-label="Resultados"></div>
        </div>
      </div>`);
    renderIconos(document.getElementById('buscador'));
    const q = document.getElementById('bus-q');
    q.addEventListener('input', () => { _sel = 0; _pintar(); });
    q.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); _mover(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); _mover(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); ir(_sel); }
    });
  }

  function _mover(n) {
    if (!_items.length) return;
    _sel = (_sel + n + _items.length) % _items.length;
    _pintar(false);
  }

  function _pintar(recalcular = true) {
    const lista = document.getElementById('bus-lista');
    const q = norm(document.getElementById('bus-q').value.trim());
    if (recalcular) {
      const todos = _todos();
      _items = (q ? todos.filter(i => norm(`${i.titulo} ${i.sub || ''}`).includes(q)) : todos).slice(0, q ? 24 : 14);
    }
    if (!_items.length) { lista.innerHTML = '<p class="bus-vacio">Sin resultados. Prueba con otro nombre.</p>'; return; }
    let grupo = '';
    lista.innerHTML = _items.map((i, n) => {
      const cab = i.grupo !== grupo ? `<div class="bus-grupo">${escHtml(i.grupo)}</div>` : '';
      grupo = i.grupo;
      return `${cab}<button type="button" class="bus-item${n === _sel ? ' bus-item--sel' : ''}" role="option" aria-selected="${n === _sel}" data-act="busIr" data-arg="${n}">
        <i data-lucide="${escHtml(i.icono || 'arrow-right')}"></i>
        <span class="bus-txt"><strong>${escHtml(i.titulo)}</strong>${i.sub ? `<small>${escHtml(i.sub)}</small>` : ''}</span>
      </button>`;
    }).join('');
    renderIconos(lista);
    lista.querySelector('.bus-item--sel')?.scrollIntoView({ block: 'nearest' });
  }

  function abrir() {
    _asegurar();
    document.getElementById('bus-q').value = '';
    _sel = 0;
    _pintar();
    openModal('buscador');
    document.getElementById('bus-q').focus();
  }

  function ir(n) {
    const it = _items[Number(n)];
    if (!it) return;
    closeModal('buscador');
    // Un cuadro tras cerrar: openModal devuelve el foco al disparador y la
    // acción puede abrir otro diálogo.
    setTimeout(() => it.ir(), 0);
  }

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      if (!document.body.classList.contains('con-rail')) return;
      e.preventDefault();
      abrir();
    }
  });

  return { registrar, abrir, ir };
})();
