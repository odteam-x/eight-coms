# 04 · Organización del año (procesos 5 a 10)

Todo lo que la administración **prepara antes** de que el equipo trabaje. Si esto está mal, todo lo demás sale mal: por eso cada actividad tiene su regla.

## Proceso 5 · Gestión del año

**Objetivo.** Delimitar el año de trabajo y cerrar el anterior sin perder nada.

**Actor.** Administración. **Pantalla.** Configuración → **Gestiones** (`tab-gestiones`).

### Qué es una gestión

Un contenedor **estanco**: sus períodos, criterios, perfiles, rúbrica, calendario y actividades le pertenecen. Estados: **abierta/actual** o **archivada**. Una archivada es **solo lectura** para todos, incluida la administración (la base lo impone con `gestion_escribible()` y `gestion_id_escribible()` en las políticas de escritura).

### Actividades

1. **Abrir gestión nueva** (botón en la pantalla Gestiones; pide el nombre, por ejemplo «2027-2028»).
2. El sistema ejecuta `abrir_gestion()`: **archiva** la gestión anterior, **crea** la nueva, **clona** el catálogo de 24 criterios y la **última versión de cada perfil de rol**, y deja los períodos de la gestión nueva en modelo por roles (si el origen tenía catálogo).
3. La lista de gestiones muestra cada una con su estado. Las archivadas se consultan en solo lectura (con `?gestion=` en la dirección o desde el selector de entrada).
4. **Selector de entrada**: al abrir el panel de administración, un diálogo pregunta «¿Con qué vas a trabajar?» (gestión y período). Se puede marcar «No volver a mostrar esto» (se guarda en el navegador). Para volver a verlo: Configuración → Apariencia y entrada → **Volver a mostrar**.

### Reglas

- `abrir_gestion` solo la ejecuta la administración (la guarda correcta es `IF NOT public.is_admin() THEN RAISE`; una versión anterior estaba invertida y dejaba pasar a un anónimo: migración 0008, ya corregida).
- **El registro de personas se cierra cuando no hay gestión abierta.**
- La pertenencia de personas a una gestión concreta **no existe**: `profiles` no tiene `gestion_id` (el diseño está en `0006_gestion_miembros.PENDIENTE.sql`, sin aplicar a propósito).
- Escribir en una gestión archivada está bloqueado en la base y los botones del portal se deshabilitan (`bloquearEscritura()`).

## Proceso 6 · Períodos de evaluación

**Objetivo.** Definir las etapas del año, sus fechas y cuál está activa.

**Actor.** Administración. **Pantalla.** Configuración → **Períodos** (`tab-periodos`).

### Actividades

1. **Crear un período**: formulario guiado en orden: **nombre** (PE5, hasta 30 caracteres) → **descripción** (qué trabaja el equipo, hasta 80) → **modelo** (rúbrica por roles o clásica; los períodos nuevos pueden ser por roles) → **cuatro fechas**: *Inicio del período*, *Fin del trabajo*, *Entrega de resultados* y *Jornada de cierre* → **activo** sí/no. El formulario **sugiere fechas** después del período anterior.
2. **Validación de fechas**: inicio ≤ fin del trabajo ≤ entrega ≤ jornada. Si no se cumple, no guarda.
3. **Activar un período**: se hace con `set_periodo_activo(id)`, que **desactiva el anterior y activa el nuevo en un solo paso**. Un índice único parcial garantiza que **solo hay uno activo**; pasar `null` deja la gestión sin período activo (no recomendado: «una gestión sin período activo deja la plataforma sin contexto»).
4. **Editar o borrar** un período: la lista se divide en **Rúbrica por roles** y **Clásicos**, con una línea de tiempo. Un período con evaluaciones **no cambia de modelo**.
5. **Participación por período**: desde Personas, la administración marca quién **no participa** en un PE (`periodo_participantes.activo = false`). Sin fila se asume que participa.

### Reglas

- **Los períodos que existían cuando se creó la rúbrica por roles quedan clásicos para siempre** (`v2_permitido = false`): nadie recalifica a posteriori. Los creados después pueden ser por roles; `v2_permitido` lo fija el servidor.
- El **peso de las tareas** de cada período por roles se configura en **Tareas → Reglas de calificación del PE** (proceso 14). Los períodos viejos arrancan con **0 %**, los nuevos con **20 % «sin confirmar»** hasta que la administración lo guarde.
- Las fechas alimentan: la cuenta regresiva de **Inicio**, el **calendario**, los **recordatorios** y los avisos de cierre.

## Proceso 7 · Personas: acceso, tipo, distrito, rol(es) y participación

**Objetivo.** Que cada persona tenga el tipo de acceso, el distrito y el rol correctos.

**Actor.** Administración (lectura de la secretaría para su distrito). **Pantalla.** **Personas** (`tab-usuarios`).

### Qué muestra

- **Tarjetas** de persona por defecto (con una vista de **tabla** alternativa). Cada tarjeta resume foto, nombre, rol, distrito y estado de evaluación del período elegido.
- **Barra de período** y **filtros**: distrito, **estado** (con conteos): *acceso pendiente, sin evaluar, evaluación en borrador, sin rol, sin distrito, inactivas en el período, administradores*. Una sola definición (`estadosDePersona`) alimenta las tarjetas, la tabla y los enlaces desde el Panel («Requiere atención»).
- Una tarjeta **abre el perfil en un panel lateral** (en celular, una hoja) con pestañas de perfil y una pestaña extra **Gestión**.

### Pestaña Gestión (todo lo que antes era una fila de tabla)

| Control | Qué hace | Efecto |
|---|---|---|
| **Acceso** (aprobar / revocar) | Aprueba o quita el acceso | Aviso `acceso_aprobado` al aprobar; auditoría |
| **Tipo de acceso** | Miembro / secretaría | Decide el portal y los permisos |
| **Administrador** | Marca `es_admin` | La persona deja de evaluarse |
| **Distrito** | Asigna el distrito | Define qué ve una secretaría |
| **Rol principal** | Asigna el rol | Define el perfil de evaluación y el núcleo |
| **Segundo rol** (0062) | Elige **un** segundo rol o «Sin segundo rol» | Permite asignarle tareas con ese rol y evaluarla también por él. Máximo 2 roles; si ya tiene más, aparece un aviso para dejar uno |
| **Participa en el período** | Activa/desactiva en el PE elegido | Si no participa, el PE «no existe» para ella |
| **Gafete** | Abre, regenera o revoca el gafete | Capítulo 10 |
| **Eliminar** | Borra la persona (con confirmación) | Auditoría; revisar que no queden huérfanos |

Los cambios pasan por los mismos manejadores y llamadas a la API de siempre; la base valida (disparador `profiles_bloquear_privilegios`) y la **auditoría registra** privilegios y borrados (tabla `auditoria_global`).

### Reglas del segundo rol (0062)

- Máximo **2 roles distintos** por persona: lo imponen dos disparadores (`persona_roles_max2` y `profiles_rol_max2`). Los datos anteriores **no se borran**: `personas_con_mas_de_dos_roles()` lista a quienes ya tenían más y el portal les pide elegir.
- El segundo rol es la **única** fila de `persona_roles` distinta del principal. Quitar un permitido o cambiar el principal limpia el rol predeterminado de las preferencias, no las preferencias.
- **Sin segundo rol, solo la administración puede asignar una tarea de otro rol**, y queda marcada **«Excepción de rol»** (`rol_excepcion = true`, fijado por el servidor).

### Datos por revisar (Panel)

El Panel detecta contradicciones entre datos ya guardados y avisa dónde mirar (no corrige nada): personas aprobadas **sin rol o sin distrito**, evaluación publicada de alguien que **no participa**, evaluación de una persona **sin acceso aprobado** o de la administración, **período activo sin fechas**.

## Proceso 8 · Roles, segundo rol, perfiles de evaluación y rúbrica

**Objetivo.** Definir **qué se mide** y **con qué peso** para cada rol.

**Actor.** Administración. **Pantallas.** Configuración → **Roles y perfiles** (`tab-roles`) y **Rúbrica** (`tab-rubrica`).

### Roles (la tabla `roles`)

Cada rol lleva: **nombre**, **qué hace** (descripción, hasta 1000), **responsabilidades** (una por línea, hasta 2000) y **requisitos** (hasta 1000). Eso lo ven las personas al recibir una tarea, en Mi cuenta y en la bienvenida. La pantalla es una **tarjeta por rol** con su perfil vigente, una barra de pesos apilada y las versiones anteriores.

### Perfiles de evaluación (`perfiles_rol` + `perfil_criterios`)

- Un perfil es la **lista de criterios técnicos con sus pesos** de un rol. Los pesos **suman exactamente 100** (lo exige un disparador diferido).
- **Versionado**: un perfil **usado por alguna evaluación es inmutable**. Para cambiarlo, `crear_perfil_rol()` genera una **versión nueva** que rige **desde un período en el que ese rol aún no tiene evaluaciones**.
- El perfil de cada evaluación lo **fija el servidor** (`perfil_vigente`) en el primer guardado y no cambia: así los resultados históricos son reproducibles.
- **Quién ve cuál**: una persona evaluada en un perfil conserva ese perfil aunque después cambie de rol.

### Rúbrica por roles (`criterios_v2`, por gestión)

**24 criterios**: 5 **núcleo** (iguales para todos los roles, comparados en valor absoluto) y 19 **técnicos**.

| Núcleo | Técnicos (algunos, por rol) |
|---|---|
| Cumplimiento de plazos de entrega · Respuesta y disponibilidad ante requerimientos · Colaboración y trabajo en equipo · Iniciativa y proactividad · Calidad y completitud de la entrega | Planificación y organización · Revisión y control de calidad · Edición y montaje audiovisual · Diseño y composición gráfica · Fluidez y expresión oral · Construcción narrativa y guion · Ejecución y publicación en redes · Composición y encuadre fotográfico · Dominio técnico del equipo de captura · Ortografía, gramática y redacción · Identidad de marca · Métricas · Gestión de comunidad · Logística y coordinación de coberturas · Gestión de recursos y equipos · Liderazgo y delegación · Visión estratégica · Vocería institucional · Claridad del mensaje |

Cada criterio tiene **anclas** («¿Cómo se puntúa?») para los valores 1, 3 y 5 (2 y 4 son intermedios) —relevantes para las evaluaciones antiguas en escala 1–5— y un `key`, `tipo`, `activo` y orden. Se muestran **siempre con el nombre completo**, nunca con códigos de tres letras.

### Escala de puntuación

- **Evaluaciones nuevas** (desde 0023): cada criterio técnico se puntúa **de 0 hasta su propio peso** y cada criterio del núcleo **de 0 a 10**, arrastrando una barra, escribiendo el número o con −/+.
- **Evaluaciones antiguas** conservan su escala 1–5 y se calculan **exactamente como antes**. La escala (`cinco` o `pesos`) la fija el servidor al primer guardado.
- **Un criterio sin puntuar se excluye del cálculo; nunca vale 0.** (Cero es una puntuación válida.)

### Rúbrica clásica

Los períodos clásicos usan **7 criterios de 0 a 4 + bono de excelencia (0 a 2)**, máximo 30, que se administran en la pestaña **Rúbrica → Clásica** y en la tabla de significados por nivel (1 a 4 por criterio). No se crean períodos clásicos nuevos.

## Proceso 9 · Distritos (estructura)

**Objetivo.** Agrupar a las personas por distrito y poder evaluar cada distrito.

- Los distritos son una tabla propia; cada persona tiene un distrito (lo asigna la administración).
- La **secretaría** de un distrito ve a su gente, sus tareas, su seguimiento, su desempeño y sus reportes.
- La **evaluación de distrito** y el **ranking acumulado** se describen en los capítulos 06 y 08; las **estadísticas de Instagram** las sube cada secretaría (cap. 08).
- Pantalla de administración: **Distritos** (ranking acumulado y un panel por distrito con Resumen · Evaluación · Estadísticas · Personas).

## Proceso 10 · Equipos

**Objetivo.** Agrupar personas de un período para trabajar tareas compartidas y ver cómo rinde el grupo.

**Actor.** Administración (crea y modifica); integrantes y secretaría leen. **Pantalla.** **Equipos** (`tab-equipos`); «Mis equipos» bajo las tareas de Entregas.

### Actividades

1. **Nuevo equipo**: nombre, **PE** (después **no se puede cambiar**), descripción opcional, **responsable de seguimiento** (opcional; recibe los avisos del equipo) y **ámbito** (un distrito: solo pueden entrar personas de ese distrito).
2. **Añadir integrantes**: buscar y marcar personas. **Pueden entrar**: acceso aprobado, que no sean administración y que **no estén desactivadas en ese PE**.
3. **Excepción de ámbito**: si el equipo tiene distrito y se quiere sumar a alguien de otro, se usa la excepción y se **escribe el motivo** (queda guardado).
4. **Retirar** a un integrante: pide motivo; quien entra o sale recibe un aviso **esencial** con correo.
5. **Cambiar estado** (activo, inactivo, archivado): archivar pide motivo y **no se puede si el equipo tiene tareas de equipo abiertas**. Los equipos **nunca se borran**.
6. **Alertas**: si un integrante cambia de distrito o deja de participar, **nada cambia solo**: el equipo muestra una alerta (evento `alerta`) y la administración decide.

### Reglas y permisos

- Solo la administración escribe (todo por RPC: `equipo_guardar`, `equipo_cambiar_estado`, `equipo_agregar_miembros`, `equipo_retirar_miembro`; el DML directo está revocado).
- Una persona activa aparece **una vez** por equipo (índice único parcial); si se vuelve a añadir se crea una fila nueva (historial).
- **Lectura**: el miembro lee sus equipos (solo la plantilla actual); la secretaría, los equipos cuyo distrito es el suyo o que tienen a alguien de su distrito, con su historial.
- Un equipo **solo existe para períodos por roles**.
