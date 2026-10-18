'use strict';
/**
 * EIGHT CREATORS LABs — «Cómo se compone tu evaluación»: la nota de tareas, a la vista (migraciones 0033–0035)
 * ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * Sección del perfil (Resumen) que explica de dónde sale el resultado individual de un PE con la rúbrica por roles:
 *
 *      resultado = (1 − w) · evaluación (núcleo + técnico)  +  w · nota de tareas          w = peso de las tareas en el PE
 *
 * y desglosa la nota de tareas pieza por pieza: qué tareas cuentan, cuánto pesa cada una, cuánto aporta, y por qué las
 * que no cuentan no cuentan (pendiente de revisar, vencida, anulada, no participabas…). Las tareas individuales y las del
 * grupo se distinguen siempre; una nota individual dentro de un grupo se muestra aparte de la del grupo.
 *
 * ES PRESENTACIÓN. La cifra la calcula la base (resultados_periodo() y tareas_calificacion_detalle(), la MISMA fuente que
 * leen el panel, los reportes y el seguimiento); aquí solo se pinta y se suma lo ya calculado para mostrarlo. Quién ve
 * qué lo decide la base: la persona ve lo suyo, su secretaría lo de su distrito, la administración todo.
 *
 * También ofrece el editor de las REGLAS de calificación del PE (solo administración; la base lo impone).
 *
 * Todo texto humano pasa por escHtml. Depende de: config.js, core/render.js, core/ui.js, core/tareas.js, api.js.
 */
const EvaluacionPerfil = (() => {

  const RAZON = {
    calificada:              { txt: 'Calificada', cuenta: true },
    nota_del_grupo:          { txt: 'Nota del grupo', cuenta: true },
    individual_en_grupo:     { txt: 'Nota individual dentro del grupo', cuenta: true },
    vencida_como_cero:       { txt: 'Vencida sin entregar: cuenta como 0 (regla del PE)', cuenta: true },
    pendiente_de_evaluacion: { txt: 'Entregada, esperando revisión: aún no cuenta' },
    en_curso:                { txt: 'En curso: aún no se evalúa' },
    devuelta:                { txt: 'Devuelta para corregir: aún no cuenta' },
    bloqueada:               { txt: 'Bloqueada: no cuenta' },
    vencida:                 { txt: 'Vencida sin entregar: no cuenta (regla del PE)' },
    tarea_anulada:           { txt: 'Tarea anulada: no cuenta' },
    nota_anulada:            { txt: 'Nota anulada: no cuenta' },
    sin_puntos:              { txt: 'Aprobada sin puntos: no cuenta' },
    propia_excluida:         { txt: 'Iniciativa propia: este PE no la cuenta' },
    no_participo:            { txt: 'No participabas cuando se aprobó: no cuenta' },
    no_participa:            { txt: 'Ya no participas en esta tarea' },
  };
  const TIPO = { individual: 'Individual', equipo: 'Del equipo' };
  const f1 = n => (n == null || Number.isNaN(Number(n))) ? '—' : fmtNum(Number(n), 1);
  const hora = ts => ts ? new Date(ts).toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  /** Una fila de la tabla de piezas. */
  function filaHTML(r) {
    const rz = RAZON[r.razon] || { txt: r.razon };
    const tipo = r.tipo === 'equipo'
      ? `${TIPO.equipo}${r.equipo_nombre ? ' · ' + escHtml(r.equipo_nombre) : ''}${r.individual_en_grupo ? ' <small>(nota individual; la del grupo fue ' + Number(r.nota_grupo) + ')</small>' : ''}`
      : (r.origen === 'propia' ? 'Individual · iniciativa propia' : TIPO.individual);
    return `<tr class="${r.cuenta ? '' : 'ev-no'}">
      <td class="v2-nom">${escHtml(r.titulo)}<small class="ev-tipo">${tipo}</small></td>
      <td>${r.puntos == null ? '—' : Number(r.puntos) + ' <small>/10</small>'}</td>
      <td>${r.cuenta ? f1(r.peso_efectivo) : '—'}</td>
      <td>${r.cuenta ? f1(r.aporte_pct) + ' %' : '—'}</td>
      <td class="v2-tot">${r.cuenta ? '+' + f1(r.aporte_puntos) : '—'}</td>
      <td class="ev-razon">${escHtml(rz.txt)}</td></tr>`;
  }

  /**
   * Pinta la sección en `host`.
   *   fila      : la fila de resultados_periodo() de esa persona (o null si no tiene evaluación publicada)
   *   propio    : true si es la persona mirando lo suyo (cambia el tratamiento: «tu»/«su»)
   */
  async function montar(host, { periodo, personaId, fila = null, propio = true }) {
    if (!host || !periodo) return;
    const [d, c] = await Promise.all([API.getCalifDetalle(periodo.id, personaId), API.getCalifConfig(periodo.id)]);
    if (!d.ok) { host.innerHTML = d.noDisponible ? '' : `<p class="pf-vacio" role="alert">No se pudo cargar el desglose de tareas: ${escHtml(d.error)}</p>`; return; }
    const cfg = c.ok ? c.config : null;
    const T = propio ? { tu: 'tu', Tu: 'Tu', ten: 'tienes' } : { tu: 'su', Tu: 'Su', ten: 'tiene' };
    const filas = d.filas;
    const cuentan = filas.filter(r => r.cuenta);
    const pendientes = filas.filter(r => r.razon === 'pendiente_de_evaluacion');
    const w = fila?.peso_tareas ?? 0;                      // lo que ya aplicó la base a esta persona
    const wPE = cfg ? cfg.peso_tareas : 0;
    const minimo = cfg ? cfg.minimo_tareas : 1;
    const sinFila = !fila;
    const suma = cuentan.reduce((a, r) => a + (r.aporte_puntos || 0), 0);

    let resumen;
    if (!filas.length) {
      resumen = `<p class="pf-vacio">${T.Tu} no ${T.ten} tareas en este período todavía. ${wPE > 0 ? `En este PE las tareas pesan <b>${f1(wPE)} %</b> del resultado cuando hay suficientes calificadas.` : ''}</p>`;
    } else {
      const nota = cuentan.length >= minimo ? suma : null;
      resumen = `
        <div class="ev-formula" role="group" aria-label="Composición del resultado">
          <div class="ev-pieza"><span class="ev-pieza-l">Evaluación</span><b>${sinFila ? '—' : f1(fila.individual_eval)}</b><small>núcleo y técnico · ${f1(100 - w)} %</small></div>
          <span class="ev-op" aria-hidden="true">+</span>
          <div class="ev-pieza"><span class="ev-pieza-l">Tareas</span><b>${nota == null ? '—' : f1(nota)}</b><small>${nota == null ? `faltan tareas calificadas (mínimo ${minimo})` : `${cuentan.length} tarea${cuentan.length === 1 ? '' : 's'} · ${f1(w || wPE)} %`}</small></div>
          <span class="ev-op" aria-hidden="true">=</span>
          <div class="ev-pieza ev-pieza--res"><span class="ev-pieza-l">Resultado individual</span><b>${sinFila ? '—' : f1(fila.individual)}</b><small>${sinFila ? 'aún sin evaluación publicada' : 'sobre 100'}</small></div>
        </div>
        <p class="pf-nota">${sinFila
          ? `Estas tareas ya están calificadas, pero el resultado se calcula cuando se publica la evaluación del período.`
          : (fila.tareas == null
              ? `Todavía no hay suficientes tareas calificadas (mínimo ${minimo}): el resultado es solo la evaluación, sin restar nada por las tareas pendientes.`
              : `Resultado = ${f1(100 - w)} % evaluación + ${f1(w)} % nota de tareas. Cada tarea que cuenta pesa según su ponderación; una tarea pendiente de revisar no baja la nota.`)}</p>`;
    }

    const tabla = filas.length ? `
      <div class="v2-tabla-wrap"><table class="v2-tabla ev-tabla">
        <caption class="sr-only">Tareas del período y cómo contribuyen a la nota de tareas</caption>
        <thead><tr><th scope="col">Tarea</th><th scope="col">Nota</th><th scope="col">Peso</th><th scope="col">Aporta</th><th scope="col">Puntos</th><th scope="col">Estado</th></tr></thead>
        <tbody>${filas.map(filaHTML).join('')}</tbody>
        ${cuentan.length ? `<tfoot><tr><th scope="row" colspan="4">Nota de tareas</th><td class="v2-tot">${cuentan.length >= minimo ? f1(suma) : '—'}</td><td></td></tr></tfoot>` : ''}
      </table></div>
      <p class="ev-nota-formula">Nota de tareas = 100 × Σ(peso × nota ÷ 10) ÷ Σ(pesos) de las tareas que cuentan. El peso de cada tarea es el que se le dio al asignarla o aprobarla${cfg ? `, multiplicado por ${f1(cfg.mult_individual)} (individuales) o ${f1(cfg.mult_colectiva)} (del equipo)` : ''}.</p>
      ${pendientes.length ? `<p class="pf-nota"><b>${pendientes.length}</b> tarea${pendientes.length === 1 ? '' : 's'} pendiente${pendientes.length === 1 ? '' : 's'} de evaluación: se sumarán cuando se aprueben.</p>` : ''}` : '';

    const aviso = cfg && !cfg.confirmado && cfg.definida && !propio
      ? `<p class="pf-nota ev-aviso" role="status"><b>Reglas sin confirmar:</b> el peso de las tareas (${f1(wPE)} %) es el valor inicial del sistema. Confírmalo en Equipos → Reglas de calificación.</p>` : '';

    host.innerHTML = `
      <div class="pf-card-cab"><h3 class="pf-h" id="${host.id}-h">Cómo se compone ${T.tu} evaluación</h3></div>
      ${resumen}${tabla}${aviso}
      <details class="v2-det ev-hist"><summary>Historial de notas de tareas</summary><div data-hist><p class="pf-vacio">Cargando…</p></div></details>`;
    const det = host.querySelector('.ev-hist');
    det?.addEventListener('toggle', async () => {
      if (!det.open || det.dataset.cargado) return;
      det.dataset.cargado = '1';
      const r = await API.getHistorialNotasPersona(periodo.id, personaId);
      const cont = det.querySelector('[data-hist]');
      const ACC = { calificada: 'Calificada', corregida: 'Nota corregida', anulada: 'Nota anulada', restaurada: 'Nota restaurada', reabierta: 'Reabierta', tarea_anulada: 'Tarea anulada', individual: 'Nota individual', individual_retirada: 'Nota individual retirada' };
      if (!r.ok) { cont.innerHTML = `<p class="pf-vacio" role="alert">${escHtml(r.error)}</p>`; return; }
      cont.innerHTML = r.filas.length
        ? `<ul class="eq-hist">${r.filas.map(h => `<li><span class="eq-hist-f">${escHtml(hora(h.created_at))}</span> <b>${escHtml(h.contexto?.titulo || 'Tarea')}</b> · ${escHtml(ACC[h.accion] || h.accion)}${h.puntos_anterior != null || h.puntos_nuevo != null ? ` · ${h.puntos_anterior ?? '—'} → ${h.puntos_nuevo ?? '—'}` : ''}${h.motivo ? ' — ' + escHtml(h.motivo) : ''}</li>`).join('')}</ul>`
        : '<p class="pf-vacio">Sin movimientos de notas.</p>';
    });
  }

  /* ══ REGLAS DE CALIFICACIÓN DEL PE (solo administración) ═══════════════ */
  async function montarReglas(host, { periodo, editable = false, onCambio = null }) {
    if (!host || !periodo) return;
    if (!(typeof esPeriodoV2 === 'function' ? esPeriodoV2(periodo) : periodo.modelo === 'v2')) { host.innerHTML = ''; return; }
    const r = await API.getCalifConfig(periodo.id);
    if (!r.ok) { host.innerHTML = r.noDisponible ? '' : `<p class="pf-vacio" role="alert">${escHtml(r.error)}</p>`; return; }
    const c = r.config;
    if (!c) { host.innerHTML = ''; return; }
    const si = b => (b ? 'Sí' : 'No');
    const abierto = !c.confirmado ? ' open' : '';
    host.innerHTML = `
      <details class="pf-card ev-reglas"${abierto}>
        <summary class="ev-reglas-sum"><span class="pf-h" id="${host.id}-h">Reglas de calificación de tareas · ${escHtml(periodo.pe || periodo.nombre)}</span>
          <span class="etiqueta ${c.confirmado ? 'etq-verde' : 'etq-ambar'}">${c.confirmado ? 'Confirmadas' : 'Sin confirmar'}</span>
          <span class="ev-reglas-res">Tareas: <b>${f1(c.peso_tareas)} %</b> del resultado</span></summary>
        ${editable && !document.body.classList.contains('gestion-archivada') ? `<p class="ev-reglas-acc"><button type="button" class="tk-btn" data-act="evReglas">Editar reglas</button></p>` : ''}
        ${c.confirmado ? '' : `<p class="pf-nota ev-aviso" role="status"><b>Valor inicial, sin confirmar.</b> ${c.peso_tareas > 0 ? 'Este PE nació con las tareas pesando ' + f1(c.peso_tareas) + ' %.' : 'En este PE las tareas todavía no pesan en el resultado.'} Revísalo y guárdalo para confirmarlo.</p>`}
        <dl class="ev-dl">
          <div><dt>Peso de las tareas en el resultado</dt><dd><b>${f1(c.peso_tareas)} %</b><small>el resto, ${f1(100 - c.peso_tareas)} %, es la evaluación (núcleo y técnico)</small></dd></div>
          <div><dt>Tareas individuales</dt><dd><b>× ${f1(c.mult_individual)}</b><small>multiplicador de su peso</small></dd></div>
          <div><dt>Tareas del equipo</dt><dd><b>× ${f1(c.mult_colectiva)}</b><small>multiplicador de su peso</small></dd></div>
          <div><dt>Mínimo de tareas calificadas</dt><dd><b>${Number(c.minimo_tareas)}</b><small>con menos, no se calcula nota de tareas (no se rellena con 0)</small></dd></div>
          <div><dt>¿Cuentan las iniciativas propias?</dt><dd><b>${si(c.contar_propias)}</b></dd></div>
          <div><dt>¿Las vencidas sin entregar cuentan como 0?</dt><dd><b>${si(c.vencidas_como_cero)}</b><small>regla institucional; apagada por defecto</small></dd></div>
        </dl>
        <p class="ev-nota-formula">Se calcula al consultar: crear, corregir o anular una nota cambia el resultado en todas las pantallas a la vez. Las tareas pendientes de revisar, bloqueadas o anuladas no se cuentan como 0.</p>
      </details>`;
    host._reglas = { periodo, config: c, onCambio };
  }

  function editarReglas(host) {
    const ctx = host?._reglas; if (!ctx) return;
    const { periodo, config: c } = ctx;
    const num = (id, label, valor, ayuda) => ({ id, tipo: 'texto', label, valor: String(valor), max: 6, ayuda });
    Tareas.abrirModal({
      titulo: `Reglas de calificación · ${periodo.pe || periodo.nombre}`, confirmar: 'Guardar reglas',
      campos: [
        { tipo: 'info', texto: 'Estas reglas deciden cómo las notas de las tareas entran en la evaluación de cada persona. Cambiarlas recalcula los resultados al instante; si ya hay evaluaciones publicadas, hay que explicar el motivo.' },
        num('peso', 'Peso de las tareas en el resultado (0 a 100 %)', c.peso_tareas, '0 = las tareas no cuentan; 100 = el resultado es solo la nota de tareas.'),
        num('mi', 'Multiplicador de las tareas individuales', c.mult_individual, 'Mayor que 0. Multiplica el peso que tiene cada tarea.'),
        num('mc', 'Multiplicador de las tareas del equipo', c.mult_colectiva, 'Mayor que 0. Úsalo si una tarea del equipo debe pesar más o menos que una individual.'),
        num('min', 'Mínimo de tareas calificadas', c.minimo_tareas, 'Con menos tareas calificadas que esto, la persona no tiene nota de tareas.'),
        { id: 'propias', tipo: 'select', label: '¿Cuentan las iniciativas propias?', valor: c.contar_propias ? 'si' : 'no', opciones: [{ v: 'si', l: 'Sí' }, { v: 'no', l: 'No' }] },
        { id: 'venc', tipo: 'select', label: '¿Las vencidas sin entregar cuentan como 0?', valor: c.vencidas_como_cero ? 'si' : 'no', opciones: [{ v: 'no', l: 'No (recomendado)' }, { v: 'si', l: 'Sí (regla institucional)' }] },
        { id: 'motivo', tipo: 'area', label: 'Motivo del cambio', filas: 2, max: 500, ayuda: 'Obligatorio si el PE ya tiene evaluaciones publicadas.' },
      ],
      onConfirm: async v => {
        const nueva = { peso_tareas: Number(String(v.peso).replace(',', '.')), mult_individual: Number(String(v.mi).replace(',', '.')), mult_colectiva: Number(String(v.mc).replace(',', '.')),
          minimo_tareas: Number(v.min), contar_propias: v.propias === 'si', vencidas_como_cero: v.venc === 'si' };
        if (![nueva.peso_tareas, nueva.mult_individual, nueva.mult_colectiva, nueva.minimo_tareas].every(Number.isFinite)) return 'Revisa los números.';
        const r = await API.guardarCalifConfig(periodo.id, nueva, v.motivo || null);
        if (!r.ok) return r.error;
        showToast('Reglas guardadas', 'ok');
        await montarReglas(host, { periodo, editable: true, onCambio: ctx.onCambio });
        ctx.onCambio?.();
        return null;
      },
    });
  }

  return { montar, montarReglas, editarReglas, RAZON };
})();
