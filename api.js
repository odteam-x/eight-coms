'use strict';
/**
 * EIGHT CREATORS LABs — Capa de datos (Supabase JS)
 * Depende de: supabase-client.js (SB)
 *
 * HOOK_NOTIFICACION: cuando se publique una evaluación, aquí se
 * engancharía la llamada a Resend/Edge Function. Busca el comentario
 * "// HOOK_NOTIFICACION" más abajo para ver el punto exacto.
 */
const API = {

  // ── AUTH ────────────────────────────────────────────────────────
  async login(email, password) {
    const { error } = await SB.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  async register({ email, password, nombre, rol_id }) {
    const { data, error } = await SB.auth.signUp({
      email, password,
      options: { data: { nombre } },
    });
    if (error) return { ok: false, error: error.message };
    // El trigger handle_new_user() ya creó el profile; actualizamos el rol.
    if (rol_id && data.user) {
      await SB.from('profiles').update({ rol_id: Number(rol_id) }).eq('id', data.user.id);
    }
    return { ok: true };
  },

  // ── REFERENCIA (todos los autenticados pueden leer) ──────────────
  async getRoles(soloActivos = true) {
    let q = SB.from('roles').select('*').order('orden');
    if (soloActivos) q = q.eq('activo', true);
    const { data } = await q;
    return data ?? [];
  },

  async getPeriodos() {
    const { data } = await SB.from('periodos_evaluacion').select('*').order('created_at');
    return data ?? [];
  },

  async getCriterios() {
    const { data } = await SB.from('criterios').select('*').eq('activo', true).order('orden');
    return data ?? [];
  },

  async getRubrica() {
    const { data } = await SB
      .from('rubrica')
      .select('*, criterios(key, label, abbr, color)')
      .order('orden');
    return data ?? [];
  },

  async getCalendario() {
    const { data } = await SB.from('calendario').select('*').order('numero');
    return data ?? [];
  },

  async getConfig() {
    const { data } = await SB.from('config').select('*');
    const cfg = {};
    (data ?? []).forEach(r => { cfg[r.clave] = r.valor; });
    return cfg;
  },

  // ── EVALUACIONES — usuario normal ────────────────────────────────
  /** Devuelve las evaluaciones publicadas del usuario en sesión. */
  async getMisEvaluaciones() {
    const { data: { session } } = await SB.auth.getSession();
    if (!session) return [];
    const { data } = await SB
      .from('evaluaciones')
      .select(`*, periodos_evaluacion(id, nombre, descripcion), evaluador:evaluador_id(nombre)`)
      .eq('evaluado_id', session.user.id)
      .eq('estado', 'publicado')
      .order('created_at', { ascending: false });
    return data ?? [];
  },

  // ── ADMIN: usuarios ──────────────────────────────────────────────
  async getAllUsers() {
    const { data } = await SB
      .from('profiles')
      .select('id, nombre, email, es_admin, rol_id, roles(id, nombre), created_at')
      .order('nombre');
    return data ?? [];
  },

  async updateUserRol(user_id, rol_id) {
    const { error } = await SB.from('profiles').update({ rol_id }).eq('id', user_id);
    return { ok: !error, error: error?.message };
  },

  async updateUserAdmin(user_id, es_admin) {
    const { error } = await SB.from('profiles').update({ es_admin }).eq('id', user_id);
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
  async savePeriodo({ id, nombre, descripcion = '', activo = false }) {
    const p = { nombre: nombre.trim(), descripcion: descripcion.trim(), activo };
    const { error } = id
      ? await SB.from('periodos_evaluacion').update(p).eq('id', id)
      : await SB.from('periodos_evaluacion').insert(p);
    return { ok: !error, error: error?.message };
  },

  async deletePeriodo(id) {
    const { error } = await SB.from('periodos_evaluacion').delete().eq('id', id);
    return { ok: !error, error: error?.message };
  },

  // ── ADMIN: evaluaciones ──────────────────────────────────────────
  async getEvaluacionesByPE(periodo_id) {
    const { data } = await SB
      .from('evaluaciones')
      .select(`
        *,
        evaluado:evaluado_id(id, nombre, roles(nombre)),
        evaluador:evaluador_id(id, nombre)
      `)
      .eq('periodo_id', periodo_id)
      .order('created_at');
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
      : await SB.from('calendario').insert(p);
    return { ok: !error, error: error?.message };
  },

  async deleteCalEvento(id) {
    const { error } = await SB.from('calendario').delete().eq('id', id);
    return { ok: !error, error: error?.message };
  },
};
