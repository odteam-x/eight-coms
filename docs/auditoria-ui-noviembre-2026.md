# Auditoría y rediseño integral de la interfaz — noviembre 2026

Rama `rediseno-vidrio-demo`. Registro vivo: qué se recorrió, con qué herramientas, qué problemas se encontraron, qué se
decidió y qué queda. **Nada aquí se marca como hecho sin haberlo visto en una captura o medido en el navegador.**

## 1. Cómo se recorrió (herramientas reales)

| Herramienta | Uso | Límite honesto |
|---|---|---|
| **Playwright** (`playwright-core` + Edge instalado, sin descargar navegadores) | `tools/pruebas/ui/recorrido.mjs`: abre cada pestaña que el **menú real** ofrece, para admin, secretaría, miembro y sin sesión, a 1440 / 1024 / 768 / 390 px; captura JPEG y mide desbordes, objetivos táctiles, texto diminuto, controles sin nombre y errores de consola. También abre avisos, buscador y un perfil. | Contra el **simulador** (`ui/server.mjs`, misma CSP que Vercel, datos inventados), no contra producción. |
| **Navegador integrado** | Flujos interactivos: login con error, registro, reset de contraseña en todos sus caminos, modales (aprobar tarea), foco tras cerrar, Escape. | Con el panel oculto las transiciones no terminan: para color se usan las capturas de Playwright. |
| **DevTools (vía JS)** | Estilos computados, pseudo-elementos, foco activo, medidas de rejilla. | — |
| **Brave / Computer Use** | **No usados en esta fase.** Computer Use no está disponible en esta sesión; Brave está conectado pero las capturas de Playwright cubren lo mismo con datos de prueba. | Pendiente: una pasada manual en Brave con una cuenta real autorizada. |

Evidencia: `docs/evidencias/rediseno-nov-2026/antes/` (rama `main`, lo que hay en producción) y `.../despues/`, por
`<rol>-<ancho>/<pantalla>.jpg` + `resumen.json`. Las imágenes no se versionan (`.gitignore`); se regeneran con
`node tools/pruebas/ui/recorrido.mjs <fase> <puerto>`.

## 2. Investigación (lo que sí se consultó)

- **Alertas y estado del sistema** — resúmenes de la heurística 1 de NN/g («visibilidad del estado»), guías de tableros de
  ArcGIS (no más de dos o tres avisos llamativos; «marcar todo es no marcar nada») y Smashing Magazine. → alertas
  compactas, urgentes primero, el resto plegado; color moderado y siempre con icono + texto.
- **Formularios** — Baymard: etiqueta siempre visible encima del campo (no dentro), validación en línea que desaparece al
  corregir, sin validación prematura. → el login ya cumplía; se mantiene.
- **Navegación** — Material 3 (rail para 3–7 destinos en pantallas medianas/grandes; el *drawer* se sustituye por el rail
  expandido en M3 Expressive). → se mantiene el menú lateral expandido + barra inferior en móvil.
- **Detalle en panel vs pantalla** — Smashing («Modal vs. separate page»), SaaSUI (drawers), UX Movement: un cajón que
  ocupa casi toda la pantalla debería ser una página; los drawers de edición pierden datos al cerrarse con Escape. → los
  perfiles pasan a pantalla completa; el perfil no tiene formularios que se pierdan (los cambios de Gestión se guardan al
  momento).
- Fases anteriores: `docs/rediseno-investigacion-por-pantalla.md` (Pinterest, páginas de acceso de Stripe/Vercel/Figma…).
- **No consultado** (no accesible sin cuenta o no abierto): interiores de Linear, Attio, Asana, Intercom, HubSpot; Mobbin,
  SaaSFrame y Dribbble más allá de su portada; artículos completos de NN/g y Baymard (en parte de pago).

## 3. Hallazgos y cambios por módulo

| Módulo | Problema encontrado (visto) | Cambio | Estado |
|---|---|---|---|
| **Todas las pantallas** | La cabecera gastaba 3–4 líneas en un párrafo; no decía en qué sección estabas. | Grupo del menú sobre el título («OPERACIONES»), icono de la pantalla, descripción en una línea (texto completo en `title`). | Hecho |
| **Patrones «de IA»** | Barras de acento en bordes (avisos, chips, toasts, notas), contorno cian al pasar, 20 halos de neón, aro cian del avatar, iconos-medalla. | Quitados en origen; regla escrita en `CLAUDE.md` (proyecto y global) y **prueba que falla si vuelven**. | Hecho |
| **Panel (admin)** | «Requiere atención» ocupaba ~400 px con 4 filas de 87 px; KPIs repetían las alertas («Sin evaluar»), tarjeta «Avance» repetía las cifras. | Componente nuevo compacto (fila de 38 px, urgentes primero, «Ver todas», «Datos por revisar» plegado); resumen 2×2 con datos reales: publicadas con barra, promedio con variación vs período anterior, mejor resultado con la persona, entregas a tiempo; distribución y tendencia a la vista. Todo cabe en la primera pantalla a 1440. | Hecho |
| **Perfiles y distritos** | Se abrían como cajón lateral de 760 px con pestañas cortadas. | Pantalla completa junto al menú, con «Volver», foco y Escape. | Hecho |
| **Calendario** | Cajas por día, aro cian del día elegido, título en mayúsculas pesadas. | Días sin caja, período como franja continua, hoy en coral, elegido en píldora inversa, agenda como lista. | Hecho |
| **Mi cuenta** | Tarjeta grande que repetía la identidad, título duplicado, huecos muertos, 8 baldosas enormes casi invisibles en claro. | Identidad en una fila, subnavegación + bloques, baldosas pequeñas; elegido = aro sólido. | Hecho |
| **Menú** | En tema claro el nombre de la fila de cuenta activa era navy sobre navy. | Píldora blanca con texto navy en los dos temas. | Hecho |
| **Avisos** | No leído marcado con barra roja; filtro activo en coral; franja multicolor en la cabecera. | Punto coral + fondo + negrita; filtro activo inverso; sin franja. Fallo previo corregido: el panel se quedaba en «Cargando…». | Hecho |
| **Evaluar** | Personas en cajas apiladas a 2 px; **las filas no se podían elegir con teclado** (div sin foco). | Una lista con filas; `role=button` + `tabindex` + Enter/Espacio (también cabeceras de la rúbrica). | Hecho |
| **Desempeño** | Secciones pegadas (0 px); «Comparar personas» vacío sin guía. | Separación; estado vacío con referencia («Selecciona una persona…»). | Hecho |
| **Seguimiento** | Columnas de PE desalineadas entre grupos de rol; «Sin evaluar» como píldora repetida decenas de veces. | Columnas fijas compartidas; «Sin evaluar» como texto tenue. | Hecho |
| **Tablas** | Tabla con caja propia dentro de otra caja: esquinas que no coinciden, última columna recortada. | Tablas planas con filetes. | Hecho |
| **Chips / filtros** | Activo en coral en unos y cian en otros. | Una apariencia: píldora inversa. | Hecho |
| **Modales** | Al aprobar, el foco caía al `<body>`. | El foco vuelve al título de la pantalla. | Hecho |
| **Acceso** | Lista de beneficios compitiendo; recuperación debajo del botón; «cuenta pendiente» como error. | Tarjeta con panel para la foto del equipo + formulario; recuperación junto a su etiqueta; reset a prueba de red. **Falta el archivo de la foto** (`img/equipo/LEEME.md`). | Hecho (sin foto) |

| **Roles y perfiles** | Cajas blancas dentro de la tarjeta de vidrio. | Secciones con filete. | Hecho |
| **Equipos** | La configuración («Reglas de calificación», ~550 px) iba antes que los equipos. | Equipos primero, reglas debajo; seis valores en rejilla con filetes. | Hecho |
| **Reportes** | Los 8 indicadores del reporte quedaron en 2 columnas enormes (efecto de una regla mía del Panel). | Regla limitada al Panel; en el reporte, franja de cifras. | Hecho |
| **Entregas** | Títulos en MAYÚSCULAS; 4–5 botones con borde por tarea; PE sin fechas estirados. | Una acción principal sólida y el resto como texto; línea de tiempo sin estirar. | Hecho |
| **Menú** | Con el menú alto, la etiqueta ADMIN se montaba sobre el buscador (las piezas se encogían). | El menú desplaza, no encoge. «Desempeño del di…» cortado → «Desempeño» dentro de «Mi distrito». | Hecho |
| **Celular, tema claro** | Cabecera y barra inferior: texto blanco sobre fondo claro (regresión mía al volverlas opacas). | Van en el azul de la columna del menú. | Hecho |

## 4. Medición antes / después (recorrido.mjs, 176 pantallas cada uno)

| | Antes (`main`) | Después |
|---|---|---|
| Errores de consola | 0 | 0 |
| Desbordes horizontales | 0 | 0 (dos regresiones detectadas por el propio recorrido y corregidas: variación del promedio a 390 px) |
| Objetivos < 44 px en celular (390) | 0 | 0 (las acciones de alertas medían 32 px; corregido) |
| Controles sin nombre accesible | 0 | 0 |
| Alto de «Requiere atención» (1440) | ≈ 400 px (4 filas de 87 px) | 202 px, junto a los KPIs |
| Panel a 1440: ¿cabe sin desplazar? | No | Sí (cabecera, KPIs, alertas, distribución y tendencia) |

En escritorio el recorrido cuenta como «chicos» los controles de 40 px (cabeceras de grupo del menú): con puntero fino
WCAG 2.2 pide 24 px, así que no es un defecto; con puntero grueso el proyecto exige 44 y se cumple.

## 5. Pendiente (no se da por hecho)

- Revisión visual fina (captura por captura) de Auditoría, Rúbrica, Gestiones y del modo «Un PE en detalle» de Reportes; las
  métricas automáticas de esas pantallas están limpias, pero no las he revisado a ojo una por una.
- Tema claro en todas las pantallas a ojo (el recorrido completo usa el tema del sistema).
- Pasada manual en Brave con una cuenta real autorizada.
- Foto del equipo de coms.
- Acciones masivas en tablas (requieren decidir qué acciones y con qué confirmación).
