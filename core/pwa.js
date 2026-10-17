'use strict';
/**
 * EIGHT CREATORS LABs — instalar como app (PWA)
 * ─────────────────────────────────────────────
 * Registra el service worker mínimo (sw.js) y ofrece «Añadir a la pantalla de inicio»:
 *   · Android / Chrome / Edge: captura `beforeinstallprompt` y lo dispara desde un botón nuestro.
 *   · iPhone / iPad (Safari): no existe API para instalar; se explica el gesto (Compartir → Añadir a inicio).
 *   · Ya instalada (display-mode standalone): lo dice y no ofrece nada.
 * No guarda nada: ni preferencias ni estado. Depende de: config.js (showToast se usa si existe).
 */
const Pwa = (() => {
  let _evento = null;   // beforeinstallprompt diferido

  const _ua = navigator.userAgent || '';
  // iPadOS 13+ se presenta como Mac con pantalla táctil.
  const esIOS = /iphone|ipad|ipod/i.test(_ua) || (/Macintosh/.test(_ua) && navigator.maxTouchPoints > 1);
  const esAndroid = /android/i.test(_ua);
  const instalada = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  // En iOS solo Safari puede instalar; Chrome/Firefox/Edge para iOS no tienen la opción en Compartir.
  const esSafariIOS = esIOS && /safari/i.test(_ua) && !/crios|fxios|edgios|opios|gsa\//i.test(_ua);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(e => console.warn('[pwa] sw:', e.message));
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); _evento = e; document.dispatchEvent(new CustomEvent('pwa:lista')); });
  window.addEventListener('appinstalled', () => { _evento = null; document.dispatchEvent(new CustomEvent('pwa:lista')); });

  /** @returns {'instalada'|'prompt'|'ios'|'ios-otro'|'manual'} cómo se puede instalar aquí */
  function modo() {
    if (instalada()) return 'instalada';
    if (_evento) return 'prompt';
    if (esIOS) return esSafariIOS ? 'ios' : 'ios-otro';
    return 'manual';
  }

  const PASOS = {
    ios: 'Toca el botón Compartir (el cuadro con la flecha hacia arriba, abajo en Safari) y elige «Añadir a pantalla de inicio».',
    'ios-otro': 'En iPhone solo Safari puede instalarla: abre esta página en Safari, toca Compartir y elige «Añadir a pantalla de inicio».',
    manual: esAndroid
      ? 'Abre el menú del navegador (⋮) y elige «Instalar app» o «Añadir a pantalla de inicio».'
      : 'En Chrome o Edge usa el icono de instalar de la barra de direcciones, o el menú ⋮ → «Instalar EIGHT CREATORS LABs».',
  };

  /** Texto corto para la fila de Mi cuenta / el aviso del login. */
  function descripcion() {
    const m = modo();
    if (m === 'instalada') return 'Ya la usas como app en este dispositivo.';
    if (m === 'prompt') return 'Ábrela desde tu pantalla de inicio, sin barra del navegador.';
    return PASOS[m];
  }

  /** Lanza la instalación (Android/Chrome) o muestra los pasos (iPhone y el resto). */
  async function instalar() {
    const m = modo();
    if (m === 'instalada') { if (typeof showToast === 'function') showToast('Ya tienes la app instalada.', 'info'); return; }
    if (m === 'prompt') {
      _evento.prompt();
      const r = await _evento.userChoice.catch(() => null);
      _evento = null;
      document.dispatchEvent(new CustomEvent('pwa:lista'));
      if (r && r.outcome === 'accepted' && typeof showToast === 'function') showToast('Listo: búscala en tu pantalla de inicio.', 'success');
      return;
    }
    if (typeof showToast === 'function') showToast(PASOS[m], 'info');
  }

  return { modo, descripcion, instalar, instalada, esIOS, esAndroid };
})();
