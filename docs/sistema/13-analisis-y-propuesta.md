# 13 · Análisis y propuesta de ubicación

Este capítulo responde a lo que el dueño del proyecto observa: **hay cosas donde no deben estar y funciones que deberían ser principales y se pierden**. Se apoya en los procesos descritos en los capítulos 03 a 10 y en cómo están hoy las pantallas (capítulo 11).

> **Importante.** Es un **análisis y una propuesta**, no cambios aplicados. Es mi criterio sobre lo que está en el repositorio; cada cambio se decide con el dueño. Se indica el esfuerzo estimado y qué **no** conviene tocar.

## 13.1 Criterios con los que se juzga cada pantalla

1. **Un proceso tiene una casa**: la pantalla donde se hace debe ser fácil de encontrar para quien lo hace y estar **cerca de lo que le precede y le sigue**.
2. **Una pregunta, una pantalla**: dos pantallas no deben responder la misma pregunta.
3. **Lo frecuente arriba, lo raro abajo**: el menú sigue el orden de uso, no el orden en que se programó.
4. **Lo crítico no se esconde**: publicar, revisar entregas, aprobar accesos y cerrar un período son los momentos donde un error cuesta más.
5. **El nombre dice lo que se hace** para quien entra por primera vez.

## 13.2 Lo que está bien y no se toca

| Elemento | Por qué conservarlo |
|---|---|
| **Panel de administración** (Requiere atención, KPIs, análisis) | Lo prefiere el dueño tal como está; «Requiere atención» ya lleva directo a donde se resuelve cada pendiente |
| **Inicio del miembro** («¿qué necesito hacer ahora?») | Responde una sola pregunta con lo justo |
| **Seguimiento vs Desempeño** (ya separados) | Cada uno responde una pregunta distinta |
| **Evaluar** (lista + formulario con evidencia al lado, modo enfoque) | Es el corazón; el modo enfoque ya le dio espacio |
| **Asistente de «Nueva tarea» en tres pasos** | Reúne en un solo flujo las validaciones que evitan errores |
| **Calidad de la base** (cálculo único, historiales, auditoría) | No hay nada que duplicar |

## 13.3 Hallazgos: dónde está algo que no debería, o escondido

Convención: **Esfuerzo** S = horas, M = un par de días, L = una semana o más. **Impacto**: cuánto ayuda a que el proceso se cumpla bien.

### A. Funciones principales que se pierden

| ID | Hallazgo | Evidencia | Impacto | Propuesta | Esfuerzo |
|---|---|---|---|---|---|
| A1 | **No existe un «cierre de período»**. El momento más delicado (revisar todo, evaluar a todos, publicar, confirmar las reglas) no tiene una pantalla propia; está repartido entre Panel, Tareas (reglas), Evaluar (borradores) y Distritos (estadísticas) | El Panel muestra pendientes sueltos; el peso de tareas «sin confirmar» (20 %) no se avisa en ninguna parte visible | **Alto** | Una **lista de cierre** del período (en Panel o en Períodos): fechas completas · reglas de tareas **confirmadas** · tareas por revisar = 0 · todas las personas evaluadas y publicadas · estadísticas de cada distrito enviadas · distritos evaluados. Cada línea con su enlace. Es solo lectura: reutiliza datos que ya existen | M |
| A2 | **«Mi desempeño» del miembro se esconde dentro de Mi perfil → Desempeño** (antes tenía entrada de menú) | `core/perfil.js` (`TAB_DESEMPENO`); el menú del miembro no lo muestra | Medio | Un enlace **«Ver mi desempeño»** en la tarjeta «Tu evaluación» de Inicio que abra esa pestaña | S |
| A3 | **El gafete es difícil de encontrar**: está dentro del perfil (propio) y en Personas → Gestión (administración) | Botón «Mi gafete» en el perfil | Medio | Fila «Mi gafete» en **Mi cuenta → Perfil**, y un acceso en Inicio. Para la administración: acción «Gafete» también desde la tarjeta de persona | S |
| A4 | **Ayuda y manual, bienvenida y novedades** están en Mi cuenta → pestaña **«App»**, un nombre que no los anuncia | `core/cuenta.js` | Medio | Renombrar la pestaña **«App y ayuda»** y/o añadir «Ayuda» al menú (ya está en el pie del rail) | S |
| A5 | **Reglas de calificación de tareas** (peso 20 %, mínimo, sin tareas pierde puntos) son **configuración del período**, pero viven en la pantalla Tareas | Panel de reglas bajo el selector de PE en Tareas | Medio | Dejarlas donde están (se usan al revisar) **y** mostrar un resumen con enlace en la tarjeta de cada PE de **Períodos**, y el aviso «sin confirmar» en el Panel | S |
| A6 | **Historial de versiones, Mover plazo, Anular nota, Corregir nota** son funciones críticas dentro de diálogos poco visibles | `Tareas.abrirModal`, Evaluar | Bajo/Medio | Documentarlas en el manual de administración; ya hay rastro en Auditoría. No cambia la pantalla | S |

### B. Redundancias (dos lugares para lo mismo)

| ID | Hallazgo | Evidencia | Propuesta | Esfuerzo |
|---|---|---|---|---|
| B1 | **Tareas individuales y de equipo se asignan en dos pantallas distintas** (Tareas y Equipos → detalle). La secretaría ve ambas dentro de Tareas; la administración no | `abrirTareas` vs `abrirEquipos` | En **Tareas**, un selector **Individuales / De equipo** y que **+ Nueva tarea** pregunte primero «¿para personas o para un equipo?». Equipos queda para armar equipos | M–L |
| B2 | **Actividades vive en Configuración**, pero es operación diaria (crear una actividad); el **Calendario** también la crea desde un día | Menú: Configuración → Actividades; Operaciones → Calendario | Mover la **lista y creación de actividades al Calendario** (pestaña «Lista»). Dejar en Configuración solo los **tipos (etiquetas)** | M |
| B3 | **Mi perfil → Tareas** repite lo de **Entregas** para la propia persona | `core/perfil.js` pestaña Tareas; `core/tareas.js` | En el perfil **propio**, reemplazar la pestaña por un resumen con enlace a Entregas (la lista completa de revisión se mantiene para quien supervisa a otra persona) | S |
| B4 | **El Panel y el Seguimiento repiten indicadores** (evaluaciones publicadas, entregas a tiempo) | `admin-panel.js` y `core/seguimiento.js` | Mantener el Panel (decisión del dueño); añadir el texto «ver detalle en Seguimiento» a cada KPI. Los gráficos analíticos del acordeón apuntan a Desempeño | S |
| B5 | **La evaluación se prepara en tres sitios**: **Roles y perfiles** (pesos), **Rúbrica** (definiciones) y **Personas → Gestión** (rol de cada persona) | Menú | Una **lista de verificación «Preparar la evaluación»** en Configuración: cada rol tiene perfil vigente · cada persona aprobada tiene rol · reglas confirmadas · fechas completas, con enlaces. No mueve pantallas | M |
| B6 | **Preferencias de aviso** se editan en dos lugares (panel de avisos y Mi cuenta) | `core/notificaciones.js`, `core/cuenta.js` | Mantener los dos accesos; es práctica, no un error. Que el aviso opcional diga «Puedes apagarlo en Preferencias» | S |

### C. Nombres que no dicen lo que hacen

| ID | Hallazgo | Propuesta |
|---|---|---|
| C1 | **«Entregas»** (miembro y secretaría) en realidad es **«mis tareas»**. La secretaría además tiene **«Tareas»** (las de su distrito): suena a lo mismo | Renombrar la propia a **«Mis tareas»** (mantener «Entregas» solo como filtro) |
| C2 | **«Banco»** no explica qué es | Usar el nombre completo **«Banco de imágenes»** en menú y celular |
| C3 | **«Personas»** (administración) mezcla *personas* con *accesos* | «Personas y accesos» (como ya dice Configuración) |
| C4 | **«App»** en Mi cuenta (ver A4) | «App y ayuda» |
| C5 | **«Panel»** vs **«Centro de control»** (grupo) | Está bien; mantener |

### D. Orden del menú de administración

Hoy: **Centro de control** (Panel, Desempeño, Seguimiento) → **Operaciones** (Evaluar, Tareas, Equipos, Calendario, Banco) → **Organización** (Personas, Distritos) → Reportes → Auditoría → Configuración.

El **orden por pregunta** es correcto. Lo que cambia con el tiempo es **qué se usa cuando**:

| Momento del período | Lo que más usa la administración | ¿Está a mano? |
|---|---|---|
| Antes | Períodos, Personas, Roles y perfiles, Equipos | Períodos y Roles están **detrás de Configuración** (plegado) |
| Durante | Tareas (revisar), Calendario, Panel | Sí |
| Cierre | Evaluar, Distritos, Panel | Sí, pero no hay lista de cierre (A1) |
| Después | Desempeño, Reportes | Sí |

**Propuesta**: no reordenar el menú; **resolver con la lista de cierre (A1) y la lista «Preparar la evaluación» (B5)**, que son pantallas de **proceso**, no de dato.

### E. Procesos que **no existen** y se echan en falta

| ID | Proceso ausente | Qué haría | Esfuerzo |
|---|---|---|---|
| E1 | **Cierre de período** guiado (A1) | Lista + acción final que bloquea cambios | M |
| E2 | **«Solicito tu ayuda»** | Pedido de ayuda entre personas (se mencionó en la especificación de sincronización; **no existe en el repositorio**) | L (necesita definir quién ayuda a quién) |
| E3 | **Penalización o etiqueta de entrega tardía** | Hoy se mide «a tiempo» pero no hay regla configurable | M (decisión de negocio primero) |
| E4 | **Estados «validada/cerrada» de las estadísticas de Instagram** y **pantalla del historial** de correcciones | Ya hay datos (0054); falta la pantalla y la decisión de quién cierra | M |
| E5 | **Reenvío del correo de confirmación** / alta guiada por la administración | Hoy una persona con correo mal escrito debe registrarse de nuevo | S–M |
| E6 | **Alertas de puntuaciones atípicas** | Detectar notas fuera de patrón antes de publicar | M |
| E7 | **Tablas con paginación y acciones masivas** (por ejemplo, aprobar varios accesos) | Cuando el equipo crezca | M |
| E8 | **Seguimiento de participación/asistencia** más fino que «participa sí/no» | Los reportes lo dicen explícitamente | L |

(El dueño pidió que estas ideas se hagan **solo si las considero importantes**; mi lectura está en 13.5.)

## 13.4 La ruta propuesta: el sistema ordenado por proceso

Cada fila es un **momento** del ciclo, con **quién**, **dónde** y **qué debería ser evidente** (lo que hoy falla o está bien).

| Momento | Quién | Dónde hoy | Lo que debería ser evidente |
|---|---|---|---|
| 1. Pedir acceso | Persona nueva | Entrada | Que queda pendiente y qué sigue |
| 2. Aprobar y ubicar | Administración | Personas | Los accesos pendientes (Panel → Requiere atención) y el **rol y el distrito** de cada alta |
| 3. Preparar el período | Administración | Períodos · Roles y perfiles · Rúbrica | **Lista «Preparar la evaluación»** (B5) |
| 4. Organizar el trabajo | Admin / secretaría | Tareas · Equipos · Calendario | **Una** pantalla para asignar (B1) |
| 5. Hacer y entregar | Cada persona | Entregas («Mis tareas») | Qué tengo que hacer hoy (Inicio) |
| 6. Revisar y puntuar | Admin / secretaría | Tareas → Por revisar | El contador y la bandeja de la secretaría |
| 7. Confirmar las reglas | Administración | Tareas (reglas) | **Aviso «sin confirmar»** antes de evaluar (A5) |
| 8. Evaluar | Administración | Evaluar | La evidencia al lado, el modo enfoque |
| 9. Subir y evaluar distritos | Secretaría / admin | Distrito → Estadísticas · Distritos | Qué distritos faltan (A1) |
| 10. **Cerrar y publicar** | Administración | (repartido) | **Lista de cierre** (A1) |
| 11. Leer resultados | Todos | Inicio · Mi perfil · Desempeño · Seguimiento · Reportes | Cada pantalla con su pregunta |
| 12. Corregir | Administración | Evaluar → versiones | El motivo y el historial |
| 13. Abrir el año nuevo | Administración | Gestiones | Que el anterior queda archivado |

## 13.5 Mi priorización (qué haría y en qué orden)

| Prioridad | Cambio | Por qué |
|---|---|---|
| **1** | **A1 + B5: lista de cierre y lista «Preparar la evaluación»** | Son los dos momentos donde un olvido cuesta más (publicar con reglas sin confirmar, o con personas sin rol); reutilizan datos que ya existen y no mueven pantallas |
| **2** | **B1: una sola puerta para asignar tareas** | Es la mayor confusión funcional: individuales y de equipo en dos pantallas |
| **3** | **C1–C4: renombrar** («Mis tareas», «Banco de imágenes», «Personas y accesos», «App y ayuda») | Cuesta casi nada y reduce el «dónde está» |
| **4** | **A2, A3: enlaces** a Mi desempeño y Mi gafete desde Inicio / Mi cuenta | Rescatan funciones que hoy se pierden |
| **5** | **B2: Actividades dentro del Calendario** | Operación diaria en la pantalla de las fechas |
| **6** | **B3, B4, A5: enlaces y resúmenes** | Reducen redundancia sin quitar nada |
| **Después** | **E3, E4, E5** | Dependen de decisiones de negocio |
| **No por ahora** | **E7, E8, E6, E2** | Aún no hay volumen ni definición |

## 13.6 Cómo se mide que la reorganización funciona

- **Tiempo hasta la primera acción**: cuánto tarda un miembro en encontrar sus tareas, su evaluación y su gafete; cuánto tarda la administración en publicar un período.
- **Errores evitables**: publicaciones con reglas sin confirmar; personas evaluadas sin rol; tareas asignadas con «Excepción de rol» no intencionada.
- **Preguntas al equipo**: «¿dónde está X?» (las respuestas deberían bajar tras los renombrados y los enlaces).
