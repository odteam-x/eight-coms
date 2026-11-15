/**
 * Tema claro/oscuro y progreso de scroll.
 *
 * Vivía como <script> inline al final de los cinco HTML, duplicado cinco
 * veces y divergiendo. Además la CSP declara script-src 'self': al pasar de
 * Report-Only a activa, esos bloques inline dejarían de ejecutarse y el
 * portal se quedaría clavado en oscuro.
 *
 * Se carga en <head> SIN defer a propósito: aplicar el tema después del
 * primer pintado produce un destello blanco en tema oscuro.
 */
'use strict';

(function () {
  var R = document.documentElement, K = 'ec-theme';

  // Tres temas: dark (por defecto), light y rosa (el coral de la marca como principal).
  var TEMAS = ['dark', 'light', 'rosa'];
  var COLOR_BARRA = { dark: '#061326', light: '#EEF7FC', rosa: '#3D0A27' };

  function aplicar(t) {
    if (TEMAS.indexOf(t) < 0) t = 'dark';   // un valor viejo o ajeno en localStorage no rompe el sitio
    R.dataset.theme = t;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', COLOR_BARRA[t]);
  }

  /** Elige un tema concreto y lo recuerda. */
  window.setTheme = function (t) {
    if (TEMAS.indexOf(t) < 0) return;
    try { localStorage.setItem(K, t); } catch (e) { /* modo privado */ }
    aplicar(t);
  };

  /** Botones de «cambiar tema» (menú, barra, acceso): oscuro → claro → rosa → oscuro. */
  window.toggleTheme = function () {
    window.setTheme(TEMAS[(TEMAS.indexOf(R.dataset.theme) + 1) % TEMAS.length]);
  };

  var guardado = null;
  try { guardado = localStorage.getItem(K); } catch (e) { /* modo privado */ }

  if (guardado) aplicar(guardado);
  else if (window.matchMedia('(prefers-color-scheme:light)').matches) aplicar('light');
  else aplicar('dark');

  // Sigue la preferencia del sistema solo mientras el usuario no haya elegido.
  window.matchMedia('(prefers-color-scheme:light)').addEventListener('change', function (e) {
    var elegido = null;
    try { elegido = localStorage.getItem(K); } catch (err) { /* modo privado */ }
    if (!elegido) aplicar(e.matches ? 'light' : 'dark');
  });
})();

/* Barra de progreso de scroll. Estaba en un listener sin rAF que escribía
   style.width en cada evento de scroll: un layout por frame. */
document.addEventListener('DOMContentLoaded', function () {
  var barra = document.getElementById('scroll-progress');
  if (!barra) return;
  var pendiente = false;
  window.addEventListener('scroll', function () {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(function () {
      var alto = document.body.scrollHeight - window.innerHeight;
      barra.style.width = (alto > 0 ? (window.scrollY / alto) * 100 : 0) + '%';
      pendiente = false;
    });
  }, { passive: true });
});
