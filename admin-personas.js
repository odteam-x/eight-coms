/**
 * EIGHT CREATORS LABs — Admin: Personas y Panel de atención
 * ──────────────────────────────────────────────────────────
 * Lo que el rediseño añade al portal admin, separado de admin.js (2400 líneas)
 * para no seguir engordándolo. Comparte con él las variables globales de la
 * página (_users, _roles, _distritos, _periodos, _activePEUsers, _inactivosPE…)
 * y reutiliza SUS manejadores de escritura: cambiar rol, distrito, tipo,
 * acceso y permisos sigue pasando por updateUser*() de admin.js y por las
 * mismas llamadas a la API. Aquí solo hay presentación y orquestación.
 *
 *   · Personas  : tarjetas (y la tabla de siempre como vista alternativa). Al
 *                 pulsar una se abre su perfil en el panel lateral, con una
 *                 pestaña extra «Gestión» donde viven las acciones de la fila.
 *   · Panel     : lista «Requiere atención» sobre el resumen del período.
 *
 * Quién puede escribir qué lo decide RLS y los triggers de la base, no esto.
 *
 * Depende de: admin.js (globales), core/perfil.js, core/personas.js,
 * core/ui.js, api.js.
 */
'use strict';

/* ══ PERFIL EN MODO ADMIN ══════════════════════════════════════════════ */

const _distritoNombre = id => _distritos.find(d => String(d.id) === String(id))?.nombre || id || '';

/** Una fila de _users → la «persona» que entiende core/perfil.js. */
function personaDeUsuario(u) {
  return {
    id: u.id, nombre: u.nombre || u.email, email: u.email, avatar_url: u.avatar_url, fondo: u.fondo,
    rol_nombre: u.roles?.nombre || _roles.find(r => String(r.id) === String(u.rol_id))?.nombre || '',
    distrito: _distritoNombre(u.distrito), tipo_miembro: u.tipo_miembro,
  };
}

function initPersonas() {
  Perfil.configurar({
    modo: 'admin',
    resolver: id => { const u = _users.find(x => String(x.id) === String(id)); return u ? personaDeUsuario(u) : null; },
    calendario: () => _calendario,
    gafete: { esAdmin: true },
    periodoId: () => _activePEUsers?.id ?? null,
    tareas: { yo: CU.id, esAdmin: true, personas: () => _users.filter(u => !u.es_admin).map(u => ({ id: u.id, nombre: u.nombre || u.email })) },
    acciones: [
      { act: 'evaluarDesdePerfil', etiqueta: 'Evaluar', icono: 'clipboard-list' },
      { act: 'perfilNuevaTarea', etiqueta: 'Nueva tarea', icono: 'plus-circle' },
    ],
    tabsExtra: [{ k: 'gestion', etiqueta: 'Gestión', icono: 'settings', soloAdmin: true, render: renderGestionPersona }],
  });
  pintarSegPersonas();
  renderPersonasCards();
}

/** Buscador del admin: personas (abren su perfil), nueva tarea y evaluar. */
function registrarBuscadorAdmin() {
  Buscador.registrar(() => {
    const out = [];
    const per = _activePE;
    if (esPeriodoV2(per)) {
      out.push({ grupo: 'Acciones', icono: 'plus-circle', titulo: 'Nueva tarea', sub: per.nombre,
        ir: () => Tareas.nueva({ periodoId: per.id, yo: CU.id, revisor: true, esAdmin: true,
          personas: _users.filter(u => !u.es_admin).map(u => ({ id: u.id, nombre: u.nombre || u.email })), onCambio: () => Store.invalidar('agenda') }) });
    }
    for (const u of _users) {
      out.push({ grupo: 'Personas', icono: 'user-round', titulo: u.nombre || u.email, sub: [u.roles?.nombre, _distritoNombre(u.distrito)].filter(Boolean).join(' · '), ir: () => Perfil.abrir(u.id) });
      if (!u.es_admin) out.push({ grupo: 'Evaluar', icono: 'clipboard-list', titulo: 'Evaluar a ' + (u.nombre || u.email), sub: per?.nombre || '', ir: () => evaluarDesdePerfil(u.id) });
    }
    return out;
  });
}

function evaluarDesdePerfil(id) {
  cerrarPanel();
  switchTab('evaluar', null);
  if (typeof selectEvalUser === 'function') selectEvalUser(id);
}

/* ══ PERSONAS: TARJETAS Y TABLA ════════════════════════════════════════ */

let _personasVista = 'tarjetas';

function pintarSegPersonas() {
  const host = document.getElementById('personas-seg'); if (!host) return;
  host.innerHTML = segHTML([
    { k: 'tarjetas', etiqueta: 'Tarjetas', icono: 'layout-grid' },
    { k: 'tabla',    etiqueta: 'Tabla',    icono: 'table-2' },
  ], _personasVista, 'personasVista', { etiqueta: 'Vista de las personas', prefijo: 'pers' });
  renderIconos(host);
  const t = document.getElementById('usuarios-list');
  const c = document.getElementById('personas-cards');
  if (t) t.hidden = _personasVista !== 'tabla';
  if (c) c.hidden = _personasVista !== 'tarjetas';
}

function personasVista(k) {
  _personasVista = k === 'tabla' ? 'tabla' : 'tarjetas';
  pintarSegPersonas();
}

/** Resultados del período elegido en Personas, por persona. Se piden una vez por período. */
let _personasRes = null;     // { periodoId, v2, mapa: Map(id → { valor, max, color, nivel, borrador }) }

async function cargarPersonasRes() {
  const p = _activePEUsers;
  if (!p) return null;
  if (_personasRes?.periodoId === p.id) return _personasRes;
  const mapa = new Map();
  if (esPeriodoV2(p)) {
    const r = await API.getResultadosV2(p.id, { borradores: true });
    if (r.ok) for (const f of r.rows) {
      if (f.individual == null) continue;
      mapa.set(f.evaluado_id, { valor: f.individual, max: 100, color: scoreColorV2(f.individual), nivel: nivelV2(f.individual), borrador: f.estado === 'borrador' });
    }
  } else {
    for (const ev of await API.getEvaluacionesByPE(p.id)) {
      const s = calcScorePuntajes(ev.puntajes, ev.bono_ext);
      mapa.set(ev.evaluado_id, { valor: s, max: MAX_TOTAL(), color: scoreColor(s), nivel: { key: scoreClass(s), label: scoreLabel(s) }, borrador: ev.estado !== 'publicado' });
    }
  }
  _personasRes = { periodoId: p.id, mapa };
  return _personasRes;
}

/** Cambió el período de Personas (o algo que altera los resultados). */
function invalidarPersonasRes() { _personasRes = null; }

/* ══ FILTRO POR ESTADO ═════════════════════════════════════════════════
 * «¿Quién necesita algo?»: acceso pendiente, sin evaluar, borrador, sin rol…
 * Una sola definición de cada estado para las tarjetas y la tabla (y para el
 * aviso «Requiere atención» del Panel), así que el número del Panel y el de
 * la lista no pueden discrepar. Solo cuenta hechos que la base ya guarda.
 * «Sin evaluar» y «Borrador» dependen del período elegido en Personas. */
const ESTADOS_PERSONA = [
  { k: '',             l: 'Todas las personas' },
  { k: 'pendientes',   l: 'Acceso pendiente' },
  { k: 'sin_evaluar',  l: 'Sin evaluar' },
  { k: 'borrador',     l: 'Evaluación en borrador' },
  { k: 'sin_rol',      l: 'Sin rol' },
  { k: 'sin_distrito', l: 'Sin distrito' },
  { k: 'inactivas',    l: 'Inactivas en el período' },
  { k: 'admins',       l: 'Administradores' },
];

/** Conjunto de estados de una persona. Los de evaluación solo si ya se cargaron los resultados. */
function estadosDePersona(u) {
  const e = new Set();
  if (u.aprobado === false) e.add('pendientes');
  if (u.es_admin) { e.add('admins'); return e; }          // la administración no se evalúa
  if (!u.rol_id) e.add('sin_rol');
  if (!u.distrito) e.add('sin_distrito');
  const inactiva = _inactivosPE.has(u.id);
  if (inactiva) e.add('inactivas');
  if (_personasRes) {
    const r = _personasRes.mapa.get(u.id);
    if (r?.borrador) e.add('borrador');
    if (!r && u.aprobado !== false && !inactiva) e.add('sin_evaluar');
  }
  return e;
}

const pasaEstadoPersona = (u, k) => !k || estadosDePersona(u).has(k);

/** Rellena el selector con el conteo de cada estado, sin perder la selección. */
function pintarFiltroEstado() {
  const sel = document.getElementById('filter-estado-usuarios'); if (!sel) return;
  const previo = sel.value;
  const n = Object.fromEntries(ESTADOS_PERSONA.map(e => [e.k, 0]));
  for (const u of _users) for (const k of estadosDePersona(u)) n[k]++;
  n[''] = _users.length;
  sel.innerHTML = ESTADOS_PERSONA.map(e => `<option value="${e.k}">${escHtml(e.l)} (${n[e.k]})</option>`).join('');
  sel.value = ESTADOS_PERSONA.some(e => e.k === previo) ? previo : '';
}

/** Va a Personas con un estado ya elegido (lo usa el aviso del Panel). */
function irPersonasFiltro(k) {
  switchTab('usuarios', null);
  const sel = document.getElementById('filter-estado-usuarios');
  if (sel) { pintarFiltroEstado(); sel.value = k; }
  renderUsuarios();
}

async function renderPersonasCards() {
  const el = document.getElementById('personas-cards'); if (!el) return;
  // Los resultados se piden ANTES de filtrar: «sin evaluar» y «borrador» los necesitan.
  const res = await cargarPersonasRes();
  pintarFiltroEstado();
  const q = (document.getElementById('search-usuarios')?.value || '').toLowerCase().trim();
  const dist = (document.getElementById('filter-distrito-usuarios')?.value || '').trim();
  const est = document.getElementById('filter-estado-usuarios')?.value || '';
  const lista = _users.filter(u =>
    (!q || (u.nombre || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || _distritoNombre(u.distrito).toLowerCase().includes(q)) &&
    (!dist || (dist === '__none__' ? !u.distrito : u.distrito === dist)) &&
    pasaEstadoPersona(u, est));

  const personas = lista.map(u => {
    const r = res?.mapa.get(u.id);
    const chips = [];
    if (u.aprobado === false) chips.push({ txt: 'Acceso pendiente', aviso: true, icono: 'user-x' });
    if (u.es_admin) chips.push({ txt: 'Admin', icono: 'shield' });
    if (_inactivosPE.has(u.id)) chips.push({ txt: 'Inactiva en el período', icono: 'pause' });
    if (r?.borrador) chips.push({ txt: 'Borrador', icono: 'file-pen' });
    return {
      id: u.id, nombre: u.nombre || u.email, avatar_url: u.avatar_url, fondo: u.fondo,
      rol: u.roles?.nombre || (u.tipo_miembro === 'secretario' ? 'Secretario' : 'Sin rol'),
      distrito: u.distrito ? _distritoNombre(u.distrito) : '',
      valor: r?.valor ?? null, max: r?.max, color: r?.color, nivel: r?.nivel, chips,
      estado: u.es_admin ? 'No se evalúa' : (_inactivosPE.has(u.id) && r?.valor == null ? 'Inactiva en este período' : 'Sin evaluar'),
    };
  });
  el.innerHTML = rosterHTML(personas, q || dist || est ? 'Nadie coincide con los filtros elegidos.' : 'Sin usuarios.');
  animarEntrada(el);
}

/* ══ PESTAÑA «GESTIÓN» DEL PERFIL ══════════════════════════════════════
 * Las mismas acciones que tenía cada fila de la tabla, agrupadas por lo que
 * significan. Los controles disparan los manejadores de siempre (data-change
 * / data-act de la lista blanca de config.js); al terminar, la pestaña se
 * repinta para no mostrar un estado viejo. */

const _refrescarGestion = () => Perfil.tab('gestion', document.getElementById('panel-lateral-cuerpo'));

async function gestionAprobar(id, aprobado) { await updateUserAprobado(id, aprobado); _refrescarGestion(); }
/** Un PE de una persona (desde su pestaña Gestión). */
async function participacionPE(userId, periodoId, activar) {
  const r = await API.setParticipacionMasiva([periodoId], [userId], activar);
  if (!r.ok) { showToast('No se pudo guardar: ' + r.error, 'error'); return; }
  if (_activePEUsers && String(_activePEUsers.id) === String(periodoId)) { activar ? _inactivosPE.delete(userId) : _inactivosPE.add(userId); renderUsuarios(); }
  invalidarPersonasRes(); _refrescarGestion();
  showToast(activar ? 'Participa en ese período' : 'Desactivada en ese período', 'ok');
}
/** Todos los PE de una persona de una vez. */
async function participacionTodos(userId, activar) {
  const r = await API.setParticipacionMasiva(_periodos.map(p => p.id), [userId], activar);
  if (!r.ok) { showToast('No se pudo guardar: ' + r.error, 'error'); return; }
  if (_activePEUsers) { activar ? _inactivosPE.delete(userId) : _inactivosPE.add(userId); renderUsuarios(); }
  invalidarPersonasRes(); _refrescarGestion();
  showToast(activar ? 'Activada en todos los períodos' : 'Desactivada en todos los períodos', 'ok');
}

/** Herramienta masiva: varias personas × varios PE, activar o desactivar, en una sola operación. */
function participacionMasiva() {
  const gente = _users.filter(u => !u.es_admin);
  const personas = gente.map(u => Selector.persona({ id: u.id, nombre: u.nombre || u.email, distrito: u.distrito, rol_nombre: u.roles?.nombre || '' }));
  Selector.soltar('part-masiva');
  const sel = Selector.crear({ id: 'part-masiva', personas, equipos: Selector.equiposDe(personas), seleccion: [] });
  Tareas.abrirModal({
    titulo: 'Participación por período',
    campos: [
      { tipo: 'info', texto: 'Elige a quién y en qué períodos. Quien se desactiva deja de contar en el resumen y los rankings de esos períodos; no se borra nada y se puede revertir.' },
      { id: 'accion', tipo: 'select', label: 'Acción', valor: 'off', opciones: [{ v: 'off', l: 'Desactivar' }, { v: 'on', l: 'Activar' }] },
      { id: 'pes', tipo: 'checks', label: 'Períodos', req: true, valor: _periodos.filter(p => p.activo).map(p => String(p.id)), opciones: _periodos.map(p => ({ v: String(p.id), l: p.nombre + (p.activo ? ' (activo)' : '') })) },
      { tipo: 'html', html: '<div id="part-sel-host"></div>' },
    ],
    confirmar: 'Aplicar',
    onConfirm: async v => {
      const ids = sel.seleccion();
      if (!ids.length) return 'Elige al menos una persona.';
      if (!(v.pes || []).length) return 'Elige al menos un período.';
      const activar = v.accion === 'on';
      const r = await API.setParticipacionMasiva(v.pes, ids, activar);
      if (!r.ok) return r.error;
      if (_activePEUsers && v.pes.includes(String(_activePEUsers.id))) ids.forEach(id => activar ? _inactivosPE.delete(id) : _inactivosPE.add(id));
      invalidarPersonasRes(); renderUsuarios();
      showToast(`${ids.length} persona${ids.length === 1 ? '' : 's'} ${activar ? 'activada' : 'desactivada'}${ids.length === 1 ? '' : 's'} en ${v.pes.length} período${v.pes.length === 1 ? '' : 's'}`, 'ok');
      return null;
    },
  });
  const host = document.getElementById('part-sel-host');
  if (host) { sel.montar(host); renderIconos(host); }
}

async function gestionParticipante(id, eraInactivo) { await toggleParticipante(id, eraInactivo); invalidarPersonasRes(); _refrescarGestion(); }
function borrarDesdePerfil(id) { cerrarPanel(); confirmDeleteUser(id); }

/** «Roles» (0021 + 0062): el rol principal + como mucho UN segundo rol (máximo 2 por persona). El segundo rol permite asignarle
 *  tareas con ese rol y evaluarla por él. Las PREFERENCIAS de la persona se muestran aparte y solo informan. */
async function rolesPermitidosHTML(u) {
  if (!API.rolesAmpliados(_roles)) {
    return `<section class="pf-card" aria-labelledby="gp-h-roles"><h3 class="pf-h" id="gp-h-roles">Roles</h3>
      <p class="gp-s">Habilitar un segundo rol necesita la migración 0021 en la base de datos.</p></section>`;
  }
  const [extra, pref] = await Promise.all([API.getPersonaRoles(u.id), API.getPreferenciasRol(u.id)]);
  if (extra.noDisponible) return '';
  const hab = new Set(extra.rows.map(r => Number(r.rol_id)));
  const nombre = id => _roles.find(r => Number(r.id) === Number(id))?.nombre || '—';
  const candidatos = _roles.filter(r => r.activo && Number(r.id) !== Number(u.rol_id));
  const prefs = pref.rows || [];
  const extras = [...hab].filter(id => id !== Number(u.rol_id));
  const exceso = extras.length > 1;   // dato anterior al límite de 2 roles: se muestra y se pide dejar uno
  return `<section class="pf-card" aria-labelledby="gp-h-roles" id="gp-roles-permitidos" data-persona="${escHtml(u.id)}">
      <h3 class="pf-h" id="gp-h-roles">Roles <small>máx. 2 por persona</small></h3>
      <p class="gp-s">Rol principal: <b>${escHtml(u.roles?.nombre || 'sin rol')}</b> (define su perfil y el núcleo de la evaluación). Un <b>segundo rol</b> permite asignarle tareas con ese rol y evaluarla también por él: cuenta en su resultado según las tareas que haga con cada rol.
        Sin segundo rol, solo la administración puede asignarle tareas de otro rol, como excepción visible.</p>
      ${exceso ? `<p class="gp-s gp-aviso" role="alert">Esta persona tiene ${extras.length + 1} roles (${escHtml([u.rol_id, ...extras].map(nombre).join(', '))}): el máximo es 2. Elige un solo segundo rol y se quitarán los demás.</p>` : ''}
      ${candidatos.length ? `<label class="gp-t" for="gp-rol2">Segundo rol</label>
        <select class="cfg-inp cfg-select" id="gp-rol2" data-change="gestionRolPermitido" aria-label="Segundo rol (máximo 2 roles por persona)">
          <option value=""${extras.length ? '' : ' selected'}>Sin segundo rol</option>
          ${candidatos.map(r => `<option value="${escHtml(r.id)}"${extras[0] === Number(r.id) ? ' selected' : ''}>${escHtml(r.nombre)}</option>`).join('')}
        </select>`
        : '<p class="gp-s">No hay otros roles activos.</p>'}
      <div class="gp-pref">
        <div class="gp-t">Lo que prefiere esta persona</div>
        ${prefs.length ? `<ol class="gp-pref-lista">${prefs.map(p => `<li>${escHtml(nombre(p.rol_id))}${p.es_predeterminado ? ' <span class="etiqueta etq-azul">Predeterminado</span>' : ''}${Number(p.rol_id) === Number(u.rol_id) || hab.has(Number(p.rol_id)) ? '' : ' <span class="etiqueta etq-gris">No habilitado</span>'}</li>`).join('')}</ol>`
          : '<p class="gp-s">Todavía no eligió preferencias.</p>'}
        <p class="gp-s">Las preferencias informan; no son una restricción ni un permiso.</p>
      </div>
    </section>`;
}
/** data-change del selector «Segundo rol»: guarda el único segundo rol (o ninguno). El límite de 2 roles lo impone también la base (0062). */
async function gestionRolPermitido(el) {
  const sec = el.closest('#gp-roles-permitidos'); if (!sec) return;
  const marcados = el.value ? [Number(el.value)] : [];
  sec.querySelectorAll('select').forEach(i => { i.disabled = true; });
  const r = await API.setPersonaRoles(sec.dataset.persona, marcados);
  if (!r.ok) showToast('No se pudo guardar: ' + r.error, 'error');
  else showToast(marcados.length ? 'Segundo rol actualizado' : 'Segundo rol quitado', 'ok');
  _refrescarGestion();
}

async function renderGestionPersona(cuerpo, ctx) {
  const u = _users.find(x => String(x.id) === String(ctx.persona.id));
  if (!u) { cuerpo.innerHTML = '<div class="empty-box"><div class="empty-txt">Esta persona ya no existe.</div></div>'; return; }
  const rolesPermitidos = await rolesPermitidosHTML(u);
  const part = await API.getParticipacionPersona(u.id);
  const inactivosPersona = new Set((part.rows || []).filter(r => r.activo === false).map(r => String(r.periodo_id)));
  const nombre = u.nombre || u.email;
  const aprobado = u.aprobado !== false;
  const inactivo = _inactivosPE.has(u.id);
  const pe = _activePEUsers;
  const campo = (id, etq, control) => `<div class="gp-campo"><label class="gp-lbl" for="${id}">${escHtml(etq)}</label>${control}</div>`;
  const aria = escHtml(nombre);

  cuerpo.innerHTML = `
    <div class="pf-grid pf-grid--1">
      <section class="pf-card" aria-labelledby="gp-h-acceso">
        <h3 class="pf-h" id="gp-h-acceso">Acceso</h3>
        <div class="gp-fila">
          <div><div class="gp-t">${aprobado ? 'Puede entrar al portal' : 'Pendiente de aprobación'}</div>
            <div class="gp-s">${aprobado ? 'Revocar el acceso la saca del portal hasta que la vuelvas a aprobar.' : 'No puede entrar hasta que apruebes su acceso.'}</div></div>
          <button type="button" class="btn-save" data-act="gestionAprobar" data-arg="${escHtml(u.id)}" data-arg2="${!aprobado}">${aprobado ? 'Revocar acceso' : 'Aprobar acceso'}</button>
        </div>
        <div class="gp-fila">
          <div><div class="gp-t">Administradora</div><div class="gp-s">Da acceso a todo este panel.</div></div>
          <label class="toggle-switch" title="${u.es_admin ? 'Quitar permisos de admin' : 'Dar permisos de admin'}">
            <input type="checkbox" ${u.es_admin ? 'checked' : ''} aria-label="${u.es_admin ? 'Quitar' : 'Dar'} permisos de admin a ${aria}"
                   data-change="onCambioAdminUsuario" data-arg="${escHtml(u.id)}">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </section>

      <section class="pf-card" aria-labelledby="gp-h-equipo">
        <h3 class="pf-h" id="gp-h-equipo">Lugar en el equipo</h3>
        ${campo(`gp-rol-${u.id}`, 'Rol', `<select class="cfg-inp cfg-select" id="gp-rol-${escHtml(u.id)}" data-change="onCambioRolUsuario" data-arg="${escHtml(u.id)}">
          ${_roles.map(r => `<option value="${escHtml(r.id)}"${r.id === u.rol_id ? ' selected' : ''}>${escHtml(r.nombre)}</option>`).join('')}</select>`)}
        ${campo(`gp-dist-${u.id}`, 'Distrito', `<select class="cfg-inp cfg-select" id="gp-dist-${escHtml(u.id)}" data-change="onCambioDistritoUsuario" data-arg="${escHtml(u.id)}">
          <option value="">Sin distrito</option>
          ${_distritos.map(d => `<option value="${escHtml(d.id)}"${d.id === u.distrito ? ' selected' : ''}>${escHtml(d.nombre)}</option>`).join('')}</select>`)}
        ${campo(`gp-tipo-${u.id}`, 'Tipo de miembro', `<select class="cfg-inp cfg-select" id="gp-tipo-${escHtml(u.id)}" data-change="onCambioTipoUsuario" data-arg="${escHtml(u.id)}">
          <option value="miembro"${u.tipo_miembro === 'miembro' ? ' selected' : ''}>Miembro</option>
          <option value="secretario"${u.tipo_miembro === 'secretario' ? ' selected' : ''}>Secretario</option></select>`)}
      </section>

      ${rolesPermitidos}

      <section class="pf-card" aria-labelledby="gp-h-pe">
        <h3 class="pf-h" id="gp-h-pe">Participación por período</h3>
        <p class="gp-s">Quien no participa en un período no cuenta en su resumen ni en sus rankings. Cambia cada período aquí mismo, sin cambiar de PE activo.</p>
        ${_periodos.length ? `<ul class="gp-pe-lista">${_periodos.map(p => {
          const off = inactivosPersona.has(String(p.id));
          return `<li class="gp-pe-fila"><span class="gp-t">${escHtml(p.nombre)}${p.activo ? ' <span class="etiqueta etq-verde">Activo</span>' : ''}${p.modelo === 'v2' ? '' : ' <span class="etiqueta etq-gris">Clásico</span>'}</span>
            <button type="button" class="pe-toggle ${off ? 'pe-toggle--off' : 'pe-toggle--on'}" data-act="partPE" data-arg="${escHtml(u.id)}" data-arg2="${escHtml(p.id)}" data-arg3="${off}"
              aria-label="${off ? 'Activar' : 'Desactivar'} a ${aria} en ${escHtml(p.nombre)}">${off ? 'Inactiva' : 'Participa'}</button></li>`; }).join('')}</ul>
          <div class="gp-fila gp-pe-todos">
            <button type="button" class="tk-btn" data-act="partTodos" data-arg="${escHtml(u.id)}" data-arg2="false">Desactivar en todos</button>
            <button type="button" class="tk-btn" data-act="partTodos" data-arg="${escHtml(u.id)}" data-arg2="true">Activar en todos</button>
          </div>` : '<p class="gp-s">Todavía no hay períodos.</p>'}
      </section>

      <section class="pf-card pf-card--peligro" aria-labelledby="gp-h-borrar">
        <h3 class="pf-h" id="gp-h-borrar">Eliminar</h3>
        <div class="gp-fila">
          <div><div class="gp-t">Borrar el perfil de ${aria}</div><div class="gp-s">Se pide confirmación antes de borrar nada.</div></div>
          <button type="button" class="btn-save btn-danger" data-act="borrarDesdePerfil" data-arg="${escHtml(u.id)}">Eliminar persona</button>
        </div>
      </section>
    </div>`;
  renderIconos(cuerpo);
}


/* ══ PANEL: «REQUIERE ATENCIÓN» ════════════════════════════════════════
 * Lo que pide una acción del admin, con enlace a donde se resuelve. Solo
 * cuenta hechos: no puntúa ni decide nada. Si falla una consulta, ese
 * renglón se omite en vez de afirmar algo que no se comprobó. */

async function renderAtencion() {
  const el = document.getElementById('ov-atencion'); if (!el) return;
  const pe = _activePEOv;
  const items = [];
  const nombrePE = pe ? pe.nombre : '';
  let datos = [];

  const pl = (n, uno, varios) => n === 1 ? uno : varios;
  const pendientes = _users.filter(u => u.aprobado === false).length;
  if (pendientes) items.push({ n: pendientes, icono: 'user-x', corto: 'Accesos por aprobar', txt: `${pendientes} ${pl(pendientes, 'persona espera', 'personas esperan')} que apruebes su acceso`, tab: 'usuarios', filtro: 'pendientes', cta: 'Gestionar' });

  if (pe) {
    const [evs, part] = await Promise.all([API.getEvaluacionesByPE(pe.id), API.getParticipantes(pe.id)]);
    const inactivos = new Set(part.filter(r => !r.activo).map(r => r.user_id));
    const evaluables = _users.filter(u => !u.es_admin && u.aprobado !== false && !inactivos.has(u.id));
    const conEv = new Set(evs.map(e => e.evaluado_id));
    const sinEvaluar = evaluables.filter(u => !conEv.has(u.id)).length;
    const borradores = evs.filter(e => e.estado === 'borrador').length;
    datos = detectarInconsistencias({ users: _users, evaluaciones: evs, inactivos, periodo: pe });
    if (sinEvaluar) items.push({ n: sinEvaluar, icono: 'clipboard-list', corto: 'Sin evaluar', txt: `${sinEvaluar} ${pl(sinEvaluar, 'persona', 'personas')} sin evaluar en ${nombrePE}`, tab: 'evaluar', cta: 'Evaluar' });
    if (borradores) items.push({ n: borradores, icono: 'file-pen', corto: 'Borradores sin publicar', txt: `${borradores} ${pl(borradores, 'evaluación', 'evaluaciones')} en borrador sin publicar en ${nombrePE}`, tab: 'evaluar', cta: 'Publicar' });

    if (esPeriodoV2(pe)) {
      const [res, lista] = await Promise.all([API.getResumenTareas(pe.id), API.getTareas({ periodoId: pe.id })]);
      if (res.ok && lista.ok) {
        const vencidas = Object.values(res.porUsuario).reduce((a, r) => a + (r.vencidas_abiertas || 0), 0);
        const porRevisar = lista.tareas.filter(t => t.estado === 'entregada').length;
        if (porRevisar) items.push({ n: porRevisar, icono: 'inbox', corto: 'Entregas por revisar', txt: `${porRevisar} ${pl(porRevisar, 'entrega espera', 'entregas esperan')} revisión`, tab: 'tareas', cta: 'Revisar' });
        if (vencidas) items.push({ n: vencidas, icono: 'alarm-clock', corto: 'Tareas vencidas', txt: `${vencidas} ${pl(vencidas, 'tarea vencida', 'tareas vencidas')} sin entregar`, tab: 'tareas', cta: 'Ver', aviso: true });
      }
    }
  }

  /* Componente compacto: una fila de ~36 px por situación (icono · nombre breve · cantidad · acción). Las más urgentes primero; si hay
     más de VISIBLES, el resto queda tras «Ver todas» para que la lista no empuje el resto del Panel. El texto completo va en `title`. */
  const VISIBLES = 4;
  items.sort((x, y) => (y.aviso ? 1 : 0) - (x.aviso ? 1 : 0));
  const accion = (i) => `data-act="${i.filtro ? 'personasFiltro' : 'tabSinBtn'}" data-arg="${escHtml(i.filtro || i.tab)}"`;
  const fila = (i, extra = '') => `
        <li class="atn-fila${i.aviso ? ' atn-fila--alta' : ''}${extra}">
          <i data-lucide="${escHtml(i.icono)}" class="atn-ico" aria-hidden="true"></i>
          <span class="atn-t" title="${escHtml(i.txt)}">${escHtml(i.corto)}${i.aviso ? '<span class="sr-only"> (prioridad alta)</span>' : ''}</span>
          <b class="atn-n">${i.n}</b>
          <button type="button" class="atn-acc" ${accion(i)} aria-label="${escHtml(i.cta)}: ${escHtml(i.txt)}">${escHtml(i.cta)}<i data-lucide="chevron-right" aria-hidden="true"></i></button>
        </li>`;
  const visibles = items.slice(0, VISIBLES), resto = items.slice(VISIBLES);
  const filaDato = (d) => `
        <li class="atn-fila atn-fila--dato">
          <i data-lucide="alert-triangle" class="atn-ico" aria-hidden="true"></i>
          <span class="atn-t" title="${escHtml(d.txt)}">${escHtml(d.txt)}${d.nombres.length ? `<small class="atn-quienes">${escHtml(d.nombres.slice(0, 3).join(', '))}${d.nombres.length > 3 ? ` y ${d.nombres.length - 3} más` : ''}</small>` : ''}</span>
          <b class="atn-n">${d.n}</b>
          <button type="button" class="atn-acc" ${accion(d)} aria-label="Revisar: ${escHtml(d.txt)}">Revisar<i data-lucide="chevron-right" aria-hidden="true"></i></button>
        </li>`;

  el.innerHTML = `
    <section class="atn" aria-labelledby="ov-atencion-h">
      <header class="atn-cab">
        <h3 class="atn-h" id="ov-atencion-h">Requiere atención${nombrePE ? ` <small>${escHtml(nombrePE)}</small>` : ''}</h3>
        ${items.length ? `<span class="atn-total" role="img" aria-label="${items.length} ${pl(items.length, 'situación', 'situaciones')}">${items.length}</span>` : ''}
      </header>
      ${items.length ? `<ul class="atn-lista">${visibles.map(i => fila(i)).join('')}</ul>
        ${resto.length ? `<details class="atn-mas"><summary>Ver todas (${items.length})</summary><ul class="atn-lista">${resto.map(i => fila(i)).join('')}</ul></details>` : ''}`
        : `<p class="atn-ok"><i data-lucide="circle-check" aria-hidden="true"></i> Todo al día${nombrePE ? ` en ${escHtml(nombrePE)}` : ''}</p>`}
      ${datos.length ? `<details class="atn-mas atn-datos"><summary>Datos por revisar <b class="atn-n">${datos.length}</b></summary>
        <p class="atn-nota">Contradicciones entre datos ya guardados. Solo avisan dónde mirar: no corrigen ni cambian ninguna nota.</p>
        <ul class="atn-lista">${datos.map(filaDato).join('')}</ul></details>` : ''}
    </section>`;
  renderIconos(el);
  renderCierre(pe);
}

/** «Cierre del período» (core/cierre.js): lista de verificación de solo lectura bajo «Requiere atención». Cada comprobación que no se pueda
 *  hacer (por ejemplo, una consulta que falla) se omite en vez de afirmar algo que no se comprobó. */
async function renderCierre(pe) {
  const el = document.getElementById('ov-cierre'); if (!el) return;
  if (!pe || typeof Cierre === 'undefined') { el.innerHTML = ''; return; }
  const v2 = esPeriodoV2(pe);
  const [evs, part, cfg, est, evd] = await Promise.all([
    API.getEvaluacionesByPE(pe.id), API.getParticipantes(pe.id),
    v2 ? API.getCalifConfig(pe.id) : Promise.resolve(null),
    API.getEstadisticasDistritosByPE(pe.id), API.getEvalDistritosByPE(pe.id),
  ]);
  const inactivos = new Set((part || []).filter(r => !r.activo).map(r => r.user_id));
  let porRevisar = null;
  if (v2) { const lista = await API.getTareas({ periodoId: pe.id }); if (lista.ok) porRevisar = lista.tareas.filter(t => t.estado === 'entregada').length; }
  const lista = Cierre.cierre({
    pe, users: _users, inactivos, evaluaciones: evs, v2,
    reglas: cfg && cfg.ok ? cfg.config : null, porRevisar,
    distritos: _distritos, estadisticas: est && est.ok ? est.data : null, evalsDistrito: Array.isArray(evd) ? evd : null,
  });
  el.innerHTML = Cierre.html(lista, { titulo: `Cierre de ${pe.nombre}`, plegable: true, id: 'cierre-periodo' });
  renderIconos(el);
}

/* ── Solicitudes de acceso (0070) ─────────────────────────────────────
 * Lo primero que se ve en «Personas y accesos» y, con un número, en el menú: quién espera aprobación, con lo que pidió al registrarse
 * (distrito o «invitado externo» y hasta 2 roles). Aprobar aplica esa solicitud a lo que esté vacío (la aplica la base, no esta pantalla):
 * la persona entra ya configurada. Secretaría y administración NO se piden: las asigna siempre la administración desde Gestión. */
function _pendientesAcceso() { return _users.filter(u => u.aprobado === false && !u.es_admin); }

function _textoSolicitud(u) {
  const dist = u.solicitud_distrito ? ((_distritos.find(d => String(d.id) === String(u.solicitud_distrito)) || {}).nombre || u.solicitud_distrito) : '';
  const nom = id => (_roles.find(r => String(r.id) === String(id)) || {}).nombre || '';
  const roles = [nom(u.solicitud_rol_id), nom(u.solicitud_rol2_id)].filter(Boolean);
  const partes = [dist ? (/^ext/i.test(String(u.solicitud_distrito)) ? 'Invitado externo' : dist) : '', roles.join(' + ')].filter(Boolean);
  return partes.length ? partes.join(' · ') : 'No indicó distrito ni rol: asígnalos al aprobar (Gestión).';
}

function renderSolicitudes() {
  const el = document.getElementById('usr-solicitudes');
  const pend = _pendientesAcceso();
  _marcarPendientesMenu(pend.length);
  if (!el) return;
  if (!pend.length) { el.innerHTML = ''; return; }
  // Desplegable: siempre sale cerrado y lo abre la administración. Mientras aprueba varias seguidas se mantiene como lo dejó.
  const abierta = !!el.querySelector('details.sol-desp[open]');
  el.innerHTML = `<details class="cr sol-acc sol-desp acordeon"${abierta ? ' open' : ''}><summary><span class="acordeon-t"><b>Solicitudes de acceso</b><small>${pend.length} por aprobar</small></span><i data-lucide="chevron-down" class="acordeon-chev" aria-hidden="true"></i></summary>
    <div class="acordeon-cuerpo"><p class="cr-sub">Aprobar aplica lo que cada persona pidió (distrito y roles). Si quieres cambiar algo, ábrela y ajusta en Gestión.</p>
    <ul class="cr-lista">${pend.map(u => `<li class="cr-fila">
      <div class="cr-txt"><span class="cr-t">${escHtml(u.nombre || u.email)}<small class="sol-mail"> ${escHtml(u.email || '')}</small></span><small class="cr-d">${escHtml(_textoSolicitud(u))}</small></div>
      <div class="sol-acc-btns"><button type="button" class="btn-out" data-act="perfilVer" data-arg="${escHtml(u.id)}">Revisar</button>
        <button type="button" class="btn-save" data-act="solAprobar" data-arg="${escHtml(u.id)}">Aprobar</button></div></li>`).join('')}</ul></div></details>`;
  if (typeof renderIconos === 'function') renderIconos(el);
}

/** Número de pendientes junto a «Personas» en el menú de computadora y en la barra del celular (nada si no hay). */
function _marcarPendientesMenu(n) {
  document.querySelectorAll('[data-act="tab"][data-arg="usuarios"], [data-act="tabSinBtn"][data-arg="usuarios"]').forEach(it => {
    let b = it.querySelector('.rail-pend');
    if (!n) { b?.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'rail-pend'; it.appendChild(b); }
    b.textContent = n > 9 ? '9+' : String(n);
    b.setAttribute('aria-label', n + ' por aprobar');
  });
}

async function solAprobar(id) {
  const r = await API.updateUserAprobado(id, true);
  if (!r.ok) { showToast('No se pudo aprobar: ' + r.error, 'error'); return; }
  showToast('Acceso aprobado: ya puede entrar con su distrito y su rol', 'ok');
  // la base aplicó la solicitud: se vuelve a leer a la persona para ver su distrito y su rol
  try { const lista = await API.getAllUsers(); if (Array.isArray(lista) && lista.length) _users = lista; else _users = _users.map(u => u.id === id ? { ...u, aprobado: true } : u); }
  catch (e) { _users = _users.map(u => u.id === id ? { ...u, aprobado: true } : u); }
  renderUsuarios();
}
