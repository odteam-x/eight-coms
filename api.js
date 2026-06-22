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

  async register({ email, password, nombre, rol_id, distrito, tipo_miembro }) {
    const { data, error } = await SB.auth.signUp({
      email, password,
      options: { data: { nombre } },
    });
    if (error) return { ok: false, error: error.message };
    if (data.user) {
      const updates = {};
      if (rol_id)       updates.rol_id       = Number(rol_id);
      if (distrito)     updates.distrito      = distrito;
      if (tipo_miembro) updates.tipo_miembro  = tipo_miembro;
      if (Object.keys(updates).length) {
        await SB.from('profiles').update(updates).eq('id', data.user.id);
      }
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

  async saveCriterio({ id, key, label, abbr, color, orden, activo }) {
    const p = { key: key.trim().toLowerCase(), label: label.trim(), abbr: abbr.trim().toUpperCase(), color, orden: Number(orden) || 99, activo };
    const { error } = id
      ? await SB.from('criterios').update(p).eq('id', id)
      : await SB.from('criterios').insert(p);
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
      : await SB.from('rubrica').insert(p);
    return { ok: !error, error: error?.message };
  },

  async deleteRubricaRow(id) {
    const { error } = await SB.from('rubrica').delete().eq('id', id);
    return { ok: !error, error: error?.message };
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
      .select('id, nombre, email, es_admin, rol_id, roles(id, nombre), distrito, tipo_miembro, avatar_url, created_at')
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

  // ── ADMIN: participantes por PE ──────────────────────────────────
  async getParticipantes(periodo_id) {
    const { data } = await SB.from('periodo_participantes').select('user_id, activo').eq('periodo_id', periodo_id);
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
    const { data: pe } = await SB
      .from('periodos_evaluacion').select('id').eq('nombre', peNombre).maybeSingle();
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
