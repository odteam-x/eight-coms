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
    { k: 'evolucion', etiqueta: 'Evolución', icono: 'trending-up' },
  ];

  const _fmt = (n, d = 1) => fmtNum(n, d);
  /** 0–6: qué patrón de la marca lleva la cabecera de esta persona. */
  const _patronDe = id => [...String(id || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 7;
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
    const periodos = Store.periodos() || [];
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

      if (v2) {
        const fila = (r.rows || []).find(x => x.evaluado_id === persona.id) || null;
        return { periodo, v2, fila, puntajes, comentarios };
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
    const interior = p.avatar_url
      ? `<img src="${escHtml(p.avatar_url)}" alt="" width="88" height="88">`
      : `<span aria-hidden="true">${escHtml(initials(p.nombre || p.email || '') || '?')}</span>`;
    return editable
      ? `<button type="button" class="perfil-av perfil-av--editable" data-act="cambiarAvatar"
                 aria-label="Cambiar foto de perfil" title="Cambiar foto de perfil">${interior}
           <i data-lucide="camera" class="perfil-av-cam" aria-hidden="true"></i></button>`
      : `<div class="perfil-av" role="img" aria-label="Foto de ${escHtml(p.nombre || 'la persona')}">${interior}</div>`;
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

    const H = inst.panel ? 'h3' : 'h2';
    return `
      <header class="perfil-cab sup-marca pat-${_patronDe(p.id)}">
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
    const ap = criteriosAplicables(perfil);
    const lista = [...ap.nucleo, ...ap.tecnicos]
      .map(c => ({ c, v: Number(item.puntajes[c.key]) }))
      .filter(x => Number.isFinite(x.v) && x.v >= 1);
    const T = _pos(inst);
    if (lista.length < 2) {
      return `<p class="pf-vacio">Todavía no hay suficientes criterios puntuados para comparar.</p>`;
    }
    const max = Math.max(...lista.map(x => x.v)), min = Math.min(...lista.map(x => x.v));
    if (max === min) {
      return `<p class="pf-vacio">Todos los criterios tienen el mismo puntaje (${max} de 5): no hay un punto que destaque sobre otro.</p>`;
    }
    const orden = [...lista].sort((a, b) => b.v - a.v || (b.c.peso ?? 0) - (a.c.peso ?? 0));
    const altos = orden.filter(x => x.v > min).slice(0, 3);
    const bajos = [...orden].reverse().filter(x => x.v < max && !altos.includes(x)).slice(0, 3);
    const fila = x => `
      <li class="pf-crit">
        <span class="pf-crit-n">${escHtml(x.c.nombre)}</span>
        <span class="pf-crit-v">${x.v}<small>/5</small></span>
        <span class="barra-track pf-crit-barra"><span class="barra-fill" style="width:${pctPuntajeV2(x.v)}%"></span></span>
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
          ${tareas ? `<section class="pf-card pf-card--ancha" aria-labelledby="${inst.id}-h-tareas">
            <div class="pf-card-cab"><h3 class="pf-h" id="${inst.id}-h-tareas">Tareas del período</h3>
              <button type="button" class="pf-enlace" data-act="perfilTab" data-arg="tareas">Ver todas<i data-lucide="arrow-right" aria-hidden="true"></i></button></div>
            ${tareas}
          </section>` : ''}
        </div>`;
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
    renderVacio(cuerpo, inst.modo === 'propio' ? `Aún no hay evaluación para ${pe}.` : `${inst.persona.nombre || 'La persona'} no tiene evaluación publicada en ${pe}.`,
                { periodo: inst.periodo, calendario: _cfg.calendario?.() });
  }

  /* ── Criterios ─────────────────────────────────────────────────────── */
  function _barraV2(c, v, previo, com) {
    const tiene = Number.isFinite(v) && v >= 1;
    const hayPrev = Number.isFinite(previo) && previo >= 1;
    return `
      <div class="cbar pf-cbar">
        <div class="cbar-top">
          <div>
            ${c.peso != null ? `<div class="cbar-tag" style="color:var(--criterio-txt)">Peso ${c.peso}</div>` : ''}
            <div class="cbar-name">${escHtml(c.nombre)}</div>
          </div>
          <div class="cbar-val" style="color:var(--criterio-txt)">${tiene ? v : '—'}<span>/5</span></div>
        </div>
        <div class="cbar-track pf-track">
          <div class="cbar-fill" style="width:${tiene ? pctPuntajeV2(v) : 0}%;background:var(--criterio)"></div>
          ${hayPrev ? `<span class="pf-prev" style="left:${pctPuntajeV2(previo)}%" title="Período anterior: ${previo}"></span>` : ''}
        </div>
        ${hayPrev ? `<div class="pf-prev-txt">Período anterior: ${previo} de 5</div>` : ''}
        ${com ? `<div class="cbar-feedback"><span class="cbar-fb-txt">${escHtml(com)}</span></div>` : ''}
        <details class="v2-det"><summary>¿Cómo se puntúa?</summary>${descriptoresHTML(c)}</details>
      </div>`;
  }

  function _panelCriterios(inst, cuerpo) {
    const item = _item(inst, inst.periodo.id);
    if (item?.v2 && item.fila) {
      const f = item.fila;
      const perfil = perfilesV2().find(x => String(x.id) === String(f.perfil_id));
      const ap = criteriosAplicables(perfil);
      const prev = _previoV2(inst, inst.periodo.id);
      const pv = k => (prev ? Number(prev.puntajes[k]) : NaN);
      const T = _pos(inst);
      cuerpo.innerHTML = `
        <h3 class="pf-h">Núcleo transversal</h3>
        <div class="v2-bars">${ap.nucleo.map(c => _barraV2(c, Number(item.puntajes[c.key]), pv(c.key), item.comentarios?.[c.key])).join('')}</div>
        <h3 class="pf-h">Criterios técnicos · ${escHtml(f.rol_nombre || 'el rol')}</h3>
        <div class="v2-bars">${ap.tecnicos.map(c => _barraV2(c, Number(item.puntajes[c.key]), pv(c.key), item.comentarios?.[c.key])).join('')}</div>
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
            <div class="cbar-top"><div><div class="cbar-tag" style="color:var(--criterio-txt)">${escHtml(c.abbr)}</div>
              <div class="cbar-name">${escHtml(c.label)}</div></div>
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
      <p class="pf-nota">Los hechos de las tareas apoyan la evaluación; no puntúan nada por sí solos.</p>`;
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

    cuerpo.innerHTML = `<div class="pf-grid pf-grid--1">${bloqueV2}${bloqueLg}</div>`;
    if (v2.length >= 2) graficoEvolucionV2(idV2, v2.map(i => ({ pe: i.periodo.pe, individual: i.fila.individual, general: i.fila.general })));
    if (legacy.length >= 2) graficoEvolucion(idLg, legacy.map(i => ({ pe: i.periodo.pe, total: i.total })), MAX);
  }


  /* ══ MONTAJE ═══════════════════════════════════════════════════════════ */

  function _tabsDe(inst) {
    return [...TABS, ...(_cfg.tabsExtra || []).filter(t => inst.modo === 'admin' || !t.soloAdmin)];
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
      else if (inst.tab === 'evolucion') _panelEvolucion(inst, cuerpo);
      else                               await _panelResumen(inst, cuerpo, seq);
    } catch (e) {
      console.error('[Perfil]', e);
      renderError(cuerpo, e.message || String(e), () => _pintarPanel(inst));
    }
    if (seq === inst.seq) animarEntrada(cuerpo);
  }

  function _pintarCabecera(inst) {
    const host = document.getElementById(`${inst.id}-cab`);
    if (!host) return;
    const item = _item(inst, inst.periodo.id);
    host.innerHTML = _cabeceraHTML(inst, item);
    animarEntrada(host);
  }

  function _pintarBarra(inst) {
    const tabs = _tabsDe(inst);
    const seg = document.getElementById(`${inst.id}-seg`);
    if (seg) { seg.innerHTML = segHTML(tabs, inst.tab, 'perfilTab', { etiqueta: 'Secciones del perfil', prefijo: inst.id + '-tab' }); renderIconos(seg); }
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
    const periodos = Store.periodos() || [];
    const periodo = periodos.find(p => String(p.id) === String(periodoId))
                 || Store.periodo() || periodos.find(p => p.activo) || periodos[periodos.length - 1];
    if (!periodo) {
      renderVacio(el, 'Todavía no hay períodos creados.');
      return;
    }

    const id = el.id || 'perfil';
    if (!el.id) el.id = id;
    const inst = { id, el, persona, modo, panel, periodo, tab, onPeriodo, rubricaLegacy, serie: [], tareas: new Map(), seq: 0 };
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
    _pintarCabecera(inst);
    _pintarBarra(inst);
    await _pintarPanel(inst);
  }

  function _cambiarPeriodo(inst, pe) {
    const p = (Store.periodos() || []).find(x => x.pe === pe);
    if (!p || String(p.id) === String(inst.periodo.id)) return;
    inst.periodo = p;
    syncPEBar(document.getElementById(`${inst.id}-pe`), pe);
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
      const p = (Store.periodos() || []).find(x => x.pe === pe);
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

  /** Abre el perfil de una persona en el panel lateral. */
  async function abrir(personaId) {
    const persona = await _cfg.resolver?.(personaId);
    if (!persona) { showToast('No se encontró a esa persona.', 'error'); return; }
    const cuerpo = abrirPanel({ titulo: 'Perfil', subtitulo: persona.nombre || '' });
    await montar({ el: cuerpo, persona, modo: _cfg.modo, panel: true, periodoId: _cfg.periodoId?.() ?? null });
    renderIconos(cuerpo);
  }

  return { montar, abrir, configurar, tab, refrescar, refrescarAvatar, sincronizar };
})();
