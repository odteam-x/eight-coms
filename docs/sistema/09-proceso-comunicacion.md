# 09 · Comunicación (procesos 19 a 22, parte 1)

## Proceso 19 · Calendario y actividades

**Objetivo.** Que todos vean en un solo lugar las fechas de los períodos, las actividades del equipo o del distrito y los plazos de sus tareas.

**Pantallas.** **Calendario** (para todos los roles) y, en administración, su **Lista de actividades** (botón en el propio Calendario; también se puede **crear una actividad** desde un día o con **Nueva actividad**). Los **tipos** (etiquetas) se administran en Configuración.

### 19.1 Qué junta el calendario

Una **cuadrícula del mes** más un **panel de agenda** del día elegido, con tres fuentes:

1. **Fechas de los períodos** (los rangos de cada PE y sus cuatro fechas clave).
2. **Actividades** y jornadas.
3. **Tareas**: fechas límite, vencidas, entregadas y aprobadas.

La **leyenda** de colores se arma con las **etiquetas** (por ejemplo: *Fechas de los períodos, Mis tareas / Tareas del distrito, Entrega, Jornada, Capacitación, Reunión, Evento*) y **filtra** la cuadrícula. Las celdas mantienen al menos 44 px de ancho desde 360 px. Los botones del selector de períodos (`renderPEBar`) muestran su rango de fechas y marcan el día de hoy.

### 19.2 Actividades (`actividades`, `etiquetas`, `actividad_destinatarios`)

Una actividad es **literal**: título, fecha o rango, **tipo (etiqueta)**, descripción y **para quién**. No depende de los períodos.

**Alcance («Para quién»)**:

| Alcance | Quién la ve |
|---|---|
| **Todo el equipo** | Todas las personas con acceso (solo la administración la crea) |
| **Un distrito** | Las personas de ese distrito (la administración elige el distrito; la secretaría **solo el suyo**) |
| **Personas y equipos elegidos** (`seleccion`) | Solo las destinatarias, quien la creó, la administración y la secretaría del distrito dueño. **Elegir un equipo expande a sus integrantes de ese momento**: la selección siempre es una lista de personas |

**Crear o editar** (`ActividadForm`): **Tipo** (etiqueta) y **Para quién**, con un renglón que dice **a cuántas personas se avisará**. La secretaría solo ve personas de **su** distrito y no puede crear actividades para todo el equipo ni para otro distrito.

**Etiquetas**: nombre y **color de una paleta fija de 8 tonos** (coral, violeta, verde, ámbar, cian, azul, rojo, gris; medidos a 3:1 en ambos temas). Se **siembran por gestión**. La etiqueta de partida «Hito» pasó a llamarse **«Evento»** (0026).

### 19.3 Reglas

- Una **actividad con tareas vinculadas no se borra** (disparador con mensaje claro): un `ON DELETE SET NULL` en cascada chocaría con «una tarea aprobada es historia».
- En una **gestión archivada** todo es solo lectura.
- **Desde un día** del calendario se puede **crear una actividad** o **asignar una tarea**. La tarea pertenece a un **período**: el que contiene ese día, o si no el activo; el formulario deja elegir entre los períodos por roles.
- **Avisos**: `actividad_nueva` (opcional) al crearla y `actividad_recordatorio` (opcional) **la víspera**; ambos respetan el alcance de la actividad. Una «selección» encola su aviso cuando ya tiene destinatarias.

## Proceso 20 · Avisos (la campana) y correos

**Objetivo.** Que cada persona sepa lo que le toca sin tener que buscarlo, sin que la información se invente aparte.

**Pantallas.** La **campana** (cabecera en celular; en computadora «Avisos» en el menú) · **Preferencias** de aviso (Mi cuenta) · administración: **Estado de los correos**.

### 20.1 Una cola, dos canales

Todo aviso nace en **una sola cola** (`notificaciones`). De ahí salen **dos canales independientes**:

- **La campana** (en la aplicación): siempre se crea, incluso para quien no tiene correo.
- **El correo**: se decide **al enviar** (`notif_reclamar()`): se omite si la persona no tiene correo (`sin_correo`) o si es opcional y la persona lo apagó (`preferencia`).

Lo que llega por correo **es la misma información** que en la campana: no se inventan avisos aparte.

### 20.2 El catálogo de avisos (`notif_tipos`: 20 tipos)

| Categoría | Tipo | Esencial |
|---|---|---|
| Tareas | Tarea asignada · Tarea colectiva asignada · Cambios en una tarea · **Tarea por vencer** (opcional) · Tarea vencida · **Entrega registrada** (opcional) · Corrección solicitada · **Tarea aprobada** (opcional) · **Tarea bloqueada** (opcional) | Los no marcados «opcional» |
| Equipos | Incorporación a un equipo · Retiro de un equipo | Sí |
| Calificaciones | Calificación nueva · Calificación modificada · **Observación nueva** (opcional) · **Evaluaciones sin publicar** (opcional) | Las dos primeras |
| Actividades | **Actividad nueva** · **Actividad de mañana** · **Cambio de estado** (todos opcionales) | No |
| Cuenta | Solicitud de acceso · Acceso aprobado | Sí |

**Esenciales**: no se pueden apagar y el servidor lo impide (`guardar_preferencias_notif`, todo o nada). **Opcionales**: desde 0057 vienen **encendidos por correo** y cada persona apaga los que no quiere.

Cada tipo declara: categoría, si es esencial, **a qué roles va**, qué **claves de datos** admite (lista blanca; **nunca notas ni comentarios en los datos**), cuáles son obligatorias y a qué **pestaña lleva** según el rol de quien lo recibe.

### 20.3 Cómo nace un aviso (`notif_emitir`)

`notif_emitir(tipo, destinatarios[], datos, ref_tipo, ref_id, evento, actor, despues)`: **no lanza errores** a quien lo llama; **deduplica** (`tipo:ref:evento:destinatario`, único), **excluye al actor** (quien hizo el cambio no se avisa a sí mismo), rechaza destinatarios desconocidos o sin acceso aprobado y roles que el tipo no admite, **filtra las claves** de `datos` y recorta el texto a 500 caracteres. Los fallos van a `notificaciones_eventos` (append-only). Los avisos de equipos y notas se enganchan a las **tablas de eventos** (no a las de negocio): un hecho = un aviso (una tarea individual aprobada notifica solo `tarea_aprobada`; una de equipo aprobada, solo `calificacion_nueva`).

**Avisos programados** (trabajos `pg_cron`): `notif_recordatorios` (diario 11:00: tareas por vencer, actividades de mañana), `notif_recordatorios_equipos` (diario 11:05), `notif_mantenimiento` (diario 11:30; borra eventos de aviso con más de 90 días) y `notif_enviar` (cada 5 minutos; dispara la función de envío).

### 20.4 La campana (qué hace la persona)

1. Toca la campana. Si hay avisos sin leer, un número rojo.
2. Se abre el panel **Avisos**, agrupados en **Hoy / Ayer / Esta semana / Antes**, con **icono por categoría** (tareas, calificaciones, equipos, actividades, cuenta) y cuánto hace que ocurrieron. **Sin leer** = fondo teñido + título en negrita + texto para lectores (nunca solo el color).
3. **Tocar un aviso** lo marca como leído y **abre su destino** (por ejemplo la tarea). Hay **chips de categoría**, **Marcar todo como leído** (también por categoría), **Ver más** y **Preferencias**.
4. El contador se actualiza **en vivo** (tiempo real) y al volver a la pestaña; un aviso programado a futuro aparece cuando llega su hora.

**Enlaces de aviso**: `user.html|secretario.html|admin.html#ir/<pestaña>[/<tipo>/<id>]`; el portal elegido es el del **rol real** del destinatario. Si la persona no tiene sesión, el destino se **recuerda** y se abre tras iniciar sesión.

### 20.5 Preferencias

Mi cuenta → Preferencias (o desde el panel de avisos): una lista de los tipos **opcionales** con interruptor de correo. Los esenciales se muestran como «siempre» y no se pueden cambiar.

### 20.6 Envío de correos (para operación)

- **Función** `enviar-notificaciones` (la lógica pura está en `nucleo.mjs`, probada en Node; `index.ts` solo la conecta).
- **`CORREO_MODO`**: `apagado` (**por defecto**: la cola no se toca), `prueba` (marca «simulado» y no envía nada real; opcionalmente solo a `CORREO_PRUEBA_DESTINO`) y `produccion` (envía).
- **Reintentos** a los 5, 15, 60 y 180 minutos, máximo 5; un error permanente (dirección mala) no se reintenta; marcar un aviso ya resuelto no hace nada; si el correo salió pero falló la confirmación, nunca se marca como error. El puente de Apps Script deduplica por clave (`n<id>`). **Solo `correo_estado = 'enviado'`** significa que el proveedor lo aceptó.
- **Capacidad**: el remitente es un Gmail personal vía Apps Script y llega a **~100 destinatarios por día**. Con ~25 personas, **una tarea de equipo más calificaciones publicadas pueden pasar de ~50 correos**. Si crece, hay que cambiar a un proveedor transaccional.
- **Estado de los correos** (administración, en el panel de avisos): cuántos salieron, cuántos fallaron, y por qué.
- **Correos de Auth** (confirmar, recuperar contraseña…): plantillas en `supabase/emails/`, enviados por `auth-correo` (responde de inmediato y envía en segundo plano; si esperara el envío daría `hook_timeout` y la persona no recibiría nada).
- Configuración paso a paso: `docs/configurar-correos.md`. Contrato del catálogo: `docs/notificaciones-contrato.md`.

### 20.7 Un tipo de aviso nuevo (para quien desarrolle)

Una fila en `notif_tipos`, una entrada en `AVISOS` (`plantillas.mjs`, luego `node tools/generar-correos.mjs`) y una en `Notif.TIPOS`. `tools/pruebas/correo.mjs` falla si alguno de los tres no coincide.

## Proceso 22 (parte) · Banco de imágenes

**Objetivo.** Un lugar común con los **enlaces** a las fotos y videos de cada evento.

**Pantalla.** **Banco de imágenes** (menú: «Imágenes»; administración: Operaciones; miembro y secretaría: junto a Mis tareas).

### Actividades

1. **Ver y buscar**: título, descripción, evento y enlace (Drive, Dropbox…), con búsqueda y filtros (acción bancoFiltrar), agrupado por el rol de quien lo subió.
2. **Añadir**: título, descripción, evento y **enlace `http(s)`** (inválidos se rechazan: la base lo exige con CHECK y el cliente lo valida).
3. **Editar o borrar**: quien lo subió o la administración.
4. Abrir un enlace usa `rel="noopener noreferrer"`.

### Reglas (RLS de 0058)

- **No se guardan archivos**, solo enlaces.
- **Lee** toda persona con acceso aprobado (decisión **provisional**: el mensaje del dueño llegó cortado; si debe limitarse por rol o distrito, se cambia la política `banco_leer`).
- **Añade** cualquier persona aprobada en una gestión no archivada.
- `creado_por`, `gestion_id`, `rol_id` y `distrito` los **fija el servidor** (`banco_fijar`); el rol de quien sube es lo que agrupa «las imágenes de Fotografía».
