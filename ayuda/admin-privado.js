'use strict';
/* Manual de administración: carcasa que pide el contenido a la base SOLO si hay una sesión de administración (migración 0044).
   El texto no está en este sitio: la tabla manuales_privados lo entrega únicamente a is_admin() (RLS). Sin sesión o sin permiso, esta
   página no muestra ni una línea del manual. Depende de: config.js, supabase-client.js (SB), auth.js (Auth). */
(async () => {
  const estado = document.getElementById('ay-estado');
  const decir = t => { if (estado) estado.textContent = t; };
  try {
    const perfil = await Auth.getProfile();
    if (!perfil) { location.replace('../index.html'); return; }
    if (!perfil.es_admin) { decir('Este manual es solo para la administración. Si lo necesitas, pídeselo a la coordinación.'); return; }
    const { data, error } = await SB.from('manuales_privados').select('html').eq('slug', 'admin').maybeSingle();
    if (error || !data) { decir('No se pudo cargar el manual. Recarga la página; si sigue igual, avisa a quien mantiene el portal.'); return; }
    document.getElementById('contenido').innerHTML = data.html;   // contenido propio, generado por tools/generar-manuales.mjs
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  } catch (e) {
    console.warn('[manual admin]', e);
    decir('No se pudo cargar el manual. Revisa tu conexión y recarga.');
  }
})();
