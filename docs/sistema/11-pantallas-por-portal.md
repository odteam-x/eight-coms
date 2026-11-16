# 11 · Pantallas por portal

Cada pantalla con: **para qué sirve**, **qué se hace en ella** y **qué proceso atiende**. Los portales comparten componentes: lo que se llama igual se comporta igual.

## 11.0 Elementos comunes a todos los portales

| Elemento | Qué hace |
|---|---|
| **Menú lateral** (computadora) | Grupos de destinos. Al pie: tu nombre (abre **Mi cuenta**), la **ayuda y manual**, tema, avisos y cerrar sesión; el selector de gestión en administración |
| **Barra inferior** (celular, < 768 px) | Cuatro o cinco destinos frecuentes (`fav`); solo el destino activo muestra su nombre; el resto está en **Más** |
| **Hoja «Más»** (celular) | Destinos en cuadrícula de 3 columnas, acciones en 2, tu cuenta arriba. Se cierra **arrastrando hacia abajo** |
| **Cabecera móvil** | Isotipo, **buscar** (lupa) y **avisos** (campana) como botones redondos; el título de la pantalla va en el contenido |
| **Buscador** (`Ctrl/⌘ + K`) | Salta a una sección, abre el perfil de una persona o inicia una acción. Todo lo que ofrece ya existe; la base decide qué funciona |
| **Campana** | Panel de avisos (proceso 20) |
| **Selector de períodos** | Píldoras generadas desde datos (`renderPEBar`): código y fechas; punto bajo el activo; marca de hoy. Nunca hay PE escritos a mano en el HTML |
| **Panel lateral de perfil** | Abre el perfil de una persona sin salir de la pantalla (hoja en celular) |
| **Indicador de conexión** | Aparece solo cuando se pierde la red (proceso 22c) |
| **Pie de derechos** | Al final de la página: «© 2026 ODTeam X · Todos los derechos reservados · Iniciativa de Wellyn Ramos y Oscar Núñez» |

Reglas visuales transversales: título de pantalla con 4 niveles de jerarquía; tres temas; contraste mínimo 4,5:1 en texto y 3:1 en rellenos; mínimo 44 px de objetivo táctil; nada se comunica solo por color; todo texto de personas pasa por `escHtml`.

---

## 11.1 Portal del miembro (`user.html`)

Cinco destinos más Mi cuenta (Inicio · Mi perfil · Calendario · Mis tareas · Imágenes). Se entra con `Auth.requireRole('miembro')`.

| Pantalla | Para qué sirve | Qué se hace | Proceso |
|---|---|---|---|
| **Inicio** | ¿Qué necesito hacer ahora? | Ver cuenta regresiva, mi evaluación (anillo, nivel, percentil), tareas por atender, próximas fechas, bienvenida | 3, 18 |
| **Mi perfil** | ¿Cómo me va? | Resumen · Criterios · Tareas · Períodos · Desempeño; **Mi gafete** | 18, 21 |
| **Calendario** | Todas las fechas en un lugar | Ver mes, agenda del día, filtrar por etiqueta | 19 |
| **Mis tareas** | Mi trabajo | Ver mis tareas, **Empezar**, **Entregar** (con su tipo de entrega), **Bloquear**, **+ Mi iniciativa** (con «¿Quién te evalúa?»: distrital o regional); ver «Mis equipos»; línea de tiempo del período | 11, 12, 13 |
| **Banco de imágenes** | Enlaces a fotos y videos | Ver, buscar, añadir, editar lo mío | 22 |
| **Mi cuenta** | Lo mío | Perfil (foto, nombre, fondo), Mi rol y preferencias, Seguridad, App (tema, instalar, ayuda, cerrar sesión) | 4 |

En un período **clásico**, Mis tareas muestra el antiguo formulario «registrar trabajo».

---

## 11.2 Portal de la secretaría (`secretario.html`)

Dos grupos: **Mi espacio** (igual que el miembro) y **Mi distrito**. Se entra con `Auth.requireAnyRole(['secretario','miembro'])`.

### Mi espacio
**Inicio** (añade el bloque «Tu distrito» y la **bandeja de trabajo**), **Mi perfil**, **Calendario**, **Mis tareas**, **Imágenes** (Banco de imágenes) y **Mi cuenta**: como en el miembro. **Sus propias tareas están en Entregas**: no las aprueba ella.

### Mi distrito

| Pantalla | Para qué sirve | Qué se hace | Proceso |
|---|---|---|---|
| **Distrito** | Mi gente y mi lugar | **Resumen** (posición, «Qué falta», evolución) · **Personas** (tarjetas, abrir perfiles en modo supervisión) · **Estadísticas** (subir las cifras de Instagram con captura) · **Ranking de distritos** | 8, 17, 18 |
| **Tareas** | Asignar y revisar | **+ Nueva tarea** en tres pasos (solo a su distrito, con rol por persona); filtros **Por revisar / Abiertas / Vencidas / Aprobadas**; revisar entregas (**Aprobar con puntos**, sin peso, **Devolver**; las iniciativas regionales no son suyas); equipos de su distrito | 11, 13 |
| **Desempeño del distrito** | ¿Cómo les va a mi distrito? | Reutiliza el módulo de Desempeño con los datos de su distrito | 18 |
| **Seguimiento** | ¿Quién está al día en mi distrito? | Persona × período, por rol | 18 |
| **Reportes** | Cifras de mi distrito | «Todos los PE» y cortes **Entre períodos / Por actividad**, con CSV | 18 |
| **Calendario → Nueva actividad** | Programar para mi distrito | Crear actividades **solo** para su distrito o personas de su distrito | 19 |

Restricción clave: **solo ve a su distrito**. No es un filtro del portal: la base no entrega más.

---

## 11.3 Portal de administración (`admin.html`)

Se entra con `Auth.requireAuth(true)` (solo `es_admin`). Al abrir, el **selector de entrada** pregunta gestión y período.

### Centro de control

| Pantalla | Para qué sirve | Qué se hace | Proceso |
|---|---|---|---|
| **Panel** | ¿Qué requiere atención? ¿cómo va el período? | **Requiere atención** (enlaces a donde se resuelve), **Datos por revisar**, **Cierre del período** (lista de verificación), 4 KPIs, análisis (acordeón) | 18 |
| **Desempeño** | ¿Cómo les va? | KPIs, evolución del equipo, promedio por rol, **comparar dos períodos**, **comparar hasta 5 personas**, tarjetas por persona | 18 |
| **Seguimiento** | ¿Quién está al día? | Persona × período por rol: estado de evaluación, resultado, hechos de tareas | 18 |

### Operaciones

| Pantalla | Para qué sirve | Qué se hace | Proceso |
|---|---|---|---|
| **Evaluar** | Puntuar y publicar | Elegir persona, ver evidencia, puntuar núcleo y técnico (y segundo rol), guardar borrador, **publicar**, **rectificar**, **Historial de versiones**, eliminar borradores | 15, 16 |
| **Tareas** | Asignar, revisar y calificar | **Reglas de calificación del PE** (arriba), **+ Nueva tarea**, filtros por estado y persona, **Ver entrega** (con etiqueta de tipo y nivel), **Aprobar y puntuar** (sin peso), **Devolver**, **Mover plazo**, **Anular**, **Corregir/Anular/Restaurar nota**, **Historial** | 11, 14 |
| **Equipos** | Equipos del período | Crear, añadir/retirar integrantes, cambiar estado, **tarea de equipo**, aportes, calificación grupal, notas individuales, historial | 10, 13 |
| **Calendario** | Fechas y tareas del mes | Ver, **Nueva actividad**, **Lista de actividades**, crear actividad o asignar tarea desde un día | 19 |
| **Banco de imágenes** | Enlaces de eventos | Ver, añadir, editar y borrar cualquier ítem | 22 |

### Organización

| Pantalla | Para qué sirve | Qué se hace | Proceso |
|---|---|---|---|
| **Personas y accesos** (menú: «Personas») | Accesos, roles, distrito | Tarjetas o tabla; filtros de estado; **Gestión**: aprobar, tipo, distrito, rol, **segundo rol**, participación, gafete, eliminar | 1, 7 |
| **Distritos** | Evaluar y comparar distritos | Ranking acumulado; por distrito: **Resumen · Evaluación · Estadísticas · Personas** | 17 |

### Sueltos
| Pantalla | Qué se hace | Proceso |
|---|---|---|
| **Reportes** | **Todos los PE** (reporte general) o **Un PE en detalle** (constructor, hoja imprimible, CSV) | 18 |
| **Auditoría** | Filtrar y leer cambios sensibles; descargar CSV | 22 |

### Configuración (un solo ítem que abre el índice; arriba, la lista «Preparar la evaluación»)

| Sub-pantalla | Qué se hace | Proceso |
|---|---|---|
| **Gestiones** | Abrir gestión, ver archivadas | 5 |
| **Períodos** | Crear/editar, fechas, modelo, activar | 6 |
| **Actividades** (se abre desde el Calendario) | Lista y creación de actividades, y tipos (etiquetas) | 19 |
| **Rúbrica** | Competencias comunes y de rol (con anclas), campos de registro; rúbrica clásica | 8 |
| **Roles y perfiles** | Descripción, responsabilidades, requisitos; perfiles con pesos y versiones | 8 |

---

## 11.4 Entrada y páginas públicas

| Página | Para qué |
|---|---|
| `index.html` | **Entrar / Crear cuenta** (un solo lugar), recuperar contraseña |
| `/v/<código>` (`verificar.html`) | Verificación **pública** del gafete (sin sesión) |
| `ayuda/miembro.html` · `ayuda/secretario.html` | Manuales públicos de uso |
| `ayuda/admin.html` | Carcasa del manual de administración: **privado** (su texto vive en la tabla `manuales_privados`; solo lo lee la administración con sesión) |
| `offline.html` | Pantalla «Sin conexión» de la app instalada |
| `registro.html` | Solo redirige a `index.html#registro` (enlaces viejos) |

## 11.5 Qué ve cada pantalla cuando no hay datos

Reglas: un estado **vacío** es de línea punteada y dice **cuándo llegarán** los datos (por ejemplo «Aún no hay evaluación publicada para PE2. Se publica el 25 de noviembre»); un **error** lleva icono, texto y `role="alert"` con un botón de reintentar (nunca se muestra vacío cuando falló); una **carga** usa esqueletos o un indicador. Los tres nunca se parecen entre sí.
