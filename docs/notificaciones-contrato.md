# Contrato de eventos de notificación (sesión B → sesión A)

Una sola cola (`notificaciones`, 0019) alimenta la campana y el correo. Un evento se emite con **una** llamada:

```sql
PERFORM public.notif_emitir(
  p_tipo           => 'tarea_colectiva_asignada',   -- uno del catálogo (tabla notif_tipos)
  p_destinatarios  => ARRAY[...]::uuid[],           -- SOLO las personas involucradas y autorizadas
  p_datos          => jsonb_build_object('tarea', NEW.titulo, 'equipo', v_equipo, ...),
  p_ref_tipo       => 'tarea',                      -- tarea | equipo | evaluacion | actividad | persona | periodo
  p_ref_id         => NEW.id::text,
  p_evento         => 'asig',                       -- distingue ESTE hecho de otro del mismo objeto
  p_actor          => auth.uid(),                   -- quien lo provocó: nunca se le avisa a sí misma
  p_despues        => NOW()                         -- opcional: aviso diferido
);
```

* **Nunca falla**: captura sus propios errores y deja el motivo en `notificaciones_eventos`. Se puede llamar
  dentro de un disparador `AFTER` sin envolverla (aun así, no la saques de un bloque `BEGIN … EXCEPTION`).
* **Sin duplicados**: la clave es `tipo:ref_id:evento:destinatario` y es única. Repetir el mismo hecho no crea
  otro aviso. `p_evento` debe cambiar cuando el hecho es *otro* (p. ej. la ronda de revisión, la versión de la
  calificación, `extract(epoch from now())` si cada edición cuenta como un hecho nuevo).
* **Solo datos de la lista blanca** del tipo (`notif_tipos.claves`); lo demás se descarta. **Nunca puntajes ni
  notas en `p_datos`** de calificaciones: el aviso informa y enlaza, el detalle se ve dentro, con permisos.
* Quien llama es responsable de **calcular bien la audiencia** (lo que la RLS dejaría ver a esa persona);
  `notif_emitir` solo agrega guardas: perfil existente y aprobado, sin repetidos, sin el actor y tipos solo-admin.
* `SECURITY DEFINER`, revocada a `PUBLIC`/`anon`/`authenticated`: solo la llaman otras funciones del servidor.

## Tipos acordados (nombres exactos)

| tipo | quién recibe | claves de `datos` | ref | esencial |
|---|---|---|---|---|
| `equipo_incorporado` | la persona que entra | `equipo`, `rol_equipo`, `agregado_por` | `equipo` | sí |
| `equipo_retiro` | la persona retirada **por otra** (si se va sola no se avisa) | `equipo`, `retirado_por`, `motivo` | `equipo` | sí |
| `tarea_asignada` | la persona asignada (tarea individual) | `tarea`, `periodo`, `asignador`, `fecha_limite`, `prioridad` | `tarea` | sí |
| `tarea_colectiva_asignada` | cada integrante del equipo (o la responsable, según A) | `tarea`, `equipo`, `asignador`, `fecha_limite`, `prioridad`, `responsable` | `tarea` | sí |
| `tarea_cambio` | quienes tienen la tarea (y quien dejó de ser responsable) | `tarea`, `cambio` (Responsable / Instrucciones / Fecha límite), `antes`, `ahora`, `motivo`, `cambiado_por` | `tarea` | sí |
| `tarea_por_vencer` | quienes tienen la tarea abierta (lo genera el recordatorio diario) | `tarea`, `cuando`, `fecha_limite`, `estado` | `tarea` | no |
| `tarea_vencida` | ídem | `tarea`, `fecha_limite`, `dias` | `tarea` | sí |
| `entrega_registrada` | quien revisa (admin + secretaría del distrito; nunca quien entregó) | `tarea`, `persona`, `equipo`, `entregada`, `a_tiempo` | `tarea` | no |
| `correccion_solicitada` | quienes tienen la tarea | `tarea`, `revisor`, `observacion`, `fecha_limite` | `tarea` | sí |
| `calificacion_nueva` | la persona (o integrantes del equipo) calificada | `periodo`, `actividad`, `equipo`, `evaluador` | `evaluacion` / `tarea` | sí |
| `calificacion_cambiada` | ídem | ídem | ídem | sí |
| `observacion_nueva` | la persona / equipo que recibe la retroalimentación | `periodo`, `actividad`, `equipo`, `autor` (sin el texto) | `evaluacion` / `tarea` | no |
| `estado_cambiado` | las personas afectadas por el cambio | `objeto`, `nombre`, `antes`, `ahora`, `cambiado_por` | según objeto | no |

Existentes que **se conservan** (y alimentan lo anterior): `tarea_aprobada`, `tarea_bloqueada`,
`solicitud_acceso`, `acceso_aprobado`, `actividad_nueva`, `actividad_recordatorio`, `evaluaciones_sin_publicar`.
Renombres hechos por 0040 (con los avisos históricos migrados): `nota_publicada → calificacion_nueva`,
`nota_corregida → calificacion_cambiada`, `tarea_devuelta → correccion_solicitada`,
`plazo_movido → tarea_cambio`, `entrega_por_revisar → entrega_registrada`.

## Qué necesita B de A

Documentar en su rama (p. ej. `docs/equipos-puntos-de-emision.md`) por cada hecho: **tabla y operación** que lo
produce (INSERT/UPDATE/DELETE y qué columna cambia), **quién debe enterarse** (consulta que da las personas) y
**qué clave identifica el hecho**. B escribe los disparadores en su fase 2, después de fusionar la rama de A, para
no tocar tablas ajenas. A **no** emite avisos ni modifica `notificaciones`, `notif_*` ni `core/notificaciones.js`.
