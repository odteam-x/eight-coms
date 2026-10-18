# Auditoría: equipos por PE, tareas colectivas y notas de tareas en la evaluación

Sesión A · migraciones 0031–0036 · octubre 2026. Todo lo de abajo está comprobado leyendo el código y ejecutando las
pruebas de `tools/pruebas` (PGlite con RLS real); no hubo acceso a la base de producción.

## 1. Qué había antes (mapa)

| Pieza | Estado antes |
|---|---|
| PE ↔ personas | `periodos_evaluacion` + `periodo_participantes` (activo/inactivo). No había grupos de trabajo. |
| Tareas | `tareas` (0016): **una fila por persona** (`asignada_a NOT NULL`). Sin noción de equipo ni de tarea compartida. |
| Nota de una tarea | `tareas.puntos` 0–10, obligatorio al aprobar (0017). |
| Evaluación individual | `evaluaciones` (la escribe quien evalúa) → `resultados_periodo()` (0015/0023): núcleo, técnico, individual, percentil, general. |
| Evidencia de tareas | `resumen_tareas_periodo()`: hechos (a tiempo, devoluciones…) **sin puntos**. |
| Quién lee resultados | perfil, panel, reportes, ranking y `seguimiento_global()` (0025) → todos de `resultados_periodo()`. |

## 2. Hallazgos

| # | Hallazgo | Causa raíz | Archivos | Solución |
|---|---|---|---|---|
| H1 | **Las notas de las tareas no llegan a la evaluación individual.** | Por diseño: la cabecera de 0017 dice «no entra solo en ninguna fórmula de `resultados_periodo()`» y `core/tareas.js` lo repetía en el modal. Los puntos se guardaban y ninguna función, vista ni pantalla los leía: el dato existía desconectado. `resumen_tareas_periodo()` ni siquiera los devolvía. | `0017_tareas_puntos.sql`, `0015/0023` (`resultados_periodo`), `core/tareas.js`, `core/perfil.js` | `0034` define la nota de tareas (promedio ponderado, reglas por PE); `0035` la integra **dentro de `resultados_periodo()`** (de ahí leen todas las pantallas). Prueba que falla antes y pasa después: `sql-0035.mjs` («una tarea aprobada con 8 puntos llega a la evaluación»). |
| H2 | No existía una política de integración (qué cuenta, cuánto pesa, pendientes/vencidas/anuladas). | Nunca se definió. | — | `periodo_calif_config` (0033): peso de las tareas, multiplicadores individual/colectiva, mínimo de tareas, iniciativas propias, vencidas como 0. Editable solo por administración, con historial y motivo. |
| H3 | No había equipos ni tareas colectivas; la única forma de «tarea para varios» era N copias independientes. | Modelo `tareas` con un solo `asignada_a`. | `0016` | `equipos` (0031) y `tareas_equipo` (0032): **una** fila compartida + `tarea_equipo_participantes` + aportes por persona. |
| H4 | Una nota no se podía corregir ni anular con trazabilidad; las tareas no se podían anular. | `0017` dejaba al admin cambiar `puntos` por UPDATE directo, sin motivo ni historial. | `0017` | 0033: historial append-only (`calificaciones_historial`), `corregir/anular/restaurar_nota_tarea()` con justificación, estado `anulada`, peso y `puntos_original`. El UPDATE directo de puntos ya no corrige. |
| H5 | Posible contradicción entre pantallas (cada una con sus conteos). | `seguimiento_global`, `reporte_actividades` y `resumen_tareas_periodo` contaban anuladas/notas inválidas por su cuenta. | `0025`, `0016` | 0035 los recrea con las mismas definiciones y añade columnas de tareas a `seguimiento_global`. |
| H6 | **Bug de despliegue encontrado por la regresión:** un `UPDATE` de relleno sobre `tareas` en el SQL Editor falla porque los triggers exigen `auth.uid()`. | Sin sesión en el SQL Editor. | `0033` | El relleno apaga los triggers de usuario un instante, dentro de la transacción (patrón ya usado en 0024). Cubierto por `sql-0025.mjs --con-equipos` (aplica 0031–0035 sobre datos existentes). |
| H7 | **Los tests se saltaban los `REVOKE`.** | Las bases de prueba daban `GRANT` global al final, tapando los permisos de funciones/tablas internas. | `tools/pruebas` | `base-eq.mjs` imita a Supabase (permisos por defecto al crear + cada migración revoca): ahora una función interna llamable por el cliente haría fallar la prueba. |

Descartado tras verificar: no hay caché ni tabla de totales que quedara desactualizada (todo se calcula al consultar);
no había relaciones mal unidas (los puntos están en la fila correcta); los estados no filtraban tareas aprobadas.

## 3. Qué se amplió y qué se corrigió estructuralmente

- **Corrección estructural:** H1 (integración), H4 (trazabilidad de notas).
- **Ampliación sobre lo existente:** equipos, tareas colectivas, reglas por PE, vistas, desglose en el perfil.
- **No se tocó:** períodos clásicos (legacy) y sus datos; `trabajos_entregados`; las políticas de las tablas ya
  existentes más allá de lo indicado; notificaciones.

## 4. Decisiones de negocio pendientes (valores provisionales, configurables)

1. **Peso de las tareas en el resultado.** PE ya existentes → 0 % (los resultados publicados no cambian). PE nuevos → 20 %
   *provisional*, marcado «sin confirmar» en pantalla hasta que la administración lo guarde. Decisión del comité.
2. **Ponderaciones.** Todas valen 1 (tarea individual y colectiva, tarea contra tarea) hasta que se configuren; el peso de
   cada tarea lo da quien la aprueba (1, 2, 3 o 5) y los multiplicadores por tipo se fijan en las reglas del PE.
3. **Vencidas como 0:** apagado (no se inventa un 0). Es una regla institucional que la administración puede encender.
4. **Mínimo de tareas calificadas:** 1. Con menos, no hay nota de tareas y el resultado es solo la evaluación.
5. **Quién asigna tareas a un equipo:** administración; la secretaría solo en equipos con su distrito como ámbito (los
   transversales son de la administración). Los miembros nunca administran equipos.
6. **Quién cuenta en una tarea colectiva:** quien participaba al aprobarse o dejó un aporte aunque saliera antes.
7. **Zona horaria** de «a tiempo/vencida»: la de la gestión (`config.zona_horaria`, por defecto America/Santiago): confirmar.
8. El sistema **no guarda archivos** de tareas: la evidencia es un enlace http(s) y/o una nota.
