'use strict';
/**
 * EIGHT CREATORS LABs — Auth helpers (Supabase Auth nativo)
 * Depende de: supabase-client.js (SB)
 */
const Auth = (() => {
  let _profileCache = null;
  let _dataCache    = null;

  /**
   * Devuelve el perfil del usuario en sesión.
   * Si la tabla profiles no es accesible (RLS / fila faltante),
   * retorna un perfil mínimo construido desde los metadatos de sesión
   * para que el login nunca quede bloqueado.
   */
  async function getProfile(forceRefresh = false) {
    if (_profileCache && !forceRefresh) return _profileCache;

    let session;
    try {
      const { data } = await SB.auth.getSession();
      session = data?.session;
    } catch (e) {
      console.error('[Auth] getSession error:', e);
    }
    if (!session) { _profileCache = null; return null; }

    // maybeSingle() → null sin error si hay 0 filas; no explota como single()
    let profile = null;
    try {
      const { data, error } = await SB
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      if (error) console.warn('[Auth] profiles query error:', error.code, error.message);
      profile = data || null;
    } catch (e) {
      console.warn('[Auth] profiles query threw:', e);
    }

    // Fallback: construir perfil mínimo desde metadatos de sesión.
    // Permite que el login funcione aunque RLS bloquee o no exista la fila.
    if (!profile) {
      const meta = session.user.user_metadata || {};
      profile = {
        id:           session.user.id,
        email:        session.user.email,
        nombre:       meta.nombre || session.user.email?.split('@')[0] || 'Usuario',
        tipo_miembro: meta.tipo_miembro || 'miembro',
        es_admin:     meta.es_admin === true || false,
        rol_id:       null,
        distrito:     meta.distrito || null,
        _isFallback:  true,
      };
      console.warn('[Auth] usando perfil de sesión (fallback). Ejecuta el SQL de RLS en Supabase para leer profiles correctamente.');
    }

    // Normalizar alias para compatibilidad con user.js y secretario.js
    profile.tipo_miembro = profile.tipo_miembro || 'miembro';
    profile.user = profile.email;
    profile.name = profile.nombre;
    profile.rol  = profile.tipo_miembro;

    _profileCache = profile;
    return _profileCache;
  }

  /**
   * Protege cada página. Llámalo al inicio del script de cada HTML.
   * adminOnly = true  → redirige al portal si no es admin
   * adminOnly = false → redirige a admin.html si es admin
   * adminOnly = null  → solo comprueba que hay sesión
   */
  async function requireAuth(adminOnly = null) {
    const profile = await getProfile();
    if (!profile) { window.location.replace('index.html'); return null; }
    if (adminOnly === true  && !profile.es_admin) { window.location.replace(_portalFor(profile)); return null; }
    if (adminOnly === false &&  profile.es_admin) { window.location.replace('admin.html');          return null; }
    return profile;
  }

  /**
   * Protege una página para un tipo_miembro específico.
   * Si el usuario tiene un tipo diferente lo redirige al portal correcto.
   */
  async function requireRole(role) {
    const profile = await getProfile();
    if (!profile) { window.location.replace('index.html'); return null; }
    if (profile.es_admin) { window.location.replace('admin.html'); return null; }
    if (profile.tipo_miembro !== role) {
      window.location.replace(_portalFor(profile));
      return null;
    }
    return profile;
  }

  /**
   * Protege una página para una lista de tipos_miembro aceptados.
   * Ej: Auth.requireAnyRole(['secretario','miembro'])
   */
  async function requireAnyRole(roles) {
    const profile = await getProfile();
    if (!profile) { window.location.replace('index.html'); return null; }
    if (profile.es_admin) { window.location.replace('admin.html'); return null; }
    if (!roles.includes(profile.tipo_miembro)) {
      window.location.replace(_portalFor(profile));
      return null;
    }
    return profile;
  }

  /** Determina a qué portal pertenece un perfil (no-admin). */
  function _portalFor(profile) {
    return profile.tipo_miembro === 'secretario' ? 'secretario.html' : 'user.html';
  }

  async function logout() {
    _profileCache = null;
    _dataCache    = null;
    await SB.auth.signOut();
    window.location.replace('index.html');
  }

  function clearCache()        { _profileCache = null; }
  function getCachedData()     { return _dataCache; }
  function setCachedData(data) { _dataCache = data; }

  return { getProfile, requireAuth, requireRole, requireAnyRole, logout, clearCache, getCachedData, setCachedData };
})();
