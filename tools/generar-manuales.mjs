// Genera los tres manuales de uso (ayuda/miembro.html, ayuda/secretario.html, ayuda/admin.html).
//   node tools/generar-manuales.mjs
// El contenido vive aquí, en un solo sitio, y SOLO describe lo que la plataforma hace hoy: cada procedimiento
// sale de una pantalla que existe. Lo que todavía no existe está en la sección «Lo que aún no hace» de cada manual.
// Las capturas (ayuda/img/*.jpg) son del entorno de pruebas con datos de ejemplo (npm run ui en tools/pruebas).
import fs from 'node:fs';

const SALIDA = new URL('../ayuda/', import.meta.url);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ── Piezas ─────────────────────────────────────────────────────────── */
const b = t => `<b>${t}</b>`;                       // un botón, icono o menú del portal
const pasos = (...p) => `<ol class="pasos">${p.map(x => `<li>${x}</li>`).join('')}</ol>`;
const nota = (tipo, t) => `<aside class="nota nota--${tipo}"><b>${{ consejo: 'Consejo', ojo: 'Importante', ejemplo: 'Ejemplo' }[tipo]}.</b> ${t}</aside>`;
const captura = (img, pie) => `<figure class="captura"><div class="captura-marco"><img src="img/${img}.jpg" alt="${esc(pie)}" loading="lazy"></div><figcaption>${pie}</figcaption></figure>`;
const pcCel = (pc, cel) => `<div class="pccel"><div><h4>En computadora</h4>${pc}</div><div><h4>En celular</h4>${cel}</div></div>`;
const tabla = (cab, filas) => `<div class="tabla-wrap"><table><thead><tr>${cab.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas.map(f => `<tr>${f.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const faq = (p, r) => `<details class="faq"><summary>${p}</summary><div>${r}</div></details>`;
const lista = (...i) => `<ul>${i.map(x => `<li>${x}</li>`).join('')}</ul>`;

/* ── Secciones comunes ───────────────────────────────────────────────── */
const comunAcceso = (rol) => ({
  id: 'acceso', titulo: 'Entrar y moverte por el portal',
  html: `
<p>La dirección del portal es <b>eight-coms.vercel.app</b>. Funciona en cualquier navegador moderno, en computadora y en celular.</p>
<h3>Crear tu cuenta</h3>
${pasos(
    `Abre el portal y toca ${b('Crear cuenta')}.`,
    `Escribe tu nombre, tu correo y una contraseña. La barra de seguridad te dice si es débil o fuerte.`,
    `Revisa tu correo y pulsa el enlace de ${b('Confirmar mi correo')}. Si no llega, mira en «Spam».`,
    `Espera la aprobación de la administración: hasta entonces, al entrar verás un aviso de que tu acceso está pendiente. Cuando te aprueban, te llega un correo y ya puedes entrar.`)}
${nota('ojo', 'Registrarte no te da ningún permiso: tu rol, tu distrito y tu tipo de acceso los asigna la administración. No puedes cambiarlos tú.')}
<h3>Iniciar sesión y recuperar la contraseña</h3>
${pasos(`En ${b('Entrar')} escribe tu correo y tu contraseña.`, `Si la olvidaste, toca ${b('Olvidé mi contraseña')}: te enviamos un código de verificación de 6 cifras. Escríbelo y elige la nueva clave.`)}
${nota('consejo', 'La contraseña nueva tiene que ser distinta de la actual; si pones la misma, el portal te lo explica en vez de dar un error.')}
<h3>Cómo está organizado</h3>
${pcCel(
    `<p>El menú vertical azul de la izquierda lleva a cada sección. Arriba tienes ${b('Buscar')} (atajo ${b('Ctrl + K')}) para saltar a una persona o sección. Abajo, tu nombre abre ${b('Mi cuenta')}, y los iconos sirven para cambiar el tema (claro/oscuro) y salir. El botón ${b('Avisos')} muestra cuántos avisos tienes sin leer.</p>`,
    `<p>Arriba hay una cabecera con el nombre de la pantalla, la lupa (buscar) y la campana (avisos). Abajo, una barra de iconos: <b>solo el destino en el que estás muestra su nombre</b>; los demás son solo icono. El último botón (${b('Más')} o ${b('Cuenta')}) abre un panel con el resto de secciones, tu cuenta, el tema y ${b('Cerrar sesión')}. Ese panel se cierra con la ${b('X')}, tocando fuera o arrastrando la rayita de arriba hacia abajo.</p>`)}
${rol === 'miembro' ? captura('m-mas', 'El panel «Más» en el celular: tu cuenta, instalar la app, tema y cerrar sesión.') : ''}
<h3>Instalar el portal como una app</h3>
<p>Puedes tenerlo en la pantalla de inicio de tu celular, con su icono, sin la barra del navegador.</p>
${pcCel(
    `<p>En Chrome o Edge, usa el icono de instalar de la barra de direcciones, o el menú ⋮ → «Instalar EIGHT CREATORS LABs».</p>`,
    `<p><b>Android (Chrome):</b> abre ${b('Mi cuenta')} → ${b('Instalar en tu celular')} y acepta. Si no aparece el cuadro, menú ⋮ → «Instalar app». <b>iPhone (solo Safari):</b> toca el botón Compartir (el cuadro con la flecha hacia arriba) → ${b('Añadir a pantalla de inicio')}. En iPhone, Chrome y otros navegadores no pueden instalarla.</p>`)}
${nota('consejo', 'La app instalada necesita internet: sin conexión solo muestra una pantalla de «Sin conexión» con un botón para reintentar. Tus datos viven en el portal, no en el teléfono.')}`,
});

const comunAvisos = (rol) => ({
  id: 'avisos', titulo: 'Avisos (la campana)',
  html: `
<p>Todo lo que te llega por correo también aparece en la campana, con su estado de leído / sin leer. Es la misma información: no se inventan avisos aparte.</p>
${pasos(
    `Toca la campana ${b('🔔')} de la cabecera (en computadora: ${b('Avisos')} en el menú de la izquierda). Si tienes avisos sin leer, verás un número en rojo.`,
    `Se abre el panel ${b('Avisos')}: agrupados en <i>Hoy / Ayer / Esta semana / Antes</i>, con un icono por categoría (tareas, evaluaciones, actividades, accesos) y cuánto hace que ocurrieron. Los <b>sin leer</b> tienen fondo tenue, una barra a la izquierda y el título en negrita.`,
    `Toca un aviso: se marca como leído y te lleva a la sección donde se resuelve (por ejemplo, una tarea devuelta te lleva a ${b('Entregas')}).`,
    `Usa ${b('Sin leer')} para ver solo los pendientes y ${b('Marcar todo')} para dejarlos todos como leídos. ${b('Ver avisos anteriores')} carga más.`)}
${captura('m-avisos', 'El centro de avisos (vista de un miembro; para la secretaría y la administración es igual, con sus propios avisos).')}
${tabla(['Si ves…', 'Significa'], rol === 'miembro' ? [
    ['Nueva tarea · Cambió el plazo', 'Te asignaron una tarea o se movió su fecha límite.'],
    ['Vence mañana / hoy · Tarea vencida', 'Recordatorios por fecha; la tarea sigue pendiente.'],
    ['Te devolvieron… · Aprobaron…', 'Quien revisa te devolvió la entrega con una observación, o la aprobó con puntos.'],
    ['Tu evaluación está publicada · Actualizaron tu evaluación', 'Ya puedes ver tu resultado en Mi perfil.'],
    ['Nueva actividad · Mañana: …', 'Se agregó una actividad al calendario, o es mañana.'],
    ['Tu acceso fue aprobado', 'La administración activó tu cuenta.']] : rol === 'secretario' ? [
    ['Nueva tarea · Cambió el plazo', 'Te asignaron una tarea a ti, o se movió su plazo.'],
    ['«Fulana entregó: …»', 'Una persona de tu distrito entregó y espera tu revisión (Tareas → Por revisar).'],
    ['Tarea bloqueada', 'Alguien de tu distrito marcó que está esperando algo; mientras tanto no cuenta como atrasada.'],
    ['Vence / Tarea vencida · Te devolvieron · Aprobaron', 'Lo mismo que para cualquier persona, sobre tus propias tareas.'],
    ['Tu evaluación está publicada', 'Tu resultado está en Mi perfil.'],
    ['Nueva actividad · Mañana: …', 'Una actividad del equipo o de tu distrito.']] : [
    ['Solicitud de acceso', 'Alguien se registró y espera que apruebes su acceso (Personas).'],
    ['«Fulana entregó: …»', 'Hay una entrega esperando revisión (Tareas).'],
    ['Tarea bloqueada', 'Alguien marcó que espera algo (Tareas).'],
    ['Faltan evaluaciones por publicar', 'Aviso 3 días antes de la entrega de scores del período activo (Evaluar).'],
    ['Nueva actividad · Mañana: …', 'Una actividad agregada al calendario, o la de mañana.']])}
${nota('ojo', 'Si el panel dice que los avisos «aún no están activos», la actualización de la base de datos (migración 0022) no se ha aplicado; los correos siguen llegando con normalidad.')}`,
});

const comunCuenta = {
  id: 'cuenta', titulo: 'Mi cuenta',
  html: `
<p>Es tu espacio personal. Se abre con tu nombre (computadora) o desde ${b('Más')} → tu nombre (celular).</p>
${pasos(
    `${b('Cambiar foto')}: elige cualquier imagen del teléfono o la computadora; no importa su tamaño. El portal la recorta en cuadrado y la reduce solo (queda ligera, de pocos KB).`,
    `${b('Nombre')}: escríbelo y toca ${b('Guardar')}.`,
    `${b('Tema')}: alterna entre claro y oscuro.`,
    `${b('Nueva contraseña')} y ${b('Repite la contraseña')}: mínimo 8 caracteres → ${b('Cambiar contraseña')}.`,
    `${b('Instalar en tu celular')}: ver «Entrar y moverte».`,
    `${b('Cerrar sesión')}: sales de este dispositivo.`)}
${captura('m-cuenta', 'Mi cuenta en el celular.')}
<p>Correo, tipo de acceso y distrito aparecen en «Tus datos» solo para que los veas: los asigna la administración.</p>`,
};

const faqComun = [
  [`No puedo entrar: dice «acceso pendiente»`, `Tu cuenta aún no la aprobó la administración. Cuando lo haga te llegará un correo. Si ya pasó tiempo, avisa a tu secretaría de distrito o a la administración.`],
  [`No me llegó el correo de confirmación o el código`, `Revisa «Spam». El correo sale de la cuenta del portal; si pasan unos minutos, pide otro desde ${b('Entrar')} → ${b('Olvidé mi contraseña')} (o el reenvío de confirmación). Si nunca llega, avisa a la administración: puede ser un correo mal escrito.`],
  [`La pantalla se ve vieja o algo no carga`, `Recarga la página (en la app instalada, ciérrala y vuelve a abrirla). Si el portal muestra un error con un botón ${b('Reintentar')}, púlsalo: pasa cuando se corta el internet un instante.`],
  [`El texto o los botones se ven pequeños`, `El portal usa letras más grandes en el celular por sí solo. Si aun así te cuesta, aumenta el tamaño de letra del sistema del teléfono: el portal lo respeta.`],
  [`No veo la campana / no sube el contador`, `El contador se actualiza cada minuto y al volver a la pestaña. Si no aparece ningún aviso nunca, mira el mensaje dentro del panel de avisos: te dice si la función aún no está activa.`],
];

/* ── Manual del miembro ──────────────────────────────────────────────── */
const miembro = {
  archivo: 'miembro', titulo: 'Manual para miembros', sub: 'Cómo usar el portal de EIGHT CREATORS LABs si eres Creator',
  resumen: `Aquí ves cómo vas, qué tienes pendiente y qué viene. Este manual cubre todo lo que puedes hacer hoy, paso a paso, en computadora y en celular.`,
  permisos: [
    ['Ver tu perfil, tu score, tus criterios y tu evolución', 'Sí'],
    ['Ver tus tareas y crear tus propias tareas («Mi iniciativa»)', 'Sí'],
    ['Entregar, retomar, bloquear o corregir tus tareas', 'Sí'],
    ['Aprobar o devolver tus propias tareas', 'No: lo hace tu secretaría de distrito o la administración'],
    ['Cambiar la fecha límite de una tarea que te asignaron', 'No'],
    ['Ver el calendario del equipo y de tu distrito', 'Sí'],
    ['Evaluarte o evaluar a otras personas', 'No'],
    ['Ver a otras personas', 'No: solo tu información'],
    ['Cambiar tu rol, distrito o tipo de acceso', 'No: los asigna la administración'],
  ],
  secciones: [
    comunAcceso('miembro'),
    {
      id: 'inicio', titulo: 'Inicio: qué pasa ahora',
      html: `
<p>Es la primera pantalla. Responde a «qué necesito hacer ahora».</p>
${captura('m-inicio', 'Inicio en el celular: cuenta regresiva, tu evaluación y lo que requiere atención.')}
${lista(
    `<b>Banda azul:</b> el período en curso y cuántos días faltan para la próxima fecha (por ejemplo, la entrega de scores).`,
    `<b>Tu evaluación:</b> tu nota del período con su nivel (Excelente, Bueno, En Proceso o Bajo). Si aún no se publica, dice cuándo se publica. ${b('Ver mi perfil')} te lleva al detalle.`,
    `<b>Para atender:</b> tus tareas que piden acción, primero las devueltas y luego por fecha. ${b('Ir a Entregas')} las abre.`,
    `<b>Próximas fechas:</b> las fechas clave del período y en cuántos días son.`)}`,
    },
    {
      id: 'perfil', titulo: 'Mi perfil y cómo se calcula tu evaluación',
      html: `
<p>En ${b('Mi perfil')} está tu cabecera (foto, nombre, rol, versión de la rúbrica, distrito) y el anillo con tu nota. Abajo eliges el período (${b('PE1')}, ${b('PE2')}…) y cuatro pestañas.</p>
${captura('m-perfil', 'Mi perfil: tu cabecera, el período y las pestañas Resumen, Criterios, Tareas y Evolución.')}
${tabla(['Pestaña', 'Qué muestra'], [
        ['Resumen', 'Tus indicadores del período (abajo) y la «lectura rápida»: los puntos más altos y donde hay más margen.'],
        ['Criterios', 'Cada criterio con tu puntaje, su barra y, si lo hay, el comentario de quien evaluó. En «¿Cómo se puntúa?» está la descripción de cada nivel.'],
        ['Tareas', 'Las tareas de ese período y su estado.'],
        ['Evolución', 'Cómo cambió tu nota entre períodos.']])}
<h3>Los indicadores</h3>
${tabla(['Indicador', 'Qué es'], [
        ['Núcleo', 'Los criterios que son iguales para todos los roles (plazos, respuesta, colaboración, iniciativa, calidad). Se compara en valor absoluto.'],
        ['Técnico', 'Los criterios propios de tu rol. Cada uno tiene un peso; los pesos de tu rol suman 100.'],
        ['Individual', '60 % técnico + 40 % núcleo. Es tu nota «sobre 100».'],
        ['Percentil', 'Tu posición frente a las demás personas de tu mismo rol (100 = la mejor). Si tu rol tiene menos de 4 personas evaluadas no se calcula: se usa tu técnico y el portal lo avisa.'],
        ['General', '40 % núcleo + 60 % percentil (o técnico, en roles pequeños).']])}
<h3>Los niveles</h3>
${tabla(['Nivel', 'Desde (sobre 100)'], [['Excelente', '87'], ['Bueno', '67'], ['En Proceso', '37'], ['Bajo', 'menos de 37']])}
<h3>Cómo se puntúa cada criterio</h3>
<p>En las evaluaciones nuevas, cada criterio de tu rol se puntúa de <b>0 hasta su peso</b>: si «Composición y encuadre» pesa 30, la persona que evalúa elige un valor entre 0 y 30. Los criterios del núcleo se puntúan de 0 a 10. En la pestaña ${b('Criterios')} verás cada puntaje como «24/30» con su barra. Las evaluaciones guardadas antes de este cambio se siguen viendo de 1 a 5 (por ejemplo «4/5»); el portal las convierte a la misma escala de 0 a 100 para compararlas.</p>
${nota('ejemplo', 'Si tu técnico es 71, significa que sumaste 71 de 100 puntos posibles en los criterios de tu rol (cuando todos se puntuaron). Un criterio que no aplica para ti queda fuera: nunca cuenta como 0.')}
${nota('ojo', 'Los períodos anteriores a la «rúbrica por roles» se muestran con la <b>rúbrica clásica</b> (7 criterios del 1 al 4, sobre 30 con el bono). Tienen otra escala y no se mezclan ni se comparan con los nuevos.')}`,
    },
    {
      id: 'tareas', titulo: 'Entregas: tus tareas',
      html: `
<p>Una tarea es lo que se te pidió, para cuándo y qué hiciste. Así, cuando te evalúen, se mira lo que realmente pasó.</p>
${captura('m-entregas', 'Entregas: filtros, «+ Mi iniciativa» y una tarea devuelta con su observación.')}
<h3>Los estados</h3>
${tabla(['Estado', 'Qué significa', 'Qué puedes hacer'], [
        ['Asignada', 'Te la asignó tu secretaría o la administración.', 'Empezarla o entregarla.'],
        ['En curso', 'La estás haciendo.', 'Entregarla.'],
        ['Entregada', 'Ya la entregaste; espera revisión.', 'Esperar. Quien revisa la aprueba o la devuelve.'],
        ['Devuelta', 'Quien revisa te dejó una observación.', `${b('Entregar corregida')} o ${b('Retomar')}.`],
        ['Aprobada', 'Quedó aprobada y con puntos (0 a 10).', 'Nada: queda como evidencia.'],
        ['Bloqueada', 'Estás esperando algo de otra persona.', 'Retomarla cuando se destrabe. Mientras está bloqueada no cuenta como atrasada.']])}
<h3>Entregar una tarea</h3>
${pasos(
        `Abre ${b('Entregas')} y busca la tarea (usa ${b('Todas')}, ${b('Abiertas')}, ${b('Vencidas')} o ${b('Aprobadas')}).`,
        `Pulsa ${b('Entregar')}. Escribe un enlace a tu trabajo, una nota, o ambos (debe haber al menos uno).`,
        `Confirma. Desde ese momento queda <i>Entregada</i> y a quien revisa le llega un aviso.`)}
${nota('ojo', 'El «a tiempo» se mide en tu <b>primera</b> entrega. Si te devuelven la tarea y la corriges, esa corrección no la vuelve «tarde».')}
<h3>Crear tu propia tarea («Mi iniciativa»)</h3>
${pasos(`Toca ${b('+ Mi iniciativa')}.`, `Escribe un título, qué hiciste o harás y, si quieres, una fecha.`, `Guarda. Cuando alguien más la apruebe, cuenta como iniciativa tuya.`)}
${nota('consejo', 'Nadie aprueba su propia tarea. Eso es lo que evita inflar la «iniciativa»: solo cuenta lo que otra persona revisó.')}
<h3>Bloquear, mover plazos, historial</h3>
${lista(
        `${b('Bloquear')}: indica en una frase qué estás esperando.`,
        `Las fechas límite de las tareas que te <b>asignaron</b> no las cambias tú; las mueve quien te las asignó, con un motivo, y te llega un aviso.`,
        `${b('Historial')} muestra cada cambio de estado, quién lo hizo y cuándo.`)}
<p>La pantalla también tiene la <b>línea de tiempo</b> con las fechas del período y una marca en «hoy».</p>
${nota('ojo', 'Los períodos de la rúbrica clásica no usan tareas asignables: ahí ' + b('Entregas') + ' muestra el formulario antiguo para registrar trabajos.')}`,
    },
    {
      id: 'calendario', titulo: 'Calendario',
      html: `
<p>Reúne en un solo lugar las fechas de los períodos, las actividades del equipo o de tu distrito, y las fechas de tus tareas.</p>
${captura('m-calendario', 'Calendario del mes con puntos de colores por tipo y el panel del día.')}
${pasos(`Abre ${b('Calendario')}. Los puntos de colores marcan lo que hay cada día; el día de hoy está en coral.`, `Toca un día: abajo aparece lo que hay ese día.`, `Toca ${b('+ Mi iniciativa')} para crear una tarea propia con esa fecha.`)}`,
    },
    comunAvisos('miembro'),
    comunCuenta,
    {
      id: 'buscar', titulo: 'Buscar',
      html: `<p>En computadora, ${b('Ctrl + K')} (o ${b('⌘ K')} en Mac); en celular, la ${b('lupa')} de la cabecera. Escribe y salta a una sección o inicia una acción. Solo ofrece lo que tu cuenta puede hacer.</p>`,
    },
    {
      id: 'aun-no', titulo: 'Lo que aún no hace',
      html: `
<p>Para que no busques algo que no existe todavía:</p>
${lista(
        `<b>Roles de preferencia y rol predeterminado:</b> aún no puedes elegirlos. Tu rol lo asigna la administración y se ve en ${b('Mi perfil')}.`,
        `<b>Roles dentro de una actividad</b> y asignación de roles por actividad: todavía no existen; las actividades del calendario no llevan roles.`,
        `<b>Guía de bienvenida paso a paso</b> al entrar por primera vez: no existe; este manual la reemplaza por ahora.`,
        `<b>Reportes personales exportables:</b> los reportes los genera la administración. Tú ves tus indicadores en ${b('Mi perfil')}.`)}`,
    },
  ],
  faq: [
    ...faqComun,
    [`Mi tarea dice «vencida» pero ya la entregué`, `«Vencida» solo se usa para tareas sin entregar. Si la entregaste a tiempo, aparece «Entregada» o «Aprobada». Refresca la pantalla; si sigue igual, avísale a quien te la asignó.`],
    [`Me devolvieron una tarea. ¿Pierdo puntos?`, `No por devolverla: las devoluciones se cuentan como un dato de calidad que mira quien te evalúa, pero tu «a tiempo» se queda como en la primera entrega. Corrige y pulsa ${b('Entregar corregida')}.`],
    [`Mi percentil aparece vacío`, `Tu rol tiene menos de 4 personas evaluadas en el período. En ese caso se usa tu técnico y el portal lo explica en un recuadro.`],
    [`Veo «/5» en un período y «/30» en otro`, `Cambió la forma de puntuar: los períodos nuevos puntúan cada criterio de 0 a su peso; los anteriores, de 1 a 5. Las dos formas se convierten a una nota sobre 100.`],
  ],
};

/* ── Manual de la secretaría ─────────────────────────────────────────── */
const secretario = {
  archivo: 'secretario', titulo: 'Manual para secretarías de distrito', sub: 'Cómo usar el portal si eres Secretario o Secretaria',
  resumen: `Además de todo lo que ve un miembro, tienes dos herramientas para tu distrito: ver a su gente y asignar y revisar tareas. Este manual explica las dos y lo que cambia en el resto.`,
  permisos: [
    ['Lo mismo que un miembro: tu perfil, tus entregas, calendario, avisos y cuenta', 'Sí'],
    ['Ver los perfiles de las personas de tu distrito', 'Sí, solo de tu distrito'],
    ['Ver el ranking de distritos', 'Sí'],
    ['Asignar tareas a las personas de tu distrito', 'Sí'],
    ['Revisar entregas: aprobar (con puntos) o devolver (con observación)', 'Sí, solo las de tu distrito'],
    ['Aprobar tus propias tareas', 'No: no se aprueban a sí mismas'],
    ['Cambiar la fecha límite de una tarea que asignaste', 'Sí, con un motivo (la persona recibe un aviso)'],
    ['Evaluar (puntuar la rúbrica)', 'No: lo hace la administración'],
    ['Crear actividades para todo el equipo', 'No: solo para tu distrito, donde esté habilitado; las del equipo las crea la administración'],
    ['Generar reportes', 'No: los genera la administración'],
    ['Cambiar roles, distritos o accesos', 'No'],
  ],
  secciones: [
    comunAcceso('secretario'),
    {
      id: 'inicio', titulo: 'Inicio y tu espacio personal',
      html: `
<p>${b('Inicio')}, ${b('Mi perfil')}, ${b('Calendario')} y ${b('Entregas')} funcionan como en el manual del miembro (consulta ese manual para el detalle de la rúbrica, los estados de tareas y el calendario). En ${b('Inicio')}, además, hay un bloque con el estado de tu distrito.</p>
${captura('s-inicio', 'Inicio de la secretaría en el celular.')}
${nota('consejo', 'En el celular, tus dos herramientas de trabajo (' + b('Distrito') + ' y ' + b('Tareas') + ') están en la barra inferior junto a ' + b('Inicio') + ' y ' + b('Entregas') + '. ' + b('Mi perfil') + ' y ' + b('Calendario') + ' están en ' + b('Más') + '.')}`,
    },
    {
      id: 'distrito', titulo: 'Distrito: tu gente',
      html: `
<p>Tiene dos pestañas internas: ${b('Personas')} y ${b('Ranking de distritos')}.</p>
${captura('s-distrito', 'Distrito: indicadores del distrito y tarjetas de personas.')}
${pasos(
        `Abre ${b('Distrito')} y elige el período arriba (${b('PE1')}, ${b('PE2')}…).`,
        `En ${b('Personas')} ves los indicadores del distrito (personas, promedio individual, tu posición, el general más alto) y una tarjeta por persona con su nota. En los períodos nuevos, cada tarjeta indica «N por revisar» y «N vencidas».`,
        `Toca una tarjeta para abrir el perfil de esa persona en un panel (en el celular, una hoja desde abajo). Ahí ves sus pestañas Resumen, Criterios, Tareas y Evolución, igual que ella.`,
        `En ${b('Ranking de distritos')} comparas los distritos del equipo.`)}
${nota('ojo', 'Solo ves a las personas de <b>tu</b> distrito. No es un filtro del portal: la base de datos no entrega más. Si falta alguien, la administración tiene que asignarle tu distrito.')}`,
    },
    {
      id: 'tareas', titulo: 'Tareas: asignar y revisar',
      html: `
<p>Aquí asignas trabajo a las personas de tu distrito y revisas lo que entregan. Tus propias tareas están en ${b('Entregas')}.</p>
${captura('s-tareas', 'Tareas: filtros por estado, filtro por persona, «+ Nueva tarea» y una entrega por revisar.')}
<h3>Asignar una tarea</h3>
${pasos(
        `Abre ${b('Tareas')} y toca ${b('+ Nueva tarea')} (o, desde el perfil de una persona, ${b('Nueva tarea')}; o desde el calendario, en un día).`,
        `Elige la persona, escribe el título y qué se espera, la fecha límite y la prioridad. Si hay varios períodos de rúbrica por roles, elige el período.`,
        `Guarda. La persona recibe un aviso (y un correo) con la tarea y su fecha.`)}
<h3>Revisar una entrega</h3>
${pasos(
        `Entra a ${b('Tareas')} y usa el filtro ${b('Por revisar')} (muestra el número).`,
        `Pulsa ${b('Ver entrega')} para leer el enlace o la nota.`,
        `Si está bien, ${b('Aprobar')}: <b>es obligatorio ponerle puntos de 0 a 10</b>. Los puntos son un dato para quien evalúa; no entran en ninguna fórmula.`,
        `Si hay que corregir, ${b('Devolver')} y escribe la observación (obligatoria). La persona recibe un aviso con tu observación.`)}
${tabla(['Botón', 'Para qué'], [
        [b('Editar'), 'Cambiar el título, la descripción o la prioridad de una tarea que asignaste.'],
        ['Mover el plazo', 'Cambia la fecha límite con un motivo (mínimo 5 caracteres). La fecha original queda registrada y la persona recibe un aviso.'],
        [b('Historial'), 'Cada cambio: quién, qué y cuándo. No se puede borrar.'],
        ['Filtro por persona', 'Ver solo las tareas de una persona.']])}
${nota('consejo', 'Una tarea con fecha límite «a tiempo» se mide en la <b>primera</b> entrega: corregir una observación no la hace tarde. Así evitas castigar a quien corrige bien.')}
${nota('ojo', 'Las tareas solo existen en los períodos de la rúbrica por roles. En los períodos clásicos, esta pestaña lo explica y no deja crear tareas.')}`,
    },
    comunAvisos('secretario'),
    comunCuenta,
    {
      id: 'aun-no', titulo: 'Lo que aún no hace',
      html: lista(
        `<b>Reportes:</b> no tienes pantalla de reportes ni exportación; los genera la administración.`,
        `<b>Evaluar la rúbrica:</b> la puntuación la hace la administración. Tú ves el resultado de tu distrito cuando se publica.`,
        `<b>Roles de preferencia, roles por actividad y asignación con vista de compatibilidad:</b> todavía no existen. La asignación de tareas es por persona, sin roles.`,
        `<b>Vista global de todos los PE por rol:</b> no existe; ves los períodos de uno en uno.`,
        `<b>Guía de bienvenida paso a paso:</b> no existe.`),
    },
  ],
  faq: [
    ...faqComun,
    [`No veo a una persona de mi distrito`, `La administración tiene que asignarle tu distrito en <i>Personas</i>. Hasta entonces, la base de datos no te la muestra.`],
    [`No me deja aprobar una tarea`, `Dos causas: no tiene puntos (obligatorios de 0 a 10) o es una tarea tuya (nadie aprueba la propia). Pídele a la administración que la apruebe.`],
    [`¿Por qué «Devolver» me pide una observación?`, `Para que la persona sepa qué corregir. Escríbela concreta: qué falta y cómo lo quieres.`],
    [`Asigné una tarea y a la persona no le llegó el aviso`, `El aviso aparece en su campana y sale por correo en los minutos siguientes. Si no tiene correo registrado o aún no aprobaron su acceso, no se le envía.`],
  ],
};

/* ── Manual de la administración ─────────────────────────────────────── */
const admin = {
  archivo: 'admin', titulo: 'Manual para administración', sub: 'Cómo gestionar el portal de EIGHT CREATORS LABs',
  resumen: `Tienes el control completo: personas, evaluaciones, tareas, calendario, reportes y la configuración de la rúbrica. Este manual separa lo que usas cada día (operación) de lo que configuras de vez en cuando.`,
  permisos: [
    ['Ver y gestionar a todas las personas', 'Sí'],
    ['Aprobar accesos y asignar rol, distrito, tipo de acceso y administración', 'Sí'],
    ['Evaluar y publicar evaluaciones', 'Sí'],
    ['Corregir los puntos de una tarea ya aprobada', 'Sí (es lo único que se corrige después)'],
    ['Crear períodos, activar uno, definir fechas', 'Sí'],
    ['Crear actividades del equipo y etiquetas', 'Sí'],
    ['Crear, editar, ordenar, desactivar y eliminar criterios', 'Sí (eliminar solo si ninguna evaluación lo usó)'],
    ['Crear versiones de perfiles por rol', 'Sí'],
    ['Escribir en una gestión archivada', 'No: queda solo de lectura'],
    ['Generar y exportar reportes', 'Sí'],
  ],
  secciones: [
    comunAcceso('admin'),
    {
      id: 'entrada', titulo: 'Entrar al panel: gestión y período',
      html: `
<p>Al abrir el panel, una ventana pregunta ${b('¿Con qué vas a trabajar?')}: la <b>gestión</b> (el año de trabajo) y el <b>período</b>. Eso evita que veas datos de un período cuando creías estar en otro.</p>
${pasos(`Elige la gestión y el período.`, `Toca ${b('Entrar')} (o ${b('Usar el período activo')}).`, `Marca ${b('No volver a mostrar esto')} si quieres que se acuerde. Para volver a verla, en Configuración está el botón para restablecer la entrada.`)}
${nota('ojo', 'Una gestión archivada se abre en solo lectura: los botones de guardar quedan desactivados.')}`,
    },
    {
      id: 'operacion', titulo: 'Panel: lo que necesita atención',
      html: `
<p>Abre con ${b('Requiere atención')}: solo hechos, cada uno con un enlace a donde se resuelve.</p>
${captura('a-panel', 'Panel en el celular: avisos que piden acción y el avance de evaluaciones.')}
${lista(
        `<b>Personas sin evaluar</b> en el período → ${b('Evaluar')}.`,
        `<b>Evaluaciones en borrador</b> sin publicar → ${b('Publicar')}.`,
        `<b>Entregas esperando revisión</b> → ${b('Revisar')}.`,
        `<b>Tareas vencidas</b> sin entregar → ${b('Ver tareas')}.`,
        `<b>Accesos pendientes de aprobar</b> → Personas.`)}
<p>Más abajo hay gráficas (avance, niveles, comparación por rol o distrito, tendencia entre períodos, mapa de calor persona × competencia). Cada una responde una pregunta; son para calibrar, no puntúan nada.</p>
${nota('consejo', 'Las personas desactivadas en el período no se cuentan como «pendientes por evaluar».')}`,
    },
    {
      id: 'evaluar', titulo: 'Evaluar',
      html: `
<p>Es la pantalla central. Arriba están el período, la búsqueda, los filtros de rol y distrito y los estados (${b('Todas')}, ${b('Pendientes')}, ${b('Borrador')}, ${b('Publicadas')}). En computadora, la lista va a la izquierda y el formulario a la derecha; en celular, el formulario aparece <b>debajo de la lista</b> y la pantalla baja sola hasta él al elegir a una persona.</p>
<h3>Evaluar a una persona (rúbrica por roles)</h3>
${pasos(
        `Elige el período y toca a la persona. Arriba del formulario ves su rol y la versión de su perfil.`,
        `Revisa la <b>evidencia de tareas</b>: lo entregado a tiempo, devoluciones, iniciativa. Son hechos para ayudarte; no puntúan ni rellenan nada por ti.`,
        `Puntúa el <b>núcleo transversal</b> (5 criterios iguales para todos) y los <b>criterios técnicos</b> del rol.`,
        `Escribe comentarios si quieres y completa los campos de registro (sí/no, opciones, texto) que existan.`,
        `Mira el contador «N de M obligatorios». Guarda como ${b('Borrador')} cuantas veces quieras; ${b('Publicar')} solo se habilita cuando están completos los obligatorios.`)}
${captura('a-evaluar-nucleo', 'Formulario: cada criterio tiene una barra, un número editable y botones − / +.')}
<h3>La barra de puntos</h3>
<p>Cada criterio se puntúa <b>de 0 hasta su propio peso</b>. Un criterio técnico con peso 30 va de 0 a 30; uno con peso 15, de 0 a 15; los criterios del núcleo, de 0 a 10. La escala se ve debajo del nombre («Escala 0 a 30 · peso 30»).</p>
${tabla(['Para…', 'Haz'], [
        ['Mover el valor', 'Arrastra la bolita de la barra con el dedo o el cursor.'],
        ['Elegir un número exacto', 'Escríbelo en la casilla de la derecha (si te pasas del máximo, se corrige solo).'],
        ['Ajustar de a uno', `Toca ${b('−')} o ${b('+')}. Desde «sin puntuar», ${b('+')} empieza en 1 y ${b('−')} en 0.`],
        ['Dejarlo sin puntuar', 'Borra el número de la casilla. «Sin puntuar» no vale 0: el criterio queda fuera del cálculo.']])}
${captura('a-evaluar-tecnico', 'Criterios técnicos: «Escala 0 a 30 · peso 30» y la barra por encima del número.')}
<p>El resultado sale de la base de datos: <b>técnico = suma de puntos · 100 / suma de pesos de los criterios puntuados</b> (si puntúas todos, es la suma de puntos); <b>núcleo</b> = promedio de (puntos / 10); <b>individual</b> = 60 % técnico + 40 % núcleo.</p>
${nota('ejemplo', 'Perfil de Fotografía: Composición 30, Dominio técnico 25, Diseño 20, Planificación 15, Revisión 10 (suman 100). Si das 24, 17, 14, 9 y 6, el técnico es 70.')}
${nota('ojo', 'La escala de una evaluación la fija el servidor <b>al primer guardado</b> y no cambia. Las evaluaciones guardadas antes de esta actualización se siguen puntuando de 1 a 5 (la barra de cinco paradas) y se convierten a la misma nota sobre 100; no se reescriben. Una persona evaluada en un perfil conserva ese perfil aunque después cambie el rol.')}
${nota('ojo', 'Una persona sin rol no se puede evaluar en rúbrica por roles: asígnale uno en <i>Personas</i>. Tampoco si el rol no tiene perfil: créalo en <i>Roles y perfiles</i>.')}
<h3>Períodos con la rúbrica clásica</h3>
<p>Los 7 criterios se puntúan del 0 al 4, más el bono de excelencia (0 a 2), también con la barra.</p>`,
    },
    {
      id: 'personas', titulo: 'Personas',
      html: `
<p>Una tarjeta por persona (también existe la vista ${b('Tabla')}). Busca por nombre o correo y filtra por distrito.</p>
${captura('a-personas', 'Personas: buscador, filtro, vista Tarjetas/Tabla y una tarjeta por persona.')}
${pasos(`Toca una tarjeta: se abre su perfil y una pestaña extra, ${b('Gestión')}.`, `En ${b('Gestión')} asignas <b>rol</b>, <b>distrito</b>, <b>tipo de acceso</b> (Creator, Secretario), <b>acceso aprobado</b>, <b>administración</b>, su <b>participación en el período</b> y puedes <b>eliminar</b> a la persona.`, `Para un registro nuevo: abre su tarjeta, asígnale rol y distrito y activa ${b('Acceso aprobado')}. Le llega un correo.`)}
${nota('ojo', 'Quien se registra queda con acceso pendiente, sin rol ni distrito, y no puede cambiarlos por su cuenta. Hasta que lo apruebes no entra al portal.')}
${nota('consejo', 'Si desactivas a alguien <b>en un período</b>, deja de contarse como pendiente por evaluar ahí, pero conserva su historia.')}`,
    },
    {
      id: 'tareas', titulo: 'Tareas',
      html: `
<p>Funciona igual que para la secretaría, pero ves y asignas a <b>todas</b> las personas. Puedes asignar, revisar (aprobar con puntos de 0 a 10 o devolver con observación), mover plazos con motivo y ver el historial. Eres la única persona que puede <b>corregir los puntos</b> de una tarea ya aprobada, y reabrir una tarea borra sus puntos.</p>
${nota('ojo', 'Las tareas solo existen en períodos de rúbrica por roles.')}`,
    },
    {
      id: 'calendario', titulo: 'Calendario y actividades',
      html: `
<p>${b('Calendario')} reúne fechas de períodos, actividades y tareas. Desde un día puedes crear una actividad o asignar una tarea. Una <b>actividad</b> tiene título, fecha (o rango), una <b>etiqueta</b> (tipo) y a quién alcanza (todo el equipo o un distrito).</p>
<p>En ${b('Configuración → Actividades')} administras actividades y etiquetas (nombre y color de una paleta fija). Al crear una actividad, las personas destinatarias reciben un aviso, y otro el día anterior.</p>`,
    },
    {
      id: 'reportes', titulo: 'Reportes',
      html: `
${pasos(`Abre ${b('Reportes')}.`, `Elige el período, el alcance (equipo, distrito, rol o una persona) y las secciones que quieres.`, `Revisa la hoja que se genera. ${b('Imprimir / PDF')} usa el tema claro; ${b('CSV')} descarga los datos para una planilla.`)}
<p>Los resultados de la rúbrica por roles los calcula la base de datos; el reporte solo los presenta.</p>
${nota('ojo', 'Por ahora no hay reportes por criterio o por actividad ni exportación a Excel (.xlsx): el CSV se abre con Excel.')}`,
    },
    {
      id: 'configuracion', titulo: 'Configuración',
      html: `
<p>Está agrupada bajo ${b('Configuración')} (menú izquierdo) o en ${b('Más')} (celular).</p>
<h3>Períodos</h3>
${pasos(`${b('+ Nuevo período')}: nombre → modelo (<i>Rúbrica por roles</i> o <i>Clásico</i>) → fechas en orden (inicio ≤ fin del trabajo ≤ entrega ≤ jornada) → ¿activo?`, `Para cambiar el período activo, usa la acción de activar: solo uno puede estar activo.`)}
${nota('ojo', 'El modelo de un período <b>no cambia</b> si ya tiene evaluaciones, y los períodos anteriores a la rúbrica por roles no pueden pasarse a ella.')}
<h3>Rúbrica y criterios</h3>
<p>Hay dos pestañas: ${b('Por roles')} y ${b('Clásica')}. En <i>Por roles</i>, el núcleo es común y las competencias técnicas se asignan por rol. Con la actualización de criterios dinámicos puedes:</p>
${pasos(
        `${b('Crear criterio')}: nombre, descripción, grupo (núcleo o técnico), tipo de campo (<i>escala</i>, <i>sí/no</i>, <i>opciones</i>, <i>texto</i>), si es obligatorio y las descripciones de los niveles 1, 3 y 5.`,
        `${b('Editar')}, ${b('Ordenar')} (↑ ↓), ${b('Desactivar')} o ${b('Eliminar')}.`)}
${lista(
        `Un criterio que alguna evaluación ya usó <b>no se elimina</b> (solo se desactiva) ni cambia de tipo.`,
        `Desactivar no reescribe lo ya evaluado: las evaluaciones que lo tienen se siguen guardando.`,
        `Los campos <i>sí/no, opciones y texto</i> son de <b>registro</b>: se guardan pero no puntúan.`,
        `Los criterios técnicos son siempre de escala (su peso es lo que suma 100).`)}
<h3>Roles y perfiles</h3>
<p>Una tarjeta por rol con su perfil vigente: la barra apilada de pesos y las versiones anteriores. Para cambiar pesos, ${b('crea una versión nueva')}: los pesos técnicos deben sumar <b>exactamente 100</b>. Un perfil que ya usó alguna evaluación es inmutable; la versión nueva rige desde un período que aún no tenga evaluaciones de ese rol. Desde el diálogo del perfil también puedes ${b('Crear criterio')}.</p>
${nota('ojo', 'El peso de un criterio es lo que define su escala de puntaje (0 a su peso). Cambiar pesos en una versión nueva no altera evaluaciones ya guardadas: conservan su perfil.')}
<h3>Distritos y Gestiones</h3>
${lista(
        `${b('Distritos')}: crea y ordena los distritos que se asignan a las personas.`,
        `${b('Gestiones')}: el año de trabajo. ${b('Abrir gestión')} crea la nueva, clona el catálogo de criterios y la última versión de cada perfil, y archiva la anterior. Si no hay una gestión abierta, el registro de cuentas nuevas se cierra.`)}`,
    },
    comunAvisos('admin'),
    comunCuenta,
    {
      id: 'aun-no', titulo: 'Lo que aún no hace',
      html: lista(
        `<b>Preferencias de roles de los miembros</b> (roles múltiples, orden, rol predeterminado): no existen; por eso no hay dónde consultarlas.`,
        `<b>Asignación de roles dentro de actividades</b>, sugerencias de compatibilidad y resumen previo con validaciones de sobrecarga: no existen. Las actividades no tienen destinatarios por persona.`,
        `<b>Vista global de todos los PE y su recorrido por rol</b> con control de acceso propio: el Panel muestra tendencias, pero no hay un seguimiento por rol de todos los PE a la vez.`,
        `<b>Guía de bienvenida por rol</b> con progreso: no existe.`,
        `<b>Reportes por criterio, por actividad o para secretarías</b>, y exportación a Excel/PDF nativa: hoy hay hoja imprimible y CSV.`),
    },
    {
      id: 'actualizaciones', titulo: 'Qué depende de actualizaciones de la base de datos',
      html: `
<p>Algunas funciones necesitan una migración aplicada en Supabase (se aplican a mano, en orden). Si falta, la pantalla lo avisa o se comporta como antes:</p>
${tabla(['Función', 'Migración', 'Si no está aplicada'], [
        ['Rúbrica por roles, tareas, puntos por tarea', '0015, 0016, 0017', 'El portal usa solo la rúbrica clásica.'],
        ['Actividades y etiquetas', '0018', 'El calendario funciona sin actividades.'],
        ['Avisos por correo', '0019', 'No se envían correos de avisos.'],
        ['Criterios dinámicos (crear/editar/ordenar/desactivar/eliminar y campos de registro)', '0020', 'El catálogo se ve pero no se edita.'],
        ['Campana y avisos dentro de la plataforma', '0022', 'La campana explica que los avisos aún no están activos.'],
        ['Puntos por peso (barra de 0 a su peso)', '0023', 'Se evalúa de 1 a 5, como antes.']])}`,
    },
  ],
  faq: [
    ...faqComun,
    [`No puedo publicar una evaluación`, `Faltan criterios obligatorios por puntuar o campos obligatorios de registro. El contador «N de M obligatorios» y el mensaje al publicar dicen cuáles. Recuerda: un criterio opcional sin puntuar no bloquea.`],
    [`El puntaje máximo de un criterio cambió entre dos personas del mismo rol`, `Cada evaluación conserva el perfil (y por tanto los pesos) con el que se guardó. Si se creó una versión nueva del perfil, las evaluaciones nuevas usan la nueva; las anteriores, la suya.`],
    [`Una persona evaluada no tiene rol y no puedo evaluarla`, `Asígnale rol en ${b('Personas')} → su tarjeta → ${b('Gestión')}. Y confirma que el rol tenga un perfil en ${b('Roles y perfiles')}.`],
    [`No puedo eliminar un criterio`, `Si alguna evaluación o perfil lo usó, solo puede desactivarse: así no se pierde la historia.`],
    [`Los pesos no suman 100 y no me deja guardar el perfil`, `Es una regla de la base de datos: los pesos técnicos de una versión suman exactamente 100. El diálogo muestra la suma en vivo.`],
    [`No me deja guardar en una gestión`, `Está archivada: es de solo lectura. Abre la gestión activa.`],
    [`Alguien dice que no le llegan los correos`, `Revisa que su acceso esté aprobado y que su correo esté confirmado; confirma también su correo real en Personas. Sin correo confirmado la persona no puede iniciar sesión.`],
  ],
};

/* ── Página ─────────────────────────────────────────────────────────── */
function pagina(m) {
  const toc = [...m.secciones.map(s => [s.id, s.titulo]), ['permisos', 'Permisos y límites'], ['faq', 'Preguntas frecuentes']];
  const cuerpo = m.secciones.map((s, i) => `<section id="${s.id}"><h2><span class="num">${i + 1}</span>${s.titulo}</h2>${s.html}</section>`).join('\n');
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#002247">
  <title>${m.titulo} — EIGHT CREATORS LABs</title>
  <link rel="icon" type="image/png" sizes="64x64" href="../favicon-64.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@500;600&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">
  <script src="../core/theme.js"></script>
  <link rel="stylesheet" href="../shared.css">
  <link rel="stylesheet" href="ayuda.css">
</head>
<body class="ayuda">
<a href="#contenido" class="skip-link">Saltar al contenido</a>
<header class="ay-cab">
  <a class="ay-volver" href="../index.html">← Volver al portal</a>
  <nav class="ay-otros" aria-label="Otros manuales">
    <a href="miembro.html"${m.archivo === 'miembro' ? ' aria-current="page"' : ''}>Miembros</a>
    <a href="secretario.html"${m.archivo === 'secretario' ? ' aria-current="page"' : ''}>Secretarías</a>
    <a href="admin.html"${m.archivo === 'admin' ? ' aria-current="page"' : ''}>Administración</a>
  </nav>
</header>
<main id="contenido" class="ay-main">
  <div class="ay-hero">
    <p class="ay-sup">EIGHT CREATORS LABs · CELIDER 08 Santiago</p>
    <h1>${m.titulo}</h1>
    <p class="ay-sub">${m.sub}</p>
    <p>${m.resumen}</p>
    <p class="ay-aviso">Las capturas son del entorno de pruebas del portal con <b>datos de ejemplo</b> (nombres y cifras inventados). En el celular real, la barra de arriba y la de abajo se ven igual.</p>
  </div>
  <nav class="ay-toc" aria-labelledby="ay-toc-t">
    <h2 id="ay-toc-t">Contenido</h2>
    <ol>${toc.map(([id, t]) => `<li><a href="#${id}">${t}</a></li>`).join('')}</ol>
  </nav>
  ${cuerpo}
  <section id="permisos"><h2><span class="num">${m.secciones.length + 1}</span>Permisos y límites</h2>
    <p>Lo que puedes y no puedes hacer con este tipo de cuenta. Los permisos los decide la base de datos, no la pantalla: si un botón no aparece, es porque tu cuenta no puede hacerlo.</p>
    ${tabla(['Acción', 'Con tu cuenta'], m.permisos)}
  </section>
  <section id="faq"><h2><span class="num">${m.secciones.length + 2}</span>Preguntas frecuentes y problemas comunes</h2>
    ${m.faq.map(([p, r]) => faq(p, r)).join('\n')}
  </section>
  <footer class="ay-pie">Manual generado a partir de las pantallas actuales del portal. Si algo no coincide con lo que ves, avisa a la administración.</footer>
</main>
</body>
</html>
`;
}

for (const m of [miembro, secretario, admin]) {
  fs.writeFileSync(new URL(m.archivo + '.html', SALIDA), pagina(m));
  console.log('ayuda/' + m.archivo + '.html');
}
