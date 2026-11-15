# 10 · Gafetes, auditoría, configuración y tiempo real (procesos 21 y 22)

## Proceso 21 · Gafete con QR, Wallet y verificación pública

**Objetivo.** Dar a cada persona una **identificación verificable**: lo que se imprime y lo que se verifica no pueden diverger.

**Actores.** Cada persona (su propio gafete); la administración (el de cualquiera, y regenerar o revocar); cualquier persona **sin sesión** (verificar).

**Pantallas.** Mi perfil → **Mi gafete** (propio) · perfil de cualquier persona → **Gafete** (administración) · página pública `/v/<código>` (`verificar.html`).

### 21.1 El gafete

- Se dibuja en un `<canvas>` (**sin librerías de captura**) con la **identidad vigente** (malla de color, vidrio, tipografía ligera) en el tema que la persona usa; se muestra en un panel y se puede **Descargar PNG** (×2, nítido para imprimir o subir a una wallet) y **Copiar enlace**.
- El **código QR** (librería `qrcode-generator`, vendorizada en `core/vendor/qrcode.js`, sin CDN) lleva `https://<host>/v/<token>`. El `token` es **aleatorio de 96 bits**, **nunca el id ni el correo**.
- La tabla `gafetes` **no tiene permisos para nadie**: todo pasa por funciones: `obtener_gafete`, `regenerar_gafete` y `revocar_gafete` (administración) y `verificar_gafete` (**la única ejecutable por anónimos**).
- Los datos impresos salen de `verificar_gafete(token)`.

### 21.2 Verificación pública

`/v/<código>` (reescritura de Vercel hacia `verificar.html`; página **sin sesión**, `noindex`).

- Muestra solo: **nombre, foto, rol, distrito, cargo, ingreso y número de PE con evaluación publicada**, con un sello de «verificado». **Nunca correo, notas ni comentarios.**
- Una cuenta **sin aprobar**, un token **desconocido** o uno **revocado** responden **igual** (`{valido:false}`): no se puede distinguir cuál era el caso.

### 21.3 Administración del gafete

1. En el perfil de la persona (Gestión): **abrir** el gafete, **regenerar** (nuevo código; el anterior deja de valer) o **revocar**.
2. **Un gafete revocado solo lo reactiva la administración**. La persona ve «Este gafete está revocado» y puede pedir **«Activar con un código nuevo»** a la administración.

### 21.4 Google Wallet (Android) — sin configurar

- El botón **«Añadir a Google Wallet»** aparece en el gafete **propio**: dibuja la imagen del pase (1032×812, sin texto), la sube a `avatars/<uid>/wallet-hero.jpg` y llama a la función `gafete-wallet`, que crea o actualiza el pase por la API de Google Wallet y devuelve un **enlace firmado** (RS256, con cuenta de servicio).
- **Hace falta configurar**: `GOOGLE_WALLET_ISSUER_ID` y `GOOGLE_WALLET_SA_JSON`. Sin ellos la función responde **503 `no_configurado`** y el portal lo explica («Google Wallet aún no está activado en este portal»). El alta, paso a paso, está en `docs/google-wallet.md`. **El dueño decidió no trabajarlo por ahora.**
- **Apple Wallet: no hay `.pkpass`**: iOS rechaza pases sin la firma de un certificado de Apple Developer (de pago). Alternativa sin pagar: apps como Pass2U Wallet crean el pase desde el enlace del QR.

## Proceso 22a · Auditoría global

**Objetivo.** Responder «¿quién cambió qué, cuándo y por qué?» en un solo lugar.

**Actor.** **Solo administración.** **Pantalla.** **Auditoría** (grupo suelto del menú, tras Reportes; `core/auditoria.js`; solo lectura).

### Qué hace

`auditoria_listar(desde, hasta, origen, buscar, limite, offset)` (SECURITY DEFINER, solo administración) **une** el registro nuevo `auditoria_global` con los historiales que ya existían, **sin copiar datos**:

| Origen | Qué registra |
|---|---|
| Personas | Cambios de privilegios (rol funcional, tipo, distrito, rol, acceso) y borrado |
| Períodos | Crear, borrar, activar, desactivar |
| Gestiones | Crear, abrir, archivar, cambiar |
| Distritos | Evaluaciones de distrito (borrador, publicada, estado), **sin los textos de comentarios** |
| Evaluaciones | Versiones y rectificaciones (0053) |
| Notas de tareas | `calificaciones_historial` |
| Reglas del PE | `periodo_calif_config_hist` |
| Tareas / Tareas de equipo / Equipos | `tarea_eventos`, `tarea_equipo_eventos`, `equipo_eventos` |
| Estadísticas de Instagram | `estadisticas_distrito_hist` (0054) |

### Actividades

1. Abrir **Auditoría**; filtrar por **origen**, **fechas desde/hasta** y **buscar** (persona, acción, motivo).
2. Leer la lista paginada (50 por página): **Cuándo · Origen · Qué pasó · Quién · Motivo y valores**; **Ver valores** despliega antes/después.
3. **Descargar CSV** de las mismas filas y filtros (hasta 5000, celdas neutralizadas contra fórmulas).

### Reglas

- Los **disparadores** que escriben `auditoria_global` **no pueden impedir** la operación: si fallan, se ignoran.
- **Nunca guarda correos.**
- Un cambio hecho **sin sesión** (SQL Editor) queda con actor vacío: **«Sin sesión (mantenimiento)»**.
- Si falta la migración de un historial, ese origen simplemente **no aparece** (cada uno entra solo si su tabla existe).
- **Un origen nuevo** = una parte más en `auditoria_listar` + su etiqueta en `Auditoria.ORIGENES` y `ACCIONES_TXT`.

## Proceso 22b · Configuración general

**Objetivo.** Un **índice de todo lo configurable**, por apartados, para que la administración no tenga que adivinar dónde está cada ajuste.

**Actor.** Administración. **Pantalla.** **Configuración** (`tab-configuracion`; `core/configuracion.js`).

### Apartados

Cada **fila** dice qué se configura, muestra el **valor actual** (cuando ya está cargado) y tiene un botón que **abre la pantalla que lo edita**; el tema y el selector de entrada se cambian **ahí mismo**.

| Apartado | Filas |
|---|---|
| **Organización** | Gestión · Períodos de evaluación · Distritos · Personas y accesos · Equipos |
| **Evaluación** | Roles y perfiles · Rúbrica y criterios · Reglas de calificación de tareas (se abren en Tareas) · Niveles de desempeño (solo lectura) |
| **Calendario y actividades** | Actividades y tipos · Calendario |
| **Comunicación** | Avisos y correos (informativo) · Banco de imágenes |
| **Apariencia y entrada** | **Tema** (oscuro/claro/rosa, aquí mismo) · Selector de entrada («Volver a mostrar») · Mi cuenta |
| **Seguridad y registro** | Auditoría · Gafetes (informativo: se gestionan desde el perfil) · Reportes |

Para una opción nueva en la plataforma, se **suma su fila al arreglo `APARTADOS`**: no hay otra lista. Las pantallas Períodos, Actividades, Rúbrica, Roles y Gestiones ya **no tienen entrada propia en el menú**: cuelgan de Configuración.

> Limitación honesta: hoy es un **índice con enlaces** más dos ajustes inline; no edita todo en un solo lugar.

## Proceso 22c · Sincronización en tiempo real

**Objetivo.** Que nadie tenga que recargar la página para ver lo que cambió otra persona.

**Mecanismo.** **Supabase Realtime · `postgres_changes`**. La RLS se evalúa con el rol de **quien escucha**: nadie recibe una fila que no podría leer con un `SELECT`. El módulo central es `core/sync.js` (con `sync.css` para el indicador de conexión). Detalle y auditoría previa: `docs/sincronizacion-tiempo-real.md`.

### Cómo funciona

- Las pantallas **no se suscriben a nada**: se **registran** con `Sync.on(temas, fn, { id, vista, alEntrar })`. Un **cambio de tabla invalida también las vistas derivadas** mediante el mapa `TABLAS` (una tarea aprobada invalida: listado de tareas, seguimiento, KPIs del Panel, estadísticas, desempeño, reportes, notificaciones…).
- **Refresco acotado**: solo se repinta la pestaña que se ve; las ráfagas de cambios se agrupan; un diálogo abierto o un texto sin guardar **aplazan** el refresco; el scroll se conserva; si hay una petición idéntica en vuelo se comparte (`Sync.unico`).
- **Avisos en tiempo real**: la tabla `notificaciones` **no se abre**; nace `notif_senal` (una fila por persona con un contador) que la campana escucha.
- **Concurrencia**: al abrir un formulario de evaluación, `Sync.vigilar` avisa si otra persona la **modifica o borra** mientras se edita («Otra persona modificó esta evaluación…»); las transiciones de tareas ya se validan en SQL.

### Carga inicial y reconexión

| Situación | Qué pasa |
|---|---|
| Iniciar sesión / abrir el portal | Se abre el canal del perfil y los de la vista visible |
| Volver a una pestaña inactiva (> 20 s) | Se **resincroniza** todo lo visible |
| Se cae internet | Estado «sin red»: **no se finge actualizar**; aparece un indicador discreto («Sin conexión. Lo que ves puede estar desactualizado. Última comprobación…») |
| Vuelve internet | Se reabren canales, se **resincroniza todo** y se **revalida el acceso** |
| Cae un canal con red | Reintento con espera creciente (1, 2, 4… hasta 30 s, con aleatoriedad) |
| Cambia mi perfil (rol, acceso, tipo) | Se **revalida el acceso al instante** (ver abajo) |

### Seguridad

- La **migración 0064** publica en `supabase_realtime` solo tablas que **existen, tienen RLS y clave primaria**; **anon no recibe nada** (`REVOKE ALL … FROM anon`); los eventos `DELETE` llevan solo la clave primaria.
- **Revalidación inmediata del acceso**: cualquier cambio en **mi** fila de `profiles` relee el perfil: si falta → `index.html`; si `aprobado = false` → cierra sesión y a `?pendiente=1`; si el portal ya no le corresponde (dejó de ser admin, etc.) → la **redirige a su portal**; si cambió rol o distrito → invalida todo y avisa. **Revocar un acceso corta la sesión abierta.**
- La **CSP** necesitó `wss://*.supabase.co` en `connect-src`: en CSP, `https:` no cubre `wss:`.

### Qué no se pudo verificar

La **publicación real** `supabase_realtime` y el comportamiento con latencia real: se probaron con simulación multisesión y PGlite, **no contra la base viva**. Verificar a mano abriendo el portal en **dos navegadores** (por ejemplo una ventana normal y una de incógnito) y comprobando que un cambio aparece en el otro sin recargar. El módulo **«Solicito tu ayuda» no existe** en el repositorio y no se inventó.

### Reglas para quien desarrolle

1. Una tabla nueva escuchada va en `TABLAS` **y** en la lista de la migración 0064 (`front-sync.mjs` falla si no coinciden).
2. El repintado debe pasar por `renderCargando()` o respetar `Sync.silencioso()`, o parpadeará.
3. Los formularios largos **no se repintan** con el refresco: se refresca la lista y se avisa con `Sync.vigilar`.
4. Una pantalla nueva se **registra** en el `initSync()` de su portal.
