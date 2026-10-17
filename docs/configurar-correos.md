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
