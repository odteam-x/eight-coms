# Configurar los correos (Supabase + Gmail)

Plantillas: `supabase/emails/` (se regeneran con `node tools/generar-correos.mjs`).
Asuntos: `supabase/emails/asuntos.json`.

## 1. Contraseña de aplicación de Gmail (la creas tú)
1. Entra a la cuenta de Gmail que enviará los correos → https://myaccount.google.com/security
2. Activa **Verificación en 2 pasos** (obligatoria).
3. Busca **Contraseñas de aplicaciones** → nombre «EIGHT CREATORS LABs» → **Crear**.
4. Copia las 16 letras (sin espacios). No las pegues en un chat ni en el repositorio.

## 2. Correos de acceso (Supabase Auth → SMTP propio)
Dashboard del proyecto `owfmorjlymoxqrzhadnf` → **Authentication → Emails → SMTP Settings** → activar *Enable custom SMTP*:

| Campo | Valor |
|---|---|
| Sender email | el Gmail (debe ser el mismo de la contraseña) |
| Sender name | EIGHT CREATORS LABs |
| Host | smtp.gmail.com |
| Port | 465 |
| Username | el Gmail completo |
| Password | las 16 letras |

Guardar. Subir el límite en **Authentication → Rate Limits → emails per hour** (por defecto es muy bajo con SMTP propio).

## 3. Plantillas de acceso
**Authentication → Emails → Templates**. Para cada una: pegar el asunto y el contenido del archivo.

| Plantilla de Supabase | Archivo | Asunto |
|---|---|---|
| Confirm signup | `auth/confirmacion.html` | Confirma tu correo en EIGHT CREATORS LABs |
| Reset password | `auth/recuperacion.html` | Restablece tu contraseña |
| Magic link | `auth/enlace_magico.html` | Tu enlace para entrar |
| Invite user | `auth/invitacion.html` | Te invitaron a EIGHT CREATORS LABs |
| Change email address | `auth/cambio_correo.html` | Confirma tu nuevo correo |
| Reauthentication | `auth/reautenticacion.html` | Tu código de confirmación |

## 4. URLs
**Authentication → URL Configuration**: *Site URL* `https://eight-coms.vercel.app`; en *Redirect URLs* añade `https://eight-coms.vercel.app/**` (y la de la rama si pruebas ahí).

## 5. Avisos del sistema (siguiente paso)
La migración 0019 (cola de avisos + recordatorios diarios) y la Edge Function `enviar-notificaciones` usan estas variables, que se guardan en **Edge Functions → Secrets** (no en el repositorio): `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `SITIO_URL`.

## 6. Probar
Reset password con un correo real; debe llegar con la plantilla nueva. Revisa también la carpeta de spam la primera vez.

## 7. Puente de Google Apps Script (envío desde tu cuenta de Google)
Gmail SMTP desde las funciones de Supabase puede ser bloqueado por Google (error 534). El puente evita contraseñas y bloqueos por IP: un script dentro de tu cuenta recibe cada aviso y lo envía con tu Gmail.

1. https://script.google.com → **Nuevo proyecto**. Borra el contenido y pega `supabase/apps-script/Code.gs`.
2. **Configuración del proyecto** (engranaje) → **Propiedades del script** → **Agregar propiedad**: nombre `SECRETO`, valor una clave larga al azar (30+ caracteres, letras y números). Guárdala: la usarás otra vez en el paso 4.
3. **Implementar → Nueva implementación** → tipo **Aplicación web** → *Ejecutar como*: **Yo** → *Quién tiene acceso*: **Cualquier persona** → **Implementar**. Autoriza los permisos (Google avisará que la app no está verificada: *Configuración avanzada → Ir a … (no seguro)*; es tu propio script). Copia la **URL de la aplicación web** (termina en `/exec`).
4. En Supabase → **Edge Functions → Secrets** añade:
   - `APPS_SCRIPT_URL` = la URL `/exec`
   - `APPS_SCRIPT_SECRET` = la misma clave del paso 2
5. Prueba: la función usa el puente en cuanto existen esos dos secretos (y deja de usar SMTP).

Límite de Google: ~100 destinatarios por día en una cuenta personal, ~1500 en Workspace. Quien tenga la URL y la clave puede enviar correos desde tu cuenta: no las compartas.

## 8. Correos de acceso por el mismo puente (Send Email Hook)
El SMTP de Supabase Auth con Gmail falla igual que desde las funciones («Error sending magic link email»). La función `auth-correo` recibe esos correos y los envía por el puente. La app restablece la contraseña con un **código de 6 cifras** (`signInWithOtp` + `verifyOtp`), así que la plantilla «Magic link» muestra el código.

1. Supabase → **Authentication → Auth Hooks** (o *Hooks*) → **Send Email** → *Enable* → tipo **HTTPS** → URL `https://owfmorjlymoxqrzhadnf.supabase.co/functions/v1/auth-correo`.
2. Pulsa **Generate secret** y copia el valor `v1,whsec_…`. **Create/Save** el hook.
3. En **Edge Functions → Secrets** añade `SEND_EMAIL_HOOK_SECRET` con ese valor.
4. Prueba pidiendo el código de restablecimiento desde el login.

Con el hook activo, el SMTP y las plantillas de *Authentication → Emails* dejan de usarse para estos correos (no hace falta pegarlas). La plantilla vive en `supabase/functions/auth-correo/plantillas.mjs`, copia de `enviar-notificaciones/plantillas.mjs` (`node tools/generar-correos.mjs` las sincroniza).

## 9. Modo de envío (0040): por defecto NO se envía nada
Desde la migración 0040 la función `enviar-notificaciones` **no manda correos a nadie** mientras no se lo pidas. Variable `CORREO_MODO` (Edge Functions → Secrets):

| Valor | Qué hace |
|---|---|
| *(vacío / ausente)* o `apagado` | No toca la cola: responde 503 y los avisos esperan. **Es lo que pasa tras desplegar si olvidas la variable.** |
| `prueba` | Reclama avisos, arma y valida cada correo y lo marca **`simulado`**: ningún correo real sale. Con `CORREO_PRUEBA_DESTINO=tu@correo` (y un proveedor) cada correo se manda **solo a esa dirección**, con asunto `[PRUEBA → real@…]`, y sigue contando como simulado. |
| `produccion` | Envía al destinatario real. Exige proveedor (`APPS_SCRIPT_URL` + `APPS_SCRIPT_SECRET`, o `GMAIL_USER` + `GMAIL_APP_PASSWORD`) y `SITIO_URL` https. |

Resto de variables: `SITIO_URL` (por defecto `https://eight-coms.vercel.app`; los enlaces del correo salen de ahí), `APPS_SCRIPT_URL` (debe ser `https://script.google.com/…`), `APPS_SCRIPT_SECRET`. En el script de Apps Script, propiedades opcionales: `DOMINIOS_PERMITIDOS` (p. ej. `gmail.com`) para que mientras pruebas solo pueda escribir a esos dominios.
La función valida la configuración y la devuelve en la respuesta (`errores`); no guardes ni pegues secretos en el repositorio, el navegador ni el chat.

**Orden recomendado para la primera vez:** `prueba` + `CORREO_PRUEBA_DESTINO` (comprobar que llega y cómo se ve) → revisar «Estado de los correos» en el panel de avisos de la administración → `produccion`.
Ojo: los avisos pendientes que existían antes de 0040 salen en cuanto pases a `produccion`; si no quieres eso, revisa la cola antes.

## 10. Estado de cada correo
`notificaciones.correo_estado`: `pendiente` → `enviado` | `omitido` (sin correo registrado, o la persona apagó ese aviso opcional: sigue en la campana) | `simulado` (modo prueba: **no salió ningún correo**) | `fallido` (5 intentos agotados o dirección inválida). Reintentos a los 5, 15, 60 y 180 minutos. Cada intento queda en `notificaciones_eventos`. La administración ve el resumen de 7 días en **Avisos → Preferencias → Estado de los correos**.
Un correo «registrado» no es un correo enviado: solo `enviado` significa que el proveedor lo aceptó. Que llegue a la bandeja depende de Gmail/Google (cuotas: ~100 destinatarios/día en cuenta personal).

## 11. Enlaces de los correos
`https://…/<portal>.html#ir/<pestaña>/<objeto>/<id>`. El portal sigue exigiendo sesión y la RLS decide qué se ve; si abres el enlace sin sesión, se recuerda la pestaña (solo ese fragmento, en `sessionStorage`) y se abre al entrar. El portal sale del rol real de quien recibe el correo.

## 12. Cómo probarlo
Sin credenciales: `cd tools/pruebas && npm run sql && npm run correo` (cola, destinatarios, preferencias, duplicados, errores y reintentos con un proveedor simulado). Eso prueba la **lógica**; la entrega real por Gmail solo se puede comprobar con tus credenciales en modo `prueba` + `CORREO_PRUEBA_DESTINO`.
