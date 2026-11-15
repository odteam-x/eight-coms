# 03 · Acceso, cuenta y bienvenida (procesos 1 a 4)

## Proceso 1 · Registro y aprobación de acceso

**Objetivo.** Que una persona nueva pueda pedir acceso sin poder darse ningún permiso, y que la administración decida quién entra.

**Actores.** La persona nueva; la administración.

**Pantallas.** `index.html` (pestaña **Crear cuenta**) · Admin → **Personas** (y el bloque «Requiere atención» del Panel).

### Actividades paso a paso

1. **La persona abre el portal** (`eight-coms.vercel.app`) y elige **Crear cuenta**. Si no hay ninguna gestión abierta, el registro está cerrado (la página lo comprueba con la función pública `hay_gestion_abierta()`, que devuelve un único verdadero/falso).
2. **Escribe nombre y correo, elige su distrito (o «Invitado externo») y el rol con el que quiere que la evalúen (opcionalmente un segundo rol; máximo 2), y pone una contraseña.** Una barra de seguridad indica si la contraseña es débil o fuerte (usa los mismos niveles de color y siempre escribe el nivel en texto).
3. **Se crea la cuenta en Auth.** Un disparador de la base (`on_auth_user_created`) crea la fila de `profiles` con valores **fijos**: `tipo_miembro = 'miembro'`, `es_admin = false`, `distrito`, `rol_id` vacíos y `aprobado = false`. Lo que la persona eligió se guarda **validado** como **solicitud** (`solicitud_distrito`, `solicitud_rol_id`, `solicitud_rol2_id`; migración 0070). **Nada de eso da permisos.** El nombre es lo único que se toma de los datos de la cuenta; el resto se ignora.
4. **Llega un correo de confirmación** («Confirmar mi correo»). Lo arma y envía la función `auth-correo` (responde 200 de inmediato y envía en segundo plano, con 3 intentos). Si no llega, la persona debe mirar Spam.
5. **La persona confirma el correo.** Hasta aquí tiene cuenta pero **no puede entrar**: al intentarlo, el portal cierra la sesión y la devuelve a `index.html?pendiente=1` con el aviso «Tu cuenta está pendiente de aprobación por el administrador».
6. **La administración se entera**: se genera un aviso `solicitud_acceso` (esencial, campana y correo) y el Panel muestra «Accesos pendientes» en **Requiere atención**.
7. **La administración abre Personas y accesos.** Arriba está la tarjeta **Solicitudes de acceso** (y en el menú, un número junto a «Personas»), con lo que cada persona pidió. **Aprobar** aplica la solicitud (distrito, rol principal y segundo rol) a lo que esté vacío, y la persona entra **ya configurada**. Si quiere cambiar algo, abre la persona (pestaña **Gestión**) antes de aprobar: lo que fije no se pisa. **Secretaría de distrito y administración nunca se piden al registrarse**: las asigna siempre la administración. Cada cambio de privilegios queda en la **auditoría**.
8. **La persona recibe el aviso** `acceso_aprobado` (esencial) y ya puede entrar.

### Reglas y bordes

- Registrarse **no da ningún permiso**; aprobar es siempre un acto de la administración.
- Si un correo se escribe mal, el aviso de confirmación no llega; la persona debe registrarse de nuevo con el correo correcto; la administración puede borrar la cuenta pendiente desde Personas → Gestión. No hay un botón de «reenviar confirmación» en el portal.
- La seguridad del bloqueo es doble: el frontend bloquea con `aprobado === false` explícito, y **la base de datos** impide que cualquiera que no sea administración cambie esos campos.
- Un alta puede quedar «sin rol» o «sin distrito»: el Panel lo muestra en **Datos por revisar**.

### Qué puede salir mal

| Situación | Qué ve la persona | Qué hacer |
|---|---|---|
| No llega el correo | Nada | Revisar Spam; si no llega, registrarse de nuevo con el correo correcto (el portal no tiene un botón de reenvío; la administración puede borrar la cuenta pendiente desde Personas → Gestión) |
| Intenta entrar sin aprobación | Aviso de «pendiente de aprobación» | Esperar; la administración aprueba desde Personas |
| Registro cerrado | Mensaje de que no hay gestión abierta | La administración debe abrir una gestión |

## Proceso 2 · Inicio de sesión y recuperación de contraseña

**Objetivo.** Entrar de forma segura y recuperar el acceso sin intervención de la administración.

**Pantalla.** `index.html` (pestaña **Entrar**).

### Iniciar sesión

1. La persona escribe **correo y contraseña** y toca **Ingresar al portal**. El botón muestra un indicador dentro de sí mismo mientras trabaja.
2. El portal pide la sesión a Supabase y lee el perfil. Según el perfil, **la página de destino se elige por el rol real**: `admin.html` (administración), `secretario.html` (secretaría; un miembro también puede entrar ahí si su tipo lo permite) o `user.html` (miembro).
3. Si el acceso está pendiente, se cierra la sesión y se explica (proceso 1).
4. Los errores (clave incorrecta, correo sin confirmar) se muestran en una caja de alerta **y** marcan el campo con `aria-invalid`: el color nunca es el único indicador.
5. Si la persona llegó desde un enlace de aviso (`#ir/<pestaña>/…`), el portal **recuerda el destino** durante el inicio de sesión y la lleva directo a la pantalla del aviso.

### Recuperar la contraseña

1. En **¿Olvidaste tu contraseña?** la persona escribe su correo.
2. Recibe un correo con un **código de verificación de 6 cifras** (y un enlace). Lo escribe y elige la nueva contraseña.
3. La nueva contraseña debe ser **distinta de la actual**; si pone la misma, el portal lo explica en lugar de dar un error técnico.
4. Si la persona llega por el enlace del correo, Supabase entrega el token en la dirección; `index.html` detecta el evento `PASSWORD_RECOVERY` y cambia el formulario de entrada por el de nueva contraseña.

### Cambiar la contraseña estando dentro

En **Mi cuenta → Seguridad**: contraseña nueva y repetirla (mínimo 8 caracteres, distinta de la actual).

### Pantalla de entrada: comportamiento

- Es **una sola página** con dos paneles (Entrar / Crear cuenta); `#registro` en la dirección abre el registro.
- En escritorio cabe en la altura de la ventana sin desplazarse; en celular una banda de marca arriba y el formulario debajo.
- Los campos son de 16 px (si fueran menores, iOS haría zoom al enfocar).
- El pie de derechos queda **al final de la página**.

## Proceso 3 · Bienvenida y primeros pasos

**Objetivo.** Que una persona nueva entienda qué hacer primero, y que quien ya existía conozca solo lo que cambió.

**Pantallas.** Ventana de bienvenida (se abre sola la primera vez) · tarjeta «Primeros pasos» o «Novedades» en **Inicio / Panel** · Mi cuenta → App (para repasarla).

### Cómo funciona

- El asistente es **por rol funcional** (creator/miembro, secretaría, administración). El **servidor** fija el perfil del asistente según el rol real de la persona (`bienvenida_guardar`), no el cliente.
- **Persona nueva** → ve «Te damos la bienvenida» con 5 pasos. **Persona que ya existía** cuando se creó el asistente → ve «Novedades» (solo lo que cambió); las personas anteriores quedaron «omitidas» para no abrirles el asistente de golpe.
- Tiene **progreso** («Paso 1 de 5 · 0 hechos») y **reanuda donde se quedó**. Algunos pasos se dan por hechos solos (foto de perfil, preferencias).
- Cada paso tiene un botón que **lleva a la pantalla** correspondiente.

### Los pasos

**Miembro:** 1) Conoce tu rol (descripción, responsabilidades y competencias) · 2) Pon tu foto y revisa tu nombre (Mi cuenta → Perfil) · 3) Cuéntanos qué rol te gustaría hacer (preferencias) · 4) Mira tus fechas (Calendario) · 5) Así se entrega un trabajo (Mis tareas).

**Secretaría:** 1) Conoce tu rol · 2) Foto y nombre · 3) Conoce a tu distrito · 4) Asigna tu primera tarea · 5) Sigue a tu distrito (Seguimiento).

**Administración:** Revisa los períodos · Describe los roles y sus perfiles · Aprueba accesos y asigna rol y distrito · Haz tu primera evaluación · Mira el seguimiento global.

**Novedades** (para quienes ya existían): Mi cuenta en pestañas y con preferencias de rol · Nueva tarea en tres pasos (secretaría/administración) · Actividades para personas de tu distrito · Seguimiento de tu distrito · Reportes de tu distrito · Historial de todos los períodos (Mi perfil → Períodos).

### Acciones de la persona

- **Hecho, seguir** marca el paso y avanza. **Ahora no** cierra sin marcar. El avance queda guardado y la tarjeta en Inicio dice «3 de 5 listos. Sigue donde lo dejaste» con el botón **Continuar**.
- La bienvenida se puede **repasar** desde Mi cuenta → App; la administración puede reiniciarla (`bienvenida_reiniciar`).

### Detalle conocido

En celular, el botón de cerrar de la ventana tapa un poco la última letra del título «Te damos la bienvenida».

## Proceso 4 · Mi cuenta: perfil, seguridad, rol y preferencias, app

**Objetivo.** Que cada persona gestione lo suyo sin pedir nada a la administración, salvo lo que solo ella decide (tipo de acceso, distrito, rol).

**Pantalla.** **Mi cuenta** (computadora: el nombre al pie del menú; celular: Más → tu nombre, o el último ítem de la barra inferior). Arriba la foto, el nombre y las etiquetas (tipo de acceso y distrito); debajo, **cuatro pestañas** (el portal recuerda la última que usaste):

| Pestaña | Qué hay |
|---|---|
| **Perfil** | Nombre (con **Guardar**), correo, tipo de acceso y distrito (solo lectura: los asigna la administración), **foto** el **fondo de la tarjeta** (siete patrones de la marca, o «Auto») que ven quienes pueden abrir tu perfil, y **Mi gafete** (tu identificación con QR) |
| **Mi rol** | Tu rol principal con descripción, responsabilidades y requisitos; tu rol secundario si lo tienes; y **«Mi rol y mis preferencias»**: ordena con flechas los roles que te gustaría hacer y marca uno como predeterminado (la estrella solo en roles que tengas habilitados). **No se muestra a la administración** (no se evalúa) |
| **Seguridad** | Cambiar la contraseña |
| **App y ayuda** | **Tema** (oscuro, claro o rosa; se recuerda en ese dispositivo), **Instalar en tu celular**, la bienvenida/novedades, la **ayuda y manual de uso** y **Cerrar sesión** |

### Foto de perfil

- **Cambiar foto**: cualquier imagen del teléfono o computadora, de cualquier tamaño. El portal la **recorta a cuadrado y la reduce** (queda de pocos KB) y la sube al bucket `avatars` (lectura pública, escritura solo en la carpeta propia, tope de 2 MB).
- Si no hay foto o la imagen falla, se muestran las **iniciales sobre fondo liso**. Nadie pinta la foto por su cuenta: hay un componente único.

### Preferencias de aviso

En **Mi cuenta → Preferencias** (o desde el panel de avisos → «Preferencias»): se elige qué avisos **opcionales** llegan por correo. **Desde la migración 0057 todos están encendidos por defecto** y cada persona apaga los que no quiera. Los **esenciales** (tarea asignada, cambios, vencida, corrección solicitada, calificación, equipos, acceso) **no se pueden apagar** y el servidor lo impide.

### Instalar como app

- **Android (Chrome/Edge)**: Mi cuenta → App → *Instalar en tu celular*, o el menú ⋮ → «Instalar app».
- **iPhone (solo Safari)**: Compartir → «Añadir a pantalla de inicio» (no hay API; la fila lo explica).
- **PC (Chrome/Edge)**: el icono de instalar de la barra de direcciones.
- La app instalada **necesita internet**: sin conexión muestra solo una pantalla «Sin conexión» con un botón para reintentar. El *service worker* **no guarda en caché** datos ni scripts, para no mostrar versiones viejas ni datos de otra sesión.

### Tema

Tres temas: **oscuro** (por defecto), **claro** y **rosa**. El cambio se aplica antes de pintar (sin parpadeo) y se guarda por dispositivo. Todos respetan el contraste mínimo (comprobado por `tools/contraste.js`).

### Reglas

- El correo, el tipo de acceso y el distrito aparecen **solo para que se vean**; los asigna la administración.
- La contraseña nueva tiene que ser distinta de la actual.
