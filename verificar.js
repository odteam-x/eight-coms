/**
 * Página pública de verificación de gafetes (QR → /v/<token>). Sin sesión.
 *
 * Pide a la base solo el récord público de verificar_gafete(token) (0052): nombre, foto, rol, distrito, cargo, ingreso y
 * cantidad de PE evaluados. Un token desconocido, revocado o de una cuenta sin aprobar responde igual: «no válido».
 */
(function () {
  const host = document.getElementById('vf');
  const CARGOS = { miembro: 'Miembro', secretaria: 'Secretaría de distrito', administracion: 'Administración' };

  function token() {
    const m = location.pathname.match(/\/v\/([0-9a-f]{24})\/?$/i);
    return (m ? m[1] : new URLSearchParams(location.search).get('t') || '').toLowerCase();
  }

  /** La foto solo se acepta si viene del almacenamiento del proyecto (la CSP ya lo exige; aquí también se filtra). */
  function fotoValida(u) {
    try { const x = new URL(u); return x.protocol === 'https:' && /\.supabase\.co$/.test(x.hostname); } catch (e) { return false; }
  }

  function iniciales(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || '?'; }

  function fecha(iso, conDia) {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('es-DO', conDia ? { day: 'numeric', month: 'long', year: 'numeric' } : { month: 'long', year: 'numeric' });
  }

  function invalido(msg) {
    host.innerHTML = `<section class="vf-card vf-mal">
      <div class="vf-sello vf-sello--mal" aria-hidden="true">✕</div>
      <h1>Gafete no válido</h1>
      <p>${escHtml(msg || 'No pudimos confirmar que este gafete pertenezca a un miembro de EIGHT Creators. Puede estar vencido, haber sido revocado o no existir.')}</p>
      <p class="vf-pie">Si crees que es un error, pide a la persona un gafete actualizado.</p>
    </section>`;
  }

  function valido(r) {
    const foto = fotoValida(r.avatar_url)
      ? `<img class="vf-foto" src="${escHtml(r.avatar_url)}" alt="Foto de ${escHtml(r.nombre)}" width="168" height="168" decoding="async">`
      : `<div class="vf-foto vf-foto--ini" role="img" aria-label="Sin foto">${escHtml(iniciales(r.nombre))}</div>`;
    const pe = Number(r.pe_evaluados) || 0;
    host.innerHTML = `<section class="vf-card">
      <p class="vf-sup">EIGHT CREATORS LABs · CELIDER 08 Santiago</p>
      <div class="vf-sello" aria-hidden="true">✓</div>
      <h1>Miembro verificado</h1>
      <p class="vf-sub">Este gafete es auténtico y su titular pertenece al equipo.</p>
      ${foto}
      <h2 class="vf-nombre">${escHtml(r.nombre)}</h2>
      <dl class="vf-datos">
        <div><dt>Cargo</dt><dd>${escHtml(CARGOS[r.cargo] || 'Miembro')}</dd></div>
        <div><dt>Rol</dt><dd>${escHtml(r.rol || 'Sin rol asignado')}</dd></div>
        <div><dt>Distrito</dt><dd>${escHtml(r.distrito || '—')}</dd></div>
        <div><dt>Miembro desde</dt><dd>${escHtml(fecha(r.miembro_desde))}</dd></div>
        <div><dt>Períodos de evaluación</dt><dd>${pe} ${pe === 1 ? 'evaluado' : 'evaluados'}</dd></div>
      </dl>
      <p class="vf-pie">Verificado el ${escHtml(fecha(r.verificado_en, true))}. Solo se muestra información pública: no incluye notas, correo ni datos personales.</p>
    </section>`;
  }

  async function iniciar() {
    const t = token();
    if (!/^[0-9a-f]{24}$/.test(t)) return invalido('El código del gafete está incompleto o dañado.');
    try {
      const { data, error } = await SB.rpc('verificar_gafete', { p_token: t });
      if (error) throw error;
      if (data && data.valido === true) valido(data); else invalido();
    } catch (e) {
      host.innerHTML = `<section class="vf-card vf-mal"><div class="vf-sello vf-sello--mal" aria-hidden="true">!</div><h1>No se pudo verificar</h1><p>Revisa tu conexión e inténtalo de nuevo.</p><p><button type="button" class="btn-out" data-action="vfReintentar">Reintentar</button></p></section>`;
    }
  }

  host.addEventListener('click', ev => { if (ev.target.closest('[data-action="vfReintentar"]')) { host.innerHTML = '<p class="vf-cargando" role="status">Comprobando el gafete…</p>'; iniciar(); } });
  iniciar();
})();
