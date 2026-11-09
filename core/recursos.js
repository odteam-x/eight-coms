// Recursos ilustrados con movimiento suave: inclinación por parallax que sigue al puntero.
// No hay WebGL: es una transformación CSS (perspective + rotateX/Y) sobre una ilustración SVG.
// Se desactiva con prefers-reduced-motion y en pantallas táctiles (no hay puntero que seguir).
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fino = window.matchMedia && matchMedia('(pointer: fine)').matches;
  if (reduce || !fino) return;
  var MAX = 9; // grados
  function enlazar(el) {
    var raf = 0, rx = 0, ry = 0;
    function pintar() { raf = 0; el.style.setProperty('--rx', rx.toFixed(2) + 'deg'); el.style.setProperty('--ry', ry.toFixed(2) + 'deg'); }
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      ry = x * MAX * 2; rx = -y * MAX * 2;
      if (!raf) raf = requestAnimationFrame(pintar);
    }, { passive: true });
    el.addEventListener('pointerleave', function () { rx = 0; ry = 0; if (!raf) raf = requestAnimationFrame(pintar); });
  }
  function iniciar() { document.querySelectorAll('[data-recurso]').forEach(enlazar); }
  // Los portales pintan Inicio por script: observar y enlazar lo nuevo una sola vez.
  var vistos = new WeakSet();
  function barrido() { document.querySelectorAll('[data-recurso]').forEach(function (e) { if (!vistos.has(e)) { vistos.add(e); enlazar(e); } }); }
  barrido();
  new MutationObserver(barrido).observe(document.body, { childList: true, subtree: true });
})();
