/**
 * Gafete de miembro con QR verificable (0052).
 *
 *   Gafete.abrir(personaId)   panel con el gafete dibujado, para ver, descargar (PNG) y compartir el enlace.
 *
 * El QR lleva https://…/v/<token>: un token aleatorio, no el id ni el correo. La página pública (verificar.html) pide a la
 * base solo el récord público. Los datos del gafete salen de verificar_gafete(token), o sea, EXACTAMENTE lo que verá quien
 * lo escanee: lo que se imprime y lo que se verifica no pueden diverger.
 *
 * Se dibuja en <canvas> (sin librerías de captura): así el PNG sale nítido (×2) y se puede imprimir o subir a una wallet.
 */
const Gafete = (() => {
  const W = 638, H = 1011, ESC = 2;
  const C = { navy: '#002247', navy2: '#001633', blue: '#0087F1', cyan: '#00CBFF', ice: '#A7E8FF', coral: '#FF6063', fondo: '#061326' };
  const FRANJA = ['#002247', '#005286', '#0087F1', '#00CBFF', '#A7E8FF', '#FF6063'];
  const CARGOS = { miembro: 'Miembro', secretaria: 'Secretaría', administracion: 'Administración' };

  const _img = (src, cors) => new Promise(res => {
    const i = new Image();
    if (cors) i.crossOrigin = 'anonymous';
    i.onload = () => res(i); i.onerror = () => res(null); i.src = src;
  });

  function _rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); }

  /** Texto con espaciado entre letras (ctx.letterSpacing no existe en todos los navegadores). Devuelve el ancho. */
  function _txt(c, s, x, y, { fuente, color, espacio = 0, alinear = 'left', maxAncho = 0 }) {
    let px = Number(/(\d+)px/.exec(fuente)[1]);
    c.font = fuente;
    const medir = t => [...t].reduce((a, ch) => a + c.measureText(ch).width + espacio * px, 0) - espacio * px;
    let ancho = medir(s);
    if (maxAncho && ancho > maxAncho) { px = Math.floor(px * maxAncho / ancho); c.font = fuente.replace(/\d+px/, px + 'px'); ancho = medir(s); }
    let cx = alinear === 'center' ? x - ancho / 2 : alinear === 'right' ? x - ancho : x;
    c.fillStyle = color; c.textBaseline = 'alphabetic';
    for (const ch of s) { c.fillText(ch, cx, y); cx += c.measureText(ch).width + espacio * px; }
    return ancho;
  }

  function _qr(c, url, x, y, lado) {
    c.fillStyle = '#fff'; _rr(c, x, y, lado, lado, 22); c.fill();
    const q = qrcode(0, 'M'); q.addData(url); q.make();
    const n = q.getModuleCount(), pad = 13, m = (lado - pad * 2) / n;
    c.fillStyle = C.navy;
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) c.fillRect(Math.floor(x + pad + k * m), Math.floor(y + pad + r * m), Math.ceil(m), Math.ceil(m));
  }

  async function dibujar(canvas, d, url) {
    canvas.width = W * ESC; canvas.height = H * ESC;
    const c = canvas.getContext('2d');
    c.scale(ESC, ESC);
    try { await Promise.all([document.fonts.load('700 62px "Barlow Condensed"'), document.fonts.load('600 22px "Barlow Condensed"'), document.fonts.load('500 19px Barlow'), document.fonts.load('600 15px Barlow')]); } catch (e) { /* se dibuja con la fuente de respaldo */ }
    const [patron, icono, foto] = await Promise.all([_img('img/patrones/patron-7.webp'), _img('icono-512.png'), d.avatar_url ? _img(d.avatar_url, true) : null]);
    const COND = '"Barlow Condensed", "Arial Narrow", sans-serif', BAR = 'Barlow, Arial, sans-serif';

    // Fondo: navy + patrón + velo que lo apaga hacia el pie
    c.save(); _rr(c, 0, 0, W, H, 40); c.clip();
    c.fillStyle = C.navy; c.fillRect(0, 0, W, H);
    if (patron) for (let y = 0; y < H; y += 250) for (let x = 0; x < W; x += 250) c.drawImage(patron, x, y, 250, 250);
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,22,51,.30)'); g.addColorStop(.38, 'rgba(0,34,71,.55)'); g.addColorStop(.66, 'rgba(0,22,51,.93)'); g.addColorStop(1, C.navy2);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    FRANJA.forEach((col, i) => { c.fillStyle = col; c.fillRect(i * W / 6, 0, W / 6 + 1, 12); });
    // Ojal del cordón
    c.fillStyle = C.fondo; _rr(c, 259, 34, 120, 22, 11); c.fill();
    c.strokeStyle = 'rgba(167,232,255,.25)'; c.lineWidth = 3; c.stroke();

    // Cabecera: insignia + marca
    const cx = 190, cy = 148, R = 56;
    c.fillStyle = 'rgba(255,96,99,.22)'; c.beginPath(); c.arc(cx, cy, R + 9, 0, 7); c.fill();
    c.fillStyle = C.coral; c.beginPath(); c.arc(cx, cy, R + 4, 0, 7); c.fill();
    c.save(); c.beginPath(); c.arc(cx, cy, R, 0, 7); c.clip(); c.fillStyle = C.navy; c.fillRect(cx - R, cy - R, R * 2, R * 2);
    if (icono) { const s = R * 2 * 1.42; c.drawImage(icono, cx - s / 2, cy - s / 2, s, s); }
    c.restore();
    _txt(c, 'EIGHT', 268, 131, { fuente: `700 62px ${COND}`, color: '#fff', espacio: .01 });
    _txt(c, 'CREATORS', 268, 187, { fuente: `700 62px ${COND}`, color: '#fff', espacio: .01 });
    _txt(c, 'LABS · CELIDER 08', 268, 216, { fuente: `600 22px ${COND}`, color: C.ice, espacio: .22 });

    // Foto inclinada con marco coral y sombra cian
    c.save(); c.translate(319, 386); c.rotate(-2.2 * Math.PI / 180); c.translate(-148, -148);
    c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 46; c.shadowOffsetY = 26;
    c.fillStyle = C.cyan; _rr(c, 14, 14, 296, 296, 34); c.fill();
    c.shadowColor = 'transparent';
    c.fillStyle = C.coral; _rr(c, 0, 0, 296, 296, 34); c.fill();
    c.save(); _rr(c, 7, 7, 282, 282, 28); c.clip();
    if (foto) {
      const s = Math.max(282 / foto.width, 282 / foto.height), w = foto.width * s, h = foto.height * s;
      c.drawImage(foto, 7 + (282 - w) / 2, 7 + (282 - h) / 2, w, h);
    } else {
      c.fillStyle = C.navy; c.fillRect(7, 7, 282, 282);
      _txt(c, String(d.nombre || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase(), 148, 190, { fuente: `700 120px ${COND}`, color: '#fff', alinear: 'center' });
    }
    c.restore(); c.restore();

    // Sello «Miembro de EIGHT Creators»
    c.save(); c.translate(319, 527); c.rotate(-2.2 * Math.PI / 180);
    c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 18; c.shadowOffsetY = 8;
    c.fillStyle = C.cyan; _rr(c, -194, -23, 388, 46, 23); c.fill(); c.shadowColor = 'transparent';
    _txt(c, 'MIEMBRO DE EIGHT CREATORS', 0, 8, { fuente: `700 26px ${COND}`, color: C.navy, espacio: .12, alinear: 'center' });
    c.restore();

    // Nombre y rol
    c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 18; c.shadowOffsetY = 4;
    _txt(c, String(d.nombre || '').toUpperCase(), 319, 640, { fuente: `700 88px ${COND}`, color: '#fff', espacio: .005, alinear: 'center', maxAncho: 574 });
    c.shadowColor = 'transparent';
    _txt(c, String(d.rol || CARGOS[d.cargo] || '').toUpperCase(), 319, 706 - 6, { fuente: `600 31px ${COND}`, color: C.coral, espacio: .1, alinear: 'center', maxAncho: 574 });

    // Datos
    const desde = d.miembro_desde ? new Date(d.miembro_desde).toLocaleDateString('es-DO', { month: 'short', year: 'numeric' }).replace('.', '') : '—';
    const datos = [['DISTRITO', d.distrito || '—'], ['CARGO', CARGOS[d.cargo] || 'Miembro'], ['MIEMBRO DESDE', desde]];
    const bw = (W - 88 - 24) / 3;
    datos.forEach(([et, val], i) => {
      const x = 44 + i * (bw + 12), y = 706;
      c.fillStyle = 'rgba(0,34,71,.72)'; _rr(c, x, y, bw, 80, 18); c.fill();
      c.strokeStyle = 'rgba(167,232,255,.28)'; c.lineWidth = 2; _rr(c, x + 1, y + 1, bw - 2, 78, 17); c.stroke();
      _txt(c, et, x + 14, y + 27, { fuente: `600 15px ${BAR}`, color: C.ice, espacio: .12 });
      _txt(c, String(val).toUpperCase(), x + 14, y + 61, { fuente: `700 31px ${COND}`, color: '#fff', espacio: .03, maxAncho: bw - 26 });
    });

    // Pie: QR real + texto
    _qr(c, url, 44, 817, 160);
    _txt(c, 'VERIFICA ESTE GAFETE', 230, 862, { fuente: `700 34px ${COND}`, color: '#fff', espacio: .04 });
    ['Escanea el código para ver el récord público', 'del perfil y comprobar que es miembro.'].forEach((l, i) => _txt(c, l, 230, 897 + i * 26, { fuente: `500 19px ${BAR}`, color: '#cfe7f6' }));
    _txt(c, location.host.toUpperCase(), 230, 962, { fuente: `600 20px ${COND}`, color: C.cyan, espacio: .14 });
    c.restore();
    c.strokeStyle = 'rgba(167,232,255,.35)'; c.lineWidth = 3; _rr(c, 1.5, 1.5, W - 3, H - 3, 38); c.stroke();
  }

  function _urlDe(token) { return `${location.origin}/v/${token}`; }

  async function abrir(personaId, { esAdmin } = {}) {
    const cuerpo = abrirPanel({ titulo: 'Gafete', subtitulo: 'Con QR verificable', compacto: false });
    cuerpo.innerHTML = '<p class="vacio" role="status">Preparando el gafete…</p>';
    try {
      if (esAdmin == null) esAdmin = !!(await Auth.getProfile())?.es_admin;
      const { data: token, error } = await SB.rpc('obtener_gafete', personaId ? { p_perfil: personaId } : {});
      if (error) throw error;
      const { data: d, error: e2 } = await SB.rpc('verificar_gafete', { p_token: token });
      if (e2) throw e2;
      if (!d?.valido) { cuerpo.innerHTML = '<p class="vacio">Esta cuenta aún no está aprobada, así que su gafete todavía no es válido.</p>'; return; }
      _montar(cuerpo, personaId, token, d, esAdmin);
    } catch (e) {
      debug?.('gafete', e);
      if (esAdmin && /revocado/i.test(e?.message || '')) {
        cuerpo.innerHTML = '<p class="vacio">Este gafete está revocado.</p><p><button type="button" class="btn-out" data-gafete="reactivar">Activar con un código nuevo</button></p>';
        cuerpo.onclick = async ev => {
          if (!ev.target.closest('[data-gafete="reactivar"]')) return;
          const { error } = await SB.rpc('regenerar_gafete', { p_perfil: personaId });
          if (error) showToast(error.message, 'error'); else abrir(personaId, { esAdmin });
        };
        return;
      }
      cuerpo.innerHTML = `<p class="vacio">No se pudo preparar el gafete. ${escHtml(e?.message || '')}</p>`;
    }
  }

  async function _montar(cuerpo, personaId, token, d, esAdmin) {
    const url = _urlDe(token);
    cuerpo.innerHTML = `
      <div class="gafete-wrap">
        <canvas class="gafete-lienzo" aria-label="Gafete de ${escHtml(d.nombre)}" role="img"></canvas>
        <div class="gafete-acc">
          <button type="button" class="btn-out" data-gafete="descargar"><i data-lucide="download" aria-hidden="true"></i><span>Descargar PNG</span></button>
          <button type="button" class="btn-out" data-gafete="enlace"><i data-lucide="link" aria-hidden="true"></i><span>Copiar enlace</span></button>
          <button type="button" class="btn-out" data-gafete="regenerar"><i data-lucide="refresh" aria-hidden="true"></i><span>Nuevo código</span></button>
          ${esAdmin ? '<button type="button" class="btn-out" data-gafete="revocar"><i data-lucide="user-x" aria-hidden="true"></i><span>Revocar</span></button>' : ''}
        </div>
        <p class="gafete-nota">El QR abre <b>${escHtml(location.host)}/v/…</b>, una página pública que confirma que es miembro. Solo muestra nombre, foto, rol, distrito, cargo, ingreso y cuántos PE tiene evaluados; nunca notas ni correo. Si pierdes el gafete, genera un código nuevo y el anterior deja de valer.</p>
        <p class="gafete-nota">Para llevarlo en el teléfono: descarga el PNG y guárdalo en tu galería, o añade el enlace al inicio. Para wallet digital: apps como Pass2U Wallet crean un pase con ese enlace en QR.</p>
      </div>`;
    renderIconos?.(cuerpo);
    const lienzo = cuerpo.querySelector('canvas');
    await dibujar(lienzo, d, url);
    cuerpo.onclick = async ev => {
      const b = ev.target.closest('[data-gafete]'); if (!b) return;
      const k = b.dataset.gafete;
      if (k === 'descargar') {
        lienzo.toBlob(bl => {
          if (!bl) { showToast('No se pudo exportar la imagen (la foto bloquea la exportación). Prueba con otra foto de perfil.', 'error'); return; }
          const a = document.createElement('a'); a.href = URL.createObjectURL(bl);
          a.download = `gafete-${String(d.nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
          document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        }, 'image/png');
      } else if (k === 'enlace') {
        try { await navigator.clipboard.writeText(url); showToast('Enlace copiado.', 'success'); } catch (e) { showToast(url, 'info'); }
      } else if (k === 'regenerar') {
        if (!confirm('Se generará un código QR nuevo y el anterior dejará de funcionar. ¿Continuar?')) return;
        const { data: t2, error } = await SB.rpc('regenerar_gafete', personaId ? { p_perfil: personaId } : {});
        if (error) { showToast(error.message, 'error'); return; }
        _montar(cuerpo, personaId, t2, d, esAdmin); showToast('Código nuevo generado.', 'success');
      } else if (k === 'revocar') {
        if (!confirm(`¿Revocar el gafete de ${d.nombre}? Su QR dejará de ser válido.`)) return;
        const { error } = await SB.rpc('revocar_gafete', { p_perfil: personaId });
        if (error) { showToast(error.message, 'error'); return; }
        cuerpo.innerHTML = '<p class="vacio">Gafete revocado. Para activarlo de nuevo, abre el gafete y genera un código nuevo.</p>';
      }
    };
  }

  return { abrir, dibujar };
})();
