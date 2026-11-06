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

## Actualización 3: M3, M4, A1 e iconos (medido a 390 px en el simulador)
| Pantalla | Antes | Después | Cómo |
|---|---|---|---|
| Inicio (hero) | ~380 px | **224 px** | `movil.css`: título y cuenta atrás en proporción |
| Mi perfil (miembro) | 6,9 pantallas | **3,8** | «Ver el desglose por tarea» plegado (`core/evaluacion-perfil.js`) |
| Desempeño (admin) | 8,7 | **5,0** | `plegarEnCelular()` (`core/ui.js`): cada tarjeta ancha se pliega bajo su título; la primera queda abierta |
| Desempeño (miembro) | 2,4 | 2,5 | sin cambio útil: ya era corto |
| Entregas | 6,5 | 2,8 | (ya hecho) |
- Iconos del admin: **Personas = tarjeta de identificación, Equipos = grupo**; antes los dos resolvían al mismo icono (`users-round` es alias de `users`).
- Las gráficas siguen midiendo bien al abrir una sección plegada (comprobado: 314×260). En pantalla ancha nada cambia.

## Ruta propuesta (en este orden)
1. **Publicar lo hecho en una vista previa** (subir la rama; Vercel genera un enlace sin tocar producción) y revisarlo con usuarios reales de cada rol. *Es la única forma de ver datos y nombres reales.*
2. **Panel del admin en celular (6,8 pantallas):** pasar sus tarjetas a `plegarEnCelular` (hoy no aplica porque su título no es hijo directo) y subir «Requiere atención» arriba.
3. **Filtros de Desempeño y Evaluar:** una fila + «Más filtros»; en Desempeño ocupan 1,3 pantallas antes del primer dato.
4. **Barra inferior del admin:** decidir con uso real si Personas entra en la barra (hoy Panel, Desempeño, Evaluar, Tareas, Más).
5. **Tareas de equipo en Inicio** (hoy solo cuenta individuales) reutilizando los datos del tablero «Qué me toca».
6. **Reportes (secretaría 8,6 pantallas):** resumen primero, detalle plegado.
7. **Medir rendimiento real** (Lighthouse en la vista previa): ~11 hojas de estilo por página y `admin.js` de 149 KB son los candidatos; no se midió ni se tocó.
8. **Tema claro y tablet a ojo** en la vista previa (no se revisaron en pantalla).

## Recorrido en el navegador del usuario (1351×778) y propuesta de estructura
Se recorrió el administrador en el propio navegador del usuario, a pantalla de portátil (sobre el simulador local).

**Hecho a raíz de ese recorrido y de las anotaciones del usuario**
- **Panel:** «Requiere atención» avisa **«N personas por definir un rol»** y **«N personas sugirieron un rol — Ver»** (preferencias de rol que difieren del rol asignado); «Ver» abre Personas ya filtrada (nuevo filtro «Sugirieron un rol»). Es información: no cambia ningún rol.
- **Espaciado:** en Desempeño las tarjetas estaban a 0–1 px una de otra («todo está junto»); ahora hay ritmo vertical entre secciones.
- **Comparar personas:** el hueco vacío es un estado con propósito (título «Selecciona personas para comparar», explicación y atajos «las 3 / 5 con mejor resultado»).
- **Seguimiento:** la celda fija de la persona ya no es una caja oscura de esquinas rectas (toma el fondo de su contenedor); el nivel en tablas es punto + texto.
- **Tarjeta de persona:** plana en las listas (antes diez tarjetas con patrón de cuadros a la vez); el patrón elegido queda en la tarjeta propia y en la cabecera del perfil.
- **Cabecera del perfil (panel):** identidad a la izquierda y resultado a la derecha (≈190 px de alto en lugar de ≈470).

**Hallazgos nuevos (sin resolver)**
1. **Ventana inicial «¿Con qué vas a trabajar?» en cada entrada del administrador:** dos decisiones antes de ver nada. Propuesta: entrar directo con el período activo y poner el selector de gestión/período en la cabecera; preguntar solo si hay más de una gestión abierta.
2. **El menú lateral del administrador no cabe en un portátil (778 px de alto):** Calendario, Reportes y toda la Configuración quedan bajo un desplazamiento interno. Propuesta: agrupar con títulos plegables (Operación / Análisis / Configuración) y dejar «Próxima fecha» fuera del menú.
3. **Evaluar:** el encabezado de filtros usa ~200 px antes de la primera persona; la columna de la lista es estrecha (270 px). Propuesta: filtros en una fila + «Más filtros», lista de 340 px.
4. **Simulador:** muestra «Sin rol» en las tarjetas porque no entiende el `join` de roles con nombre de clave que usa el código real; no es un fallo de producción, pero puede confundir en las capturas.

**Propuesta de estructura (para decidir)**
| Hoy (16 secciones) | Propuesta (8 destinos) |
|---|---|
| Panel · Desempeño | **Hoy** (lo que requiere acción) · **Resultados** (Desempeño + Seguimiento + Distritos + Reportes como pestañas) |
| Evaluar · Personas · Equipos | **Personas** (lista, perfil, roles, equipos) con **Evaluar** como acción principal de cada persona |
| Tareas · Calendario · Actividades | **Trabajo** (tareas, calendario y actividades en una sola agenda) |
| Períodos · Rúbrica · Roles y perfiles · Gestiones | **Configuración** (plegada, con asistente para un período nuevo) |
La idea: **«Hoy» responde qué hay que hacer; «Resultados» responde cómo vamos; «Personas» y «Trabajo» son donde se hace**. Requiere validarlo con quienes administran antes de mover nada.

## Fase 1 de la nueva estructura (hecha)
Menú del administrador: **de 15 destinos a 4 + Configuración** (cabe en 778 px de alto sin desplazarse):
**Hoy** (antes Panel) · **Personas** (Personas · Equipos · Evaluar) · **Trabajo** (Tareas · Calendario · Actividades) · **Resultados** (Desempeño · Seguimiento · Distritos · Reportes) · *Configuración* (Períodos · Rúbrica · Roles y perfiles · Gestiones).
- Una **fila de pestañas** bajo cada destino pasa de una sección hermana a otra en un clic (`core/rail.js · pintarHub`); el destino del menú queda activo en cualquiera de sus secciones y el título móvil dice la sección.
- En celular la barra inferior queda **Hoy · Personas · Trabajo · Resultados · Más** (antes Panel · Desempeño · Evaluar · Tareas · Más).
- **Sin ventana de entrada** cuando hay una sola gestión (antes preguntaba gestión y período en cada entrada); con varias gestiones se sigue preguntando.
- *Actividades* pasa de Configuración a **Trabajo** (se usa a diario para crear eventos).
- Ninguna pantalla cambió por dentro; las rutas y los enlaces de avisos siguen funcionando.
**Pendiente de esta estructura:** aplicar el mismo esquema a la secretaría (hoy 10 destinos) y validar los nombres con quienes administran.
