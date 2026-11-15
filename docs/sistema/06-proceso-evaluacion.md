# 06 · Evaluación (procesos 15 a 17)

## Proceso 15 · Evaluar por rol y publicar

**Objetivo.** Que la administración puntúe a cada persona de forma comparable, con los hechos delante, y publique un resultado oficial.

**Actor.** Solo **administración** (`evaluaciones_admin`). Una persona nunca puntúa a otra por esta vía; la administración **no se evalúa**.

**Pantalla.** Admin → **Evaluar** (`tab-evaluar`).

### 15.1 Qué se ve en Evaluar

- **Arriba**: período, búsqueda, filtros de **rol** y **distrito**, y los estados con conteos: **Todas · Pendientes · Borrador · Publicadas**. Una barra muestra el avance de evaluaciones publicadas y hay atajos.
- **Computadora**: la lista de personas a la izquierda y el formulario a la derecha. **Celular**: el formulario aparece **debajo de la lista** y la pantalla baja sola hasta él al elegir a una persona.
- **Modo enfoque**: al abrir a una persona, el resumen y los atajos de arriba se **ocultan solos** para dar más espacio a los criterios. El botón **Mostrar resumen / Ocultar resumen** lo alterna y el portal **recuerda** la elección. Sin nadie elegido todo está a la vista.
- **Resumen de la persona**: su rol (y «+ segundo rol»), distrito, la versión de su perfil, y la **nota de tareas con su peso** («Tareas 80 · pesan 20 %») o «Tareas sin calificar».
- **Evidencia de tareas** (`resumen_tareas_periodo`): lo entregado a tiempo, devoluciones, iniciativas, tareas vencidas o prorrogadas. Son **hechos de ayuda**: sugiere a qué criterio del núcleo alimenta cada hecho (Plazos ← a tiempo/vencidas/prorrogadas; Calidad ← devoluciones; Iniciativa ← propias aprobadas por otra persona), **nunca puntúa ni rellena nada**. Con pocas tareas con plazo avisa que se lea con cautela.

### 15.2 Actividades paso a paso

1. **Elegir el período** y **tocar a la persona**. Arriba del formulario se ve su rol y la versión de su perfil. Solo se puede evaluar a quien **tiene rol** y cuyo rol **tiene perfil vigente** (si no, la pantalla explica qué falta: asignar rol en Personas, o crear el perfil en Roles y perfiles).
2. **Revisar la evidencia de tareas.**
3. **Puntuar el núcleo transversal** (5 criterios, cada uno de 0 a 10) y los **criterios técnicos del rol principal** (cada uno de 0 a su peso).
4. **Si la persona tiene segundo rol** (0062) y hay perfil vigente para él: aparece un bloque con los **criterios técnicos del segundo rol** (solo puntos de 0 a su peso; sus claves van con prefijo `r2:` en la pantalla; el comentario va en la nota general). **El núcleo se puntúa una sola vez.**
5. **Escribir comentarios** (opcional) y completar los **campos de registro** (sí/no, opciones, texto) que existan.
6. **Mirar el contador** «N de M obligatorios». **Guardar como Borrador** cuantas veces haga falta. **Publicar** solo se habilita cuando los obligatorios están completos (y los del segundo rol, si se empezaron a puntuar; ver 15.5).
7. Los borradores que ya no sirven se eliminan: **Eliminar borrador** (el de una persona) o **Eliminar los N borradores** (los del período), siempre con confirmación. **Las publicadas no se tocan.**

### 15.3 La barra de puntos

Cada criterio se puntúa **de 0 hasta su propio peso** (técnico) o **de 0 a 10** (núcleo). La escala se ve bajo el nombre («Escala 0 a 30 · peso 30»).

| Para… | Hacer |
|---|---|
| Mover el valor | Arrastrar la bolita de la barra |
| Elegir un número exacto | Escribirlo en la casilla (si se pasa del máximo, se corrige) |
| Ajustar de a uno | Tocar **−** o **+** (desde «sin puntuar», **+** empieza en 1 y **−** en 0) |
| Dejarlo sin puntuar | Borrar el número. **«Sin puntuar» no vale 0**: el criterio queda fuera del cálculo |

**Ejemplo.** Perfil de Fotografía: Composición 30, Dominio técnico 25, Diseño 20, Planificación 15, Revisión 10 (suman 100). Si se dan 24, 17, 14, 9 y 6, el **técnico es 70**.

### 15.4 Escala fijada por el servidor

La escala de una evaluación la fija el servidor **en el primer guardado** y no cambia. Las evaluaciones guardadas **antes** de la puntuación por peso siguen en **1 a 5** (barra de cinco paradas) y se convierten a la misma nota sobre 100 **sin reescribirse**. El perfil de una evaluación también lo fija el servidor.

### 15.5 Validación al publicar

El disparador `evaluaciones_validar_modelo` valida: modelo, escala, perfil fijado, completitud de obligatorios, y, con segundo rol, que los puntajes del segundo rol que se guarden estén completos (según la cabecera de la migración 0062, la validación exige completar los puntajes del rol 2). Si la persona tiene segundo rol pero aún no se le puntúa, el resultado usa solo el rol principal y se marca «evaluación incompleta» cuando hay tareas de ese rol. Un criterio sin puntuar **no se exige** si es opcional; la validación de completitud aplica a evaluaciones por roles (la clásica nunca la tuvo).

### 15.6 Qué pasa al publicar

- La evaluación pasa a **publicada** y empieza a **contar**: aparece en el perfil de la persona, el desempeño, el ranking, los reportes y el seguimiento.
- Se genera el aviso **`calificacion_nueva`** (esencial) a la persona evaluada.
- Se deja una fila en el **historial de versiones** (`evaluaciones_versiones`).
- Una evaluación **publicada ya no se modifica ni se borra por UPDATE/DELETE directo** (proceso 16).

### 15.7 Reglas especiales

- **Rol «pequeño»**: si un rol tiene **menos de 4 personas evaluadas**, el percentil se reemplaza por el técnico y las pantallas lo dicen («rol pequeño», `.v2-nota--regla`): sin esa explicación parecería favoritismo.
- **Cobertura** (0056): `evaluacion_cobertura()` dice cuántos criterios de escala se puntuaron **de los que aplicaban** (núcleo y técnicos, y el peso técnico puntuado). Se muestra como una nota en «Cómo se compone tu evaluación» **solo si falta algún criterio**.
- **Rúbrica clásica** (períodos antiguos): 7 criterios de 0 a 4 + bono (0–2), también con barra; suma = total sobre 30.
- Una persona **sin rol** no se puede evaluar en rúbrica por roles; tampoco si **su rol no tiene perfil**.

## Proceso 16 · Rectificar o retirar una evaluación publicada

**Objetivo.** Corregir un error **sin perder rastro**.

**Actor.** Administración. **Pantalla.** Evaluar → persona publicada → **Historial de versiones** y el botón de corrección.

### Actividades

1. En Evaluar, una evaluación **publicada** muestra **«versión N»**.
2. Para **corregirla** se edita y se guarda: el portal pide un **motivo** (mínimo 5 caracteres) y llama a `rectificar_evaluacion(id, puntajes, comentarios, motivo, respuestas, bono, puntajes del rol 2)`. Para **retirarla a borrador**, `retirar_evaluacion(id, motivo)`.
3. Cada una **sube la versión** y guarda en `evaluaciones_versiones` (append-only, sin permisos de cliente): **antes y después**, el **resultado calculado antes y después**, el motivo y quién lo hizo.
4. **Historial de versiones** (solo administración): por versión, quién, cuándo, motivo, **los criterios que cambiaron con su nombre completo** y el resultado antes/después.
5. La persona evaluada recibe el aviso **`calificacion_cambiada`** (esencial).

### Reglas

- **Nunca** se llama al guardado directo de una evaluación que pueda estar publicada: el portal enruta por `API.guardarEvaluacion()`.
- Ambas funciones exigen **administración**, **gestión no archivada** y **motivo ≥ 5**.
- Sin sesión (SQL Editor) el cambio pasa pero se registra como «Sin sesión (mantenimiento)»; el borrado en cascada de una persona sigue funcionando.
- El estado sigue siendo solo `borrador` / `publicado`; la versión es un **número**, no un estado.
- Detalle de producción: la migración 0059 corrigió que `evaluaciones.id` es **UUID** (no BIGINT): sin ella publicar fallaba con un error técnico.

## Proceso 17 · Evaluación de distrito (y las estadísticas que la alimentan)

**Objetivo.** Evaluar a cada distrito como unidad y mantener un **ranking acumulado**.

**Actores.** Administración evalúa; la secretaría de cada distrito sube sus estadísticas de Instagram.

**Pantallas.** Admin → **Distritos** (panel por distrito) · Secretaría → **Distrito → Estadísticas**.

### 17.1 Estadísticas de Instagram (0043 y 0054)

La secretaría sube, **por período**, las cifras de la cuenta de su distrito **con una captura de pantalla como prueba**.

| Campo | Tipo |
|---|---|
| Visualizaciones | entero |
| Cuentas alcanzadas | entero |
| Visitas al perfil | entero |
| Seguidores (neto) | puede ser negativo (ganados menos perdidos) |
| Publicaciones % · Historias % · Reels % | porcentaje |

1. **Distrito → Estadísticas** → elegir el período → llenar las cifras → **adjuntar la captura** (obligatoria).
2. El navegador **reduce la imagen** (sin recortar, lado largo 1280 px, WebP→JPEG, calidad hasta ≤ 250 KB; el bucket admite hasta 600 KB). Se guarda en el bucket **privado** `capturas-distrito` (ruta `<distrito>/<período>/captura-<fecha>.<ext>`) y se ve con **URL firmada de corta vida**.
3. La fila registra quién la subió y cuándo (los fija un disparador, nunca el cliente).
4. **Cualquier secretaría del distrito** puede corregir la fila compartida; la administración lee y corrige todo; **solo la administración borra**; los miembros no ven nada. En una gestión archivada nadie escribe.
5. **Historial** (0054): cada corrección que cambia algo, o el borrado, guarda la **fila anterior** (cifras, captura, quién y cuándo) en `estadisticas_distrito_hist`. **El portal ya no borra la captura anterior** al reemplazarla: es la prueba del valor anterior. (Todavía no hay pantalla para ver ese historial; la lectura existe en `API.getHistorialEstadisticasDistrito`.)
6. **Pendiente de decisión de negocio**: estados «validada/cerrada» de las estadísticas y quién las cierra.

### 17.2 Evaluar un distrito

1. Admin → **Distritos** → elegir un distrito → pestaña **Evaluación** (el formulario «Evaluar un distrito»).
2. Se ven la entrega de estadísticas de la secretaría, su captura, y se **pre-llenan** las cifras de Instagram (`ig_stats`) si la evaluación no tiene las suyas; la administración puede editarlas.
3. Se puntúan **4 competencias de 0 a 7 cada una** (**total sobre 28**): **CGO** Gestión y Organización · **CCT** Creativa y Técnica · **COM** Comunicativa · **CEE** Ejecución Estratégica. Se guarda como **borrador** y se **publica**.
4. Niveles de distrito: **87 / 67 / 37 % de 28** (mismos porcentajes que la rúbrica por roles; antes eran 24/17/10 de 28 y se unificaron por decisión del dueño).

### 17.3 Ranking acumulado

`Distritos.consolidar()`: **solo evaluaciones publicadas**; **promedio = total ÷ PE evaluados**; **los empates comparten posición** (1, 1, 3…); un PE sin publicadas **no cuenta** y se dice así. Se ve una columna por PE, el total, el promedio sobre 28 y el porcentaje, con filtros de pendientes (sin evaluar / borrador / sin estadísticas) y la elección de qué PE incluir, más CSV.

**Visibilidad**: la secretaría ve su posición y su evolución; los demás distritos permanecen **sin detalle** en su pantalla. Nota: la **base** permite a todo usuario autenticado leer evaluaciones de distrito publicadas (política `eval_dist_read`); la reserva la hace la pantalla. Es una **decisión de negocio pendiente** (¿el ranking es público para todo el equipo?).
