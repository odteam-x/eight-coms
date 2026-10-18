'use strict';
/* Cliente Supabase SIMULADO, solo para probar la UI sin el backend real.
   Implementa lo justo que usan api.js / auth.js / los portales, en memoria,
   con las mismas fórmulas de resultados_periodo y las transiciones de tareas. */
(() => {
  const uuid = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
  const U = { admin: uuid(90), sec: uuid(91), m1: uuid(1), m2: uuid(2), m3: uuid(3), m4: uuid(4), m5: uuid(5), r1: uuid(6), r2: uuid(7), r3: uuid(8) };
  const P = { pe1: 'aaaaaaaa-0000-0000-0000-000000000001', pe2: 'aaaaaaaa-0000-0000-0000-000000000002', pe3: 'aaaaaaaa-0000-0000-0000-000000000003' };
  const hoy = new Date();
  const dia = n => { const d = new Date(hoy); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const ahora = () => new Date().toISOString();

  const NUCLEO = [['plazos', 'Cumplimiento de plazos de entrega'], ['respuesta', 'Respuesta y disponibilidad ante requerimientos'],
    ['colaboracion', 'Colaboración y trabajo en equipo'], ['iniciativa', 'Iniciativa y proactividad'], ['calidad', 'Calidad y completitud de la entrega']];
  const TEC = [['planificacion', 'Planificación y organización del trabajo'], ['revision', 'Revisión y control de calidad previo a la entrega'],
    ['edicion', 'Edición y montaje audiovisual'], ['diseno', 'Diseño y composición gráfica'], ['fluidez', 'Fluidez y expresión oral'],
    ['narrativa', 'Construcción narrativa y estructura de guion'], ['redes', 'Ejecución y publicación en redes sociales'],
    ['encuadre', 'Composición y encuadre fotográfico'], ['tecnico', 'Dominio técnico del equipo de captura'], ['ortografia', 'Ortografía, gramática y redacción normativa'],
    ['marca', 'Aplicación de la identidad de marca institucional'], ['metricas', 'Análisis e interpretación de métricas'],
    ['comunidad', 'Gestión de comunidad e interacción con la audiencia'], ['logistica', 'Logística y coordinación de coberturas'],
    ['recursos', 'Gestión y cuidado de recursos y equipos'], ['liderazgo', 'Liderazgo, delegación y desarrollo del equipo'],
    ['vision', 'Visión estratégica y alineación institucional'], ['voceria', 'Vocería y representación institucional'],
    ['mensaje', 'Claridad y consistencia del mensaje institucional']];
  const NUEVAS = { descripcion: '', tipo_campo: 'escala', opciones: [], obligatorio: true, created_at: ahora(), created_by: null };
  const criterios_v2 = [...NUCLEO.map(([k, n], i) => ({ ...NUEVAS, id: i + 1, gestion_id: 1, key: k, nombre: n, tipo: 'nucleo', orden: i + 1, activo: true,
      desc_1: 'Descriptor del nivel 1 de ' + n, desc_3: 'Descriptor del nivel 3 de ' + n, desc_5: 'Descriptor del nivel 5 de ' + n })),
    ...TEC.map(([k, n], i) => ({ ...NUEVAS, id: i + 6, gestion_id: 1, key: k, nombre: n, tipo: 'tecnico', orden: i + 6, activo: true,
      desc_1: 'Descriptor del nivel 1 de ' + n, desc_3: 'Descriptor del nivel 3 de ' + n, desc_5: 'Descriptor del nivel 5 de ' + n }))];

  criterios_v2.push(
    { ...NUEVAS, id: 25, gestion_id: 1, key: 'modalidad', nombre: 'Modalidad de asistencia', descripcion: 'Cómo asistió a la jornada', tipo: 'nucleo', tipo_campo: 'opcion', opciones: ['Presencial', 'Remota', 'Mixta'], obligatorio: false, orden: 25, activo: true, desc_1: '', desc_3: '', desc_5: '' },
    { ...NUEVAS, id: 26, gestion_id: 1, key: 'observaciones', nombre: 'Observaciones del evaluador', tipo: 'nucleo', tipo_campo: 'texto', obligatorio: false, orden: 26, activo: true, desc_1: '', desc_3: '', desc_5: '' });

  const DB = {
    gestiones: [{ id: 1, nombre: '2026-2027', inicio: null, fin: null, activa: true, archivada: false, created_at: ahora() }],
    roles: [
      { id: 1, nombre: 'Fotografía', activo: true, orden: 1, descripcion: 'Cubre los eventos y produce las imágenes del equipo.',
        responsabilidades: 'Cobertura fotográfica de las jornadas\nSelección y edición básica de las fotos\nEntrega del material en el drive del equipo', requisitos: 'Cámara propia o acceso a una del equipo' },
      { id: 2, nombre: 'Redacción', activo: true, orden: 2, descripcion: 'Escribe las notas y los textos de las publicaciones.',
        responsabilidades: 'Notas de prensa de cada jornada\nTextos para redes sociales\nRevisión ortográfica del material', requisitos: '' },
      { id: 3, nombre: 'Dirección', activo: true, orden: 3, descripcion: '', responsabilidades: '', requisitos: '' }],
    // 0021: roles habilitados además del principal, y preferencias de cada persona
    persona_roles: [{ persona_id: U.m2, rol_id: 2 }, { persona_id: U.m4, rol_id: 2 }],
    preferencias_rol: [
      { persona_id: U.m1, rol_id: 2, prioridad: 1, es_predeterminado: false },
      { persona_id: U.m1, rol_id: 1, prioridad: 2, es_predeterminado: true },
      { persona_id: U.m2, rol_id: 2, prioridad: 1, es_predeterminado: true },
    ],
    actividad_destinatarios: [{ actividad_id: 5, persona_id: U.m1 }, { actividad_id: 5, persona_id: U.m2 }],
    bienvenida_estado: [],
    distritos: ['01','02','03','04','05','06','07','08','09','10'].map(n => ({ id: '08-' + n, nombre: 'Distrito 08-' + n, activo: true })).concat([{ id: 'EXT', nombre: 'Invitado Externo', activo: true }]),
    profiles: [
      { id: U.admin, nombre: 'Admin General', email: 'admin@x.cl', es_admin: true, tipo_miembro: 'miembro', distrito: null, rol_id: null, aprobado: true },
      { id: U.sec, nombre: 'Sofía Secretaria', email: 'sofia@x.cl', es_admin: false, tipo_miembro: 'secretario', distrito: '08-01', rol_id: 3, aprobado: true },
      { id: U.m1, nombre: 'Ana Fotógrafa', email: 'ana@x.cl', es_admin: false, tipo_miembro: 'miembro', distrito: '08-01', rol_id: 1, aprobado: true },
      { id: U.m2, nombre: 'Beto Foto', email: 'beto@x.cl', es_admin: false, tipo_miembro: 'miembro', distrito: '08-01', rol_id: 1, aprobado: true },
      { id: U.m3, nombre: 'Carla Foto', email: 'carla@x.cl', es_admin: false, tipo_miembro: 'miembro', distrito: '08-01', rol_id: 1, aprobado: true },
      { id: U.m4, nombre: 'Diego Foto', email: 'diego@x.cl', es_admin: false, tipo_miembro: 'miembro', distrito: '08-02', rol_id: 1, aprobado: true },
      { id: U.m5, nombre: 'Elena Foto', email: 'elena@x.cl', es_admin: false, tipo_miembro: 'miembro', distrito: '08-02', rol_id: 1, aprobado: true },
      { id: U.r1, nombre: 'Flor Redactora', email: 'flor@x.cl', es_admin: false, tipo_miembro: 'miembro', distrito: '08-01', rol_id: 2, aprobado: true },
      { id: U.r2, nombre: 'Gus Redactor', email: 'gus@x.cl', es_admin: false, tipo_miembro: 'miembro', distrito: '08-02', rol_id: 2, aprobado: true },
      { id: U.r3, nombre: 'Hugo Redactor', email: 'hugo@x.cl', es_admin: false, tipo_miembro: 'miembro', distrito: '08-02', rol_id: 2, aprobado: true },
    ],
    periodos_evaluacion: [
      { id: P.pe1, gestion_id: 1, nombre: 'PE1', descripcion: 'Primer período', activo: false, modelo: 'legacy', v2_permitido: false, created_at: '2026-01-01T00:00:00Z' },
      { id: P.pe2, gestion_id: 1, nombre: 'PE2', descripcion: 'Segundo período', activo: true, modelo: 'v2', created_at: '2026-02-01T00:00:00Z', fecha_inicio: dia(-20), fecha_entrega: dia(10) },
      { id: P.pe3, gestion_id: 1, nombre: 'PE3', descripcion: 'Tercer período', activo: false, modelo: 'v2', created_at: '2026-03-01T00:00:00Z' },
    ],
    criterios: ['pla', 'rev', 'edi', 'dis', 'flu', 'nar', 'eje'].map((k, i) => ({ id: i + 1, gestion_id: 1, key: k, label: k.toUpperCase() + ' criterio', abbr: k.toUpperCase(), color: '#888888', orden: i, activo: true, max: 4 })),
    rubrica: [{ id: 1, gestion_id: 1, criterio_id: 1, criterio: 'PLA criterio', nivel4: 'Excelente', nivel3: 'Bueno', nivel2: 'En proceso', nivel1: 'Bajo', orden: 1 }],
    calendario: [], config: [], periodo_participantes: [{ periodo_id: P.pe3, user_id: U.m5, activo: false }], trabajos_entregados: [],
    etiquetas: [['Entrega', 'coral'], ['Jornada', 'violeta'], ['Capacitación', 'verde'], ['Reunión', 'ambar'], ['Evento', 'cian']].map(([nombre, tono], i) => ({ id: i + 1, gestion_id: 1, nombre, tono, orden: i + 1 })),
    actividades: [
      { id: 1, gestion_id: 1, titulo: 'Jornada de cierre', descripcion: 'Presentación de resultados del período.', etiqueta_id: 2, fecha_inicio: dia(18), fecha_fin: dia(19), distrito: null, alcance: 'equipo', creada_por: U.admin },
      { id: 2, gestion_id: 1, titulo: 'Taller de fotografía', descripcion: 'Práctica de luz natural.', etiqueta_id: 3, fecha_inicio: dia(5), fecha_fin: null, distrito: null, alcance: 'equipo', creada_por: U.admin },
      { id: 3, gestion_id: 1, titulo: 'Reunión del distrito 08-01', descripcion: '', etiqueta_id: 4, fecha_inicio: dia(2), fecha_fin: null, distrito: '08-01', alcance: 'distrito', creada_por: U.sec },
      { id: 4, gestion_id: 1, titulo: 'Reunión del distrito 08-02', descripcion: '', etiqueta_id: 4, fecha_inicio: dia(3), fecha_fin: null, distrito: '08-02', alcance: 'distrito', creada_por: U.admin },
      { id: 5, gestion_id: 1, titulo: 'Ensayo del grupo A', descripcion: 'Solo para quienes presentan.', etiqueta_id: 2, fecha_inicio: dia(7), fecha_fin: null, distrito: '08-01', alcance: 'seleccion', creada_por: U.sec },
    ],
    criterios_v2,
    perfiles_rol: [
      { id: 1, gestion_id: 1, rol_id: 1, version: 1, vigente_desde_periodo: null, created_at: ahora() },
      { id: 2, gestion_id: 1, rol_id: 2, version: 1, vigente_desde_periodo: null, created_at: ahora() },
    ],
    perfil_criterios: [
      ...[['encuadre', 30], ['tecnico', 25], ['diseno', 20], ['planificacion', 15], ['revision', 10]].map(([k, p]) => ({ perfil_id: 1, criterio_key: k, peso: p })),
      ...[['narrativa', 35], ['ortografia', 25], ['revision', 20], ['planificacion', 20]].map(([k, p]) => ({ perfil_id: 2, criterio_key: k, peso: p })),
    ],
    // Evaluaciones de distrito de ejemplo (las 10 de la tabla de referencia). PE1 y PE2 publicados; PE3 con 9 distritos (08-07 sin evaluar, solo borrador).
    evaluaciones: [], evaluaciones_distrito: (() => {
      const T = { '08-05': [25, 21, 23], '08-08': [24, 17, 28], '08-09': [18, 25, 21], '08-10': [23, 19, 22], '08-01': [19, 15, 24], '08-06': [19, 21, 18], '08-04': [23, 18, 16], '08-03': [25, 15, 14], '08-02': [21, 13, 12], '08-07': [9, 11, null] };
      const pj = t => { const b = Math.floor(t / 4), r = t - b * 4; return { cgo: b + (r > 0 ? 1 : 0), cct: b + (r > 1 ? 1 : 0), com: b + (r > 2 ? 1 : 0), cee: b }; };
      let id = 1; const out = [];
      for (const [d, v] of Object.entries(T)) v.forEach((t, i) => { if (t != null) out.push({ id: 'ed' + id++, periodo_id: [P.pe1, P.pe2, P.pe3][i], distrito_id: d, evaluador_id: U.admin, ig_stats: {}, puntajes: pj(t), comentarios: {}, estado: 'publicado', created_at: ahora(), updated_at: ahora() }); });
      out.push({ id: 'ed' + id++, periodo_id: P.pe3, distrito_id: '08-07', evaluador_id: U.admin, ig_stats: {}, puntajes: pj(12), comentarios: {}, estado: 'borrador', created_at: ahora(), updated_at: ahora() });
      return out;
    })(), tareas: [], tarea_eventos: [],
    estadisticas_distrito: [],
    manuales_privados: [{ slug: 'admin', titulo: 'Manual para administración', html: '<div class="ay-hero"><h1>Manual de prueba (simulador)</h1></div><section id="equipos"><h2>Equipos</h2><p>Contenido privado de ejemplo.</p></section>' }],
  };
  let seq = { eval: 1, tarea: 1, ev: 1, perfil: 3 };

  /* ── Datos semilla ── */
  const nucleoPts = v => Object.fromEntries(NUCLEO.map(([k]) => [k, v]));
  const fotoPts = v => ({ encuadre: v, tecnico: v, diseno: v, planificacion: v, revision: v });
  const redPts = v => ({ narrativa: v, ortografia: v, revision: v, planificacion: v });
  const addEval = (periodo, ev, pts, estado = 'publicado', perfil = null) => DB.evaluaciones.push({
    id: seq.eval++, periodo_id: periodo, evaluado_id: ev, evaluador_id: U.admin, puntajes: pts, bono_ext: 0, comentarios: {},
    estado, modelo: DB.periodos_evaluacion.find(p => p.id === periodo).modelo, perfil_id: perfil, escala: 'cinco', created_at: ahora(), updated_at: ahora() });
  // PE1 legacy
  [U.m1, U.m2, U.m3].forEach((u, i) => addEval(P.pe1, u, { pla: 3 + (i % 2), rev: 3, edi: 4, dis: 3, flu: 2, nar: 3, eje: 4 }));
  // PE2 v2
  [[U.m1, 3, 5], [U.m2, 4, 4], [U.m3, 2, 3], [U.m4, 5, 2], [U.m5, 1, 3]].forEach(([u, t, n]) => addEval(P.pe2, u, { ...nucleoPts(n), ...fotoPts(t) }, u === U.m5 ? 'borrador' : 'publicado', 1));
  [[U.r1, 2], [U.r2, 4], [U.r3, 5]].forEach(([u, t]) => addEval(P.pe2, u, { ...nucleoPts(3), ...redPts(t) }, 'publicado', 2));

  const T = (o) => DB.tareas.push({ id: seq.tarea++, periodo_id: P.pe2, titulo: 'Tarea', descripcion: '', asignada_a: U.m1, asignada_por: U.admin, origen: 'asignada',
    criterios: [], prioridad: 'normal', fecha_limite: dia(5), fecha_limite_original: o.fecha_limite ?? dia(5), estado: 'asignada', entrega_url: null, entrega_nota: null,
    revision_nota: null, bloqueo_motivo: null, entregada_en: null, aprobada_en: null, rondas_revision: 0, origen_trabajo_id: null, created_at: ahora(), updated_at: ahora(), ...o });
  T({ titulo: 'Cobertura de la jornada del sábado', descripcion: 'Fotos del evento y selección de 20.', fecha_limite: dia(3), prioridad: 'alta', criterios: ['plazos', 'calidad'] });
  T({ titulo: 'Retratos del equipo', estado: 'devuelta', revision_nota: 'Falta el recorte vertical para Instagram.', entregada_en: ahora(), rondas_revision: 1, entrega_url: 'https://drive.example.com/retratos', fecha_limite: dia(-1) });
  T({ titulo: 'Banco de imágenes de marzo', estado: 'entregada', entregada_en: ahora(), entrega_url: 'https://drive.example.com/banco', fecha_limite: dia(2) });
  T({ titulo: 'Guía de encuadres', estado: 'aprobada', entregada_en: ahora(), aprobada_en: ahora(), entrega_nota: 'Guía de una página', origen: 'propia', asignada_por: U.m1 });
  T({ titulo: 'Esperar acceso al estudio', estado: 'bloqueada', bloqueo_motivo: 'Esperando llaves del estudio', fecha_limite: dia(8) });
  T({ titulo: 'Reel resumen del mes', asignada_a: U.m2, fecha_limite: dia(-3), estado: 'en_curso' });
  T({ titulo: 'Fotos del taller', asignada_a: U.m3, estado: 'entregada', entregada_en: ahora(), entrega_nota: 'Subidas al drive', fecha_limite: dia(4), asignada_por: U.sec });
  T({ titulo: 'Nota de prensa jornada', asignada_a: U.r1, fecha_limite: dia(6) });
  T({ titulo: 'Tarea de otro distrito', asignada_a: U.m4, fecha_limite: dia(6) });
  // 0021: algunas tareas llevan rol y actividad (para el reporte por actividad)
  ['Cobertura de la jornada del sábado', 'Retratos del equipo', 'Banco de imágenes de marzo', 'Fotos del taller'].forEach(t => { const x = DB.tareas.find(r => r.titulo === t); x.actividad_id = 2; x.rol_id = 1; x.rol_excepcion = false; });
  DB.tareas.find(r => r.titulo === 'Nota de prensa jornada').actividad_id = 1;

  /* Bienvenida (0025): las personas «que ya existían» quedan omitidas, como hace la migración, para no abrir el
     asistente en cada prueba. Con ?bv=1 nadie tiene fila (persona nueva: el asistente se abre solo);
     con ?bv=2, la persona va por la mitad (retomar); con ?bv=3 todas «ya existían» y no han visto las Novedades. */
  (() => {
    const bv = new URLSearchParams(location.search).get('bv') || sessionStorage.getItem('fake_bv') || '0';
    sessionStorage.setItem('fake_bv', bv);
    if (bv === '1') return;
    Object.entries(U).forEach(([k, id]) => {
      const p = DB.profiles.find(x => x.id === id);
      const perfil = p.es_admin ? 'admin' : p.tipo_miembro === 'secretario' ? 'secretario' : 'miembro';
      DB.bienvenida_estado.push({ persona_id: id, perfil, origen: bv === '3' ? 'existente' : 'nuevo', version: 1, pasos_hechos: bv === '2' ? ['rol', 'cuenta'] : [], paso_actual: bv === '2' ? 'preferencias' : null,
        omitida: bv !== '2' && bv !== '3', completada_en: null, created_at: ahora(), updated_at: ahora() });
    });
  })();

  /* ── Sesión simulada ── */
  const as = (new URLSearchParams(location.search).get('as')) || sessionStorage.getItem('fake_as') || 'admin';
  sessionStorage.setItem('fake_as', as);
  const meId = U[as] || U.admin;
  const me = () => DB.profiles.find(p => p.id === meId);
  const esAdmin = () => !!me().es_admin;
  const esSec = () => me().tipo_miembro === 'secretario';
  const distritoIds = () => esSec() ? DB.profiles.filter(p => p.distrito === me().distrito).map(p => p.id) : [];
  const permitidos = pid => { const pr = DB.profiles.find(x => x.id === pid); return [...new Set([pr?.rol_id, ...DB.persona_roles.filter(r => r.persona_id === pid).map(r => r.rol_id)].filter(x => x != null).map(Number))]; };
  const veTarea = t => esAdmin() || t.asignada_a === meId || (esSec() && distritoIds().includes(t.asignada_a));

  /* ── Motor de consultas ── */
  const clone = o => JSON.parse(JSON.stringify(o));
  const splitTop = s => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
  const REL = {
    'profiles.roles': r => DB.roles.find(x => x.id === r.rol_id) || null,
    'perfiles_rol.roles': r => DB.roles.find(x => x.id === r.rol_id) || null,
    'perfiles_rol.perfil_criterios': r => DB.perfil_criterios.filter(x => x.perfil_id === r.id),
    'rubrica.criterios': r => DB.criterios.find(x => x.id === r.criterio_id) || null,
    'evaluaciones_distrito.periodos_evaluacion': r => DB.periodos_evaluacion.find(x => x.id === r.periodo_id) || null,
  };
  function embed(table, rows, cols) {
    const items = splitTop(cols).map(c => c.match(/^(\w+)\((.*)\)$/)).filter(Boolean);
    return items.length ? rows.map(r => { const o = { ...r }; items.forEach(m => { o[m[1]] = clone(REL[`${table}.${m[1]}`]?.(r) ?? null); }); return o; }) : rows;
  }

  function visibles(table, rows) {
    if (table === 'tareas') return rows.filter(veTarea);
    if (table === 'tarea_eventos') return rows.filter(e => veTarea(DB.tareas.find(t => t.id === e.tarea_id) || {}));
    if (table === 'evaluaciones' && !esAdmin()) return rows.filter(e => e.estado === 'publicado' && (e.evaluado_id === meId || (esSec() && distritoIds().includes(e.evaluado_id))));
    if (table === 'profiles' && !esAdmin()) return rows.filter(p => p.id === meId || (esSec() && p.distrito === me().distrito));
    if (table === 'actividades' && !esAdmin()) return rows.filter(a => {
      const al = a.alcance || (a.distrito ? 'distrito' : 'equipo');
      if (al === 'equipo') return true;
      if (al === 'distrito') return a.distrito === me().distrito;
      const dest = DB.actividad_destinatarios.filter(d => d.actividad_id === a.id).map(d => d.persona_id);
      return a.creada_por === meId || dest.includes(meId) || (esSec() && (a.distrito === me().distrito || dest.some(p => distritoIds().includes(p))));
    });
    if (table === 'actividad_destinatarios' && !esAdmin()) return rows.filter(d => d.persona_id === meId || (esSec() && distritoIds().includes(d.persona_id)) || DB.actividades.find(a => a.id === d.actividad_id)?.creada_por === meId);
    if ((table === 'persona_roles' || table === 'preferencias_rol') && !esAdmin()) return rows.filter(r => r.persona_id === meId || (esSec() && distritoIds().includes(r.persona_id)));
    if (table === 'bienvenida_estado') return rows.filter(r => esAdmin() || r.persona_id === meId);
    return rows;
  }

  /* Reglas del servidor que la UI da por hechas (las de verdad están en SQL y probadas ahí). */
  /** Reglas de criterios_v2_validar (0020), simplificadas: lo que la UI necesita para probar mensajes. */
  function validarCriterio(p, rows) {
    p.nombre = String(p.nombre || '').trim();
    if (p.nombre.length < 1 || p.nombre.length > 80) throw new Error('El nombre del criterio debe tener entre 1 y 80 caracteres.');
    if (String(p.descripcion || '').length > 500) throw new Error('La descripcion no puede superar 500 caracteres.');
    p.tipo_campo = p.tipo_campo || 'escala'; p.descripcion = p.descripcion || ''; p.obligatorio = p.obligatorio !== false;
    if (p.tipo_campo !== 'escala' && p.tipo !== 'nucleo') throw new Error('Los campos de registro (si/no, opciones, texto) son comunes a todos los roles: un criterio tecnico es siempre de escala.');
    if (p.tipo_campo === 'opcion') {
      const o = (p.opciones || []).map(x => String(x).trim());
      if (o.length < 2 || o.length > 12) throw new Error('Un campo de opciones necesita entre 2 y 12 opciones.');
      if (new Set(o.map(x => x.toLowerCase())).size !== o.length) throw new Error('Hay una opcion repetida.');
      p.opciones = o;
    } else p.opciones = [];
  }
  const criterioUsado = key => DB.perfil_criterios.some(x => x.criterio_key === key) || DB.evaluaciones.some(e => key in (e.puntajes || {}) || key in (e.respuestas || {}));

  function validarTarea(old, nuevo) {
    const receptor = old.asignada_a === meId, rev = esAdmin() || (esSec() && !receptor && distritoIds().includes(old.asignada_a));
    if (nuevo.estado !== old.estado) {
      const ok = rev ? (old.estado === 'entregada' && ['aprobada', 'devuelta'].includes(nuevo.estado)) || (esAdmin() && nuevo.estado === 'entregada') || nuevo.estado === 'en_curso' || nuevo.estado === 'bloqueada'
                     : ['en_curso', 'entregada', 'bloqueada'].includes(nuevo.estado);
      if (!ok) throw new Error(`Transicion no permitida: ${old.estado} → ${nuevo.estado}.`);
      if (nuevo.estado === 'entregada') { if (!nuevo.entrega_url && (nuevo.entrega_nota || '').trim().length < 3) throw new Error('Para entregar, indica un enlace o escribe una nota de la entrega.'); nuevo.entregada_en = old.entregada_en || ahora(); }
      if (nuevo.estado === 'devuelta') { if ((nuevo.revision_nota || '').trim().length < 3) throw new Error('Al devolver una tarea explica que hay que corregir.'); nuevo.rondas_revision = old.rondas_revision + 1; }
      if (nuevo.estado === 'aprobada') nuevo.aprobada_en = ahora();
      if (nuevo.estado === 'bloqueada' && (nuevo.bloqueo_motivo || '').trim().length < 3) throw new Error('Una tarea bloqueada necesita un motivo.');
      if (old.estado === 'bloqueada') nuevo.bloqueo_motivo = null;
      DB.tarea_eventos.push({ id: seq.ev++, tarea_id: old.id, actor_id: meId, tipo: 'estado', de: old.estado, a: nuevo.estado, motivo: nuevo.revision_nota && nuevo.estado === 'devuelta' ? nuevo.revision_nota : nuevo.bloqueo_motivo ?? null, created_at: ahora() });
    }
    nuevo.updated_at = ahora();
    return nuevo;
  }

  class Q {
    constructor(t) { this.t = t; this.op = 'select'; this.cols = '*'; this.opts = {}; this.fs = []; this.ord = []; this.one = null; this.pl = null; this.rng = null; this.lim = null; }
    select(c = '*', o = {}) { if (this.op === 'select') { this.cols = c; this.opts = o; } else this.cols = c || '*'; return this; }
    insert(p) { this.op = 'insert'; this.pl = p; return this; }
    update(p) { this.op = 'update'; this.pl = p; return this; }
    upsert(p, o) { this.op = 'upsert'; this.pl = p; this.conf = o?.onConflict; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.fs.push(r => r[c] == v); return this; }
    is(c, v) { this.fs.push(r => (r[c] ?? null) === v); return this; }
    in(c, a) { this.fs.push(r => a.map(String).includes(String(r[c]))); return this; }
    order(c, o = {}) { this.ord.push([c, o.ascending !== false]); return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    limit(n) { this.lim = n; return this; }
    abortSignal() { return this; }
    limit() { return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    single() { this.one = 'one'; return this; }
    then(res, rej) { return this._run().then(res, rej); }
    async _run() {
      try {
        const rows = DB[this.t];
        if (!rows) return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${this.t}'` } };
        let out;
        if (this.op === 'insert' || this.op === 'upsert') {
          const arr = Array.isArray(this.pl) ? this.pl : [this.pl];
          out = arr.map(p => this._insert({ ...p }));
        } else if (this.op === 'update') {
          out = visibles(this.t, rows).filter(r => this.fs.every(f => f(r))).map(r => this._update(r));
        } else if (this.op === 'delete') {
          const del = visibles(this.t, rows).filter(r => this.fs.every(f => f(r)));
          if (this.t === 'tareas') { const ok = del.filter(t => esAdmin() || (t.asignada_por === meId && t.estado === 'asignada')); ok.forEach(t => rows.splice(rows.indexOf(t), 1)); out = ok; }
          else if (this.t === 'criterios_v2') {
            const ok = del.filter(c => { if (criterioUsado(c.key)) throw new Error('El criterio ' + c.key + ' esta en uso: solo se puede desactivar.'); return true; });
            ok.forEach(r => rows.splice(rows.indexOf(r), 1)); out = ok;
          }
          else { del.forEach(r => rows.splice(rows.indexOf(r), 1)); out = del; }
        } else {
          out = visibles(this.t, rows).filter(r => this.fs.every(f => f(r)));
        }
        this.ord.slice().reverse().forEach(([c, asc]) => out.sort((a, b) => ((a[c] ?? '9999') > (b[c] ?? '9999') ? 1 : (a[c] ?? '9999') < (b[c] ?? '9999') ? -1 : 0) * (asc ? 1 : -1)));
        const count = out.length;
        if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
        if (this.lim != null) out = out.slice(0, this.lim);
        out = clone(embed(this.t, out, this.cols));
        if (this.one) { if (out.length > 1 && this.one === 'one') return { data: null, error: { message: 'multiple rows' } }; if (!out.length && this.one === 'one') return { data: null, error: { message: 'no rows' } }; return { data: out[0] ?? null, error: null }; }
        return { data: out, error: null, count };
      } catch (e) { return { data: null, error: { message: e.message } }; }
    }
    _insert(p) {
      const rows = DB[this.t];
      if (this.t === 'tareas') {
        const prof = DB.profiles.find(x => x.id === p.asignada_a);
        if (!esAdmin() && p.asignada_a !== meId && !(esSec() && distritoIds().includes(p.asignada_a))) throw new Error(esSec() ? 'Solo puedes asignar tareas a miembros de tu distrito.' : 'Solo puedes crear tareas para ti.');
        if (!prof) throw new Error('Persona desconocida');
        Object.assign(p, { id: seq.tarea++, origen: p.asignada_a === meId ? 'propia' : 'asignada', asignada_por: meId, estado: 'asignada', fecha_limite_original: p.fecha_limite || null,
          entrega_url: null, entrega_nota: null, revision_nota: null, bloqueo_motivo: null, entregada_en: null, aprobada_en: null, rondas_revision: 0,
          criterios: p.criterios || [], prioridad: p.prioridad || 'normal', descripcion: p.descripcion || '', created_at: ahora(), updated_at: ahora() });
        // 0021: el rol de la tarea debe estar entre los permitidos de la persona (la administración puede salirse: queda marcado)
        p.rol_excepcion = false; p.rol_id = p.rol_id ?? null; p.actividad_id = p.actividad_id ?? null;
        if (p.rol_id != null) {
          const perm = permitidos(p.asignada_a);
          if (!perm.includes(Number(p.rol_id))) { if (esAdmin()) p.rol_excepcion = true; else throw new Error('Esa persona no tiene permitido ese rol: pide a la administracion que se lo habilite o elige otro.'); }
        }
        rows.push(p); DB.tarea_eventos.push({ id: seq.ev++, tarea_id: p.id, actor_id: meId, tipo: 'creada', a: 'asignada', motivo: p.origen, created_at: ahora() });
        return p;
      }
      if (this.t === 'criterios_v2') {
        if (!esAdmin()) throw new Error('new row violates row-level security policy for table "criterios_v2"');
        validarCriterio(p, rows);
        const slug = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'criterio';
        if (!p.key) { let b = slug(p.nombre), k = b, n = 1; while (rows.some(r => r.key === k)) k = b + '_' + (++n); p.key = k; }
        Object.assign(p, { id: rows.reduce((m, r) => Math.max(m, r.id), 0) + 1, orden: p.orden || rows.reduce((m, r) => Math.max(m, r.orden), 0) + 1, created_by: meId, created_at: ahora() });
        rows.push(p); return p;
      }
      if (this.t === 'actividades' || this.t === 'etiquetas') {
        if (this.t === 'etiquetas' && !esAdmin()) throw new Error('new row violates row-level security policy for table "etiquetas"');
        if (this.t === 'actividades') {
          if (!esAdmin() && !(esSec() && p.distrito && p.distrito === me().distrito)) throw new Error('Solo la administración crea actividades para todo el equipo; tú, para tu distrito.');
          if (p.fecha_fin && p.fecha_fin < p.fecha_inicio) throw new Error('new row violates check constraint "actividades_check"');
          p.creada_por = meId;
        }
        p.id = (rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0)) + 1; rows.push(p); return p;
      }
      if (this.t === 'evaluaciones') {
        const per = DB.periodos_evaluacion.find(x => x.id === p.periodo_id);
        const prev = rows.find(r => r.periodo_id === p.periodo_id && r.evaluado_id === p.evaluado_id);
        p.modelo = per.modelo;
        if (per.modelo !== 'v2') p.respuestas = {};
        if (per.modelo === 'v2') {
          p.respuestas = p.respuestas || {};
          for (const [k, v] of Object.entries(p.respuestas)) {
            const c = DB.criterios_v2.find(x => x.key === k && x.tipo_campo !== 'escala');
            if (!c) throw new Error('El campo "' + k + '" no aplica a esta evaluacion.');
            if (c.tipo_campo === 'si_no' && typeof v !== 'boolean') throw new Error('La respuesta de "' + c.nombre + '" debe ser si o no.');
            if (c.tipo_campo === 'opcion' && !c.opciones.includes(v)) throw new Error('La respuesta de "' + c.nombre + '" debe ser una de sus opciones.');
            if (c.tipo_campo === 'texto' && (typeof v !== 'string' || !v.trim() || v.length > 1000)) throw new Error('La respuesta de "' + c.nombre + '" debe ser un texto de hasta 1000 caracteres.');
          }
          if (p.estado === 'publicado') {
            const faltan = DB.criterios_v2.filter(c => c.activo && c.obligatorio && c.tipo_campo !== 'escala' && !(c.key in p.respuestas));
            if (faltan.length) throw new Error('No se puede publicar: faltan por completar: ' + faltan.map(c => c.nombre).join(', ') + '.');
          }
          p.escala = prev ? prev.escala : 'pesos';   // 0023: la fija el servidor
          const prof = DB.profiles.find(x => x.id === p.evaluado_id); p.perfil_id = prev?.perfil_id ?? DB.perfiles_rol.find(x => x.rol_id === prof.rol_id)?.id ?? null;
          for (const [k, v] of Object.entries(p.puntajes)) {
            if (!Number.isInteger(v)) throw new Error('El puntaje de "' + k + '" debe ser un numero entero.');
            if (p.escala === 'cinco') { if (v < 1 || v > 5) throw new Error('El puntaje de "' + k + '" debe ser un entero de 1 a 5.'); }
            else {
              const max = NUCLEO.some(x => x[0] === k) ? 10 : (DB.perfil_criterios.find(x => x.perfil_id === p.perfil_id && x.criterio_key === k)?.peso || 0);
              if (v < 0 || v > max) throw new Error('El puntaje de "' + k + '" debe ser un entero de 0 a ' + max + '.');
            }
          }
          if (!p.perfil_id) throw new Error('No hay un perfil de evaluacion vigente para ese rol en este periodo.');
          if (p.estado === 'publicado') { const need = [...NUCLEO.map(x => x[0]), ...DB.perfil_criterios.filter(x => x.perfil_id === p.perfil_id).map(x => x.criterio_key)].filter(k => !(k in p.puntajes)); if (need.length) throw new Error('No se puede publicar: faltan por puntuar: ' + need.join(', ') + '.'); }
        }
        if (prev) { Object.assign(prev, p, { updated_at: ahora() }); return prev; }
        Object.assign(p, { id: seq.eval++, created_at: ahora(), updated_at: ahora() }); rows.push(p); return p;
      }
      if (this.t === 'estadisticas_distrito') {
        // Igual que 0043: una secretaría escribe solo su distrito; cifras tipadas; captura obligatoria en la carpeta del distrito/período.
        if (!esAdmin() && !(esSec() && p.distrito_id === me().distrito)) throw new Error('new row violates row-level security policy for table "estadisticas_distrito"');
        for (const k of ['visualizaciones', 'cuentas_alcanzadas', 'visitas_perfil']) if (!(Number.isFinite(p[k]) && p[k] >= 0)) throw new Error('new row for relation "estadisticas_distrito" violates check constraint "estadisticas_distrito_' + k + '_check"');
        if (!Number.isFinite(p.seguidores_neto)) throw new Error('new row for relation "estadisticas_distrito" violates check constraint "estadisticas_distrito_seguidores_neto_check"');
        for (const k of ['pct_publicaciones', 'pct_historias', 'pct_reels']) if (!(Number.isFinite(p[k]) && p[k] >= 0 && p[k] <= 100)) throw new Error('new row for relation "estadisticas_distrito" violates check constraint "estadisticas_distrito_' + k + '_check"');
        if (!/^[A-Za-z0-9_-]+\/[^/]+\/[A-Za-z0-9._-]+\.(webp|jpe?g)$/.test(p.captura_path || '') || p.captura_path.split('/')[0] !== p.distrito_id || p.captura_path.split('/')[1] !== p.periodo_id) throw new Error('La captura de prueba es obligatoria y debe estar en la carpeta de este distrito y período.');
        const nombre = me().nombre || '';
        const prev = rows.find(r => r.periodo_id === p.periodo_id && r.distrito_id === p.distrito_id);
        if (prev) { Object.assign(prev, p, { subido_por: meId, subido_por_nombre: nombre, actualizado_en: ahora() }); return prev; }
        Object.assign(p, { id: rows.length + 1, subido_por: meId, subido_por_nombre: nombre, creado_en: ahora(), actualizado_en: ahora() }); rows.push(p); return p;
      }
      if (this.t === 'persona_roles') { if (!esAdmin()) throw new Error('new row violates row-level security policy for table "persona_roles"'); rows.push(p); return p; }
      if (this.t === 'periodos_evaluacion') { Object.assign(p, { id: 'aaaaaaaa-0000-0000-0000-0000000000' + (10 + rows.length), created_at: ahora(), activo: false, modelo: p.modelo || 'legacy' }); rows.push(p); return p; }
      if (!('id' in p)) p.id = (rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0)) + 1;
      rows.push(p); return p;
    }
    _update(r) {
      if (this.t === 'criterios_v2') {
        if (!esAdmin()) throw new Error('row-level security');
        const n = { ...r, ...this.pl }; validarCriterio(n, DB.criterios_v2);
        if (this.pl.tipo_campo && this.pl.tipo_campo !== r.tipo_campo && criterioUsado(r.key)) throw new Error('El criterio ' + r.key + ' esta en uso: no se cambia el tipo de campo.');
        Object.assign(r, this.pl); return r;
      }
      if (this.t === 'tareas') { const n = validarTarea(r, { ...r, ...this.pl }); Object.assign(r, n); return r; }
      if (this.t === 'actividades' && !esAdmin() && !(esSec() && r.distrito === me().distrito)) throw new Error('row-level security');
      Object.assign(r, this.pl); return r;
    }
  }

  /* ── RPC ── */
  const num = v => v == null ? null : Math.round(v * 10) / 10;
  function resultados(pid, borradores) {
    const per = DB.periodos_evaluacion.find(p => p.id === pid);
    if (!per || per.modelo !== 'v2') return [];
    const evs = DB.evaluaciones.filter(e => e.periodo_id === pid && e.modelo === 'v2' && (e.estado === 'publicado' || (esAdmin() && borradores)));
    const filas = evs.map(e => {
      const prof = DB.profiles.find(x => x.id === e.evaluado_id), pf = DB.perfiles_rol.find(x => x.id === e.perfil_id);
      const cinco = e.escala !== 'pesos';
      const nuc = NUCLEO.map(([k]) => e.puntajes[k]).filter(v => v != null).map(v => cinco ? (v - 1) / 4 * 100 : v / 10 * 100);
      const pesos = DB.perfil_criterios.filter(x => x.perfil_id === e.perfil_id).filter(x => e.puntajes[x.criterio_key] != null);
      const sp = pesos.reduce((a, x) => a + x.peso, 0);
      const tec = sp ? pesos.reduce((a, x) => a + x.peso * (cinco ? (e.puntajes[x.criterio_key] - 1) / 4 * 100 : e.puntajes[x.criterio_key] / x.peso * 100), 0) / sp : null;
      return { evaluado_id: e.evaluado_id, nombre: prof.nombre, distrito: prof.distrito, rol_id: pf.rol_id, rol_nombre: DB.roles.find(r => r.id === pf.rol_id).nombre, perfil_id: e.perfil_id, estado: e.estado,
        nucleo: nuc.length ? nuc.reduce((a, b) => a + b, 0) / nuc.length : null, tecnico: tec, escala: e.escala || 'cinco' };
    });
    filas.forEach(f => {
      const par = filas.filter(x => x.rol_id === f.rol_id); f.n_rol = par.length;
      const menores = par.filter(x => x.tecnico < f.tecnico).length, iguales = par.filter(x => x.tecnico === f.tecnico).length;
      f.rol_pequeno = f.n_rol < 4;
      f.percentil = f.n_rol >= 4 ? ((menores + 1 + (iguales - 1) / 2) - 1) / (f.n_rol - 1) * 100 : null;
      f.individual = 0.6 * f.tecnico + 0.4 * f.nucleo;
      f.general = 0.4 * f.nucleo + 0.6 * (f.percentil ?? f.tecnico);
    });
    return filas.filter(f => esAdmin() || f.evaluado_id === meId || (esSec() && distritoIds().includes(f.evaluado_id)))
      .map(f => ({ ...f, nucleo: num(f.nucleo), tecnico: num(f.tecnico), individual: num(f.individual), percentil: num(f.percentil), general: num(f.general) }));
  }
  function resumen(pid) {
    const por = {};
    DB.tareas.filter(t => t.periodo_id === pid && veTarea(t)).forEach(t => {
      const r = por[t.asignada_a] ||= { user_id: t.asignada_a, asignadas: 0, entregadas: 0, con_plazo: 0, a_tiempo: 0, vencidas_abiertas: 0, devoluciones: 0, bloqueadas: 0, propias_aprobadas: 0, prorrogas: 0, abiertas: 0 };
      const asig = t.origen === 'asignada';
      if (asig) r.asignadas++;
      if (asig && t.entregada_en) { r.entregadas++; if (t.fecha_limite) { r.con_plazo++; if (t.entregada_en.slice(0, 10) <= t.fecha_limite) r.a_tiempo++; } }
      if (asig && !t.entregada_en && ['asignada', 'en_curso'].includes(t.estado) && t.fecha_limite && t.fecha_limite < dia(0)) r.vencidas_abiertas++;
      if (asig) r.devoluciones += t.rondas_revision;
      if (t.estado === 'bloqueada') r.bloqueadas++;
      if (t.origen === 'propia' && t.estado === 'aprobada') r.propias_aprobadas++;
      if (['asignada', 'en_curso', 'devuelta', 'bloqueada'].includes(t.estado)) r.abiertas++;
    });
    return Object.values(por);
  }
  // ── Avisos de la campana (0022/0040): datos de ejemplo; el estado leído y las preferencias se guardan en sessionStorage ──
  // ?v40=0 simula una base SIN 0040 (nombres antiguos, sin categoría ni preferencias) para ver la degradación.
  const _v40 = new URLSearchParams(location.search).get('v40') !== '0';
  const META = {
    calificacion_nueva:    { cat: 'calificaciones', esencial: true,  titulo: 'Calificación nueva', desc: 'Publican una calificación o evaluación tuya.', dest: { m: 'perfil', sec: 'perfil', admin: 'evaluar' }, ref: 'evaluacion' },
    calificacion_cambiada: { cat: 'calificaciones', esencial: true,  titulo: 'Calificación modificada', desc: 'Corrigen una calificación ya publicada.', dest: { m: 'perfil', sec: 'perfil', admin: 'evaluar' }, ref: 'evaluacion' },
    observacion_nueva:     { cat: 'calificaciones', esencial: false, titulo: 'Observación nueva', desc: 'Recibes una observación o retroalimentación.', dest: { m: 'perfil', sec: 'perfil', admin: 'evaluar' }, ref: 'evaluacion' },
    tarea_asignada:        { cat: 'tareas', esencial: true,  titulo: 'Tarea asignada', desc: 'Te asignan una tarea.', dest: { m: 'trabajos', sec: 'trabajos', admin: 'tareas' }, ref: 'tarea' },
    tarea_colectiva_asignada: { cat: 'tareas', esencial: true, titulo: 'Tarea colectiva asignada', desc: 'A tu equipo le asignan una tarea.', dest: { m: 'trabajos', sec: 'trabajos', admin: 'tareas' }, ref: 'tarea' },
    tarea_cambio:          { cat: 'tareas', esencial: true,  titulo: 'Cambios en una tarea', desc: 'Cambia el responsable, las instrucciones o la fecha límite.', dest: { m: 'trabajos', sec: 'trabajos', admin: 'tareas' }, ref: 'tarea' },
    tarea_por_vencer:      { cat: 'tareas', esencial: false, titulo: 'Tarea por vencer', desc: 'Recordatorio: una tarea tuya vence hoy o mañana.', dest: { m: 'trabajos', sec: 'trabajos', admin: 'tareas' }, ref: 'tarea' },
    tarea_vencida:         { cat: 'tareas', esencial: true,  titulo: 'Tarea vencida', desc: 'Pasó la fecha límite de una tarea tuya.', dest: { m: 'trabajos', sec: 'trabajos', admin: 'tareas' }, ref: 'tarea' },
    entrega_registrada:    { cat: 'tareas', esencial: false, titulo: 'Entrega registrada', desc: 'Alguien entregó una tarea y espera tu revisión.', dest: { m: 'trabajos', sec: 'tareas', admin: 'tareas' }, ref: 'tarea' },
    correccion_solicitada: { cat: 'tareas', esencial: true,  titulo: 'Corrección solicitada', desc: 'Te devuelven una entrega con observaciones.', dest: { m: 'trabajos', sec: 'trabajos', admin: 'tareas' }, ref: 'tarea' },
    equipo_incorporado:    { cat: 'equipos', esencial: true, titulo: 'Incorporación a un equipo', desc: 'Te incorporan a un equipo.', dest: { m: 'inicio', sec: 'inicio', admin: 'inicio' }, ref: 'equipo' },
    equipo_retiro:         { cat: 'equipos', esencial: true, titulo: 'Retiro de un equipo', desc: 'Te retiran de un equipo.', dest: { m: 'inicio', sec: 'inicio', admin: 'inicio' }, ref: 'equipo' },
    estado_cambiado:       { cat: 'actividades', esencial: false, titulo: 'Cambio de estado', desc: 'Cambia de forma importante el estado de algo tuyo.', dest: { m: 'trabajos', sec: 'trabajos', admin: 'tareas' }, ref: 'tarea' },
    actividad_nueva:       { cat: 'actividades', esencial: false, titulo: 'Actividad nueva', desc: 'Agregan una actividad al calendario que te incluye.', dest: { m: 'calendario', sec: 'calendario', admin: 'agenda' }, ref: 'actividad' },
    actividad_recordatorio: { cat: 'actividades', esencial: false, titulo: 'Actividad de mañana', desc: 'Recordatorio de una actividad del día siguiente.', dest: { m: 'calendario', sec: 'calendario', admin: 'agenda' }, ref: 'actividad' },
    solicitud_acceso:      { cat: 'cuenta', esencial: true, titulo: 'Solicitud de acceso', desc: 'Alguien se registra y espera tu aprobación.', dest: { admin: 'usuarios' }, ref: 'persona', solo: ['admin'] },
    acceso_aprobado:       { cat: 'cuenta', esencial: true, titulo: 'Acceso aprobado', desc: 'Aprueban tu acceso al portal.', dest: { m: 'inicio', sec: 'inicio', admin: 'overview' }, ref: 'persona' },
    evaluaciones_sin_publicar: { cat: 'calificaciones', esencial: false, titulo: 'Evaluaciones sin publicar', desc: 'Se acerca el cierre y faltan evaluaciones.', dest: { admin: 'evaluar' }, ref: 'periodo', solo: ['admin'] },
  };
  const LEGADO = { calificacion_nueva: 'nota_publicada', correccion_solicitada: 'tarea_devuelta', entrega_registrada: 'entrega_por_revisar' };
  const _t0 = () => DB.tareas[0]?.id ?? 1;
  const AVISOS = [
    { id: 1, roles: ['m', 'sec'], tipo: 'correccion_solicitada', datos: { tarea: 'Retratos del equipo', revisor: 'Secretaría', observacion: 'Falta la versión vertical.' }, min: 120, ref: 't' },
    { id: 2, roles: ['m', 'sec'], tipo: 'tarea_asignada', datos: { tarea: 'Cobertura de la jornada', asignador: 'Administración', fecha_limite: '25/10/2026', prioridad: 'media' }, min: 300, ref: 't' },
    { id: 3, roles: ['m', 'sec', 'admin'], tipo: 'actividad_nueva', datos: { actividad: 'Jornada de creadores', fecha: '19/10/2026', etiqueta: 'Jornada' }, min: 60 * 26 },
    { id: 4, roles: ['m'], tipo: 'calificacion_nueva', datos: { periodo: 'PE1', evaluador: 'Secretaría' }, min: 60 * 24 * 9 },
    { id: 5, roles: ['admin', 'sec'], tipo: 'entrega_registrada', datos: { tarea: 'Reel de la semana', persona: 'Ana Fotógrafa', entregada: '16/10/2026', a_tiempo: 'Sí' }, min: 30, ref: 't' },
    { id: 6, roles: ['admin'], tipo: 'solicitud_acceso', datos: { persona: 'Keiry Polonia', correo: 'keiry@ejemplo.cl' }, min: 90 },
    { id: 7, roles: ['admin'], tipo: 'evaluaciones_sin_publicar', datos: { periodo: 'PE2', pendientes: 3, cierre: '27/10/2026' }, min: 60 * 5 },
    { id: 8, roles: ['m', 'sec'], tipo: 'equipo_incorporado', datos: { equipo: 'Cobertura fotográfica', rol_equipo: 'Fotógrafa', agregado_por: 'Administración' }, min: 45 },
    { id: 9, roles: ['m', 'sec'], tipo: 'tarea_cambio', datos: { tarea: 'Cobertura de la jornada', cambio: 'Fecha límite', antes: '25/10/2026', ahora: '28/10/2026', motivo: 'Se movió el evento' }, min: 200, ref: 't' },
    { id: 10, roles: ['m'], tipo: 'observacion_nueva', datos: { periodo: 'PE1', autor: 'Secretaría' }, min: 60 * 24 * 3 },
  ];
  const _rolAv = as === 'admin' ? 'admin' : (as === 'sec' ? 'sec' : 'm');
  const _llaveAv = 'fake_av_leidas_' + as;
  const _llavePf = 'fake_av_prefs_' + as;
  const _leidasAv = () => { try { return JSON.parse(sessionStorage.getItem(_llaveAv) || '[]'); } catch { return []; } };
  const _guardaLeidasAv = (v) => { try { sessionStorage.setItem(_llaveAv, JSON.stringify(v)); } catch { /* */ } };
  const _prefsAv = () => { try { return JSON.parse(sessionStorage.getItem(_llavePf) || '{}'); } catch { return {}; } };
  const _misAvisos = () => AVISOS.filter(x => x.roles.includes(_rolAv)).map(x => {
    const m = META[x.tipo];
    const fila = {
      id: x.id, tipo: _v40 ? x.tipo : (LEGADO[x.tipo] || x.tipo), datos: x.datos, ref_id: x.ref ? String(_t0()) : 'ref-' + x.id,
      creada: new Date(Date.now() - x.min * 60000).toISOString(), leida_en: _leidasAv().includes(x.id) ? ahora() : null,
    };
    return _v40 ? { ...fila, categoria: m.cat, esencial: m.esencial, ref_tipo: x.ref ? 'tarea' : m.ref, destino: m.dest[_rolAv] || m.dest.m || 'inicio' } : fila;
  });
  const hoyISO = dia(0);
  const nombreRol = id => DB.roles.find(r => r.id === id)?.nombre ?? null;
  const RPC = {
    hay_gestion_abierta: () => true,
    // ── 0021 ──
    personas_asignables: ({ p_periodo, p_rol }) => {
      if (!meId) throw new Error('Se requiere sesion.');
      if (!esAdmin() && !esSec()) return [];
      return DB.profiles.filter(p => !p.es_admin && p.aprobado !== false && (esAdmin() || (p.id !== meId && distritoIds().includes(p.id)))).map(p => {
        const pr = DB.preferencias_rol.find(x => x.persona_id === p.id && x.rol_id === p_rol);
        const mias = DB.tareas.filter(t => t.asignada_a === p.id && t.periodo_id === p_periodo);
        return { persona_id: p.id, nombre: p.nombre, email: p.email, distrito: p.distrito, tipo_miembro: p.tipo_miembro, rol_id: p.rol_id, rol_nombre: nombreRol(p.rol_id),
          activo_periodo: !DB.periodo_participantes.some(x => x.periodo_id === p_periodo && x.user_id === p.id && x.activo === false),
          permitido: p_rol == null ? null : permitidos(p.id).includes(Number(p_rol)), prioridad: p_rol == null ? null : (pr?.prioridad ?? null),
          predeterminado: p_rol == null ? null : !!pr?.es_predeterminado,
          tareas_abiertas: mias.filter(t => ['asignada', 'en_curso', 'devuelta', 'bloqueada'].includes(t.estado)).length,
          tareas_vencidas: mias.filter(t => ['asignada', 'en_curso', 'devuelta'].includes(t.estado) && t.fecha_limite && t.fecha_limite < hoyISO).length };
      }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    },
    guardar_preferencias_rol: ({ p_roles, p_predeterminado }) => {
      const roles = [...new Set(p_roles || [])];
      if (roles.length > 8) throw new Error('Puedes elegir hasta 8 roles de preferencia.');
      if (p_predeterminado != null && !roles.includes(p_predeterminado)) throw new Error('El rol predeterminado debe ser uno de tus roles de preferencia.');
      if (p_predeterminado != null && !permitidos(meId).includes(p_predeterminado)) throw new Error('El rol predeterminado debe estar entre los roles que tienes permitidos.');
      DB.preferencias_rol = DB.preferencias_rol.filter(x => x.persona_id !== meId);
      roles.forEach((r, i) => DB.preferencias_rol.push({ persona_id: meId, rol_id: r, prioridad: i + 1, es_predeterminado: p_predeterminado != null && r === p_predeterminado }));
      return null;
    },
    // ── 0024 ──
    guardar_actividad: a => {
      if (!esAdmin() && !esSec()) throw new Error('Solo la administracion y las secretarias crean actividades.');
      if (!['equipo', 'distrito', 'seleccion'].includes(a.p_alcance)) throw new Error('Alcance no valido.');
      const personas = [...new Set(a.p_personas || [])];
      if (a.p_alcance === 'seleccion') {
        if (!personas.length) throw new Error('Elige al menos una persona.');
        if (!esAdmin() && personas.some(p => !distritoIds().includes(p))) throw new Error('Solo puedes elegir personas de tu distrito.');
      }
      if (a.p_alcance === 'equipo' && !esAdmin()) throw new Error('Solo la administracion crea actividades para todo el equipo.');
      if (a.p_alcance === 'distrito' && !esAdmin() && a.p_distrito !== me().distrito) throw new Error('Solo puedes crear actividades de tu distrito.');
      if (a.p_fin && a.p_fin < a.p_inicio) throw new Error('new row for relation "actividades" violates check constraint "actividades_check"');
      const fila = { gestion_id: 1, titulo: a.p_titulo, descripcion: a.p_descripcion || '', etiqueta_id: a.p_etiqueta, fecha_inicio: a.p_inicio, fecha_fin: a.p_fin, alcance: a.p_alcance,
        distrito: a.p_alcance === 'equipo' ? null : a.p_alcance === 'distrito' ? a.p_distrito : (esAdmin() ? null : me().distrito) };
      let id = a.p_id;
      if (id) { const x = DB.actividades.find(r => r.id === id); if (!x) throw new Error('La actividad no existe.'); if (!esAdmin() && x.distrito !== me().distrito) throw new Error('No puedes editar esta actividad.'); Object.assign(x, fila); }
      else { id = DB.actividades.reduce((m, r) => Math.max(m, r.id), 0) + 1; DB.actividades.push({ id, ...fila, creada_por: meId }); }
      DB.actividad_destinatarios = DB.actividad_destinatarios.filter(d => d.actividad_id !== id);
      if (a.p_alcance === 'seleccion') personas.forEach(p => DB.actividad_destinatarios.push({ actividad_id: id, persona_id: p }));
      return id;
    },
    // ── 0025 ──
    seguimiento_global: ({ p_gestion }) => {
      if (!meId) throw new Error('Se requiere sesion.');
      const quienes = DB.profiles.filter(p => !p.es_admin && p.aprobado !== false && (esAdmin() || p.id === meId || (esSec() && distritoIds().includes(p.id))));
      const filas = [];
      DB.periodos_evaluacion.filter(p => p.gestion_id === Number(p_gestion ?? 1)).forEach((per, i) => {
        const res = per.modelo === 'v2' ? resultados(per.id, esAdmin()) : [];
        quienes.forEach(q => {
          const r = res.find(x => x.evaluado_id === q.id);
          const ev = DB.evaluaciones.find(e => e.periodo_id === per.id && e.evaluado_id === q.id);
          const cl = per.modelo !== 'v2' && ev ? Object.values(ev.puntajes).reduce((s, v) => s + (Number(v) || 0), 0) + (Number(ev.bono_ext) || 0) : null;
          const tk = DB.tareas.filter(t => t.periodo_id === per.id && t.asignada_a === q.id);
          const asig = tk.filter(t => t.origen === 'asignada');
          const conPlazo = asig.filter(t => t.entregada_en && t.fecha_limite);
          let estado = 'sin_evaluar';
          if (per.modelo === 'v2') estado = r ? r.estado : (ev ? (esAdmin() ? 'borrador' : 'sin_publicar') : 'sin_evaluar');
          else if (ev) estado = ev.estado === 'publicado' ? 'publicado' : (esAdmin() ? 'borrador' : 'sin_publicar');
          filas.push({ persona_id: q.id, nombre: q.nombre, distrito: q.distrito, rol_id: r?.rol_id ?? q.rol_id, rol_nombre: nombreRol(r?.rol_id ?? q.rol_id), periodo_id: per.id, periodo_nombre: per.nombre, periodo_orden: i + 1,
            modelo: per.modelo, periodo_activo: !!per.activo, participa: !DB.periodo_participantes.some(x => x.periodo_id === per.id && x.user_id === q.id && x.activo === false), estado_eval: estado,
            nucleo: r?.nucleo ?? null, tecnico: r?.tecnico ?? null, individual: r?.individual ?? null, general: r?.general ?? null,
            total_clasico: ev && (ev.estado === 'publicado' || esAdmin()) ? cl : null,
            tareas_total: tk.length, tareas_abiertas: tk.filter(t => ['asignada', 'en_curso', 'devuelta', 'bloqueada'].includes(t.estado)).length,
            tareas_vencidas: asig.filter(t => !t.entregada_en && ['asignada', 'en_curso'].includes(t.estado) && t.fecha_limite && t.fecha_limite < hoyISO).length,
            tareas_aprobadas: tk.filter(t => t.estado === 'aprobada').length, con_plazo: conPlazo.length,
            a_tiempo: conPlazo.filter(t => t.entregada_en.slice(0, 10) <= t.fecha_limite).length,
            puntos_suma: tk.filter(t => t.estado === 'aprobada' && t.puntos != null).reduce((s, t) => s + t.puntos, 0), puntos_n: tk.filter(t => t.estado === 'aprobada' && t.puntos != null).length });
        });
      });
      return filas.sort((a, b) => (a.rol_nombre || '~').localeCompare(b.rol_nombre || '~', 'es') || a.nombre.localeCompare(b.nombre, 'es') || a.periodo_orden - b.periodo_orden);
    },
    reporte_actividades: () => {
      if (!meId) throw new Error('Se requiere sesion.');
      const ver = p => esAdmin() || p.id === meId || (esSec() && distritoIds().includes(p.id));
      const filas = [];
      DB.actividades.filter(a => a.gestion_id === 1).forEach(a => {
        const tk = DB.tareas.filter(t => t.actividad_id === a.id && ver(DB.profiles.find(p => p.id === t.asignada_a)));
        const base = { actividad_id: a.id, titulo: a.titulo, fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin, alcance: a.alcance, etiqueta: DB.etiquetas.find(e => e.id === a.etiqueta_id)?.nombre ?? null };
        if (!tk.length) { if (esAdmin() || (esSec() && (a.alcance === 'equipo' || a.distrito === me().distrito))) filas.push({ ...base, persona_id: null, nombre: null, distrito: null, rol_nombre: null, asignadas: 0, entregadas: 0, con_plazo: 0, a_tiempo: 0, aprobadas: 0, vencidas: 0, puntos_suma: 0, puntos_n: 0 }); return; }
        [...new Set(tk.map(t => t.asignada_a))].forEach(pid => {
          const pr = DB.profiles.find(p => p.id === pid), mis = tk.filter(t => t.asignada_a === pid), asig = mis.filter(t => t.origen === 'asignada'), cp = asig.filter(t => t.entregada_en && t.fecha_limite);
          filas.push({ ...base, persona_id: pid, nombre: pr.nombre, distrito: pr.distrito, rol_nombre: nombreRol(pr.rol_id), asignadas: asig.length, entregadas: asig.filter(t => t.entregada_en).length,
            con_plazo: cp.length, a_tiempo: cp.filter(t => t.entregada_en.slice(0, 10) <= t.fecha_limite).length, aprobadas: mis.filter(t => t.estado === 'aprobada').length,
            vencidas: asig.filter(t => !t.entregada_en && ['asignada', 'en_curso'].includes(t.estado) && t.fecha_limite && t.fecha_limite < hoyISO).length,
            puntos_suma: mis.filter(t => t.estado === 'aprobada' && t.puntos != null).reduce((s, t) => s + t.puntos, 0), puntos_n: mis.filter(t => t.estado === 'aprobada' && t.puntos != null).length });
        });
      });
      return filas;
    },
    bienvenida_guardar: a => {
      const perfil = esAdmin() ? 'admin' : esSec() ? 'secretario' : 'miembro';
      const prev = DB.bienvenida_estado.find(x => x.persona_id === meId);
      const fila = { persona_id: meId, perfil, origen: prev?.origen ?? 'nuevo', version: 1, pasos_hechos: [...new Set(a.p_pasos || [])], paso_actual: a.p_actual ?? null, omitida: !!a.p_omitir,
        completada_en: a.p_terminar ? (prev?.completada_en || ahora()) : (prev?.completada_en ?? null), created_at: prev?.created_at || ahora(), updated_at: ahora() };
      if (prev) Object.assign(prev, fila); else DB.bienvenida_estado.push(fila);
      return null;
    },
    bienvenida_reiniciar: () => { DB.bienvenida_estado = DB.bienvenida_estado.filter(x => x.persona_id !== meId); return null; },
    mis_notificaciones: ({ p_limite = 40, p_antes = null, p_categoria = null, p_solo_sin_leer = false }) => {
      if (!meId) throw new Error('Se requiere sesion.');
      if (!_v40 && (p_categoria || p_solo_sin_leer)) throw Object.assign(new Error('Could not find the function public.mis_notificaciones'), { code: 'PGRST202' });
      let l = _misAvisos().sort((x, y) => y.creada.localeCompare(x.creada));
      if (p_antes) l = l.filter(x => x.creada < p_antes);
      if (p_categoria) l = l.filter(x => x.categoria === p_categoria);
      if (p_solo_sin_leer) l = l.filter(x => !x.leida_en);
      return l.slice(0, Math.max(1, Math.min(p_limite, 100)));
    },
    notif_no_leidas: () => { if (!meId) throw new Error('Se requiere sesion.'); return _misAvisos().filter(x => !x.leida_en).length; },
    notif_resumen: () => {
      if (!meId) throw new Error('Se requiere sesion.');
      if (!_v40) throw Object.assign(new Error('Could not find the function public.notif_resumen'), { code: 'PGRST202' });
      const por = {}; _misAvisos().forEach(x => { const c = (por[x.categoria] = por[x.categoria] || { categoria: x.categoria, total: 0, sin_leer: 0 }); c.total++; if (!x.leida_en) c.sin_leer++; });
      return Object.values(por);
    },
    notif_marcar_leida: ({ p_id }) => { const v = _leidasAv(); if (!_misAvisos().some(x => x.id === p_id)) return false; if (!v.includes(p_id)) { v.push(p_id); _guardaLeidasAv(v); } return true; },
    notif_marcar_todas: ({ p_categoria = null } = {}) => {
      const n = _misAvisos().filter(x => !x.leida_en && (!p_categoria || x.categoria === p_categoria));
      _guardaLeidasAv([...new Set([..._leidasAv(), ...n.map(x => x.id)])]); return n.length;
    },
    mis_preferencias_notif: () => {
      if (!meId) throw new Error('Se requiere sesion.');
      if (!_v40) throw Object.assign(new Error('Could not find the function public.mis_preferencias_notif'), { code: 'PGRST202' });
      const pf = _prefsAv();
      return Object.entries(META).filter(([, m]) => !m.solo || m.solo.includes(_rolAv))
        .map(([tipo, m]) => ({ tipo, categoria: m.cat, titulo: m.titulo, descripcion: m.desc, esencial: m.esencial, correo: m.esencial || pf[tipo] !== false }));
    },
    guardar_preferencias_notif: ({ p_prefs }) => {
      const pf = _prefsAv();
      for (const [t, v] of Object.entries(p_prefs || {})) {
        if (!META[t]) throw new Error('Tipo de aviso desconocido: ' + t + '.');
        if (META[t].esencial) throw new Error('El aviso «' + META[t].titulo + '» es esencial y no se puede desactivar.');
        pf[t] = !!v;
      }
      try { sessionStorage.setItem(_llavePf, JSON.stringify(pf)); } catch { /* */ }
      return Object.keys(p_prefs || {}).length;
    },
    notif_estado_envios: () => {
      if (!esAdmin()) throw new Error('Solo la administración ve el estado de los envíos.');
      return [{ tipo: 'tarea_asignada', correo_estado: 'enviado', motivo: null, total: 14 }, { tipo: 'calificacion_nueva', correo_estado: 'simulado', motivo: 'modo_prueba', total: 3 },
              { tipo: 'tarea_por_vencer', correo_estado: 'omitido', motivo: 'preferencia', total: 2 }, { tipo: 'entrega_registrada', correo_estado: 'pendiente', motivo: null, total: 1 }];
    },
    set_periodo_activo: ({ p_id }) => { DB.periodos_evaluacion.forEach(p => p.activo = p.id === p_id); return null; },
    resultados_periodo: a => { if (!meId) throw new Error('Se requiere sesion.'); return resultados(a.p_periodo, a.p_borradores); },
    resumen_tareas_periodo: a => resumen(a.p_periodo),
    prorrogar_tarea: a => {
      const t = DB.tareas.find(x => x.id === a.p_id); if (!t || !veTarea(t)) throw new Error('No existe esa tarea.');
      const receptor = t.asignada_a === meId;
      if (receptor && t.origen !== 'propia') throw new Error('No puedes cambiar la fecha limite de esta tarea.');
      if ((a.p_motivo || '').trim().length < 5) throw new Error('La prorroga necesita un motivo (minimo 5 caracteres).');
      DB.tarea_eventos.push({ id: seq.ev++, tarea_id: t.id, actor_id: meId, tipo: 'prorroga', de: t.fecha_limite, a: a.p_nueva, motivo: a.p_motivo, created_at: ahora() });
      t.fecha_limite = a.p_nueva; return null;
    },
    crear_perfil_rol: a => {
      const sum = Object.values(a.p_pesos).reduce((x, y) => x + y, 0); if (sum !== 100) throw new Error(`Los pesos del perfil deben sumar 100 (suman ${sum}).`);
      const v = Math.max(0, ...DB.perfiles_rol.filter(p => p.rol_id === a.p_rol_id).map(p => p.version)) + 1;
      const id = seq.perfil++; DB.perfiles_rol.push({ id, gestion_id: 1, rol_id: a.p_rol_id, version: v, vigente_desde_periodo: v > 1 ? a.p_vigente_desde : null, created_at: ahora() });
      Object.entries(a.p_pesos).forEach(([k, p]) => DB.perfil_criterios.push({ perfil_id: id, criterio_key: k, peso: p })); return id;
    },
  };

  /* ── Equipos, tareas colectivas y nota de tareas (0031–0036) ──────────────────────────────────────────
     Réplica MÍNIMA de lo que hace la base, solo para ver y recorrer las pantallas. Las reglas de verdad están en SQL y
     se prueban allí (tools/pruebas/sql-0031…0036); aquí se repiten las justas para que los botones respondan. */
  DB.equipos = [
    { id: 1, periodo_id: P.pe2, nombre: 'Cobertura de la jornada', descripcion: 'Foto y video del evento de cierre.', responsable_id: U.m1, distrito: null, estado: 'activo', created_at: ahora(), updated_at: ahora() },
    { id: 2, periodo_id: P.pe2, nombre: 'Redacción 08-01', descripcion: 'Notas de prensa del distrito.', responsable_id: U.r1, distrito: '08-01', estado: 'activo', created_at: ahora(), updated_at: ahora() },
    { id: 3, periodo_id: P.pe3, nombre: 'Equipo del PE3', descripcion: '', responsable_id: null, distrito: null, estado: 'inactivo', created_at: ahora(), updated_at: ahora() },
  ];
  DB.equipo_miembros = [[1, U.m1], [1, U.m2], [1, U.m3], [2, U.r1], [2, U.m5], [3, U.m4]].map(([e, p], i) => ({ id: i + 1, equipo_id: e, persona_id: p, desde: ahora(), hasta: null, excepcion: false }));
  DB.equipo_eventos = [{ id: 1, equipo_id: 1, actor_id: U.admin, tipo: 'creado', persona_id: null, detalle: {}, motivo: null, created_at: ahora() }];
  DB.tareas_equipo = [];
  DB.tarea_equipo_participantes = [];
  DB.tarea_equipo_aportes = [];
  DB.tarea_equipo_eventos = [];
  DB.calificaciones_historial = [];
  DB.periodo_calif_config = [
    { periodo_id: P.pe2, peso_tareas: 20, mult_individual: 1, mult_colectiva: 1, minimo_tareas: 1, contar_propias: true, vencidas_como_cero: false, confirmado: false },
    { periodo_id: P.pe3, peso_tareas: 0, mult_individual: 1, mult_colectiva: 1, minimo_tareas: 1, contar_propias: true, vencidas_como_cero: false, confirmado: true },
  ];
  DB.periodo_calif_config_hist = [];
  seq.teq = 1; seq.ap = 1; seq.hn = 1; seq.eqi = 100;
  DB.tareas.forEach(t => { t.peso = 1; t.puntos = t.puntos ?? null; t.puntos_original = t.puntos ?? null; t.nota_anulada_en = null; });
  { const g = DB.tareas.find(t => t.titulo === 'Guía de encuadres'); if (g) { g.puntos = 9; g.puntos_original = 9; } }
  const nuevaTE = o => { const t = { id: seq.teq++, equipo_id: 1, periodo_id: P.pe2, titulo: 'Tarea de equipo', descripcion: '', instrucciones: '', criterios_evaluacion: '', criterios: [], prioridad: 'normal',
    responsable_id: null, asignada_por: U.admin, asignada_en: ahora(), fecha_limite: dia(6), fecha_limite_original: undefined, estado: 'asignada', entrega_url: null, entrega_nota: null, entregada_por: null, entregada_en: null,
    revision_nota: null, bloqueo_motivo: null, rondas_revision: 0, aprobada_en: null, aprobada_por: null, puntos: null, puntos_original: null, peso: 1, nota_anulada_en: null, nota_anulada_motivo: null,
    anulada_en: null, anulacion_motivo: null, created_at: ahora(), updated_at: ahora(), ...o };
    if (t.fecha_limite_original === undefined) t.fecha_limite_original = t.fecha_limite;
    DB.tareas_equipo.push(t);
    DB.equipo_miembros.filter(m => m.equipo_id === t.equipo_id && !m.hasta).forEach(m => DB.tarea_equipo_participantes.push({ tarea_id: t.id, persona_id: m.persona_id, desde: ahora(), hasta: null, puntos_individual: null, individual_motivo: null }));
    DB.tarea_equipo_eventos.push({ id: seq.eqi++, tarea_id: t.id, actor_id: U.admin, tipo: 'creada', a: t.estado, motivo: t.titulo, created_at: ahora() });
    return t; };
  nuevaTE({ titulo: 'Reel del evento de cierre', descripcion: 'Un reel de 60 s con lo mejor de la jornada.', instrucciones: 'Formato vertical, subtítulos, música libre de derechos.', criterios_evaluacion: 'Ritmo, calidad de imagen y entrega a tiempo.', responsable_id: U.m1, prioridad: 'alta', criterios: ['plazos', 'calidad'] });
  nuevaTE({ titulo: 'Fotos del backstage', estado: 'entregada', entregada_por: U.m2, entregada_en: ahora(), entrega_url: 'https://drive.example.com/backstage', entrega_nota: '40 fotos seleccionadas', fecha_limite: dia(2), peso: 2 });
  nuevaTE({ titulo: 'Guion de la jornada', estado: 'aprobada', entregada_por: U.m1, entregada_en: ahora(), aprobada_en: ahora(), aprobada_por: U.admin, puntos: 8, puntos_original: 8, fecha_limite: dia(-4) });
  nuevaTE({ titulo: 'Notas del taller', equipo_id: 2, estado: 'en_curso', fecha_limite: dia(-1) });
  DB.tarea_equipo_aportes.push({ id: seq.ap++, tarea_id: 1, persona_id: U.m1, tipo: 'avance', nota: 'Guion y tomas listas', url: null, avance: 40, created_at: ahora() },
    { id: seq.ap++, tarea_id: 1, persona_id: U.m2, tipo: 'evidencia', nota: 'Borrador del montaje', url: 'https://drive.example.com/borrador', avance: null, created_at: ahora() });

  const eqVisible = e => esAdmin() || DB.equipo_miembros.some(m => m.equipo_id === e.id && m.persona_id === meId) || e.responsable_id === meId
    || (esSec() && ((e.distrito && e.distrito === me().distrito) || DB.equipo_miembros.some(m => m.equipo_id === e.id && distritoIds().includes(m.persona_id))));
  const eqVig = id => DB.equipo_miembros.filter(m => m.equipo_id === id && !m.hasta);
  const nomP = id => { const p = DB.profiles.find(x => x.id === id); return p ? (p.nombre || p.email) : null; };
  const partVig = (tid, pid = meId) => DB.tarea_equipo_participantes.some(p => p.tarea_id === tid && p.persona_id === pid && !p.hasta);
  const revisaTE = t => { const e = DB.equipos.find(x => x.id === t.equipo_id); return esAdmin() || (esSec() && e.distrito && e.distrito === me().distrito && !DB.tarea_equipo_participantes.some(p => p.tarea_id === t.id && p.persona_id === meId)); };
  const veTE = t => esAdmin() || DB.tarea_equipo_participantes.some(p => p.tarea_id === t.id && p.persona_id === meId) || t.responsable_id === meId || eqVisible(DB.equipos.find(x => x.id === t.equipo_id));
  const avanceTE = t => t.estado === 'anulada' ? null : ['aprobada', 'entregada'].includes(t.estado) ? 100 : (DB.tarea_equipo_aportes.filter(a => a.tarea_id === t.id && a.tipo === 'avance').sort((a, b) => b.id - a.id)[0]?.avance ?? 0);
  const venceTE = t => ['asignada', 'en_curso'].includes(t.estado) && !t.entregada_en && t.fecha_limite && t.fecha_limite < hoyISO;
  const cfgP = pid => DB.periodo_calif_config.find(c => c.periodo_id === pid) || { periodo_id: pid, peso_tareas: 0, mult_individual: 1, mult_colectiva: 1, minimo_tareas: 1, contar_propias: true, vencidas_como_cero: false, confirmado: false };

  /** Piezas candidatas de la nota de tareas (calif_items): las mismas reglas que 0034. */
  function califItems(pid) {
    const c = cfgP(pid), items = [];
    DB.tareas.filter(t => t.periodo_id === pid).forEach(t => {
      const venc = ['asignada', 'en_curso'].includes(t.estado) && !t.entregada_en && t.fecha_limite && t.fecha_limite < hoyISO;
      let razon, cuenta = false;
      if (t.estado === 'anulada') razon = 'tarea_anulada';
      else if (t.estado === 'aprobada') { if (t.nota_anulada_en) razon = 'nota_anulada'; else if (t.puntos == null) razon = 'sin_puntos'; else if (t.origen === 'propia' && !c.contar_propias) razon = 'propia_excluida'; else { razon = 'calificada'; cuenta = true; } }
      else if (venc) { razon = c.vencidas_como_cero ? 'vencida_como_cero' : 'vencida'; cuenta = c.vencidas_como_cero; }
      else razon = { entregada: 'pendiente_de_evaluacion', bloqueada: 'bloqueada', devuelta: 'devuelta' }[t.estado] || 'en_curso';
      items.push({ persona_id: t.asignada_a, tipo: 'individual', tarea_id: t.id, titulo: t.titulo, equipo_id: null, equipo_nombre: null, estado: t.estado, origen: t.origen, puntos: t.puntos, nota_grupo: null,
        individual_en_grupo: false, peso_tarea: t.peso, peso_efectivo: t.peso * c.mult_individual, cuenta, razon, fecha_limite: t.fecha_limite, aprobada_en: t.aprobada_en, vencida: !!venc });
    });
    DB.tareas_equipo.filter(t => t.periodo_id === pid).forEach(t => {
      DB.tarea_equipo_participantes.filter(p => p.tarea_id === t.id).forEach(p => {
        const participa = t.estado === 'aprobada' ? (!p.hasta || DB.tarea_equipo_aportes.some(a => a.tarea_id === t.id && a.persona_id === p.persona_id)) : !p.hasta;
        if (!participa && !['aprobada', 'anulada'].includes(t.estado)) return;
        const pts = p.puntos_individual ?? t.puntos, venc = venceTE(t);
        let razon, cuenta = false;
        if (t.estado === 'anulada') razon = 'tarea_anulada';
        else if (t.estado === 'aprobada') { if (!participa) razon = 'no_participo'; else if (t.nota_anulada_en) razon = 'nota_anulada'; else if (pts == null) razon = 'sin_puntos'; else { cuenta = true; razon = p.puntos_individual != null ? 'individual_en_grupo' : 'nota_del_grupo'; } }
        else if (venc) { razon = c.vencidas_como_cero ? 'vencida_como_cero' : 'vencida'; cuenta = c.vencidas_como_cero; }
        else razon = { entregada: 'pendiente_de_evaluacion', bloqueada: 'bloqueada', devuelta: 'devuelta' }[t.estado] || 'en_curso';
        items.push({ persona_id: p.persona_id, tipo: 'equipo', tarea_id: t.id, titulo: t.titulo, equipo_id: t.equipo_id, equipo_nombre: DB.equipos.find(e => e.id === t.equipo_id)?.nombre, estado: t.estado, origen: 'grupal',
          puntos: pts, nota_grupo: t.puntos, individual_en_grupo: p.puntos_individual != null, peso_tarea: t.peso, peso_efectivo: t.peso * c.mult_colectiva, cuenta, razon, fecha_limite: t.fecha_limite, aprobada_en: t.aprobada_en, vencida: venc });
      });
    });
    return items;
  }
  const califNota = (pid, persona) => {
    const c = cfgP(pid), it = califItems(pid).filter(i => i.persona_id === persona), cu = it.filter(i => i.cuenta);
    const s = cu.reduce((a, i) => a + i.peso_efectivo, 0);
    return { items: it, cuentan: cu.length, nota: cu.length >= c.minimo_tareas && s > 0 ? num(100 * cu.reduce((a, i) => a + i.peso_efectivo * (i.puntos ?? 0) / 10, 0) / s) : null, suma: s, cfg: c };
  };
  const puedeVer = pid => esAdmin() || pid === meId || (esSec() && distritoIds().includes(pid));

  // La evaluación integrada: individual y general ya incluyen la nota de tareas (0035).
  const resultadosBase = RPC.resultados_periodo;
  RPC.resultados_periodo = a => resultadosBase(a).map(f => {
    const t = califNota(a.p_periodo, f.evaluado_id), w = t.nota != null ? t.cfg.peso_tareas / 100 : 0;
    const ie = f.individual, ge = f.general;
    return { ...f, individual_eval: ie, general_eval: ge, tareas: t.nota, tareas_n: t.cuentan, peso_tareas: num(w * 100),
      individual: num((1 - w) * ie + w * (t.nota ?? 0)), general: num((1 - w) * ge + w * (t.nota ?? 0)) };
  });
  const segBase = RPC.seguimiento_global;
  RPC.seguimiento_global = a => segBase(a).map(f => {
    if (f.modelo !== 'v2') return f;
    const r = RPC.resultados_periodo({ p_periodo: f.periodo_id, p_borradores: esAdmin() }).find(x => x.evaluado_id === f.persona_id);
    return { ...f, individual: r?.individual ?? f.individual, general: r?.general ?? f.general, individual_eval: r?.individual_eval ?? null, tareas_nota: r?.tareas ?? null, tareas_n: r?.tareas_n ?? 0, peso_tareas: r?.peso_tareas ?? 0,
      colectivas_total: DB.tarea_equipo_participantes.filter(p => p.persona_id === f.persona_id && DB.tareas_equipo.find(t => t.id === p.tarea_id)?.periodo_id === f.periodo_id).length, colectivas_aprobadas: 0 };
  });

  const resumenEq = e => {
    const ts = DB.tareas_equipo.filter(t => t.equipo_id === e.id);
    return { equipo_id: e.id, periodo_id: e.periodo_id, periodo_nombre: DB.periodos_evaluacion.find(p => p.id === e.periodo_id).nombre, nombre: e.nombre, descripcion: e.descripcion, estado: e.estado, distrito: e.distrito,
      responsable_id: e.responsable_id, responsable_nombre: nomP(e.responsable_id), integrantes: eqVig(e.id).length, soy_integrante: eqVig(e.id).some(m => m.persona_id === meId),
      tareas_total: ts.filter(t => t.estado !== 'anulada').length, tareas_abiertas: ts.filter(t => ['asignada', 'en_curso', 'bloqueada', 'devuelta'].includes(t.estado)).length,
      tareas_por_revisar: ts.filter(t => t.estado === 'entregada').length, tareas_vencidas: ts.filter(venceTE).length, tareas_aprobadas: ts.filter(t => t.estado === 'aprobada').length,
      avance_promedio: ts.filter(t => t.estado !== 'anulada').length ? Math.round(ts.filter(t => t.estado !== 'anulada').reduce((a, t) => a + avanceTE(t), 0) / ts.filter(t => t.estado !== 'anulada').length) : null,
      alertas: esAdmin() ? eqVig(e.id).filter(m => e.distrito && DB.profiles.find(p => p.id === m.persona_id).distrito !== e.distrito && !m.excepcion).length : 0, created_at: e.created_at, updated_at: e.updated_at };
  };
  const soloAdmin = () => { if (!meId) throw new Error('Se requiere sesion.'); if (!esAdmin()) throw new Error('Solo la administracion gestiona equipos.'); };
  Object.assign(RPC, {
    equipos_resumen: ({ p_periodo }) => { if (!meId) throw new Error('Se requiere sesion.'); return DB.equipos.filter(e => (!p_periodo || e.periodo_id === p_periodo) && eqVisible(e)).map(resumenEq); },
    equipo_integrantes: ({ p_equipo, p_incluir_bajas }) => {
      const e = DB.equipos.find(x => x.id === p_equipo); if (!e || !eqVisible(e)) return [];
      return DB.equipo_miembros.filter(m => m.equipo_id === p_equipo && (p_incluir_bajas || !m.hasta)).map(m => { const p = DB.profiles.find(x => x.id === m.persona_id);
        return { persona_id: p.id, nombre: p.nombre, distrito: p.distrito, rol_id: p.rol_id, rol_nombre: nombreRol(p.rol_id), tipo_miembro: p.tipo_miembro, desde: m.desde, hasta: m.hasta, motivo_retiro: m.motivo_retiro ?? null,
          excepcion: !!m.excepcion, excepcion_motivo: m.excepcion_motivo ?? null, es_responsable: e.responsable_id === p.id,
          alerta: esAdmin() && !m.hasta && e.distrito && p.distrito !== e.distrito && !m.excepcion ? 'otro_distrito' : null }; });
    },
    equipo_guardar: a => {
      soloAdmin();
      if (!a.p_nombre || a.p_nombre.trim().length < 2) throw new Error('El nombre del equipo debe tener entre 2 y 80 caracteres.');
      if (a.p_id) { const e = DB.equipos.find(x => x.id === a.p_id); if (e.estado === 'archivado') throw new Error('Un equipo archivado no se edita; restauralo primero.');
        Object.assign(e, { nombre: a.p_nombre.trim(), descripcion: a.p_descripcion || '', responsable_id: a.p_responsable, distrito: a.p_distrito, updated_at: ahora() }); return e.id; }
      const per = DB.periodos_evaluacion.find(p => p.id === a.p_periodo);
      if (!per) throw new Error('Elige un PE existente para el equipo.');
      if (per.modelo !== 'v2') throw new Error('Los equipos solo existen en PE con la rubrica por roles; los anteriores conservan su evaluacion original.');
      if (DB.equipos.some(e => e.periodo_id === per.id && e.estado !== 'archivado' && e.nombre.toLowerCase() === a.p_nombre.trim().toLowerCase())) throw new Error('Ya hay un equipo con ese nombre en este PE.');
      const id = DB.equipos.reduce((m, e) => Math.max(m, e.id), 0) + 1;
      DB.equipos.push({ id, periodo_id: per.id, nombre: a.p_nombre.trim(), descripcion: a.p_descripcion || '', responsable_id: a.p_responsable, distrito: a.p_distrito, estado: 'activo', created_at: ahora(), updated_at: ahora() });
      DB.equipo_eventos.push({ id: seq.eqi++, equipo_id: id, actor_id: meId, tipo: 'creado', persona_id: null, detalle: {}, motivo: null, created_at: ahora() }); return id;
    },
    equipo_cambiar_estado: a => { soloAdmin(); const e = DB.equipos.find(x => x.id === a.p_equipo);
      if (a.p_estado === 'archivado') { const ab = DB.tareas_equipo.filter(t => t.equipo_id === e.id && ['asignada', 'en_curso', 'bloqueada', 'entregada', 'devuelta'].includes(t.estado)).length;
        if (ab) throw new Error(`No se puede archivar: tiene ${ab} tarea(s) colectiva(s) abierta(s). Cierralas o anulalas antes.`); if ((a.p_motivo || '').trim().length < 5) throw new Error('Archivar un equipo necesita un motivo (minimo 5 caracteres).'); }
      DB.equipo_eventos.push({ id: seq.eqi++, equipo_id: e.id, actor_id: meId, tipo: 'estado', persona_id: null, detalle: { de: e.estado, a: a.p_estado }, motivo: a.p_motivo || null, created_at: ahora() });
      e.estado = a.p_estado; return null; },
    equipo_agregar_miembros: a => { soloAdmin(); const e = DB.equipos.find(x => x.id === a.p_equipo); const ag = [], om = [];
      if (e.estado !== 'activo') throw new Error('Solo se agregan integrantes a un equipo activo.');
      [...new Set(a.p_personas || [])].forEach(pid => { const p = DB.profiles.find(x => x.id === pid);
        if (eqVig(e.id).some(m => m.persona_id === pid)) return om.push({ persona: pid, razon: 'ya_integrante' });
        if (!p || p.es_admin) return om.push({ persona: pid, razon: 'administracion' });
        if (e.distrito && p.distrito !== e.distrito && !a.p_excepcion) return om.push({ persona: pid, razon: 'otro_distrito' });
        DB.equipo_miembros.push({ id: seq.eqi++, equipo_id: e.id, persona_id: pid, desde: ahora(), hasta: null, excepcion: !!(e.distrito && p.distrito !== e.distrito), excepcion_motivo: a.p_motivo || null });
        DB.tareas_equipo.filter(t => t.equipo_id === e.id && ['asignada', 'en_curso', 'bloqueada', 'devuelta'].includes(t.estado)).forEach(t => DB.tarea_equipo_participantes.push({ tarea_id: t.id, persona_id: pid, desde: ahora(), hasta: null, puntos_individual: null }));
        DB.equipo_eventos.push({ id: seq.eqi++, equipo_id: e.id, actor_id: meId, tipo: 'miembro_alta', persona_id: pid, detalle: {}, motivo: null, created_at: ahora() }); ag.push(pid); });
      return { agregados: ag, omitidos: om }; },
    equipo_retirar_miembro: a => { soloAdmin(); if ((a.p_motivo || '').trim().length < 5) throw new Error('Retirar a alguien necesita un motivo (minimo 5 caracteres).');
      const m = DB.equipo_miembros.find(x => x.equipo_id === a.p_equipo && x.persona_id === a.p_persona && !x.hasta); if (!m) throw new Error('Esa persona no es integrante vigente del equipo.');
      m.hasta = ahora(); m.motivo_retiro = a.p_motivo;
      DB.tarea_equipo_participantes.filter(p => p.persona_id === a.p_persona && !p.hasta && DB.tareas_equipo.find(t => t.id === p.tarea_id)?.equipo_id === a.p_equipo && ['asignada', 'en_curso', 'bloqueada', 'devuelta', 'entregada'].includes(DB.tareas_equipo.find(t => t.id === p.tarea_id).estado)).forEach(p => { p.hasta = ahora(); });
      DB.equipo_eventos.push({ id: seq.eqi++, equipo_id: a.p_equipo, actor_id: meId, tipo: 'miembro_baja', persona_id: a.p_persona, detalle: {}, motivo: a.p_motivo, created_at: ahora() }); return null; },
    tareas_equipo_estado: ({ p_equipo, p_periodo }) => { if (!meId) throw new Error('Se requiere sesion.');
      return DB.tareas_equipo.filter(t => (!p_equipo || t.equipo_id === p_equipo) && (!p_periodo || t.periodo_id === p_periodo) && veTE(t)).map(t => ({
        tarea_id: t.id, equipo_id: t.equipo_id, equipo_nombre: DB.equipos.find(e => e.id === t.equipo_id).nombre, periodo_id: t.periodo_id, titulo: t.titulo, descripcion: t.descripcion, instrucciones: t.instrucciones,
        criterios_evaluacion: t.criterios_evaluacion, criterios: t.criterios, prioridad: t.prioridad, estado: t.estado, fecha_limite: t.fecha_limite, fecha_limite_original: t.fecha_limite_original, asignada_en: t.asignada_en,
        responsable_id: t.responsable_id, responsable_nombre: nomP(t.responsable_id), avance: avanceTE(t), participantes: DB.tarea_equipo_participantes.filter(p => p.tarea_id === t.id && !p.hasta).length,
        aportes: DB.tarea_equipo_aportes.filter(a => a.tarea_id === t.id).length, entrega_url: t.entrega_url, entrega_nota: t.entrega_nota, entregada_por: t.entregada_por, entregada_por_nombre: nomP(t.entregada_por),
        entregada_en: t.entregada_en, revision_nota: t.revision_nota, bloqueo_motivo: t.bloqueo_motivo, rondas_revision: t.rondas_revision, puntos: t.puntos, puntos_original: t.puntos_original, peso: t.peso,
        nota_anulada: !!t.nota_anulada_en, aprobada_en: t.aprobada_en, vencida: venceTE(t), soy_participante: partVig(t.id), puedo_revisar: revisaTE(t) })).sort((a, b) => (a.fecha_limite || '9') < (b.fecha_limite || '9') ? -1 : 1); },
    tarea_equipo_aportar: a => { const t = DB.tareas_equipo.find(x => x.id === a.p_tarea); if (!t || !veTE(t)) throw new Error('No tienes acceso a esta tarea.');
      if (!partVig(t.id) && !(revisaTE(t) && a.p_tipo === 'comentario')) throw new Error(a.p_tipo === 'comentario' ? 'No tienes acceso a esta tarea.' : 'Quien revisa deja comentarios; los avances y evidencias los aportan los integrantes.');
      if (a.p_tipo === 'avance' && a.p_avance == null) throw new Error('Un avance necesita su porcentaje (0 a 100).');
      const id = seq.ap++; DB.tarea_equipo_aportes.push({ id, tarea_id: t.id, persona_id: meId, tipo: a.p_tipo, nota: a.p_nota, url: a.p_url, avance: a.p_tipo === 'avance' ? a.p_avance : null, created_at: ahora() }); return id; },
    tarea_equipo_prorrogar: a => { const t = DB.tareas_equipo.find(x => x.id === a.p_id); if (!t || !revisaTE(t)) throw new Error('No puedes cambiar la fecha limite de esta tarea.');
      if ((a.p_motivo || '').trim().length < 5) throw new Error('La prorroga necesita un motivo (minimo 5 caracteres).');
      DB.tarea_equipo_eventos.push({ id: seq.eqi++, tarea_id: t.id, actor_id: meId, tipo: 'prorroga', de: t.fecha_limite, a: a.p_nueva, motivo: a.p_motivo, created_at: ahora() }); t.fecha_limite = a.p_nueva; return null; },
    tarea_equipo_participacion: ({ p_tarea }) => { const t = DB.tareas_equipo.find(x => x.id === p_tarea); if (!t || !veTE(t)) return [];
      return DB.tarea_equipo_participantes.filter(p => p.tarea_id === p_tarea).map(p => ({ persona_id: p.persona_id, nombre: nomP(p.persona_id), desde: p.desde, hasta: p.hasta,
        aportes: DB.tarea_equipo_aportes.filter(a => a.tarea_id === p_tarea && a.persona_id === p.persona_id).length, ultimo_aporte: DB.tarea_equipo_aportes.filter(a => a.tarea_id === p_tarea && a.persona_id === p.persona_id).map(a => a.created_at).sort().pop() ?? null,
        entrego: t.entregada_por === p.persona_id, es_responsable: t.responsable_id === p.persona_id, puntos_individual: revisaTE(t) || p.persona_id === meId ? p.puntos_individual : null, individual_motivo: null })); },
    equipo_resultados: ({ p_equipo }) => { const e = DB.equipos.find(x => x.id === p_equipo); if (!e || !eqVisible(e)) return [];
      const ap = DB.tareas_equipo.filter(t => t.equipo_id === p_equipo && t.estado === 'aprobada' && t.puntos != null && !t.nota_anulada_en), sp = ap.reduce((a, t) => a + t.peso, 0);
      const filas = [{ persona_id: null, nombre: 'Equipo', tareas_cuentan: ap.length, tareas_total: DB.tareas_equipo.filter(t => t.equipo_id === p_equipo && t.estado !== 'anulada').length, nota: sp ? num(100 * ap.reduce((a, t) => a + t.peso * t.puntos / 10, 0) / sp) : null, con_nota_individual: 0 }];
      eqVig(p_equipo).forEach(m => { if (!puedeVer(m.persona_id)) return; const it = califItems(e.periodo_id).filter(i => i.persona_id === m.persona_id && i.equipo_id === p_equipo), cu = it.filter(i => i.cuenta), s = cu.reduce((a, i) => a + i.peso_tarea, 0);
        filas.push({ persona_id: m.persona_id, nombre: nomP(m.persona_id), tareas_cuentan: cu.length, tareas_total: it.filter(i => i.razon !== 'tarea_anulada').length, nota: s ? num(100 * cu.reduce((a, i) => a + i.peso_tarea * i.puntos / 10, 0) / s) : null, con_nota_individual: cu.filter(i => i.individual_en_grupo).length }); });
      return filas; },
    calif_config: ({ p_periodo }) => { const c = cfgP(p_periodo); return [{ ...c, definida: true }]; },
    calif_config_guardar: a => { if (!esAdmin()) throw new Error('Solo la administracion define las reglas de calificacion.');
      if (a.p_peso_tareas < 0 || a.p_peso_tareas > 100) throw new Error('El peso de las tareas va de 0 a 100 %.');
      const pub = DB.evaluaciones.some(e => e.periodo_id === a.p_periodo && e.estado === 'publicado'); if (pub && (a.p_motivo || '').trim().length < 5) throw new Error('Ya hay evaluaciones publicadas: cambiar las reglas cambia sus resultados; explica el motivo (minimo 5 caracteres).');
      let c = DB.periodo_calif_config.find(x => x.periodo_id === a.p_periodo); if (!c) DB.periodo_calif_config.push(c = { periodo_id: a.p_periodo });
      Object.assign(c, { peso_tareas: a.p_peso_tareas, mult_individual: a.p_mult_individual, mult_colectiva: a.p_mult_colectiva, minimo_tareas: a.p_minimo_tareas, contar_propias: a.p_contar_propias, vencidas_como_cero: a.p_vencidas_como_cero, confirmado: true }); return null; },
    tareas_calificacion_detalle: ({ p_periodo, p_persona }) => { const p = p_persona || meId; if (!puedeVer(p)) return [];
      const c = cfgP(p_periodo), it = califItems(p_periodo).filter(i => i.persona_id === p), s = it.filter(i => i.cuenta).reduce((a, i) => a + i.peso_efectivo, 0);
      return it.map(i => ({ ...i, aporte_pct: i.cuenta ? num(100 * i.peso_efectivo / s) : null, aporte_puntos: i.cuenta ? num(100 * i.peso_efectivo * (i.puntos ?? 0) / 10 / s) : null })).sort((a, b) => Number(b.cuenta) - Number(a.cuenta)); },
    tareas_calificacion_resumen: ({ p_periodo }) => DB.profiles.filter(p => !p.es_admin && puedeVer(p.id)).map(p => { const n = califNota(p_periodo, p.id); return n.items.length ? { persona_id: p.id, nota: n.nota, n_cuentan: n.cuentan, n_individuales: 0, n_colectivas: 0, suma_pesos: n.suma,
      n_pendientes: n.items.filter(i => i.razon === 'pendiente_de_evaluacion').length, n_abiertas: 0, n_vencidas: n.items.filter(i => i.razon.startsWith('vencida')).length, n_anuladas: 0, suficiente: n.nota != null, minimo: n.cfg.minimo_tareas, peso_tareas: n.cfg.peso_tareas } : null; }).filter(Boolean),
    corregir_nota_tarea: a => notaAdmin('corregir', a), anular_nota_tarea: a => notaAdmin('anular', a), restaurar_nota_tarea: a => notaAdmin('restaurar', a),
    nota_individual_equipo: a => { const t = DB.tareas_equipo.find(x => x.id === a.p_tarea); if (!t || !(esAdmin() || revisaTE(t))) throw new Error('No puedes calificar a las personas de esta tarea.');
      if ((a.p_motivo || '').trim().length < 10) throw new Error('Una nota individual distinta a la del grupo necesita su evidencia o motivo (minimo 10 caracteres).');
      const p = DB.tarea_equipo_participantes.find(x => x.tarea_id === t.id && x.persona_id === a.p_persona); if (!p) throw new Error('Esa persona no participa en la tarea.');
      DB.calificaciones_historial.push({ id: seq.hn++, tarea_tipo: 'equipo', tarea_id: t.id, periodo_id: t.periodo_id, persona_id: a.p_persona, accion: a.p_puntos == null ? 'individual_retirada' : 'individual', puntos_anterior: p.puntos_individual ?? t.puntos, puntos_nuevo: a.p_puntos, motivo: a.p_motivo, actor_id: meId, contexto: { titulo: t.titulo }, created_at: ahora() });
      p.puntos_individual = a.p_puntos; return null; },
  });
  function notaAdmin(que, a) {
    if (!esAdmin()) throw new Error('Solo la administracion corrige, anula o restaura una calificacion.');
    if ((a.p_motivo || '').trim().length < 5) throw new Error('Toda modificacion de una calificacion necesita su justificacion (minimo 5 caracteres).');
    const t = (a.p_tipo === 'equipo' ? DB.tareas_equipo : DB.tareas).find(x => x.id === a.p_id);
    if (!t || t.estado !== 'aprobada') throw new Error('Solo una tarea aprobada tiene calificacion que modificar.');
    const ant = t.puntos;
    if (que === 'corregir') { if (a.p_puntos == null || a.p_puntos < 0 || a.p_puntos > 10) throw new Error('Los puntos van de 0 a 10.'); if (t.nota_anulada_en) throw new Error('La calificacion esta anulada: restaurala antes de corregirla.'); if (a.p_puntos === t.puntos) throw new Error('Indica unos puntos distintos a los actuales.'); t.puntos = a.p_puntos; }
    if (que === 'anular') { if (t.nota_anulada_en) throw new Error('La calificacion ya esta anulada.'); t.nota_anulada_en = ahora(); t.nota_anulada_motivo = a.p_motivo; }
    if (que === 'restaurar') { if (!t.nota_anulada_en) throw new Error('La calificacion no esta anulada.'); t.nota_anulada_en = null; }
    DB.calificaciones_historial.push({ id: seq.hn++, tarea_tipo: a.p_tipo, tarea_id: t.id, periodo_id: t.periodo_id, persona_id: a.p_tipo === 'individual' ? t.asignada_a : null,
      accion: { corregir: 'corregida', anular: 'anulada', restaurar: 'restaurada' }[que], puntos_anterior: ant, puntos_nuevo: t.puntos, motivo: a.p_motivo, actor_id: meId, contexto: { titulo: t.titulo, peso_tarea: t.peso, peso_tareas_pct: cfgP(t.periodo_id).peso_tareas }, created_at: ahora() });
    return null;
  }
  // Tablas nuevas: visibilidad y escritura mínimas
  const visiblesBase = visibles;
  visibles = (table, rows) => {
    if (table === 'manuales_privados') return esAdmin() ? rows : [];
    if (table === 'estadisticas_distrito') return rows.filter(r => esAdmin() || (esSec() && r.distrito_id === me().distrito));
    if (table === 'equipos') return rows.filter(eqVisible);
    if (table === 'equipo_miembros') return rows.filter(m => esAdmin() || m.persona_id === meId || (!m.hasta && eqVig(m.equipo_id).some(x => x.persona_id === meId)) || (esSec() && distritoIds().includes(m.persona_id)));
    if (table === 'equipo_eventos') return esAdmin() ? rows : [];
    if (table === 'tareas_equipo') return rows.filter(veTE);
    if (table === 'tarea_equipo_aportes' || table === 'tarea_equipo_eventos') return rows.filter(r => veTE(DB.tareas_equipo.find(t => t.id === r.tarea_id) || {}));
    if (table === 'calificaciones_historial') return rows.filter(h => esAdmin() || h.persona_id === meId || (h.tarea_tipo === 'equipo' && !h.persona_id && veTE(DB.tareas_equipo.find(t => t.id === h.tarea_id) || {})));
    if (table === 'periodo_calif_config_hist') return esAdmin() ? rows : [];
    return visiblesBase(table, rows);
  };
  /** Transiciones de tareas colectivas (resumen de 0032). */
  function validarTE(old, nuevo) {
    const part = partVig(old.id), rev = revisaTE(old);
    if (['aprobada', 'anulada'].includes(old.estado) && !esAdmin()) throw new Error(`Una tarea ${old.estado} no se modifica.`);
    if (nuevo.estado !== old.estado) {
      const okP = (old.estado === 'asignada' && ['en_curso', 'entregada', 'bloqueada'].includes(nuevo.estado)) || (old.estado === 'en_curso' && ['entregada', 'bloqueada'].includes(nuevo.estado)) || (old.estado === 'devuelta' && ['en_curso', 'entregada', 'bloqueada'].includes(nuevo.estado)) || (old.estado === 'bloqueada' && nuevo.estado === 'en_curso');
      const okR = (old.estado === 'entregada' && ['aprobada', 'devuelta'].includes(nuevo.estado)) || (nuevo.estado === 'anulada' && old.estado !== 'aprobada') || (old.estado === 'bloqueada' && nuevo.estado === 'en_curso');
      if (!(esAdmin() || (rev && okR) || (part && okP))) throw new Error(`Transicion no permitida: ${old.estado} → ${nuevo.estado}.`);
      if (nuevo.estado === 'entregada') { if (!nuevo.entrega_url && (nuevo.entrega_nota || '').trim().length < 3) throw new Error('Para entregar, indica un enlace o escribe una nota de la entrega.'); nuevo.entregada_en = old.entregada_en || ahora(); nuevo.entregada_por = meId; }
      if (nuevo.estado === 'devuelta') { if ((nuevo.revision_nota || '').trim().length < 3) throw new Error('Al devolver una tarea explica que hay que corregir.'); nuevo.rondas_revision = old.rondas_revision + 1; }
      if (nuevo.estado === 'aprobada') { if (nuevo.puntos == null) throw new Error('Al aprobar una tarea asigna sus puntos (de 0 a 10).'); nuevo.aprobada_en = ahora(); nuevo.aprobada_por = meId; nuevo.puntos_original = nuevo.puntos;
        DB.calificaciones_historial.push({ id: seq.hn++, tarea_tipo: 'equipo', tarea_id: old.id, periodo_id: old.periodo_id, persona_id: null, accion: 'calificada', puntos_anterior: null, puntos_nuevo: nuevo.puntos, motivo: null, actor_id: meId, contexto: { titulo: old.titulo, peso_tarea: nuevo.peso, peso_tareas_pct: cfgP(old.periodo_id).peso_tareas }, created_at: ahora() }); }
      if (nuevo.estado === 'bloqueada' && (nuevo.bloqueo_motivo || '').trim().length < 3) throw new Error('Una tarea bloqueada necesita un motivo.');
      if (nuevo.estado === 'anulada') { if ((nuevo.anulacion_motivo || '').trim().length < 5) throw new Error('Anular una tarea necesita un motivo (minimo 5 caracteres).'); nuevo.anulada_en = ahora(); }
      if (!['aprobada', 'anulada'].includes(nuevo.estado)) { nuevo.puntos = null; nuevo.puntos_original = null; nuevo.nota_anulada_en = null; }
      DB.tarea_equipo_eventos.push({ id: seq.eqi++, tarea_id: old.id, actor_id: meId, tipo: 'estado', de: old.estado, a: nuevo.estado, motivo: nuevo.revision_nota || nuevo.bloqueo_motivo || nuevo.anulacion_motivo || null, created_at: ahora() });
    }
    nuevo.updated_at = ahora(); return nuevo;
  }
  Q.prototype._insertBase = Q.prototype._insert;
  Q.prototype._insert = function (p) {
    if (this.t === 'tareas_equipo') {
      const e = DB.equipos.find(x => x.id === p.equipo_id);
      if (!e || !(esAdmin() || (esSec() && e.distrito && e.distrito === me().distrito))) throw new Error('new row violates row-level security policy for table "tareas_equipo"');
      if (e.estado !== 'activo') throw new Error('Solo se asignan tareas a un equipo activo.');
      if (!eqVig(e.id).length) throw new Error('El equipo no tiene integrantes vigentes.');
      return nuevaTE({ ...p, periodo_id: e.periodo_id, asignada_por: meId, fecha_limite_original: p.fecha_limite || null });
    }
    return this._insertBase(p);
  };
  Q.prototype._updateBase = Q.prototype._update;
  Q.prototype._update = function (r) {
    if (this.t === 'tareas_equipo') { const n = validarTE(r, { ...r, ...this.pl }); Object.assign(r, n); return r; }
    return this._updateBase(r);
  };

  const listeners = [];
  window.SB = {
    from: t => new Q(t),
    rpc: async (n, a) => { try { if (!RPC[n]) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${n}` } }; return { data: RPC[n](a || {}), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } },
    auth: {
      // ?as=anon: sin sesión (para ver el login y la recuperación de contraseña)
      getSession: async () => (as === 'anon' ? { data: { session: null } } : { data: { session: { user: { id: meId, email: me().email, user_metadata: {} } } } }),
      getUser: async () => (as === 'anon' ? { data: { user: null }, error: null } : { data: { user: { id: meId, email: me().email } }, error: null }),
      signInWithPassword: async () => ({ data: null, error: { message: 'Invalid login credentials' } }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      signOut: async () => ({}), signUp: async ({ email }) => (String(email).includes('existe') ? { data: null, error: { message: 'User already registered' } } : { data: { user: { email } }, error: null }), onAuthStateChange: cb => { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    },
    storage: { from: bucket => ({
      upload: async (path, file) => { if (bucket === 'capturas-distrito') { if (!esAdmin() && !(esSec() && path.split('/')[0] === me().distrito)) return { error: { message: 'new row violates row-level security policy for table "objects"' } }; (DB._capturas = DB._capturas || {})[path] = file; } return { error: null }; },
      remove: async paths => { (paths || []).forEach(x => { if (DB._capturas) delete DB._capturas[x]; }); return { error: null }; },
      createSignedUrl: async path => ({ data: { signedUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#e8eef7"/><text x="40" y="80" font-family="sans-serif" font-size="28" fill="#334">Captura de prueba (simulador)</text><text x="40" y="130" font-family="sans-serif" font-size="20" fill="#556">' + String(path).replace(/[<&>]/g, "") + '</text></svg>') }, error: null }),
      getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  };
  window.__FAKE = { DB, U, P, as };
})();
