# 08 · Leer los resultados (proceso 18)

Una vez publicadas las evaluaciones y aprobadas las tareas, el sistema ofrece **seis lecturas** distintas. Todas leen los mismos datos; lo que cambia es **la pregunta que responden**. Este capítulo fija esa pregunta para cada una, porque es la forma de que no se dupliquen.

| Lectura | Pregunta que responde | Quién |
|---|---|---|
| **Inicio** | ¿Qué necesito hacer ahora? | Miembro, secretaría |
| **Mi perfil** | ¿Cómo me va a mí? | Cada persona (y quien la supervisa) |
| **Panel** (administración) | ¿Qué requiere atención y cómo va el período? | Administración |
| **Seguimiento** | ¿**Quién está al día**? (estado de evaluaciones, entregas y vencidas) | Administración, secretaría (su distrito) |
| **Desempeño** | ¿**Cómo les va**? (resultados, evolución, comparaciones) | Administración, secretaría (su distrito), cada persona (propio) |
| **Reportes** | ¿Qué cifras llevo a una reunión o a un papel? (con exportación) | Administración, secretaría (su distrito) |
| **Distritos** | ¿Cómo va cada distrito? (ranking y evaluación) | Administración; secretaría (lo suyo) |

Fuente común: `seguimiento_global()` y `resultados_periodo()`.

## 8.1 Inicio (miembro y secretaría)

**Pantalla.** `Inicio` (`core/inicio.js`). Responde «qué necesito hacer ahora».

- **Saludo y cuenta regresiva**: «Hola, Ana», el período en curso y una tarjeta con **los días que faltan** para la próxima fecha (por ejemplo «10 días para entrega de scores · PE2 · 25 nov»).
- **Primeros pasos / Novedades**: tarjeta con el avance del asistente de bienvenida y botón **Continuar**.
- **Tu evaluación**: anillo con la nota (0–100), el **nivel** (por ejemplo «Bueno»), «Individual sobre 100» y el **percentil en tu rol**; botón **Ver mi perfil**. Si no hay evaluación publicada, dice **cuándo se publicará**.
- **Para atender**: tus tareas abiertas (las devueltas primero, después por fecha límite) con **Ir a Entregas**. Si no hay, lo dice.
- **Próximas fechas**: las siguientes fechas del período y **Ver línea de tiempo**.
- **En un período clásico** dice que las tareas no aplican y apunta a Entregas.
- **Secretaría**: añade un bloque **«Tu distrito»** y la **bandeja de trabajo del distrito**: una fila por persona con lo que ella puede resolver hoy (tareas **vencidas** = abiertas con fecha anterior a hoy, la bloqueada no cuenta; y **entregas por revisar**), ordenada por días de atraso y después por tiempo de espera; cada fila abre el perfil.

## 8.2 Mi perfil (todas las personas)

**Pantalla.** `Mi perfil` (`core/perfil.js`), en tres modos: **propio**, **supervisión** (secretaría mirando a su gente) y **admin**. La base decide qué recibe cada uno; el módulo **no calcula ninguna nota**.

**Cabecera**: foto, nombre, rol (y segundo rol), **versión del perfil de evaluación**, distrito y el **anillo con la nota** y su cambio frente al período anterior. **Mi gafete** aparece en el perfil propio; la administración ve «Gafete» en cualquier perfil.

**Cinco pestañas internas**:

| Pestaña | Qué muestra |
|---|---|
| **Resumen** | Lectura rápida (puntos más altos y dónde hay más margen), tu lugar en el rol, **«Cómo se compone tu evaluación»** (pieza por pieza: núcleo, técnico, tareas, y qué tarea cuenta, cuánto aporta y por qué una no cuenta), nota de cobertura si falta algún criterio |
| **Criterios** | Cada criterio con **«¿Cómo se puntúa?»** (anclas), tu puntuación y los comentarios |
| **Tareas** | Tareas del período (para quien supervisa: lista completa de revisión) |
| **Períodos** | **Una tarjeta por PE**: tu participación, el estado de tu evaluación y los hechos de tus tareas, y tu equipo si lo hay |
| **Desempeño** | Evolución, tabla por período y comparar dos períodos propios (reemplaza a *Evolución* en el perfil propio; los perfiles de otras personas conservan *Evolución*) |

**Reglas de lectura**: un período **clásico** se muestra en su escala (22/30, nivel por 26/20/11, bono, 7 criterios de 1–4) y **nunca se mezcla** con por roles en un gráfico ni en «cambio frente al período anterior»; su pestaña Tareas dice que el período no usa tareas. Un PE en el que no participaste no aparece.

## 8.3 Panel (administración)

**Pantalla.** `Panel` (`admin-panel.js`). Es la pantalla de inicio de la administración y **le gusta al dueño tal como está**.

- **Requiere atención** (arriba): accesos por aprobar, personas sin evaluar, borradores sin publicar, entregas por revisar y tareas vencidas, cada uno con un enlace a donde se resuelve (por ejemplo «Evaluar», «Publicar», «Revisar»). **Solo hechos; nunca puntúa.**
- **Datos por revisar**: contradicciones entre datos guardados (capítulo 04).
- **Cuatro KPIs**: *Evaluaciones publicadas* (7/9, 78 % del equipo), *Promedio del equipo* (con variación frente al período anterior), *Mejor resultado*, *Entregas a tiempo*.
- **Progreso y nivel**, y un acordeón **«Análisis del período»**: *Distribución por nivel* (histograma), *¿Estamos mejorando?* (tendencia entre períodos), *Comparación* (por rol o distrito, para calibrar), *Competencias comunes* (radar), *Mapa de calor* (persona × competencia) y *Los mejores resultados*. Cada gráfico responde una pregunta y lleva una **descripción en texto con las mismas cifras** para lectores de pantalla.
- Normaliza **ambos modelos a 0–100 solo para dibujar**; el puntaje oficial sale de la base o de la fórmula clásica.
- La tarjeta **Primeros pasos** de la bienvenida aparece aquí también.

## 8.4 Seguimiento — «¿Quién está al día?»

**Pantalla.** `Seguimiento` (`core/seguimiento.js`). Administración (todo) y secretaría (su distrito); el miembro ve su fila dentro de Mi perfil → Períodos.

- **Todas las personas × todos los períodos de la gestión, agrupadas por rol**: en cada período, el **estado de su evaluación** (Publicada, Borrador, Sin publicar), su resultado y los **hechos de sus tareas**.
- **Tres indicadores arriba**, cada uno con su numerador y denominador en pantalla:
  - *Evaluaciones publicadas* = personas con evaluación **publicada** ÷ personas que **participan**, en los períodos ya en juego.
  - *Entregas a tiempo* = tareas asignadas entregadas **dentro del plazo** ÷ tareas asignadas entregadas **con plazo** (se mide sobre la **primera** entrega).
  - *Tareas vencidas* = tareas asignadas, nunca entregadas, con plazo ya pasado (no cuenta lo bloqueado).
- Búsqueda, filtros y tablas que **pasan a tarjetas bajo 768 px**.
- Los **borradores solo los ve la administración**; los demás los ven como «Sin publicar» **sin puntaje**.
- Se muestra el **segundo rol** (0062) cuando lo hay.
- **No calcula resultados**: el de por roles viene de `resultados_periodo()`; el de la clásica, la suma de sus puntajes más el bono.

## 8.5 Desempeño — «¿Cómo les va?»

**Pantalla.** `Desempeño` (`core/desempeno.js`). Administración (todo el equipo), secretaría («Desempeño del distrito», reutiliza el mismo módulo con los datos de su distrito) y cada persona (**dentro de su perfil**, solo la propia trayectoria).

**Administración** — dos grandes bloques:

1. **Desempeño del equipo por período**: KPIs (promedio del equipo con variación, evaluadas ÷ participan, quién sube y baja, entregas a tiempo), **evolución del equipo** (promedio, mínimo y máximo por período) y **promedio por rol** (calibración: ¿un rol sale sistemáticamente más alto?).
2. **Comparar**: **dos períodos persona por persona** (quién subió y quién bajó) y **hasta 5 personas a la vez** a lo largo de los períodos (series distinguidas por color, trazo y punto).
3. **Cada persona**: tarjetas de resultado por persona (cada una abre su detalle frente al promedio del equipo y cada nombre abre su perfil).

Filtros: **rúbrica, métrica, rol, distrito, períodos incluidos y búsqueda**. Muestra el **segundo rol** cuando existe.

**Reglas**: solo evaluaciones **publicadas** (dice cuántas quedan fuera); rúbrica por roles y clásica **nunca se mezclan** (un selector las separa); la variación es la resta entre dos valores ya calculados.

**Diferencia con Seguimiento**: Seguimiento es **operativo** (estado y cumplimiento, presente); Desempeño es **analítico** (resultados y su evolución). La tabla «Todas las personas × períodos» **vive solo en Seguimiento**; Desempeño apunta a ella.

## 8.6 Reportes

**Pantalla.** `Reportes` (`admin-reportes.js`; secretaría: su pestaña Reportes). Dos modos en administración:

### «Todos los PE» (por defecto) — Reporte general

`reporte_general_pe(gestion, distrito, rol)` y `ReporteGeneral` (`core/reporte-general.js`). Una fila por PE de la gestión que la persona puede ver.

- **Una sola fuente**: personas, participación, evaluaciones y resultados salen de `seguimiento_global()`; solo lo que éste no desglosa (tareas por estado y origen, anuladas, colectivas, equipos, actividades) se **cuenta** sobre `tareas`, `tareas_equipo` y `equipos`.
- **Qué es total, promedio o porcentaje**: TOTAL = suma de conteos; PORCENTAJE = Σ numerador ÷ Σ denominador; PROMEDIO = Σ de resultados ÷ Σ de cantidades (ponderado). **Personas** no se suman entre PE; **actividades** y **equipos integrantes** tampoco (una persona puede estar en dos PE). Un PE clásico muestra «no aplica» en tareas (no 0). «Sin datos» = ni evaluación, ni tareas, ni equipos.
- **Tareas**: unidad = individuales + colectivas; **una colectiva es UNA**; las anuladas no entran en ninguna cifra (se informan aparte); abiertas + en revisión + aprobadas = total.
- **Trazabilidad**: cada fila se abre con el desglose de tareas, equipos, la regla del PE, la distribución por distrito/rol y la lista de personas que componen las cifras.
- **Filtros** de distrito y rol (recalculados **en la base**: un PE sin personas en el filtro no desaparece, sale en 0); estado, rúbrica, «con vencidas / por publicar / sin datos», búsqueda y orden son del front.
- **CSV** con numerador y denominador en columnas separadas, fila TOTAL, alcance, filtros y hora de los datos, y celdas de texto neutralizadas contra fórmulas (`=`, `@`…).

### «Un PE en detalle» — constructor

Un constructor (**período · alcance: equipo, distrito, rol o persona · secciones**) con una **hoja imprimible** (`.rpt-hoja`; PDF imprimiendo con el tema claro forzado), exportación **CSV** y soporte para ambas rúbricas. Secciones: **Entre períodos** y **Por actividad** (`ReporteEquipo`: publicadas ÷ participan; a tiempo ÷ entregadas con plazo; entregadas ÷ asignadas; aprobadas ÷ entregadas).

### Lo que **no** existe en los reportes

Seguimiento de asistencia o participación más fino que «participa sí/no», tendencia de cumplimiento por fecha (solo el estado actual) y «miembros activos» más allá de `profiles.aprobado` y `periodo_participantes.activo`.

## 8.7 Distritos (lectura)

- **Administración → Distritos**: ranking **acumulado** (una columna por PE, total, promedio sobre 28, porcentaje), promedio por período y global, filtros de pendientes, chips para elegir los PE incluidos, CSV, y un **panel por distrito** con cuatro pestañas: **Resumen · Evaluación · Estadísticas · Personas**.
- **Secretaría → Distrito**: pestañas **Resumen · Personas · Estadísticas · Ranking de distritos**. *Resumen* muestra su posición («#5 de 10 distritos»), el promedio sobre 28 y el porcentaje, su nivel, los períodos evaluados, un bloque **«Qué falta»** (por ejemplo «Falta enviar las estadísticas de Instagram de PE2») y su evolución. *Personas* son las tarjetas del distrito (con «N por revisar» y «N vencidas»); **solo ve a su distrito** (no es un filtro del portal: la base no entrega más).
- Cálculo y reglas: capítulo 06, 17.3.

## 8.8 Cómo se ve lo mismo según quién mira

| Dato | Miembro | Secretaría | Administración |
|---|---|---|---|
| Su evaluación | Solo publicada | Solo publicada | Publicada y borrador |
| Evaluación de otra persona | — | Publicada, de su distrito | Todas |
| Tareas de otra persona | — | De su distrito | Todas |
| Equipos | Los suyos | Los de su distrito | Todos |
| Ranking de distritos | — | Su posición; otros sin detalle | Todo |
| Reportes y CSV | — | De su distrito | Todo |
