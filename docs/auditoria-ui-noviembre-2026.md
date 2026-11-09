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

## 4. Pendiente (no se da por hecho)

- Repaso pantalla por pantalla de: Reportes, Auditoría, Períodos, Rúbrica, Roles y perfiles, Gestiones, Equipos, Distritos
  (admin) y Tareas/Distrito de la secretaría, con su revisión en móvil.
- Pasada manual en Brave con una cuenta real autorizada.
- Foto del equipo de coms.
- Acciones masivas en tablas (requieren decidir qué acciones y con qué confirmación).
