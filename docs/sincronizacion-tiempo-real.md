# Sincronización de datos en tiempo real

Estado: implementada en la rama `feat/sync-tiempo-real` (PR abierto, **sin fusionar**). Migración **0062** pendiente de aplicar a mano en el SQL Editor.
Código: [`core/sync.js`](../core/sync.js) · estilos del indicador: [`sync.css`](../sync.css) · migración: [`supabase/migrations/0062_sincronizacion_tiempo_real.sql`](../supabase/migrations/0062_sincronizacion_tiempo_real.sql)
Pruebas: `tools/pruebas/sync-multisesion.mjs` (varias sesiones), `sql-0062.mjs` (publicación y permisos), `front-sync.mjs` (cableado).

---

## 1. Auditoría: cómo se obtenían, guardaban y actualizaban los datos (antes de este cambio)

**Verificado por búsqueda en el código** (`channel(`, `.subscribe(`, `postgres_changes`, `setInterval`, `visibilitychange`, `navigator.onLine`): **no había ninguna suscripción en tiempo real**. Todo era *pedir al abrir* (`SB.rpc` / `SB.from().select()` desde `api.js`) y repintar al navegar.

| Mecanismo | Dónde | Qué hacía | Problema |
|---|---|---|---|
| Carga al arrancar | `loadContexto` (user, secretario), `loadAllData` (admin) | Períodos, criterios, perfiles, personas, roles, distritos | Quedaba fijo hasta recargar la página |
| `Store.necesitaCarga(tab)` | `core/store.js`; pestañas `agenda`, `overview`, `calendario`, `trabajos`, `tareas` | «Se carga la primera vez y solo se repite si alguien invalida» | Nadie invalidaba por cambios ajenos: **datos obsoletos indefinidos** |
| Cachés del admin | `_users`, `_periodos`, `_roles`, `_distritos`, `_overviewEvals`, `_rptEvals[pe]`, `_evalPECache`, `_resV2` | Evitan pedir de nuevo | `_rptEvals` y `_overviewEvals` no se refrescaban nunca |
| Re-pedir al abrir la pestaña | Desempeño, Seguimiento (`invalidar()`), Distritos, Auditoría, Banco, Cuenta, Reportes | Siempre piden al entrar | Se quedan viejas **mientras están en pantalla** |
| `visibilitychange` | `user.js`, `secretario.js` | Revalidar al volver si pasó > 60 s | **El portal de administración no tenía ni eso** |
| `setInterval` 60 s | `core/notificaciones.js` | Solo el contador de la campana | Un aviso tardaba hasta un minuto; el panel abierto no se actualizaba |
| `Auth.getProfile()` con caché | `auth.js` | El perfil se lee una vez | Un rol cambiado o un acceso **revocado** no se notaba hasta recargar (la RLS protegía los datos, pero la interfaz seguía mostrando el portal) |
| `_bloquearSiPendiente` | `auth.js` | Solo al cargar | Revocar `aprobado` no cerraba una sesión ya abierta |

**Módulos que dependían de recarga manual** (la lista exacta que Sync cubre ahora): Panel, Desempeño, Seguimiento, Evaluar, Tareas, Equipos, Calendario/Agenda, Actividades, Banco, Personas, Distritos, Reportes, Auditoría, Períodos, Roles y perfiles, Rúbrica, Gestiones, Inicio, Mi perfil, Entregas, fichas de personas abiertas, campana de avisos.

**Módulos que no recibían cambios de otras personas**: todos los anteriores.

**Módulo «Solicito tu ayuda»: NO existe en el repositorio** (búsqueda en `*.js`, `*.html`, `*.sql`, `*.md`: cero resultados). No se ha inventado. Cuando exista bastará **tres líneas**: su tabla en `TABLAS` de `core/sync.js` (con el tema `ayuda`), la misma tabla en la lista de 0062, y `Sync.on('ayuda', …)` en su pantalla; el aviso a las personas elegibles ya viaja por la cola de avisos (campana en vivo, ver §4).

**Hallazgo de seguridad/despliegue**: la CSP (`connect-src 'self' https://*.supabase.co`) **bloqueaba el WebSocket de Realtime**: en CSP, `https:` no cubre `wss:`. Se añadió `wss://*.supabase.co` en `vercel.json` y se documentó en `CLAUDE.md`. Sin ese cambio Realtime no habría conectado nunca en producción (y localmente sí, que es lo que habría engañado).

---

## 2. Arquitectura

### Mecanismo elegido: Supabase Realtime · `postgres_changes`

| Opción | Veredicto |
|---|---|
| **`postgres_changes`** | **Elegida.** Los datos ya viven en Postgres con RLS; Realtime evalúa la RLS con el rol de *quien escucha*, así que nadie recibe una fila que no podría leer con un `SELECT`. No exige tocar ninguna función ni escritura existente (se publica la tabla y ya). |
| `broadcast` | Descartada para datos: habría que emitir desde cada escritura (cliente o trigger), duplicando la lógica de permisos que la RLS ya tiene. |
| Polling | Descartado (explícito en el pedido): carga la base aunque no cambie nada y llega tarde. Queda **un solo** reloj de seguridad, de 5 minutos, para la campana. |

Límite conocido de `postgres_changes`: se procesa en un único hilo del servidor y cada cambio se evalúa contra la RLS de cada suscriptor. Para esta escala (decenas de personas conectadas) es adecuado; ver §7 para lo que hay que vigilar.

### Un módulo, una API mínima

Las pantallas **no se suscriben a nada**. Se registran:

```js
const off = Sync.on(['tareas', 'kpis'], async ({ cambios, motivo }) => { /* volver a pedir y pintar */ },
                    { id: 'admin:tareas', vista: 'tareas', alEntrar: true });
```

| Opción | Efecto |
|---|---|
| `id` | Identifica el registro. **Repetir un id reemplaza al anterior**: volver a montar una pantalla no acumula manejadores. |
| `vista` | Solo es «visible» cuando `Sync.tab()` es esa pestaña (string o lista). `switchTabCore` la fija: un único punto para los tres portales. |
| `visible` | Condición propia extra (p. ej. «hay una ficha abierta»). |
| `alEntrar` | Si la vista **no** vuelve a pedir sus datos al abrirse (tiene caché), se revalida al entrar. |
| `diferible` (por defecto sí) | Se aplaza mientras haya un diálogo abierto o un texto sin guardar. |

Otras funciones: `Sync.tab(vista)`, `Sync.invalidar(temas)`, `Sync.resincronizar(motivo)`, `Sync.unico(clave, fn)` (comparte una petición en vuelo: *dedupe*), `Sync.vigilar(tabla, id, fn)` (concurrencia, §5), `Sync.estado()`, `Sync.onEstado(fn)`, `Sync.mapa()`.

### Mapa de dependencias (tabla → vistas que quedan viejas)

Una tarea aprobada no solo cambia «tareas»: mueve seguimiento, desempeño, ranking, indicadores del panel y reportes, porque todos salen de `resultados_periodo()` en SQL. El mapa está en `TABLAS` de `core/sync.js` (y se imprime con `Sync.mapa()`); resumen:

| Tabla(s) | Temas invalidados |
|---|---|
| `tareas`, `tareas_equipo`, `tarea_equipo_participantes`, `calificaciones_historial`, `periodo_calif_config` | `tareas` + `desempeno`, `ranking`, `kpis`, `seguimiento`, `reportes` (+ `equipos` las colectivas) |
| `evaluaciones` | `evaluaciones` + `desempeno`, `ranking`, `kpis`, `seguimiento`, `reportes` |
| `evaluaciones_distrito`, `estadisticas_distrito` | `distritos`, `ranking`/`estadisticas`, `reportes` |
| `periodos_evaluacion`, `periodo_participantes`, `gestiones` | `periodos`, `perfil`, `evaluaciones` y derivados |
| `profiles`, `persona_roles` | `personas`, `perfil`, `evaluaciones`, derivados |
| `roles`, `perfiles_rol`, `perfil_criterios`, `criterios_v2`, `criterios`, `rubrica` | `catalogo`, `evaluaciones`, `desempeno` |
| `calendario`, `actividades`, `actividad_destinatarios`, `etiquetas` | `calendario`, `kpis` |
| `equipos`, `equipo_miembros` | `equipos`, `tareas`, `reportes` |
| `distritos`, `banco_imagenes`, `trabajos_entregados`, `auditoria_global` (solo admin) | `distritos`/`personas`, `banco`, `tareas`/`kpis`, `auditoria` |
| `notif_senal` | `notificaciones` (campana) |

### Suscribir y desuscribir al entrar y salir

Un canal **por tabla**, abierto solo si alguna vista *activa* (la que se ve, o una global) la necesita. Al cambiar de pestaña, Sync abre los canales nuevos y cierra los de la pestaña que se dejó. Los eventos de una vista que no se ve no cuestan nada (ni siquiera se escuchan). Al volver, las vistas con `alEntrar` se revalidan, de modo que lo ocurrido mientras el canal estaba cerrado no se pierde. El canal del **propio perfil** (`profiles` con `id=eq.<yo>`) está siempre abierto.

### Refresco acotado, no recargas en bucle

- **Agrupa ráfagas**: 350 ms de calma (máximo 2,5 s desde el primer evento). Diez cambios seguidos = uno o dos refrescos (probado).
- **Solo lo que se ve**: una vista oculta queda marcada y se revalida al entrar si pidió `alEntrar`.
- **Un refresco a la vez por vista**; si llegan eventos durante el refresco, se repite una vez al terminar.
- Un refresco que falla se reintenta con espera creciente, como mucho tres veces; luego se declara el fallo (no un bucle).
- `Sync.unico` evita que dos pestañas pidan lo mismo a la vez (p. ej. `loadAllData` del admin).
- Cada refresco recibe `cambios = [{ tabla, tipo, id, nuevo, viejo }]`, de modo que una pantalla puede actualizar solo la fila afectada si le conviene (hoy las pantallas vuelven a pedir, que es lo seguro con la RLS).

### Sin parpadeos, sin perder scroll ni diálogos

| Riesgo | Qué hace Sync |
|---|---|
| Spinner/esqueleto encima de lo que ya se ve | Durante un refresco, `renderCargando()` (`core/render.js`) **no vacía** un contenedor que ya tiene contenido; lo mismo en perfil, inicio, calendario y avisos. Se ve lo anterior hasta que llega lo nuevo y se cambia de una vez. |
| Se pierde el scroll | Se guarda `scrollY` y el `scrollTop` de `.amain`, `#contenido`, `.panel-cuerpo` antes y se restauran después (probado). |
| Se cierra o se pisa un diálogo / se pierde un texto | Si hay un diálogo abierto (`[aria-modal]` visible) o un campo de texto con cambios sin guardar, el refresco **se aplaza** (cada 1,2 s se vuelve a mirar) y se aplica **una sola vez**, con todo lo acumulado, al cerrar (probado). Los diálogos son nodos aparte y un refresco nunca los toca. |
| Se resetea el filtro/pestaña elegidos | `Tareas.montar` conserva el filtro y la persona al volver a montar la misma lista; `Perfil.refrescar` conserva pestaña y período. |
| El formulario de evaluación abierto | La pestaña Evaluar solo refresca la **lista**; el formulario no se repinta (§5). |

---

## 3. Carga inicial y reconexión

| Disparador | Qué pasa |
|---|---|
| Iniciar sesión / abrir el portal | Cada portal llama `Sync.iniciar({ perfil })` tras `requireAuth/requireRole`: abre el canal del perfil y los de la vista visible. Los datos de la carga inicial siguen pidiéndose como siempre. |
| Abrir un módulo | `Sync.tab()` abre sus canales; las vistas con `alEntrar` se revalidan. |
| Volver a una pestaña inactiva | `visibilitychange`: si estuvo oculta más de 20 s → `resincronizar('visible')`. También `pageshow` con `persisted` (caché de ida y vuelta de iOS). |
| Se cae internet | `offline` → estado `sin-red`, **no se hacen peticiones ni se finge actualizar**, aparece el indicador. |
| Vuelve internet | `online` → `realtime.connect()`, se reabren canales caídos y **se resincroniza todo lo visible y se revalida el acceso**. |
| Cae un canal con red (servicio, token, etc.) | Reintento por canal con espera creciente (1 s, 2 s, 4 s… tope 30 s, con azar ±25 % para que no vuelvan todos a la vez). Al volver a `SUBSCRIBED` tras una caída se resincronizan las vistas de esa tabla. |
| Cambiar de rol | Ver §4. |
| Reabrir la app | Es una carga nueva: igual que iniciar sesión. |

**No se da por actualizado lo no verificado.** `Sync.estado()` devuelve `{ conexion, ultima, verificado }`; con `sin-red` o `reconectando`, `verificado` es falso y aparece, arriba y centrado, el indicador discreto («Sin conexión. Lo que ves puede estar desactualizado. Última comprobación: 12:31.»), `role="status"`, sin capturar toques. Con todo en orden **no hay nada en pantalla**. Los refrescos que fallan o se saltan por falta de red dejan la vista *marcada* para la próxima resincronización.

---

## 4. Seguridad y permisos

1. **RLS manda.** `postgres_changes` evalúa la RLS con el rol de quien escucha: un miembro no recibe la tarea de otro, una persona de otro distrito no recibe la iniciativa de distrito (probado en el mundo simulado con la misma lógica de visibilidad que la RLS).
2. **Migración 0062** (`sql-0062.mjs`, PGlite con `SET ROLE`):
   - Publica en `supabase_realtime` solo tablas que **existen, tienen RLS activa y clave primaria**; si alguna no cumple se omite con `RAISE WARNING` (publicar una tabla sin clave primaria haría fallar sus `UPDATE/DELETE`; sin RLS, Realtime la enviaría a cualquiera con `SELECT`).
   - `REVOKE ALL … FROM anon` sobre todo lo publicado: **anon no tiene `SELECT`, por tanto no recibe nada** (probado: `has_table_privilege('anon', …, 'SELECT')` falso en las 32 tablas y `permission denied` al leer).
   - **No se abre `notificaciones`** (cerrada a `authenticated` desde 0019; lleva errores de correo e intentos). En su lugar nace `notif_senal`: una fila por persona con un contador que sube cuando le llega o lee un aviso (triggers `AFTER INSERT` y `AFTER UPDATE OF leida_en`). Solo contiene `destinatario_id`, `tic`, `actualizado`; RLS `destinatario_id = auth.uid()`; `SELECT` solo propio, ninguna escritura desde el cliente. La campana escucha esa señal y pide el contador con la función de siempre. Probado: otra persona, ni siquiera la administración, ve la señal ajena.
   - Los eventos `DELETE` llevan solo la clave primaria (Realtime no aplica RLS a un borrado): nunca datos.
3. **Revalidación de acceso al instante** (`_revalidarAcceso`): cualquier cambio en **mi** fila de `profiles` (canal con `id=eq.<yo>`), al reconectar, al recuperar internet y al volver a la pestaña, se relee el perfil con `Auth.getProfile(true)` y:
   - perfil inexistente → `index.html`;
   - `aprobado = false` → `signOut()` + `index.html?pendiente=1`;
   - el portal ya no le corresponde (dejó de ser admin, pasó de miembro a secretaría, etc.) → se le **redirige a su portal**, sin cerrar sesión;
   - cambió rol/distrito/tipo dentro de lo permitido → se invalidan todas las vistas dependientes y se avisa con un mensaje; la RLS ya devuelve otros datos y los eventos del distrito anterior **dejan de llegarle** (la RLS se evalúa con su estado actual; probado).
   - `onAuthStateChange`: `SIGNED_OUT` → inicio; otro usuario iniciado en otra pestaña → recarga.
   Las restricciones por período (`periodo_participantes`) y los roles múltiples (`persona_roles`) invalidan `perfil`/`personas`.
4. **Nota sobre aprobar un acceso**: una persona *pendiente* no tiene sesión abierta en ningún portal (`Auth` la saca de inmediato), así que no hay pantalla suya que actualizar: ve el cambio al iniciar sesión. Lo que sí se actualiza en vivo es la lista de solicitudes de **las demás personas administradoras**, y, si a alguien con el portal abierto se le cambia el rol/aprobación, lo descrito arriba.

---

## 5. Concurrencia

- **No se pisan cambios ajenos en silencio.** La pantalla de evaluación (clásica y por roles) usa `Sync.vigilar('evaluaciones', id, …)` al abrir un formulario: si otra persona cambia o **borra** esa evaluación mientras se edita, aparece un aviso («Otra persona modificó esta evaluación mientras la editabas. Lo que escribes no se ha tocado.») con «Ver la versión nueva». Al guardar, si hubo un cambio ajeno desde que se abrió, se **pide confirmación** («tu versión reemplaza la suya»). El eco del guardado propio se silencia 5 s para no anunciarse como conflicto.
- **El estado de las tareas** ya estaba protegido en el servidor: cada transición se valida en SQL (`tareas`, 0016/0032), y una acción sobre un estado que cambió falla con un mensaje en vez de aplicarse.
- **Sin duplicados**: los eventos se agrupan por vista; un registro con el mismo `id` reemplaza al anterior; `Sync.unico` comparte peticiones en vuelo; las claves únicas existentes (`dedupe_key` de avisos, equipos sin integrantes duplicados…) siguen siendo la barrera real en base de datos.
- **No hecho (a propósito)**: control optimista con `updated_at` en *todas* las escrituras. Las tablas con `updated_at` hoy son `tareas`, `actividades`, `equipos`, `tareas_equipo`, `banco_imagenes`, etc., pero casi todas se escriben por RPC con su propia validación de estado; cambiarlas todas a «escribir solo si la versión coincide» exige tocar cada función SQL y se salía del alcance. El aviso por evento + confirmación cubre el caso de evaluaciones (donde dos evaluadores sí pueden coincidir). Candidato natural para un paso siguiente: `guardar_actividad(… p_version)`.

---

## 6. Pruebas

`npm run todo` (en `tools/pruebas`) corre ahora también el grupo `sync`.

| Script | Qué prueba |
|---|---|
| `sync-multisesion.mjs` (76 comprobaciones) | El **código real de `core/sync.js`** corriendo en varias «pestañas» (vm) contra `fake-realtime.mjs`, un mundo con RLS por usuario y un bus de eventos: 1) A crea una tarea y B la ve; C (otro distrito) no recibe ni el evento · 2) una iniciativa de distrito se modifica/borra y la ven solo los autorizados · 3) una evaluación publicada y una tarea aprobada actualizan desempeño, indicadores y ranking · 4) acceso y rol: ascenso a secretaría redirige, cambio de rol avisa, otra administradora ve la solicitud y su aprobación · 5) la campana en todos los dispositivos de la persona (el módulo de ayuda no existe: la prueba lo comprueba) · 6) PC + iPad + teléfono · 7) sin internet → resincroniza; fallo del servicio → reintento con espera creciente; pestaña dormida · 8) cambio de distrito, quitar la administración, revocar `aprobado`, borrar el perfil · diálogo abierto, texto sin guardar, scroll, ráfagas, concurrencia, dedupe. |
| `sql-0062.mjs` (35) | La migración sobre el esquema real hasta 0035 (PGlite con roles): idempotente, qué se publica y qué **no** (sin RLS, sin PK, `notificaciones`), `anon` sin nada, escrituras intactas, señal de avisos y su privacidad, entorno mínimo. |
| `front-sync.mjs` | Orden de scripts, CSP con `wss`, tablas escuchadas = tablas publicadas por 0062, que todo tema y toda vista que usan los portales existan (un tema mal escrito nunca dispara), reglas del repo (sin `onclick`, sin hex, sin barras de acento, sin emojis), conflicto y escritura propia. |

`tools/pruebas/ui/fake-supabase-client.js` (cliente falso de las pruebas de interfaz) ahora tiene `channel/removeChannel` inertes y `__FAKE.emitir(...)` (reenvío entre pestañas por `BroadcastChannel`) para ver el efecto a mano con `npm run ui`.

---

## 7. Lo que NO se pudo verificar contra la base viva

El conector de Supabase de esta sesión no tiene permiso de escritura y no se probó contra el proyecto real. **Antes de dar esto por bueno en producción**, comprobar:

1. **Aplicar 0062** en el SQL Editor y ver: `SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1;` y los `NOTICE`/`WARNING` de la salida (una tabla sin RLS o sin PK aparece como aviso y se omite).
2. **Que Realtime esté habilitado** en el proyecto (Dashboard → Database → Replication) y que el plan admita las conexiones/canales: cada pestaña abre un WebSocket y **un canal por tabla escuchada** (hasta ~25 en el Panel del admin, que usa muchos temas; ~10–14 en las demás vistas). Si se acercara a algún límite, la vía es agrupar tablas en un canal por vista.
3. **Que la CSP con `wss://` cargue en Vercel** (se probó el texto, no el despliegue) y que **iOS Safari** no cierre el socket en segundo plano sin avisar (el código lo asume y lo cubre con la resincronización al volver; no se probó en dispositivo).
4. **Latencia y coste real** de `postgres_changes` con la RLS de cada tabla bajo carga (el mundo simulado no mide rendimiento). Si el Panel de administración resultara pesado, la palanca es acotar los temas de esa vista.
5. Que `REPLICA IDENTITY` por defecto (clave primaria) baste en las tablas de clave compuesta (`periodo_participantes`, `persona_roles`…): sirve para entregar `DELETE` con las columnas de la clave, que es lo que Sync necesita.
6. Que **no existan políticas RLS permisivas por error** en alguna tabla publicada: Realtime aplicaría esa misma política (no abre nada nuevo, pero tampoco la corrige).

## 8. Cómo añadir un módulo nuevo

1. Si usa una tabla nueva: añadirla a `TABLAS` (con sus temas derivados) y a la lista de la migración (o una 00NN nueva con el mismo bloque); `front-sync.mjs` falla si no coinciden.
2. En el portal, dentro de `initSync()`: `Sync.on(['temas'], () => recargarMiPantalla(), { id: 'portal:mi-pantalla', vista: 'mi-pestaña' })`.
3. Si la pantalla tiene un formulario largo, que **no** se repinte con el refresco: refrescar solo la lista y usar `Sync.vigilar(tabla, id, aviso)` para avisar de un cambio ajeno.
4. Los repintados deben pasar por `renderCargando()` (o respetar `Sync.silencioso()`), para no parpadear.
