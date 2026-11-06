# Revisión del flujo de usuario (noviembre 2026)

**Qué se pudo y qué no.** El navegador conectado (Browser 1; no pude comprobar que fuera Brave) **no tenía sesión**: solo se vio el login real de
producción y no se escribieron credenciales. Además el redimensionado de su ventana no surtió efecto, así que ahí no se probó celular. El flujo con
sesión se recorrió en el **simulador local** (datos inventados, mi versión del código) con emulación de 390, 768 y 1440 px. Las cifras son medidas
reales del DOM (`pantallas` = alto del documento ÷ alto de la pantalla; `controles` = botones/enlaces/campos visibles). No se vio producción logueada
ni datos reales: los problemas que dependen de volumen real (30 equipos, nombres largos) pueden ser peores.

## Conflictos encontrados

### Miembro (celular, 390 px)
| # | Conflicto | Evidencia | Propuesta |
|---|---|---|---|
| M1 | **Cada tarea aparece dos veces en Entregas**: primero en «Qué me toca» y otra vez como tarjeta completa debajo. Entregas mide **6,5 pantallas**; las tareas de equipo empiezan a 3 300 px y la línea de tiempo a 4 600 px. | encabezados: Qué me toca @284, tarjetas @1639–2863, Mis equipos @3092, Línea de tiempo @4609 | Que la fila del tablero se expanda en sitio (acordeón) con sus botones y quitar la lista duplicada; o mostrar las tarjetas solo al tocar «Ver detalle». |
| M2 | **La misma lista en tres lugares**: Inicio («Para atender»), Entregas («Qué me toca») y Mi perfil («Tareas del período»). | tres secciones con las mismas tareas | Una sola fuente visual: Inicio muestra las 3 más urgentes + «Ver todas»; el perfil solo resume. |
| M3 | **Inicio abre con ~380 px de hero** (saludo + cuenta atrás); lo accionable («Para atender») queda bajo el pliegue. | primer control a 392 px | Hero más bajo en celular; «Para atender» primero cuando hay algo vencido. |
| M4 | **Mi perfil mide 6,9 pantallas.** «Cómo se compone tu evaluación» ocupa ~3 000 px (de 2 016 a 5 128). | encabezados con posiciones | Plegado por defecto con resumen de una línea; historial de notas en una pestaña propia. |
| M5 | **Calendario**: la leyenda-filtro ocupa 5 filas (~220 px) antes de ver el mes; 53 controles. | captura a 390 | Filtros en un menú «Mostrar» (1 fila); mes primero. |

### Secretaría
| # | Conflicto | Propuesta |
|---|---|---|
| S1 | **«Entregas» y «Tareas» son dos destinos de la barra inferior** y no se distingue cuál es lo mío y cuál lo del distrito. | Renombrar: «Mis tareas» / «Tareas del distrito». |
| S2 | Perfil, Desempeño, Calendario, Seguimiento y Reportes quedan dentro de «Más». **Reportes mide 8,6 pantallas** en celular. | Reportes: resumen primero y detalle plegado; o dejarlo solo para pantalla ancha con aviso. |

### Administración
| # | Conflicto | Evidencia | Propuesta |
|---|---|---|---|
| A1 | **Pantallas larguísimas en celular:** Desempeño 8,7 · Panel 6,8 · Distritos 5,7 · Rúbrica 5,5 (159 controles) · Reportes 4,8 · Tareas 4,6 (49 controles). | medida por pestaña | Secciones plegables con la pregunta que responden como título; gráficas de comparación solo bajo demanda. |
| A2 | Operación diaria escondida en «Más» (Personas, Equipos, Distritos, Seguimiento, Reportes); la barra solo lleva Panel, Desempeño, Evaluar, Tareas. | barra inferior | Revisar con uso real qué se abre más; «Personas» es candidata a la barra. |
| A3 | **Evaluar (tablet):** tres filas de filtros + chips + atajos ocupan ~60 % de la pantalla antes de la primera persona, y el botón rojo **«Eliminar el borrador»** queda pegado a los filtros (riesgo de toque accidental). | captura a 768 | Filtros en una fila + «Más filtros»; mover la acción destructiva a un menú «⋯» con confirmación. |

### Tablet (768–1023 px)
| # | Conflicto | Estado |
|---|---|---|
| T1 | **El rail va solo con iconos (16 en el admin) y sus botones no tenían nombre**: ni lectores de pantalla ni tooltip. Personas y Equipos tienen iconos casi iguales. | **Corregido el nombre** (`aria-label` en `core/rail.js`, verificado: 16 etiquetas). Se añadió tooltip por hover/foco para tablet (`shared.css`) pero **no pude verificarlo** (la emulación no reporta puntero fino). Iconos parecidos: pendiente. |

### Login (producción, PC)
Cabe en pantalla, sin scroll, «Entrar / Crear cuenta» claro, enlace de contraseña olvidada visible. No se ejercitó el envío ni el celular real.

## Qué se cambió en este commit
Solo T1 (nombre accesible del rail y tooltip para tablet). El resto son propuestas: cambian el flujo y conviene decidirlas contigo antes (sobre todo M1, M2 y A3).

## Actualización: M1 y M2 atendidos
- **M1 (tareas duplicadas en Entregas):** las tarjetas con botones y los equipos van ahora dentro de «Detalle y acciones de mis tareas» (plegado por defecto cuando existe el tablero).
  Tocar una fila del tablero abre el detalle, salta a la tarjeta y la resalta. Entregas a 390 px: **6,5 → 2,8 pantallas**. En PE anteriores (formulario de trabajos) no se pliega.
  Si el tablero no carga (sin migraciones) el detalle queda abierto.
- **M2 (misma lista en tres sitios):** Inicio ya mostraba solo las 4 más urgentes; ahora «y N más» es un botón a Entregas. **Sigue pendiente:** el Inicio solo cuenta tareas
  individuales (no las de equipo) y Mi perfil conserva su propia lista de tareas.

## Actualización 2: S1, A3 y M5
- **S1:** en la barra de la secretaría, «Entregas» → **«Mis tareas»** y «Tareas» → **«Tareas del distrito»** (el título de cada pantalla ya decía lo segundo). El miembro sigue con «Entregas».
- **A3:** en Evaluar, «Eliminar los N borradores» pasa al final del bloque de filtros, separado por una línea (ya pedía confirmación en un diálogo).
- **M5:** los filtros del calendario van plegados en «Qué mostrar» en celular; el mes empieza a ~390 px en vez de bajo el pliegue. En pantalla ancha siguen abiertos.
- Pendiente: M3 (hero de Inicio), M4 (Mi perfil de 6,9 pantallas), A1/A2 (admin en celular), Personas/Equipos con iconos parecidos, tareas de equipo en Inicio.
