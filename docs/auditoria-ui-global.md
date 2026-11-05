# Auditoría global de UI/UX — primera pasada (noviembre 2026)

Rama `claude/amazing-moser-2f695c`, base = `7e1057d` (la rama de equipos/desempeño, que contiene `core/desempeno.js`,
`equipos.css` y el centrado del admin; `main` todavía no los trae). **Esto es una primera pasada, no la reingeniería
completa**: abajo se separa lo que se midió y corrigió de lo que queda por hacer.

## Método y herramienta nueva

`audit-layout.js` mide desbordes del viewport y objetivos táctiles, pero **no ve lo que un contenedor recorta**, que es
justo el tipo de fallo de las capturas del usuario. Se añadió `tools/pruebas/ui/audit-recortes.js`:

- `__rec()` — elementos que sobresalen de un ancestro con `overflow: hidden/clip` (sin scroll que los ofrezca), texto
  cortado sin elipsis y carruseles de tarjetas (las vecinas quedan cortadas a los lados).
- `await __recSweep([...pestañas])` — lo mismo por pestaña.

Se corrió, con el simulador (`?as=admin|sec|m1`), sobre **las 16 pestañas del admin, 10 de la secretaría y 6 del
miembro** a 320, 390, 640 y 1440 px, junto con `__aud()` (desborde, táctil, sin nombre, texto pequeño).

## Hallazgos

| # | Hallazgo | Estado |
|---|---|---|
| 1 | **Avatar deformable.** `.avatar` fijaba `width/height` pero sin mínimos: dentro de un flex/grid estrecho puede aplastarse a elipse y su aro cian (`inset 2px --cyan-400`) queda como media luna — es la forma exacta de la captura 1. **No pude reproducirlo con los datos del simulador** (a 48 px el avatar sale redondo); el arreglo es defensivo, en el origen. | Corregido (`shared.css`) |
| 2 | **Tarjeta de equipo con 4–6 píldoras** (estado, `N integrantes`, `N abiertas`, avisos). Las tarjetas en sí no se cortan en el código (`.eq-grid` es `auto-fill`, 1 columna ≤640 px); lo que se ve mal en la captura es el exceso de etiquetas. Ahora: el estado es punto + texto, los conteos normales van en una línea de texto, y solo lo que pide atención (por revisar / vencidas / alertas) es etiqueta. Además el aviso de alertas decía «por revisar», igual que las tareas por revisar; ahora «alerta(s)». | Corregido (`core/equipos.js`, `equipos.css`) |
| 3 | **Barra inferior a 320 px:** con 6 destinos cada icono medía 41×56 (mínimo del proyecto 44). A <360 px el destino activo ya no se ensancha; todos miden 50 px. | Corregido (`movil.css`) |
| 4 | Calendario, celdas de días de otro mes a 320 px: 39×54. 7 columnas en 292 px útiles no llegan a 44; ya estaba documentado (≥44 desde 360 px). Cumple WCAG 2.2 AA (24 px). | Pendiente / aceptado |
| 5 | Desempeño → tabla por persona mide 1414 px dentro de un contenedor de 1112 px. Hace scroll horizontal dentro de su `.seg-tabla-wrap` (no hay recorte), pero a 1440 el usuario tiene que desplazarse para ver las columnas finales. | Pendiente |
| 6 | Sin recortes, sin desbordes y sin controles sin nombre en el resto de pestañas medidas. Los únicos «textos cortados» son los `h1.pantalla-t` visualmente ocultos en móvil (a propósito). | Verificado |

## Qué NO se pudo hacer ni medir

- **No hay Lighthouse / LCP / INP / CLS / TBT en este entorno**: no se inventan métricas. Tamaños (bytes, medidos con
  `wc -c`): `premium.css` 108 KB, `shared.css` 92 KB, `admin.css` 84 KB, `admin.js` 149 KB, más ~11 hojas CSS por página sin
  bundler. Es el candidato obvio de rendimiento (muchas peticiones y CSS sin usar por portal) pero requiere medir en un
  navegador real antes de tocar nada.
- **Las capturas del usuario no se reprodujeron tal cual** (ver 1 y 2). El simulador tiene pocos datos (sin equipos en el PE
  activo, nombres cortos); un fallo que depende de datos reales largos solo lo atrapa la prueba con esos datos.
- La reorganización de pantallas, botones y secciones que pidió el usuario **no se hizo todavía**: hace falta decidir con
  él qué mover. Propuesta abajo.

## Pendientes y recomendaciones (en orden)

1. **Prueba con datos reales largos** (nombres de 4 palabras, 30 equipos, 40 personas) en el simulador; correr `__rec()`.
2. **Exceso de píldoras en el resto de la app.** `.etiqueta` / `.chip` se usan para estado, conteos y categorías a la vez.
   Regla propuesta: píldora solo para *estado que requiere atención*; conteos y metadatos en texto; una sola píldora de
   rol. Candidatos: `perfil-chips`, `pcard` (nivel + estados + insignias), `Selector.insignias()` (hasta 6 insignias por
   persona), cabeceras de Desempeño.
3. **Tablas anchas** (Desempeño, Seguimiento, Reportes): fijar primera columna (`position: sticky`) y limitar columnas visibles
   por defecto.
4. **Rendimiento:** medir con Lighthouse en `eight-coms.vercel.app`; evaluar fusionar/diferir hojas por portal, `preload` de
   las dos fuentes críticas y cargar `core/*.js` de pestañas no iniciales bajo demanda.
5. Contenedores anidados: inventariar `.pf-card` dentro de `.tarjeta` dentro de `.panel` (tres capas de borde/fondo).

## Verificación

`node tools/contraste.js`: 172 pares, sin fallos. `front.mjs` 51, `front-rediseno.mjs` 330, `front-equipos.mjs` 58,
`front-desempeno.mjs` 71, `front-distritos.mjs` 52, `front-estadisticas.mjs` 51, `iconos.mjs` 1: todas correctas.
Las pruebas SQL no se tocaron ni se corrieron (no hay `node_modules` instalado en `tools/pruebas`).

## Archivos modificados

`shared.css` (avatar), `equipos.css` + `core/equipos.js` (tarjeta de equipo), `movil.css` (barra inferior <360 px),
`tools/pruebas/ui/audit-recortes.js` (nuevo), este documento.
