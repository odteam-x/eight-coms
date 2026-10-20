# Google Wallet para los gafetes (Android)

El botón **Añadir a Google Wallet** (en «Mi gafete») crea un pase con la foto, la insignia, el patrón y el QR de verificación.
Funciona con la función `gafete-wallet` y necesita una cuenta de emisor de Google. **Es gratis**; solo hay que darla de alta una vez.
Mientras no esté configurado, el botón avisa «Google Wallet aún no está activado» y no rompe nada.

## 1. Alta (una sola vez, ~20 minutos)

1. **Emisor.** Entra a <https://pay.google.com/business/console> con la cuenta de Google del club y crea la cuenta de empresa. En
   **Google Wallet API** copia el **ID del emisor** (un número largo, p. ej. `3388000000012345678`).
2. **API.** En <https://console.cloud.google.com> crea un proyecto (o usa uno) y activa **Google Wallet API**.
3. **Cuenta de servicio.** En *IAM y administración → Cuentas de servicio* crea una (p. ej. `gafete-wallet`) y, en *Claves*, **Agregar clave → JSON**.
   Se descarga un archivo `.json`: es un secreto, no lo subas al repositorio ni lo pegues en el chat.
4. **Permiso.** Vuelve a la consola de Google Wallet → *Usuarios* → **Invitar** el correo de la cuenta de servicio (`...@...iam.gserviceaccount.com`) con rol **Desarrollador**.

## 2. Secretos en Supabase

*Edge Functions → Secrets* (igual que `CORREO_MODO`):

| Secreto | Valor |
|---|---|
| `GOOGLE_WALLET_ISSUER_ID` | el ID del emisor (solo números) |
| `GOOGLE_WALLET_SA_JSON` | el contenido **completo** del archivo `.json` de la cuenta de servicio |
| `SITIO_URL` | opcional; por defecto `https://eight-coms.vercel.app` |

Después, desplegar la función `gafete-wallet` (la guarda el repositorio en `supabase/functions/gafete-wallet`).

## 3. Modo de pruebas y publicación

Al principio la cuenta está en **modo demo**: solo pueden guardar el pase las cuentas de Google añadidas como **usuarios de prueba**
(consola de Google Wallet → *Prueba*), y el pase muestra «[TEST ONLY]». Para abrirlo a todos, en la misma consola solicita **acceso de
publicación** (revisan que el pase cumpla las guías; las imágenes del pase ya siguen sus medidas: logo 660×660, imagen 1032×812, sin texto).

## Cómo funciona

1. El portal dibuja la imagen del pase en el navegador y la sube a `avatars/<uid>/wallet-hero.jpg` (la carpeta de la propia persona).
2. Llama a `gafete-wallet` con su sesión. La función lee **solo el gafete de quien llama** y sus datos públicos (`verificar_gafete`).
3. Crea o actualiza el pase en la API de Google Wallet y devuelve el enlace firmado (`https://pay.google.com/gp/v/save/…`).
4. El QR del pase es el mismo `https://…/v/<token>` del gafete: si se regenera el código del gafete, hay que volver a añadir el pase.
