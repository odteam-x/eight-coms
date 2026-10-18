'use strict';
/**
 * EIGHT CREATORS LABs — Nueva tarea / asignación (para quien revisa: administración y secretaría)
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * Tres pasos, pensados para decidir con los datos delante y no descubrir un problema después de crear:
 *   1. Qué      — título, qué se espera, período, actividad (opcional), prioridad, fecha límite y, si se quiere,
 *                 el rol para el que es el trabajo (así el paso 2 muestra quién lo tiene habilitado o lo prefiere).
 *   2. Quién    — el Selector (core/selector.js): personas y equipos con rol, preferencia, compatibilidad y carga.
 *   3. Rol y resumen — un rol POR PERSONA (carga sus responsabilidades y con qué competencias se evalúa), qué
 *                 competencias evidencia la tarea y un resumen de lo que se va a crear, con sus validaciones.
 *
 * VALIDACIONES (avisan antes; la base decide al final):
 *   · incompatibilidad : la persona no tiene habilitado ese rol. La secretaría NO puede (la base lo rechaza);
 *                        la administración sí, como excepción que queda marcada en la tarea (`rol_excepcion`).
 *   · duplicado        : ya tiene una tarea abierta con el mismo título en este período.
 *   · sobrecarga       : ya tiene Selector.SOBRECARGA o más tareas abiertas, o tiene vencidas.
 *   · fuera de período : no participa en el período, o la fecha límite ya pasó.
 *   Los avisos se confirman con una casilla; los bloqueos impiden crear.
 *
 * Antes de la migración 0021 no hay roles por persona ni compatibilidad: el flujo sigue funcionando con la
 * lista de personas que ya tenía el portal y sin el paso de rol.
 * Depende de: core/selector.js, core/tareas.js (contexto `c`), core/render.js, core/rubrica.js, core/store.js, api.js.
 */
const Asignar = (() => {
  let E = null;
  const MODAL = 'asig-modal';
  const hoyISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const normTitulo = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const ABIERTAS = ['asignada', 'en_curso', 'devuelta', 'bloqueada'];
  const nombreDistrito = d => (typeof _distritoNombre === 'function' ? _distritoNombre(d) : d);

  function asegurar() {
    if (document.getElementById(MODAL)) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="tk-overlay" id="${MODAL}" style="display:none" data-act="cerrarModalFondo" data-arg="${MODAL}">
        <div class="tk-box asig-box" role="document">
          <div class="modal-title" id="${MODAL}-title">Nueva tarea</div>
          <ol class="asig-pasos" id="${MODAL}-pasos" aria-label="Pasos"></ol>
          <div id="${MODAL}-cuerpo"></div>
          <div class="tk-err" id="${MODAL}-err" role="alert"></div>
          <div class="tk-modal-acciones asig-acciones">
            <button type="button" class="btn-save" id="${MODAL}-sig" data-act="asigSiguiente">Siguiente</button>
            <button type="button" class="tk-btn" id="${MODAL}-atras" data-act="asigAtras">Atrás</button>
            <button type="button" class="tk-btn" data-act="cerrarModal" data-arg="${MODAL}">Cancelar</button>
          </div>
        </div>
      </div>`);
  }

  /* ── Datos ──────────────────────────────────────────────────────────── */
  async function cargarDatos(c) {
    const periodo = c.periodoId;
    const [asig, extra, roles, tareas, acts] = await Promise.all([
      API.getPersonasAsignables(periodo, null), API.getPersonaRoles(), API.getRoles(true), API.getTareas({ periodoId: periodo }), API.getActividades(),
    ]);
    const conRoles = !asig.noDisponible && API.rolesAmpliados(roles);
    // Sin 0021: las personas que ya conocía el portal, sin rol ni carga.
    const filas = asig.ok ? asig.rows : [...c.personas.values()].filter(p => p.id !== c.yo).map(p => ({ persona_id: p.id, nombre: p.nombre, distrito: p.distrito, rol_nombre: p.rol }));
    const extras = new Map();
    for (const r of extra.rows || []) { if (!extras.has(r.persona_id)) extras.set(r.persona_id, new Set()); extras.get(r.persona_id).add(Number(r.rol_id)); }
    return {
      conRoles, filas, extras, roles: conRoles ? roles : [], tareas: tareas.ok ? tareas.tareas : [],
      actividades: conRoles && acts.ok ? acts.rows : [],
    };
  }

  /** Roles que la persona puede asumir: el principal + los habilitados. */
  function permitidosDe(p) {
    const s = new Set(E.extras.get(p.id) || []);
    if (p.rol_id != null) s.add(Number(p.rol_id));
    return s;
  }

  /* ── Competencias por rol (perfil vigente en el período) ─────────────── */
  function competenciasDe(rolId) {
    if (rolId == null || rolId === '') return null;
    const perfil = perfilVigenteDe(Number(rolId), E.datos.periodo);
    if (!perfil) return { perfil: null, tecnicos: [], nucleo: [] };
    const a = criteriosAplicables(perfil);
    return { perfil, tecnicos: a.tecnicos, nucleo: a.nucleo };
  }
  const rolPorId = id => E.roles.find(r => Number(r.id) === Number(id));

  function rolInfoHTML(rolId) {
    const r = rolPorId(rolId); if (!r) return '';
    const comp = competenciasDe(rolId);
    const resp = lineasDeTexto(r.responsabilidades);
    return `<div class="asig-rolinfo">
      ${r.descripcion ? `<p class="rol-desc">${escHtml(r.descripcion)}</p>` : ''}
      ${resp.length ? acordeonHTML({ id: 'asig-resp-' + r.id, titulo: 'Responsabilidades del rol', cuerpo: `<ul class="rol-lista">${resp.map(x => `<li>${escHtml(x)}</li>`).join('')}</ul>`, extra: 'acordeon--compacto' }) : ''}
      ${comp?.tecnicos.length ? acordeonHTML({ id: 'asig-eval-' + r.id, titulo: 'Se evalúa con', resumen: `${comp.tecnicos.length} competencias del rol`,
        cuerpo: `<ul class="rol-lista">${comp.tecnicos.map(k => `<li>${escHtml(k.nombre)} <span class="asig-peso">${escHtml(k.peso)}</span></li>`).join('')}</ul>`, extra: 'acordeon--compacto' }) : ''}
      ${!r.descripcion && !resp.length ? '<p class="cfg-hint">La administración aún no describió este rol.</p>' : ''}
    </div>`;
  }

  /* ── Validaciones ───────────────────────────────────────────────────── */
  function validar() {
    const porPersona = new Map(), globales = [];
    const sel = E.selector.seleccion();
    const t = normTitulo(E.datos.titulo);
    if (E.datos.fecha && E.datos.fecha < hoyISO()) globales.push({ nivel: 'aviso', txt: 'La fecha límite ya pasó: la tarea nacería vencida.' });
    for (const id of sel) {
      const p = E.selector.persona(id); if (!p) continue;
      const out = [];
      const rolId = E.rolPor.get(id);
      if (E.conRoles && rolId != null && rolId !== '' && !permitidosDe(p).has(Number(rolId))) {
        out.push(E.c.esAdmin
          ? { nivel: 'aviso', txt: `No tiene habilitado «${rolPorId(rolId)?.nombre || 'ese rol'}». Se creará como excepción y quedará marcada en la tarea.` }
          : { nivel: 'error', txt: `No tiene habilitado «${rolPorId(rolId)?.nombre || 'ese rol'}». Elige otro rol o pide a la administración que se lo habilite.` });
      }
      const duplicada = E.tareas.find(x => x.asignada_a === id && ABIERTAS.includes(x.estado) && normTitulo(x.titulo) === t);
      if (t && duplicada) out.push({ nivel: 'aviso', txt: 'Ya tiene una tarea abierta con ese mismo título en este período.' });
      if (p.abiertas + 1 >= Selector.SOBRECARGA) out.push({ nivel: 'aviso', txt: `Ya tiene ${p.abiertas} tareas abiertas: con esta serían ${p.abiertas + 1}.` });
      if (p.vencidas > 0) out.push({ nivel: 'aviso', txt: `Tiene ${p.vencidas} tarea${p.vencidas === 1 ? '' : 's'} vencida${p.vencidas === 1 ? '' : 's'} sin entregar.` });
      if (!p.activo) out.push({ nivel: 'aviso', txt: 'No participa en este período: sus tareas no cuentan en el resumen.' });
      porPersona.set(id, out);
    }
    const hayError = [...porPersona.values()].some(l => l.some(x => x.nivel === 'error'));
    const avisos = [...porPersona.values()].reduce((n, l) => n + l.filter(x => x.nivel === 'aviso').length, 0) + globales.filter(x => x.nivel === 'aviso').length;
    return { porPersona, globales, hayError, avisos };
  }

  /* ── Pintado ────────────────────────────────────────────────────────── */
  const PASOS = ['Qué', 'Quién', 'Rol y resumen'];
  const cuerpo = () => document.getElementById(MODAL + '-cuerpo');
  const err = t => { document.getElementById(MODAL + '-err').textContent = t || ''; };

  function pintarPasos() {
    document.getElementById(MODAL + '-pasos').innerHTML = PASOS.map((n, i) =>
      `<li class="asig-paso${i === E.paso ? ' asig-paso--on' : i < E.paso ? ' asig-paso--hecho' : ''}"${i === E.paso ? ' aria-current="step"' : ''}><span class="asig-paso-n">${i + 1}</span><span class="asig-paso-t">${escHtml(n)}</span></li>`).join('');
    const atras = document.getElementById(MODAL + '-atras'), sig = document.getElementById(MODAL + '-sig');
    atras.hidden = E.paso === 0;
    const hay = E.selector ? E.selector.seleccion().length : 0;
    sig.textContent = E.paso < 2 ? 'Siguiente' : `Crear ${hay} tarea${hay === 1 ? '' : 's'}`;
  }

  function campo(id, label, ctrl, ayuda = '') {
    return `<div class="tk-campo"><label for="asig-${id}">${escHtml(label)}</label>${ctrl}${ayuda ? `<small class="tk-ayuda">${escHtml(ayuda)}</small>` : ''}</div>`;
  }

  function paso1() {
    const d = E.datos, c = E.c;
    const per = (c.periodos || []).length > 1 ? campo('periodo', 'Período de la tarea',
      `<select class="cfg-inp cfg-select" id="asig-periodo">${c.periodos.map(p => `<option value="${escHtml(p.id)}"${p.id === d.periodo ? ' selected' : ''}>${escHtml(p.pe + (p.nombre && p.nombre !== p.pe ? ' · ' + p.nombre : ''))}</option>`).join('')}</select>`,
      'La tarea cuenta como evidencia de ese período.') : '';
    const act = E.actividades.length ? campo('actividad', 'Actividad (opcional)',
      `<select class="cfg-inp cfg-select" id="asig-actividad"><option value="">Sin actividad</option>${E.actividades.map(a => `<option value="${escHtml(a.id)}"${String(a.id) === String(d.actividad) ? ' selected' : ''}>${escHtml(a.titulo)} · ${escHtml(String(a.fecha_inicio).slice(0, 10))}</option>`).join('')}</select>`,
      'Vincula el trabajo a una actividad del calendario.') : '';
    const rol = E.conRoles ? campo('rolctx', '¿Para qué rol es el trabajo? (opcional)',
      `<select class="cfg-inp cfg-select" id="asig-rolctx"><option value="">Cada persona, con su rol principal</option>${E.roles.map(r => `<option value="${escHtml(r.id)}"${String(r.id) === String(d.rolCtx) ? ' selected' : ''}>${escHtml(r.nombre)}</option>`).join('')}</select>`,
      'Si lo eliges, en el paso siguiente verás quién lo tiene habilitado y quién lo prefiere.') : '';
    cuerpo().innerHTML = `
      ${per}
      ${campo('titulo', 'Título *', `<input class="cfg-inp" id="asig-titulo" type="text" maxlength="160" value="${escHtml(d.titulo)}" placeholder="Ej.: Cobertura de la jornada del sábado">`)}
      ${campo('desc', 'Qué se espera', `<textarea class="cfg-inp" id="asig-desc" rows="3" maxlength="2000" placeholder="Formato, medidas, dónde se entrega…">${escHtml(d.descripcion)}</textarea>`)}
      ${rol}${act}
      <div class="asig-fila2">
        ${campo('prioridad', 'Prioridad', `<select class="cfg-inp cfg-select" id="asig-prioridad">${[['alta', 'Alta'], ['normal', 'Normal'], ['baja', 'Baja']].map(([v, l]) => `<option value="${v}"${v === d.prioridad ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
        ${campo('fecha', 'Fecha límite', `<input class="cfg-inp" id="asig-fecha" type="date" value="${escHtml(d.fecha)}">`)}
      </div>`;
    document.getElementById('asig-titulo')?.focus();
  }

  function leerPaso1() {
    const v = id => document.getElementById('asig-' + id);
    const d = E.datos;
    d.titulo = v('titulo').value.trim(); d.descripcion = v('desc').value.trim();
    d.prioridad = v('prioridad').value; d.fecha = v('fecha').value;
    if (v('periodo')) d.periodo = v('periodo').value;
    if (v('actividad')) d.actividad = v('actividad').value;
    if (v('rolctx')) d.rolCtx = v('rolctx').value;
  }

  async function paso2() {
    cuerpo().innerHTML = `<p class="tk-info">Elige a quién va <b>«${escHtml(E.datos.titulo)}»</b>. Puedes marcar personas sueltas o equipos enteros.</p><div id="asig-selector"></div>`;
    // La compatibilidad con el rol depende del rol elegido en el paso 1: se vuelve a pedir si cambió.
    const rolId = E.datos.rolCtx ? Number(E.datos.rolCtx) : null;
    if (E.conRoles && E.rolCargado !== rolId) {
      const r = await API.getPersonasAsignables(E.datos.periodo, rolId);
      if (r.ok) E.selector.setContexto({ rolId, rolNombre: rolPorId(rolId)?.nombre || '', personas: r.rows });
      E.rolCargado = rolId;
    }
    E.selector.montar(document.getElementById('asig-selector'));
    document.getElementById(E.selector.id + '-q')?.focus();
  }

  function paso3() {
    const sel = E.selector.seleccion();
    // Rol por defecto de cada persona: el del contexto si lo hay y, si no, su principal.
    for (const id of sel) {
      if (E.rolPor.has(id)) continue;
      const p = E.selector.persona(id);
      E.rolPor.set(id, E.datos.rolCtx ? Number(E.datos.rolCtx) : (p?.rol_id ?? ''));
    }
    for (const id of [...E.rolPor.keys()]) if (!sel.includes(id)) E.rolPor.delete(id);
    const v = validar();
    E._v = v;

    const tarjeta = id => {
      const p = E.selector.persona(id); if (!p) return '';
      const rolId = E.rolPor.get(id);
      const perm = permitidosDe(p);
      const opt = r => `<option value="${escHtml(r.id)}"${Number(rolId) === Number(r.id) && rolId !== '' ? ' selected' : ''}>${escHtml(r.nombre)}</option>`;
      const hab = E.roles.filter(r => perm.has(Number(r.id))), no = E.roles.filter(r => !perm.has(Number(r.id)));
      const sel1 = E.conRoles ? `<label class="asig-lbl" for="asig-rol-${escHtml(id)}">Rol en esta tarea</label>
        <select class="cfg-inp cfg-select" id="asig-rol-${escHtml(id)}" data-change="asigRol" data-arg="${escHtml(id)}">
          <option value=""${rolId === '' || rolId == null ? ' selected' : ''}>Sin rol específico</option>
          ${hab.length ? `<optgroup label="Habilitados para ${escHtml(p.nombre)}">${hab.map(opt).join('')}</optgroup>` : ''}
          ${no.length ? `<optgroup label="No habilitados${E.c.esAdmin ? ' (excepción)' : ''}">${no.map(opt).join('')}</optgroup>` : ''}
        </select>` : '';
      const issues = v.porPersona.get(id) || [];
      return `<article class="asig-persona">
        <header class="asig-persona-cab">${Avatar.html(p, { tam: 'sm' })}
          <div><b>${escHtml(p.nombre)}</b><small>${escHtml(p.rol_nombre ? 'Rol principal: ' + p.rol_nombre : 'Sin rol principal')}${p.distrito ? ' · ' + escHtml(p.distrito) : ''}</small></div></header>
        ${sel1}
        ${E.conRoles && rolId !== '' && rolId != null ? rolInfoHTML(rolId) : ''}
        ${issues.length ? `<ul class="asig-avisos">${issues.map(x => `<li class="asig-aviso asig-aviso--${x.nivel}"><i data-lucide="alert-triangle" aria-hidden="true"></i><span>${escHtml(x.txt)}</span></li>`).join('')}</ul>` : ''}
      </article>`;
    };

    // Competencias que la tarea evidencia: las de los roles elegidos y las comunes.
    const roles = [...new Set(sel.map(id => E.rolPor.get(id)).filter(r => r !== '' && r != null).map(Number))];
    const grupos = [];
    for (const r of roles) {
      const comp = competenciasDe(r);
      if (comp?.tecnicos.length) grupos.push({ titulo: 'Del rol ' + (rolPorId(r)?.nombre || ''), items: comp.tecnicos });
    }
    const nuc = competenciasDe(roles[0] ?? null) || { nucleo: criteriosAplicables(null).nucleo };
    if (nuc.nucleo?.length) grupos.push({ titulo: 'Comunes a todos los roles', items: nuc.nucleo });
    else { const a = criteriosAplicables(null); if (a.nucleo.length) grupos.push({ titulo: 'Comunes a todos los roles', items: a.nucleo }); }
    const crit = grupos.length ? `<section class="asig-crit" aria-labelledby="asig-crit-h">
        <div class="asig-crit-cab"><h4 id="asig-crit-h" class="asig-h">Qué competencias evidencia (opcional)</h4>
          ${roles.length ? '<button type="button" class="btn--texto" data-act="asigSugerir">Sugerir las del rol</button>' : ''}</div>
        <p class="tk-ayuda">Orienta a quien evalúa. No puntúa nada por sí sola.</p>
        ${grupos.map(g => `<fieldset class="tk-campo tk-checks"><legend>${escHtml(g.titulo)}</legend><div class="tk-checks-lista">${g.items.map(k => `
          <label class="tk-check"><input type="checkbox" value="${escHtml(k.key)}" data-change="asigCrit"${E.datos.criterios.has(k.key) ? ' checked' : ''}><span>${escHtml(k.nombre)}</span></label>`).join('')}</div></fieldset>`).join('')}
      </section>` : '';

    // Resumen
    const fechaTxt = E.datos.fecha ? new Date(E.datos.fecha + 'T00:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }) : 'sin fecha límite';
    const lineas = sel.map(id => {
      const p = E.selector.persona(id); const r = rolPorId(E.rolPor.get(id));
      return `<li><b>${escHtml(p?.nombre || '—')}</b>${r ? ` <span class="etiqueta etq-gris">${escHtml(r.nombre)}</span>` : ''}${(v.porPersona.get(id) || []).some(x => x.nivel === 'error') ? ' <span class="etiqueta etq-rojo">No se puede crear</span>' : (v.porPersona.get(id) || []).length ? ' <span class="etiqueta etq-ambar">Con avisos</span>' : ''}</li>`;
    }).join('');
    const hayAvisos = v.avisos > 0;
    const resumen = `<section class="asig-resumen" aria-labelledby="asig-res-h">
        <h4 class="asig-h" id="asig-res-h">Resumen</h4>
        <p><b>«${escHtml(E.datos.titulo)}»</b> · prioridad ${escHtml(E.datos.prioridad)} · vence ${escHtml(fechaTxt)}${E.datos.criterios.size ? ` · evidencia ${escHtml(E.datos.criterios.size)} competencia${E.datos.criterios.size === 1 ? '' : 's'}` : ''}</p>
        <p>Se crearán <b>${sel.length}</b> tarea${sel.length === 1 ? '' : 's'} (una por persona) y cada una recibirá su aviso.</p>
        <ul class="asig-res-lista">${lineas}</ul>
        ${v.globales.map(x => `<p class="asig-aviso asig-aviso--${x.nivel}"><i data-lucide="alert-triangle" aria-hidden="true"></i><span>${escHtml(x.txt)}</span></p>`).join('')}
        ${hayAvisos && !v.hayError ? `<label class="tk-check asig-ack"><input type="checkbox" id="asig-ack" data-change="asigAck"${E.ack ? ' checked' : ''}><span>Entiendo los avisos y quiero crear las tareas de todos modos.</span></label>` : ''}
        ${v.hayError ? '<p class="asig-aviso asig-aviso--error"><i data-lucide="alert-triangle" aria-hidden="true"></i><span>Resuelve lo marcado en rojo para poder crear.</span></p>' : ''}
      </section>`;

    cuerpo().innerHTML = `${E.conRoles ? '<p class="tk-info">Cada persona puede tener un rol distinto en esta tarea. Al elegirlo ves sus responsabilidades y con qué se evalúa.</p>' : ''}
      <div class="asig-personas">${sel.map(tarjeta).join('')}</div>${crit}${resumen}`;
    if (typeof renderIconos === 'function') renderIconos(cuerpo());
    actualizarBoton();
  }

  function actualizarBoton() {
    if (E.paso !== 2) return;
    const v = E._v || validar();
    const sig = document.getElementById(MODAL + '-sig');
    const n = E.selector.seleccion().length;
    sig.textContent = `Crear ${n} tarea${n === 1 ? '' : 's'}`;
    sig.disabled = v.hayError || (v.avisos > 0 && !E.ack) || E.creando;
  }

  async function ir(paso) {
    E.paso = paso; err('');
    pintarPasos();
    const sig = document.getElementById(MODAL + '-sig'); sig.disabled = false;
    if (paso === 0) paso1();
    else if (paso === 1) await paso2();
    else paso3();
    document.getElementById(MODAL + '-cuerpo').scrollTop = 0;
    if (typeof renderIconos === 'function') renderIconos(document.getElementById(MODAL));
  }

  /* ── Acciones ───────────────────────────────────────────────────────── */
  async function siguiente() {
    if (!E || E.creando) return;
    if (E.paso === 0) {
      leerPaso1();
      if (!E.datos.titulo) return err('Escribe un título.');
      return ir(1);
    }
    if (E.paso === 1) {
      if (!E.selector.seleccion().length) return err('Elige al menos una persona.');
      return ir(2);
    }
    return crear();
  }
  function atras() { if (E && E.paso > 0) ir(E.paso - 1); }

  async function crear() {
    const v = validar();
    if (v.hayError || (v.avisos > 0 && !E.ack)) return;
    E.creando = true; actualizarBoton(); err('');
    const sel = E.selector.seleccion();
    const crit = [...E.datos.criterios];
    const res = [];
    for (const id of sel) {   // en serie: así el orden de los avisos y los errores son legibles
      const rolId = E.rolPor.get(id);
      const r = await API.crearTarea({
        periodo_id: E.datos.periodo, titulo: E.datos.titulo, descripcion: E.datos.descripcion, asignada_a: id,
        prioridad: E.datos.prioridad, fecha_limite: E.datos.fecha || null, criterios: crit,
        rol_id: rolId === '' || rolId == null ? null : Number(rolId), actividad_id: E.datos.actividad ? Number(E.datos.actividad) : null,
      });
      res.push({ id, r });
    }
    E.creando = false;
    const fallos = res.filter(x => !x.r.ok), hechas = res.length - fallos.length;
    if (hechas) { E.c.onCreadas?.(); E.c.onCambio?.(); }
    if (!fallos.length) {
      closeModal(MODAL);
      showToast(hechas > 1 ? `${hechas} tareas creadas` : 'Tarea creada', 'ok');
      E = null;
      return;
    }
    // Algunas no se crearon: se queda en el modal con solo esas personas elegidas, para corregir y reintentar.
    const nombre = id => E.selector.persona(id)?.nombre || 'una persona';
    err(`${hechas ? `Se crearon ${hechas} de ${res.length}. ` : ''}No se pudo crear para: ${fallos.map(f => nombre(f.id) + ' (' + f.r.error + ')').join('; ')}`);
    E.selector.setSeleccion(fallos.map(f => f.id));
    E.ack = false;
    paso3();
  }

  function cambiarRol(el) {
    if (!E) return;
    const id = el.dataset.arg;
    E.rolPor.set(id, el.value === '' ? '' : Number(el.value));
    E.ack = false;
    paso3();
    document.getElementById('asig-rol-' + id)?.focus();
  }
  function ack(el) { E.ack = el.checked; actualizarBoton(); }
  function critCambio(el) { if (el.checked) E.datos.criterios.add(el.value); else E.datos.criterios.delete(el.value); }
  function sugerir() {
    const sel = E.selector.seleccion();
    const roles = [...new Set(sel.map(id => E.rolPor.get(id)).filter(r => r !== '' && r != null).map(Number))];
    for (const r of roles) for (const k of (competenciasDe(r)?.tecnicos || []).slice(0, 3)) E.datos.criterios.add(k.key);
    paso3();
  }

  /* ── Entrada ────────────────────────────────────────────────────────── */
  async function abrir(c) {
    asegurar();
    const periodoId = c.periodoId;
    const d = await cargarDatos(c);
    E = {
      c, paso: 0, creando: false, ack: false, rolCargado: undefined, rolPor: new Map(),
      conRoles: d.conRoles, roles: d.roles, extras: d.extras, tareas: d.tareas, actividades: d.actividades.filter(a => (a.fecha_fin || a.fecha_inicio) >= hoyISO().slice(0, 7) + '-01'),
      datos: { titulo: '', descripcion: '', periodo: periodoId, prioridad: 'normal', fecha: c.fechaIni || '', actividad: '', rolCtx: '', criterios: new Set() },
    };
    const personas = d.filas.map(r => ({ ...r }));
    Selector.soltar('asig');
    E.selector = Selector.crear({
      id: 'asig', personas, equipos: Selector.equiposDe(personas.map(p => ({ id: p.persona_id ?? p.id, distrito: p.distrito, rol_nombre: p.rol_nombre })), { nombreDistrito }),
      seleccion: c.paraId && personas.some(p => (p.persona_id ?? p.id) === c.paraId) ? [c.paraId] : [],
      onCambio: () => { E.ack = false; pintarPasos(); },
    });
    setEl(MODAL + '-title', 'Nueva tarea');
    openModal(MODAL);
    await ir(0);
  }

  return { abrir, siguiente, atras, cambiarRol, ack, critCambio, sugerir };
})();

/* Lista blanca de config.js (data-change). */
function asigRol(el) { Asignar.cambiarRol(el); }
function asigAck(el) { Asignar.ack(el); }
function asigCrit(el) { Asignar.critCambio(el); }
