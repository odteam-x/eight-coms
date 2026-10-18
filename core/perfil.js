'use strict';
/**
 * EIGHT CREATORS LABs — Perfil de persona
 * ─────────────────────────────────────────
 * UN componente para los tres portales:
 *   · modo «propio»      : miembro o secretario viendo su propio perfil.
 *   · modo «supervision» : el secretario abre a alguien de su distrito.
 *   · modo «admin»       : igual, más las pestañas y acciones que el portal
 *                          admin le añade (ver Perfil.configurar).
 *
 * Es PRESENTACIÓN. No calcula ningún score: los resultados de la rúbrica v2
 * los entrega resultados_periodo() y los de la rúbrica clásica salen de
 * calcScore() de core/render.js. Lo único «derivado» aquí es la diferencia
 * entre dos números ya calculados (variación) y el orden de los puntajes
 * (puntos más altos y más bajos). Nada puntúa ni se guarda.
 *
 * Quién ve qué lo decide RLS, no este archivo: un miembro recibe solo su
 * fila; un secretario, las de su distrito; el admin, todas. Si la base no
 * devuelve la fila, el perfil lo dice; no la reconstruye ni la rellena.
 *
 * Los dos modelos conviven: toda rama v2 empieza por esPeriodoV2(periodo).
 * Los períodos anteriores a la rúbrica por roles se muestran con su escala
 * clásica y no se mezclan con los nuevos en gráficos ni variaciones.
 *
 * Depende de: config.js, core/store.js, core/render.js, core/rubrica.js,
 * core/ui.js, core/tareas.js, core/charts.js, api.js.
 */
const Perfil = (() => {

  /* ── Estado ─────────────────────────────────────────────────────────── */
  const _inst = new Map();      // id del contenedor → instancia
  let _cfg = { modo: 'supervision', resolver: null, tabsExtra: [], acciones: [], calendario: () => null };

  const TABS = [
    { k: 'resumen',   etiqueta: 'Resumen',   icono: 'layout-grid' },
    { k: 'criterios', etiqueta: 'Criterios', icono: 'list-checks' },
    { k: 'tareas',    etiqueta: 'Tareas',    icono: 'clipboard-check' },
    { k: 'periodos',  etiqueta: 'Períodos',  icono: 'calendar-range' },
    { k: 'evolucion', etiqueta: 'Evolución', icono: 'trending-up' },
  ];

  const _fmt = (n, d = 1) => fmtNum(n, d);
  /** 0–6: qué patrón de la marca lleva la cabecera de esta persona. */
  const _patronDe = p => (typeof Fondo !== 'undefined' ? Fondo.clase(p) : [...String(p?.id || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 7);
  const _tipo = p => (p.tipo_miembro === 'secretario' ? 'Secretario' : 'Creator');

  /** Quién habla: «tu»/«tus» para uno mismo, «su»/«sus» para quien supervisa. */
  const _pos = inst => (inst.modo === 'propio' ? { tu: 'tu', Tu: 'Tu', tus: 'tus' } : { tu: 'su', Tu: 'Su', tus: 'sus' });

  /* ══ CARGA ═════════════════════════════════════════════════════════════
   * Una pasada por período: la fila de resultados (solo v2) y la evaluación
   * con puntajes y comentarios. Son pocas llamadas (un período = una fila
   * por llamada) y alimentan los cuatro paneles, la variación y la gráfica.
   * Se guarda en la instancia: cambiar de pestaña no vuelve a pedir nada.
   */
  async function _cargarSerie(inst) {
    const { persona, modo } = inst;
    const periodos = inst.periodos;
    const verBorradores = modo === 'admin';

    const items = await Promise.all(periodos.map(async periodo => {
      const v2 = esPeriodoV2(periodo);
      const [r, ev] = await Promise.all([
        v2 ? API.getResultadosV2(periodo.id, { borradores: verBorradores }) : Promise.resolve(null),
        API.getEvaluacion(periodo.id, persona.id),
      ]);
      if (r && !r.ok) return { periodo, v2, error: r.error };

      const visible = ev && (ev.estado === 'publicado' || verBorradores);
      const puntajes    = visible ? parseJSON(ev.puntajes)    : {};
      const comentarios = visible ? parseJSON(ev.comentarios) : {};
      const respuestas  = visible ? parseJSON(ev.respuestas)  : {};   // campos de registro (0020)

      if (v2) {
        const fila = (r.rows || []).find(x => x.evaluado_id === persona.id) || null;
        return { periodo, v2, fila, puntajes, comentarios, respuestas };
      }
      if (!visible) return { periodo, v2, row: null };
      const row = { evaluado_id: persona.id, ext: Number(ev.bono_ext) || 0, puntajes };
      return { periodo, v2, row, comentarios, total: calcScore(row) };
    }));

    const falla = items.find(i => i.error);
    if (falla) throw new Error(falla.error);
    inst.serie = items;
  }

  const _item = (inst, periodoId) => inst.serie.find(i => String(i.periodo.id) === String(periodoId)) || null;

  /** El período v2 con datos inmediatamente anterior al indicado. */
  function _previoV2(inst, periodoId) {
    const lista = inst.serie.filter(i => i.v2);
    const k = lista.findIndex(i => String(i.periodo.id) === String(periodoId));
    for (let j = k - 1; j >= 0; j--) if (lista[j].fila) return lista[j];
    return null;
  }
  function _previoLegacy(inst, periodoId) {
    const lista = inst.serie.filter(i => !i.v2);
    const k = lista.findIndex(i => String(i.periodo.id) === String(periodoId));
    for (let j = k - 1; j >= 0; j--) if (lista[j].row) return lista[j];
    return null;
  }

  /** Tareas de la persona en el período (solo v2): resumen y lista. */
  async function _cargarTareas(inst, periodo) {
    const clave = String(periodo.id);
    if (inst.tareas.has(clave)) return inst.tareas.get(clave);
    const [res, lista] = await Promise.all([
      API.getResumenTareas(periodo.id),
      API.getTareas({ periodoId: periodo.id, userId: inst.persona.id }),
    ]);
    const out = {
      noDisponible: !!(res.noDisponible || lista.noDisponible),
      error: (!res.ok && !res.noDisponible) ? res.error : (!lista.ok && !lista.noDisponible ? lista.error : null),
      resumen: res.ok ? (res.porUsuario[inst.persona.id] || null) : null,
      tareas: lista.ok ? lista.tareas : [],
    };
    inst.tareas.set(clave, out);
    return out;
  }


  /* ══ CABECERA ══════════════════════════════════════════════════════════ */

  function _avatarHTML(inst) {
    const p = inst.persona;
    const editable = inst.modo === 'propio' && document.getElementById('avatar-file-input');
    // El avatar (foto o predeterminado) lo resuelve Avatar; aquí solo se decide el contenedor y su accesibilidad.
    const cls = Avatar.clases(p, 'xl') + ' perfil-av';
    return editable
      ? `<button type="button" class="${cls} perfil-av--editable" data-act="cambiarAvatar"
                 aria-label="Cambiar foto de perfil" title="Cambiar foto de perfil">${Avatar.interior(p)}
           <i data-lucide="camera" class="perfil-av-cam" aria-hidden="true"></i></button>`
      : `<div class="${cls}" role="img" aria-label="Foto de ${escHtml(p.nombre || 'la persona')}">${Avatar.interior(p)}</div>`;
  }

  function _cabeceraHTML(inst, item) {
    const p = inst.persona;
    const periodo = inst.periodo;
    let chips = [];
    let anillo = anilloHTML({ valor: null, etiqueta: 'Sin evaluación publicada' }), nivel = '', delta = '';
    let leyenda = 'Sin evaluación publicada';

    if (item?.v2 && item.fila) {
      const f = item.fila;
      const perfil = perfilesV2().find(x => String(x.id) === String(f.perfil_id));
      chips = [f.rol_nombre, perfil ? `Rúbrica por roles · v${perfil.version}` : 'Rúbrica por roles'];
      if (f.individual != null) {
        const prev = _previoV2(inst, periodo.id);
        anillo = anilloHTML({ valor: f.individual, max: 100, color: scoreColorV2(f.individual),
                              etiqueta: `Individual ${_fmt(f.individual)} de 100`, decimales: 0 });
        nivel = `<span class="nivel-badge ${nivelV2(f.individual).key}">${nivelV2(f.individual).label}</span>`;
        delta = prev?.fila?.individual != null
          ? deltaHTML(f.individual, prev.fila.individual, { ref: prev.periodo.pe, unidad: ' puntos' }) : '';
        leyenda = 'Individual · sobre 100';
      }
      if (f.estado === 'borrador') chips.push('Borrador sin publicar');
    } else if (item && !item.v2 && item.row) {
      const prev = _previoLegacy(inst, periodo.id);
      chips = [p.rol_nombre, 'Rúbrica clásica'];
      anillo = anilloHTML({ valor: item.total, max: MAX_TOTAL(), color: scoreColor(item.total),
                            etiqueta: `Puntaje ${item.total} de ${MAX_TOTAL()}` });
      nivel = `<span class="nivel-badge ${scoreClass(item.total)}">${scoreLabel(item.total)}</span>`;
      delta = prev ? deltaHTML(item.total, prev.total, { ref: prev.periodo.pe, unidad: ' puntos' }) : '';
      leyenda = `Puntaje · de ${MAX_TOTAL()}`;
    } else {
      chips = [p.rol_nombre, esPeriodoV2(periodo) ? 'Rúbrica por roles' : 'Rúbrica clásica'];
    }
    chips = [...chips, p.distrito ? (/^distrito/i.test(p.distrito) ? p.distrito : `Distrito ${p.distrito}`) : '', _tipo(p)].filter(Boolean);

    const acciones = (_cfg.acciones || []).map(a => `
      <button type="button" class="perfil-accion" data-act="${escHtml(a.act)}" data-arg="${escHtml(p.id)}">
        <i data-lucide="${escHtml(a.icono || 'arrow-right')}" aria-hidden="true"></i><span>${escHtml(a.etiqueta)}</span>
      </button>`).join('');

    const H = inst.panel ? 'h3' : 'h1';   // en la página, el nombre es EL título (h1); en el panel lateral vive dentro de un diálogo
    return `
      <header class="perfil-cab sup-marca pat-${_patronDe(p)}" data-persona="${escHtml(p.id)}">
        <div class="perfil-id">
          ${_avatarHTML(inst)}
          <div class="perfil-id-txt">
            <${H} class="perfil-nombre">${escHtml(p.nombre || 'Sin nombre')}</${H}>
            <ul class="perfil-chips">${chips.map(c => `<li>${escHtml(c)}</li>`).join('')}</ul>
            ${inst.modo !== 'propio' && p.email ? `<p class="perfil-email">${escHtml(p.email)}</p>` : ''}
            ${acciones ? `<div class="perfil-acciones">${acciones}</div>` : ''}
          </div>
        </div>
        <div class="perfil-resumen">
          ${anillo}
          <div class="perfil-resumen-txt">
            <div class="perfil-leyenda">${escHtml(leyenda)}</div>
            ${nivel}
            ${delta}
          </div>
        </div>
      </header>`;
  }


  /**
   * Los paneles se escriben con los títulos que les tocan «en abstracto» (h3 de sección, h4 de subapartado). Aquí se les
   * da el nivel que les corresponde bajo el nombre de la persona (h1 en la página, h3 en el panel lateral), para que el
   * esquema del documento no salte de nivel. Se conservan clases, ids y atributos (aria-labelledby sigue funcionando).
   */
  function _niveles(inst, cuerpo) {
    const base = inst.panel ? 3 : 1;
    const mapa = [['.pf-h', base + 1], ['.pe-nombre', base + 1], ['.pf-sub', base + 2], ['.pe-sub', base + 2]];
    for (const [sel, n] of mapa) {
      const tag = 'H' + Math.min(6, n);
      cuerpo.querySelectorAll(sel).forEach(h => {
        if (!/^H[1-6]$/.test(h.tagName) || h.tagName === tag) return;
        const nuevo = document.createElement(tag);
        for (const at of h.attributes) nuevo.setAttribute(at.name, at.value);
        nuevo.append(...h.childNodes);
        h.replaceWith(nuevo);
      });
    }
  }

  /* ══ PANELES ═══════════════════════════════════════════════════════════ */

  /** Un indicador: valor que cuenta, y su variación frente al período previo. */
  function _kpiHTML(lbl, valor, sub, { color = 'var(--txt)', delta = '', max = 100 } = {}) {
    const tiene = valor != null && !Number.isNaN(Number(valor));
    return `
      <div class="pf-kpi">
        <div class="pf-kpi-lbl">${escHtml(lbl)}</div>
        <div class="pf-kpi-val">
          <span${tiene ? ` data-cuenta="${Number(valor)}" data-dec="0"` : ''}>${tiene ? _fmt(valor, 0) : '—'}</span><small>/${max}</small>
        </div>
        <div class="pf-kpi-sub">${delta || escHtml(sub || '')}</div>
      </div>`;
  }

  function _kpisV2(inst, item) {
    const f = item.fila;
    const prev = _previoV2(inst, inst.periodo.id)?.fila;
    const ref = _previoV2(inst, inst.periodo.id)?.periodo.pe;
    const d = k => (prev && prev[k] != null && f[k] != null) ? deltaHTML(f[k], prev[k], { ref, unidad: ' puntos' }) : '';
    return `<div class="pf-kpis">
      ${_kpiHTML('General', f.general, f.rol_pequeno ? '40 % núcleo + 60 % técnico' : '40 % núcleo + 60 % percentil', { color: scoreColorTxtV2(f.general), delta: d('general') })}
      ${_kpiHTML('Núcleo', f.nucleo, 'Igual para los ocho roles', { color: scoreColorTxtV2(f.nucleo), delta: d('nucleo') })}
      ${_kpiHTML('Técnico', f.tecnico, f.rol_nombre || 'Criterios del rol', { color: scoreColorTxtV2(f.tecnico), delta: d('tecnico') })}
      ${f.rol_pequeno
        ? _kpiHTML('Percentil', null, 'Rol con menos de 4 personas')
        : _kpiHTML('Percentil', f.percentil, `de ${f.n_rol} en el rol`, { color: 'var(--txt)', delta: d('percentil') })}
    </div>`;
  }

  /** Puntos más altos y más bajos: orden de lo ya puntuado, sin umbrales. */
  function _lecturaRapidaHTML(inst, item) {
    const f = item.fila;
    const perfil = perfilesV2().find(x => String(x.id) === String(f.perfil_id));
    const ap = criteriosAplicables(perfil, catalogoV2(), { conservar: Object.keys(item.puntajes || {}) });
    // Cada criterio puntúa en su propio rango (1–5, o 0 a su peso en las evaluaciones nuevas): se ordena por el
    // porcentaje dentro de ese rango, nunca por el número crudo (30 de 30 no es lo mismo que 3 de 5).
    const lista = [...ap.nucleo, ...ap.tecnicos]
      .map(c => { const r = rangoPuntajeV2(c, f.escala), v = Number(item.puntajes[c.key]); return { c, v, r, p: pctPuntajeV2(v, r) }; })
      .filter(x => item.puntajes[x.c.key] != null && Number.isFinite(x.v) && x.v >= x.r.min && x.r.max > x.r.min);
    const T = _pos(inst);
    if (lista.length < 2) {
      return `<p class="pf-vacio">Todavía no hay suficientes criterios puntuados para comparar.</p>`;
    }
    const max = Math.max(...lista.map(x => x.p)), min = Math.min(...lista.map(x => x.p));
    if (max === min) {
      return `<p class="pf-vacio">Todos los criterios están en el mismo punto de su escala (${Math.round(max)} %): no hay un punto que destaque sobre otro.</p>`;
    }
    const orden = [...lista].sort((a, b) => b.p - a.p || (b.c.peso ?? 0) - (a.c.peso ?? 0));
    const altos = orden.filter(x => x.p > min).slice(0, 3);
    const bajos = [...orden].reverse().filter(x => x.p < max && !altos.includes(x)).slice(0, 3);
    const fila = x => `
      <li class="pf-crit">
        <span class="pf-crit-n">${escHtml(x.c.nombre)}</span>
        <span class="pf-crit-v">${x.v}<small>/${x.r.max}</small></span>
        <span class="barra-track pf-crit-barra"><span class="barra-fill" style="width:${x.p}%"></span></span>
      </li>`;
    return `
      <div class="pf-dos">
        <div><h4 class="pf-sub">Puntos más altos</h4><ul class="pf-lista">${altos.map(fila).join('')}</ul></div>
        <div><h4 class="pf-sub">Donde hay más margen</h4>
          ${bajos.length ? `<ul class="pf-lista">${bajos.map(fila).join('')}</ul>` : `<p class="pf-vacio">${T.Tus} puntajes más bajos ya están entre los más altos.</p>`}
        </div>
      </div>`;
  }

  function _lugarEnRolHTML(inst, item) {
    const f = item.fila;
    const propio = inst.modo === 'propio';
    const marca = f.rol_pequeno
      ? ''
      : `<div class="pf-pos" role="img" aria-label="Percentil ${_fmt(f.percentil, 0)} de 100">
           <div class="pf-pos-pista"><span class="pf-pos-marca" style="left:${Math.max(0, Math.min(100, Number(f.percentil) || 0))}%"></span></div>
           <div class="pf-pos-esc" aria-hidden="true"><span>0</span><span>50</span><span>100</span></div>
         </div>`;
    return marca + notaRolV2HTML(f, propio);
  }

  function _tareasResumenHTML(datos) {
    if (datos.noDisponible) return '';
    if (datos.error) return `<p class="pf-vacio" role="alert">No se pudieron cargar las tareas. Vuelve a abrir esta pestaña para reintentar.</p>`;
    const r = datos.resumen;
    if (!r) return `<p class="pf-vacio">Sin tareas en este período.</p>`;
    const pct = r.con_plazo ? Math.round((r.a_tiempo / r.con_plazo) * 100) : null;
    const t = (val, lbl, aviso) => `<div class="pf-tk${aviso ? ' pf-tk--aviso' : ''}"><div class="pf-tk-val">${val}</div><div class="pf-tk-lbl">${lbl}</div></div>`;
    return `<div class="pf-tks">
      ${t(r.asignadas, 'Asignadas')}
      ${t(pct == null ? '—' : pct + ' %', 'Entregadas a tiempo')}
      ${t(r.devoluciones, 'Devoluciones')}
      ${t(r.propias_aprobadas, 'Iniciativas validadas')}
      ${r.vencidas_abiertas > 0 ? t(r.vencidas_abiertas, 'Vencidas sin entregar', true) : ''}
    </div>`;
  }

  async function _panelResumen(inst, cuerpo, seq) {
    const item = _item(inst, inst.periodo.id);
    if (item?.v2 && item.fila) {
      const datos = await _cargarTareas(inst, inst.periodo).catch(() => ({ error: 'x' }));
      if (seq !== inst.seq) return;
      const tareas = _tareasResumenHTML(datos);
      cuerpo.innerHTML = `
        ${_kpisV2(inst, item)}
        <div class="pf-grid">
          <section class="pf-card" aria-labelledby="${inst.id}-h-lectura">
            <h3 class="pf-h" id="${inst.id}-h-lectura">Lectura rápida</h3>
            ${_lecturaRapidaHTML(inst, item)}
          </section>
          <section class="pf-card" aria-labelledby="${inst.id}-h-rol">
            <h3 class="pf-h" id="${inst.id}-h-rol">${inst.modo === 'propio' ? 'Tu lugar en el rol' : 'Lugar en el rol'}</h3>
            ${_lugarEnRolHTML(inst, item)}
          </section>
          <section class="pf-card pf-card--ancha ev-seccion" id="${inst.id}-eval" aria-labelledby="${inst.id}-eval-h"></section>
          ${tareas ? `<section class="pf-card pf-card--ancha" aria-labelledby="${inst.id}-h-tareas">
            <div class="pf-card-cab"><h3 class="pf-h" id="${inst.id}-h-tareas">Tareas del período</h3>
              <button type="button" class="pf-enlace" data-act="perfilTab" data-arg="tareas">Ver todas<i data-lucide="arrow-right" aria-hidden="true"></i></button></div>
            ${tareas}
          </section>` : ''}
        </div>`;
      // 0033–0035: de dónde sale el resultado (evaluación + nota de tareas) y qué tareas cuentan.
      if (typeof EvaluacionPerfil !== 'undefined') EvaluacionPerfil.montar(document.getElementById(`${inst.id}-eval`), { periodo: inst.periodo, personaId: inst.persona.id, fila: item.fila, propio: inst.modo === 'propio' });
      return;
    }
    if (item && !item.v2 && item.row) { _panelResumenLegacy(inst, cuerpo, item); return; }
    _vacioPeriodo(inst, cuerpo, item);
  }

  /** Rúbrica clásica: puntaje, bono y nivel. No se toca su fórmula. */
  function _panelResumenLegacy(inst, cuerpo, item) {
    const prev = _previoLegacy(inst, inst.periodo.id);
    const ext = item.row.ext || 0;
    const base = item.total - ext;
    cuerpo.innerHTML = `
      <div class="pf-kpis pf-kpis--3">
        ${_kpiHTML('Puntaje', item.total, `de ${MAX_TOTAL()} con bono`, { color: scoreColorTxt(item.total), max: MAX_TOTAL(),
            delta: prev ? deltaHTML(item.total, prev.total, { ref: prev.periodo.pe, unidad: ' puntos' }) : '' })}
        ${_kpiHTML('Criterios', base, `de ${getMaxScore()} sin bono`, { max: getMaxScore() })}
        ${_kpiHTML('Bono', ext, 'Bono de excelencia', { max: 2 })}
      </div>
      <p class="pf-nota">Este período se evaluó con la <strong>rúbrica clásica</strong> (7 criterios, del 1 al 4). Sus puntajes no se comparan con los de la rúbrica por roles.</p>`;
  }

  function _vacioPeriodo(inst, cuerpo, item) {
    const pe = inst.periodo.pe;
    // Sin evaluación publicada, las tareas ya calificadas se muestran igual (resultado parcial).
    if (item?.v2 && typeof EvaluacionPerfil !== 'undefined') {
      cuerpo.innerHTML = `<section class="pf-card pf-card--ancha ev-seccion" id="${inst.id}-eval" aria-labelledby="${inst.id}-eval-h"></section>`;
      EvaluacionPerfil.montar(document.getElementById(`${inst.id}-eval`), { periodo: inst.periodo, personaId: inst.persona.id, fila: null, propio: inst.modo === 'propio' });
      return;
    }
    renderVacio(cuerpo, inst.modo === 'propio' ? `Aún no hay evaluación para ${pe}.` : `${inst.persona.nombre || 'La persona'} no tiene evaluación publicada en ${pe}.`,
                { periodo: inst.periodo, calendario: _cfg.calendario?.() });
  }

  /* ── Criterios ─────────────────────────────────────────────────────── */
  function _barraV2(c, v, previo, com, r = { min: 1, max: 5 }, rPrev = r) {
    const tiene = Number.isFinite(v) && v >= r.min;
    const hayPrev = Number.isFinite(previo) && previo >= rPrev.min;
    return `
      <div class="cbar pf-cbar">
        <div class="cbar-top">
          <div>
            ${c.peso != null ? `<div class="cbar-tag" style="color:var(--criterio-txt)">Peso ${c.peso}</div>` : ''}
            <div class="cbar-name">${escHtml(c.nombre)}</div>
          </div>
          <div class="cbar-val" style="color:var(--criterio-txt)">${tiene ? v : '—'}<span>/${r.max}</span></div>
        </div>
        <div class="cbar-track pf-track">
          <div class="cbar-fill" style="width:${tiene ? pctPuntajeV2(v, r) : 0}%;background:var(--criterio)"></div>
          ${hayPrev ? `<span class="pf-prev" style="left:${pctPuntajeV2(previo, rPrev)}%" title="Período anterior: ${previo} de ${rPrev.max}"></span>` : ''}
        </div>
        ${hayPrev ? `<div class="pf-prev-txt">Período anterior: ${previo} de ${rPrev.max}</div>` : ''}
        ${com ? `<div class="cbar-feedback"><span class="cbar-fb-txt">${escHtml(com)}</span></div>` : ''}
        <details class="v2-det"><summary>¿Cómo se puntúa?</summary>${descriptoresHTML(c)}</details>
      </div>`;
  }

  function _panelCriterios(inst, cuerpo) {
    const item = _item(inst, inst.periodo.id);
    if (item?.v2 && item.fila) {
      const f = item.fila;
      const perfil = perfilesV2().find(x => String(x.id) === String(f.perfil_id));
      const ap = criteriosAplicables(perfil, catalogoV2(), { conservar: [...Object.keys(item.puntajes || {}), ...Object.keys(item.respuestas || {})] });
      const prev = _previoV2(inst, inst.periodo.id);
      const pv = k => (prev ? Number(prev.puntajes[k]) : NaN);
      const T = _pos(inst);
      cuerpo.innerHTML = `
        <h3 class="pf-h">Núcleo transversal</h3>
        <div class="v2-bars">${ap.nucleo.map(c => _barraV2(c, Number(item.puntajes[c.key]), pv(c.key), item.comentarios?.[c.key], rangoPuntajeV2(c, f.escala), rangoPuntajeV2(c, prev?.fila?.escala))).join('')}</div>
        <h3 class="pf-h">Criterios técnicos · ${escHtml(f.rol_nombre || 'el rol')}</h3>
        <div class="v2-bars">${ap.tecnicos.map(c => _barraV2(c, Number(item.puntajes[c.key]), pv(c.key), item.comentarios?.[c.key], rangoPuntajeV2(c, f.escala), rangoPuntajeV2(c, prev?.fila?.escala))).join('')}</div>
        ${registroHTML(ap.registro, item.respuestas, item.comentarios)}
        ${ap.fuera.length ? `<p class="v2-fuera"><strong>No se evalúan ${ap.fuera.length} criterios</strong>
          (no son parte del rol y no entran al cálculo): ${escHtml(ap.fuera.map(c => c.nombre).join(' · '))}.</p>` : ''}`;
      return;
    }
    if (item && !item.v2 && item.row) {
      if (!hayCriterios()) { renderError(cuerpo, 'No se pudieron cargar los criterios de evaluación.', () => location.reload()); return; }
      const criterios = getCriterios();
      cuerpo.innerHTML = `
        ${(item.row.ext || 0) > 0 ? `<div class="bono-row"><span class="bono-badge">Bono de excelencia +${item.row.ext}</span></div>` : ''}
        <div class="v2-bars">${criterios.map(c => {
          const val = puntajeDe(item.row, c.key);
          const com = item.comentarios?.[c.key] || '';
          return `<div class="cbar">
            <div class="cbar-top"><div><div class="cbar-name">${escHtml(c.label)}</div></div>
              <div class="cbar-val" style="color:var(--criterio-txt)">${val}<span>/4</span></div></div>
            <div class="cbar-track"><div class="cbar-fill" style="width:${pctBarra(val, c)}%;background:var(--criterio)"></div></div>
            ${com ? `<div class="cbar-feedback"><span class="cbar-fb-txt">${escHtml(com)}</span></div>` : ''}
          </div>`;
        }).join('')}</div>
        ${inst.rubricaLegacy ? `<details class="rubrica-details"><summary class="rubrica-summary">¿Cómo se califica esto?</summary>
          <div class="rubrica-wrap"><p class="rubrica-intro">Cada criterio se evalúa del <strong>1 al 4</strong>. Puntaje máximo con bono: <strong>${MAX_TOTAL()} puntos</strong>.</p>
          <div class="rubrica-grid" data-rubrica-legacy></div></div></details>` : ''}`;
      inst.rubricaLegacy?.(cuerpo.querySelector('[data-rubrica-legacy]'));
      return;
    }
    _vacioPeriodo(inst, cuerpo, item);
  }

  /* ── Tareas ────────────────────────────────────────────────────────── */
  async function _panelTareas(inst, cuerpo, seq) {
    const periodo = inst.periodo;
    if (!esPeriodoV2(periodo)) {
      cuerpo.innerHTML = `<div class="empty-box"><div class="empty-txt">Este período se evaluó con la rúbrica clásica y no usa tareas asignables.
        ${inst.modo === 'propio' ? 'Tus entregas están en la pestaña Entregas.' : ''}</div></div>`;
      return;
    }
    // Quien asigna y revisa (secretario del distrito, admin) las gestiona AQUÍ,
    // sin ir a otra sección: mismas acciones, mismos permisos (los impone la base).
    if (_cfg.tareas && inst.modo !== 'propio') {
      const c = _cfg.tareas;
      await Tareas.montar({
        id: 'perfil-tareas', el: cuerpo, periodoId: periodo.id, yo: c.yo, revisor: true, esAdmin: !!c.esAdmin,
        personas: c.personas(), soloPersona: inst.persona.id,
        onCambio: () => { inst.tareas.delete(String(periodo.id)); },
        onNoDisponible: () => { cuerpo.innerHTML = '<div class="empty-box"><div class="empty-txt">Las tareas todavía no están activas en esta instalación.</div></div>'; },
      });
      if (seq === inst.seq) animarEntrada(cuerpo);
      return;
    }
    renderCargando(cuerpo);
    inst.tareas.delete(String(periodo.id));              // al abrir la pestaña se refresca
    const datos = await _cargarTareas(inst, periodo);
    if (seq !== inst.seq) return;
    if (datos.noDisponible) {
      cuerpo.innerHTML = `<div class="empty-box"><div class="empty-txt">Las tareas todavía no están activas en esta instalación.</div></div>`;
      return;
    }
    if (datos.error) { renderError(cuerpo, datos.error, () => _panelTareas(inst, cuerpo, inst.seq)); return; }
    const E = Tareas.ESTADOS;
    const lista = datos.tareas;
    cuerpo.innerHTML = `
      ${_tareasResumenHTML(datos)}
      ${lista.length ? `<ul class="pf-tareas">${lista.map(t => {
        const e = E[t.estado] || E.asignada;
        return `<li class="pf-tarea">
          <span class="tk-pill tk-pill--${e.cls}">${escHtml(e.txt)}</span>
          <div class="pf-tarea-txt">
            <div class="pf-tarea-t">${escHtml(t.titulo)}${t.origen === 'propia' ? ' <em>(iniciativa propia)</em>' : ''}</div>
            <div class="pf-tarea-m">${Tareas.plazoHTML(t)}</div>
          </div></li>`;
      }).join('')}</ul>` : `<div class="empty-box"><div class="empty-txt">Sin tareas en este período.</div></div>`}
      <p class="pf-nota">Las tareas aprobadas cuentan en tu resultado según las reglas del PE; el desglose está en el Resumen.</p>`;
  }

  /* ── Evolución ─────────────────────────────────────────────────────── */
  function _panelEvolucion(inst, cuerpo) {
    const v2 = inst.serie.filter(i => i.v2 && i.fila && i.fila.individual != null);
    const legacy = inst.serie.filter(i => !i.v2 && i.row);
    if (!v2.length && !legacy.length) {
      renderVacio(cuerpo, inst.modo === 'propio' ? 'Aún no tienes evaluaciones publicadas.' : 'Aún no hay evaluaciones publicadas.',
                  { periodo: inst.periodo, calendario: _cfg.calendario?.() });
      return;
    }
    const uid = inst.id.replace(/[^a-z0-9]/gi, '');
    const idV2 = `pf-evol-v2-${uid}`, idLg = `pf-evol-lg-${uid}`;
    borrarGrafico(idV2); borrarGrafico(idLg);

    const bloqueV2 = v2.length ? `
      <section class="pf-card pf-card--ancha" aria-labelledby="${uid}-h-v2">
        <h3 class="pf-h" id="${uid}-h-v2">Rúbrica por roles</h3>
        ${v2.length >= 2 ? `<div class="chart-wrap"><canvas id="${idV2}" role="img" aria-labelledby="${uid}-h-v2" aria-describedby="${idV2}-alt"></canvas></div>
          <p class="chart-alt" id="${idV2}-alt">${escHtml(v2.map(i => `${i.periodo.pe}: individual ${_fmt(i.fila.individual)}, general ${_fmt(i.fila.general)}`).join('. '))}.</p>`
          : `<p class="pf-vacio">La línea de evolución aparece cuando hay dos períodos con esta rúbrica.</p>`}
        <div class="v2-tabla-wrap"><table class="v2-tabla">
          <caption class="sr-only">Resultados por período con la rúbrica por roles</caption>
          <thead><tr><th scope="col">Período</th><th scope="col">Núcleo</th><th scope="col">Técnico</th><th scope="col">Individual</th><th scope="col">General</th><th scope="col">Nivel</th></tr></thead>
          <tbody>${v2.map(i => `<tr><td class="v2-nom">${escHtml(i.periodo.pe)}</td><td>${fmtV2(i.fila.nucleo)}</td><td>${fmtV2(i.fila.tecnico)}</td>
            <td class="v2-tot" style="color:${scoreColorTxtV2(i.fila.individual)}">${fmtV2(i.fila.individual)}</td><td>${fmtV2(i.fila.general)}</td>
            <td><span class="nivel-badge ${nivelV2(i.fila.individual).key}">${nivelV2(i.fila.individual).label}</span></td></tr>`).join('')}</tbody>
        </table></div>
      </section>` : '';

    const MAX = MAX_TOTAL();
    const bloqueLg = legacy.length ? `
      <section class="pf-card pf-card--ancha" aria-labelledby="${uid}-h-lg">
        <h3 class="pf-h" id="${uid}-h-lg">Rúbrica clásica <small>otra escala: no se compara con la de arriba</small></h3>
        ${legacy.length >= 2 ? `<div class="chart-wrap"><canvas id="${idLg}" role="img" aria-labelledby="${uid}-h-lg" aria-describedby="${idLg}-alt"></canvas></div>
          <p class="chart-alt" id="${idLg}-alt">${escHtml(legacy.map(i => `${i.periodo.pe}: ${i.total} de ${MAX}`).join('. '))}.</p>` : ''}
        <div class="v2-tabla-wrap"><table class="v2-tabla">
          <caption class="sr-only">Puntaje por período con la rúbrica clásica</caption>
          <thead><tr><th scope="col">Período</th><th scope="col">Puntaje</th><th scope="col">Nivel</th></tr></thead>
          <tbody>${legacy.map(i => `<tr><td class="v2-nom">${escHtml(i.periodo.pe)}</td>
            <td class="v2-tot" style="color:${scoreColorTxt(i.total)}">${i.total} <small>/ ${MAX}</small></td>
            <td><span class="nivel-badge ${scoreClass(i.total)}">${scoreLabel(i.total)}</span></td></tr>`).join('')}</tbody>
        </table></div>
      </section>` : '';

    // El estado de cada período (participación, evaluación, tareas) vive en la pestaña «Períodos», no aquí:
    // esta pestaña es solo la evolución de los resultados.
    cuerpo.innerHTML = `<div class="pf-grid pf-grid--1">${bloqueV2}${bloqueLg}</div>`;
    if (v2.length >= 2) graficoEvolucionV2(idV2, v2.map(i => ({ pe: i.periodo.pe, individual: i.fila.individual, general: i.fila.general })));
    if (legacy.length >= 2) graficoEvolucion(idLg, legacy.map(i => ({ pe: i.periodo.pe, total: i.total })), MAX);
  }


  /* ══ MONTAJE ═══════════════════════════════════════════════════════════ */

  function _tabsDe(inst) {
    // Las pestañas de gestión (solo administración) van PRIMERO: la configuración queda a un toque.
    const extra = (_cfg.tabsExtra || []).filter(t => inst.modo === 'admin' || !t.soloAdmin);
    return [...extra.filter(t => t.soloAdmin), ...TABS, ...extra.filter(t => !t.soloAdmin)];
  }

  async function _pintarPanel(inst) {
    const cuerpo = document.getElementById(`${inst.id}-cuerpo`);
    if (!cuerpo) return;
    const seq = ++inst.seq;
    cuerpo.setAttribute('aria-labelledby', `${inst.id}-tab-${inst.tab}`);
    const extra = (_cfg.tabsExtra || []).find(t => t.k === inst.tab);
    try {
      if (extra) await extra.render(cuerpo, { persona: inst.persona, periodo: inst.periodo, modo: inst.modo, refrescar: () => refrescar(inst.id) });
      else if (inst.tab === 'criterios') _panelCriterios(inst, cuerpo);
      else if (inst.tab === 'tareas')    await _panelTareas(inst, cuerpo, seq);
      else if (inst.tab === 'periodos')  await PerfilPE.pintar(inst, cuerpo, () => seq === inst.seq && inst.tab === 'periodos');
      else if (inst.tab === 'evolucion') _panelEvolucion(inst, cuerpo);
      else                               await _panelResumen(inst, cuerpo, seq);
    } catch (e) {
      console.error('[Perfil]', e);
      renderError(cuerpo, e.message || String(e), () => _pintarPanel(inst));
    }
    if (seq === inst.seq) { _niveles(inst, cuerpo); animarEntrada(cuerpo); }
  }

  function _pintarCabecera(inst) {
    const host = document.getElementById(`${inst.id}-cab`);
    if (!host) return;
    const item = _item(inst, inst.periodo.id);
    host.innerHTML = _cabeceraHTML(inst, item);
    animarEntrada(host);
  }

  /* Los PE del perfil van en UNA fila que se desplaza (como las pestañas): en el panel lateral, con seis PE y fechas, envueltos en
     filas quedaban desparejos y con los puntos de cada botón sueltos. La activa se trae a la vista y los bordes dicen si hay más
     (data-borde; el desvanecido lo pinta perfil.css). Los botones son los de siempre (renderPEBar). */
  function _peDesplazable(pe, centrar) {
    if (!pe) return;
    const marcar = () => {
      const izq = pe.scrollLeft > 4, der = pe.scrollLeft + pe.clientWidth < pe.scrollWidth - 4;
      pe.dataset.borde = izq && der ? 'ambos' : izq ? 'izq' : der ? 'der' : '';
    };
    const act = pe.querySelector('.pb.active');
    if (centrar && act && pe.scrollWidth > pe.clientWidth) pe.scrollLeft = Math.max(0, act.offsetLeft - (pe.clientWidth - act.offsetWidth) / 2);
    if (!pe._bordes) { pe._bordes = true; pe.addEventListener('scroll', marcar, { passive: true }); }
    marcar();
  }

  function _pintarBarra(inst) {
    const tabs = _tabsDe(inst);
    const seg = document.getElementById(`${inst.id}-seg`);
    if (seg) { seg.innerHTML = segHTML(tabs, inst.tab, 'perfilTab', { etiqueta: 'Secciones del perfil', prefijo: inst.id + '-tab' }); renderIconos(seg); }
    // Con cinco pestañas el segmentado se desplaza en el celular: la activa se trae a la vista y los bordes dicen
    // si hay más (data-borde="izq|der|ambos"; el desvanecido lo pinta movil.css).
    const sc = seg?.querySelector('.seg');
    if (sc) {
      const marcar = () => {
        const izq = sc.scrollLeft > 4, der = sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 4;
        sc.dataset.borde = izq && der ? 'ambos' : izq ? 'izq' : der ? 'der' : '';
      };
      const act = sc.querySelector('.seg-btn.active');
      if (act && sc.scrollWidth > sc.clientWidth) sc.scrollLeft = Math.max(0, act.offsetLeft - (sc.clientWidth - act.offsetWidth) / 2);
      sc.addEventListener('scroll', marcar, { passive: true });
      marcar();
    }
    // «Períodos» muestra todos los PE: el selector de un solo período no pinta nada ahí.
    const pe = document.getElementById(`${inst.id}-pe`);
    if (pe) pe.hidden = inst.tab === 'periodos';
  }

  /**
   * Monta el perfil dentro de `el`.
   *   persona : { id, nombre, email?, avatar_url?, rol_nombre?, distrito?, tipo_miembro? }
   *   modo    : 'propio' | 'supervision' | 'admin'
   *   panel   : true si vive en el panel lateral (cabecera tarjeta, no a sangre)
   *   onPeriodo(pe): para que el portal sincronice su propia barra de períodos
   */
  async function montar({ el, persona, modo = 'propio', periodoId = null, panel = false, tab = 'resumen', onPeriodo = null, rubricaLegacy = null }) {
    if (!el || !persona) return;
    // Un PE en el que ESTA persona no participó no existe en su perfil, lo mire ella, su secretaría o la administración.
    const sinPart = new Set(await API.getPeriodosSinParticipar(persona.id));
    const periodos = (Store.periodos() || []).filter(x => !sinPart.has(String(x.id)));
    const periodo = periodos.find(p => String(p.id) === String(periodoId))
                 || periodos.find(p => String(p.id) === String(Store.periodoId())) || periodos.find(p => p.activo) || periodos[periodos.length - 1];
    if (!periodo) {
      renderVacio(el, 'Todavía no hay períodos creados.');
      return;
    }

    const id = el.id || 'perfil';
    if (!el.id) el.id = id;
    const inst = { id, el, persona, modo, panel, periodo, tab, onPeriodo, rubricaLegacy, periodos, serie: [], tareas: new Map(), seq: 0 };
    _inst.set(id, inst);

    el.innerHTML = esqueletoHTML('perfil');
    try { await _cargarSerie(inst); }
    catch (e) {
      renderError(el, e.message || String(e), () => montar({ el, persona, modo, periodoId: periodo.id, panel, tab, onPeriodo, rubricaLegacy }));
      return;
    }
    if (_inst.get(id) !== inst) return;                  // otro montaje llegó antes

    el.innerHTML = `
      <article class="perfil${panel ? ' perfil--panel' : ''}" data-perfil="${escHtml(id)}" aria-label="Perfil de ${escHtml(persona.nombre || 'la persona')}">
        <div id="${id}-cab"></div>
        <div class="perfil-pagina${panel ? '' : ' m-content'}">
          <div class="perfil-barra">
            <div class="pe-row perfil-pe" id="${id}-pe" role="group" aria-label="Seleccionar período de evaluación"></div>
            <div id="${id}-seg"></div>
          </div>
          <div class="perfil-cuerpo" id="${id}-cuerpo" role="tabpanel"></div>
        </div>
      </article>`;

    renderPEBar(document.getElementById(`${id}-pe`), periodos, periodo.pe, pe => _cambiarPeriodo(inst, pe));
    _peDesplazable(document.getElementById(`${id}-pe`), true);
    _pintarCabecera(inst);
    _pintarBarra(inst);
    await _pintarPanel(inst);
  }

  function _cambiarPeriodo(inst, pe) {
    const p = (inst.periodos || Store.periodos() || []).find(x => x.pe === pe);
    if (!p || String(p.id) === String(inst.periodo.id)) return;
    inst.periodo = p;
    syncPEBar(document.getElementById(`${inst.id}-pe`), pe);
    _peDesplazable(document.getElementById(`${inst.id}-pe`), true);
    _pintarCabecera(inst);
    _pintarPanel(inst);
    inst.onPeriodo?.(pe);
  }

  /** Cambia de pestaña interna. La llama el despachador (data-act="perfilTab"). */
  function tab(k, el) {
    const root = el?.closest?.('[data-perfil]') || document.querySelector('[data-perfil]');
    const inst = root && _inst.get(root.dataset.perfil);
    if (!inst || !_tabsDe(inst).some(t => t.k === k)) return;
    inst.tab = k;
    _pintarBarra(inst);
    _pintarPanel(inst);
    if (!inst.panel && inst.modo === 'propio') {
      try { history.replaceState(null, '', `#perfil/${k}`); } catch { /* sin history: no es grave */ }
    }
  }

  /** «Ver detalle» de una tarjeta de Períodos: selecciona ese PE y abre el Resumen. */
  function verPeriodo(pe, el) {
    const root = el?.closest?.('[data-perfil]') || document.querySelector('[data-perfil]');
    const inst = root && _inst.get(root.dataset.perfil);
    const p = inst && (inst.periodos || Store.periodos() || []).find(x => x.pe === pe);
    if (!p) return;
    inst.periodo = p;
    inst.tab = 'resumen';
    syncPEBar(document.getElementById(`${inst.id}-pe`), pe);
    _pintarBarra(inst);
    _pintarCabecera(inst);
    _pintarPanel(inst);
    inst.onPeriodo?.(pe);
    root.scrollIntoView({ block: 'start' });
  }

  /** Vuelve a pedir los datos y repinta (p. ej. tras guardar en la pestaña Gestión). */
  async function refrescar(id) {
    const inst = _inst.get(id); if (!inst) return;
    await montar({ el: inst.el, persona: inst.persona, modo: inst.modo, periodoId: inst.periodo.id, panel: inst.panel, tab: inst.tab, onPeriodo: inst.onPeriodo, rubricaLegacy: inst.rubricaLegacy });
  }

  /**
   * Otra barra de períodos de la página cambió el período: el perfil propio lo
   * sigue (un solo período gobierna la página) sin volver a avisar al portal.
   */
  function sincronizar(pe) {
    for (const inst of _inst.values()) {
      if (inst.modo !== 'propio' || inst.panel || inst.periodo.pe === pe) continue;
      const p = (inst.periodos || Store.periodos() || []).find(x => x.pe === pe);
      if (!p || !document.getElementById(`${inst.id}-cab`)) continue;
      inst.periodo = p;
      syncPEBar(document.getElementById(`${inst.id}-pe`), pe);
      _pintarCabecera(inst);
      _pintarPanel(inst);
    }
  }

  /** El avatar cambió: repinta la cabecera sin recargar nada. */
  function refrescarAvatar(perfil) {
    for (const inst of _inst.values()) {
      if (inst.persona?.id !== perfil?.id) continue;
      inst.persona.avatar_url = perfil.avatar_url;
      if (document.getElementById(`${inst.id}-cab`)) _pintarCabecera(inst);
    }
  }

  /**
   * Cómo abre el portal el perfil de OTRA persona.
   *   modo       'supervision' | 'admin'
   *   resolver   id → persona (o Promise de persona)
   *   tabsExtra  [{ k, etiqueta, icono, soloAdmin?, render(cuerpo, ctx) }]
   *   acciones   [{ act, etiqueta, icono }]   act ∈ ACCIONES de config.js; recibe el id
   *   calendario () → eventos del calendario, para los estados vacíos
   *   periodoId  () → período con el que se abre (si no, el seleccionado o el activo)
   */
  function configurar(cfg) { _cfg = { ..._cfg, ...cfg }; }

  /** «Nueva tarea» para esta persona, desde su perfil (o el buscador). */
  function nuevaTarea(personaId) {
    const c = _cfg.tareas;
    const inst = [..._inst.values()].find(i => i.panel) || [..._inst.values()][0];
    const periodo = inst?.periodo || Store.periodo();
    if (!c || !periodo) return;
    if (!esPeriodoV2(periodo)) { showToast(`${periodo.pe} usa la rúbrica clásica: las tareas son de los períodos nuevos.`, 'info'); return; }
    Tareas.nueva({ periodoId: periodo.id, yo: c.yo, revisor: true, esAdmin: !!c.esAdmin, personas: c.personas(), paraId: personaId,
      onCambio: () => { if (inst) { inst.tareas.clear(); if (inst.tab === 'tareas') tab('tareas', document.getElementById(inst.id)); } } });
  }

  /** Abre el perfil de una persona en el panel lateral. */
  async function abrir(personaId) {
    const persona = await _cfg.resolver?.(personaId);
    if (!persona) { showToast('No se encontró a esa persona.', 'error'); return; }
    const cuerpo = abrirPanel({ titulo: 'Perfil', subtitulo: persona.nombre || '' });
    await montar({ el: cuerpo, persona, modo: _cfg.modo, panel: true, periodoId: _cfg.periodoId?.() ?? null });
    renderIconos(cuerpo);
  }

  return { montar, abrir, configurar, nuevaTarea, tab, verPeriodo, refrescar, refrescarAvatar, sincronizar };
})();
