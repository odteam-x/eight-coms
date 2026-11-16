/**
 * Recursos (migración 0071; antes «Banco de imágenes», 0058): fotos, videos, enlaces, documentos, plantillas y la IDENTIDAD GRÁFICA de
 * cada evento (logos, paleta de colores, tipografías) en un solo sitio.
 *
 * Un recurso = título + TIPO + evento (agrupa) + categoría + etiquetas + descripción + PARTES. Cada parte es un enlace http(s), un
 * color #RRGGBB o el nombre de una tipografía. El sistema NO guarda archivos: guarda enlaces (Drive, Canva, Dropbox…) y texto.
 * Cualquier persona con el acceso aprobado ve todo y añade los suyos; quien lo subió (o la administración) lo edita o lo borra.
 * Autor, rol y distrito los fija el servidor. Mismo módulo en los tres portales.
 *
 * Seguridad en el cliente: todo texto humano pasa por escHtml(); el enlace se abre en pestaña nueva con rel="noopener noreferrer"
 * y solo si empieza por http(s); un color solo se pinta si es #RRGGBB exacto (la base lo exige también). Sin vista previa de
 * imágenes remotas a propósito: la CSP (img-src) no admite imágenes de otros sitios y abrirla filtraría la IP de quien mira a
 * cualquier servidor que alguien pegue. Sin 0071 la pantalla lo dice en vez de fingir que no hay nada.
 */
const Recursos = (() => {
  const TIPOS = [
    { v: 'imagen',    l: 'Imagen o foto',     plural: 'Imágenes y fotos',      icono: 'image' },
    { v: 'video',     l: 'Video',             plural: 'Videos',                icono: 'camera' },
    { v: 'enlace',    l: 'Enlace',            plural: 'Enlaces',               icono: 'link' },
    { v: 'identidad', l: 'Identidad gráfica', plural: 'Identidad gráfica',     icono: 'layers' },
    { v: 'documento', l: 'Documento',         plural: 'Documentos',            icono: 'file-text' },
    { v: 'plantilla', l: 'Plantilla',         plural: 'Plantillas',            icono: 'layout-grid' },
    { v: 'audio',     l: 'Audio',             plural: 'Audios',                icono: 'activity' },
    { v: 'otro',      l: 'Otro',              plural: 'Otros',                 icono: 'archive' },
  ];
  const tipoDe = v => TIPOS.find(t => t.v === v) || TIPOS[TIPOS.length - 1];
  const S = { el: null, yo: null, esAdmin: false, rows: [], roles: new Map(), nombres: new Map(), f: { q: '', rol: '', evento: '', tipo: '', agrupar: 'evento' }, estado: 'cargando', error: '' };
  const esHttp = u => /^https?:\/\/[^\s]+$/i.test(String(u || ''));
  const esHex = c => /^#[0-9a-f]{6}$/i.test(String(c || ''));
  const fechaTxt = iso => { try { return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };
  const puede = r => S.esAdmin || r.creado_por === S.yo;
  const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const partes = (r, t) => (Array.isArray(r.partes) ? r.partes : []).map((p, i) => ({ ...p, i })).filter(p => p && p.t === t);
  const hostDe = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  const MAX_PARTES = 20;

  /* ── Texto del formulario ⇄ partes (puro; se prueba sin navegador) ─────────────────────────────────────────────────────── */
  // Enlaces: uno por línea, «https://…» o «Nombre | https://…».
  function parsearEnlaces(txt) {
    const out = [];
    for (const lineaCruda of String(txt || '').split(/\r?\n/)) {
      const linea = lineaCruda.trim(); if (!linea) continue;
      const k = linea.indexOf('|');
      const e = (k >= 0 ? linea.slice(0, k) : '').trim(), v = (k >= 0 ? linea.slice(k + 1) : linea).trim();
      if (!esHttp(v)) return { error: `«${linea.slice(0, 40)}${linea.length > 40 ? '…' : ''}» no es un enlace válido: cada línea debe ser https://… o «Nombre | https://…».` };
      if (e.length > 60) return { error: 'El nombre de un enlace admite hasta 60 caracteres.' };
      if (v.length > 1000) return { error: 'Un enlace admite hasta 1000 caracteres.' };
      out.push({ t: 'enlace', e, v });
    }
    return { partes: out };
  }
  // Colores: separados por coma o línea, «#1A4FA0» o «#1A4FA0 Azul institucional». Admite #RGB y lo pasa a #RRGGBB.
  function parsearColores(txt) {
    const out = [];
    for (const crudo of String(txt || '').split(/[\n,;]+/)) {
      const tok = crudo.trim(); if (!tok) continue;
      const m = /#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i.exec(tok);
      if (!m) return { error: `«${tok.slice(0, 30)}» no tiene un color: escríbelo como #1A4FA0 (con #), solo o seguido de su nombre.` };
      let h = m[1]; if (h.length === 3) h = h.replace(/./g, c => c + c);
      const e = (tok.slice(0, m.index) + ' ' + tok.slice(m.index + m[0].length)).replace(/[:|]/g, ' ').replace(/\s+/g, ' ').trim();
      if (e.length > 60) return { error: 'El nombre de un color admite hasta 60 caracteres.' };
      out.push({ t: 'color', e, v: '#' + h.toUpperCase() });
    }
    return { partes: out };
  }
  // Tipografías: separadas por coma o línea, «Montserrat Bold» o «Títulos: Montserrat Bold».
  function parsearFuentes(txt) {
    const out = [];
    for (const crudo of String(txt || '').split(/[\n,;]+/)) {
      const tok = crudo.trim(); if (!tok) continue;
      const k = tok.indexOf(':');
      const e = (k >= 0 ? tok.slice(0, k) : '').trim(), v = (k >= 0 ? tok.slice(k + 1) : tok).trim();
      if (!v) return { error: `«${tok.slice(0, 30)}»: falta el nombre de la tipografía.` };
      if (v.length > 80 || e.length > 60) return { error: 'El nombre de una tipografía admite hasta 80 caracteres (y 60 su uso).' };
      out.push({ t: 'fuente', e, v });
    }
    return { partes: out };
  }
  function parsearEtiquetas(txt) {
    const vistas = new Set(), out = [];
    for (const x of String(txt || '').split(/[,;\n]+/)) { const e = x.trim().slice(0, 30); if (e && !vistas.has(e.toLowerCase())) { vistas.add(e.toLowerCase()); out.push(e); } }
    return out;
  }
  const textoEnlaces = r => partes(r, 'enlace').map(p => (p.e ? p.e + ' | ' : '') + p.v).join('\n');
  const textoColores = r => partes(r, 'color').map(p => p.v + (p.e ? ' ' + p.e : '')).join(', ');
  const textoFuentes = r => partes(r, 'fuente').map(p => (p.e ? p.e + ': ' : '') + p.v).join(', ');
  /** Del formulario a lo que se guarda; devuelve { error } o { dato }. */
  function armar(v) {
    if ((v.titulo || '').length < 3) return { error: 'El título necesita al menos 3 caracteres.' };
    const enl = parsearEnlaces(v.enlaces); if (enl.error) return enl;
    const col = parsearColores(v.colores); if (col.error) return col;
    const fue = parsearFuentes(v.fuentes); if (fue.error) return fue;
    const ps = [...enl.partes, ...col.partes, ...fue.partes];
    if (!ps.length) return { error: 'Añade al menos un enlace, un color o una tipografía.' };
    if (ps.length > MAX_PARTES) return { error: `Cada recurso admite hasta ${MAX_PARTES} elementos entre enlaces, colores y tipografías.` };
    const et = parsearEtiquetas(v.etiquetas);
    if (et.length > 8) return { error: 'Admite hasta 8 etiquetas.' };
    return { dato: { titulo: v.titulo, tipo: v.tipo || 'otro', descripcion: v.descripcion || '', evento: v.evento || '', categoria: v.categoria || '', etiquetas: et, partes: ps } };
  }

  /* ── Carga ─────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
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
    const r = await API.getRecursos();
    if (!r.ok) { S.estado = r.disponible ? 'error' : 'ausente'; S.error = r.error || ''; }
    else { S.estado = 'ok'; S.rows = r.rows; }
    pintar();
  }

  function textoBusqueda(r) {
    return [r.titulo, r.descripcion, r.evento, r.categoria, (r.etiquetas || []).join(' '), tipoDe(r.tipo).l,
      (Array.isArray(r.partes) ? r.partes : []).map(p => (p.e || '') + ' ' + (p.t === 'enlace' ? hostDe(p.v) : p.v)).join(' ')].join(' ');
  }
  function filtradas() {
    const q = sinTildes(S.f.q).trim();
    return S.rows.filter(r => (!S.f.rol || String(r.rol_id == null ? '' : r.rol_id) === S.f.rol) && (!S.f.evento || r.evento === S.f.evento)
      && (!S.f.tipo || r.tipo === S.f.tipo) && (!q || sinTildes(textoBusqueda(r)).includes(q)));
  }
  function grupos(lista) {
    if (S.f.agrupar === 'nada') return [{ t: '', rows: lista }];
    const m = new Map();
    for (const r of lista) {
      const k = S.f.agrupar === 'tipo' ? tipoDe(r.tipo).v : (r.evento || '');
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    const claves = [...m.keys()];
    if (S.f.agrupar === 'tipo') claves.sort((a, b) => TIPOS.findIndex(t => t.v === a) - TIPOS.findIndex(t => t.v === b));
    else claves.sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, 'es'));
    return claves.map(k => ({ t: S.f.agrupar === 'tipo' ? tipoDe(k).plural : (k || 'Sin evento'), rows: m.get(k) }));
  }

  /* ── Pintado ───────────────────────────────────────────────────────────────────────────────────────────────────────────── */
  function colorHTML(p) {
    if (!esHex(p.v)) return '';
    const hex = p.v.toUpperCase(), nom = p.e ? ' · ' + p.e : '';
    return `<li><button type="button" class="rec-color" data-act="recursos" data-arg="copiar-color" data-arg2="${escHtml(hex)}" aria-label="Copiar el color ${escHtml(hex + nom)}" title="Copiar ${escHtml(hex)}">
      <span class="rec-muestra" style="background:${escHtml(hex)}" aria-hidden="true"></span><span class="rec-color-t"><b>${escHtml(hex)}</b>${p.e ? `<small>${escHtml(p.e)}</small>` : ''}</span></button></li>`;
  }
  function enlaceHTML(r, p) {
    if (!esHttp(p.v)) return `<li class="rec-enlace"><span class="bco-peq">Enlace no válido</span></li>`;
    const host = hostDe(p.v), nom = p.e || host || 'Abrir', id = escHtml(String(r.id));
    return `<li class="rec-enlace">
      <a class="btn--secundario rec-abrir" href="${escHtml(p.v)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir ${escHtml(nom)} de ${escHtml(r.titulo)} (se abre en otra pestaña)">${escHtml(nom)}</a>
      ${p.e && host ? `<span class="bco-peq">${escHtml(host)}</span>` : ''}
      <button type="button" class="btn-icon" data-act="recursos" data-arg="copiar" data-arg2="${id}" data-arg3="${p.i}" aria-label="Copiar el enlace ${escHtml(nom)} de ${escHtml(r.titulo)}" title="Copiar enlace"><i data-lucide="copy" aria-hidden="true"></i></button></li>`;
  }
  function tarjetaHTML(r, agrupadoPorEvento) {
    const T = tipoDe(r.tipo);
    const rol = r.rol_id != null ? S.roles.get(String(r.rol_id)) : '';
    const autor = S.nombres.get(r.creado_por) || '';
    const id = escHtml(String(r.id)), t = escHtml(r.titulo);
    const enl = partes(r, 'enlace'), col = partes(r, 'color').filter(p => esHex(p.v)), fue = partes(r, 'fuente');
    return `<li class="rec-card">
      <div class="rec-cab">
        <span class="bco-ico" aria-hidden="true"><i data-lucide="${T.icono}"></i></span>
        <div class="rec-tit">
          <h3 class="rec-t">${t}</h3>
          <div class="bco-meta">
            <span class="etiqueta etq-violeta">${escHtml(T.l)}</span>
            ${r.evento && !agrupadoPorEvento ? `<span class="etiqueta etq-azul">${escHtml(r.evento)}</span>` : ''}
            ${r.categoria ? `<span class="etiqueta etq-gris">${escHtml(r.categoria)}</span>` : ''}
            ${rol ? `<span class="etiqueta etq-gris">${escHtml(rol)}</span>` : ''}
          </div>
        </div>
        ${puede(r) ? `<div class="bco-acc">
          <button type="button" class="btn-icon" data-act="recursos" data-arg="editar" data-arg2="${id}" aria-label="Editar ${t}" title="Editar"><i data-lucide="pencil" aria-hidden="true"></i></button>
          <button type="button" class="btn-icon btn-icon--danger" data-act="recursos" data-arg="borrar" data-arg2="${id}" aria-label="Eliminar ${t}" title="Eliminar"><i data-lucide="trash-2" aria-hidden="true"></i></button></div>` : ''}
      </div>
      ${r.descripcion ? `<p class="bco-d">${escHtml(r.descripcion)}</p>` : ''}
      ${col.length ? `<ul class="rec-colores" aria-label="Paleta de colores">${col.map(colorHTML).join('')}</ul>` : ''}
      ${fue.length ? `<ul class="rec-fuentes" aria-label="Tipografías">${fue.map(p => `<li><span class="rec-aa" aria-hidden="true">Aa</span><span><b>${escHtml(p.v)}</b>${p.e ? `<small>${escHtml(p.e)}</small>` : ''}</span></li>`).join('')}</ul>` : ''}
      ${enl.length ? `<ul class="rec-enlaces" aria-label="Enlaces">${enl.map(p => enlaceHTML(r, p)).join('')}</ul>` : ''}
      ${(r.etiquetas || []).length ? `<ul class="rec-etiquetas" aria-label="Etiquetas">${r.etiquetas.map(e => `<li><button type="button" class="rec-tag" data-act="recursos" data-arg="etiqueta" data-arg2="${escHtml(e)}" aria-label="Buscar la etiqueta ${escHtml(e)}">#${escHtml(e)}</button></li>`).join('')}</ul>` : ''}
      <p class="rec-pie">${autor ? escHtml(autor) + ' · ' : ''}${escHtml(fechaTxt(r.created_at))}</p></li>`;
  }

  function pintar() {
    const el = S.el; if (!el) return;
    if (S.estado === 'cargando') { el.innerHTML = '<div class="loading-box"><span class="spin"></span></div>'; return; }
    if (S.estado === 'ausente') { el.innerHTML = '<div class="empty-box"><div class="empty-txt">Recursos necesita la migración 0071 en la base de datos. Aplícala en el SQL Editor y vuelve a abrir esta pantalla.</div></div>'; return; }
    if (S.estado === 'error') { renderError(el, S.error || 'No se pudieron cargar los recursos.', cargar); return; }
    const roles = [...new Set(S.rows.map(r => r.rol_id).filter(x => x != null).map(String))];
    const eventos = [...new Set(S.rows.map(r => r.evento).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const tipos = TIPOS.filter(t => S.rows.some(r => r.tipo === t.v));
    const lista = filtradas();
    const hay = S.rows.length > 0;
    const sel = (aria, f, todos, ops) => `<select class="cfg-inp cfg-select" aria-label="${aria}" data-change="recursosFiltrar" data-f="${f}"><option value="">${todos}</option>${ops.map(([v, l]) => `<option value="${escHtml(v)}"${S.f[f] === v ? ' selected' : ''}>${escHtml(l)}</option>`).join('')}</select>`;
    if (!hay) {
      el.innerHTML = '<div class="empty-box bco-vacio"><div class="empty-txt">Cuando haya recursos aparecerán aquí. Añade el primero: la carpeta de fotos de un evento, su identidad gráfica (logos, colores, tipografías), una plantilla…</div><button type="button" class="btn-save" data-act="recursos" data-arg="nuevo">Añadir el primero</button></div>';
      if (typeof renderIconos === 'function') renderIconos(el);
      return;
    }
    el.innerHTML = `
      <div class="filtros-fila bco-filtros">
        <input class="search-inp" type="search" aria-label="Buscar en los recursos" placeholder="Buscar por título, evento, etiqueta, color o tipografía…" value="${escHtml(S.f.q)}" data-input="recursosFiltrar" data-f="q" autocomplete="off">
        ${sel('Filtrar por tipo', 'tipo', 'Todos los tipos', tipos.map(t => [t.v, t.l]))}
        ${sel('Filtrar por evento', 'evento', 'Todos los eventos', eventos.map(e => [e, e]))}
        ${sel('Filtrar por el rol de quien lo subió', 'rol', 'Todos los roles', roles.map(id => [id, S.roles.get(id) || 'Rol ' + id]))}
        <select class="cfg-inp cfg-select" aria-label="Agrupar los recursos" data-change="recursosFiltrar" data-f="agrupar">
          ${[['evento', 'Agrupar por evento'], ['tipo', 'Agrupar por tipo'], ['nada', 'Sin agrupar']].map(([v, l]) => `<option value="${v}"${S.f.agrupar === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button type="button" class="btn-save" data-act="recursos" data-arg="nuevo"><i data-lucide="plus"></i>Añadir recurso</button>
      </div>
      ${lista.length ? `<p class="bco-cuenta" role="status">${lista.length} de ${S.rows.length} recurso${S.rows.length === 1 ? '' : 's'}</p>
        ${grupos(lista).map(g => `<section class="rec-grupo">${g.t ? `<h2 class="rec-grupo-t">${escHtml(g.t)} <small>${g.rows.length}</small></h2>` : ''}
          <ul class="rec-grid">${g.rows.map(r => tarjetaHTML(r, S.f.agrupar === 'evento')).join('')}</ul></section>`).join('')}`
        : `<div class="empty-box bco-vacio"><div class="empty-txt">${hay ? 'Ningún recurso coincide con estos filtros.' : 'Cuando haya recursos aparecerán aquí. Añade el primero: la carpeta de fotos de un evento, su identidad gráfica (logos, colores, tipografías), una plantilla…'}</div>
          ${hay ? '<button type="button" class="btn--secundario" data-act="recursos" data-arg="limpiar">Quitar filtros</button>' : '<button type="button" class="btn-save" data-act="recursos" data-arg="nuevo">Añadir el primero</button>'}</div>`}`;
    if (typeof renderIconos === 'function') renderIconos(el);
  }

  /* ── Formulario ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
  function campos(r) {
    r = r || {};
    return [
      { id: 'titulo', tipo: 'texto', label: 'Título', req: true, valor: r.titulo, ph: 'Ej.: Identidad gráfica · Jornada de cierre', max: 120 },
      { id: 'tipo', tipo: 'select', label: 'Tipo de recurso', valor: r.tipo || 'imagen', opciones: TIPOS.map(t => ({ v: t.v, l: t.l })) },
      { id: 'evento', tipo: 'texto', label: 'Evento (opcional)', valor: r.evento, ph: 'Ej.: Jornada de cierre', max: 120, ayuda: 'Escríbelo igual en todos los recursos del mismo evento para que se agrupen.' },
      { id: 'categoria', tipo: 'texto', label: 'Categoría (opcional)', valor: r.categoria, ph: 'Ej.: Redes sociales', max: 60 },
      { id: 'etiquetas', tipo: 'texto', label: 'Etiquetas (opcional)', valor: (r.etiquetas || []).join(', '), ph: 'logo, paleta, 2026', max: 280, ayuda: 'Separadas por comas; hasta 8.' },
      { id: 'descripcion', tipo: 'area', label: 'Descripción (opcional)', valor: r.descripcion, ph: 'Qué contiene, quién lo hizo, créditos…', max: 600, filas: 3 },
      { id: 'enlaces', tipo: 'area', label: 'Enlaces', valor: r ? textoEnlaces(r) : '', ph: 'Logos | https://drive.google.com/…\nhttps://www.canva.com/…', max: 6000, filas: 3, ayuda: 'Uno por línea: https://… o «Nombre | https://…». Comprueba que estén compartidos con quien deba verlos.' },
      { id: 'colores', tipo: 'texto', label: 'Paleta de colores (opcional)', valor: r ? textoColores(r) : '', ph: '#1A4FA0 Azul institucional, #FFC247 Ámbar', max: 1200, ayuda: 'Colores en hexadecimal con #, separados por comas; puedes ponerles nombre.' },
      { id: 'fuentes', tipo: 'texto', label: 'Tipografías (opcional)', valor: r ? textoFuentes(r) : '', ph: 'Títulos: Montserrat Bold, Texto: Open Sans', max: 1600, ayuda: 'Separadas por comas; «Uso: Nombre» es opcional.' },
    ];
  }

  function abrirForm(r) {
    Tareas.abrirModal({
      titulo: r ? 'Editar recurso' : 'Añadir recurso', campos: campos(r), confirmar: r ? 'Guardar' : 'Añadir',
      onConfirm: async v => {
        const a = armar(v); if (a.error) return a.error;
        const res = await API.saveRecurso({ id: r ? r.id : null, ...a.dato });
        if (!res.ok) return /row-level|policy/i.test(res.error || '') ? 'No tienes permiso para guardar este recurso (¿gestión archivada?).' : (res.error || 'No se pudo guardar.');
        showToast(r ? 'Recurso actualizado.' : 'Recurso añadido.', 'ok');
        await cargar(); return null;
      },
    });
  }

  async function copiar(txt, ok) {
    try { await navigator.clipboard.writeText(txt); showToast(ok, 'ok'); } catch (e) { showToast('No se pudo copiar: ábrelo y copia la dirección.', 'info'); }
  }
  async function accion(a, id, el) {
    const r = S.rows.find(x => String(x.id) === String(id));
    if (a === 'nuevo') return abrirForm(null);
    if (a === 'limpiar') { S.f = { ...S.f, q: '', rol: '', evento: '', tipo: '' }; return pintar(); }
    if (a === 'editar' && r) return abrirForm(r);
    if (a === 'etiqueta') { S.f.q = String(id || ''); return pintar(); }
    if (a === 'copiar-color' && esHex(id)) return copiar(id, 'Color copiado.');
    if (a === 'copiar' && r) {
      const p = (r.partes || [])[Number(el && el.dataset.arg3)];
      if (p && p.t === 'enlace' && esHttp(p.v)) return copiar(p.v, 'Enlace copiado.');
      return;
    }
    if (a === 'borrar' && r) {
      Tareas.abrirModal({
        titulo: 'Eliminar recurso', confirmar: 'Eliminar',
        campos: [{ id: 'i', tipo: 'info', texto: 'Se quita «' + r.titulo + '» de Recursos. Lo que hay detrás de los enlaces no se toca: solo desaparece esta ficha.' }],
        onConfirm: async () => {
          const res = await API.deleteRecurso(r.id);
          if (!res.ok) return res.error || 'No se pudo eliminar.';
          showToast('Recurso eliminado.', 'ok'); await cargar(); return null;
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
  return { montar, accion, filtrar, cargar, util: { armar, parsearEnlaces, parsearColores, parsearFuentes, parsearEtiquetas, TIPOS } };
})();
function recursosFiltrar(el) { Recursos.filtrar(el); }
