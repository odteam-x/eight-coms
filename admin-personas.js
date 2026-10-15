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
    id: u.id, nombre: u.nombre || u.email, email: u.email, avatar_url: u.avatar_url,
    rol_nombre: u.roles?.nombre || _roles.find(r => String(r.id) === String(u.rol_id))?.nombre || '',
    distrito: _distritoNombre(u.distrito), tipo_miembro: u.tipo_miembro,
  };
}

function initPersonas() {
  Perfil.configurar({
    modo: 'admin',
    resolver: id => { const u = _users.find(x => String(x.id) === String(id)); return u ? personaDeUsuario(u) : null; },
    calendario: () => _calendario,
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

async function renderPersonasCards() {
  const el = document.getElementById('personas-cards'); if (!el) return;
  const q = (document.getElementById('search-usuarios')?.value || '').toLowerCase().trim();
  const dist = (document.getElementById('filter-distrito-usuarios')?.value || '').trim();
  const lista = _users.filter(u =>
    (!q || (u.nombre || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || _distritoNombre(u.distrito).toLowerCase().includes(q)) &&
    (!dist || (dist === '__none__' ? !u.distrito : u.distrito === dist)));

  const res = await cargarPersonasRes();
  const personas = lista.map(u => {
    const r = res?.mapa.get(u.id);
    const chips = [];
    if (u.aprobado === false) chips.push({ txt: 'Acceso pendiente', aviso: true, icono: 'user-x' });
    if (u.es_admin) chips.push({ txt: 'Admin', icono: 'shield' });
    if (_inactivosPE.has(u.id)) chips.push({ txt: 'Inactiva en el período', icono: 'pause' });
    if (r?.borrador) chips.push({ txt: 'Borrador', icono: 'file-pen' });
    return {
      id: u.id, nombre: u.nombre || u.email, avatar_url: u.avatar_url,
      rol: u.roles?.nombre || (u.tipo_miembro === 'secretario' ? 'Secretario' : 'Sin rol'),
      valor: r?.valor ?? null, max: r?.max, color: r?.color, nivel: r?.nivel, chips,
      estado: u.es_admin ? 'No se evalúa' : 'Sin evaluar',
    };
  });
  el.innerHTML = rosterHTML(personas, q || dist ? 'Sin resultados.' : 'Sin usuarios.');
  animarEntrada(el);
}

/* ══ PESTAÑA «GESTIÓN» DEL PERFIL ══════════════════════════════════════
 * Las mismas acciones que tenía cada fila de la tabla, agrupadas por lo que
 * significan. Los controles disparan los manejadores de siempre (data-change
 * / data-act de la lista blanca de config.js); al terminar, la pestaña se
 * repinta para no mostrar un estado viejo. */

const _refrescarGestion = () => Perfil.tab('gestion', document.getElementById('panel-lateral-cuerpo'));

async function gestionAprobar(id, aprobado) { await updateUserAprobado(id, aprobado); _refrescarGestion(); }
async function gestionParticipante(id, eraInactivo) { await toggleParticipante(id, eraInactivo); invalidarPersonasRes(); _refrescarGestion(); }
function borrarDesdePerfil(id) { cerrarPanel(); confirmDeleteUser(id); }

async function renderGestionPersona(cuerpo, ctx) {
  const u = _users.find(x => String(x.id) === String(ctx.persona.id));
  if (!u) { cuerpo.innerHTML = '<div class="empty-box"><div class="empty-txt">Esta persona ya no existe.</div></div>'; return; }
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

      ${pe ? `<section class="pf-card" aria-labelledby="gp-h-pe">
        <h3 class="pf-h" id="gp-h-pe">Participación en ${escHtml(pe.nombre)}</h3>
        <div class="gp-fila">
          <div><div class="gp-t">${inactivo ? 'No participa en este período' : 'Participa en este período'}</div>
            <div class="gp-s">Quien no participa no cuenta en el resumen ni en los rankings.</div></div>
          <button type="button" class="btn-save" data-act="gestionParticipante" data-arg="${escHtml(u.id)}" data-arg2="${inactivo}">${inactivo ? 'Activar' : 'Desactivar'}</button>
        </div>
      </section>` : ''}

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

  const pendientes = _users.filter(u => u.aprobado === false).length;
  if (pendientes) items.push({ n: pendientes, icono: 'user-x', txt: `persona${pendientes === 1 ? '' : 's'} esperando que apruebes su acceso`, tab: 'usuarios', cta: 'Revisar accesos' });

  if (pe) {
    const [evs, part] = await Promise.all([API.getEvaluacionesByPE(pe.id), API.getParticipantes(pe.id)]);
    const inactivos = new Set(part.filter(r => !r.activo).map(r => r.user_id));
    const evaluables = _users.filter(u => !u.es_admin && u.aprobado !== false && !inactivos.has(u.id));
    const conEv = new Set(evs.map(e => e.evaluado_id));
    const sinEvaluar = evaluables.filter(u => !conEv.has(u.id)).length;
    const borradores = evs.filter(e => e.estado === 'borrador').length;
    if (sinEvaluar) items.push({ n: sinEvaluar, icono: 'clipboard-list', txt: `persona${sinEvaluar === 1 ? '' : 's'} sin evaluar en ${nombrePE}`, tab: 'evaluar', cta: 'Evaluar' });
    if (borradores) items.push({ n: borradores, icono: 'file-pen', txt: `evaluación${borradores === 1 ? '' : 'es'} en borrador sin publicar en ${nombrePE}`, tab: 'evaluar', cta: 'Publicar' });

    if (esPeriodoV2(pe)) {
      const [res, lista] = await Promise.all([API.getResumenTareas(pe.id), API.getTareas({ periodoId: pe.id })]);
      if (res.ok && lista.ok) {
        const vencidas = Object.values(res.porUsuario).reduce((a, r) => a + (r.vencidas_abiertas || 0), 0);
        const porRevisar = lista.tareas.filter(t => t.estado === 'entregada').length;
        if (porRevisar) items.push({ n: porRevisar, icono: 'inbox', txt: `entrega${porRevisar === 1 ? '' : 's'} esperando revisión`, tab: 'tareas', cta: 'Revisar' });
        if (vencidas) items.push({ n: vencidas, icono: 'alarm-clock', txt: `tarea${vencidas === 1 ? '' : 's'} vencida${vencidas === 1 ? '' : 's'} sin entregar`, tab: 'tareas', cta: 'Ver tareas', aviso: true });
      }
    }
  }

  el.innerHTML = `
    <section class="atencion" aria-labelledby="ov-atencion-h">
      <h3 class="pf-h" id="ov-atencion-h">Requiere atención</h3>
      ${items.length ? `<ul class="atencion-lista">${items.map(i => `
        <li class="atencion-item${i.aviso ? ' atencion-item--aviso' : ''}">
          <i data-lucide="${escHtml(i.icono)}" class="atencion-ico" aria-hidden="true"></i>
          <span class="atencion-n">${i.n}</span>
          <span class="atencion-txt">${escHtml(i.txt)}</span>
          <button type="button" class="pf-enlace" data-act="tabSinBtn" data-arg="${escHtml(i.tab)}">${escHtml(i.cta)}<i data-lucide="arrow-right" aria-hidden="true"></i></button>
        </li>`).join('')}</ul>`
        : `<p class="atencion-ok"><i data-lucide="circle-check" aria-hidden="true"></i> Todo al día en ${escHtml(nombrePE || 'este período')}: nadie espera una acción tuya.</p>`}
    </section>`;
  renderIconos(el);
}
