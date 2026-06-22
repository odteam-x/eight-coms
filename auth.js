'use strict';
/**
 * EIGHT CREATORS LABs — Auth helpers (Supabase Auth nativo)
 * Depende de: supabase-client.js (SB)
 */
const Auth = (() => {
  let _profileCache = null;
  let _dataCache    = null;

  /** Devuelve el profile del usuario en sesión (incluye tipo_miembro, distrito). */
  async function getProfile(forceRefresh = false) {
    if (_profileCache && !forceRefresh) return _profileCache;

    const { data: { session } } = await SB.auth.getSession();
    if (!session) { _profileCache = null; return null; }

    const { data, error } = await SB
      .from('profiles')
      .select('*, roles(id, nombre)')
      .eq('id', session.user.id)
      .single();

    if (error || !data) { _profileCache = null; return null; }

    // Normalizar campos para compatibilidad con user.js y secretario.js
    data.user     = data.email;          // alias → CU.user
    data.name     = data.nombre;         // alias → CU.name
    data.rol      = data.tipo_miembro;   // alias → CU.rol (para isSecretario())

    _profileCache = data;
    return _profileCache;
  }

  /**
   * Protege cada página. Llámalo al inicio del script de cada HTML.
   * adminOnly = true  → redirige a dashboard si no es admin
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
   * Si el usuario tiene un tipo diferente, lo redirige al portal correcto.
   */
  async function requireRole(role) {
    const profile = await getProfile();
    if (!profile) { window.location.replace('index.html'); return null; }
    if (profile.es_admin) { window.location.replace('admin.html'); return null; }
    // tipo_miembro null/vacío se trata como 'miembro' para evitar loops
    profile.tipo_miembro = profile.tipo_miembro || 'miembro';
    profile.rol          = profile.tipo_miembro;
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
    // tipo_miembro null/vacío se trata como 'miembro' para evitar loops
    profile.tipo_miembro = profile.tipo_miembro || 'miembro';
    profile.rol          = profile.tipo_miembro;
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
