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
    roles: [{ id: 1, nombre: 'Fotografía', activo: true, orden: 1 }, { id: 2, nombre: 'Redacción', activo: true, orden: 2 },
            { id: 3, nombre: 'Dirección', activo: true, orden: 3 }],
    distritos: [{ id: '08-01', nombre: 'Distrito 08-01', activo: true }, { id: '08-02', nombre: 'Distrito 08-02', activo: true }],
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
    calendario: [], config: [], periodo_participantes: [], trabajos_entregados: [],
    etiquetas: [['Entrega', 'coral'], ['Jornada', 'violeta'], ['Capacitación', 'verde'], ['Reunión', 'ambar'], ['Hito', 'cian']].map(([nombre, tono], i) => ({ id: i + 1, gestion_id: 1, nombre, tono, orden: i + 1 })),
    actividades: [
      { id: 1, gestion_id: 1, titulo: 'Jornada de cierre', descripcion: 'Presentación de resultados del período.', etiqueta_id: 2, fecha_inicio: dia(18), fecha_fin: dia(19), distrito: null, creada_por: U.admin },
      { id: 2, gestion_id: 1, titulo: 'Taller de fotografía', descripcion: 'Práctica de luz natural.', etiqueta_id: 3, fecha_inicio: dia(5), fecha_fin: null, distrito: null, creada_por: U.admin },
      { id: 3, gestion_id: 1, titulo: 'Reunión del distrito 08-01', descripcion: '', etiqueta_id: 4, fecha_inicio: dia(2), fecha_fin: null, distrito: '08-01', creada_por: U.sec },
      { id: 4, gestion_id: 1, titulo: 'Reunión del distrito 08-02', descripcion: '', etiqueta_id: 4, fecha_inicio: dia(3), fecha_fin: null, distrito: '08-02', creada_por: U.admin },
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
    evaluaciones: [], evaluaciones_distrito: [], tareas: [], tarea_eventos: [],
  };
  let seq = { eval: 1, tarea: 1, ev: 1, perfil: 3 };

  /* ── Datos semilla ── */
  const nucleoPts = v => Object.fromEntries(NUCLEO.map(([k]) => [k, v]));
  const fotoPts = v => ({ encuadre: v, tecnico: v, diseno: v, planificacion: v, revision: v });
  const redPts = v => ({ narrativa: v, ortografia: v, revision: v, planificacion: v });
  const addEval = (periodo, ev, pts, estado = 'publicado', perfil = null) => DB.evaluaciones.push({
    id: seq.eval++, periodo_id: periodo, evaluado_id: ev, evaluador_id: U.admin, puntajes: pts, bono_ext: 0, comentarios: {},
    estado, modelo: DB.periodos_evaluacion.find(p => p.id === periodo).modelo, perfil_id: perfil, created_at: ahora(), updated_at: ahora() });
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

  /* ── Sesión simulada ── */
  const as = (new URLSearchParams(location.search).get('as')) || sessionStorage.getItem('fake_as') || 'admin';
  sessionStorage.setItem('fake_as', as);
  const meId = U[as] || U.admin;
  const me = () => DB.profiles.find(p => p.id === meId);
  const esAdmin = () => !!me().es_admin;
  const esSec = () => me().tipo_miembro === 'secretario';
  const distritoIds = () => esSec() ? DB.profiles.filter(p => p.distrito === me().distrito).map(p => p.id) : [];
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
    if (table === 'actividades' && !esAdmin()) return rows.filter(a => !a.distrito || a.distrito === me().distrito);
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
    in(c, a) { this.fs.push(r => a.map(String).includes(String(r[c]))); return this; }
    order(c, o = {}) { this.ord.push([c, o.ascending !== false]); return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    limit(n) { this.lim = n; return this; }
    abortSignal() { return this; }
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
          for (const [k, v] of Object.entries(p.puntajes)) if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error(`El puntaje de "${k}" debe ser un entero de 1 a 5.`);
          const prof = DB.profiles.find(x => x.id === p.evaluado_id); p.perfil_id = prev?.perfil_id ?? DB.perfiles_rol.find(x => x.rol_id === prof.rol_id)?.id ?? null;
          if (!p.perfil_id) throw new Error('No hay un perfil de evaluacion vigente para ese rol en este periodo.');
          if (p.estado === 'publicado') { const need = [...NUCLEO.map(x => x[0]), ...DB.perfil_criterios.filter(x => x.perfil_id === p.perfil_id).map(x => x.criterio_key)].filter(k => !(k in p.puntajes)); if (need.length) throw new Error('No se puede publicar: faltan por puntuar: ' + need.join(', ') + '.'); }
        }
        if (prev) { Object.assign(prev, p, { updated_at: ahora() }); return prev; }
        Object.assign(p, { id: seq.eval++, created_at: ahora(), updated_at: ahora() }); rows.push(p); return p;
      }
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
      const nuc = NUCLEO.map(([k]) => e.puntajes[k]).filter(v => v != null).map(v => (v - 1) / 4 * 100);
      const pesos = DB.perfil_criterios.filter(x => x.perfil_id === e.perfil_id).filter(x => e.puntajes[x.criterio_key] != null);
      const sp = pesos.reduce((a, x) => a + x.peso, 0);
      const tec = sp ? pesos.reduce((a, x) => a + x.peso * ((e.puntajes[x.criterio_key] - 1) / 4 * 100), 0) / sp : null;
      return { evaluado_id: e.evaluado_id, nombre: prof.nombre, distrito: prof.distrito, rol_id: pf.rol_id, rol_nombre: DB.roles.find(r => r.id === pf.rol_id).nombre, perfil_id: e.perfil_id, estado: e.estado,
        nucleo: nuc.length ? nuc.reduce((a, b) => a + b, 0) / nuc.length : null, tecnico: tec };
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
  const RPC = {
    hay_gestion_abierta: () => true,
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

  const listeners = [];
  window.SB = {
    from: t => new Q(t),
    rpc: async (n, a) => { try { if (!RPC[n]) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${n}` } }; return { data: RPC[n](a || {}), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: meId, email: me().email, user_metadata: {} } } } }),
      signOut: async () => ({}), signUp: async ({ email }) => (String(email).includes('existe') ? { data: null, error: { message: 'User already registered' } } : { data: { user: { email } }, error: null }), onAuthStateChange: cb => { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    },
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  };
  window.__FAKE = { DB, U, P, as };
})();
