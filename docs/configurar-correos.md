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
