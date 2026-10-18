'use strict';
/**
 * EIGHT CREATORS LABs — Reporte general de todos los Períodos de Evaluación (PE)
 * ─────────────────────────────────────────────────────────────────────────────
 * Una sola pantalla con TODOS los PE de la gestión que la persona puede ver: tarjetas con los totales,
 * una tabla comparativa (una fila por PE, también los que no tienen datos) y, al abrir una fila, de dónde
 * sale cada cifra (distribución por distrito y por rol, desglose de tareas y las personas que la componen).
 *
 * DE DÓNDE SALEN LOS DATOS (nada se calcula aquí que no se pueda rastrear)
 *   reporte_general_pe()  (migración 0050)  →  COMPONE seguimiento_global() (0025), que a su vez lee
 *   resultados_periodo() (rúbrica por roles) o la suma clásica. El quién-ve-qué lo decide la base:
 *   administración = todas las personas · secretaría = su distrito · miembro = solo él o ella. La consulta y
 *   la exportación salen de las MISMAS filas, así que una no puede mostrar más que la otra.
 *   Este archivo solo SUMA conteos y DIVIDE numerador entre denominador. No existe una fórmula de evaluación aquí.
 *
 * TOTAL, PROMEDIO Y PORCENTAJE (la diferencia importa)
 *   · TOTAL      = suma de conteos de los PE en pantalla (tareas, participaciones…).
 *   · PORCENTAJE = Σ numerador ÷ Σ denominador de esos PE. NUNCA se suman ni se promedian porcentajes ya hechos.
 *   · PROMEDIO   = Σ suma de resultados ÷ Σ cantidad de resultados (ponderado por resultados, no «promedio de
 *                  promedios»: un PE con 2 resultados no pesa lo mismo que uno con 20).
 *   · La rúbrica por roles (0–100) y la clásica (otra escala) tienen cada una su promedio; no se mezclan.
 *   · PERSONAS: una persona está en varios PE, así que NO se suma entre PE: se muestra la cifra de personas
 *     distintas que entrega la base. Lo mismo con las actividades (una puede tener tareas en dos PE): se
 *     muestran por PE y no se totalizan.
 *   · Un denominador 0 se muestra «—», nunca 0 %.
 *
 * Todo texto humano pasa por escHtml. Depende de: config.js (escHtml, ACCIONES), core/render.js, core/ui.js,
 * api.js (_gid, API._rpcAusente, API.getSeguimientoGlobal), supabase-client.js (SB).
 */
const ReporteGeneral = (() => {
  const ESTADOS = {
    activo:     { txt: 'Activo',     cls: 'etq-azul' },
    proximo:    { txt: 'Próximo',    cls: 'etq-cian' },
    cerrado:    { txt: 'Cerrado',    cls: 'etq-gris' },
    inactivo:   { txt: 'No activo',  cls: 'etq-ambar' },
    sin_fechas: { txt: 'Sin fechas', cls: 'etq-gris' },
  };
  const FILTROS_VACIOS = { q: '', estado: '', modelo: '', ver: '', distrito: '', rol: '', orden: 'cronologico' };

  const num = v => Number(v) || 0;
  const suma = (rows, k) => rows.reduce((s, r) => s + num(r[k]), 0);
  const pct = (a, b) => b ? Math.round(a / b * 100) : null;
  const pctTxt = (a, b) => b ? Math.round(a / b * 100) + ' %' : '—';
  const f1 = n => n == null ? '—' : (Math.round(n * 10) / 10).toString().replace('.', ',');
  const frac = (a, b) => b ? `${a} de ${b}` : '—';
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const esV2 = r => r.modelo === 'v2';

  /* ── Lógica pura (se prueba sin DOM) ─────────────────────────────────── */

  /** Un PE «sin datos»: ni una evaluación (publicada o en borrador) ni una sola tarea. */
  /**
   * «Unidades de tarea» de un PE = tareas individuales + tareas colectivas. Una colectiva es UNA unidad (la base la
   * cuenta por tarea, no por integrante). Las anuladas no entran en ninguna cifra: se informan aparte.
   * Sin la migración 0051 las columnas de colectivas no existen y valen 0.
   */
  const U = {
    total: r => num(r.tareas_total) + num(r.colectivas_total),
    abiertas: r => num(r.tareas_abiertas) + num(r.colectivas_abiertas),
    enRevision: r => num(r.tareas_en_revision) + num(r.colectivas_en_revision),
    aprobadas: r => num(r.tareas_aprobadas) + num(r.colectivas_aprobadas),
    vencidas: r => num(r.tareas_vencidas) + num(r.colectivas_vencidas),
    conPlazo: r => num(r.con_plazo) + num(r.colectivas_con_plazo),
    aTiempo: r => num(r.a_tiempo) + num(r.colectivas_a_tiempo),
  };
  const sumaU = (rows, k) => rows.reduce((a, r) => a + U[k](r), 0);
  const sinDatos = r => num(r.eval_publicadas) + num(r.eval_no_publicadas) === 0 && U.total(r) === 0 && num(r.equipos_total) === 0;

  function promedioDe(rows) {
    const n = suma(rows, 'n_resultados'), s = suma(rows, 'suma_resultado');
    return { n, suma: s, promedio: n ? s / n : null, pe: rows.filter(r => num(r.n_resultados) > 0).length,
      nucleo: suma(rows, 'n_nucleo') ? suma(rows, 'suma_nucleo') / suma(rows, 'n_nucleo') : null,
      tecnico: suma(rows, 'n_tecnico') ? suma(rows, 'suma_tecnico') / suma(rows, 'n_tecnico') : null };
  }

  /**
   * Totales de los PE que se están mostrando. `completo` = ¿están todos los PE que entregó la base?
   * (solo entonces «participan en algún PE» es una cifra exacta: si se filtraron PE, no se puede saber).
   */
  function consolidar(rows, { completo = true } = {}) {
    const v2 = rows.filter(esV2), cl = rows.filter(r => !esV2(r));
    const conTareas = rows.filter(r => r.tareas_aplican);
    const t = k => suma(conTareas, k);
    return {
      pe: rows.length,
      // Personas DISTINTAS (la base las cuenta una vez); no es la suma de las filas.
      personas: rows.length ? num(rows[0].g_personas) : null,
      participanAlguno: rows.length && completo ? num(rows[0].g_participan_alguno) : null,
      conPublicada: rows.length && completo ? num(rows[0].g_con_publicada) : null,
      // Participaciones = personas × PE en que participan (una persona suma en cada PE).
      participaciones: suma(rows, 'participan'),
      publicadas: suma(rows, 'eval_publicadas'), noPublicadas: suma(rows, 'eval_no_publicadas'), sinEvaluar: suma(rows, 'eval_sin_evaluar'),
      v2: promedioDe(v2), clasico: promedioDe(cl),
      peClasicos: cl.length,
      equipos: suma(conTareas, 'equipos_total'), equiposActivos: suma(conTareas, 'equipos_activos'),
      tareas: {
        individuales: t('tareas_total'), colectivas: t('colectivas_total'), anuladas: t('tareas_anuladas') + t('colectivas_anuladas'),
        aplican: conTareas.length, total: sumaU(conTareas, 'total'), asignadas: t('tareas_asignadas'), propias: t('tareas_propias'),
        abiertas: sumaU(conTareas, 'abiertas'), enRevision: sumaU(conTareas, 'enRevision'), aprobadas: sumaU(conTareas, 'aprobadas'),
        devueltas: t('tareas_devueltas'), bloqueadas: t('tareas_bloqueadas'), vencidas: sumaU(conTareas, 'vencidas'),
        entregadas: t('tareas_entregadas'), conPlazo: sumaU(conTareas, 'conPlazo'), aTiempo: sumaU(conTareas, 'aTiempo'),
        peConVencidas: conTareas.filter(r => U.vencidas(r) > 0).length,
      },
      peSinDatos: rows.filter(sinDatos).length,
    };
  }

  function filtrar(rows, f) {
    const q = norm(f.q);
    return rows.filter(r => {
      if (q && !norm(`${r.periodo_nombre} ${r.descripcion || ''}`).includes(q)) return false;
      if (f.estado && r.estado_pe !== f.estado) return false;
      if (f.modelo && (f.modelo === 'v2') !== esV2(r)) return false;
      if (f.ver === 'vencidas' && !(U.vencidas(r) > 0)) return false;
      if (f.ver === 'por_publicar' && !(num(r.eval_no_publicadas) + num(r.eval_sin_evaluar) > 0)) return false;
      if (f.ver === 'sin_datos' && !sinDatos(r)) return false;
      return true;
    });
  }

  function ordenar(rows, orden) {
    const prom = r => num(r.n_resultados) ? num(r.suma_resultado) / num(r.n_resultados) : -1;
    const grupo = r => !num(r.n_resultados) ? 2 : (esV2(r) ? 0 : 1);
    const pubs = r => num(r.participan) ? num(r.eval_publicadas) / num(r.participan) : -1;
    const cmp = {
      cronologico: (a, b) => num(a.orden) - num(b.orden),
      nombre: (a, b) => String(a.periodo_nombre).localeCompare(String(b.periodo_nombre), 'es', { numeric: true }),
      publicadas: (a, b) => pubs(b) - pubs(a) || num(a.orden) - num(b.orden),
      // Dos escalas no se comparan: primero los de la rúbrica por roles (de mayor a menor), luego los clásicos, al final los sin resultado.
      promedio: (a, b) => grupo(a) - grupo(b) || prom(b) - prom(a) || num(a.orden) - num(b.orden),
      vencidas: (a, b) => U.vencidas(b) - U.vencidas(a) || num(a.orden) - num(b.orden),
    }[orden] || ((a, b) => num(a.orden) - num(b.orden));
    return [...rows].sort(cmp);
  }

  /* ── CSV: numerador y denominador en columnas separadas; mismas filas que la pantalla ── */
  const csvEsc = v => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;   // una celda de texto no puede ejecutarse como fórmula
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const VISTAS = { todo: 'Toda la gestión', distrito: 'Solo mi distrito', propio: 'Solo mis datos' };

  function csvTexto(rows, meta = {}) {
    const cab = ['Período', 'Rúbrica', 'Estado', 'Inicio', 'Entrega', 'Personas', 'Participan', 'No participan',
      'Evaluaciones publicadas', 'Evaluaciones no publicadas', 'Sin evaluar', '% publicadas',
      'Resultados publicados (n)', 'Suma de resultados', 'Promedio', 'Escala',
      'Tareas aplican', 'Tareas', 'Individuales', 'Colectivas', 'Asignadas (individuales)', 'Propias', 'Abiertas', 'En revisión', 'Aprobadas', 'Devueltas', 'Bloqueadas', 'Vencidas',
      'Anuladas (no cuentan)', 'Entregadas (individuales asignadas)', 'Entregas con plazo', 'Entregas a tiempo', '% a tiempo', 'Actividades con tareas',
      'Equipos', 'Equipos activos', 'Personas en equipos', 'Personas con nota de tareas', 'Peso de las tareas en el PE (%)'];
    const fila = r => [r.periodo_nombre, esV2(r) ? 'Por roles' : 'Clásica', (ESTADOS[r.estado_pe] || {}).txt || r.estado_pe,
      r.fecha_inicio || '', r.fecha_entrega || '', num(r.personas), num(r.participan), num(r.no_participan),
      num(r.eval_publicadas), num(r.eval_no_publicadas), num(r.eval_sin_evaluar), pctTxt(num(r.eval_publicadas), num(r.participan)),
      num(r.n_resultados), f1(num(r.suma_resultado)), num(r.n_resultados) ? f1(num(r.suma_resultado) / num(r.n_resultados)) : '—', esV2(r) ? 'sobre 100' : 'escala clásica',
      r.tareas_aplican ? 'sí' : 'no', U.total(r), num(r.tareas_total), num(r.colectivas_total), num(r.tareas_asignadas), num(r.tareas_propias), U.abiertas(r), U.enRevision(r),
      U.aprobadas(r), num(r.tareas_devueltas), num(r.tareas_bloqueadas), U.vencidas(r),
      num(r.tareas_anuladas) + num(r.colectivas_anuladas), num(r.tareas_entregadas), U.conPlazo(r), U.aTiempo(r), pctTxt(U.aTiempo(r), U.conPlazo(r)), num(r.actividades_con_tareas),
      num(r.equipos_total), num(r.equipos_activos), num(r.equipos_integrantes), num(r.n_nota_tareas), r.peso_tareas_regla == null ? '' : f1(num(r.peso_tareas_regla))];
    const c = consolidar(rows);
    const total = ['TOTAL (' + rows.length + ' PE)', '', '', '', '', c.personas ?? '', '', '',
      c.publicadas, c.noPublicadas, c.sinEvaluar, pctTxt(c.publicadas, c.participaciones),
      c.v2.n, f1(c.v2.suma), f1(c.v2.promedio), 'rúbrica por roles, sobre 100',
      '', c.tareas.total, c.tareas.individuales, c.tareas.colectivas, c.tareas.asignadas, c.tareas.propias, c.tareas.abiertas, c.tareas.enRevision,
      c.tareas.aprobadas, c.tareas.devueltas, c.tareas.bloqueadas, c.tareas.vencidas,
      c.tareas.anuladas, c.tareas.entregadas, c.tareas.conPlazo, c.tareas.aTiempo, pctTxt(c.tareas.aTiempo, c.tareas.conPlazo), '',
      c.equipos, c.equiposActivos, '', '', ''];
    const extra = [[], ['Alcance', VISTAS[rows[0]?.vista] || ''], ['Filtros', meta.filtros || 'ninguno'],
      ['Datos al', meta.generado || ''], ['Nota', 'Las personas no se suman entre PE; la rúbrica clásica no se mezcla con la de roles. El promedio total es ponderado por resultados. Tareas = individuales + colectivas (cada colectiva cuenta una vez); las anuladas no cuentan.']];
    return '﻿' + [cab, ...rows.map(fila), total, ...extra].map(r => r.map(csvEsc).join(';')).join('\n');
  }

  /* ── Estado de la pantalla ───────────────────────────────────────────── */
  let S = null;   // { host, rows, f, abiertos:Set, seg, opts, gestion, cargadoEn, error, noDisponible }

  async function pedir() {
    const f = S.f;
    const { data, error } = await SB.rpc('reporte_general_pe', {
      p_gestion: await _gid(),
      p_distrito: f.distrito === '' ? null : (f.distrito === '__sin' ? '' : f.distrito),
      p_rol: f.rol ? Number(f.rol) : null,
    });
    if (error) return { ok: false, error: error.message, noDisponible: API._rpcAusente(error) || /actividad_id|seguimiento_global/.test(error.message || '') };
    return { ok: true, rows: data ?? [] };
  }

  const nombreDistrito = id => {
    if (id === '' || id == null) return 'Sin distrito';
    const d = (S.opts.distritos || []).find(x => String(x.id) === String(id));
    return d?.nombre || String(id);
  };
  const fechaHora = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  const fechaCorta = f => (f && typeof fechaCortaISO === 'function' ? fechaCortaISO(f) : '');

  /**
   * @param host  contenedor
   * @param opts  { distritos:[{id,nombre}], roles:[{id,nombre}], abrirPE(id) → abre el reporte completo de ese PE }
   */
  async function montar(host, opts = {}) {
    if (!host) return;
    S = { host, rows: null, f: { ...FILTROS_VACIOS }, abiertos: new Set(), filtrosAbiertos: false, seg: null, opts, cargadoEn: null, error: null, noDisponible: false, catalogo: null };
    host.innerHTML = '<div class="rg"><div id="rg-controles"></div><div id="rg-res" aria-live="polite"></div></div>';
    pintarControles();
    await cargar();
  }

  async function cargar() {
    const res = document.getElementById('rg-res');
    if (res) renderCargando(res);
    const r = await pedir();
    if (!S) return;
    if (!r.ok) { S.rows = null; S.error = r.error; S.noDisponible = !!r.noDisponible; }
    else { S.rows = r.rows; S.error = null; S.noDisponible = false; S.cargadoEn = r.rows[0]?.generado_en || new Date().toISOString(); S.seg = null; }
    // Las listas de distritos y roles se arman de la primera carga SIN filtro (con filtro solo quedaría lo filtrado).
    if (r.ok && !S.catalogo) S.catalogo = catalogoDe(r.rows);
    const foco = document.activeElement?.id;
    pintarControles();
    if (foco) document.getElementById(foco)?.focus();
    pintar();
  }

  function catalogoDe(rows) {
    const d = new Map(), ro = new Map();
    for (const r of rows) {
      for (const x of (r.por_distrito || [])) d.set(x.distrito, true);
      for (const x of (r.por_rol || [])) if (x.rol_id != null) ro.set(String(x.rol_id), x.rol || ('Rol ' + x.rol_id));
    }
    return { distritos: [...d.keys()], roles: [...ro.entries()].map(([id, nombre]) => ({ id, nombre })) };
  }

  /* ── Controles ───────────────────────────────────────────────────────── */
  function opcion(v, txt, sel) { return `<option value="${escHtml(v)}"${String(sel) === String(v) ? ' selected' : ''}>${escHtml(txt)}</option>`; }

  function pintarControles() {
    const host = document.getElementById('rg-controles'); if (!host || !S) return;
    const f = S.f, cat = S.catalogo || { distritos: [], roles: [] };
    // Si el admin entregó sus listas (con nombres), se usan; si no, las que salen de los datos.
    const dists = (S.opts.distritos && S.opts.distritos.length) ? S.opts.distritos.map(d => String(d.id)) : cat.distritos.filter(Boolean);
    const roles = (S.opts.roles && S.opts.roles.length) ? S.opts.roles.map(r => ({ id: String(r.id), nombre: r.nombre })) : cat.roles;
    const mas = dists.length > 1 || S.rows?.[0]?.vista === 'todo';
    const nActivos = Object.entries(f).filter(([k, v]) => k !== 'orden' && v).length;
    const hayFiltros = nActivos > 0;
    host.innerHTML = `
      <div class="rg-controles no-print">
        <div class="filtros-fila rg-busca">
          <input class="search-inp" id="rg-q" type="search" value="${escHtml(f.q)}" placeholder="Buscar un PE por nombre…" aria-label="Buscar un PE por nombre" data-input="rgFiltro">
          <button type="button" class="btn btn--secundario rg-filtros-btn" data-act="rgFiltrosToggle" aria-expanded="${S.filtrosAbiertos}" aria-controls="rg-selects"><i data-lucide="sliders-horizontal"></i>Filtros${nActivos ? ` (${nActivos})` : ''}</button>
        </div>
        <div class="filtros-fila rg-selects" id="rg-selects"${S.filtrosAbiertos ? '' : ' hidden'}>
          <select class="cfg-inp cfg-select" id="rg-estado" aria-label="Estado del PE" data-change="rgFiltro">
            ${opcion('', 'Todos los estados', f.estado)}${Object.entries(ESTADOS).map(([k, e]) => opcion(k, e.txt, f.estado)).join('')}
          </select>
          <select class="cfg-inp cfg-select" id="rg-modelo" aria-label="Rúbrica" data-change="rgFiltro">
            ${opcion('', 'Todas las rúbricas', f.modelo)}${opcion('v2', 'Rúbrica por roles', f.modelo)}${opcion('legacy', 'Rúbrica clásica', f.modelo)}
          </select>
          <select class="cfg-inp cfg-select" id="rg-ver" aria-label="Mostrar solo" data-change="rgFiltro">
            ${opcion('', 'Todos los PE', f.ver)}${opcion('vencidas', 'Con tareas vencidas', f.ver)}${opcion('por_publicar', 'Con evaluaciones por publicar', f.ver)}${opcion('sin_datos', 'Sin datos', f.ver)}
          </select>
          ${mas ? `<select class="cfg-inp cfg-select" id="rg-distrito" aria-label="Distrito" data-change="rgFiltro">
            ${opcion('', 'Todos los distritos', f.distrito)}${dists.map(d => opcion(d, nombreDistrito(d), f.distrito)).join('')}${opcion('__sin', 'Sin distrito', f.distrito)}
          </select>` : ''}
          ${roles.length > 1 || S.rows?.[0]?.vista === 'todo' ? `<select class="cfg-inp cfg-select" id="rg-rol" aria-label="Rol" data-change="rgFiltro">
            ${opcion('', 'Todos los roles', f.rol)}${roles.map(r => opcion(r.id, r.nombre, f.rol)).join('')}
          </select>` : ''}
          <select class="cfg-inp cfg-select" id="rg-orden" aria-label="Ordenar por" data-change="rgFiltro">
            ${opcion('cronologico', 'Orden de los PE', f.orden)}${opcion('publicadas', 'Más evaluaciones publicadas', f.orden)}${opcion('promedio', 'Mejor promedio', f.orden)}${opcion('vencidas', 'Más tareas vencidas', f.orden)}${opcion('nombre', 'Nombre', f.orden)}
          </select>
        </div>
        <div class="rg-meta">
          <span class="rg-fecha">${S.cargadoEn ? `Datos al <b>${escHtml(fechaHora(S.cargadoEn))}</b>` : ''}</span>
          <button type="button" class="btn btn--texto" data-act="rgActualizar"><i data-lucide="refresh"></i>Actualizar</button>
          ${hayFiltros ? '<button type="button" class="btn btn--texto" data-act="rgLimpiar"><i data-lucide="x"></i>Quitar filtros</button>' : ''}
        </div>
      </div>`;
    if (typeof renderIconos === 'function') renderIconos(host);
  }

  function filtrosTexto() {
    const f = S.f, p = [];
    if (f.q) p.push(`nombre contiene «${f.q}»`);
    if (f.estado) p.push('estado ' + ESTADOS[f.estado].txt.toLowerCase());
    if (f.modelo) p.push(f.modelo === 'v2' ? 'rúbrica por roles' : 'rúbrica clásica');
    if (f.ver) p.push({ vencidas: 'con tareas vencidas', por_publicar: 'con evaluaciones por publicar', sin_datos: 'sin datos' }[f.ver]);
    if (f.distrito) p.push('distrito ' + nombreDistrito(f.distrito === '__sin' ? '' : f.distrito));
    if (f.rol) p.push('rol ' + ((S.catalogo?.roles || []).find(r => r.id === f.rol)?.nombre || (S.opts.roles || []).find(r => String(r.id) === f.rol)?.nombre || f.rol));
    return p.join(' · ');
  }

  /* ── Pintura ─────────────────────────────────────────────────────────── */
  function kpi(val, lbl, sub, cls = '') {
    return `<div class="tarjeta tarjeta--kpi rg-kpi ${cls}"><span class="kpi-num">${val}</span><span class="kpi-etq">${escHtml(lbl)}</span>${sub ? `<span class="kpi-sub">${sub}</span>` : ''}</div>`;
  }

  function kpisHTML(c, completo) {
    const t = c.tareas;
    const nota = c.peClasicos && t.aplican < c.pe ? `${c.peClasicos} PE clásico${c.peClasicos === 1 ? '' : 's'} no usa${c.peClasicos === 1 ? '' : 'n'} tareas` : '';
    const prom2 = c.v2.promedio != null
      ? kpi(`${escHtml(f1(c.v2.promedio))}<small>/100</small>`, 'Promedio de resultados', `${c.v2.n} resultado${c.v2.n === 1 ? '' : 's'} en ${c.v2.pe} PE · rúbrica por roles${c.clasico.promedio != null ? `<br>Clásica: ${escHtml(f1(c.clasico.promedio))} (${c.clasico.n}) · otra escala, aparte` : ''}`)
      : kpi('—', 'Promedio de resultados', c.clasico.promedio != null
          ? `Solo rúbrica clásica: ${escHtml(f1(c.clasico.promedio))} (${c.clasico.n} resultado${c.clasico.n === 1 ? '' : 's'}) · otra escala`
          : 'Todavía no hay resultados publicados');
    return `<div class="panel-kpis rg-kpis">
      ${kpi(String(c.pe), 'Períodos de Evaluación', c.peSinDatos ? `${c.peSinDatos} sin datos todavía` : 'todos con actividad')}
      ${kpi(String(c.personas ?? '—'), 'Personas', completo && c.participanAlguno != null ? `${c.participanAlguno} participan en algún PE · cada una cuenta una vez` : 'cada persona cuenta una sola vez')}
      ${kpi(escHtml(pctTxt(c.publicadas, c.participaciones)), 'Evaluaciones publicadas', escHtml(`${frac(c.publicadas, c.participaciones)} participaciones${c.noPublicadas ? ` · ${c.noPublicadas} sin publicar` : ''}`))}
      ${prom2}
      ${kpi(String(t.total), 'Tareas', escHtml(t.total ? `${t.abiertas} abiertas · ${t.enRevision} en revisión · ${t.aprobadas} aprobadas${t.colectivas ? ` · ${t.individuales} individuales + ${t.colectivas} colectivas (cada una cuenta una vez)` : ''}${t.anuladas ? ` · ${t.anuladas} anulada${t.anuladas === 1 ? '' : 's'} aparte` : ''}` : (t.aplican ? 'sin tareas todavía' : 'ningún PE de esta vista usa tareas')) + (nota ? `<br>${escHtml(nota)}` : ''))}
      ${c.equipos ? kpi(String(c.equipos), 'Equipos', escHtml(`${c.equiposActivos} activo${c.equiposActivos === 1 ? '' : 's'} · cada equipo pertenece a un solo PE`)) : ''}
      ${kpi(String(t.vencidas), 'Tareas vencidas', escHtml(t.vencidas ? `en ${t.peConVencidas} PE` : 'ninguna'), t.vencidas ? 'rg-kpi--alerta' : '')}
      ${kpi(escHtml(pctTxt(t.aTiempo, t.conPlazo)), 'Entregas a tiempo', escHtml(`${frac(t.aTiempo, t.conPlazo)} entregas con plazo`))}
    </div>`;
  }

  const barra = (valor, etq) => valor == null ? '' : `<div class="barra-track rg-barra" role="img" aria-label="${escHtml(etq)}"><div class="barra-fill" style="width:${Math.max(0, Math.min(100, valor))}%"></div></div>`;

  function filaHTML(r, i) {
    const abierto = S.abiertos.has(r.periodo_id);
    const e = ESTADOS[r.estado_pe] || ESTADOS.sin_fechas;
    const sin = sinDatos(r);
    const part = num(r.participan), pers = num(r.personas), pub = num(r.eval_publicadas);
    const p = pct(pub, part);
    const fechas = [r.fecha_inicio && fechaCorta(r.fecha_inicio), r.fecha_entrega && fechaCorta(r.fecha_entrega)].filter(Boolean).join(' → ');
    const res = num(r.n_resultados) ? num(r.suma_resultado) / num(r.n_resultados) : null;
    const nombre = escHtml(r.periodo_nombre);
    return `<tr class="rg-fila${sin ? ' rg-fila--vacia' : ''}${abierto ? ' rg-fila--abierta' : ''}" data-pe="${escHtml(r.periodo_id)}">
      <th scope="row"><button type="button" class="rg-pe-btn" data-act="rgDetalle" data-arg="${escHtml(r.periodo_id)}" aria-expanded="${abierto}" aria-controls="rg-det-${i}" aria-label="${abierto ? 'Cerrar' : 'Ver'} el detalle de ${nombre}"><i data-lucide="chevron-down" class="rg-chev" aria-hidden="true"></i><span class="rg-pe-t">${nombre}</span></button>
        <span class="rg-pe-meta"><span class="etiqueta ${e.cls}">${escHtml(e.txt)}</span>${sin ? ' <span class="etiqueta etq-gris">Sin datos</span>' : ''}</span>
        <small>${esV2(r) ? 'Rúbrica por roles' : 'Rúbrica clásica'}${fechas ? ' · ' + escHtml(fechas) : ''}</small></th>
      <td data-label="Personas"><b>${part}</b><small>${pers ? (part ? `de ${pers}${num(r.no_participan) ? ` · ${num(r.no_participan)} no participa${num(r.no_participan) === 1 ? '' : 'n'}` : ''}` : `de ${pers} · nadie participa`) : 'sin personas en esta vista'}</small></td>
      <td data-label="Evaluaciones">${part ? `<b>${p} %</b><small>${pub} de ${part} publicadas${num(r.eval_no_publicadas) ? ` · ${num(r.eval_no_publicadas)} sin publicar` : ''}${num(r.eval_sin_evaluar) ? ` · ${num(r.eval_sin_evaluar)} sin evaluar` : ''}</small>${barra(p, `${p} % de las personas que participan tienen su evaluación publicada`)}` : '<b>—</b><small>nadie participa</small>'}</td>
      <td data-label="Resultado">${res != null ? `<b>${escHtml(f1(res))}</b><small>${esV2(r) ? 'sobre 100' : 'escala clásica'} · ${num(r.n_resultados)} resultado${num(r.n_resultados) === 1 ? '' : 's'}</small>` : '<b>—</b><small>sin resultados publicados</small>'}</td>
      <td data-label="Tareas">${r.tareas_aplican ? (U.total(r) ? `<b>${U.total(r)}</b><small>${U.aprobadas(r)} aprobadas · ${U.abiertas(r)} abiertas${U.enRevision(r) ? ' · ' + U.enRevision(r) + ' en revisión' : ''}${num(r.colectivas_total) ? ` · ${num(r.colectivas_total)} colectiva${num(r.colectivas_total) === 1 ? '' : 's'}` : ''}</small>` : '<b>0</b><small>sin tareas</small>') : '<b>—</b><small>no aplica (rúbrica clásica)</small>'}</td>
      <td data-label="A tiempo">${r.tareas_aplican && U.conPlazo(r) ? `<b>${pctTxt(U.aTiempo(r), U.conPlazo(r))}</b><small>${U.aTiempo(r)} de ${U.conPlazo(r)} con plazo</small>` : '<b>—</b><small>sin entregas con plazo</small>'}</td>
      <td data-label="Vencidas">${r.tareas_aplican ? `<b class="${U.vencidas(r) ? 'rg-venc' : ''}">${U.vencidas(r)}</b>` : '<b>—</b>'}</td>
    </tr>
    <tr class="rg-det no-print" id="rg-det-${i}" data-det="${escHtml(r.periodo_id)}"${abierto ? '' : ' hidden'}><td colspan="7">${abierto ? detalleHTML(r) : ''}</td></tr>`;
  }

  function mini(titulo, col, filas, vacio) {
    if (!filas.length) return `<div class="rg-mini"><h4>${escHtml(titulo)}</h4><p class="cfg-hint">${escHtml(vacio)}</p></div>`;
    return `<div class="rg-mini"><h4>${escHtml(titulo)}</h4><table class="rg-mini-t"><thead><tr><th scope="col">${escHtml(col)}</th><th scope="col">Personas</th><th scope="col">Participan</th><th scope="col">Publicadas</th></tr></thead><tbody>
      ${filas.map(x => `<tr><th scope="row">${escHtml(x[0])}</th><td>${x[1]}</td><td>${x[2]}</td><td>${x[3]}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function detalleHTML(r) {
    const dist = (r.por_distrito || []).map(x => [nombreDistrito(x.distrito), num(x.personas), num(x.participan), num(x.publicadas)]);
    const roles = (r.por_rol || []).map(x => [x.rol || 'Sin rol', num(x.personas), num(x.participan), num(x.publicadas)]);
    const col = num(r.colectivas_total), eqs = num(r.equipos_total);
    const extra = `${eqs || col ? `<li><b>${eqs}</b> equipo${eqs === 1 ? '' : 's'} (${num(r.equipos_activos)} activo${num(r.equipos_activos) === 1 ? '' : 's'}, ${num(r.equipos_integrantes)} persona${num(r.equipos_integrantes) === 1 ? '' : 's'} distinta${num(r.equipos_integrantes) === 1 ? '' : 's'}) · <b>${col}</b> tarea${col === 1 ? '' : 's'} colectiva${col === 1 ? '' : 's'}: ${num(r.colectivas_aprobadas)} aprobadas, ${num(r.colectivas_en_revision)} en revisión, ${num(r.colectivas_abiertas)} abiertas, ${num(r.colectivas_vencidas)} vencidas. Cada una cuenta una vez, no una por integrante.</li>` : ''}
      ${num(r.tareas_anuladas) + num(r.colectivas_anuladas) ? `<li><b>${num(r.tareas_anuladas) + num(r.colectivas_anuladas)}</b> anulada${num(r.tareas_anuladas) + num(r.colectivas_anuladas) === 1 ? '' : 's'} (no cuentan en ninguna cifra)</li>` : ''}
      ${r.peso_tareas_regla != null ? `<li>Las tareas pesan <b>${escHtml(f1(num(r.peso_tareas_regla)))} %</b> del resultado de este PE${r.regla_confirmada ? '' : ' (regla sin confirmar)'} · <b>${num(r.n_nota_tareas)}</b> persona${num(r.n_nota_tareas) === 1 ? '' : 's'} con nota de tareas</li>` : ''}`;
    const tareas = r.tareas_aplican
      ? `<ul class="rg-lista"><li><b>${num(r.tareas_total)}</b> tareas individuales = ${num(r.tareas_asignadas)} asignadas + ${num(r.tareas_propias)} por iniciativa propia</li>
          <li><b>${num(r.tareas_aprobadas)}</b> aprobadas · <b>${num(r.tareas_en_revision)}</b> en revisión · <b>${num(r.tareas_abiertas)}</b> abiertas (${num(r.tareas_devueltas)} devueltas, ${num(r.tareas_bloqueadas)} bloqueadas)</li>
          <li><b>${num(r.tareas_vencidas)}</b> vencidas (nunca entregadas, plazo pasado) · <b>${num(r.tareas_entregadas)}</b> asignadas entregadas · <b>${num(r.a_tiempo)}</b> de <b>${num(r.con_plazo)}</b> con plazo, a tiempo</li>
          ${num(r.puntos_n) ? `<li>Puntos de las tareas aprobadas: promedio <b>${escHtml(f1(num(r.puntos_suma) / num(r.puntos_n)))}</b> sobre ${num(r.puntos_n)} tarea${num(r.puntos_n) === 1 ? '' : 's'}</li>` : ''}
          <li><b>${num(r.actividades_con_tareas)}</b> actividad${num(r.actividades_con_tareas) === 1 ? '' : 'es'} con tareas (${num(r.tareas_en_actividades_aprobadas)} de ${num(r.tareas_en_actividades)} tareas vinculadas, aprobadas)</li>
          ${extra}</ul>`
      : '<p class="cfg-hint">Este PE usa la rúbrica clásica: las tareas asignables solo existen en los PE de la rúbrica por roles.</p>';
    return `<div class="rg-det-grid">
      <div class="rg-mini"><h4>Tareas</h4>${tareas}</div>
      ${mini('Por distrito', 'Distrito', dist, 'Sin personas en esta vista.')}
      ${mini('Por rol', 'Rol', roles, 'Sin personas en esta vista.')}
    </div>
    <div class="rg-det-acc">
      ${S.opts.abrirPE ? `<button type="button" class="btn btn--secundario" data-act="rgAbrirPE" data-arg="${escHtml(r.periodo_id)}"><i data-lucide="file-text"></i>Abrir el reporte completo de este PE</button>` : ''}
      <button type="button" class="btn btn--texto" data-act="rgPersonas" data-arg="${escHtml(r.periodo_id)}"><i data-lucide="users"></i>Ver las personas que componen estas cifras</button>
    </div>
    <div class="rg-personas" id="rg-pers-${escHtml(r.periodo_id)}"></div>`;
  }

  function pintar() {
    const res = document.getElementById('rg-res'); if (!res || !S) return;
    if (S.error) {
      if (S.noDisponible) res.innerHTML = '<div class="empty-box"><div class="empty-txt">El reporte general necesita la migración 0050 (y las 0021 y 0025) en la base de datos. Aplícalas en el SQL Editor y vuelve a abrir esta pantalla.</div></div>';
      else renderError(res, S.error, cargar);
      return;
    }
    const todas = S.rows || [];
    if (!todas.length) { res.innerHTML = '<div class="empty-box"><div class="empty-txt">Esta gestión todavía no tiene Períodos de Evaluación. Crea el primero en Configuración → Períodos.</div></div>'; return; }
    const vistos = ordenar(filtrar(todas, S.f), S.f.orden);
    const vista = todas[0].vista;
    const alcance = VISTAS[vista] || '';
    const fT = filtrosTexto();
    if (!vistos.length) {
      res.innerHTML = `<div class="empty-box"><div class="empty-txt">Ningún PE coincide con estos filtros${fT ? ` (${escHtml(fT)})` : ''}.</div>
        <button type="button" class="btn btn--secundario" data-act="rgLimpiar">Quitar filtros y ver todos</button></div>`;
      return;
    }
    const completo = vistos.length === todas.length;
    const c = consolidar(vistos, { completo });
    res.innerHTML = `
      <article class="rpt-hoja rg-hoja" aria-label="Reporte general de los Períodos de Evaluación">
        <header class="rpt-hoja-cab">
          <picture><source srcset="logo.webp 1x, logo@2x.webp 2x" type="image/webp"><img src="logo.png" alt="" class="rpt-logo" width="64" height="64"></picture>
          <div class="rpt-hoja-t"><span>EIGHT CREATORS LABs · CELIDER 08 Santiago</span><h2>Reporte general de los Períodos de Evaluación</h2>
            <p>${c.pe} de ${todas.length} PE · ${escHtml(alcance)}${fT ? ' · ' + escHtml(fT) : ''}</p></div>
          <div class="rpt-hoja-f"><span>Datos al</span><b>${escHtml(fechaHora(S.cargadoEn))}</b></div>
        </header>
        ${kpisHTML(c, completo)}
        <section class="rpt-sec">
          <h3 class="rpt-sec-t">Comparación entre PE</h3>
          <p class="rpt-sec-d">Cada fila es un PE. Ábrela para ver de dónde sale cada cifra. Los PE sin datos también aparecen.</p>
          <div class="seg-tabla-wrap"><table class="rg-tabla">
            <caption class="sr-only">Comparación entre Períodos de Evaluación</caption>
            <thead><tr><th scope="col">Período de Evaluación</th><th scope="col">Personas que participan</th><th scope="col">Evaluaciones publicadas</th><th scope="col">Resultado promedio</th><th scope="col">Tareas</th><th scope="col">Entregas a tiempo</th><th scope="col">Vencidas</th></tr></thead>
            <tbody>${vistos.map(filaHTML).join('')}</tbody></table></div>
        </section>
        <section class="rpt-sec rg-como">
          <details class="seg-como"><summary>¿Cómo se calcula y de dónde sale cada cifra?</summary>${DEFINICIONES}</details>
        </section>
        <footer class="rpt-hoja-pie">Los resultados salen de las mismas funciones de la base que usan las evaluaciones individuales; este reporte solo suma conteos y divide numerador entre denominador.</footer>
      </article>`;
    if (typeof renderIconos === 'function') renderIconos(res);
    // Las filas abiertas recuperan su lista de personas si ya se había cargado.
    for (const id of S.abiertos) if (S.seg) pintarPersonas(id);
  }

  const DEFINICIONES = `<ul class="rol-lista">
    <li><b>Períodos de Evaluación</b>: los PE de la gestión que tu usuario puede ver. Con filtros, solo los que coinciden.</li>
    <li><b>Personas</b>: personas distintas del alcance (administración: todas · secretaría: su distrito · miembro: solo tú). Una persona está en varios PE, por eso <i>no se suma</i> entre PE.</li>
    <li><b>Evaluaciones publicadas</b>: personas con la evaluación publicada ÷ personas que participan en ese PE. El total suma numeradores y denominadores de los PE en pantalla: no promedia porcentajes.</li>
    <li><b>Promedio de resultados</b>: suma de los resultados publicados ÷ cantidad de resultados (ponderado: un PE con más resultados pesa más). La rúbrica por roles (sobre 100) y la clásica son escalas distintas y nunca se mezclan. Un borrador no cuenta.</li>
    <li><b>Tareas</b>: todas las de las personas de la vista en ese PE (asignadas + por iniciativa propia). <b>Abiertas</b>: asignadas, en curso, devueltas o bloqueadas. <b>En revisión</b>: entregadas sin aprobar. <b>Aprobadas</b>: cerradas con puntos. Cada tarea cae en un solo grupo.</li>
    <li><b>Vencidas</b>: tareas asignadas nunca entregadas con el plazo pasado; lo bloqueado no cuenta. <b>A tiempo</b>: entregadas dentro del plazo ÷ entregadas con plazo (primera entrega).</li>
    <li><b>Tareas colectivas y equipos</b>: una tarea de equipo es UNA unidad aunque la compartan varias personas (no se cuenta por integrante) y se suma a las individuales para el total de tareas. Una persona en dos equipos cuenta una sola vez. Las tareas anuladas no entran en ninguna cifra y se informan aparte. Si un equipo reúne personas de varios distritos, los cortes por distrito de sus tareas no suman al total.</li>
    <li><b>Resultado y tareas</b>: el resultado de cada persona ya incluye la nota de sus tareas según la regla del PE (peso en %); se lee tal cual de la evaluación, este reporte no lo recalcula.</li>
    <li><b>Actividades</b>: las que tienen tareas en el PE. Una actividad puede aparecer en dos PE, por eso no se totalizan.</li>
    <li><b>Sin datos</b>: el PE no tiene ninguna evaluación (ni borrador) ni tareas. No es lo mismo que «0 %»: significa que aún no hay información.</li>
    <li>Las rúbricas anteriores (clásicas) no tienen tareas: se muestra «no aplica», no cero.</li></ul>`;

  /* ── Interacciones ───────────────────────────────────────────────────── */
  async function filtro(el) {
    if (!S || !el) return;
    const mapa = { 'rg-q': 'q', 'rg-estado': 'estado', 'rg-modelo': 'modelo', 'rg-ver': 'ver', 'rg-distrito': 'distrito', 'rg-rol': 'rol', 'rg-orden': 'orden' };
    const k = mapa[el.id]; if (!k) return;
    S.f[k] = el.value;
    // Distrito y rol cambian QUIÉN se cuenta: se pide de nuevo a la base. El resto solo cambia qué PE se muestran.
    if (k === 'distrito' || k === 'rol') { S.abiertos.clear(); await cargar(); return; }
    pintar();
    actualizarLimpiar();   // los controles no se repintan: el foco se queda donde está
  }
  function actualizarLimpiar() {
    const meta = document.querySelector('#rg-controles .rg-meta'); if (!meta) return;
    const n = Object.entries(S.f).filter(([k, v]) => k !== 'orden' && v).length, hay = n > 0;
    const fb = document.querySelector('.rg-filtros-btn');
    if (fb) fb.lastChild.textContent = 'Filtros' + (n ? ` (${n})` : '');
    const btn = meta.querySelector('[data-act="rgLimpiar"]');
    if (hay && !btn) { meta.insertAdjacentHTML('beforeend', '<button type="button" class="btn btn--texto" data-act="rgLimpiar"><i data-lucide="x"></i>Quitar filtros</button>'); if (typeof renderIconos === 'function') renderIconos(meta); }
    if (!hay && btn) btn.remove();
  }
  async function limpiar() {
    if (!S) return;
    const reCarga = !!(S.f.distrito || S.f.rol);
    S.f = { ...FILTROS_VACIOS, orden: S.f.orden };
    S.abiertos.clear();
    if (reCarga) await cargar(); else { pintarControles(); pintar(); }
  }
  function detalle(id) {
    if (!S) return;
    S.abiertos.has(id) ? S.abiertos.delete(id) : S.abiertos.add(id);
    const fila = S.rows.find(r => r.periodo_id === id); if (!fila) return;
    const tr = [...document.querySelectorAll('tr.rg-det')].find(x => x.dataset.det === id);
    const btn = [...document.querySelectorAll('.rg-pe-btn')].find(b => b.closest('tr')?.dataset.pe === id);
    if (!tr) return;
    const abierto = S.abiertos.has(id);
    tr.hidden = !abierto;
    tr.firstElementChild.innerHTML = abierto ? detalleHTML(fila) : '';
    if (btn) { btn.setAttribute('aria-expanded', abierto); btn.closest('tr')?.classList.toggle('rg-fila--abierta', abierto); }
    if (abierto && typeof renderIconos === 'function') renderIconos(tr);
  }
  async function personas(id) {
    if (!S) return;
    const host = document.getElementById('rg-pers-' + id); if (!host) return;
    renderCargando(host);
    if (!S.seg) {
      const r = await API.getSeguimientoGlobal();
      if (!r.ok) { renderError(host, r.error, () => personas(id)); return; }
      S.seg = r.rows;
    }
    pintarPersonas(id);
  }
  function pintarPersonas(id) {
    const host = document.getElementById('rg-pers-' + id); if (!host || !S.seg) return;
    const f = S.f;
    // Las MISMAS reglas de filtro que aplicó la base: distrito y rol (el resto de filtros eligen PE, no personas).
    const filas = S.seg.filter(r => r.periodo_id === id
      && (!f.distrito || (f.distrito === '__sin' ? !r.distrito : r.distrito === f.distrito))
      && (!f.rol || String(r.rol_id ?? '') === f.rol));
    if (!filas.length) { host.innerHTML = '<p class="cfg-hint">No hay personas en este PE con los filtros actuales.</p>'; return; }
    const ESTADO = { publicado: 'Publicada', borrador: 'Borrador', sin_publicar: 'Sin publicar', sin_evaluar: 'Sin evaluar' };
    const orden = [...filas].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
    host.innerHTML = `<div class="seg-tabla-wrap"><table class="seg-tabla req-tabla rg-pers-t">
      <caption class="sr-only">Personas de este PE</caption>
      <thead><tr><th scope="col">Persona</th><th scope="col">Rol</th><th scope="col">Evaluación</th><th scope="col">Resultado</th><th scope="col">Tareas</th></tr></thead>
      <tbody>${orden.map(r => {
        const val = r.modelo === 'v2' ? r.individual : r.total_clasico;
        const visible = r.estado_eval === 'publicado' || r.estado_eval === 'borrador';
        return `<tr><th scope="row"><button type="button" class="seg-nombre" data-act="perfilVer" data-arg="${escHtml(r.persona_id)}" aria-label="Ver el perfil de ${escHtml(r.nombre)}">${escHtml(r.nombre)}</button><small>${escHtml(nombreDistrito(r.distrito || ''))}</small></th>
          <td data-label="Rol">${escHtml(r.rol_nombre || 'Sin rol')}</td>
          <td data-label="Evaluación">${r.participa ? escHtml(ESTADO[r.estado_eval] || r.estado_eval) : '<span class="etiqueta etq-gris">No participa</span>'}</td>
          <td data-label="Resultado">${visible && val != null ? `<b>${escHtml(f1(Number(val)))}</b><small>${r.modelo === 'v2' ? 'sobre 100' : 'escala clásica'}${r.estado_eval === 'borrador' ? ' · borrador (no cuenta)' : ''}</small>` : '—'}</td>
          <td data-label="Tareas">${r.tareas_total ? `<b>${num(r.tareas_total)}</b><small>${num(r.tareas_aprobadas)} aprobadas${num(r.tareas_vencidas) ? ` · ${num(r.tareas_vencidas)} vencida${num(r.tareas_vencidas) === 1 ? '' : 's'}` : ''}</small>` : '—'}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  /** En celular los selectores se pliegan detrás del botón «Filtros» (en escritorio siempre se ven). */
  function filtrosToggle() {
    if (!S) return;
    S.filtrosAbiertos = !S.filtrosAbiertos;
    const caja = document.getElementById('rg-selects'), btn = document.querySelector('.rg-filtros-btn');
    if (caja) caja.hidden = !S.filtrosAbiertos;
    if (btn) btn.setAttribute('aria-expanded', S.filtrosAbiertos);
  }
  function abrirPE(id) { if (S?.opts.abrirPE) S.opts.abrirPE(id); }

  /** Descarga lo que se ve en pantalla (mismas filas, mismos permisos). */
  function csv() {
    if (!S?.rows?.length) { if (typeof showToast === 'function') showToast('No hay PE que exportar.', 'error'); return; }
    const vistos = ordenar(filtrar(S.rows, S.f), S.f.orden);
    if (!vistos.length) { if (typeof showToast === 'function') showToast('No hay PE que exportar con esos filtros.', 'error'); return; }
    ReporteEquipo.descargar('reporte-general-pe.csv', csvTexto(vistos, { filtros: filtrosTexto(), generado: fechaHora(S.cargadoEn) }));
  }
  const imprimir = () => ReporteEquipo.imprimir();
  const estado = () => S;
  return { montar, filtro, filtrosToggle, limpiar, detalle, personas, abrirPE, cargar, csv, imprimir, consolidar, filtrar, ordenar, csvTexto, sinDatos, promedioDe, estado, ESTADOS, DEFINICIONES };
})();

/** data-input / data-change="rgFiltro" (lista blanca de config.js) */
function rgFiltro(el) { ReporteGeneral.filtro(el); }
