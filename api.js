'use strict';
/**
 * EIGHT CREATORS LABs — Capa de datos (Supabase JS)
 * Depende de: supabase-client.js (SB)
 *
 * HOOK_NOTIFICACION: cuando se publique una evaluación, aquí se
 * engancharía la llamada a Resend/Edge Function. Busca el comentario
 * "// HOOK_NOTIFICACION" más abajo para ver el punto exacto.
 */
/** Total de perfiles devuelto por la última getAllUsers() (para paginar). */
let _totalUsuarios = 0;

/**
 * Gestión sobre la que se está trabajando. Se fija en getContexto().
 * Todo lo que se escriba (períodos, criterios, rúbrica, calendario, config)
 * pertenece a esta gestión: sus tablas ya no tienen unicidad global.
 */
let _gestionActual = null;

/**
 * Id de la gestión en curso, resolviéndolo si hace falta.
 * admin.js llama a getPeriodos()/getCriterios() directamente en el arranque,
 * sin pasar por getContexto(), así que no puede asumirse que ya esté fijado.
 */
async function _gid() {
  if (_gestionActual != null) return _gestionActual;
  const { data } = await SB.from('gestiones').select('id').eq('activa', true).maybeSingle();
  _gestionActual = data?.id ?? null;
  return _gestionActual;
}

const API = {

  // ── AUTH ────────────────────────────────────────────────────────
  async login(email, password) {
    const { error } = await SB.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /**
   * Alta de cuenta. SOLO acepta email, contraseña y nombre.
   *
   * SEGURIDAD: no escribe en `profiles`. La fila la crea el trigger
   * on_auth_user_created (migración 0001) con valores fijos del servidor:
   * tipo_miembro='miembro', es_admin=false, distrito=NULL, rol_id=NULL,
   * aprobado=false. El cliente no puede influir en ninguno.
   *
   * Antes se hacía un upsert desde aquí con los valores del formulario, que
   * incluía un <select> con la opción "Secretario". Además, con "Confirm
   * email" activo aún no hay sesión en signUp, así que auth.uid() es NULL y
   * el upsert fallaba en silencio dejando usuarios sin perfil.
   */
  async register({ email, password, nombre }) {
    const { error } = await SB.auth.signUp({
      email, password,
      options: { data: { nombre } },   // solo se usa para el nombre a mostrar
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  // ── REFERENCIA (todos los autenticados pueden leer) ──────────────
  async getRoles(soloActivos = true) {
    let q = SB.from('roles').select('*').order('orden');
    if (soloActivos) q = q.eq('activo', true);
    const { data } = await q;
    return data ?? [];
  },

  /**
   * Períodos. LANZA si la query falla, en vez de devolver [].
   * Un [] silencioso hacía que el portal cayera al fallback duro
   * ['PE1','PE2','PE3'] y el usuario veía PE1 sin ningún error visible.
   */
  async getPeriodos() {
    const g = await _gid();
    let q = SB.from('periodos_evaluacion').select('*').order('created_at');
    if (g != null) q = q.eq('gestion_id', g);
    const { data, error } = await q;
    if (error) throw new Error('No se pudieron cargar los períodos: ' + error.message);
    return data ?? [];
  },

  /** Criterios. LANZA si falla: sin ellos no se puede puntuar nada. */
  async getCriterios(onlyActive = false) {
    const g = await _gid();
    let q = SB.from('criterios').select('*');
    if (g != null) q = q.eq('gestion_id', g);
    if (onlyActive) q = q.eq('activo', true);
    const { data, error } = await q.order('orden');
    if (error) throw new Error('No se pudieron cargar los criterios: ' + error.message);
    return data ?? [];
  },

  async getRubrica() {
    const g = await _gid();
    let q = SB.from('rubrica').select('*, criterios(key, label, abbr, color)').order('orden');
    if (g != null) q = q.eq('gestion_id', g);
    const { data } = await q;
    return data ?? [];
  },

  async saveCriterio({ id, key, label, abbr, color, orden, activo }) {
    const p = { key: key.trim().toLowerCase(), label: label.trim(), abbr: abbr.trim().toUpperCase(), color, orden: Number(orden) || 99, activo };
    const { error } = id
      ? await SB.from('criterios').update(p).eq('id', id)
      : await SB.from('criterios').insert({ ...p, gestion_id: await _gid() });
    return { ok: !error, error: error?.message };
  },

  async deleteCriterio(id) {
    const { error } = await SB.from('criterios').delete().eq('id', id);
    return { ok: !error, error: error?.message };
  },

  async saveRubricaRow({ id, criterio_id, criterio, nivel4, nivel3, nivel2, nivel1, orden }) {
    const p = { criterio_id: Number(criterio_id), criterio, nivel4, nivel3, nivel2, nivel1, orden: Number(orden) || 99 };
    const { error } = id
      ? await SB.from('rubrica').update(p).eq('id', id)
      : await SB.from('rubrica').insert({ ...p, gestion_id: await _gid() });
    return { ok: !error, error: error?.message };
  },

  async deleteRubricaRow(id) {
    const { error } = await SB.from('rubrica').delete().eq('id', id);
    return { ok: !error, error: error?.message };
  },

  async getCalendario() {
    const g = await _gid();
    let q = SB.from('calendario').select('*').order('numero');
    if (g != null) q = q.eq('gestion_id', g);
    const { data } = await q;
    return data ?? [];
  },

  async getConfig() {
    const g = await _gid();
    let qc = SB.from('config').select('*');
    if (g != null) qc = qc.eq('gestion_id', g);
    const { data } = await qc;
    const cfg = {};
    (data ?? []).forEach(r => { cfg[r.clave] = r.valor; });
    return cfg;
  },

  async saveConfig(clave, valor) {
    // La PK de config pasó a ser (gestion_id, clave) en la migración 0005:
    // la misma clave puede existir en gestiones distintas.
    const { error } = await SB.from('config')
      .upsert({ gestion_id: await _gid(), clave, valor }, { onConflict: 'gestion_id,clave' });
    return { ok: !error, error: error?.message };
  },

  /* getMisEvaluaciones() vivía aquí y no la llamaba nadie: cero referencias
     en todo el repositorio. Llevaba el mismo embed que tumbó los portales
     (`evaluador:evaluador_id(nombre)`, sobre una FK que apunta a auth.users),
     así que era una bomba esperando a que alguien la usara. Los portales van
     por getContenido() y getMiHistorial(). Si algún día hace falta, se
     reescribe sin embed. */

  // ── ADMIN: usuarios ──────────────────────────────────────────────
  /**
   * Usuarios, paginado (3.4). Antes traía los ~200 perfiles completos de
   * una vez, aunque la tabla solo muestre una página.
   *
   * `*` en vez de lista explícita a propósito: si se nombra `aprobado` y la
   * migración 0001 aún no se ha aplicado, PostgREST devuelve error 42703 y
   * la lista del admin queda vacía. Con `*` funciona en ambos casos.
   */
  async getAllUsers({ pagina = 0, porPagina = 100 } = {}) {
    const desde = pagina * porPagina;
    const { data, error, count } = await SB
      .from('profiles')
      .select('*, roles(id, nombre)', { count: 'exact' })
      .order('nombre')
      .range(desde, desde + porPagina - 1);
    if (error) { console.warn('[API.getAllUsers]', error.message); return []; }
    _totalUsuarios = count ?? (data?.length ?? 0);
    return data ?? [];
  },

  /** Total de perfiles según la última llamada a getAllUsers(). */
  totalUsuarios() { return _totalUsuarios; },

  async updateUserRol(user_id, rol_id) {
    const { error } = await SB.from('profiles').update({ rol_id }).eq('id', user_id);
    return { ok: !error, error: error?.message };
  },

  async updateUserAdmin(user_id, es_admin) {
    const { error } = await SB.from('profiles').update({ es_admin }).eq('id', user_id);
    return { ok: !error, error: error?.message };
  },

  /** Aprueba o revoca el acceso al portal. Solo admin (lo garantiza RLS). */
  async updateUserAprobado(user_id, aprobado) {
    const { error } = await SB.from('profiles').update({ aprobado }).eq('id', user_id);
    return { ok: !error, error: error?.message };
  },

  async deleteUserProfile(user_id) {
    const { error } = await SB.from('profiles').delete().eq('id', user_id);
    return { ok: !error, error: error?.message };
  },

  async updateUserProfile(user_id, fields) {
    const allowed = {};
    if ('distrito'     in fields) allowed.distrito     = fields.distrito || null;
    if ('tipo_miembro' in fields) allowed.tipo_miembro = fields.tipo_miembro || 'miembro';
    if ('nombre'       in fields) allowed.nombre       = (fields.nombre || '').trim() || null;
    if (!Object.keys(allowed).length) return { ok: false, error: 'Nada que actualizar' };
    const { error } = await SB.from('profiles').update(allowed).eq('id', user_id);
    return { ok: !error, error: error?.message };
  },

  // ── ADMIN: roles ─────────────────────────────────────────────────
  async saveRol({ id, nombre, activo = true, orden = 99 }) {
    const p = { nombre: nombre.trim(), activo, orden };
    const { error } = id
      ? await SB.from('roles').update(p).eq('id', id)
      : await SB.from('roles').insert(p);
    return { ok: !error, error: error?.message };
  },

  async deleteRol(id) {
    const { error } = await SB.from('roles').delete().eq('id', id);
    return { ok: !error, error: error?.message };
  },

  // ── ADMIN: períodos ──────────────────────────────────────────────
  /**
   * Crea o actualiza un período. NO toca `activo`: eso va por
   * setPeriodoActivo(), que es atómico y respeta el índice único.
   */
  async savePeriodo({ id, nombre, descripcion = '', fechas = {} }) {
    const p = {
      nombre:            nombre.trim(),
      descripcion:       descripcion.trim(),
      fecha_inicio:      fechas.inicio     || null,
      fecha_fin_trabajo: fechas.finTrabajo || null,
      fecha_entrega:     fechas.entrega    || null,
      fecha_jornada:     fechas.jornada    || null,
    };
    const { data, error } = id
      ? await SB.from('periodos_evaluacion').update(p).eq('id', id).select('id').maybeSingle()
      : await SB.from('periodos_evaluacion').insert({ ...p, gestion_id: await _gid() }).select('id').maybeSingle();
    return { ok: !error, error: error?.message, id: data?.id ?? id ?? null };
  },

  /**
   * Cambia el período activo de forma atómica vía RPC (migración 0003).
   * Pasar null deja la gestión sin período en curso.
   *
   * El bucle JS anterior hacía N updates secuenciales: si uno fallaba
   * quedaban dos períodos activos y find(p => p.activo) tomaba el primero
   * por created_at. Ahora la base garantiza que solo haya uno.
   */
  async setPeriodoActivo(id) {
    const { error } = await SB.rpc('set_periodo_activo', { p_id: id ?? null });
    return { ok: !error, error: error?.message };
  },

  async deletePeriodo(id) {
    const { error } = await SB.from('periodos_evaluacion').delete().eq('id', id);
    return { ok: !error, error: error?.message };
  },

  // ── ADMIN: evaluaciones ──────────────────────────────────────────
  async getEvaluacionesByPE(periodo_id) {
    const { data, error, status } = await SB
      .from('evaluaciones')
      .select('*')
      .eq('periodo_id', periodo_id)
      .order('created_at');
    if (error) console.error('[API] getEvaluacionesByPE ERROR:', error, 'status:', status);
    debug('[API] getEvaluacionesByPE periodo_id:', periodo_id, '→', data?.length ?? 0, 'rows', data?.length ? data[0] : '(empty)');
    // El .map() de aquí resolvía `e.evaluado?.id` como respaldo, resto de
    // una versión con joins. Con select('*') esas propiedades no llegan
    // nunca, así que el respaldo era siempre undefined.
    return data ?? [];
  },

  /** Carga una evaluación específica por (periodo, evaluado). */
  async getEvaluacion(periodo_id, evaluado_id) {
    const { data } = await SB
      .from('evaluaciones')
      .select('*')
      .eq('periodo_id', periodo_id)
      .eq('evaluado_id', evaluado_id)
      .maybeSingle();
    return data;
  },

  async upsertEvaluacion({ periodo_id, evaluado_id, evaluador_id, puntajes, bono_ext, comentarios, estado = 'borrador' }) {
    const { data, error } = await SB
      .from('evaluaciones')
      .upsert(
        { periodo_id, evaluado_id, evaluador_id, puntajes, bono_ext: bono_ext ?? 0, comentarios, estado },
        { onConflict: 'periodo_id,evaluado_id' }
      )
      .select()
      .single();
    if (error) return { ok: false, error: error.message };

    // HOOK_NOTIFICACION: descomentar cuando se active Resend + Edge Functions
    // if (estado === 'publicado') {
    //   await fetch(`${SUPABASE_URL}/functions/v1/notificar-evaluacion`, {
    //     method: 'POST',
    //     headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ evaluacion_id: data.id }),
    //   });
    // }

    return { ok: true, data };
  },

  // ── ADMIN: calendario ────────────────────────────────────────────
  async saveCalEvento(ev) {
    const { id, ...p } = ev;
    const { error } = id
      ? await SB.from('calendario').update(p).eq('id', id)
      : await SB.from('calendario').insert({ ...p, gestion_id: await _gid() });
    return { ok: !error, error: error?.message };
  },

  async deleteCalEvento(id) {
    const { error } = await SB.from('calendario').delete().eq('id', id);
    return { ok: !error, error: error?.message };
  },

  // ── ADMIN: participantes por PE ──────────────────────────────────
  async getParticipantes(periodo_id) {
    const { data, error } = await SB.from('periodo_participantes').select('user_id, activo').eq('periodo_id', periodo_id);
    if (error) console.error('getParticipantes error:', error);
    return data ?? [];
  },

  async setParticipante(periodo_id, user_id, activo) {
    const { error } = await SB.from('periodo_participantes')
      .upsert({ periodo_id, user_id, activo }, { onConflict: 'periodo_id,user_id' });
    return { ok: !error, error: error?.message };
  },

  // ── DISTRITOS ────────────────────────────────────────────────────────
  async getDistritos() {
    const { data } = await SB.from('distritos').select('*').eq('activo', true).order('id');
    return data ?? [];
  },

  async getEvalDistritosByPE(periodo_id) {
    const { data } = await SB
      .from('evaluaciones_distrito')
      .select('*')
      .eq('periodo_id', periodo_id);
    return data ?? [];
  },

  async getEvalDistritoHistorial(distrito_id) {
    const { data } = await SB
      .from('evaluaciones_distrito')
      .select('*, periodos_evaluacion(nombre)')
      .eq('distrito_id', distrito_id)
      .eq('estado', 'publicado')
      .order('updated_at');
    return data ?? [];
  },

  async getEvalDistritoByNombreAndPE(distNombre, peNombre) {
    // Acotado a la gestión en curso: los nombres de PE se repiten entre
    // gestiones, así que sin este filtro maybeSingle() encontraría varias
    // filas y devolvería null.
    const g = await _gid();
    let qp = SB.from('periodos_evaluacion').select('id').eq('nombre', peNombre);
    if (g != null) qp = qp.eq('gestion_id', g);
    const { data: pe } = await qp.maybeSingle();
    if (!pe) return null;
    const { data } = await SB
      .from('evaluaciones_distrito')
      .select('*')
      .eq('distrito_id', distNombre)
      .eq('periodo_id', pe.id)
      .eq('estado', 'publicado')
      .maybeSingle();
    return data;
  },

  async getEvalDistrito(periodo_id, distrito_id) {
    const { data } = await SB
      .from('evaluaciones_distrito')
      .select('*')
      .eq('periodo_id', periodo_id)
      .eq('distrito_id', distrito_id)
      .maybeSingle();
    return data;
  },

  async upsertEvalDistrito({ periodo_id, distrito_id, evaluador_id, ig_stats, puntajes, comentarios, estado = 'borrador' }) {
    const { data, error } = await SB
      .from('evaluaciones_distrito')
      .upsert(
        { periodo_id, distrito_id, evaluador_id, ig_stats, puntajes, comentarios, estado,
          updated_at: new Date().toISOString() },
        { onConflict: 'periodo_id,distrito_id' }
      )
      .select()
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  },

  // ── TRABAJOS ENTREGADOS ──────────────────────────────────────────────
  /**
   * Trabajos del usuario en un período. Indexado por periodo_id (UUID).
   *
   * Antes se guardaba `periodo_nombre` TEXT. Con multi-gestión los nombres
   * de PE se repiten entre gestiones, así que "PE3" dejaría de identificar
   * un período. La migración 0005 hizo el backfill y eliminó la columna.
   */
  async getTrabajosEntregados(userId, periodoId) {
    if (!periodoId) return [];
    const { data } = await SB.from('trabajos_entregados')
      .select('*')
      .eq('user_id', userId)
      .eq('periodo_id', periodoId)
      .order('created_at', { ascending: false });
    return data ?? [];
  },

  async upsertTrabajo({ id, user_id, periodo_id, titulo, descripcion }) {
    const payload = { user_id, periodo_id, titulo: titulo || '', descripcion,
      updated_at: new Date().toISOString() };
    if (id) payload.id = id;
    const { data, error } = await SB.from('trabajos_entregados').upsert(payload).select().single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  },

  async deleteTrabajo(id) {
    const { error } = await SB.from('trabajos_entregados').delete().eq('id', id);
    return { ok: !error, error: error?.message };
  },

  /**
   * FASE 1 — CONTEXTO. Todo lo que no depende del período elegido.
   * Cuatro consultas en paralelo: un solo round-trip. Con esto ya se pinta
   * el hero y la barra de períodos.
   *
   * Antes getData() encadenaba 6 saltos secuenciales; getConfig(), la
   * consulta de miembros del distrito y evaluaciones_distrito iban en serie
   * sin depender de nada anterior.
   *
   * Devuelve SIEMPRE { ok, ... } — nunca un [] silencioso.
   */
  async getContexto(gestionId = null) {
    const { data: { session } } = await SB.auth.getSession();
    if (!session) return { ok: false, error: 'Tu sesión no es válida. Vuelve a iniciar sesión.' };

    const profile = await Auth.getProfile();
    if (!profile) return { ok: false, error: 'No se pudo leer tu perfil.' };

    // Sin argumento se usa la gestión activa.
    const gestiones = await this.getGestiones();
    const gestion = gestionId
      ? gestiones.find(g => String(g.id) === String(gestionId))
      : gestiones.find(g => g.activa);
    if (!gestion) return { ok: false, error: 'No hay ninguna gestión configurada.' };
    _gestionActual = gestion.id;

    let criteriosRaw, rubricaRaw, calRaw, periodosRaw;
    try {
      [criteriosRaw, rubricaRaw, calRaw, periodosRaw] = await Promise.all([
        this.getCriterios(true),
        this.getRubrica(),
        this.getCalendario(),
        this.getPeriodos(),
      ]);
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }

    // La columna real es `max`. `max_valor` no existe en la base: el
    // fallback `?? c.max` era lo único que mantenía esto en pie.
    const criterios = criteriosRaw.map(c => ({
      key: c.key, label: c.label, abbr: c.abbr, color: c.color,
      max: Number(c.max) > 0 ? Number(c.max) : 4,
    }));

    // Períodos: SOLO datos. `activo` es booleano y las fechas van crudas.
    // La etiqueta de estado (Pendiente/En curso/Cerrado) la decide la UI
    // con estadoPeriodo() de core/render.js — antes esta capa devolvía el
    // string 'Activo'/'Cerrado' en español y el frontend lo comparaba.
    const periodos = periodosRaw.map(p => ({
      id:         p.id,
      pe:         p.nombre,
      nombre:     p.descripcion || p.nombre,
      activo:     !!p.activo,
      inicio:     p.fecha_inicio      || null,
      finTrabajo: p.fecha_fin_trabajo || null,
      entrega:    p.fecha_entrega     || null,
      jornada:    p.fecha_jornada     || null,
    }));

    const rubrica = rubricaRaw.map(r => ({
      criterio: r.criterio || r.criterios?.label || '',
      nivel4: r.nivel4 || '', nivel3: r.nivel3 || '',
      nivel2: r.nivel2 || '', nivel1: r.nivel1 || '',
    }));

    const calendario = calRaw.map(c => ({
      numero:     c.numero,
      titulo:     c.titulo || c.descripcion || '',
      color:      c.color  || 'rojo',
      inicio:     c.fecha_inicio     || '',
      finTrabajo: c.fecha_fin_trabajo || '',
      entrega:    c.fecha_entrega    || '',
      jornada:    c.fecha_jornada    || '',
    }));

    // null es legítimo: la gestión puede no tener período en curso.
    const periodoActivo = periodos.find(p => p.activo) ?? null;

    return { ok: true, profile, criterios, periodos, rubrica, calendario,
             periodoActivo, periodoActivoId: periodoActivo?.id ?? null,
             gestion, gestiones,
             // Una gestión archivada se lee siempre, se escribe nunca.
             soloLectura: !!gestion.archivada };
  },

  // ── GESTIONES ────────────────────────────────────────────────────────
  async getGestiones() {
    const { data, error } = await SB.from('gestiones')
      .select('id, nombre, inicio, fin, activa, archivada')
      .order('created_at', { ascending: false });
    if (error) { console.warn('[API.getGestiones]', error.message); return []; }
    return data ?? [];
  },

  /** Id de la gestión sobre la que se está trabajando. */
  gestionActual() { return _gestionActual; },

  /**
   * Fija la gestión de trabajo. admin.js no pasa por getContexto(), así que
   * necesita fijarla explícitamente antes de cargar nada; si no, los getters
   * resolverían siempre la gestión activa e ignorarían ?gestion= de la URL.
   */
  setGestion(id) { _gestionActual = id == null ? null : id; },

  /**
   * Abre una gestión nueva: archiva la activa, clona criterios, rúbrica,
   * calendario y los PE base como plantilla editable, y arranca con cero
   * evaluaciones y cero miembros.
   */
  async abrirGestion(nombre, clonarDe = null) {
    const { data, error } = await SB.rpc('abrir_gestion', {
      p_nombre: nombre, p_clonar_de: clonarDe,
    });
    return { ok: !error, error: error?.message, id: data ?? null };
  },

  async saveGestion({ id, nombre, inicio, fin }) {
    const p = { nombre: (nombre || '').trim(), inicio: inicio || null, fin: fin || null };
    const { error } = id
      ? await SB.from('gestiones').update(p).eq('id', id)
      : await SB.from('gestiones').insert(p);
    return { ok: !error, error: error?.message };
  },

  /**
   * FASE 2 — CONTENIDO del período seleccionado. Se indexa por periodo_id
   * (UUID), nunca por nombre: el admin escribe por periodo_id y el portal
   * leía por nombre, y esa costura era el origen del bug del período.
   *
   * Cancelable con AbortController: cambiar de período rápido disparaba N
   * peticiones sin cancelar que podían llegar desordenadas y pintar el
   * período equivocado.
   */
  async getContenido(periodoId, { signal } = {}) {
    if (!periodoId) return { ok: true, scores: [], feedback: [], districtScores: [], districtMembers: [] };

    const profile = await Auth.getProfile();
    if (!profile) return { ok: false, error: 'No se pudo leer tu perfil.' };

    const esSecretario = profile.tipo_miembro === 'secretario' && !!profile.distrito;

    try {
      // Miembros del distrito y evaluaciones del período van en paralelo.
      const pMiembros = esSecretario
        ? SB.from('profiles')
            .select('id, nombre, email, distrito, tipo_miembro, roles:rol_id(nombre)')
            .eq('distrito', profile.distrito)
            .abortSignal(signal)
        : Promise.resolve({ data: [], error: null });

      // Ranking de distritos: filtrado por período. Antes traía TODOS los
      // distritos de TODO el historial para pintar una sola tabla.
      const pDist = SB.from('evaluaciones_distrito')
        .select('distrito_id, puntajes')
        .eq('estado', 'publicado')
        .eq('periodo_id', periodoId)
        .abortSignal(signal);

      const [rMiembros, rDist] = await Promise.all([pMiembros, pDist]);
      if (rMiembros.error) throw new Error(rMiembros.error.message);
      if (rDist.error)     throw new Error(rDist.error.message);

      const districtMembers = rMiembros.data ?? [];
      const targetIds = esSecretario && districtMembers.length
        ? districtMembers.map(m => m.id)
        : [profile.id];

      // Evaluaciones: filtradas por período Y por los IDs que la vista
      // muestra. Sin fallback "sin joins": la identidad es evaluado_id.
      //
      // SIN EMBED, a propósito. Llevaba `evaluado:evaluado_id(...)` y eso
      // tumbó los dos portales en producción con "Could not find a
      // relationship between 'evaluaciones' and 'evaluado_id'". La clave
      // foránea existe, pero apunta a auth.users(id), no a profiles(id), y
      // el esquema auth no está expuesto: PostgREST no puede atravesarla.
      //
      // Tampoco hace falta. `lookup`, unas líneas más abajo, ya trae nombre,
      // email y distrito del perfil propio y de districtMembers, que son
      // exactamente los mismos ids que targetIds. Un join por fila para
      // repetir un dato que ya está en memoria.
      const { data: evsRaw, error: evErr } = await SB.from('evaluaciones')
        .select('evaluado_id, puntajes, comentarios, bono_ext')
        .eq('estado', 'publicado')
        .eq('periodo_id', periodoId)
        .in('evaluado_id', targetIds)
        .abortSignal(signal);
      if (evErr) throw new Error(evErr.message);

      const lookup = { [profile.id]: { email: profile.email, nombre: profile.nombre, distrito: profile.distrito } };
      for (const m of districtMembers) lookup[m.id] = { email: m.email, nombre: m.nombre, distrito: m.distrito };

      const scores = [], feedback = [];
      for (const ev of evsRaw ?? []) {
        const info = lookup[ev.evaluado_id] || {};
        // Puntajes ANIDADOS, no esparcidos al nivel de la fila: si un
        // criterio se llamara `nombre`, `distrito` o `ext` sobrescribiría
        // en silencio el dato del usuario, y los criterios los crea el
        // admin desde un formulario libre.
        scores.push({
          evaluado_id: ev.evaluado_id,
          nombre:   info.nombre   || '',
          usuario:  info.email    || '',
          distrito: info.distrito || '',
          ext:      Number(ev.bono_ext) || 0,
          puntajes: parseJSON(ev.puntajes),
        });
        if (ev.comentarios) {
          const coms = parseJSON(ev.comentarios);
          feedback.push({ evaluado_id: ev.evaluado_id, fb: coms, perCriterio: coms });
        }
      }

      const districtScores = (rDist.data ?? []).map(de => {
        const p = de.puntajes || {};
        const n = k => Number(p[k]) || 0;
        return {
          distrito: de.distrito_id,
          cgo: n('cgo'), cct: n('cct'), com: n('com'), cee: n('cee'),
          total: n('cgo') + n('cct') + n('com') + n('cee'),
        };
      }).sort((a, b) => b.total - a.total);

      return { ok: true, scores, feedback, districtScores, districtMembers };
    } catch (e) {
      if (e?.name === 'AbortError') return { ok: false, aborted: true };
      return { ok: false, error: e.message || String(e) };
    }
  },

  /**
   * Mis evaluaciones publicadas en TODOS los períodos. Solo para las vistas
   * de historial/tendencia; es una consulta pequeña (una fila por período).
   */
  async getMiHistorial() {
    const profile = await Auth.getProfile();
    if (!profile) return { ok: false, error: 'No se pudo leer tu perfil.' };

    const { data, error } = await SB.from('evaluaciones')
      .select('periodo_id, puntajes, bono_ext')
      .eq('estado', 'publicado')
      .eq('evaluado_id', profile.id);
    if (error) return { ok: false, error: error.message };

    const porPeriodo = {};
    for (const ev of data ?? []) {
      porPeriodo[ev.periodo_id] = {
        ext: Number(ev.bono_ext) || 0,
        puntajes: parseJSON(ev.puntajes),
      };
    }
    return { ok: true, porPeriodo };
  },

  // ── AVATAR UPLOAD ────────────────────────────────────────────────────
  async uploadAvatar(userId, file) {
    const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${userId}/avatar.${ext}`;
    const { error } = await SB.storage.from('avatars').upload(path, file, { upsert: true });
    if (error) return { ok: false, error: error.message };
    const { data } = SB.storage.from('avatars').getPublicUrl(path);
    const url = data.publicUrl;
    const { error: e2 } = await SB.from('profiles').update({ avatar_url: url }).eq('id', userId);
    if (e2) return { ok: false, error: e2.message };
    return { ok: true, url };
  },
};
