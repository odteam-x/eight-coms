# Foto del equipo de comunicaciones (pantalla de acceso)

La pantalla de acceso (`index.html`) tiene preparado un panel grande para la foto del equipo de coms.

- **Archivo:** `img/equipo/equipo-coms.webp` (WebP, calidad ~75). Vertical u horizontal: se recorta con `object-fit: cover`
  y se centra un poco por encima del medio (`object-position: center 30%`), así que las caras deben quedar en el tercio superior.
- **Tamaño:** unos 1200 × 1500 px (pesa menos de 250 KB). Para pantallas retina basta con eso.
- **Activar:** en `index.html`, quitar la clase `login-panel-brand--sin-foto` del panel y descomentar la etiqueta `<img class="login-foto">`.
  Si la foto falla al cargar, `login.js` vuelve a poner esa clase y se ve el patrón de marca (nunca un icono de imagen rota).
- **Texto encima:** el nombre y la descripción van sobre un velo navy de abajo hacia arriba; el contraste del texto blanco
  está garantizado aunque la foto sea clara.
- **Privacidad:** la página de acceso es pública. Usa una foto que el equipo haya autorizado a publicar.
