'use strict';
/* Extensión del simulador: gafetes (migración 0052). Solo para pintar la UI; las reglas las prueba sql-0052.mjs.
   Tokens de 24 hex deterministas por persona. ?gf=invalido → siempre «no válido» · ?gf=error → falla la red. */
(() => {
  const orig = window.SB.rpc.bind(window.SB);
  const DB = window.__FAKE.DB;
  const modo = new URLSearchParams(location.search).get('gf') || '';
  const tokDe = id => (String(id).replace(/[^0-9a-f]/gi, '') + 'abcdef0123456789abcdef01').toLowerCase().slice(0, 24).padEnd(24, '0');
  const porTok = t => DB.profiles.find(p => tokDe(p.id) === t);
  window.SB.rpc = async (n, a = {}) => {
    if (n === 'obtener_gafete' || n === 'regenerar_gafete') {
      const me = (await window.SB.auth.getUser()).data.user.id, yo = DB.profiles.find(p => p.id === me);
      const id = a.p_perfil || me;
      if (id !== me && !yo.es_admin) return { data: null, error: { message: 'Sin permiso' } };
      return { data: tokDe(id), error: null };
    }
    if (n === 'verificar_gafete') {
      if (modo === 'error') return { data: null, error: { message: 'network' } };
      const p = modo === 'invalido' ? null : porTok(a.p_token);
      if (!p || p.aprobado === false) return { data: { valido: false }, error: null };
      const rol = (DB.roles || []).find(r => r.id === p.rol_id);
      return { data: { valido: true, nombre: p.nombre, avatar_url: p.avatar_url || null, rol: rol ? rol.nombre : null, distrito: p.distrito || null,
        cargo: p.es_admin ? 'administracion' : p.tipo_miembro === 'secretario' ? 'secretaria' : 'miembro', miembro_desde: p.created_at || '2026-06-01T00:00:00Z',
        pe_evaluados: (DB.evaluaciones || []).filter(e => e.evaluado_id === p.id && e.estado === 'publicado').length, verificado_en: new Date().toISOString() }, error: null };
    }
    if (n === 'revocar_gafete') return { data: null, error: null };
    return orig(n, a);
  };
})();
