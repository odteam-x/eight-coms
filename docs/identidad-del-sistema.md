# Identidad del sistema — «Trazo»

**Qué es el sitio:** un cuaderno de seguimiento del equipo. Lo que importa es el dato (un resultado, una fecha, una tarea), no la decoración.

## Principios (y qué se retiró por cada uno)
| Principio | Se aplica así | Patrón retirado |
|---|---|---|
| **Estructura por trazos, no por cajas** | Filetes finos (`--trazo`) y espacio separan secciones | Tarjetas dentro de tarjetas, bordes gruesos, sombras duras |
| **La tipografía hace el trabajo** | Barlow Condensed para números y títulos, Barlow para etiquetas, Source Sans para texto; un solo nivel de rótulo por sección | Títulos gigantes repetidos, mayúsculas en cada bloque |
| **El coral marca «dónde estás»** | Subrayado de la pestaña actual, borde superior del período en curso, la fecha que toca hoy | Coral como relleno de botones secundarios, resplandores |
| **Plano** | Sin degradados ni brillos en contenedores; sombra solo en capas flotantes | Degradados de tarjeta, halos, `box-shadow` decorativos |
| **Ritmo corto** | Escala 4/8/12/16/24/32; secciones se separan 24–32 px (antes 32–48) | Separaciones de 48 px, encabezados duplicados |
| **Información, no insignias** | Lo normal va en texto; solo lo que pide atención es etiqueta de color | Píldoras para cada estado y conteo, píldoras rellenas de nivel |
| **Nombres que se entienden** | Cada destino se llama como lo que hay dentro (Mi desempeño, Calendario, Mis tareas) | Grupos genéricos («Yo», «Mi trabajo») que escondían pantallas |

## Piezas canónicas
- **Pestañas de sección (hub):** texto, subrayado de 3 px en la actual, filete debajo. Viven dentro de la pantalla (`#hub-nav`, `core/rail.js`).
- **Rótulo de sección:** `h2.pf-h` (`--fs-lg`) con filete inferior opcional (`.pd-cab`).
- **Línea de tiempo:** columnas bajo un filete; el período en curso lleva el filete de 3 px en `--marca`.
- **Nivel de una persona:** punto + texto (`.nivel-badge` en tablas y listas). Píldora rellena solo en el perfil.
- **Alertas:** icono + texto + acción; una barra lateral nunca (se curva con el radio).

## Dónde vive
`identidad.css` (carga después de `premium.css` y `evolucion.css`, antes de `movil.css`) es el único sitio que impone esta identidad; no introduce colores (la paleta sigue cerrada y se mide con `node tools/contraste.js`).

## Lo que falta (honesto)
Esta pasada cubre ritmo, pestañas de sección, línea de tiempo y la navegación. Quedan por llevar a la identidad: formularios y diálogos, el Panel del administrador, Reportes y los botones secundarios.

## Aplicado en la segunda pasada
Inicio sin resplandor ni patrón a plena intensidad; listas dentro de tarjetas separadas por filetes (sin «tarjeta dentro de tarjeta»); estado de tarea y nivel como punto + texto; cifras clave (KPI) como número sobre un filete; calendario como cuadrícula de filetes. Revisado en el simulador (miembro, 1100 px).
