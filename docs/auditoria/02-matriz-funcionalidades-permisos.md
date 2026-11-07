# 02 · Matriz de funcionalidades por perfil y permisos

Leyenda: **✔** = existe y lo impone la base (RLS/trigger/RPC) · **UI** = solo oculto/mostrado en pantalla, sin comprobación propia en la base (o no verificado) · **—** = no puede / no existe · **~** = parcial.
Fuente de permisos: migraciones (`supabase/migrations/`) ejecutadas en PGlite como `authenticated`/`anon` (`npm run sql`, `npm run cadena`: todo verde, ver README). **No contrastado con la base en vivo.**

Perfiles: *Miembro* = `tipo_miembro='miembro'`, `es_admin=false`. *Secretaría* = `tipo_miembro='secretario'` con `distrito` (se sirve en `secretario.html`; un miembro también entra ahí). *Administración* = `es_admin=true` (no se evalúa).

## 1. Funcionalidades

| Área | Funcionalidad | Miembro | Secretaría | Administración | Dónde se impone |
|---|---|---|---|---|---|
| Acceso | Registro (crea cuenta sin privilegios) | ✔ | ✔ | — | trigger `on_auth_user_created` (0001); `hay_gestion_abierta()` |
| | Aprobación de acceso | — | — | ✔ | `profiles_bloquear_privilegios` (0001) bloquea `aprobado`/`es_admin`/`tipo_miembro`/`distrito`/`rol_id` a no-admin |
| | Cambiar rol funcional, distrito, rol operativo | — | — | ✔ | mismo trigger |
| | Eliminar persona | — | — | ✔ (`profiles_delete_admin`) | RLS. Ver H-06 en 05 |
| Perfil | Ver el propio perfil, desempeño, criterios | ✔ | ✔ | n/a | `resultados_periodo()` filtra por llamante |
| | Ver el perfil de otras personas | — | ✔ su distrito (panel «supervisión») | ✔ todas | `profiles_read_secretario`, `seguimiento_global` |
| | Gafete propio / de otros | ✔ propio | ✔ propio | ✔ cualquiera, regenerar, revocar | RPC `obtener/regenerar/revocar_gafete`; tabla sin grants |
| | Preferencias de rol (información, no permiso) | ✔ | ✔ | — (no se evalúa) | `guardar_preferencias_rol` |
| | Roles permitidos (`persona_roles`) | — | — | ✔ | `persona_roles_admin` |
| Evaluación | Puntuar, guardar borrador, **publicar** | — | — | ✔ | `evaluaciones_admin` (FOR ALL) + `evaluaciones_validar_modelo` |
| | Ver evaluación propia | ✔ solo publicada | ✔ publicada de su distrito | ✔ borradores incluidos | `evaluaciones_read_*` |
| | Editar/borrar una evaluación **ya publicada** | — | — | ✔ **sin restricción ni historial** | ver H-01 |
| | Evaluación de distrito | — | ✔ lee publicadas | ✔ escribe | `eval_dist_admin`, `eval_dist_read` |
| | Estadísticas de Instagram del distrito | — | ✔ su distrito, y cualquier secretaría del distrito corrige la fila compartida | ✔ lee y corrige todo; solo admin borra | 0043 + Storage `capturas_distrito_*` |
| Tareas | Crear tarea para otros | — | ✔ miembros de su distrito | ✔ cualquiera | `tareas_validar_insert` |
| | Crear tarea propia (`origen='propia'`) | ✔ | ✔ | — | idem |
| | Revisar/aprobar | — | ✔ distrito, nunca la propia | ✔ | `puede_revisar_tarea` |
| | Prorrogar | — | ✔ | ✔ | RPC `prorrogar_tarea` (motivo) |
| | Puntos 0–10 al aprobar; corregir/anular nota | — | ✔ puntos al aprobar | ✔ corregir/anular/restaurar (`motivo≥5`) | `zz_tareas_puntos`; `corregir_nota_tarea()` |
| Equipos | Crear/editar equipos, altas/bajas | — | — | ✔ | RPC `equipo_*` (DML revocado) |
| | Ver equipos | ✔ los suyos | ✔ de su distrito | ✔ | `equipos_select`, `equipo_visible()` |
| | Tarea colectiva: asignar/revisar | — | ✔ equipos de su distrito si ella no participa | ✔ | 0032 |
| | Tarea colectiva: entregar, aportar | ✔ integrantes | — (si participa, como integrante) | — | `tarea_equipo_aportar` |
| | Nota individual dentro de tarea colectiva | — | ✔ revisor | ✔ | `nota_individual_equipo()` (evidencia ≥10) |
| Reglas del PE | Peso de tareas, multiplicadores, mínimo, vencidas=0 | — | lee | ✔ edita (motivo si hay publicadas) | `calif_config_guardar`, `periodo_calif_config_hist` |
| Configuración | Gestiones, períodos, activar PE | — | — | ✔ | `gestiones_admin`, `periodos_admin_write`, `set_periodo_activo` (guardia `IF NOT is_admin()`, 0008) |
| | Rúbrica clásica, criterios v2, perfiles de rol | lee | lee | ✔ (perfil usado = inmutable; cambio = nueva versión) | `*_admin_write`, `crear_perfil_rol` |
| | Actividades y etiquetas | lee las suyas | ✔ su distrito | ✔ | 0018/0024 |
| Análisis | Panel / gráficos | — | — | ✔ | RPC `resultados_periodo` |
| | Desempeño propio | ✔ | ✔ | n/a | `seguimiento_global()` fila propia |
| | Desempeño del equipo/distrito | — | **— (no existe; solo el perfil en panel y Seguimiento)** | ✔ `core/desempeno.js` | ver brecha B-03 |
| | Seguimiento | su fila (dentro de Perfil→Evolución) | ✔ su distrito | ✔ | `seguimiento_global` (borradores solo admin) |
| | Reportes (PE, actividades, general) | — | ✔ su distrito | ✔ | `reporte_general_pe` hereda permisos de `seguimiento_global` |
| | Exportar CSV | — | ✔ | ✔ | cliente; las filas ya vienen filtradas |
| Avisos | Campana y preferencias de correo | ✔ | ✔ | ✔ + «Estado de los correos» | RPC `mis_notificaciones…`; esenciales no se apagan |
| Auditoría | Registro global de acciones | — | — | **— (no existe)** | solo hay historiales por dominio (ver H-03) |

## 2. Permisos por tabla (lectura / escritura efectiva)

| Tabla | Miembro | Secretaría | Admin | Anon |
|---|---|---|---|---|
| `profiles` | R propia; U propia sin campos privilegiados | R su distrito | CRUD | nada |
| `evaluaciones` | R propia publicada | R publicadas de su distrito | CRUD (incl. publicadas) | nada |
| `evaluaciones_distrito` | R publicadas | R publicadas | CRUD | nada |
| `estadisticas_distrito` | — | CRU su distrito (no archivado) | CRUD | nada |
| `tareas` / `tareas_equipo` | según asignación y rol | su distrito | todo | nada |
| `*_eventos`, `calificaciones_historial` | R por visibilidad | R por visibilidad | R | nada (append-only por trigger) |
| `periodos`, `criterios`, `rubrica`, `criterios_v2`, `perfiles_rol`, `calendario`, `config`, `gestiones` | R | R | CRUD (escritura bloqueada si gestión archivada, 0013) | nada |
| `gafetes`, `notificaciones`, `notif_preferencias`, `bienvenida_estado` | sin acceso directo | sin acceso directo | sin acceso directo | solo `verificar_gafete`, `hay_gestion_abierta` |
| `manuales_privados` | — | — | R | nada |

## 3. Pruebas de permisos existentes (evidencia)

`tools/pruebas/sql-*.mjs` (más de 1 600 aserciones sumando sql, front, cadena y correo) corren como `authenticated`/`anon` con RLS real; `base-eq.mjs` imita los permisos por defecto de Supabase para que un `REVOKE` olvidado falle; `cadena.mjs` (15) comprueba que anon solo ejecuta `PERMITIDAS_ANON`. Cubre acceso permitido/denegado y cruce de distrito en tareas, equipos, estadísticas, actividades, seguimiento y reportes.

**No se encontró** prueba explícita de: (a) un miembro intentando `UPDATE evaluaciones` (la política de escritura es solo admin, por lo que la denegación es estructural, pero no hay aserción dedicada — **pendiente de validar**), (b) cruce de distrito sobre `evaluaciones_distrito` de otra secretaría (las publicadas son legibles por todos por diseño, ver B-05).

## 4. Brechas de permisos observadas

- **B-01** `fix-evaluaciones-visibilidad.sql` y `fix-rls-secretario.sql` están en la raíz, fuera de `migrations/`, y el primero **recrea** `evaluaciones_admin` sin `gestion_escribible`. Si alguien lo reejecutara tras 0005 revertiría la protección de gestión archivada. Estado real **no verificable** sin la base viva. Riesgo medio.
- **B-03** La secretaría no tiene «Desempeño» del distrito (PDF §4.2). Es una capacidad inexistente, no un permiso roto.
- **B-05** (según `fix-evaluaciones-visibilidad.sql`; si esa política no está aplicada en vivo, no verificable) `eval_dist_read` permite a **todo autenticado** leer evaluaciones de distrito publicadas (también de otros distritos). CLAUDE.md dice que los demás distritos «siguen confidenciales» en la UI de secretaría; la base **no** lo impone (la UI sí oculta). Depende de si el ranking de distritos es público para el equipo: **decisión de negocio pendiente**.
- **B-06** `profiles_update` permite que cada persona actualice su fila; los campos privilegiados los frena el trigger. Cubierto por tests de 0001; correcto.
