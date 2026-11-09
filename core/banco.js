/**
 * Banco de imágenes (migración 0058): enlaces a las fotos y videos de los eventos, con título, descripción y evento.
 *
 * El sistema NO guarda archivos: guarda enlaces (Drive, Dropbox, iCloud…). Cualquier persona con el acceso aprobado ve todo el
 * banco y añade los suyos; quien subió un enlace (o la administración) lo edita o lo borra. Autor, rol y distrito los fija el
 * servidor, y es lo que permite filtrar «las imágenes de Fotografía». Mismo módulo en los tres portales.
 *
 * Seguridad en el cliente: todo texto humano pasa por escHtml(); el enlace se abre en pestaña nueva con rel="noopener noreferrer"
 * y solo si empieza por http(s) (la base lo exige también). Sin 0058 la pantalla lo dice en vez de fingir que no hay nada.
 */
const Banco = (() => {
  const S = { el: null, yo: null, esAdmin: false, rows: [], roles: new Map(), nombres: new Map(), f: { q: '', rol: '', evento: '' }, estado: 'cargando', error: '' };
  const esHttp = u => /^https?:\/\/[^\s]+$/i.test(String(u || ''));
  const fechaTxt = iso => { try { return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };
  const puede = r => S.esAdmin || r.creado_por === S.yo;
  const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  async function montar({ el, yo, esAdmin = false, roles = [], personas = [] } = {}) {
    S.el = el; S.yo = yo; S.esAdmin = !!esAdmin;
    // Los portales de miembro y secretaría no cargan los roles: se piden aquí (solo para rotular; RLS decide qué llega).
    if (!(roles || []).length) { try { roles = await API.getRoles(false); } catch (e) { roles = []; } }
    S.roles = new Map((roles || []).map(r => [String(r.id), r.nombre]));
    S.nombres = new Map((personas || []).map(p => [p.id, p.nombre]));
    if (!el) return;
    S.estado = 'cargando'; pintar();
    await cargar();
  }
  async function cargar() {
    const r = await API.getBancoImagenes();
    if (!r.ok) { S.estado = r.disponible ? 'error' : 'ausente'; S.error = r.error || ''; }
    else { S.estado = 'ok'; S.rows = r.rows; }
    pintar();
  }

  function filtradas() {
    const q = sinTildes(S.f.q).trim();
    return S.rows.filter(r => (!S.f.rol || String(r.rol_id == null ? '' : r.rol_id) === S.f.rol) && (!S.f.evento || r.evento === S.f.evento)
      && (!q || sinTildes(r.titulo + ' ' + r.descripcion + ' ' + r.evento).includes(q)));
  }

  function filaHTML(r) {
    const rol = r.rol_id != null ? S.roles.get(String(r.rol_id)) : '';
    const autor = S.nombres.get(r.creado_por) || '';
    const ok = esHttp(r.enlace);
    let host = ''; try { host = new URL(r.enlace).hostname.replace(/^www\./, ''); } catch (e) { /* enlace inválido: no se muestra el sitio */ }
    const id = escHtml(String(r.id)), t = escHtml(r.titulo);
    return `<li class="bco-fila">
      <span class="bco-ico" aria-hidden="true"><i data-lucide="image"></i></span>
      <div class="bco-txt">
        <div class="bco-t">${t}</div>
        ${r.descripcion ? `<p class="bco-d">${escHtml(r.descripcion)}</p>` : ''}
        <div class="bco-meta">
          ${r.evento ? `<span class="etiqueta etq-azul">${escHtml(r.evento)}</span>` : ''}
          ${rol ? `<span class="etiqueta etq-gris">${escHtml(rol)}</span>` : ''}
          <span class="bco-peq">${autor ? escHtml(autor) + ' · ' : ''}${escHtml(fechaTxt(r.created_at))}${host ? ' · ' + escHtml(host) : ''}</span>
        </div>
      </div>
      <div class="bco-acc">
        ${ok ? `<a class="btn--secundario bco-abrir" href="${escHtml(r.enlace)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir las imágenes de ${t} (se abre en otra pestaña)">Abrir</a>` : '<span class="bco-peq">Enlace no válido</span>'}
        <button type="button" class="btn-icon" data-act="banco" data-arg="copiar" data-arg2="${id}" aria-label="Copiar el enlace de ${t}" title="Copiar enlace"><i data-lucide="copy" aria-hidden="true"></i></button>
        ${puede(r) ? `<button type="button" class="btn-icon" data-act="banco" data-arg="editar" data-arg2="${id}" aria-label="Editar ${t}" title="Editar"><i data-lucide="pencil" aria-hidden="true"></i></button>
        <button type="button" class="btn-icon btn-icon--danger" data-act="banco" data-arg="borrar" data-arg2="${id}" aria-label="Eliminar ${t}" title="Eliminar"><i data-lucide="trash-2" aria-hidden="true"></i></button>` : ''}
      </div></li>`;
  }

  function pintar() {
    const el = S.el; if (!el) return;
    if (S.estado === 'cargando') { el.innerHTML = '<div class="loading-box"><span class="spin"></span></div>'; return; }
    if (S.estado === 'ausente') { el.innerHTML = '<div class="empty-box"><div class="empty-txt">El banco de imágenes necesita la migración 0058 en la base de datos. Aplícala en el SQL Editor y vuelve a abrir esta pantalla.</div></div>'; return; }
    if (S.estado === 'error') { renderError(el, S.error || 'No se pudo cargar el banco.', cargar); return; }
    const roles = [...new Set(S.rows.map(r => r.rol_id).filter(x => x != null).map(String))];
    const eventos = [...new Set(S.rows.map(r => r.evento).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const lista = filtradas();
    const hay = S.rows.length > 0;
    el.innerHTML = `
      <div class="filtros-fila bco-filtros">
        <input class="search-inp" type="search" aria-label="Buscar en el banco" placeholder="Buscar por título, descripción o evento…" value="${escHtml(S.f.q)}" data-input="bancoFiltrar" data-f="q" autocomplete="off">
        <select class="cfg-inp cfg-select" aria-label="Filtrar por rol" data-change="bancoFiltrar" data-f="rol"><option value="">Todos los roles</option>${roles.map(id => `<option value="${escHtml(id)}"${S.f.rol === id ? ' selected' : ''}>${escHtml(S.roles.get(id) || 'Rol ' + id)}</option>`).join('')}</select>
        <select class="cfg-inp cfg-select" aria-label="Filtrar por evento" data-change="bancoFiltrar" data-f="evento"><option value="">Todos los eventos</option>${eventos.map(e => `<option value="${escHtml(e)}"${S.f.evento === e ? ' selected' : ''}>${escHtml(e)}</option>`).join('')}</select>
        <button type="button" class="btn-save" data-act="banco" data-arg="nuevo"><i data-lucide="plus"></i>Añadir enlace</button>
      </div>
      ${lista.length ? `<p class="bco-cuenta" role="status">${lista.length} de ${S.rows.length} enlace${S.rows.length === 1 ? '' : 's'}</p><ul class="lista-aj bco-lista">${lista.map(filaHTML).join('')}</ul>`
        : `<div class="empty-box bco-vacio"><div class="empty-txt">${hay ? 'Ningún enlace coincide con estos filtros.' : 'Todavía no hay imágenes en el banco. Añade el enlace de la carpeta de un evento (Drive, Dropbox…) con un título y una descripción.'}</div>
          ${hay ? '<button type="button" class="btn--secundario" data-act="banco" data-arg="limpiar">Quitar filtros</button>' : '<button type="button" class="btn-save" data-act="banco" data-arg="nuevo">Añadir el primero</button>'}</div>`}`;
    if (typeof renderIconos === 'function') renderIconos(el);
  }

  function campos(r) {
    r = r || {};
    return [
      { id: 'titulo', tipo: 'texto', label: 'Título', req: true, valor: r.titulo, ph: 'Ej.: Jornada de cierre · escenario', max: 120 },
      { id: 'evento', tipo: 'texto', label: 'Evento (opcional)', valor: r.evento, ph: 'Ej.: Jornada de cierre', max: 120 },
      { id: 'descripcion', tipo: 'area', label: 'Descripción (opcional)', valor: r.descripcion, ph: 'Qué hay en la carpeta, quién la tomó, créditos…', max: 600, filas: 3 },
      { id: 'enlace', tipo: 'texto', label: 'Enlace a las imágenes', req: true, valor: r.enlace, ph: 'https://drive.google.com/…', max: 1000, ayuda: 'Debe empezar por http:// o https://. Comprueba que la carpeta esté compartida con quien deba verla.' },
    ];
  }
  const validar = v => {
    if ((v.titulo || '').length < 3) return 'El título necesita al menos 3 caracteres.';
    if (!esHttp(v.enlace)) return 'El enlace debe empezar por http:// o https:// y no llevar espacios.';
    return null;
  };

  function abrirForm(r) {
    Tareas.abrirModal({
      titulo: r ? 'Editar enlace' : 'Añadir enlace al banco', campos: campos(r), confirmar: r ? 'Guardar' : 'Añadir',
      onConfirm: async v => {
        const msg = validar(v); if (msg) return msg;
        const res = await API.saveBancoImagen({ id: r ? r.id : null, titulo: v.titulo, descripcion: v.descripcion, enlace: v.enlace, evento: v.evento });
        if (!res.ok) return /row-level|policy/i.test(res.error || '') ? 'No tienes permiso para guardar este enlace (¿gestión archivada?).' : (res.error || 'No se pudo guardar.');
        showToast(r ? 'Enlace actualizado.' : 'Enlace añadido al banco.', 'ok');
        await cargar(); return null;
      },
    });
  }

  async function accion(a, id) {
    const r = S.rows.find(x => String(x.id) === String(id));
    if (a === 'nuevo') return abrirForm(null);
    if (a === 'limpiar') { S.f = { q: '', rol: '', evento: '' }; return pintar(); }
    if (a === 'editar' && r) return abrirForm(r);
    if (a === 'copiar' && r) {
      try { await navigator.clipboard.writeText(r.enlace); showToast('Enlace copiado.', 'ok'); } catch (e) { showToast('No se pudo copiar: ábrelo y copia la dirección.', 'info'); }
      return;
    }
    if (a === 'borrar' && r) {
      Tareas.abrirModal({
        titulo: 'Eliminar enlace', confirmar: 'Eliminar',
        campos: [{ id: 'i', tipo: 'info', texto: 'Se quita «' + r.titulo + '» del banco. Las imágenes originales no se tocan: solo desaparece este enlace.' }],
        onConfirm: async () => {
          const res = await API.deleteBancoImagen(r.id);
          if (!res.ok) return res.error || 'No se pudo eliminar.';
          showToast('Enlace eliminado.', 'ok'); await cargar(); return null;
        },
      });
    }
  }
  function filtrar(el) {
    S.f[el.dataset.f] = el.value;
    const q = el.dataset.f === 'q', pos = el.selectionStart;
    pintar();
    if (q) { const n = S.el.querySelector('input[type=search]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* sin selección */ } } }
  }
  return { montar, accion, filtrar, cargar };
})();
function bancoFiltrar(el) { Banco.filtrar(el); }
