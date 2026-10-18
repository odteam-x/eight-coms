'use strict';
/**
 * EIGHT CREATORS LABs — Asistente de bienvenida
 * ──────────────────────────────────────────────
 * Unos pocos pasos, distintos según lo que la persona hace (creator, secretaría, administración), para que
 * llegue a su primera semana sabiendo qué hacer y dónde. Tiene progreso visible («paso 2 de 5»), se puede
 * dejar a medias y se RETOMA donde quedó: el avance se guarda en bienvenida_estado (migración 0025).
 *
 *   · DOS recorridos. Quien llega ahora (no hay fila) ve la BIENVENIDA completa; quien ya usaba el portal cuando se aplicó
 *     la migración (origen = 'existente') ve «NOVEDADES»: solo lo que cambió. Cada uno con su versión para creator,
 *     secretaría y administración.
 *   · Se abre solo una vez. «Ahora no» lo deja guardado como omitido: no vuelve a abrirse solo, pero se puede repasar
 *     desde Mi cuenta.
 *   · Mientras está empezado y sin terminar, Inicio muestra una tarjeta («Primeros pasos» o «Novedades») con el avance.
 *   · Algunos pasos se dan por hechos solos (ya hay foto, ya hay preferencias de rol); los demás los marca la persona.
 *
 * No concede ni quita permisos: es solo una guía. El perfil del asistente lo fija la base según el rol funcional real.
 * Si 0025 no está aplicada, el asistente simplemente no aparece.
 * Depende de: config.js, core/render.js, core/preferencias.js (detalle del rol), api.js.
 */
const Bienvenida = (() => {
  const MODAL = 'bv-modal';
  let S = null;   // { perfil, tipo, ir, estado, hechos:Set, actual, pasos, roles, abierto }

  /* Dos recorridos, cada uno con tres versiones según lo que la persona hace.
       nuevo     — quien llega ahora: la bienvenida completa.
       existente — quien ya usaba el portal: solo lo que cambió («Novedades»).
     `ir` es la pantalla a la que lleva el paso; `sub` abre una pestaña dentro de ella. */
  const enCuenta = k => () => { if (typeof Cuenta !== 'undefined') Cuenta.tab(k); };
  const RECORRIDOS = {
    nuevo: {
      titulo: 'Te damos la bienvenida', tarjeta: 'Primeros pasos', cuenta: 'Bienvenida', repasar: 'Repasa los primeros pasos.',
      pasos: {
        miembro: [
          { id: 'rol', t: 'Conoce tu rol', d: 'Tu rol dice qué se espera de ti y con qué competencias te evalúan.', cta: null },
          { id: 'cuenta', t: 'Pon tu foto y revisa tu nombre', d: 'Así el equipo te reconoce. Está en Mi cuenta → Perfil.', ir: 'cuenta', sub: enCuenta('perfil'), cta: 'Ir a Mi cuenta', auto: p => !!p.avatar_url },
          { id: 'preferencias', t: 'Cuéntanos qué rol te gustaría hacer', d: 'Ordena tus preferencias de rol. Quien reparte las tareas las tiene en cuenta; no te dan permisos ni te impiden recibir otro trabajo.', ir: 'cuenta', sub: enCuenta('rol'), cta: 'Elegir mis preferencias', auto: 'prefs' },
          { id: 'fechas', t: 'Mira tus fechas', d: 'El Calendario junta las fechas de cada período, las actividades y los plazos de tus tareas.', ir: 'calendario', cta: 'Abrir el calendario' },
          { id: 'entregas', t: 'Así se entrega un trabajo', d: 'En Entregas ves lo que te asignaron, lo empiezas, lo entregas con un enlace o una nota, y quien revisa lo aprueba o te dice qué corregir.', ir: 'trabajos', cta: 'Ir a Entregas' },
        ],
        secretario: [
          { id: 'rol', t: 'Conoce tu rol', d: 'Además de ser secretaría de tu distrito, tienes un rol en el equipo: esto es lo que se espera de él.', cta: null },
          { id: 'cuenta', t: 'Pon tu foto y revisa tu nombre', d: 'Está en Mi cuenta → Perfil.', ir: 'cuenta', sub: enCuenta('perfil'), cta: 'Ir a Mi cuenta', auto: p => !!p.avatar_url },
          { id: 'distrito', t: 'Conoce a tu distrito', d: 'En Distrito ves a las personas de tu distrito; al pulsar una se abre su perfil. Solo ves a tu distrito.', ir: 'distrito', cta: 'Abrir Distrito' },
          { id: 'tareas', t: 'Asigna tu primera tarea', d: 'En Tareas asignas trabajo a tu distrito eligiendo personas o equipos y el rol de cada una; el sistema te avisa si alguien ya está sobrecargada o no tiene habilitado el rol.', ir: 'tareas', cta: 'Ir a Tareas' },
          { id: 'seguimiento', t: 'Sigue a tu distrito', d: 'Seguimiento muestra, por rol, cómo va cada persona en todos los períodos: evaluación, resultado y tareas.', ir: 'seguimiento', cta: 'Abrir Seguimiento' },
        ],
        admin: [
          { id: 'periodos', t: 'Revisa los períodos', d: 'Define el período activo, sus fechas y qué rúbrica usa. Una gestión sin período activo deja la plataforma sin contexto.', ir: 'periodos', cta: 'Abrir Períodos' },
          { id: 'roles', t: 'Describe los roles y sus perfiles', d: 'Cada rol lleva su descripción, sus responsabilidades y su perfil de evaluación. Eso es lo que ven las personas al recibir una tarea.', ir: 'roles', cta: 'Abrir Roles y perfiles' },
          { id: 'personas', t: 'Aprueba accesos y asigna rol y distrito', d: 'En Personas apruebas los accesos nuevos y, en la pestaña Gestión de cada persona, defines su rol, su distrito y los roles que puede asumir.', ir: 'usuarios', cta: 'Abrir Personas' },
          { id: 'evaluar', t: 'Haz tu primera evaluación', d: 'Evaluar muestra los hechos de las tareas de cada persona junto al formulario. Nada se puntúa solo.', ir: 'evaluar', cta: 'Abrir Evaluar' },
          { id: 'seguimiento', t: 'Mira el seguimiento global', d: 'Seguimiento reúne todos los períodos por rol: quién va al día, quién arrastra pendientes.', ir: 'seguimiento', cta: 'Abrir Seguimiento' },
        ],
      },
    },
    existente: {
      titulo: 'Novedades del portal', tarjeta: 'Novedades', cuenta: 'Novedades del portal', repasar: 'Repasa lo que cambió.',
      pasos: {
        miembro: [
          { id: 'n-cuenta', t: 'Mi cuenta, ordenada en pestañas', d: 'Perfil, Mi rol, Seguridad y App: cada cosa en su lugar, una a la vez. Ahí también puedes elegir el fondo de tu tarjeta.', ir: 'cuenta', sub: enCuenta('perfil'), cta: 'Ver Mi cuenta' },
          { id: 'n-rol', t: 'Tu rol, con lo que se espera de él', d: 'Ahora ves la descripción, las responsabilidades y los requisitos de tu rol, y con qué competencias te evalúan.', ir: 'cuenta', sub: enCuenta('rol'), cta: 'Ver mi rol' },
          { id: 'n-pref', t: 'Elige tus preferencias de rol', d: 'Ordena los roles que te gustaría hacer y deja uno como predeterminado. Quien reparte las tareas lo tiene en cuenta; no te dan permisos ni te impiden recibir otro trabajo.', ir: 'cuenta', sub: enCuenta('rol'), cta: 'Elegir mis preferencias', auto: 'prefs' },
          { id: 'n-historial', t: 'Tu historial de todos los períodos', d: 'En Mi perfil → Períodos ves una tarjeta por PE con tu participación, el estado de tu evaluación y los hechos de tus tareas.', ir: 'perfil', sub: () => { if (typeof Perfil !== 'undefined') Perfil.tab('evolucion', document.getElementById('perfil-host')); }, cta: 'Ver mi historial' },
          { id: 'n-actividades', t: 'Actividades solo para quien corresponde', d: 'Una actividad pensada para algunas personas la ves únicamente si estás entre ellas, y te llega un aviso.', ir: 'calendario', cta: 'Abrir el calendario' },
        ],
        secretario: [
          { id: 'n-cuenta', t: 'Mi cuenta, ordenada en pestañas y con tus preferencias de rol', d: 'Perfil, Mi rol, Seguridad y App. En Mi rol eliges qué rol te gustaría hacer.', ir: 'cuenta', sub: enCuenta('rol'), cta: 'Ver Mi cuenta', auto: 'prefs' },
          { id: 'n-asignar', t: 'Nueva tarea en tres pasos', d: 'Qué, Quién (personas o equipos, con rol, preferencia y carga) y Rol y resumen. Eliges un rol por persona y el sistema te avisa de roles no habilitados, duplicados y sobrecarga antes de crear.', ir: 'tareas', cta: 'Probar Nueva tarea' },
          { id: 'n-actividades', t: 'Actividades para personas de tu distrito', d: 'Al crear una actividad eliges «Para quién»: tu distrito o solo las personas y equipos que marques. Solo ellas la ven y reciben el aviso.', ir: 'calendario', cta: 'Abrir el calendario' },
          { id: 'n-seguimiento', t: 'Seguimiento de tu distrito', d: 'Las personas de tu distrito por rol y por período: evaluación, resultado y tareas, con numerador y denominador en cada indicador.', ir: 'seguimiento', cta: 'Abrir Seguimiento' },
          { id: 'n-reportes', t: 'Reportes de tu distrito', d: 'Un cuadro entre períodos y otro por actividad, con exportación a CSV y PDF.', ir: 'reportes', cta: 'Abrir Reportes' },
        ],
        admin: [
          { id: 'n-roles', t: 'Describe cada rol', d: 'En Roles y perfiles, el lápiz de cada rol ahora tiene «Qué hace», «Responsabilidades» y «Requisitos». Lo ven las personas al recibir una tarea.', ir: 'roles', cta: 'Abrir Roles y perfiles' },
          { id: 'n-permitidos', t: 'Roles permitidos por persona', d: 'En Personas → Gestión marcas los roles que cada persona puede asumir, y ves sus preferencias (que solo informan, no conceden nada).', ir: 'usuarios', cta: 'Abrir Personas' },
          { id: 'n-asignar', t: 'Nueva tarea con rol por persona', d: 'En tres pasos y con avisos. Si asignas un rol que la persona no tiene habilitado se permite, pero queda marcado «Excepción de rol».', ir: 'tareas', cta: 'Probar Nueva tarea' },
          { id: 'n-actividades', t: 'Actividades para todo el equipo, un distrito o personas', d: 'En Configuración → Actividades, «Para quién» ahora incluye personas y equipos, y el «Tipo» da el color en el calendario.', ir: 'calendario', cta: 'Abrir Actividades' },
          { id: 'n-seguimiento', t: 'Seguimiento y reportes entre períodos', d: 'Seguimiento reúne todos los períodos por rol. En Reportes hay dos secciones nuevas: «Entre períodos» y «Por actividad».', ir: 'seguimiento', cta: 'Abrir Seguimiento' },
        ],
      },
    },
  };
  const flujo = () => RECORRIDOS[S.estado?.origen === 'existente' ? 'existente' : 'nuevo'];
  const PASOS_DE = tipo => flujo().pasos[tipo] || flujo().pasos.miembro;
  const pasosDe = () => PASOS_DE(S.tipo);
  const hechosN = () => pasosDe().filter(p => S.hechos.has(p.id)).length;
  const terminada = () => !!S.estado?.completada_en;

  async function detectar() {
    const prefs = await API.getPreferenciasRol(S.perfil.id);
    for (const p of pasosDe()) {
      if (!p.auto) continue;
      const ok = p.auto === 'prefs' ? (prefs.rows || []).length > 0 : p.auto(S.perfil);
      if (ok) S.hechos.add(p.id);
    }
  }

  async function guardar({ omitir = false, terminar = false } = {}) {
    const r = await API.guardarBienvenida({ pasos: [...S.hechos], actual: S.actual, omitir, terminar });
    if (r.ok) {
      S.estado = { ...(S.estado || {}), pasos_hechos: [...S.hechos], paso_actual: S.actual, omitida: omitir, completada_en: terminar ? (S.estado?.completada_en || new Date().toISOString()) : (S.estado?.completada_en || null) };
    }
    pintarTarjeta();
    return r;
  }

  /* ── Tarjeta de Inicio ───────────────────────────────────────────────── */
  function pintarTarjeta() {
    const slot = document.getElementById('bv-slot'); if (!slot) return;
    if (!S || !S.estado || S.estado.omitida || terminada()) { slot.innerHTML = ''; return; }
    const n = hechosN(), total = pasosDe().length;
    slot.innerHTML = `<section class="bv-tarjeta" aria-labelledby="bv-tarjeta-t">
      <div class="bv-tarjeta-txt"><h3 class="pf-h" id="bv-tarjeta-t">${escHtml(flujo().tarjeta)}</h3>
        <p>${n} de ${total} listos. ${n ? 'Sigue donde lo dejaste.' : 'Te toma unos minutos.'}</p>
        <div class="bv-barra" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${n}" aria-label="Avance de los primeros pasos"><i style="width:${total ? Math.round(n / total * 100) : 0}%"></i></div></div>
      <button type="button" class="btn-save" data-act="bvAbrir">Continuar</button>
    </section>`;
  }

  /* ── Asistente ───────────────────────────────────────────────────────── */
  function asegurar() {
    if (document.getElementById(MODAL)) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="tk-overlay" id="${MODAL}" style="display:none" data-act="cerrarModalFondo" data-arg="${MODAL}">
        <div class="tk-box asig-box bv-box" role="document">
          <div class="modal-title" id="${MODAL}-title">Te damos la bienvenida</div>
          <div id="${MODAL}-cuerpo"></div>
        </div>
      </div>`);
  }

  function pintar() {
    const pasos = pasosDe();
    const i = Math.max(0, pasos.findIndex(p => p.id === S.actual));
    const p = pasos[i], n = hechosN(), ultimo = i === pasos.length - 1;
    let contenido = '';
    if (p.id === 'rol') {
      const r = S.roles.find(x => Number(x.id) === Number(S.perfil.rol_id));
      contenido = r
        ? `<h4 class="bv-rol-n">${escHtml(r.nombre)}</h4>${typeof Preferencias !== 'undefined' ? Preferencias.rolDetalleHTML(r, true) : ''}`
        : '<p class="cfg-hint">Todavía no tienes un rol asignado. La administración lo hará pronto; mientras tanto puedes seguir con los demás pasos.</p>';
    }
    document.getElementById(MODAL + '-cuerpo').innerHTML = `
      <div class="bv-progreso">
        <span class="bv-paso-n">Paso ${i + 1} de ${pasos.length}</span>
        <div class="bv-barra" role="progressbar" aria-valuemin="0" aria-valuemax="${pasos.length}" aria-valuenow="${n}" aria-label="Pasos hechos"><i style="width:${Math.round(n / pasos.length * 100)}%"></i></div>
        <span class="bv-hechos">${n} hecho${n === 1 ? '' : 's'}</span>
      </div>
      <ol class="bv-lista" aria-label="Pasos">${pasos.map((q, k) => `<li><button type="button" class="bv-item${k === i ? ' bv-item--on' : ''}${S.hechos.has(q.id) ? ' bv-item--hecho' : ''}" data-act="bvPaso" data-arg="${escHtml(q.id)}"${k === i ? ' aria-current="step"' : ''}>
        <span class="bv-check" aria-hidden="true">${S.hechos.has(q.id) ? '<i data-lucide="check"></i>' : k + 1}</span><span class="bv-item-t">${escHtml(q.t)}</span>${S.hechos.has(q.id) ? '<span class="sr-only"> (hecho)</span>' : ''}</button></li>`).join('')}</ol>
      <section class="bv-paso" aria-labelledby="bv-paso-t">
        <h3 class="asig-h" id="bv-paso-t">${escHtml(p.t)}</h3>
        <p class="bv-paso-d">${escHtml(p.d)}</p>
        ${contenido}
        ${p.ir ? `<button type="button" class="btn-ghost bv-ir" data-act="bvIr" data-arg="${escHtml(p.id)}">${escHtml(p.cta || 'Ir')}<i data-lucide="arrow-right" aria-hidden="true"></i></button><p class="tk-ayuda">Tu avance queda guardado: vuelves con «Continuar» en Inicio.</p>` : ''}
      </section>
      <div class="tk-modal-acciones">
        <button type="button" class="btn-save" data-act="bvHecho">${ultimo ? 'Terminar' : 'Hecho, seguir'}</button>
        <button type="button" class="tk-btn" data-act="bvAtras"${i === 0 ? ' hidden' : ''}>Atrás</button>
        <button type="button" class="tk-btn" data-act="bvOmitir">Ahora no</button>
        ${terminada() && S.estado?.origen !== 'existente' ? '<button type="button" class="btn--texto" data-act="bvReiniciar">Empezar de nuevo</button>' : ''}
      </div>`;
    if (typeof renderIconos === 'function') renderIconos(document.getElementById(MODAL));
  }

  async function abrir() {
    if (!S) return;
    asegurar();
    if (!S.actual || !pasosDe().some(p => p.id === S.actual)) S.actual = (pasosDe().find(p => !S.hechos.has(p.id)) || pasosDe()[0]).id;
    if (!S.roles.length) S.roles = await API.getRoles(true);
    // Abrirlo de nuevo es querer verlo: ya no está «omitido».
    if (S.estado?.omitida) { S.estado.omitida = false; guardar(); }
    setEl(MODAL + '-title', flujo().titulo);
    openModal(MODAL);
    pintar();
  }

  function irA(id) { S.actual = id; pintar(); guardar(); }
  async function hecho() {
    const pasos = pasosDe(), i = pasos.findIndex(p => p.id === S.actual);
    S.hechos.add(S.actual);
    if (i === pasos.length - 1) {
      S.actual = pasos[i].id;
      await guardar({ terminar: true });
      closeModal(MODAL);
      showToast(S.estado?.origen === 'existente' ? 'Listo: ya conoces las novedades.' : 'Listo: terminaste los primeros pasos.', 'ok');
      return;
    }
    S.actual = pasos[i + 1].id;
    pintar();
    guardar();
  }
  function atras() { const pasos = pasosDe(), i = pasos.findIndex(p => p.id === S.actual); if (i > 0) { S.actual = pasos[i - 1].id; pintar(); guardar(); } }
  async function omitir() {
    await guardar({ omitir: true });
    closeModal(MODAL);
    showToast(`Puedes retomar «${flujo().cuenta}» desde Mi cuenta.`, 'info');
  }
  function ir(id) {
    const p = pasosDe().find(x => x.id === id); if (!p?.ir) return;
    S.actual = id; guardar();
    closeModal(MODAL);
    S.ir?.(p.ir);
    if (p.sub) setTimeout(p.sub, 80);   // la pantalla se monta primero; después se abre su pestaña
  }
  async function reiniciar() {
    await API.reiniciarBienvenida();
    S.estado = null; S.hechos = new Set(); S.actual = null;
    await detectar();
    await guardar();
    abrir();
  }

  /** Fila de «Mi cuenta» para repasar el asistente. Vacío si 0025 no está aplicada. */
  function filaCuentaHTML() {
    if (!S) return '';
    return `<button type="button" class="fila-aj" data-act="bvAbrir">
      <div class="fila-aj-txt"><div class="fila-aj-t">${escHtml(flujo().cuenta)}</div><div class="fila-aj-d">${terminada() ? escHtml(flujo().repasar) : `Llevas ${hechosN()} de ${pasosDe().length} pasos. Retómalos.`}</div></div>
      <span class="fila-aj-ind"><i data-lucide="rocket"></i></span></button>`;
  }

  /**
   * @param {object} o
   * @param {object} o.perfil  la sesión (id, rol_id, avatar_url…)
   * @param {'miembro'|'secretario'|'admin'} o.tipo
   * @param {function} o.ir    (tab) → navega
   */
  async function iniciar({ perfil, tipo, ir }) {
    if (S && S.perfil.id === perfil.id) { pintarTarjeta(); return; }
    const r = await API.getBienvenida();
    if (!r.ok) return;   // sin 0025 (o sin sesión) no hay asistente
    S = { perfil, tipo, ir, estado: r.estado, hechos: new Set(r.estado?.pasos_hechos || []), actual: r.estado?.paso_actual || null, roles: [] };
    await detectar();
    pintarTarjeta();
    // Se abre solo UNA vez: quien llega ahora (no hay fila) o quien ya existía y aún no lo tocó (sin pasos ni paso actual).
    // Después, aunque lo deje a medias, lo retoma desde la tarjeta de Inicio o desde Mi cuenta.
    const sinTocar = r.estado && r.estado.origen === 'existente' && !r.estado.omitida && !r.estado.completada_en
      && !(r.estado.pasos_hechos || []).length && !r.estado.paso_actual;
    if (!r.estado || sinTocar) { await guardar(); abrir(); }
  }

  return { iniciar, abrir, irA, hecho, atras, omitir, ir, reiniciar, pintarTarjeta, filaCuentaHTML, disponible: () => !!S };
})();
