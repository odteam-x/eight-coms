'use strict';
/**
 * EIGHT CREATORS LABs — «Pedir ayuda» (módulo «Solicito tu ayuda», migración 0068)
 * ────────────────────────────────────────────────────────────────────────────────
 * Una persona pide ayuda a un ROL; quien tiene ese rol (el principal o el segundo, 0062) la toma, la resuelve y quien pidió la confirma.
 * Mismo módulo en los tres portales. Pestañas: «Pedir ayuda» (formulario) · «Abiertas para mi rol» · «Mis pedidos» · «Las que tomé»,
 * y «Todas» para la administración y la secretaría (lo que su RLS deja ver: todo / su distrito).
 *
 * Seguridad: todo texto humano pasa por escHtml(); el enlace solo se abre si empieza por http(s) (la base lo exige también) y con
 * rel="noopener noreferrer". NO calcula permisos: la base decide qué ve y qué puede hacer cada persona (RLS + funciones SECURITY DEFINER);
 * aquí solo se muestran las acciones que la base aceptaría (`puedo_tomar`, quién pidió, quién tomó) y, si la base la rechaza, se muestra su mensaje.
 * La toma es atómica en la base: si dos personas pulsan «Tomar» a la vez gana una y la otra ve «Ya la tomó alguien más» y la lista se refresca.
 * Tiempo real: Sync.on(['apoyo'], Apoyo.cargar) repinta SOLO las listas; el formulario no se toca (no se pierde lo escrito).
 * Sin 0068 la pantalla lo dice en vez de fingir que no hay nada.
 * Depende de: config.js (escHtml, renderIconos), api.js, core/tareas.js (abrirModal), core/render.js (showToast, renderError).
 */
const Apoyo = (() => {
  const PRIORIDADES = [['baja', 'Baja'], ['normal', 'Normal'], ['alta', 'Alta'], ['urgente', 'Urgente']];
  const PRI_TXT = Object.fromEntries(PRIORIDADES);
  const PRI_CLS = { baja: 'etq-gris', normal: 'etq-azul', alta: 'etq-ambar', urgente: 'etq-rojo' };
  const ESTADO = { abierta: ['Abierta', 'etq-azul'], tomada: ['Tomada', 'etq-ambar'], resuelta: ['Resuelta', 'etq-verde'], cancelada: ['Cancelada', 'etq-gris'] };
  const TIPO_EVENTO = { creada: 'Se pidió la ayuda', tomada: 'La tomó', soltada: 'La soltó', resuelta: 'La marcó resuelta', confirmada: 'Se confirmó la resolución',
    reabierta: 'Se reabrió', cancelada: 'Se canceló', reasignada: 'La administración la asignó a' };

  const S = { el: null, yo: null, esAdmin: false, esSec: false, distrito: null, roles: [], rows: [], tab: 'pedir', estado: 'cargando', error: '', hist: {}, abierto: new Set(), enviando: false };

  const esHttp = u => /^https?:\/\/[^\s]+$/i.test(String(u || ''));
  const hoyIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fechaTxt = iso => { if (!iso) return ''; const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number); if (!a) return ''; return new Date(a, m - 1, d).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }); };
  const fechaHora = iso => { try { return new Date(iso).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  const rolNombre = id => (S.roles.find(r => String(r.id) === String(id)) || {}).nombre || 'Rol ' + id;

  /* ── Datos ─────────────────────────────────────────────────────────────────── */
  async function montar({ el, yo, esAdmin = false, esSec = false, distrito = null, roles = [] } = {}) {
    S.el = el; S.yo = yo; S.esAdmin = !!esAdmin; S.esSec = !!esSec && !esAdmin; S.distrito = distrito || null;
    if (!(roles || []).length) { try { roles = await API.getRoles(true); } catch (e) { roles = []; } }
    S.roles = roles || [];
    if (!el) return;
    if (S.estado !== 'ok') { S.estado = 'cargando'; pintar(); }
    await cargar();
  }

  async function cargar() {
    const r = await API.ayudaListar();
    if (!r.ok) { S.estado = r.disponible ? 'error' : 'ausente'; S.error = r.error || ''; pintar(); return; }
    S.estado = 'ok'; S.rows = r.rows;
    if (S.pend) { aplicarPend(); pintar(); return; }
    if (!S.el || !S.el.querySelector('#apy-panel')) { pintar(); return; }
    pintarTabs();
    if (S.tab !== 'pedir') pintarLista();          // el formulario NO se repinta: así no se pierde lo que se está escribiendo
  }

  const mias = r => r.solicitante_id === S.yo;
  const tomadasPorMi = r => r.tomada_por === S.yo && r.estado !== 'cancelada';
  function filas(tab) {
    const rs = S.rows;
    if (tab === 'abiertas') return rs.filter(r => r.estado === 'abierta' && (r.puedo_tomar || S.esAdmin || (S.esSec && !mias(r))));
    if (tab === 'mios') return rs.filter(mias);
    if (tab === 'tomadas') return rs.filter(tomadasPorMi);
    if (tab === 'todas') return rs;
    return [];
  }
  const orden = rs => rs.slice().sort((a, b) => {
    const pa = ['urgente', 'alta', 'normal', 'baja'].indexOf(a.prioridad), pb = ['urgente', 'alta', 'normal', 'baja'].indexOf(b.prioridad);
    const ea = a.estado === 'abierta' || a.estado === 'tomada' ? 0 : 1, eb = b.estado === 'abierta' || b.estado === 'tomada' ? 0 : 1;
    return ea - eb || (ea === 0 ? pa - pb : 0) || String(b.created_at).localeCompare(String(a.created_at));
  });

  /* ── Pintado ─────────────────────────────────────────────────────────────────── */
  function tabs() {
    const t = [['pedir', 'Pedir ayuda', 0], ['abiertas', S.esAdmin ? 'Abiertas' : 'Abiertas para mi rol', filas('abiertas').length],
      ['mios', 'Mis pedidos', filas('mios').filter(r => r.estado === 'abierta' || r.estado === 'tomada' || (r.estado === 'resuelta' && !r.confirmada_en)).length],
      ['tomadas', 'Las que tomé', filas('tomadas').filter(r => r.estado === 'tomada').length]];
    if (S.esAdmin || S.esSec) t.push(['todas', S.esAdmin ? 'Todas' : 'De mi distrito', 0]);
    return t;
  }
  function tabsHTML() {
    return tabs().map(([k, etq, n]) => `<button type="button" role="tab" class="seg-btn apy-tab${S.tab === k ? ' active' : ''}" aria-selected="${S.tab === k}" data-act="apoyo" data-arg="tab" data-arg2="${k}"><span>${escHtml(etq)}</span>${n ? `<span class="apy-n" aria-label="${n} pendientes">${n > 99 ? '99+' : n}</span>` : ''}</button>`).join('');
  }
  function pintarTabs() { const c = S.el && S.el.querySelector('#apy-tabs'); if (c) c.innerHTML = tabsHTML(); }

  function pintar() {
    const el = S.el; if (!el) return;
    if (S.estado === 'cargando') { el.innerHTML = '<div class="loading-box"><span class="spin"></span></div>'; return; }
    if (S.estado === 'ausente') { el.innerHTML = '<div class="empty-box"><div class="empty-txt">«Pedir ayuda» necesita la migración 0068 en la base de datos. Aplícala en el SQL Editor y vuelve a abrir esta pantalla.</div></div>'; return; }
    if (S.estado === 'error') { renderError(el, S.error || 'No se pudieron cargar los pedidos de ayuda.', cargar); return; }
    el.innerHTML = `<div class="seg apy-tabs" id="apy-tabs" role="tablist" aria-label="Pedir ayuda">${tabsHTML()}</div><div id="apy-panel" role="tabpanel" aria-live="polite"></div>`;
    pintarPanel();
  }
  function pintarPanel() {
    const p = S.el && S.el.querySelector('#apy-panel'); if (!p) return;
    if (S.tab === 'pedir') { p.innerHTML = formHTML(); } else { p.innerHTML = '<div id="apy-lista"></div>'; pintarLista(); }
    if (typeof renderIconos === 'function') renderIconos(p);
  }

  function formHTML() {
    const roles = S.roles.filter(r => r.activo !== false);
    return `<div class="apy-form" id="apy-form" role="group" aria-labelledby="apy-h">
      <h2 class="apy-h" id="apy-h">¿Con qué necesitas ayuda?</h2>
      <p class="apy-sub">Elige el rol al que se lo pides. Le avisamos a quienes lo tienen y la primera persona que pueda la toma.</p>
      <div class="apy-campo"><label for="apy-titulo">Qué necesitas <span aria-hidden="true">*</span></label>
        <input class="cfg-inp" id="apy-titulo" type="text" maxlength="120" placeholder="Ej.: Fotos del acto cívico del viernes" autocomplete="off" required></div>
      <div class="apy-campo"><label for="apy-desc">Detalles (opcional)</label>
        <textarea class="cfg-inp" id="apy-desc" rows="4" maxlength="1000" placeholder="Qué hay que hacer, para cuándo y cualquier dato que ayude."></textarea></div>
      <div class="apy-fila">
        <div class="apy-campo"><label for="apy-rol">Se lo pides al rol <span aria-hidden="true">*</span></label>
          <select class="cfg-inp cfg-select" id="apy-rol" required><option value="">Elige un rol…</option>${roles.map(r => `<option value="${escHtml(String(r.id))}">${escHtml(r.nombre)}</option>`).join('')}</select></div>
        <div class="apy-campo"><label for="apy-pri">Prioridad</label>
          <select class="cfg-inp cfg-select" id="apy-pri">${PRIORIDADES.map(([v, l]) => `<option value="${v}"${v === 'normal' ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="apy-campo"><label for="apy-fecha">Fecha límite (opcional)</label>
          <input class="cfg-inp" id="apy-fecha" type="date" min="${hoyIso()}"></div>
      </div>
      <div class="apy-campo"><label for="apy-enlace">Enlace de apoyo (opcional)</label>
        <input class="cfg-inp" id="apy-enlace" type="url" maxlength="1000" placeholder="https://drive.google.com/…" autocomplete="off">
        <small class="tk-ayuda">Una carpeta, un documento o un mensaje con más contexto. Debe empezar por http:// o https://.</small></div>
      <fieldset class="apy-alcance"><legend>¿A quién se lo pides?</legend>
        <label class="apy-op"><input type="radio" name="apy-alc" value="todos" checked><span>A todo el equipo<small>Cualquier persona con ese rol, de cualquier distrito.</small></span></label>
        <label class="apy-op${S.distrito ? '' : ' apy-op--off'}"><input type="radio" name="apy-alc" value="distrito"${S.distrito ? '' : ' disabled'}><span>Solo a mi distrito${S.distrito ? ' (' + escHtml(S.distrito) + ')' : ''}<small>${S.distrito ? 'Solo quienes tienen ese rol en tu distrito.' : 'Tu cuenta no tiene distrito asignado.'}</small></span></label>
      </fieldset>
      <p class="apy-err" id="apy-err" role="alert"></p>
      <div class="apy-acc"><button type="button" class="btn-save" id="apy-enviar" data-act="apoyo" data-arg="enviar"><i data-lucide="send"></i>Pedir ayuda</button></div>
    </div>`;
  }

  function vacioHTML(tab) {
    const m = {
      abiertas: ['Ahora no hay pedidos abiertos para tu rol.', 'Cuando alguien pida ayuda a tu rol aparecerá aquí y te avisaremos en la campana.'],
      mios: ['Todavía no has pedido ayuda.', 'Usa «Pedir ayuda» para pedírsela a un rol. Aquí verás cómo avanza cada pedido.'],
      tomadas: ['No tienes pedidos tomados.', 'Mira «Abiertas para mi rol»: ahí están los pedidos que puedes tomar.'],
      todas: ['Todavía no hay pedidos de ayuda.', S.esAdmin ? 'Aquí verás todos los pedidos del equipo.' : 'Aquí verás los pedidos de tu distrito.'],
    }[tab] || ['Nada por aquí.', ''];
    return `<div class="empty-box apy-vacio"><div class="empty-txt"><strong>${m[0]}</strong><br>${m[1]}</div>
      ${tab === 'mios' || tab === 'abiertas' ? `<button type="button" class="${tab === 'mios' ? 'btn-save' : 'btn--secundario'}" data-act="apoyo" data-arg="tab" data-arg2="${tab === 'mios' ? 'pedir' : 'mios'}">${tab === 'mios' ? 'Pedir ayuda' : 'Ver mis pedidos'}</button>` : ''}</div>`;
  }

  function accionesHTML(r) {
    const id = escHtml(String(r.id)), a = (arg, txt, cls = 'btn--secundario') => `<button type="button" class="${cls}" data-act="apoyo" data-arg="${arg}" data-arg2="${id}">${txt}</button>`;
    const out = [];
    if (r.estado === 'abierta' && r.puedo_tomar) out.push(a('tomar', 'Tomar', 'btn-save'));
    if (r.estado === 'tomada' && r.tomada_por === S.yo) { out.push(a('resolver', 'Marcar resuelta', 'btn-save')); out.push(a('soltar', 'Soltar')); }
    if (r.estado === 'resuelta' && (mias(r) || S.esAdmin) && !r.confirmada_en) { out.push(a('confirmar', 'Confirmar', 'btn-save')); out.push(a('reabrir', 'Reabrir')); }
    if (S.esAdmin && (r.estado === 'abierta' || r.estado === 'tomada')) out.push(a('reasignar', 'Asignar a…'));
    if ((r.estado === 'abierta' || r.estado === 'tomada') && (mias(r) || S.esAdmin)) out.push(a('cancelar', 'Cancelar pedido', 'btn-ghost'));
    out.push(a('historial', S.abierto.has(String(r.id)) ? 'Ocultar historial' : 'Historial', 'btn-ghost'));
    return out.join('');
  }

  function filaHTML(r) {
    const [etq, cls] = ESTADO[r.estado] || [r.estado, 'etq-gris'];
    const vencida = r.fecha_limite && (r.estado === 'abierta' || r.estado === 'tomada') && String(r.fecha_limite).slice(0, 10) < hoyIso();
    const abierto = S.abierto.has(String(r.id));
    const t = escHtml(r.titulo);
    return `<li class="apy-fila-p" data-id="${escHtml(String(r.id))}">
      <div class="apy-cab">
        <h3 class="apy-t">${t}</h3>
        <span class="etiqueta ${cls}">${etq}${r.estado === 'resuelta' && r.confirmada_en ? ' y confirmada' : ''}</span>
      </div>
      ${r.descripcion ? `<p class="apy-d">${escHtml(r.descripcion)}</p>` : ''}
      <div class="apy-meta">
        <span class="etiqueta etq-gris">Para: ${escHtml(r.rol_nombre || rolNombre(r.rol_id))}</span>
        <span class="etiqueta etq-gris">${r.alcance === 'distrito' ? 'Distrito ' + escHtml(r.distrito || '') : 'Todo el equipo'}</span>
        <span class="etiqueta ${PRI_CLS[r.prioridad] || 'etq-gris'}">Prioridad ${escHtml((PRI_TXT[r.prioridad] || r.prioridad).toLowerCase())}</span>
        ${r.fecha_limite ? `<span class="apy-peq${vencida ? ' apy-venc' : ''}">${vencida ? 'Venció el ' : 'Para el '}${escHtml(fechaTxt(r.fecha_limite))}</span>` : ''}
      </div>
      <p class="apy-quien">${mias(r) ? 'Lo pediste tú' : 'Lo pidió ' + escHtml(r.solicitante_nombre || 'alguien')}${r.tomada_nombre ? ' · lo tomó ' + (r.tomada_por === S.yo ? 'tú' : escHtml(r.tomada_nombre)) : ''} · ${escHtml(fechaHora(r.created_at))}</p>
      ${esHttp(r.enlace) ? `<p class="apy-enlace"><a href="${escHtml(r.enlace)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir el enlace de apoyo de ${t} (se abre en otra pestaña)">Abrir el enlace de apoyo</a></p>` : ''}
      <div class="apy-acc">${accionesHTML(r)}</div>
      ${abierto ? `<div class="apy-hist" id="apy-h-${escHtml(String(r.id))}">${histHTML(S.hist[String(r.id)])}</div>` : ''}
    </li>`;
  }
  function histHTML(h) {
    if (!h) return '<p class="apy-peq">Cargando…</p>';
    if (!h.length) return '<p class="apy-peq">Sin movimientos.</p>';
    return `<ol class="apy-linea">${h.map(e => `<li><span class="apy-peq">${escHtml(fechaHora(e.created_at))}</span> ${escHtml(TIPO_EVENTO[e.tipo] || e.tipo)}${e.tipo === 'reasignada' || e.tipo === 'tomada' ? ' ' + escHtml(e.persona_nombre || '') : (e.actor_nombre ? ' · ' + escHtml(e.actor_nombre) : '')}${e.nota ? `<span class="apy-nota">«${escHtml(e.nota)}»</span>` : ''}</li>`).join('')}</ol>`;
  }

  function pintarLista() {
    const c = S.el && S.el.querySelector('#apy-lista'); if (!c) return;
    const lista = orden(filas(S.tab));
    c.innerHTML = lista.length ? `<ul class="lista-aj apy-lista">${lista.map(filaHTML).join('')}</ul>` : vacioHTML(S.tab);
    if (typeof renderIconos === 'function') renderIconos(c);
  }

  /* ── Acciones ────────────────────────────────────────────────────────────────── */
  async function llamar(fn, ok) {
    const r = await fn();
    if (!r.ok) {
      showToast(r.error || 'No se pudo completar la acción.', 'error');
      await cargar();                       // p. ej. «Ya la tomó alguien más»: la lista se pone al día
      return false;
    }
    if (ok) showToast(ok, 'ok');
    await cargar();
    return true;
  }
  function conNota({ titulo, confirmar, texto, req, ph, etq, fn, ok }) {
    Tareas.abrirModal({
      titulo, confirmar,
      campos: [{ id: 'i', tipo: 'info', texto }, { id: 'nota', tipo: 'area', label: etq, req, ph, max: 500, filas: 3 }],
      onConfirm: async v => {
        if (req && (v.nota || '').trim().length < 3) return 'Escribe al menos una frase.';
        const r = await fn((v.nota || '').trim());
        if (!r.ok) { await cargar(); return r.error || 'No se pudo completar la acción.'; }
        showToast(ok, 'ok'); await cargar(); return null;
      },
    });
  }

  async function accion(a, id, el) {
    if (a === 'tab') { S.tab = id; pintarTabs(); pintarPanel(); return; }
    if (a === 'enviar') return enviar();
    const r = S.rows.find(x => String(x.id) === String(id));
    if (a === 'tomar') return llamar(() => API.ayudaAccion('tomar', id), 'La tomaste. Le avisamos a quien la pidió.');
    if (a === 'confirmar') return llamar(() => API.ayudaAccion('confirmar', id), 'Confirmada. Gracias por cerrar el pedido.');
    if (a === 'resolver' && r) return conNota({ titulo: 'Marcar como resuelta', confirmar: 'Marcar resuelta', texto: 'Quien pidió la ayuda recibirá un aviso y confirmará si quedó bien o la reabrirá.',
      etq: 'Nota (opcional)', ph: 'Qué hiciste o dónde está lo que entregaste.', fn: n => API.ayudaAccion('resolver', id, n), ok: 'Marcada como resuelta. Le avisamos a quien la pidió.' });
    if (a === 'soltar' && r) return conNota({ titulo: 'Soltar el pedido', confirmar: 'Soltar', texto: 'El pedido vuelve a quedar abierto para que otra persona con ese rol lo tome.',
      etq: 'Motivo (opcional)', ph: 'Por qué no puedes seguir.', fn: n => API.ayudaAccion('soltar', id, n), ok: 'Pedido liberado: vuelve a estar abierto.' });
    if (a === 'reabrir' && r) return conNota({ titulo: 'Reabrir el pedido', confirmar: 'Reabrir', texto: 'Vuelve a quien te ayudó para que lo retome.',
      etq: 'Qué falta', req: true, ph: 'Cuenta en una frase qué falta o qué corregir.', fn: n => API.ayudaAccion('reabrir', id, n), ok: 'Pedido reabierto. Se lo avisamos a quien te ayudaba.' });
    if (a === 'cancelar' && r) return conNota({ titulo: 'Cancelar el pedido', confirmar: 'Cancelar pedido', texto: 'Se cancela «' + r.titulo + '». Si alguien lo había tomado, se le avisa.',
      etq: 'Motivo (opcional)', ph: 'Por qué ya no hace falta.', fn: n => API.ayudaAccion('cancelar', id, n), ok: 'Pedido cancelado.' });
    if (a === 'reasignar' && r) {
      const c = await API.ayudaCandidatas(id);
      if (!c.ok || !c.rows.length) { showToast(c.ok ? 'Nadie más tiene ese rol todavía.' : (c.error || 'No se pudo consultar.'), 'info'); return; }
      Tareas.abrirModal({
        titulo: 'Asignar a una persona', confirmar: 'Asignar',
        campos: [{ id: 'i', tipo: 'info', texto: 'Solo se puede asignar a quien tiene el rol «' + (r.rol_nombre || rolNombre(r.rol_id)) + '».' },
          { id: 'persona', tipo: 'select', label: 'Persona', valor: c.rows[0].id, opciones: c.rows.map(p => ({ v: p.id, l: p.nombre })) },
          { id: 'nota', tipo: 'area', label: 'Nota (opcional)', max: 500, filas: 2 }],
        onConfirm: async v => {
          const x = await API.ayudaReasignar(id, v.persona, (v.nota || '').trim());
          if (!x.ok) { await cargar(); return x.error || 'No se pudo asignar.'; }
          showToast('Pedido asignado. Le avisamos a esa persona.', 'ok'); await cargar(); return null;
        },
      });
      return;
    }
    if (a === 'historial') {
      const k = String(id);
      if (S.abierto.has(k)) S.abierto.delete(k); else { S.abierto.add(k); S.hist[k] = null; }
      pintarLista();
      if (S.abierto.has(k)) { const h = await API.ayudaHistorial(id); S.hist[k] = h.ok ? h.rows : []; if (S.abierto.has(k)) pintarLista(); }
    }
  }

  async function enviar() {
    if (S.enviando) return;
    const v = id => (document.getElementById(id) || {}).value || '';
    const err = document.getElementById('apy-err'), btn = document.getElementById('apy-enviar');
    const titulo = v('apy-titulo').trim(), enlace = v('apy-enlace').trim(), rol = v('apy-rol'), fecha = v('apy-fecha');
    const alc = (document.querySelector('input[name="apy-alc"]:checked') || {}).value || 'todos';
    const falla = m => { if (err) err.textContent = m; };
    if (titulo.length < 3) return falla('Cuenta en pocas palabras qué necesitas (mínimo 3 letras).');
    if (!rol) return falla('Elige el rol al que le pides ayuda.');
    if (enlace && !esHttp(enlace)) return falla('El enlace debe empezar por http:// o https:// y no llevar espacios.');
    if (fecha && fecha < hoyIso()) return falla('La fecha límite ya pasó.');
    falla(''); S.enviando = true; if (btn) btn.disabled = true;
    const r = await API.ayudaCrear({ titulo, descripcion: v('apy-desc').trim(), rol_id: Number(rol), prioridad: v('apy-pri') || 'normal', fecha_limite: fecha || null, enlace: enlace || null, alcance: alc });
    S.enviando = false; if (btn) btn.disabled = false;
    if (!r.ok) { falla(r.error || 'No se pudo enviar el pedido.'); return; }
    showToast('Pedido enviado. Le avisamos a quienes tienen el rol «' + rolNombre(rol) + '».', 'ok');
    S.tab = 'mios'; await cargar(); pintarTabs(); pintarPanel();
  }

  /** Abridor de avisos (#ir/apoyo/ayuda/<id>): va a la pestaña donde está ese pedido y despliega su historial. */
  function aplicarPend() {
    const id = S.pend; S.pend = null;
    const r = S.rows.find(x => String(x.id) === String(id));
    S.tab = !r ? 'mios' : mias(r) ? 'mios' : tomadasPorMi(r) ? 'tomadas' : r.estado === 'abierta' ? 'abiertas' : (S.esAdmin || S.esSec) ? 'todas' : 'mios';
    if (r) { S.abierto.add(String(id)); S.hist[String(id)] = null; API.ayudaHistorial(id).then(h => { S.hist[String(id)] = h.ok ? h.rows : []; pintarLista(); }); }
  }
  function abrirPedido(id) {
    S.pend = String(id);
    if (S.estado === 'ok' && S.el) { aplicarPend(); pintar(); }      // si aún carga, cargar() lo aplica al terminar
  }

  return { montar, cargar, accion, enviar, abrirPedido, _estado: S };
})();
// Los avisos de «ayuda» abren el pedido en su pestaña (core/notificaciones.js se carga después: se registra al terminar de cargar la página).
document.addEventListener('DOMContentLoaded', () => { if (typeof Notif !== 'undefined') Notif.registrarAbridor('ayuda', id => Apoyo.abrirPedido(id)); });
