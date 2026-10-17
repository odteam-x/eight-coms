// Genera las plantillas de correo (supabase/emails/*.html) con la línea gráfica del sitio.
//   node tools/generar-correos.mjs
//
// Un correo no puede usar var(--token) ni cargar tipografías: los colores van en línea y
// salen de los tokens de shared.css (modo oscuro). Cada par texto/fondo está medido:
//   texto sobre tarjeta 15.8 · cyan-200 12.6 · texto suave 7.7 (6.8 sobre fila) · navy sobre coral 5.4
// Dos familias de plantillas:
//   auth/   → Supabase Auth (Go templates: {{ .ConfirmationURL }}, {{ .Email }}…). Se pegan
//             en Authentication → Emails → Templates.
//   avisos/ → la Edge Function «enviar-notificaciones» (marcadores {{nombre}}, {{titulo}}…).
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'emails');
import { AUTH, AVISOS, correo } from '../supabase/functions/enviar-notificaciones/plantillas.mjs';


const indice = { auth: {}, avisos: {} };
for (const [grupo, tabla] of [['auth', AUTH], ['avisos', AVISOS]]) {
  mkdirSync(join(RAIZ, grupo), { recursive: true });
  for (const [clave, d] of Object.entries(tabla)) {
    writeFileSync(join(RAIZ, grupo, `${clave}.html`), correo(d));
    indice[grupo][clave] = d.asunto;
  }
}
// La función de correos de acceso (auth-correo) lleva su propia copia de las plantillas.
mkdirSync(join(RAIZ, '..', 'functions', 'auth-correo'), { recursive: true });
copyFileSync(join(RAIZ, '..', 'functions', 'enviar-notificaciones', 'plantillas.mjs'), join(RAIZ, '..', 'functions', 'auth-correo', 'plantillas.mjs'));
writeFileSync(join(RAIZ, 'asuntos.json'), JSON.stringify(indice, null, 2) + '\n');
console.log(`ok: ${Object.keys(AUTH).length} de acceso, ${Object.keys(AVISOS).length} avisos → supabase/emails/`);
