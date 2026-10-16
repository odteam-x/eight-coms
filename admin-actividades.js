'use strict';
/**
 * EIGHT CREATORS LABs — Actividades (administración)
 * ──────────────────────────────────────────────────
 * Eventos del calendario con título, fecha o rango, etiqueta y alcance (todo el
 * equipo o un distrito). NO dependen de los períodos de evaluación: una
 * capacitación o una reunión existe aunque no haya período. Las etiquetas se
 * crean aquí (nombre + tono de la paleta) y colorean el calendario de todos.
 * Los hitos de cada período (inicio, entrega…) se editan en Períodos.
 * Tablas: actividades y etiquetas (migración 0018).
 * Depende de: admin.js (globals), api.js, core/tareas.js (abrirModal), core/calendario.js.
 */
const Actividades = (() => {
  const TONOS = [['coral', 'Coral'], ['violeta', 'Violeta'], ['verde', 'Verde'], ['ambar', 'Ámbar'], ['cian', 'Cian'], ['azul', 'Azul'], ['rojo', 'Rojo'], ['gris', 'Gris']];
  let E = [], A = [], disponible = true, filtro = '';
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fecha = f => { const [a, m, d] = String(f).slice(0, 10).split('-').map(Number); return `${d} ${MES[m - 1]} ${a}`; };
  const hoy = () => new Date().toISOString().slice(0, 10);
  const etq = id => E.find(e => String(e.id) === String(id));
  const etiquetaHTML = id => { const e = etq(id); return `<span class="etiqueta" style="--etq:var(--etq-${e ? escHtml(e.tono) : 'gris'})">${escHtml(e ? e.nombre : 'Sin etiqueta')}</span>`; };

  async function abrir() {
    const host = document.getElementById('act-body'); if (!host) return;
    host.innerHTML = '<div class="loading-box"><span class="spin"></span></div>';
    const [et, ac] = await Promise.all([API.getEtiquetas(), API.getActividades()]);
    disponible = ac.disponible !== false && et.disponible !== false;
    E = et.rows || []; A = ac.rows || [];
    pintar();
  }

  function pintar() {
    const host = document.getElementById('act-body'); if (!host) return;
    if (!disponible) {
      host.innerHTML = '<div class="no-data-msg"><div class="no-data-txt">Las actividades necesitan la migración 0018 en la base de datos. Aplícala en Supabase y recarga esta página.</div></div>';
      return;
    }
    const q = (document.getElementById('search-actividades')?.value || '').toLowerCase().trim();
    const lista = A.filter(a => (!q || (a.titulo || '').toLowerCase().includes(q)) && (!filtro || String(a.etiqueta_id ?? 'none') === filtro));
    const h = hoy();
    const prox = lista.filter(a => (a.fecha_fin || a.fecha_inicio) >= h).sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
    const pas = lista.filter(a => (a.fecha_fin || a.fecha_inicio) < h).sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio));
    const dNombre = id => (_distritos.find(d => String(d.id) === String(id)) || {}).nombre || id;
    const fila = a => `<div class="fila-aj act-fila">
        <div class="act-fecha"><b>${escHtml(fecha(a.fecha_inicio).split(' ')[0])}</b><span>${escHtml(fecha(a.fecha_inicio).split(' ')[1])}</span></div>
        <div class="fila-aj-txt">
          <div class="fila-aj-t">${escHtml(a.titulo)}</div>
          <div class="fila-aj-d">${a.fecha_fin && a.fecha_fin !== a.fecha_inicio ? `${escHtml(fecha(a.fecha_inicio))} – ${escHtml(fecha(a.fecha_fin))} · ` : ''}${a.distrito ? escHtml(dNombre(a.distrito)) : 'Todo el equipo'}${a.descripcion ? ' · ' + escHtml(a.descripcion) : ''}</div>
        </div>
        ${etiquetaHTML(a.etiqueta_id)}
        <div class="act-acc">
          <button type="button" class="btn-icon" data-act="actEditar" data-arg="${a.id}" aria-label="Editar ${escHtml(a.titulo)}" title="Editar"><i data-lucide="pencil"></i></button>
          <button type="button" class="btn-icon btn-icon--danger" data-act="actBorrar" data-arg="${a.id}" aria-label="Eliminar ${escHtml(a.titulo)}" title="Eliminar"><i data-lucide="trash-2"></i></button>
        </div>
      </div>`;
    const grupo = (t, l, vacio) => `<h2 class="cuenta-t">${t} <span class="cuenta-cont">${l.length}</span></h2>${l.length ? `<div class="lista-aj">${l.map(fila).join('')}</div>` : `<p class="cfg-hint">${vacio}</p>`}`;
    host.innerHTML = `
      <div class="act-chips" role="group" aria-label="Filtrar por etiqueta">
        <button type="button" class="eval-chip${!filtro ? ' on' : ''}" data-act="actFiltro" data-arg="" aria-pressed="${!filtro}">Todas <b>${A.length}</b></button>
        ${E.map(e => `<button type="button" class="eval-chip${filtro === String(e.id) ? ' on' : ''}" data-act="actFiltro" data-arg="${e.id}" aria-pressed="${filtro === String(e.id)}"><span class="punto" style="--etq:var(--etq-${escHtml(e.tono)})"></span>${escHtml(e.nombre)} <b>${A.filter(a => a.etiqueta_id === e.id).length}</b></button>`).join('')}
        <button type="button" class="btn--texto" data-act="actEtiquetas">Administrar etiquetas</button>
      </div>
      ${grupo('Próximas', prox, 'No hay actividades próximas. Crea una con «Nueva actividad».')}
      <div style="height:var(--sec-main)"></div>
      ${grupo('Pasadas', pas, 'Aún no hay actividades pasadas.')}`;
    renderIconos(host);
  }

  function campos(x = {}) {
    return [
      { id: 'titulo', tipo: 'texto', label: 'Título', req: true, valor: x.titulo || '', ph: 'Ej.: Jornada de cierre' },
      { id: 'descripcion', tipo: 'area', label: 'Descripción (opcional)', valor: x.descripcion || '', filas: 2 },
      { id: 'etiqueta', tipo: 'select', label: 'Etiqueta', valor: x.etiqueta_id || '', opciones: [{ v: '', l: 'Sin etiqueta' }, ...E.map(e => ({ v: e.id, l: e.nombre }))] },
      { id: 'ini', tipo: 'fecha', label: 'Desde', valor: x.fecha_inicio || hoy() },
      { id: 'fin', tipo: 'fecha', label: 'Hasta (opcional, si dura varios días)', valor: x.fecha_fin || '' },
      { id: 'alcance', tipo: 'select', label: 'Para quién', valor: x.distrito || '', opciones: [{ v: '', l: 'Todo el equipo' }, ..._distritos.map(d => ({ v: d.id, l: d.nombre }))] },
    ];
  }
  async function guardar(x, v) {
    if (!(v.titulo || '').trim()) return 'Escribe un título.';
    if (!v.ini) return 'Elige la fecha.';
    if (v.fin && v.fin < v.ini) return 'La fecha final no puede ser anterior a la inicial.';
    const r = await API.saveActividad({ id: x.id, titulo: v.titulo, descripcion: v.descripcion, etiqueta_id: v.etiqueta ? Number(v.etiqueta) : null, fecha_inicio: v.ini, fecha_fin: v.fin, distrito: v.alcance || null });
    if (!r.ok) return r.error;
    showToast(x.id ? 'Actividad actualizada' : 'Actividad creada', 'ok');
    await abrir();
    return null;
  }
  function nueva() { if (!disponible) return; Tareas.abrirModal({ titulo: 'Nueva actividad', campos: campos(), confirmar: 'Crear', onConfirm: v => guardar({}, v) }); }
  function editar(id) { const x = A.find(a => String(a.id) === String(id)); if (x) Tareas.abrirModal({ titulo: 'Editar actividad', campos: campos(x), confirmar: 'Guardar', onConfirm: v => guardar(x, v) }); }
  function borrar(id) {
    const x = A.find(a => String(a.id) === String(id)); if (!x) return;
    Tareas.abrirModal({ titulo: 'Eliminar actividad', confirmar: 'Eliminar', campos: [{ id: 'i', tipo: 'info', texto: '«' + x.titulo + '» dejará de verse en el calendario de todos.' }],
      onConfirm: async () => { const r = await API.deleteActividad(x.id); if (!r.ok) return r.error; showToast('Actividad eliminada', 'ok'); await abrir(); return null; } });
  }
  function setFiltro(v) { filtro = v || ''; pintar(); }

  /* ── Etiquetas ───────────────────────────────────────────────────────── */
  function etiquetas() {
    const fila = e => `<div class="fila-aj"><span class="punto punto--g" style="--etq:var(--etq-${escHtml(e.tono)})"></span>
      <div class="fila-aj-txt"><div class="fila-aj-t">${escHtml(e.nombre)}</div><div class="fila-aj-d">${escHtml(TONOS.find(t => t[0] === e.tono)?.[1] || e.tono)} · ${A.filter(a => a.etiqueta_id === e.id).length} actividad(es)</div></div>
      <div class="act-acc"><button type="button" class="btn-icon" data-act="actEditarEtq" data-arg="${e.id}" aria-label="Editar etiqueta ${escHtml(e.nombre)}"><i data-lucide="pencil"></i></button>
      <button type="button" class="btn-icon btn-icon--danger" data-act="actBorrarEtq" data-arg="${e.id}" aria-label="Eliminar etiqueta ${escHtml(e.nombre)}"><i data-lucide="trash-2"></i></button></div></div>`;
    Tareas.abrirModal({ titulo: 'Etiquetas', sinConfirmar: true, campos: [{ id: 'l', tipo: 'info', texto: 'Cada etiqueta tiene un nombre y un color. Los colores te ayudan a distinguir de un vistazo capacitaciones, reuniones, entregas…' }] });
    const cuerpo = document.getElementById('tk-modal-cuerpo');
    cuerpo.insertAdjacentHTML('beforeend', `<div class="lista-aj etq-lista">${E.map(fila).join('') || '<p class="cfg-hint" style="padding:var(--sp-4)">Aún no hay etiquetas.</p>'}</div>
      <button type="button" class="btn-cfg-add" style="margin-top:var(--sp-3)" data-act="actNuevaEtq"><i data-lucide="plus"></i>Nueva etiqueta</button>`);
    renderIconos(cuerpo);
  }
  const camposEtq = x => [
    { id: 'nombre', tipo: 'texto', label: 'Nombre', req: true, valor: x?.nombre || '', max: 40, ph: 'Ej.: Capacitación' },
    { id: 'tono', tipo: 'select', label: 'Color', valor: x?.tono || 'azul', opciones: TONOS.map(([v, l]) => ({ v, l })) },
  ];
  async function guardarEtq(x, v) {
    if (!(v.nombre || '').trim()) return 'Escribe un nombre.';
    const r = await API.saveEtiqueta({ id: x?.id, nombre: v.nombre, tono: v.tono });
    if (!r.ok) return /duplicate|unique/i.test(r.error || '') ? 'Ya existe una etiqueta con ese nombre.' : r.error;
    await abrir(); setTimeout(etiquetas, 50);
    return null;
  }
  const nuevaEtq = () => Tareas.abrirModal({ titulo: 'Nueva etiqueta', campos: camposEtq(), confirmar: 'Crear', onConfirm: v => guardarEtq(null, v) });
  function editarEtq(id) { const x = E.find(e => String(e.id) === String(id)); if (x) Tareas.abrirModal({ titulo: 'Editar etiqueta', campos: camposEtq(x), confirmar: 'Guardar', onConfirm: v => guardarEtq(x, v) }); }
  function borrarEtq(id) {
    const x = E.find(e => String(e.id) === String(id)); if (!x) return;
    const n = A.filter(a => a.etiqueta_id === x.id).length;
    Tareas.abrirModal({ titulo: 'Eliminar etiqueta', confirmar: 'Eliminar', campos: [{ id: 'i', tipo: 'info', texto: n ? `«${x.nombre}» se quita de ${n} actividad(es), que quedan sin etiqueta.` : `Se elimina «${x.nombre}».` }],
      onConfirm: async () => { const r = await API.deleteEtiqueta(x.id); if (!r.ok) return r.error; await abrir(); setTimeout(etiquetas, 50); return null; } });
  }
  return { abrir, pintar, nueva, editar, borrar, setFiltro, etiquetas, nuevaEtq, editarEtq, borrarEtq };
})();

/** data-input del buscador (lista blanca de config.js) */
function renderActividades() { Actividades.pintar(); }
