# Puntos de emisión de avisos (equipos, tareas colectivas, calificaciones)

Para la sesión de notificaciones (B). **Esta rama no emite ningún aviso**: deja hechos persistidos y fáciles de
enganchar. Los nombres de tipo son los del contrato de B (`docs/notificaciones-contrato.md`). Migraciones 0031–0036.

Convenciones: `actor` = `auth.uid()` de quien hizo la operación (no se le avisa a sí mismo). Todo trigger de B debería
ser `AFTER INSERT` sobre las tablas de eventos (append-only: una fila por hecho, con `id` estable que sirve de clave de
idempotencia). Los triggers de A que escriben esas filas son `SECURITY DEFINER`.

| Tipo | Dónde ocurre (tabla · operación) | Audiencia | Clave del hecho | Datos útiles |
|---|---|---|---|---|
| `equipo_incorporado` | `equipo_eventos` · INSERT con `tipo = 'miembro_alta'` (lo escribe `equipo_agregar_miembros()`) | la persona `persona_id` | `equipo_eventos.id` | `equipo_id` → `equipos.nombre`, `equipos.periodo_id`; `detalle.excepcion`; actor = administración |
| `equipo_retiro` | `equipo_eventos` · INSERT con `tipo = 'miembro_baja'` (`equipo_retirar_miembro()`) | la persona `persona_id` | `equipo_eventos.id` | `motivo` (motivo del retiro) |
| `tarea_colectiva_asignada` | `tarea_equipo_eventos` · INSERT con `tipo = 'creada'` (trigger AFTER INSERT de `tareas_equipo`) | integrantes vigentes: `tarea_equipo_participantes WHERE tarea_id = X AND hasta IS NULL` (ya insertados cuando se escribe el evento: sus triggers AFTER corren antes por orden alfabético) | `tareas_equipo.id` | `tareas_equipo.titulo/fecha_limite/prioridad/equipo_id`, `asignada_por` |
| `tarea_cambio` — responsable | `tarea_equipo_eventos` · `tipo = 'responsable'` (`persona_id` = nuevo seguimiento; `de`/`a` = ids) | participantes vigentes (+ el nuevo responsable) | `tarea_equipo_eventos.id` | |
| `tarea_cambio` — instrucciones | `tarea_equipo_eventos` · `tipo = 'instrucciones'` (cambió `instrucciones` o `criterios_evaluacion`) | participantes vigentes | `tarea_equipo_eventos.id` | contenido actual en `tareas_equipo` |
| `tarea_cambio` — fecha límite | `tarea_equipo_eventos` · `tipo = 'prorroga'` (`de`/`a` = fechas, `motivo`), solo por `tarea_equipo_prorrogar()` | participantes vigentes | `tarea_equipo_eventos.id` | para tareas individuales: `tarea_eventos` · `tipo = 'prorroga'` (0016) |
| `tarea_cambio` — contenido | `tarea_equipo_eventos` · `tipo = 'contenido'` (`motivo` = campos cambiados; incluye cambios de peso) | participantes vigentes | `tarea_equipo_eventos.id` | |
| `tarea_por_vencer` | **por tiempo** (no hay fila): `tareas_equipo` con `estado IN ('asignada','en_curso','devuelta')` y `fecha_limite = (hoy en zona_periodo(periodo_id)) + 1`; individuales: `tareas` igual | participantes vigentes / `asignada_a` | `(tarea_id, fecha_limite)` (una prórroga genera un aviso nuevo) | `public.zona_periodo(periodo_id)` da la zona de la gestión |
| `tarea_vencida` | por tiempo: mismas tablas con `fecha_limite < hoy`, `estado IN ('asignada','en_curso')` y `entregada_en IS NULL` (no cuenta `bloqueada`) | participantes vigentes + `responsable_id` | `(tarea_id, fecha_limite)` | igual que la definición de «vencida» en `resumen_tareas_periodo` |
| `entrega_registrada` | `tarea_equipo_eventos` · `tipo = 'estado'` con `a = 'entregada'` (actor = quien entregó; también está `tareas_equipo.entregada_por/entregada_en`) | quien revisa: administración + secretaría del distrito ámbito del equipo (`equipos.distrito = profiles.distrito` de una secretaria) + `tareas_equipo.responsable_id`; opcional: resto del equipo | `(tarea_id, tareas_equipo.rondas_revision)` (cada reentrega tras una devolución es un hecho nuevo) | `tareas_equipo.entrega_url/entrega_nota` |
| `correccion_solicitada` | `tarea_equipo_eventos` · `tipo = 'estado'` con `a = 'devuelta'` (`motivo` = observación) | participantes vigentes | `(tarea_id, rondas_revision)` | |
| `observacion_nueva` | `tarea_equipo_eventos` · `tipo = 'aporte'` con `a = 'comentario'` (`motivo` = primeros 200 caracteres; texto completo en `tarea_equipo_aportes.nota`); también `revision_nota` en una devolución | participantes vigentes (y quien revisa si lo escribió un integrante), menos el actor | `tarea_equipo_aportes.id` (el aporte; el evento no lo guarda: relacionar por `tarea_id` + `created_at`/`persona_id`) | |
| `estado_cambiado` | `tarea_equipo_eventos` · `tipo = 'estado'` (`de`, `a`, `motivo`); individuales: `tarea_eventos` · `tipo = 'estado'` | participantes vigentes + `responsable_id`; revisión: ver `entrega_registrada` | `tarea_equipo_eventos.id` | estados: `asignada, en_curso, bloqueada, entregada, devuelta, aprobada, anulada` |
| `calificacion_nueva` | `calificaciones_historial` · INSERT con `accion = 'calificada'` | `tarea_tipo = 'individual'` → `persona_id`; `'equipo'` (persona NULL) → participantes que contarán (`tarea_equipo_participantes` vigentes al aprobar, o con aportes) | `calificaciones_historial.id` | `puntos_nuevo`, `contexto` (peso de la tarea y reglas del PE) |
| `calificacion_cambiada` | `calificaciones_historial` · INSERT con `accion IN ('corregida','anulada','restaurada','reabierta','tarea_anulada','individual','individual_retirada')` | igual que arriba; si `persona_id` no es NULL en una tarea de equipo (`individual`/`individual_retirada`), **solo esa persona** | `calificaciones_historial.id` | `puntos_anterior → puntos_nuevo`, `motivo` |

## Notas para B
- `tareas_equipo` no se borra con historial: los avisos pueden apuntar a ella con seguridad.
- La audiencia de una tarea colectiva **no es el equipo actual** sino `tarea_equipo_participantes` (las altas/bajas de
  integrantes la mantienen). Alguien que salió (`hasta` no nulo) ya no es audiencia.
- Los resultados de las personas no se guardan: se calculan al consultar (`resultados_periodo()`), así que un aviso de
  «tu resultado cambió» debe salir de `calificaciones_historial`, no de comparar resultados.
- Nombres finales — tablas: `equipos`, `equipo_miembros`, `equipo_eventos`, `tareas_equipo`, `tarea_equipo_participantes`,
  `tarea_equipo_aportes`, `tarea_equipo_eventos`, `calificaciones_historial`, `periodo_calif_config`,
  `periodo_calif_config_hist`. Funciones públicas: `equipo_guardar`, `equipo_cambiar_estado`, `equipo_agregar_miembros`,
  `equipo_retirar_miembro`, `equipo_integrantes`, `equipos_resumen`, `tareas_equipo_estado`, `equipo_resultados`,
  `tarea_equipo_prorrogar`, `tarea_equipo_aportar`, `tarea_equipo_participacion`, `corregir_nota_tarea`, `anular_nota_tarea`,
  `restaurar_nota_tarea`, `nota_individual_equipo`, `calif_config`, `calif_config_guardar`, `tareas_calificacion_detalle`,
  `tareas_calificacion_resumen`.
- Estados nuevos en tareas individuales (`tareas.estado = 'anulada'`) y columnas `peso`, `puntos_original`,
  `nota_anulada_en/por/motivo`, `anulada_en/por`, `anulacion_motivo` (0033).
