'use strict';
/**
 * EIGHT CREATORS LABs — Auth helpers (Supabase Auth nativo)
 * Depende de: supabase-client.js (SB)
 */
const Auth = (() => {
  let _profileCache = null;

  /** Devuelve el profile del usuario en sesión (incluye rol). */
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
    _profileCache = data;
    return _profileCache;
  }

  /**
   * Protege cada página. Llámalo al inicio del script de cada HTML.
   * adminOnly = true  → redirige a dashboard.html si no es admin
   * adminOnly = false → redirige a admin.html si es admin
   * adminOnly = null  → solo comprueba que hay sesión
   */
  async function requireAuth(adminOnly = null) {
    const profile = await getProfile();
    if (!profile) { window.location.replace('index.html'); return null; }
    if (adminOnly === true  && !profile.es_admin) { window.location.replace('dashboard.html'); return null; }
    if (adminOnly === false &&  profile.es_admin) { window.location.replace('admin.html');     return null; }
    return profile;
  }

  async function logout() {
    _profileCache = null;
    await SB.auth.signOut();
    window.location.replace('index.html');
  }

  function clearCache() { _profileCache = null; }

  return { getProfile, requireAuth, logout, clearCache };
})();
