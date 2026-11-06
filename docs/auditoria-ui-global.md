# Auditoría global de UI/UX — dos pasadas (noviembre 2026)

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

---

## Segunda pasada — corrección de la primera

**Error de la primera pasada:** el admin del simulador abre un modal «¿Con qué vas a trabajar?» (gestión y PE) que bloquea la
carga de datos hasta que se elige. Mi barrido de las pestañas del admin corrió **con ese modal abierto, o sea sobre pestañas
vacías**, y por eso salió «limpio». Desde ahora se usa `localStorage ec-admin-entrada = {"omitir":true}` antes de recargar
(el simulador de tu repo no lo hace solo). Todo lo siguiente se midió con datos cargados (admin: 16 pestañas, secretaría: 10,
miembro: 6; a 320/360/390 y 1440 px).

| # | Hallazgo (medido) | Corrección | Antes → después |
|---|---|---|---|
| 7 | **Cabecera de perfil en celular:** avatar, nombre, chips, correo, 3 acciones y el anillo en una sola columna; con un nombre largo medía **641 px** de alto en 360 px (el 87 % de la pantalla). | `movil.css`: avatar + nombre en una línea, chips/correo/acciones a todo el ancho, anillo de 88 px, acciones sin icono en una fila | 641 → 375 px |
| 8 | **Texto bajo el mínimo del sistema:** el `<small>` del navegador es «smaller» y dentro de un texto `--fs-sm` bajaba a 11,6–12,7 px (Distritos: «(de 84)», «(sobre 28)», «PE3»; Tareas: «· peso 1»). | `shared.css`: `small { font-size: max(var(--fs-xs), .85em) }` — en el origen, no por pantalla | 4 casos → 0 |
| 9 | **Pared de píldoras grises:** «Sin evaluar» ×15 en Seguimiento, «IG falta» ×10 en Distritos, «No participa», «Admin»… escondían las pocas etiquetas que sí piden atención. | `premium.css`: `.etiqueta.etq-gris` pasa a texto atenuado (sin fondo ni punto). Contraste: sin fallos | Seguimiento 31 → 15 píldoras, Distritos 20 → 10 (conteo en simulador) |
| 10 | **Tabla de Desempeño (1414 px en una tarjeta de 1112):** al desplazarse se pierde de quién es cada fila. | `evolucion.css`: columna de persona fija a la izquierda (≥768 px) | — |
| 11 | `summary` de «Historial de notas» de 30 px de alto en el panel de perfil con puntero táctil. | `movil.css`: 44 px con `pointer: coarse` | 1 → 0 |
| 12 | Detector: daba falsos positivos con contenido dentro de un scroll interno o de un `<details>` cerrado. | `audit-recortes.js` los ignora | — |

**Resultado final con datos:** a 1440 px las 16 pestañas del admin y las 10 de la secretaría dan **cero** desbordes, recortes,
controles sin nombre y textos bajo `--fs-xs`. El panel de perfil a 360 px con un nombre de 44 caracteres: cero recortes y
cero objetivos táctiles pequeños.

### Lo que sigue sin reproducirse
- Captura 1 (media luna): sigue sin aparecer con el avatar real; el seguro de `min/max` queda. Si el usuario recuerda en qué
  pantalla y a qué ancho salió, se puede cerrar de verdad.
- Captura 2 (tarjetas vecinas cortadas): el código no tiene carrusel; lo más probable es que la captura sea un recorte de la
  cuadrícula de 3 columnas. El simulador no trae equipos para el PE activo, así que la tarjeta nueva se verificó por el
  marcado y las pruebas (`front-equipos.mjs`), no a ojo en pantalla.
- Los pocos píxeles de «píldoras» antes/después son conteos de DOM del simulador, no una medida de percepción.

### Pendiente real
Reorganizar secciones/botones (requiere tu criterio sobre qué mover), rendimiento con Lighthouse en producción, y revisar a ojo
el tema claro tras el cambio de `etq-gris` (el contraste numérico pasa; el aspecto no se vio en pantalla).

## Reorganización de información (decidida por la auditoría)

Criterio: **el color y la píldora se reservan para lo que pide una decisión o atención; lo normal va en texto.** Aplicado en:
- Tarjeta de equipo: estado como punto + texto, conteos en una línea, píldoras solo para por revisar / vencidas / alertas.
- Etiquetas neutras (`etq-gris`) como texto en todas las pantallas (Seguimiento, Distritos, Personas, Selector, equipos).
- Selector de personas: «Rol habilitado» (el caso normal) pasa de verde a texto neutro; siguen en color la excepción
  («Rol no habilitado», ámbar), la preferencia, la carga alta y las vencidas.
- Cabecera de perfil en celular: identidad y nombre arriba, acciones a una fila, resumen debajo.

No se movieron secciones de navegación: la estructura actual (operación vs configuración, 3 destinos del miembro, 5 de la
secretaría) ya sigue ese principio y no hay evidencia medida que justifique cambiarla.

## Tercera pasada — «look de plantilla» y calendario

**La media luna de la captura 1 era esto:** el chip de persona del comparador de Desempeño (`.des-chip`) marcaba su serie con
`border-left: 4px`; en una píldora, un borde izquierdo grueso sigue la curva y queda como una media luna cian. Reproducido y
corregido (punto de color en su lugar). El arreglo del avatar de la primera pasada era una hipótesis equivocada; se deja como seguro.

Rastreo de los rasgos de plantilla en todo el CSS y su retirada:
- **Franja lateral de color** (`border-left` / `inset Npx 0 0`): chips de comparar, notas (`.des-nota`, `.ev-aviso`), tarjeta de
  persona elegida, filas elegidas del selector y de la bienvenida, avisos de asignación y el toast. Ahora: notas = bloque
  tenue sin franja; elegido = fondo más claro (+ anillo en la tarjeta); avisos = tinte de fondo; toast = punto de color.
- **Degradados en contenedores** (tarjetas, paneles, modales, buscador): planos en `--surface-1`.
- **Tarjeta de persona de Desempeño:** sin número enorme ni píldora de nivel; nivel como punto + texto.
- **Calendario:** una actividad de varios días es una barra continua con su título (primer día y cada lunes), en un carril
  fijo, que se parte en el borde de la semana; los eventos de un día siguen siendo puntos. En celular, barra sin título.

Verificado en pantalla (simulador, 1440 px): barras, chips, notas y tarjeta. Contraste sin fallos; pruebas `front*` verdes.
No revisado a ojo: tema claro y celular del calendario.

## Cuarta pasada — gráficas con librerías y tablero de tareas

**Gráficas.** Se conectaron dos plugins de Chart.js 4.4.7 por CDN con SRI calculado (annotation 3.1.0, datalabels 2.2.0; 51 KB en total;
la CSP no cambia: mismo origen jsdelivr). `core/charts.js` los envuelve: `bandasNivel()` (Bajo/En proceso/Bueno/Excelente tras la línea,
umbrales de `NIVELES`/`NIVELES_V2`), `rellenoDegradado()`, `etiquetasValor()`, barras redondeadas y animación más suave. Aplicado en el
Panel (distribución, comparación, tendencia) y en Desempeño (evolución, comparar personas, mi evolución, promedio por rol). Si un CDN falla,
la gráfica sigue siendo válida sin la decoración. Nota: datalabels v2 **no se registra solo**; hay que llamar `Chart.register(ChartDataLabels)`.
No se cambió de librería (ECharts, etc.): Chart.js ya está integrado con los tokens y el cambio de tema.

**Tareas — «Qué me toca»** (`core/pendientes.js`, `pendientes.css`; miembro y secretaría, arriba de Entregas). Junta tareas individuales y
de equipo y responde sin abrir cada tarjeta: de quién es (icono + «Individual» / «De equipo · nombre»), cuándo vence («Vence mañana»,
«En 3 días», «Vencida hace 2 días»), qué hay que corregir. Cuatro mosaicos filtran (Vencidas, Vencen esta semana, Por corregir, En revisión);
la lista se agrupa por urgencia; tocar una fila salta a su tarjeta y la resalta. Una bloqueada no cuenta como vencida; una devuelta ya vencida
cuenta en las dos preguntas. Solo lee y agrupa (sin fórmulas ni migración). Las tarjetas existentes ganaron «Tarea individual / de equipo» y
«Vence mañana». Pruebas: `front-pendientes.mjs` (23). Visto en pantalla a 1440 y 360 px.

**Corregido de paso:** a 360 px el destino activo de la barra inferior se solapaba con el icono vecino; la regla de 320–359 sube a 320–379.
