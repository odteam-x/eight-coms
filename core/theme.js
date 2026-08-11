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

  function aplicar(t) {
    R.dataset.theme = t;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#F4F6F9' : '#0E0F12');
  }

  window.toggleTheme = function () {
    var n = R.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(K, n); } catch (e) { /* modo privado */ }
    aplicar(n);
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
