# Investigación por pantalla: referencias, problemas y decisiones

Regla aplicada: **investigar → comparar → decidir → implementar**. Esta sección enlaza, por pantalla, lo que **realmente consulté** con lo que se decidió. Donde no pude consultar algo, lo digo.

## Qué consulté de verdad (y qué no)
| Fuente | Qué pude ver | Límite |
|---|---|---|
| **Pinterest** (9 de nov 2026) | Miniaturas de ~90 pantallas en 14 búsquedas: login, onboarding, dashboards, tablas, perfiles, configuración, notificaciones, estados vacíos, móvil, calendario, editorial | Resolución de miniatura; sin enlaces individuales de pin |
| **Páginas públicas de acceso** de Vercel, Stripe, Figma, PostHog, Notion y Linear | Estructura real (orden de elementos, acciones, enlaces) leída del texto de cada página | Solo la pantalla de acceso; la ventana integrada solo mostró el borde superior. Linear cargó vacío al leer el texto |
| **NN/G** (estados vacíos, mensajes de error, formularios) | Texto de los artículos | Lectura parcial (truncada) |
| **Material Design 3** (barra de navegación) | Texto de la página | Solo ese componente |
| **SaaSUI, SaaSFrame, Mobbin** | Solo la portada (categorías y conteos: p. ej. SaaSFrame lista «Sidebar Navigation 379 pantallas», «Account Setup 571», «Add & Edit 424», «Search 193») | La biblioteca de pantallas está detrás de la portada/registro: **no la exploré** |
| **Dribbble, Behance, Awwwards, Apple HIG** | **No los consulté** | — |
| **Interior** de Linear, Attio, Asana, Intercom, HubSpot, Notion, Figma, Stripe | **No accesible** sin sesión | Solo lo que muestran sus páginas públicas |

## Por pantalla
**Acceso (login, registro, recuperación)** — *Implementado en el demo.*
- *Problema nuestro:* el enlace «Olvidé mi contraseña» quedaba debajo del botón; una lista de beneficios competía con el formulario.
- *Referencias:* **Stripe** (título «Inicia sesión en tu cuenta», enlace «¿No recuerdas la contraseña?» en la fila de la contraseña, «Recordarme», un solo botón primario); **Figma** (método rápido arriba, «o», correo y contraseña, «Restablecer contraseña», «¿No tienes cuenta? Crea una»); **Vercel** (columna única centrada, título, un campo y botón, términos al pie); **PostHog/Notion** (correo primero, avance progresivo).
- *Decisión:* enlace de recuperación en la fila de la contraseña; se retira la lista de puntos junto al formulario; un solo botón primario; enlace de registro debajo. *No se adoptan* los accesos por Google/SSO (las cuentas las aprueba la administración) ni «Recordarme» (no hay lógica detrás: sería engañoso).
- *Principio UX (NN/G):* mensajes de error junto al campo con texto + color + icono; sin botón de «borrar formulario».

**Bienvenida / onboarding** — *Propuesta (ya existe el asistente `core/bienvenida.js`).*
- *Referencias (Pinterest):* tarjeta «Empezar» con **barra de progreso («4 de 6»)**, pasos tachados al completarse y un botón de acción por paso; asistente de **pasos numerados 1–4 con una pregunta por pantalla** y «Siguiente»; modal de bienvenida con «Terminar configuración».
- *Decisión:* la tarjeta «Primeros pasos» de Inicio muestra progreso numérico y una acción por paso; los pasos se tachan; el asistente mantiene una decisión por pantalla.

**Dashboard principal y paneles** — *Parcialmente implementado.*
- *Referencias:* tablero financiero azul marino (KPI con icono + cifra + delta, gráfico de área, anillo con total al centro); *Panel Home* de tu tablero (estadísticas en píldoras altas, barras redondeadas con valor resaltado); tablet con menú integrado.
- *Decisión:* «Requiere atención» primero, luego KPI, luego gráficos; cada gráfico responde una pregunta. Vidrio sobre malla.

**Tablas y listados, filtros, buscadores** — *Propuesta.*
- *Referencias:* barra en una fila (buscador, chips con conteo, selector de fechas, exportar y acción primaria a la derecha); menú por columna; selección con barra de acciones masivas; fila expandible; estados como píldora con punto.
- *Decisión:* una sola barra `.filtros-fila` para Evaluar, Personas, Tareas, Seguimiento y Auditoría; acciones masivas al seleccionar.

**Perfiles de usuario y vistas de detalle** — *Propuesta.*
- *Referencias:* tarjeta con portada, avatar con aro, tres cifras separadas por filetes, acción principal; ficha con franja etiqueta/valor y pestañas.
- *Decisión:* encabezado con patrón de marca con degradado lateral (lo pediste), cifras en tres bloques, pestañas internas existentes.

**Configuración de cuenta y preferencias** — *Propuesta.*
- *Referencias (Pinterest):* subnavegación vertical (Perfil, Notificaciones, Seguridad…) **o** pestañas superiores; filas «etiqueta + descripción a la izquierda, control a la derecha»; **matriz de notificaciones tipo × canal con interruptores**; seguridad con «Cambiar contraseña»; acción destructiva al final en rojo; apariencia con tarjetas de tema.
- *Decisión:* *Mi cuenta* en dos columnas (subnavegación + filas tipo Ajustes); preferencias de notificación como matriz (las **esenciales bloqueadas y marcadas**); tarjetas de elección de tema; opción de tabla compacta.

**Notificaciones y centro de actividad** — *Propuesta (el panel existe).*
- *Referencias:* panel con **pestañas Sin leer / Leídas / Archivadas** (o Hoy / Esta semana / Antes), **grupos por día con conteo y «Ver todo»**, ítem = actor + acción + objeto + hora + punto de no leído, **acciones en línea (Aceptar/Rechazar)**, pie con «Marcar todo como leído» y «Ver todas».
- *Decisión:* añadir pestañas Sin leer/Todas y grupos por día; enlazar cada aviso con su objeto (ya existe `#ir/…`).

**Estados vacíos, errores y carga** — *Propuesta.*
- *Referencias:* tarjetas con **ilustración + título corto + una línea + un botón** (Sin mensajes, Sin notificaciones, Sin resultados, Sin conexión, Error → «Reintentar»).
- *NN/G (estados vacíos):* sirven para comunicar el estado del sistema, dar pistas de aprendizaje y abrir un camino directo a la tarea clave. *(errores):* visibles, cerca del origen, redundantes (texto + color + icono), constructivos.
- *Decisión:* todo estado vacío trae título, una línea y **una acción**; los errores llevan «Reintentar». *Sin ilustraciones* nuevas por ahora (las cámaras no gustaron); icono de línea.

**Modales y confirmaciones** — *Propuesta.*
- *Referencias:* modal con título, campos con etiqueta sobre el borde, resumen lateral, acciones «Cancelar / principal»; aviso con icono y texto sobre las consecuencias.
- *Decisión:* acciones destructivas piden confirmación con **qué se pierde**; el modal usa `openModal` (foco, Escape).

**Navegación y menús** — *Implementado en el demo.*
- *Referencias:* riel plegable a iconos con tooltip, secciones con micro-etiqueta, hijos con línea guía, insignias de conteo (tu imagen y Pinterest); **Material 3: la barra inferior admite 3–5 destinos de igual importancia, consistentes entre pantallas**.
- *Decisión:* menú integrado con activo en píldora sólida; en móvil 4–5 destinos + «Más» (los demás agrupados por sección).

**Móvil** — *Parcial.*
- *Referencias:* hero con una sola acción clara, rejilla de 3 KPI con delta, selector D/S/M, barra inferior con píldora activa.
- *Estado:* escrito en `vidrio.css`; **no verificado visualmente** (no logré fijar el tamaño de ventana).

**Verificación de identidad (gafete)** — *No investigada.* **Estados de carga** — *No investigados por separado.*

## Descartes
Accesos sociales/SSO, «Recordarme» sin lógica, ilustraciones 3D/cámaras, formas geométricas sueltas, degradados de neón, bordes degradados.
