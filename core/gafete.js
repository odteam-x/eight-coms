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
  const CARGOS = { miembro: 'Miembro', secretaria: 'Secretaría', administracion: 'Administración' };
  const SANS = 'Barlow, "Helvetica Neue", Arial, sans-serif';
  const SERIF = '"Source Serif 4", Georgia, serif';

  const _img = (src, cors) => new Promise(res => {
    const i = new Image();
    if (cors) i.crossOrigin = 'anonymous';
    i.onload = () => res(i); i.onerror = () => res(null); i.src = src;
  });

  function _rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); }

  /**
   * Paleta de la línea gráfica vigente («vidrio sobre malla», vidrio.css). Se lee de los MISMOS tokens que el sitio, así el gafete
   * sale con el tema que la persona está usando (oscuro, claro o rosa). `oscura = true` fuerza el oscuro (imagen del pase de Wallet,
   * cuyo fondo es fijo).
   */
  function _paleta(oscura = false) {
    const css = getComputedStyle(document.documentElement);
    const v = (n, def) => (css.getPropertyValue(n) || '').trim() || def;
    const pc = (n, def) => { const x = parseFloat(v(n, '')); return Number.isFinite(x) ? x / 100 : def; };
    if (oscura) return { v1: '#031B45', v2: '#0A3A82', v3: '#16427F', v4: '#183C74', p2: .34, p3: .62, brillo: 'rgba(0,203,255,.15)', calido: 'rgba(255,96,99,.10)',
      t: '#F3F8FF', t2: '#E9F0FA', tm: '#E3ECF8', fill: 'rgba(255,255,255,.09)', line: 'rgba(255,255,255,.22)', hi: 'rgba(255,255,255,.20)', sombra: 'rgba(3,27,69,.28)', activo: '#FFFFFF', activoTxt: '#031B45' };
    return { v1: v('--v-1', '#031B45'), v2: v('--v-2', '#0A3A82'), v3: v('--v-3', '#16427F'), v4: v('--v-4', '#183C74'), p2: pc('--v-p2', .34), p3: pc('--v-p3', .62),
      brillo: v('--v-brillo', 'rgba(0,203,255,.15)'), calido: v('--v-calido', 'rgba(255,96,99,.10)'), t: v('--v-t', '#F3F8FF'), t2: v('--v-t2', '#E9F0FA'), tm: v('--v-tm', '#E3ECF8'),
      fill: v('--v-fill', 'rgba(255,255,255,.09)'), line: v('--v-line', 'rgba(255,255,255,.22)'), hi: v('--v-hi', 'rgba(255,255,255,.20)'), sombra: v('--v-sombra', 'rgba(3,27,69,.28)'),
      activo: v('--v-activo', '#FFFFFF'), activoTxt: v('--v-activo-txt', '#031B45') };
  }

  /** Malla asimétrica de vidrio.css: degradado a 118° + tres resplandores elípticos. */
  function _malla(c, w, h, P) {
    const a = 118 * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a), len = Math.abs(w * dx) + Math.abs(h * dy), cx = w / 2, cy = h / 2;
    const g = c.createLinearGradient(cx - dx * len / 2, cy - dy * len / 2, cx + dx * len / 2, cy + dy * len / 2);
    g.addColorStop(0, P.v1); g.addColorStop(P.p2, P.v2); g.addColorStop(P.p3, P.v3); g.addColorStop(1, P.v4);
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const brillo = (px, py, rx, ry, col) => {
      c.save(); c.translate(px * w, py * h); c.scale(rx * w, ry * h);
      const r = c.createRadialGradient(0, 0, 0, 0, 0, 1); r.addColorStop(0, col); r.addColorStop(.72, 'rgba(0,0,0,0)');
      c.fillStyle = r; c.fillRect(-1, -1, 2, 2); c.restore();
    };
    brillo(.12, .86, .52, .34, P.brillo); brillo(.94, .06, .38, .58, P.calido); brillo(.58, 1.04, .26, .18, P.brillo);
  }

  /** Contenedor de vidrio: relleno translúcido, borde casi invisible, luz arriba y sombra suave. */
  function _vidrio(c, x, y, w, h, r, P, { sombra = true } = {}) {
    c.save();
    if (sombra) { c.shadowColor = P.sombra; c.shadowBlur = 40; c.shadowOffsetY = 18; }
    c.fillStyle = P.fill; _rr(c, x, y, w, h, r); c.fill();
    c.restore();
    c.save(); _rr(c, x, y, w, h, r); c.clip();
    const g = c.createLinearGradient(0, y, 0, y + 6); g.addColorStop(0, P.hi); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(x, y, w, 6); c.restore();
    c.strokeStyle = P.line; c.lineWidth = 1.5; _rr(c, x + .75, y + .75, w - 1.5, h - 1.5, r - .75); c.stroke();
  }

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
    c.save(); c.shadowColor = 'rgba(3,27,69,.30)'; c.shadowBlur = 24; c.shadowOffsetY = 10;
    c.fillStyle = '#FFFFFF'; _rr(c, x, y, lado, lado, 22); c.fill(); c.restore();
    const q = qrcode(0, 'M'); q.addData(url); q.make();
    const n = q.getModuleCount(), pad = 12, m = (lado - pad * 2) / n;
    c.fillStyle = '#031B45';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) c.fillRect(Math.floor(x + pad + k * m), Math.floor(y + pad + r * m), Math.ceil(m), Math.ceil(m));
  }

  /** Foto en cuadrado redondeado con aro blanco; sin foto, las iniciales. */
  function _foto(c, foto, nombre, x, y, lado, r, P) {
    c.save(); c.shadowColor = P.sombra; c.shadowBlur = 44; c.shadowOffsetY = 22;
    c.fillStyle = '#FFFFFF'; _rr(c, x - 5, y - 5, lado + 10, lado + 10, r + 5); c.fill(); c.restore();
    c.save(); _rr(c, x, y, lado, lado, r); c.clip();
    if (foto) {
      const s = Math.max(lado / foto.width, lado / foto.height), fw = foto.width * s, fh = foto.height * s;
      c.drawImage(foto, x + (lado - fw) / 2, y + (lado - fh) / 2, fw, fh);
    } else {
      c.fillStyle = P.v1; c.fillRect(x, y, lado, lado);
      _txt(c, String(nombre || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase(), x + lado / 2, y + lado / 2 + 38, { fuente: `300 120px ${SANS}`, color: '#FFFFFF', alinear: 'center' });
    }
    c.restore();
  }

  /** Insignia del club en círculo con aro blanco. */
  function _insignia(c, icono, cx, cy, R, P) {
    c.save(); c.shadowColor = P.sombra; c.shadowBlur = 22; c.shadowOffsetY = 10;
    c.fillStyle = '#FFFFFF'; c.beginPath(); c.arc(cx, cy, R + 4, 0, 7); c.fill(); c.restore();
    c.save(); c.beginPath(); c.arc(cx, cy, R, 0, 7); c.clip(); c.fillStyle = '#031B45'; c.fillRect(cx - R, cy - R, R * 2, R * 2);
    if (icono) { const s = R * 2 * 1.42; c.drawImage(icono, cx - s / 2, cy - s / 2, s, s); }
    c.restore();
  }

  async function _cargarFuentes() {
    try {
      await Promise.all([document.fonts.load(`300 62px ${SANS}`), document.fonts.load(`500 22px ${SANS}`), document.fonts.load(`600 18px ${SANS}`),
        document.fonts.load(`400 19px ${SANS}`), document.fonts.load(`italic 400 62px ${SERIF}`)]);
    } catch (e) { /* se dibuja con la fuente de respaldo */ }
  }

  async function dibujar(canvas, d, url) {
    canvas.width = W * ESC; canvas.height = H * ESC;
    const c = canvas.getContext('2d');
    c.scale(ESC, ESC);
    await _cargarFuentes();
    const P = _paleta();
    const [icono, foto] = await Promise.all([_img('icono-512.png'), d.avatar_url ? _img(d.avatar_url, true) : null]);

    c.save(); _rr(c, 0, 0, W, H, 44); c.clip();
    _malla(c, W, H, P);
    // La cabecera cae sobre la parte más oscura de la malla en los tres temas: texto siempre claro.
    const BLANCO = '#FFFFFF', BLANCO2 = 'rgba(255,255,255,.82)';
    _vidrio(c, 259, 26, 120, 22, 11, P, { sombra: false });
    _insignia(c, icono, 92, 118, 42, P);
    _txt(c, 'LABs · CELIDER 08', 152, 98, { fuente: `600 15px ${SANS}`, color: BLANCO2, espacio: .24 });
    const wE = _txt(c, 'Eight ', 152, 148, { fuente: `300 58px ${SANS}`, color: BLANCO, espacio: -.01 });
    _txt(c, 'Creators', 152 + wE, 148, { fuente: `italic 400 58px ${SERIF}`, color: BLANCO });

    _foto(c, foto, d.nombre, 169, 196, 300, 44, P);

    // Panel de vidrio con todo lo demás (sin cajas dentro de cajas: columnas con filetes)
    _vidrio(c, 28, 540, W - 56, 431, 44, P);
    c.save(); c.shadowColor = P.sombra; c.shadowBlur = 24; c.shadowOffsetY = 10;
    const tp = 'MIEMBRO DE EIGHT CREATORS';
    c.font = `600 21px ${SANS}`; const anchoPill = [...tp].reduce((a, ch) => a + c.measureText(ch).width + 21 * .16, 0) + 56;
    c.fillStyle = P.activo; _rr(c, (W - anchoPill) / 2, 517, anchoPill, 46, 23); c.fill(); c.restore();
    _txt(c, tp, W / 2, 547, { fuente: `600 21px ${SANS}`, color: P.activoTxt, espacio: .16, alinear: 'center' });

    _txt(c, String(d.nombre || ''), W / 2, 636, { fuente: `300 74px ${SANS}`, color: P.t, espacio: -.02, alinear: 'center', maxAncho: 540 });
    _txt(c, String(d.rol || CARGOS[d.cargo] || '').toUpperCase(), W / 2, 678, { fuente: `500 21px ${SANS}`, color: P.t2, espacio: .18, alinear: 'center', maxAncho: 520 });

    const filete = y => { c.strokeStyle = P.line; c.lineWidth = 1.5; c.beginPath(); c.moveTo(60, y); c.lineTo(W - 60, y); c.stroke(); };
    filete(704);
    const desde = d.miembro_desde ? new Date(d.miembro_desde).toLocaleDateString('es-DO', { month: 'short', year: 'numeric' }).replace('.', '') : '—';
    const datos = [['DISTRITO', d.distrito || '—'], ['CARGO', CARGOS[d.cargo] || 'Miembro'], ['MIEMBRO DESDE', desde]];
    const cw = (W - 120) / 3;
    datos.forEach(([et, val], i) => {
      const x = 60 + i * cw;
      if (i) { c.strokeStyle = P.line; c.beginPath(); c.moveTo(x, 722); c.lineTo(x, 782); c.stroke(); }
      _txt(c, et, x + (i ? 18 : 0), 740, { fuente: `600 13px ${SANS}`, color: P.tm, espacio: .16 });
      _txt(c, String(val), x + (i ? 18 : 0), 774, { fuente: `500 27px ${SANS}`, color: P.t, maxAncho: cw - (i ? 26 : 14) });
    });
    filete(806);

    _qr(c, url, 60, 826, 124);
    _txt(c, 'Verifica este gafete', 208, 858, { fuente: `300 34px ${SANS}`, color: P.t, espacio: -.01 });
    ['Escanea el código para ver el récord', 'público del perfil y comprobar que', 'es miembro.'].forEach((l, i) => _txt(c, l, 208, 886 + i * 22, { fuente: `400 17px ${SANS}`, color: P.t2 }));
    _txt(c, location.host.toUpperCase(), 208, 954, { fuente: `600 15px ${SANS}`, color: P.tm, espacio: .16 });
    c.restore();
    c.strokeStyle = P.line; c.lineWidth = 2; _rr(c, 1, 1, W - 2, H - 2, 43); c.stroke();
  }

  function _urlDe(token) { return `${location.origin}/v/${token}`; }

  /**
   * Imagen principal del pase de Google Wallet (1032×812, 5:4): malla oscura de la línea gráfica, foto con aro blanco y la insignia.
   * Sin texto (Google lo desaconseja: no se localiza); los datos van en los campos del pase. Siempre en oscuro: el fondo del pase es fijo.
   */
  async function dibujarHero(canvas, d) {
    const w = 1032, h = 812;
    canvas.width = w; canvas.height = h;
    const c = canvas.getContext('2d');
    await _cargarFuentes();
    const P = _paleta(true);
    const [icono, foto] = await Promise.all([_img('icono-512.png'), d.avatar_url ? _img(d.avatar_url, true) : null]);
    _malla(c, w, h, P);
    _foto(c, foto, d.nombre, (w - 460) / 2, 70, 460, 64, P);
    _insignia(c, icono, w / 2, 640, 92, P);
  }

  /** «Añadir a Google Wallet»: sube la imagen del pase, pide el enlace firmado a la función y abre Google Wallet. */
  async function _agregarWallet(d, boton) {
    const rotulo = boton.querySelector('span'), antes = rotulo.textContent;
    boton.disabled = true; rotulo.textContent = 'Preparando…';
    try {
      const { data: s } = await SB.auth.getUser();
      const uid = s?.user?.id; if (!uid) throw new Error('Inicia sesión de nuevo.');
      const lienzo = document.createElement('canvas');
      await dibujarHero(lienzo, d);
      const blob = await new Promise(res => lienzo.toBlob(res, 'image/jpeg', .9));
      if (!blob) throw new Error('No se pudo preparar la imagen (la foto bloquea la exportación).');
      const sube = await SB.storage.from('avatars').upload(`${uid}/wallet-hero.jpg`, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '60' });
      if (sube.error) throw sube.error;
      const { data, error } = await SB.functions.invoke('gafete-wallet', { body: { v: Date.now() } });
      if (error) {
        let det = null; try { det = await error.context?.json?.(); } catch (e) { /* sin cuerpo */ }
        if (det?.codigo === 'no_configurado') { showToast('Google Wallet aún no está activado en este portal. Pídele a la administración que lo configure.', 'info'); return; }
        throw new Error(det?.error || error.message);
      }
      if (!data?.url) throw new Error('Respuesta inesperada.');
      location.assign(data.url);
    } catch (e) {
      debug?.('gafete-wallet', e);
      showToast('No se pudo añadir a Google Wallet. ' + (e?.message || ''), 'error');
    } finally { boton.disabled = false; rotulo.textContent = antes; }
  }


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
    const yo = (await SB.auth.getUser()).data?.user?.id;
    const propio = !personaId || personaId === yo;
    cuerpo.innerHTML = `
      <div class="gafete-wrap">
        <canvas class="gafete-lienzo" aria-label="Gafete de ${escHtml(d.nombre)}" role="img"></canvas>
        <div class="gafete-acc">
          <button type="button" class="btn-out" data-gafete="descargar"><i data-lucide="download" aria-hidden="true"></i><span>Descargar PNG</span></button>
          <button type="button" class="btn-out" data-gafete="enlace"><i data-lucide="link" aria-hidden="true"></i><span>Copiar enlace</span></button>
          ${propio ? '<button type="button" class="btn-out" data-gafete="wallet"><i data-lucide="smartphone" aria-hidden="true"></i><span>Añadir a Google Wallet</span></button>' : ''}
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
      } else if (k === 'wallet') {
        _agregarWallet(d, b);
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

  return { abrir, dibujar, dibujarHero };
})();
