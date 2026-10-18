'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
 * EIGHT CREATORS LABs — Estadísticas de Instagram del distrito (migración 0043)
 *
 * La secretaría de cada distrito sube, para cada Período de Evaluación (PE), las siete cifras de la cuenta del distrito
 * con una captura de pantalla como prueba. La administración las ve al evaluar al distrito (Distritos → Evaluar un distrito)
 * y se le precargan en el formulario; la evaluación oficial sigue siendo solo suya.
 *
 *   EstadisticasDistrito.montarSecretaria(host, { periodo, distrito })   formulario de la secretaría
 *   EstadisticasDistrito.bloqueAdminHTML(fila) / .animarBloqueAdmin(area)  lo que ve el admin dentro de la evaluación
 *   EstadisticasDistrito.igDeFila(fila)                                   cifras como texto para los campos de la evaluación
 *
 * Reglas que NO se negocian aquí (las impone la base, 0043): una secretaría solo escribe su distrito; en una gestión
 * archivada nadie escribe; la captura es obligatoria. Esta pantalla solo ahorra el viaje de ida y vuelta: valida antes de enviar.
 * Todo dato que viene de la base pasa por escHtml(); la captura se ve con URL firmada (el bucket es privado).
 * ═══════════════════════════════════════════════════════════════════════════ */
const EstadisticasDistrito = (() => {
  /** `k` es la columna de la tabla; `ig` es la clave que usa el formulario de evaluación del admin (evaluaciones_distrito.ig_stats). */
  const CAMPOS = [
    { k: 'visualizaciones',    ig: 'visualizaciones',   label: 'Visualizaciones',    tipo: 'entero', ph: '41.937' },
    { k: 'cuentas_alcanzadas', ig: 'cuentas_alcanzadas', label: 'Cuentas alcanzadas', tipo: 'entero', ph: '9.251' },
    { k: 'visitas_perfil',     ig: 'visitas_perfil',    label: 'Visitas al perfil',  tipo: 'entero', ph: '1.325' },
    { k: 'seguidores_neto',    ig: 'seguidores',        label: 'Seguidores (neto)',  tipo: 'neto',   ph: '+125', ayuda: 'Los que ganaste menos los que perdiste. Puede ser negativo.' },
    { k: 'pct_publicaciones',  ig: 'pct_publicaciones', label: 'Publicaciones %',    tipo: 'pct',    ph: '53,7' },
    { k: 'pct_historias',      ig: 'pct_historias',     label: 'Historias %',        tipo: 'pct',    ph: '23,7' },
    { k: 'pct_reels',          ig: 'pct_reels',         label: 'Reels %',            tipo: 'pct',    ph: '22,6' },
  ];
  const TOPE = 40 * 1024 * 1024;   // misma cota que las fotos de perfil: más que eso no se intenta procesar

  const num = (v, o = {}) => new Intl.NumberFormat('es-CL', o).format(v);
  const fmt = (v, c) => {
    if (v == null || v === '') return '—';
    const n = Number(v);
    if (c.tipo === 'pct') return num(n, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' %';
    if (c.tipo === 'neto') return (n > 0 ? '+' : n < 0 ? '−' : '') + num(Math.abs(n));
    return num(n);
  };
  const fmtInput = (v, c) => v == null || v === '' ? '' : c.tipo === 'pct' ? num(Number(v), { maximumFractionDigits: 2 }) : c.tipo === 'neto' ? (Number(v) > 0 ? '+' : '') + num(Number(v)) : num(Number(v));
  /** «PE2» si el período lo trae; si no, su nombre. */
  const nombrePE = p => p?.pe || p?.nombre || '';
  const kb = b => b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const fechaHora = iso => { try { return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)); } catch { return ''; } };

  /** Lo que la persona escribió → número, o un mensaje que dice qué corregir. Acepta «41.937», «41,937», «+125», «53,7 %». */
  function leer(texto, c) {
    const t = String(texto ?? '').trim().replace(/\s+/g, '').replace(/%$/, '').replace(/[−–]/g, '-');
    if (!t) return { error: 'Falta esta cifra.' };
    if (c.tipo === 'pct') {
      let s = t;
      const iC = s.lastIndexOf(','), iP = s.lastIndexOf('.');
      if (iC >= 0 && iP >= 0) s = iC > iP ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
      else s = s.replace(',', '.');
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return { error: 'Escribe un porcentaje, por ejemplo 53,7.' };
      const n = Number(s);
      return n > 100 ? { error: 'Un porcentaje no puede pasar de 100.' } : { valor: n };
    }
    const conSigno = /^[+-]/.test(t), cuerpo = t.replace(/^[+-]/, '');
    if (c.tipo === 'entero' && conSigno) return { error: 'Aquí no puede ser negativo.' };
    if (!/^\d{1,3}([.,]\d{3})*$|^\d+$/.test(cuerpo)) return { error: 'Escribe solo números, por ejemplo 41.937.' };
    const n = Number(cuerpo.replace(/[.,]/g, ''));
    if (n > 1e9) return { error: 'Ese número es demasiado grande.' };
    return { valor: t.startsWith('-') ? -n : n };
  }

  /** Mensaje que una persona entiende; el crudo de la base queda en consola. */
  function amable(msg) {
    console.warn('[estadísticas del distrito]', msg);
    if (/row-level security|permission|42501/i.test(msg || '')) return 'No se pudo guardar: este período ya está cerrado o este distrito no es el tuyo.';
    if (/check constraint|out of range|numeric/i.test(msg || '')) return 'Una de las cifras está fuera de rango. Revísalas con tu captura.';
    if (/estadisticas_distrito|schema cache|PGRST205|42P01|Bucket not found/i.test(msg || '')) return 'Esta función todavía no está activada en la base de datos. Avisa a la administración.';
    return 'No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.';
  }

  /* ── Estado de la pantalla de la secretaría (una a la vez) ───────────────── */
  let S = null;
  const el = id => document.getElementById(id);
  const lectura = () => document.body.classList.contains('gestion-archivada');

  async function montarSecretaria(host, { periodo, distrito }) {
    if (!host) return;
    if (!periodo?.id || !distrito) {
      host.innerHTML = `<p class="pf-vacio">${!distrito ? 'No tienes un distrito asignado: pide a la administración que te asigne uno.' : 'Elige un período.'}</p>`;
      return;
    }
    // Si es el mismo distrito y período y la pantalla sigue montada, no se repinta: así no se pierde lo que se estaba escribiendo.
    if (S && S.periodo.id === periodo.id && S.distrito === distrito && S.host === host && host.isConnected && host.firstElementChild) return;
    const n = (S?.n || 0) + 1;
    S = { n, host, periodo, distrito, fila: null, nuevo: null, ocupado: false, errores: {} };
    renderCargando(host);
    const r = await API.getEstadisticasDistrito(periodo.id, distrito);
    if (!S || S.n !== n) return;   // otra pantalla se montó mientras cargaba
    if (!r.ok) {
      host.innerHTML = `<p class="pf-vacio">${escHtml(r.disponible ? 'No se pudieron cargar las estadísticas. Inténtalo de nuevo.' : 'Esta función todavía no está activada en la base de datos. Avisa a la administración.')}</p>`;
      return;
    }
    S.fila = r.data;
    pintar();
    cargarCapturaActual();
  }

  function estadoHTML() {
    const f = S.fila;
    if (!f) return `<div class="ed-estado ed-estado--falta" role="status"><i data-lucide="alert-triangle" aria-hidden="true"></i><span>Todavía no se han enviado las estadísticas de <b>${escHtml(nombrePE(S.periodo))}</b> para este distrito.</span></div>`;
    const quien = f.subido_por_nombre ? `por <b>${escHtml(f.subido_por_nombre)}</b> ` : '';
    return `<div class="ed-estado ed-estado--ok" role="status"><i data-lucide="check-circle" aria-hidden="true"></i><span>Enviadas ${quien}el ${escHtml(fechaHora(f.actualizado_en))}. Puedes corregirlas mientras el período siga abierto.</span></div>`;
  }

  function capturaHTML() {
    const n = S.nuevo, f = S.fila;
    let vista = '';
    if (n) vista = `<button type="button" class="ed-mini" data-act="estDist" data-arg="ver-nueva" aria-label="Ver la captura adjunta, más grande"><img src="${n.dataUrl}" alt="Vista previa de la captura que vas a enviar"></button>
      <p class="ed-info">Reducida de <b>${escHtml(kb(n.origBytes))}</b> a <b>${escHtml(kb(n.blob.size))}</b> (${n.ancho} × ${n.alto} px). Así se enviará.</p>`;
    else if (f) vista = `<button type="button" class="ed-mini" data-act="estDist" data-arg="ver-actual" aria-label="Ver la captura enviada, más grande"><img id="ed-img-actual" alt="Captura enviada" hidden><span class="ed-mini-cargando" id="ed-img-cargando">Cargando…</span></button>
      <p class="ed-info">Esta es la captura que enviaste. Para cambiarla, adjunta otra.</p>`;
    else vista = `<p class="ed-info">Una captura de pantalla de las estadísticas de Instagram del período, donde se vean las cifras. Si pesa mucho, se reduce sola antes de enviarse.</p>`;
    const err = S.errores.captura ? `<p class="ed-err" id="ed-err-captura" role="alert">${escHtml(S.errores.captura)}</p>` : '';
    return `<div class="ed-captura">
      <div class="ed-captura-cab"><span class="ed-lbl">Captura de prueba <span class="ed-req">(obligatoria)</span></span></div>
      ${vista}
      <input type="file" id="ed-archivo" class="sr-only" accept="image/*" data-change="estDistArchivo" tabindex="-1"${S.errores.captura ? ' aria-describedby="ed-err-captura"' : ''}>
      <button type="button" class="btn-out ed-adjuntar" data-act="estDist" data-arg="elegir"${lectura() ? ' disabled' : ''}><i data-lucide="upload" aria-hidden="true"></i>${n || f ? 'Cambiar la captura' : 'Adjuntar captura'}</button>
      ${err}
    </div>`;
  }

  function pintar() {
    if (!S) return;
    const f = S.fila || {};
    const ro = lectura();
    const campos = CAMPOS.map(c => {
      const err = S.errores[c.k];
      return `<div class="ed-campo">
        <label class="ed-lbl" for="ed-${c.k}">${escHtml(c.label)}</label>
        <input class="cfg-inp ed-inp${err ? ' ed-inp--mal' : ''}" id="ed-${c.k}" type="text" inputmode="${c.tipo === 'pct' ? 'decimal' : 'numeric'}" autocomplete="off"
          placeholder="${escHtml(c.ph)}" value="${escHtml(S.valores?.[c.k] ?? fmtInput(f[c.k], c))}" data-input="estDistCampo" data-k="${c.k}"
          ${err ? `aria-invalid="true" aria-describedby="ed-err-${c.k}"` : ''}${ro ? ' disabled' : ''}>
        ${c.ayuda ? `<span class="ed-ayuda">${escHtml(c.ayuda)}</span>` : ''}
        ${err ? `<span class="ed-err" id="ed-err-${c.k}" role="alert">${escHtml(err)}</span>` : ''}
      </div>`;
    }).join('');
    S.host.innerHTML = `<section class="ed" aria-labelledby="ed-t">
      <h2 class="pf-h" id="ed-t">Estadísticas de Instagram del distrito</h2>
      <p class="ed-sub">Distrito <b>${escHtml(S.distrito)}</b> · <b>${escHtml(nombrePE(S.periodo))}</b>. Escribe las cifras de la cuenta del distrito y adjunta una captura de pantalla como prueba. La administración las usa para evaluar al distrito.</p>
      ${estadoHTML()}
      ${ro ? '<p class="ed-aviso" role="status">Esta gestión está archivada: solo puedes consultar lo enviado.</p>' : ''}
      <div class="ed-grid">${campos}</div>
      <p class="ed-aviso" id="ed-aviso-pct" role="status" hidden></p>
      ${capturaHTML()}
      <div class="ed-acciones">
        <button type="button" class="btn-save" data-act="estDist" data-arg="guardar"${ro || S.ocupado ? ' disabled' : ''}>${S.ocupado ? 'Enviando…' : S.fila ? 'Guardar cambios' : 'Enviar estadísticas'}</button>
      </div>
    </section>`;
    renderIconos(S.host);
    avisarPorcentajes();
  }

  async function cargarCapturaActual() {
    if (!S?.fila?.captura_path || S.nuevo) return;
    const n = S.n, url = await API.urlCapturaDistrito(S.fila.captura_path);
    if (!S || S.n !== n) return;
    const img = el('ed-img-actual'), cargando = el('ed-img-cargando');
    if (img && url) { img.src = url; img.hidden = false; S.urlActual = url; }
    if (cargando) cargando.textContent = url ? '' : 'No se pudo cargar la captura';
    if (cargando && url) cargando.remove();
  }

  /** Los tres porcentajes son partes de un mismo total: si no suman ~100 se avisa (no se bloquea: IG redondea). */
  function avisarPorcentajes() {
    const a = el('ed-aviso-pct'); if (!a) return;
    const vs = ['pct_publicaciones', 'pct_historias', 'pct_reels'].map(k => leer(el('ed-' + k)?.value, CAMPOS.find(c => c.k === k)));
    if (vs.some(v => v.error)) { a.hidden = true; return; }
    const suma = vs.reduce((t, v) => t + v.valor, 0);
    if (Math.abs(suma - 100) > 1.5) { a.textContent = `Los tres porcentajes suman ${num(suma, { maximumFractionDigits: 1 })} %, y deberían rondar 100 %. Revisa que coincidan con tu captura.`; a.hidden = false; }
    else a.hidden = true;
  }

  function campo(elInput) {
    if (!S) return;
    S.valores = S.valores || {};
    S.valores[elInput.dataset.k] = elInput.value;
    if (S.errores[elInput.dataset.k]) {   // al corregir, el error desaparece en el acto
      delete S.errores[elInput.dataset.k];
      elInput.classList.remove('ed-inp--mal'); elInput.removeAttribute('aria-invalid');
      el('ed-err-' + elInput.dataset.k)?.remove();
    }
    avisarPorcentajes();
  }

  async function archivo(input) {
    const f = input.files?.[0];
    if (!f || !S) return;
    if (!esArchivoImagen(f)) { showToast('Elige un archivo de imagen.', 'error'); input.value = ''; return; }
    if (f.size > TOPE) { showToast('Esa imagen pesa demasiado para procesarla (más de 40 MB). Prueba con otra.', 'error'); input.value = ''; return; }
    guardarValores();
    showToast('Reduciendo la captura…', 'info');
    try {
      const r = await reducirCaptura(f);
      const dataUrl = await new Promise((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ko(new Error('No se pudo leer la imagen.')); fr.readAsDataURL(r.blob); });
      S.nuevo = { blob: r.blob, ancho: r.ancho, alto: r.alto, origBytes: f.size, dataUrl };
      delete S.errores.captura;
    } catch (e) {
      showToast(e.message || 'No se pudo leer esa imagen. Prueba con JPG o PNG.', 'error');
      input.value = '';
      return;
    }
    pintar();
  }

  function guardarValores() {
    S.valores = S.valores || {};
    for (const c of CAMPOS) { const i = el('ed-' + c.k); if (i) S.valores[c.k] = i.value; }
  }

  async function guardar() {
    if (!S || S.ocupado || lectura()) return;
    guardarValores();
    S.errores = {};
    const cifras = {};
    for (const c of CAMPOS) {
      const r = leer(S.valores[c.k], c);
      if (r.error) S.errores[c.k] = r.error; else cifras[c.k] = r.valor;
    }
    if (!S.nuevo && !S.fila?.captura_path) S.errores.captura = 'Adjunta la captura de prueba.';
    if (Object.keys(S.errores).length) {
      pintar();
      const primero = Object.keys(S.errores)[0];
      (primero === 'captura' ? S.host.querySelector('.ed-adjuntar') : el('ed-' + primero))?.focus();
      showToast('Revisa lo marcado: faltan datos o hay cifras que no se entienden.', 'error');
      return;
    }
    S.ocupado = true; pintar();
    const n = S.n, previa = S.fila?.captura_path || null;
    let path = previa, subida = null;
    try {
      if (S.nuevo) {
        const up = await API.subirCapturaDistrito(S.distrito, S.periodo.id, S.nuevo.blob);
        if (!up.ok) throw new Error(up.error || 'No se pudo subir la captura.');
        path = subida = up.path;
      }
      const res = await API.guardarEstadisticasDistrito({ periodo_id: S.periodo.id, distrito_id: S.distrito, cifras, captura_path: path });
      if (!res.ok) throw new Error(res.error || 'No se pudo guardar.');
      if (!S || S.n !== n) return;
      if (subida && previa && previa !== subida) API.borrarCapturaDistrito(previa);   // la anterior ya no sirve
      S.fila = res.data; S.nuevo = null; S.valores = null; S.ocupado = false;
      pintar(); cargarCapturaActual();
      showToast('Estadísticas enviadas. Gracias.', 'ok');
    } catch (e) {
      if (subida) API.borrarCapturaDistrito(subida);   // no dejar una captura huérfana si la fila no se guardó
      if (S && S.n === n) { S.ocupado = false; pintar(); }
      showToast(amable(e.message), 'error');
    }
  }

  /* ── Visor de la captura (la secretaría y el admin) ───────────────────────── */
  let _visorFoco = null;
  function abrirVisor(src, titulo) {
    if (!src) { showToast('La captura no está disponible todavía.', 'error'); return; }
    cerrarVisor();
    _visorFoco = document.activeElement;
    const v = document.createElement('div');
    v.className = 'ed-visor'; v.id = 'ed-visor';
    v.setAttribute('role', 'dialog'); v.setAttribute('aria-modal', 'true'); v.setAttribute('aria-label', titulo || 'Captura de prueba');
    v.innerHTML = `<div class="ed-visor-caja"><button type="button" class="btn-icon ed-visor-x" data-act="estDist" data-arg="cerrar-visor" aria-label="Cerrar"><i data-lucide="x" aria-hidden="true"></i></button><img src="${escHtml(src)}" alt="${escHtml(titulo || 'Captura de prueba')}"></div>`;
    v.addEventListener('click', e => { if (e.target === v) cerrarVisor(); });
    document.body.appendChild(v);
    renderIconos(v);
    v.querySelector('.ed-visor-x')?.focus();
    document.addEventListener('keydown', _teclaVisor);
  }
  function _teclaVisor(e) {
    if (e.key === 'Escape') { e.preventDefault(); cerrarVisor(); }
    else if (e.key === 'Tab') { e.preventDefault(); document.querySelector('#ed-visor .ed-visor-x')?.focus(); }   // un solo control: el foco no se escapa
  }
  function cerrarVisor() {
    document.getElementById('ed-visor')?.remove();
    document.removeEventListener('keydown', _teclaVisor);
    try { _visorFoco?.focus?.(); } catch { /* el elemento ya no existe */ }
    _visorFoco = null;
  }

  async function accion(a, elemento) {
    if (a === 'guardar') return guardar();
    if (a === 'elegir') { if (!lectura()) el('ed-archivo')?.click(); return; }
    if (a === 'ver-nueva') return abrirVisor(S?.nuevo?.dataUrl, 'Captura que vas a enviar');
    if (a === 'ver-actual') return abrirVisor(S?.urlActual || await API.urlCapturaDistrito(S?.fila?.captura_path), 'Captura enviada');
    if (a === 'cerrar-visor') return cerrarVisor();
    if (a === 'ver-admin') return abrirVisor(await API.urlCapturaDistrito(elemento?.dataset?.path), 'Captura de prueba del distrito');
    if (a === 'usar-admin') return usarEnEvaluacion(elemento);
  }

  /* ── Administración ───────────────────────────────────────────────────────── */
  /** Cifras de una fila como texto, con las claves del formulario de evaluación (ig_stats). */
  function igDeFila(fila) {
    const o = {};
    if (!fila) return o;
    for (const c of CAMPOS) if (fila[c.k] != null) o[c.ig] = fmtInput(fila[c.k], c);
    return o;
  }

  function bloqueAdminHTML(fila, { disponible = true, conBoton = true } = {}) {
    if (!disponible) return `<div class="ed-admin ed-admin--vacio"><p class="pf-vacio">La carga de estadísticas por la secretaría aún no está activada en la base de datos (migración 0043).</p></div>`;
    if (!fila) return `<div class="ed-admin ed-admin--vacio"><div class="section-label">Estadísticas enviadas por la secretaría</div><p class="pf-vacio">La secretaría de este distrito todavía no las ha enviado para este período.${conBoton ? ' Puedes escribirlas tú más abajo.' : ''}</p></div>`;
    const cifras = CAMPOS.map(c => `<div class="ed-cifra"><span class="ed-cifra-l">${escHtml(c.label)}</span><span class="ed-cifra-v">${escHtml(fmt(fila[c.k], c))}</span></div>`).join('');
    return `<div class="ed-admin">
      <div class="section-label">Estadísticas enviadas por la secretaría</div>
      <p class="ed-sub">Enviadas ${fila.subido_por_nombre ? `por <b>${escHtml(fila.subido_por_nombre)}</b> ` : ''}el ${escHtml(fechaHora(fila.actualizado_en))}.</p>
      <div class="ed-admin-cuerpo">
        <button type="button" class="ed-mini ed-mini--admin" data-act="estDist" data-arg="ver-admin" data-path="${escHtml(fila.captura_path)}" aria-label="Ver la captura de prueba, más grande"><img class="ed-admin-img" alt="Captura de prueba" hidden><span class="ed-mini-cargando">Cargando…</span></button>
        <div class="ed-cifras">${cifras}</div>
      </div>
      ${conBoton ? '<div class="ed-acciones"><button type="button" class="btn-out" data-act="estDist" data-arg="usar-admin"><i data-lucide="arrow-down" aria-hidden="true"></i>Usar estas cifras en la evaluación</button></div>' : ''}
    </div>`;
  }

  /** Carga la miniatura firmada del bloque del admin (el HTML ya está en pantalla). */
  async function animarBloqueAdmin(area) {
    const btn = area?.querySelector('.ed-mini--admin'); if (!btn) return;
    const url = await API.urlCapturaDistrito(btn.dataset.path);
    const img = btn.querySelector('img'), txt = btn.querySelector('.ed-mini-cargando');
    if (img && url) { img.src = url; img.hidden = false; txt?.remove(); }
    else if (txt) txt.textContent = 'No se pudo cargar la captura';
  }

  /** Copia las cifras enviadas a los campos del formulario de evaluación (no guarda nada hasta que el admin guarde). */
  let _filaAdmin = null;
  function recordarFilaAdmin(f) { _filaAdmin = f || null; }
  function usarEnEvaluacion() {
    const ig = igDeFila(_filaAdmin);
    let n = 0;
    for (const [k, v] of Object.entries(ig)) { const i = document.getElementById('ig-' + k); if (i) { i.value = v; n++; } }
    showToast(n ? 'Cifras copiadas al formulario. Guarda la evaluación para conservarlas.' : 'No hay cifras que copiar.', n ? 'ok' : 'error');
  }

  return { CAMPOS, leer, fmt, montarSecretaria, campo, archivo, accion, igDeFila, bloqueAdminHTML, animarBloqueAdmin, recordarFilaAdmin, abrirVisor, cerrarVisor };
})();

/* Entradas del despachador (config.js: data-change / data-input con lista blanca). */
function estDistArchivo(el) { EstadisticasDistrito.archivo(el); }
function estDistCampo(el) { EstadisticasDistrito.campo(el); }
