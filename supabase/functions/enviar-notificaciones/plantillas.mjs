// Fuente única de las plantillas. La importan la Edge Function (Deno) y tools/generar-correos.mjs (Node).
export const SITIO = 'https://eight-coms.vercel.app';
// Isotipo de CELIDER 08 fijado a un commit del repositorio público: no depende de qué versión sirva producción.
const LOGO = 'https://raw.githubusercontent.com/odteam-x/eight-coms/5d83153/logo.png';

const C = {
  bg: '#061326', tarjeta: '#0A1D38', fila: '#10264A', texto: '#F3F8FF', texto2: '#A7E8FF',
  suave: '#8FB3D1', trazo: '#1B3A66', coral: '#FF6063', navy: '#002247',
};
const FRANJA = ['#002247', '#005286', '#0087F1', '#00CBFF', '#A7E8FF', '#FF6063'];
const FUENTE_TITULO = "'Barlow Condensed','Arial Narrow','Helvetica Neue',Arial,sans-serif";
const FUENTE = "'Source Sans 3','Segoe UI',Helvetica,Arial,sans-serif";

/** Esqueleto común. `filas` = [[etiqueta, valor]] para el recuadro de detalle (opcional). */
export function correo({ preheader, titulo, parrafos, filas = [], boton, nota }) {
  const franja = FRANJA.map(c => `<td style="background:${c};height:6px;font-size:0;line-height:0">&nbsp;</td>`).join('');
  const detalle = filas.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;background:${C.fila};border-radius:16px">${filas.map(([k, v], i) => `
        <tr><td style="padding:14px 20px;${i ? `border-top:1px solid ${C.trazo};` : ''}font-family:${FUENTE};font-size:14px;color:${C.suave};width:38%;vertical-align:top">${k}</td>
        <td style="padding:14px 20px;${i ? `border-top:1px solid ${C.trazo};` : ''}font-family:${FUENTE};font-size:16px;font-weight:600;color:${C.texto};vertical-align:top">${v}</td></tr>`).join('')}
      </table>` : '';
  const cta = boton
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="background:${C.coral};border-radius:999px">
        <a href="${boton.url}" style="display:inline-block;padding:15px 32px;font-family:${FUENTE};font-size:16px;font-weight:700;color:${C.navy};text-decoration:none;border-radius:999px">${boton.texto}</a></td></tr></table>
       <p style="margin:0 0 24px;font-family:${FUENTE};font-size:13px;line-height:1.5;color:${C.suave}">Si el botón no funciona, copia este enlace en tu navegador:<br><a href="${boton.url}" style="color:${C.texto2};word-break:break-all">${boton.url}</a></p>`
    : '';
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light">
<title>${titulo}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.tarjeta};border-radius:28px;overflow:hidden">
    <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${franja}</tr></table></td></tr>
    <tr><td style="background:${C.navy};padding:28px 36px 26px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:14px"><img src="${LOGO}" width="52" height="52" alt="CELIDER 08" style="display:block;border:0;border-radius:50%"></td>
        <td style="font-family:${FUENTE_TITULO};font-size:20px;font-weight:700;letter-spacing:.01em;color:#FFFFFF;text-transform:uppercase;line-height:1.1">Eight Creators Labs<br><span style="font-family:${FUENTE};font-size:12px;font-weight:600;letter-spacing:.04em;color:${C.texto2};text-transform:none">CELIDER 08 Santiago</span></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:32px 36px 8px">
      <h1 style="margin:0 0 16px;font-family:${FUENTE_TITULO};font-size:36px;line-height:1.05;font-weight:700;letter-spacing:-.01em;color:${C.texto}">${titulo}</h1>
      ${parrafos.map(p => `<p style="margin:0 0 16px;font-family:${FUENTE};font-size:16px;line-height:1.55;color:${C.texto}">${p}</p>`).join('\n      ')}
      ${detalle}${cta}
      ${nota ? `<p style="margin:0 0 24px;font-family:${FUENTE};font-size:14px;line-height:1.5;color:${C.suave}">${nota}</p>` : ''}
    </td></tr>
    <tr><td style="padding:20px 36px 28px;border-top:1px solid ${C.trazo}">
      <p style="margin:0;font-family:${FUENTE};font-size:12px;line-height:1.5;color:${C.suave}">Este mensaje lo envía el portal EIGHT CREATORS LABs de CELIDER 08 Santiago. No respondas a este correo: nadie lo lee.<br><a href="${SITIO}" style="color:${C.texto2}">${SITIO.replace('https://', '')}</a></p>
    </td></tr>
  </table>
</td></tr></table></body></html>
`;
}

export const AUTH = {
  confirmacion: {
    asunto: 'Confirma tu correo en EIGHT CREATORS LABs',
    preheader: 'Un clic para activar tu registro.',
    titulo: 'Confirma tu correo',
    parrafos: ['Gracias por registrarte. Confirma que este correo es tuyo para terminar tu solicitud.', 'Después, la administración revisará y aprobará tu acceso al portal. Te avisaremos por correo.'],
    boton: { texto: 'Confirmar mi correo', url: '{{ .ConfirmationURL }}' },
    nota: 'Si no fuiste tú, ignora este mensaje: no se creará nada.',
  },
  recuperacion: {
    asunto: 'Restablece tu contraseña',
    preheader: 'El enlace caduca pronto.',
    titulo: 'Restablece tu contraseña',
    parrafos: ['Recibimos una solicitud para cambiar la contraseña de <b>{{ .Email }}</b>.', 'Pulsa el botón y elige una nueva. El enlace es de un solo uso y caduca en una hora.'],
    boton: { texto: 'Elegir nueva contraseña', url: '{{ .ConfirmationURL }}' },
    nota: 'Si no pediste el cambio, ignora este mensaje: tu contraseña sigue igual.',
  },
  // La app entra y restablece contraseña con un CÓDIGO de 6 cifras (signInWithOtp + verifyOtp), no con un enlace.
  enlace_magico: {
    asunto: 'Tu código de verificación: {{ .Token }}',
    preheader: 'Escríbelo en el portal. Caduca en una hora.',
    titulo: 'Tu código de verificación',
    parrafos: ['Escribe este código en el portal para continuar con <b>{{ .Email }}</b>:', `<span style="display:inline-block;margin:4px 0 8px;padding:14px 28px;background:${C.fila};border-radius:16px;font-family:${FUENTE_TITULO};font-size:44px;font-weight:700;letter-spacing:.22em;color:${C.texto2}">{{ .Token }}</span>`, 'El código sirve una sola vez y caduca en una hora.'],
    nota: 'Si no lo pediste tú, ignora este mensaje: nadie puede entrar sin el código.',
  },
  invitacion: {
    asunto: 'Te invitaron a EIGHT CREATORS LABs',
    preheader: 'Acepta la invitación y crea tu contraseña.',
    titulo: 'Te invitaron al portal',
    parrafos: ['Te abrieron una cuenta en el portal de evaluación de CELIDER 08 Santiago.', 'Acepta la invitación y elige tu contraseña para entrar.'],
    boton: { texto: 'Aceptar la invitación', url: '{{ .ConfirmationURL }}' },
  },
  cambio_correo: {
    asunto: 'Confirma tu nuevo correo',
    preheader: 'Cambiarás el correo con el que entras.',
    titulo: 'Confirma tu nuevo correo',
    parrafos: ['Pediste cambiar el correo de tu cuenta de <b>{{ .Email }}</b> a <b>{{ .NewEmail }}</b>.'],
    boton: { texto: 'Confirmar el cambio', url: '{{ .ConfirmationURL }}' },
    nota: 'Si no fuiste tú, cambia tu contraseña de inmediato.',
  },
  reautenticacion: {
    asunto: 'Tu código de confirmación',
    preheader: 'Úsalo para confirmar el cambio.',
    titulo: 'Tu código',
    parrafos: ['Escribe este código para confirmar la acción que estás haciendo:', `<span style="display:inline-block;margin:4px 0;padding:12px 24px;background:${C.fila};border-radius:16px;font-family:${FUENTE_TITULO};font-size:36px;font-weight:700;letter-spacing:.2em;color:${C.texto2}">{{ .Token }}</span>`],
    nota: 'Si no fuiste tú, ignora este mensaje.',
  },
};

// Marcadores {{...}} los rellena la Edge Function (nucleo.mjs); los valores ya llegan escapados.
// Reglas de estas plantillas:
//   · {{nombre}} es SIEMPRE el nombre de pila de quien recibe el correo (nunca un dato del aviso).
//   · Un dato opcional va en `filas`: si no viene, la fila entera se omite (nunca se ve «—» suelto).
//   · Los párrafos y el asunto solo usan datos que el catálogo (notif_tipos.requeridas) garantiza.
//   · Ningún correo lleva puntajes ni el texto de una observación de calificación: avisa y enlaza.
export const AVISOS = {
  calificacion_nueva: {
    asunto: 'Tienes una calificación nueva',
    preheader: 'Revisa tu resultado en el portal.',
    titulo: 'Tienes una calificación nueva',
    parrafos: ['Hola {{nombre}}, se publicó una calificación tuya. Por privacidad no incluimos el resultado en este correo: ábrelo en el portal con tu sesión.'],
    filas: [['Período', '{{periodo}}'], ['Actividad', '{{actividad}}'], ['Equipo', '{{equipo}}'], ['Calificada por', '{{evaluador}}']],
    boton: { texto: 'Ver mi resultado', url: '{{enlace}}' },
  },
  calificacion_cambiada: {
    asunto: 'Se modificó una calificación tuya',
    preheader: 'Revisa cómo quedó.',
    titulo: 'Actualizamos tu calificación',
    parrafos: ['Hola {{nombre}}, quien te calificó corrigió un resultado que ya estaba publicado. Revisa cómo quedó en el portal.'],
    filas: [['Período', '{{periodo}}'], ['Actividad', '{{actividad}}'], ['Equipo', '{{equipo}}'], ['Modificada por', '{{evaluador}}']],
    boton: { texto: 'Ver mi resultado', url: '{{enlace}}' },
  },
  observacion_nueva: {
    asunto: 'Tienes una observación nueva',
    preheader: 'Alguien dejó una observación sobre tu trabajo.',
    titulo: 'Tienes una observación nueva',
    parrafos: ['Hola {{nombre}}, recibiste una observación o retroalimentación. Léela en el portal, junto a tu evaluación.'],
    filas: [['Período', '{{periodo}}'], ['Actividad', '{{actividad}}'], ['Equipo', '{{equipo}}'], ['De', '{{autor}}']],
    boton: { texto: 'Leer la observación', url: '{{enlace}}' },
  },
  tarea_asignada: {
    asunto: 'Nueva tarea: {{tarea}}',
    preheader: 'Revisa el plazo y las instrucciones.',
    titulo: 'Tienes una tarea nueva',
    parrafos: ['Hola {{nombre}}, te asignaron una tarea. Abre el detalle para ver las instrucciones.'],
    filas: [['Tarea', '{{tarea}}'], ['Asignada por', '{{asignador}}'], ['Período', '{{periodo}}'], ['Equipo', '{{equipo}}'], ['Fecha límite', '{{fecha_limite}}'], ['Prioridad', '{{prioridad}}']],
    boton: { texto: 'Abrir la tarea', url: '{{enlace}}' },
  },
  tarea_colectiva_asignada: {
    asunto: 'Tarea para tu equipo: {{tarea}}',
    preheader: 'Asignaron una tarea al equipo {{equipo}}.',
    titulo: 'Tu equipo tiene una tarea nueva',
    parrafos: ['Hola {{nombre}}, se asignó una tarea al equipo <b>{{equipo}}</b>, del que formas parte. Coordínate con tus compañeros para entregarla.'],
    filas: [['Tarea', '{{tarea}}'], ['Equipo', '{{equipo}}'], ['Asignada por', '{{asignador}}'], ['Responsable', '{{responsable}}'], ['Fecha límite', '{{fecha_limite}}'], ['Prioridad', '{{prioridad}}']],
    boton: { texto: 'Abrir la tarea', url: '{{enlace}}' },
  },
  tarea_cambio: {
    asunto: 'Cambió una tarea: {{tarea}}',
    preheader: 'Cambio en: {{cambio}}.',
    titulo: 'Cambió una de tus tareas',
    parrafos: ['Hola {{nombre}}, hubo un cambio en una de tus tareas (<b>{{cambio}}</b>). Revísalo para no trabajar con datos antiguos.'],
    filas: [['Tarea', '{{tarea}}'], ['Qué cambió', '{{cambio}}'], ['Antes', '{{antes}}'], ['Ahora', '{{ahora}}'], ['Motivo', '{{motivo}}'], ['Cambiado por', '{{cambiado_por}}']],
    boton: { texto: 'Abrir la tarea', url: '{{enlace}}' },
  },
  tarea_por_vencer: {
    asunto: 'Vence {{cuando}}: {{tarea}}',
    preheader: 'Recuerda entregarla a tiempo.',
    titulo: 'Una tarea está por vencer',
    parrafos: ['Hola {{nombre}}, esta tarea vence <b>{{cuando}}</b>. Si no puedes llegar, avisa antes a quien te la asignó: un plazo se mueve con motivo, no después.'],
    filas: [['Tarea', '{{tarea}}'], ['Equipo', '{{equipo}}'], ['Fecha límite', '{{fecha_limite}}'], ['Estado', '{{estado}}']],
    boton: { texto: 'Entregar la tarea', url: '{{enlace}}' },
  },
  tarea_vencida: {
    asunto: 'Tarea vencida: {{tarea}}',
    preheader: 'Pasó la fecha límite.',
    titulo: 'Una tarea ya venció',
    parrafos: ['Hola {{nombre}}, pasó la fecha límite de esta tarea y todavía no se entrega. Entrégala cuanto antes o avisa a quien te la asignó si algo te lo impide.'],
    filas: [['Tarea', '{{tarea}}'], ['Equipo', '{{equipo}}'], ['Venció el', '{{fecha_limite}}'], ['Días de atraso', '{{dias}}']],
    boton: { texto: 'Abrir la tarea', url: '{{enlace}}' },
  },
  correccion_solicitada: {
    asunto: 'Te devolvieron la tarea: {{tarea}}',
    preheader: 'Hay observaciones por corregir.',
    titulo: 'Tu tarea necesita correcciones',
    parrafos: ['Hola {{nombre}}, revisaron tu entrega y te la devolvieron con esta observación:', `<span style="display:block;padding:14px 20px;background:${C.fila};border-radius:16px;color:${C.texto}">{{observacion}}</span>`],
    filas: [['Tarea', '{{tarea}}'], ['Revisó', '{{revisor}}'], ['Equipo', '{{equipo}}'], ['Fecha límite', '{{fecha_limite}}']],
    boton: { texto: 'Corregir y entregar', url: '{{enlace}}' },
    nota: 'Corregir una observación no cambia que tu primera entrega haya llegado a tiempo.',
  },
  tarea_aprobada: {
    asunto: 'Aprobaron tu tarea: {{tarea}}',
    preheader: 'Tu entrega fue aprobada.',
    titulo: 'Tu tarea fue aprobada',
    parrafos: ['Hola {{nombre}}, tu entrega fue aprobada. Queda como evidencia para tu evaluación.'],
    filas: [['Tarea', '{{tarea}}'], ['Aprobada por', '{{revisor}}'], ['Equipo', '{{equipo}}'], ['Puntos', '{{puntos}} de 10']],
    boton: { texto: 'Ver la tarea', url: '{{enlace}}' },
  },
  entrega_registrada: {
    asunto: '{{persona}} entregó: {{tarea}}',
    preheader: 'Hay una entrega esperando tu revisión.',
    titulo: 'Tienes una entrega por revisar',
    parrafos: ['Hola {{nombre}}, <b>{{persona}}</b> entregó una tarea y espera tu revisión. Al aprobarla, asígnale sus puntos (0 a 10).'],
    filas: [['Tarea', '{{tarea}}'], ['Equipo', '{{equipo}}'], ['Entregada el', '{{entregada}}'], ['A tiempo', '{{a_tiempo}}']],
    boton: { texto: 'Revisar la entrega', url: '{{enlace}}' },
  },
  tarea_bloqueada: {
    asunto: 'Tarea bloqueada: {{tarea}}',
    preheader: '{{persona}} marcó que está esperando algo.',
    titulo: 'Una tarea quedó bloqueada',
    parrafos: ['Hola {{nombre}}, <b>{{persona}}</b> marcó una tarea como bloqueada. Mientras siga así no cuenta como atrasada.'],
    filas: [['Tarea', '{{tarea}}'], ['Equipo', '{{equipo}}'], ['Motivo', '{{motivo}}']],
    boton: { texto: 'Abrir la tarea', url: '{{enlace}}' },
  },
  estado_cambiado: {
    asunto: 'Cambió el estado: {{elemento}}',
    preheader: 'Revisa el cambio.',
    titulo: 'Cambió el estado de algo tuyo',
    parrafos: ['Hola {{nombre}}, cambió el estado de <b>{{elemento}}</b>.'],
    filas: [['Elemento', '{{elemento}}'], ['Tipo', '{{objeto}}'], ['Equipo', '{{equipo}}'], ['Antes', '{{antes}}'], ['Ahora', '{{ahora}}'], ['Cambiado por', '{{cambiado_por}}']],
    boton: { texto: 'Ver el detalle', url: '{{enlace}}' },
  },
  equipo_incorporado: {
    asunto: 'Te incorporaron al equipo {{equipo}}',
    preheader: 'Ya formas parte del equipo.',
    titulo: 'Te sumaste a un equipo',
    parrafos: ['Hola {{nombre}}, ahora formas parte del equipo <b>{{equipo}}</b>. Desde el portal puedes ver a tus compañeros y las tareas del equipo.'],
    filas: [['Equipo', '{{equipo}}'], ['Tu rol en el equipo', '{{rol_equipo}}'], ['Incorporado por', '{{agregado_por}}']],
    boton: { texto: 'Abrir el portal', url: '{{enlace}}' },
  },
  equipo_retiro: {
    asunto: 'Ya no formas parte del equipo {{equipo}}',
    preheader: 'Te retiraron de un equipo.',
    titulo: 'Te retiraron de un equipo',
    parrafos: ['Hola {{nombre}}, ya no formas parte del equipo <b>{{equipo}}</b>. Si crees que fue un error, consúltalo con quien administra el equipo.'],
    filas: [['Equipo', '{{equipo}}'], ['Retirado por', '{{retirado_por}}'], ['Motivo', '{{motivo}}']],
    boton: { texto: 'Abrir el portal', url: '{{enlace}}' },
  },
  solicitud_acceso: {
    asunto: 'Nueva solicitud de acceso: {{persona}}',
    preheader: 'Alguien espera tu aprobación.',
    titulo: 'Hay una solicitud de acceso',
    parrafos: ['Hola {{nombre}}, <b>{{persona}}</b> se registró y espera que apruebes su acceso, y le asignes rol y distrito.'],
    filas: [['Nombre', '{{persona}}'], ['Correo', '{{correo}}']],
    boton: { texto: 'Revisar la solicitud', url: '{{enlace}}' },
  },
  acceso_aprobado: {
    asunto: 'Ya puedes entrar a EIGHT CREATORS LABs',
    preheader: 'Tu acceso fue aprobado.',
    titulo: 'Tu acceso fue aprobado',
    parrafos: ['Hola {{nombre}}, la administración aprobó tu cuenta. Ya puedes iniciar sesión con tu correo y contraseña.'],
    boton: { texto: 'Entrar al portal', url: '{{enlace}}' },
  },
  actividad_nueva: {
    asunto: 'Nueva actividad: {{actividad}}',
    preheader: '{{fecha}}',
    titulo: 'Hay una actividad nueva',
    parrafos: ['Hola {{nombre}}, se agregó una actividad al calendario.'],
    filas: [['Actividad', '{{actividad}}'], ['Cuándo', '{{fecha}}'], ['Tipo', '{{etiqueta}}']],
    boton: { texto: 'Ver el calendario', url: '{{enlace}}' },
  },
  actividad_recordatorio: {
    asunto: 'Mañana: {{actividad}}',
    preheader: '{{fecha}}',
    titulo: 'Mañana tienes una actividad',
    parrafos: ['Hola {{nombre}}, te recordamos la actividad de mañana.'],
    filas: [['Actividad', '{{actividad}}'], ['Cuándo', '{{fecha}}'], ['Tipo', '{{etiqueta}}']],
    boton: { texto: 'Ver el calendario', url: '{{enlace}}' },
  },
  evaluaciones_sin_publicar: {
    asunto: 'Faltan evaluaciones por publicar en {{periodo}}',
    preheader: '{{pendientes}} personas sin nota publicada.',
    titulo: 'Quedan evaluaciones sin publicar',
    parrafos: ['Hola {{nombre}}, faltan <b>{{pendientes}}</b> evaluaciones por publicar en <b>{{periodo}}</b>, que cierra el {{cierre}}.'],
    filas: [['Período', '{{periodo}}'], ['Sin evaluar', '{{sin_evaluar}}'], ['En borrador', '{{borradores}}']],
    boton: { texto: 'Ir a Evaluar', url: '{{enlace}}' },
  },
};
