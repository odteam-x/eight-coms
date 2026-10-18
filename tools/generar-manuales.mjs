// Genera los tres manuales de uso (ayuda/miembro.html, ayuda/secretario.html, ayuda/admin.html).
//   node tools/generar-manuales.mjs
// El contenido vive aquí, en un solo sitio, y SOLO describe lo que la plataforma hace hoy: cada procedimiento
// sale de una pantalla que existe. Lo que está en camino aparece en la sección «Próximamente» de cada manual.
// Cada captura tiene versión de celular (img/X.jpg) y, si existe, de computadora (img/X-pc.jpg): el manual muestra la que
// corresponde al dispositivo desde el que se lee (ver `.captura--dual` en ayuda.css).
// Las capturas (ayuda/img/*.jpg) son del entorno de pruebas con datos de ejemplo (npm run ui en tools/pruebas).
import fs from 'node:fs';

const SALIDA = new URL('../ayuda/', import.meta.url);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ── Piezas ─────────────────────────────────────────────────────────── */
const b = t => `<b>${t}</b>`;                       // un botón, icono o menú del portal
const pasos = (...p) => `<ol class="pasos">${p.map(x => `<li>${x}</li>`).join('')}</ol>`;
const nota = (tipo, t) => `<aside class="nota nota--${tipo}"><b>${{ consejo: 'Consejo', ojo: 'Importante', ejemplo: 'Ejemplo' }[tipo]}.</b> ${t}</aside>`;
const tienePC = img => fs.existsSync(new URL(`img/${img}-pc.jpg`, SALIDA));
const captura = (img, pie) => tienePC(img)
  ? `<figure class="captura captura--dual"><div class="captura-marco"><picture><source media="(min-width: 900px)" srcset="img/${img}-pc.jpg"><img src="img/${img}.jpg" alt="${esc(pie)}" loading="lazy"></picture></div><figcaption>${pie}</figcaption></figure>`
  : `<figure class="captura"><div class="captura-marco"><img src="img/${img}.jpg" alt="${esc(pie)}" loading="lazy"></div><figcaption>${pie}</figcaption></figure>`;
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
<h3>Qué te llega por correo</h3>
<p>Para no llenarte la bandeja, <b>por correo solo te llegan los avisos importantes</b>: acceso aprobado, tarea asignada o cambiada, tarea vencida, que te devuelvan una entrega, calificaciones y cambios de equipo. Los demás (recordatorios, «tarea aprobada», actividades nuevas, etc.) <b>siempre están en la campana</b>; si los quieres también por correo, enciéndelos en ${b('Avisos')} → ${b('Preferencias')}. Los importantes no se pueden apagar.</p>
${nota('consejo', 'Si no te llega un correo, mira primero la campana: el aviso siempre está ahí. Revisa también la carpeta de spam la primera vez.')}
${nota('ojo', 'Si el panel dice que los avisos «aún no están activos», la actualización de la base de datos (migración 0022) no se ha aplicado.')}`,
});

const comunCuenta = {
  id: 'cuenta', titulo: 'Mi cuenta',
  html: `
<p>Es tu espacio personal. Se abre con tu nombre (computadora) o desde ${b('Más')} → tu nombre (celular). Arriba están tu foto, tu nombre y tus etiquetas (tipo de acceso y distrito); debajo, <b>cuatro pestañas</b> para que veas una cosa a la vez. El portal recuerda la última que usaste.</p>
${tabla(['Pestaña', 'Qué hay'], [
    [b('Perfil'), 'Tu nombre (con ' + b('Guardar') + '), tu correo, tu tipo de acceso y tu distrito (estos tres los asigna la administración), y <b>Tu tarjeta</b>: el fondo de tu perfil, elegido entre los siete patrones de la marca.'],
    [b('Mi rol'), 'Tu rol principal con sus responsabilidades y tus preferencias de rol (no aparece para la administración, que no se evalúa).'],
    [b('Seguridad'), 'Cambiar la contraseña: mínimo 8 caracteres, distinta de la actual.'],
    [b('App'), 'El tema (claro u oscuro), instalar el portal en tu celular, la bienvenida o las novedades, la ayuda y ' + b('Cerrar sesión') + '.']])}
${pasos(
    `${b('Cambiar foto')}: elige cualquier imagen del teléfono o la computadora; no importa su tamaño. El portal la recorta en cuadrado y la reduce solo (queda ligera, de pocos KB).`,
    `${b('Perfil')} → ${b('Nombre')}: escríbelo y toca ${b('Guardar')}.`,
    `${b('Perfil')} → ${b('Tu tarjeta')}: elige un fondo o ${b('Auto')}. Lo ven también quienes pueden abrir tu perfil (tu secretaría y la administración).`,
    `${b('Seguridad')}: ${b('Nueva contraseña')} y ${b('Repite la contraseña')} → ${b('Cambiar contraseña')}.`,
    `${b('App')}: ${b('Tema')}, ${b('Instalar en tu celular')} (ver «Entrar y moverte») y ${b('Cerrar sesión')}.`)}
${captura('m-cuenta', 'Mi cuenta: tu foto y tus datos arriba y, debajo, las pestañas Perfil, Mi rol, Seguridad y App.')}
<p>Correo, tipo de acceso y distrito aparecen en «Tus datos» solo para que los veas: los asigna la administración.</p>`,
};

const faqComun = [
  [`No puedo entrar: dice «acceso pendiente»`, `Tu cuenta aún no la aprobó la administración. Cuando lo haga te llegará un correo. Si ya pasó tiempo, avisa a tu secretaría de distrito o a la administración.`],
  [`No me llegó el correo de confirmación o el código`, `Revisa «Spam». El correo sale de la cuenta del portal; si pasan unos minutos, pide otro desde ${b('Entrar')} → ${b('Olvidé mi contraseña')} (o el reenvío de confirmación). Si nunca llega, avisa a la administración: puede ser un correo mal escrito.`],
  [`La pantalla se ve vieja o algo no carga`, `Recarga la página (en la app instalada, ciérrala y vuelve a abrirla). Si el portal muestra un error con un botón ${b('Reintentar')}, púlsalo: pasa cuando se corta el internet un instante.`],
  [`El texto o los botones se ven pequeños`, `El portal usa letras más grandes en el celular por sí solo. Si aun así te cuesta, aumenta el tamaño de letra del sistema del teléfono: el portal lo respeta.`],
  [`No veo la campana / no sube el contador`, `El contador se actualiza cada minuto y al volver a la pestaña. Si no aparece ningún aviso nunca, mira el mensaje dentro del panel de avisos: te dice si la función aún no está activa.`],
  [`No veo un período (PE) que sí existe`, `Cada persona ve <b>solo los períodos en los que participó</b>. Si la administración te marcó como «No participa» en un PE, ese PE no aparece en tus selectores, tu perfil ni tu calendario. Si crees que es un error, pide que revisen tu participación en <i>Personas → Gestión</i>.`],
  [`No me llegan correos de algunos avisos`, `Por correo solo salen los avisos importantes. Los demás están siempre en la campana; para recibirlos también por correo, enciéndelos en <i>Avisos → Preferencias</i>.`],
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
    ['Ver tu historial: todos los períodos con el estado de tu evaluación y tus tareas', 'Sí (en Mi perfil → Períodos)'],
    ['Elegir tus preferencias de rol y un rol predeterminado', 'Sí, en Mi cuenta. Son informativas: no te dan permisos ni te impiden recibir otro trabajo'],
    ['Evaluarte o evaluar a otras personas', 'No'],
    ['Ver a otras personas', 'No: solo tu información'],
    ['Cambiar tu rol principal, los roles que tienes habilitados, tu distrito o tu tipo de acceso', 'No: los asigna la administración'],
  ],
  secciones: [
    comunAcceso('miembro'),
    {
      id: 'bienvenida', titulo: 'Bienvenida y novedades',
      html: `
<p>Hay <b>dos recorridos</b> y te toca uno según tu caso: la <b>bienvenida</b>, si llegaste ahora, y las <b>novedades</b>, si ya usabas el portal. En los dos se abre sola una vez, con progreso («Paso 3 de 5») y puedes dejarla a medias y retomarla.</p>
<h3>Si llegaste ahora: la bienvenida</h3>
<p>La primera vez que entras se abre sola una guía de cinco pasos: <b>conocer tu rol</b>, <b>poner tu foto</b>, <b>contar qué rol te gustaría hacer</b>, <b>mirar tus fechas</b> y <b>cómo se entrega un trabajo</b>. Cada paso explica qué es y te lleva a la pantalla donde se hace.</p>
${captura('m-bienvenida', 'La bienvenida: el avance («Paso 3 de 5 · 3 hechos»), la lista de pasos y el paso actual.')}
${pasos(
    `Lee el paso y toca ${b('Hecho, seguir')}. Si el paso tiene un botón (por ejemplo ${b('Elegir mis preferencias')}), te lleva a esa pantalla y tu avance queda guardado.`,
    `Puedes dejarla a medias con ${b('Ahora no')}. En ${b('Inicio')} queda una tarjeta ${b('Primeros pasos')} con tu avance y un botón ${b('Continuar')}: retomas justo donde ibas.`,
    `Algunos pasos se marcan solos si ya los hiciste (por ejemplo, si ya tienes foto o preferencias de rol).`,
    `Al terminar, la tarjeta desaparece. Puedes repasarla cuando quieras desde ${b('Mi cuenta')} → ${b('App')} → ${b('Bienvenida')}, o ${b('Empezar de nuevo')}.`)}
${captura('m-primeros-pasos', 'La tarjeta «Primeros pasos» en Inicio, con la barra de avance y el botón Continuar.')}
<h3>Si ya usabas el portal: las novedades</h3>
<p>En vez de la bienvenida ves <b>Novedades del portal</b>: cinco pasos con lo que cambió, cada uno con un botón que te lleva a esa pantalla. Son <i>Mi cuenta ordenada en pestañas</i>, <i>tu rol con lo que se espera de él</i>, <i>tus preferencias de rol</i>, <i>tu historial de todos los períodos</i> y <i>actividades solo para quien corresponde</i>. Se abre sola la primera vez; después queda la tarjeta ${b('Novedades')} en ${b('Inicio')} hasta que la termines, y puedes repasarla desde ${b('Mi cuenta')} → ${b('App')}.</p>
${captura('s-novedades', 'Las novedades del portal (aquí, la versión de la secretaría): el mismo formato que la bienvenida, con pasos distintos.')}
${nota('consejo', 'Quien llega después de esta actualización ve la bienvenida; quien ya estaba, las novedades. Si cierras la ventana con ' + b('Ahora no') + ', no vuelve a abrirse sola: la retomas cuando quieras desde ' + b('Mi cuenta') + '.')}`,
    },
    {
      id: 'inicio', titulo: 'Inicio: qué pasa ahora',
      html: `
<p>Es la primera pantalla. Responde a «qué necesito hacer ahora».</p>
${captura('m-inicio', 'Inicio: cuenta regresiva, tu evaluación y lo que requiere atención.')}
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
${captura('m-perfil', 'Mi perfil: tu cabecera, el período y las pestañas Resumen, Criterios, Tareas, Períodos y Evolución.')}
${tabla(['Pestaña', 'Qué muestra'], [
        ['Resumen', 'Tus indicadores del período (abajo) y la «lectura rápida»: los puntos más altos y donde hay más margen.'],
        ['Criterios', 'Cada criterio con tu puntaje, su barra y, si lo hay, el comentario de quien evaluó. En «¿Cómo se puntúa?» está la descripción de cada nivel.'],
        ['Tareas', 'Las tareas de ese período y su estado.'],
        ['Períodos', 'Una tarjeta por PE: sus fechas, si participas y con qué rol, el resultado de tu evaluación, tus tareas (asignadas, a tiempo, aprobadas, vencidas) y las actividades relacionadas. «Ver detalle» abre ese PE en el resumen.'],
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
<p>En la pestaña ${b('Períodos')} hay una tarjeta por PE: para cada período, el estado de tu evaluación (publicada o aún no), tu resultado con su nivel y los hechos de tus tareas (cuántas, cuántas entregaste a tiempo, cuántas vencidas). Solo ves lo tuyo; un borrador de evaluación no aparece hasta que se publica.</p>
${nota('ojo', 'Los períodos anteriores a la «rúbrica por roles» se muestran con la <b>rúbrica clásica</b> (7 criterios del 1 al 4, sobre 30 con el bono). Tienen otra escala y no se mezclan ni se comparan con los nuevos.')}`,
    },
    {
      id: 'tareas', titulo: 'Entregas: tus tareas',
      html: `
<p>Una tarea es lo que se te pidió, para cuándo y qué hiciste. Así, cuando te evalúen, se mira lo que realmente pasó.</p>
${captura('m-entregas', 'Entregas: filtros, «+ Mi iniciativa» y una tarea devuelta con su observación.')}
<h3>Tareas del equipo</h3>
<p>Si perteneces a un <b>equipo</b>, debajo de tus tareas ves ${b('Mis equipos')} y las <b>tareas del equipo</b>: una tarea compartida para todo el grupo. Puedes <b>registrar un aporte</b> (qué avanzaste y el avance en %), y cualquiera del equipo puede <b>entregarla</b> con un enlace y/o una nota (es una sola entrega para todos). No puedes aprobarla ni mover su fecha. La nota es <b>del grupo</b> y cuenta una vez para cada integrante.</p>
${nota('consejo', 'Tus puntos de tareas ya entran a tu resultado. En «Mi perfil» → Resumen, «Cómo se compone tu evaluación» te muestra tarea por tarea cuál cuenta, cuánto aporta y por qué otra no cuenta.')}
<h3>Los estados</h3>
${tabla(['Estado', 'Qué significa', 'Qué puedes hacer'], [
        ['Asignada', 'Te la asignó tu secretaría o la administración.', 'Empezarla o entregarla.'],
        ['En curso', 'La estás haciendo.', 'Entregarla.'],
        ['Entregada', 'Ya la entregaste; espera revisión.', 'Esperar. Quien revisa la aprueba o la devuelve.'],
        ['Devuelta', 'Quien revisa te dejó una observación.', `${b('Entregar corregida')} o ${b('Retomar')}.`],
        ['Aprobada', 'Quedó aprobada y con puntos (0 a 10).', 'Nada: los puntos entran a tu nota de tareas, que cuenta en tu resultado según las reglas del período.'],
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
<p>Reúne en un solo lugar las fechas de los períodos, las actividades del equipo o de tu distrito, y las fechas de tus tareas. Una actividad pensada solo para algunas personas la ves <b>únicamente si estás entre ellas</b>.</p>
${captura('m-calendario', 'Calendario del mes con puntos de colores por tipo y el panel del día.')}
${pasos(`Abre ${b('Calendario')}. Los puntos de colores marcan lo que hay cada día; el día de hoy está en coral.`, `Toca un día: abajo aparece lo que hay ese día.`, `Toca ${b('+ Mi iniciativa')} para crear una tarea propia con esa fecha.`)}`,
    },
    {
      id: 'roles', titulo: 'Mi rol y mis preferencias de rol',
      html: `
<p>En ${b('Mi cuenta')} → ${b('Mi rol y mis preferencias')} hay dos cosas distintas que conviene no confundir:</p>
${tabla(['Qué es', 'Quién lo define', 'Para qué sirve'], [
        ['Tu <b>rol principal</b> y los roles que tienes <b>habilitados</b>', 'La administración', 'Son los roles que puedes asumir. El principal define con qué perfil te evalúan.'],
        ['Tus <b>preferencias</b> y tu <b>rol predeterminado</b>', 'Tú', 'Le dicen a quien reparte las tareas qué te gustaría hacer. <b>No te dan permisos ni te impiden recibir otro trabajo.</b>']])}
${captura('m-preferencias', 'Mis preferencias de rol: el orden, si cada rol está habilitado, el predeterminado (estrella) y los botones para subir, bajar y quitar.')}
${pasos(
    `Abre ${b('Mi cuenta')} y busca <i>Qué rol me gustaría hacer</i>. Arriba ves la descripción y las responsabilidades de tu rol principal.`,
    `Elige un rol en la lista y toca ${b('Agregar')}. Puedes tener hasta 8. Ordénalos con las flechas ${b('↑')} ${b('↓')}: el primero es el que más quieres.`,
    `Toca la estrella ${b('★')} de un rol para dejarlo como <b>predeterminado</b>. Solo puede serlo un rol que ya tengas habilitado; los demás muestran «Aún no habilitado».`,
    `Toca ${b('Guardar preferencias')}.`)}
${nota('ojo', 'Puedes poner como preferencia un rol que todavía no tienes habilitado: sirve para que la administración sepa que te interesa. Pero habilitarlo es decisión suya.')}`,
    },
    comunAvisos('miembro'),
    comunCuenta,
    {
      id: 'buscar', titulo: 'Buscar',
      html: `<p>En computadora, ${b('Ctrl + K')} (o ${b('⌘ K')} en Mac); en celular, la ${b('lupa')} de la cabecera. Escribe y salta a una sección o inicia una acción. Solo ofrece lo que tu cuenta puede hacer.</p>`,
    },
    {
      id: 'proximamente', titulo: 'Próximamente',
      html: `
<p>Estas mejoras están en camino. Mientras llegan, cada una tiene su alternativa:</p>
${lista(
        `<b>Pedir un rol desde el portal.</b> Próximamente podrás solicitar que te habiliten un rol. Mientras tanto, tus preferencias le sirven a la administración para decidirlo.`,
        `<b>Roles dentro de una actividad.</b> Próximamente las actividades del calendario podrán llevar roles. Por ahora llevan personas destinatarias.`,
        `<b>Tu reporte personal exportable.</b> Próximamente podrás descargarlo tú. Por ahora ves tus indicadores y tu historial en ${b('Mi perfil')}.`)}`,
    },
  ],
  faq: [
    ...faqComun,
    [`Mi tarea dice «vencida» pero ya la entregué`, `«Vencida» solo se usa para tareas sin entregar. Si la entregaste a tiempo, aparece «Entregada» o «Aprobada». Refresca la pantalla; si sigue igual, avísale a quien te la asignó.`],
    [`Me devolvieron una tarea. ¿Pierdo puntos?`, `No por devolverla: las devoluciones se cuentan como un dato de calidad que mira quien te evalúa, pero tu «a tiempo» se queda como en la primera entrega. Corrige y pulsa ${b('Entregar corregida')}.`],
    [`En mis preferencias un rol dice «Aún no habilitado»`, `Significa que la administración todavía no te habilitó ese rol. Puedes dejarlo en tu lista (sirve para que sepan que te interesa), pero no puedes dejarlo como predeterminado hasta que lo tengas.`],
    [`La bienvenida o las novedades no me aparecen`, `Se abren solas una sola vez. Si las cerraste con ${b('Ahora no')}, entra a ${b('Mi cuenta')} → ${b('App')} y búscalas ahí (se llaman «Bienvenida» o «Novedades del portal»). Si ahí tampoco están, la actualización de la base de datos (migración 0025) aún no se ha aplicado.`],
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
    ['Asignar tareas a las personas de tu distrito, con el rol de cada una', 'Sí, solo con un rol que la persona tenga habilitado'],
    ['Revisar entregas: aprobar (con puntos) o devolver (con observación)', 'Sí, solo las de tu distrito'],
    ['Aprobar tus propias tareas', 'No: no se aprueban a sí mismas'],
    ['Cambiar la fecha límite de una tarea que asignaste', 'Sí, con un motivo (la persona recibe un aviso)'],
    ['Evaluar (puntuar la rúbrica)', 'No: lo hace la administración'],
    ['Crear actividades para tu distrito o para personas de tu distrito', 'Sí'],
    ['Crear actividades para todo el equipo o para otro distrito', 'No: las crea la administración'],
    ['Ver el seguimiento de tu distrito en todos los períodos', 'Sí, solo de tu distrito'],
    ['Ver el reporte de tu distrito entre períodos y por actividad (con exportación)', 'Sí, solo de tu distrito'],
    ['Generar el reporte completo de evaluaciones (ranking, detalle por persona)', 'No: lo genera la administración'],
    ['Cambiar roles, roles habilitados, distritos o accesos', 'No'],
  ],
  secciones: [
    comunAcceso('secretario'),
    {
      id: 'bienvenida', titulo: 'Bienvenida y novedades',
      html: `
<p>Hay dos recorridos, según tu caso, y los dos se abren solos una vez: la <b>bienvenida</b> si llegaste ahora y las <b>novedades</b> si ya usabas el portal.</p>
<h3>Si llegaste ahora: la bienvenida</h3>
<p>Es una guía de cinco pasos para secretarías: <b>conocer tu rol</b>, <b>poner tu foto</b>, <b>conocer a tu distrito</b>, <b>asignar tu primera tarea</b> y <b>seguir a tu distrito</b>. Cada paso te lleva a la pantalla donde se hace y tu avance queda guardado.</p>
${pasos(
    `Toca ${b('Hecho, seguir')} en cada paso, o ${b('Ahora no')} para dejarla a medias.`,
    `En ${b('Inicio')} queda la tarjeta ${b('Primeros pasos')} con tu avance y ${b('Continuar')}.`,
    `Puedes repasarla desde ${b('Mi cuenta')} → ${b('App')} → ${b('Bienvenida')}.`)}
<h3>Si ya usabas el portal: las novedades</h3>
<p>Cinco pasos con lo que cambió para ti: <i>Mi cuenta en pestañas y tus preferencias de rol</i>, <i>Nueva tarea en tres pasos</i>, <i>actividades para personas de tu distrito</i>, <i>Seguimiento</i> y <i>Reportes de tu distrito</i>. Cada paso tiene un botón que te lleva a la pantalla.</p>
${captura('s-novedades', 'Las novedades del portal para la secretaría.')}
<p>En los dos casos tu avance queda guardado y ves la tarjeta ${b('Primeros pasos')} o ${b('Novedades')} en ${b('Inicio')} hasta que termines.</p>`,
    },
    {
      id: 'inicio', titulo: 'Inicio y tu espacio personal',
      html: `
<p>${b('Inicio')}, ${b('Mi perfil')}, ${b('Calendario')} y ${b('Entregas')} funcionan como en el manual del miembro (consulta ese manual para el detalle de la rúbrica, los estados de tareas y el calendario). En ${b('Inicio')}, además, hay un bloque con el estado de tu distrito.</p>
${captura('s-inicio', 'Inicio de la secretaría, con el bloque de novedades o primeros pasos mientras no lo termines.')}
${nota('consejo', 'En el celular, tus dos herramientas de trabajo (' + b('Distrito') + ' y ' + b('Tareas') + ') están en la barra inferior junto a ' + b('Inicio') + ' y ' + b('Entregas') + '. ' + b('Mi perfil') + ', ' + b('Calendario') + ', ' + b('Seguimiento') + ' y ' + b('Reportes') + ' están en ' + b('Más') + '.')}
<p>En ${b('Mi cuenta')} también eliges tus <b>preferencias de rol</b>, igual que un miembro (ver su manual).</p>`,
    },
    {
      id: 'distrito', titulo: 'Distrito: tu gente',
      html: `
<p>Tiene cuatro pestañas internas: ${b('Resumen')}, ${b('Personas')}, ${b('Estadísticas')} y ${b('Ranking de distritos')}.</p>
${captura('s-distrito', 'Distrito: indicadores del distrito y tarjetas de personas.')}
${pasos(
        `Abre ${b('Distrito')} y elige el período arriba (${b('PE1')}, ${b('PE2')}…).`,
        `${b('Resumen')} es lo primero que ves: tu posición entre los distritos y tu promedio sobre 28, un bloque ${b('Qué falta')} (por ejemplo, enviar las estadísticas de Instagram del período, con un botón directo) y tu evolución período por período con las cuatro competencias. Los otros distritos son confidenciales: ves solo el tuyo.`,
        `En ${b('Personas')} ves los indicadores del distrito (personas, promedio individual, tu posición, el general más alto) y una tarjeta por persona con su nota. En los períodos nuevos, cada tarjeta indica «N por revisar» y «N vencidas».`,
        `Toca una tarjeta para abrir el perfil de esa persona en un panel (en el celular, una hoja desde abajo). Ahí ves sus pestañas Resumen, Criterios, Tareas, Períodos y Evolución, igual que ella.`,
        `En ${b('Estadísticas')} subes, para el período elegido, las cifras de Instagram de la cuenta de tu distrito (visualizaciones, cuentas alcanzadas, visitas al perfil, seguidores netos y los porcentajes de publicaciones, historias y reels) y adjuntas una <b>captura de pantalla como prueba</b>. La captura se reduce sola antes de enviarse. Si otra secretaría de tu distrito ya las envió, las ves y puedes corregirlas mientras el período siga abierto. La administración las usa para evaluar al distrito.`,
        `En ${b('Ranking de distritos')} comparas los distritos del equipo.`)}
${nota('ojo', 'Solo ves a las personas de <b>tu</b> distrito. No es un filtro del portal: la base de datos no entrega más. Si falta alguien, la administración tiene que asignarle tu distrito.')}`,
    },
    {
      id: 'tareas', titulo: 'Tareas: asignar y revisar',
      html: `
<p>Aquí asignas trabajo a las personas de tu distrito y revisas lo que entregan. Tus propias tareas están en ${b('Entregas')}.</p>
${captura('s-tareas', 'Tareas: filtros por estado, filtro por persona, «+ Nueva tarea» y una entrega por revisar.')}
<h3>Asignar una tarea</h3>
<p>La asignación tiene tres pasos, para decidir con los datos delante: <b>Qué</b>, <b>Quién</b> y <b>Rol y resumen</b>.</p>
${pasos(
        `Abre ${b('Tareas')} y toca ${b('+ Nueva tarea')} (o, desde el perfil de una persona, ${b('Nueva tarea')}; o desde el calendario, en un día).`,
        `<b>Qué:</b> título, qué se espera, fecha límite, prioridad y, si hay varios períodos de rúbrica por roles, el período. Opcionalmente, una <b>actividad</b> del calendario y el <b>rol para el que es el trabajo</b>.`,
        `<b>Quién:</b> busca por nombre, rol o distrito y marca personas sueltas o un equipo entero (por rol). Cada persona muestra su rol, si tiene <b>habilitado</b> el rol elegido, si lo <b>prefiere</b> y cuánta <b>carga</b> tiene (tareas abiertas y vencidas).`,
        `<b>Rol y resumen:</b> eliges un rol <i>por persona</i>; al elegirlo ves sus responsabilidades y con qué competencias se evalúa. Marca qué competencias evidencia la tarea (opcional; ${b('Sugerir las del rol')} marca las principales) y revisa el resumen.`,
        `Toca ${b('Crear N tareas')}. Cada persona recibe un aviso (y un correo) con su tarea y su fecha.`)}
${captura('s-selector', 'Paso «Quién»: equipos y personas, con rol, compatibilidad con el rol elegido, preferencia y carga.')}
${captura('s-nueva-tarea', 'Paso «Rol y resumen»: un rol por persona, sus responsabilidades y los avisos antes de crear.')}
<h3>Los avisos antes de crear</h3>
${tabla(['Aviso', 'Qué pasa'], [
        ['<b>Rol no habilitado</b> (en rojo)', 'La persona no tiene habilitado ese rol: <b>no puedes crear la tarea</b>. Elige otro rol o pide a la administración que se lo habilite. (La base de datos también lo impide.)'],
        ['Ya tiene una tarea abierta con el mismo título', 'Aviso: puede ser un duplicado. Si es a propósito, marca «Entiendo los avisos…».'],
        ['Carga alta (5 o más tareas abiertas) o tareas vencidas', 'Aviso: ya tiene mucho trabajo. Puedes crearla igual.'],
        ['No participa en el período · fecha límite ya pasada', 'Aviso: la tarea no contaría en el resumen, o nacería vencida.']])}
${nota('consejo', 'La <b>preferencia</b> de una persona es solo información: puedes asignarle un rol que no prefiere si lo tiene habilitado. Y un rol que prefiere pero no tiene habilitado, no.')}
<h3>Equipos de tu distrito</h3>
<p>La administración arma <b>equipos</b> por período. En ${b('Tareas')} (y debajo de tus tareas en ${b('Entregas')}) ves los equipos <b>de tu distrito</b> o con integrantes tuyos. Puedes asignarles una <b>tarea del equipo</b> (una sola, compartida) y revisarla, <b>siempre que tú no seas integrante</b> de ese equipo. Aprobar o devolver funciona igual que con una tarea individual; la <b>nota es del grupo</b>. No creas ni cambias equipos: eso lo hace la administración.</p>
<h3>Revisar una entrega</h3>
${pasos(
        `Entra a ${b('Tareas')} y usa el filtro ${b('Por revisar')} (muestra el número).`,
        `Pulsa ${b('Ver entrega')} para leer el enlace o la nota.`,
        `Si está bien, ${b('Aprobar')}: <b>es obligatorio ponerle puntos de 0 a 10</b>. Los puntos <b>sí cuentan</b>: entran a la nota de tareas de la persona, según las reglas del período (la administración las define). Si quieres que una tarea pese más, ajusta el <b>Peso de la tarea</b> al aprobar.`,
        `Si hay que corregir, ${b('Devolver')} y escribe la observación (obligatoria). La persona recibe un aviso con tu observación.`)}
${tabla(['Botón', 'Para qué'], [
        [b('Editar'), 'Cambiar el título, la descripción o la prioridad de una tarea que asignaste.'],
        ['Mover el plazo', 'Cambia la fecha límite con un motivo (mínimo 5 caracteres). La fecha original queda registrada y la persona recibe un aviso.'],
        [b('Historial'), 'Cada cambio: quién, qué y cuándo. No se puede borrar.'],
        ['Filtro por persona', 'Ver solo las tareas de una persona.']])}
${nota('consejo', 'Una tarea con fecha límite «a tiempo» se mide en la <b>primera</b> entrega: corregir una observación no la hace tarde. Así evitas castigar a quien corrige bien.')}
${nota('ojo', 'Las tareas solo existen en los períodos de la rúbrica por roles. En los períodos clásicos, esta pestaña lo explica y no deja crear tareas.')}`,
    },
    {
      id: 'actividades', titulo: 'Crear actividades para tu distrito',
      html: `
<p>Desde ${b('Calendario')}, toca un día y ${b('Nueva actividad')}. (Para editarla o eliminarla, ábrela desde el panel del día.)</p>
${pasos(
        `Escribe el <b>título</b>, una descripción si quieres, el <b>tipo</b> (Entrega, Jornada, Capacitación, Reunión…; da el color en el calendario) y las fechas (<i>Hasta</i> solo si dura varios días).`,
        `En <b>Para quién</b> elige ${b('Mi distrito')} (la ven todas las personas de tu distrito) o ${b('Personas y equipos')} (solo las que elijas).`,
        `Con <i>Personas y equipos</i> aparece el mismo selector de las tareas: busca, filtra por Todos / Equipos / Personas y marca personas o un equipo entero. Debajo, una frase te dice a cuántas personas se avisará.`,
        `Guarda. Quienes quedan como destinatarias reciben un aviso (y otro la víspera); nadie más la ve.`)}
${captura('s-actividad', 'Nueva actividad «Para quién»: personas y equipos de tu distrito, y cuántas personas recibirán el aviso.')}
${nota('ojo', 'Solo puedes elegir personas de <b>tu</b> distrito, y no puedes crear actividades para todo el equipo ni para otro distrito: eso lo hace la administración. Elegir un equipo agrega a sus miembros de ese momento; quien entre después al equipo no se suma sola.')}`,
    },
    {
      id: 'seguimiento', titulo: 'Seguimiento: tu distrito en todos los períodos',
      html: `
<p>${b('Seguimiento')} muestra a las personas de tu distrito <b>agrupadas por rol</b>, con una columna por período: el estado de su evaluación (publicada o sin publicar), su resultado con su nivel y los hechos de sus tareas.</p>
${captura('s-seguimiento', 'Seguimiento: indicadores con numerador y denominador, filtros y un grupo por rol.')}
${lista(
        `<b>Indicadores de arriba:</b> evaluaciones publicadas (personas con evaluación publicada ÷ personas que participan, en los períodos ya en juego), entregas a tiempo (entregadas dentro del plazo ÷ entregadas con plazo) y tareas vencidas. Cada cifra dice «N de M».`,
        `<b>Filtros:</b> buscar a una persona, filtrar por rol y ${b('Solo con pendientes')} (evaluación sin publicar o tareas vencidas).`,
        `<b>Cada rol</b> es un grupo que se pliega. Toca el nombre de una persona para abrir su perfil.`,
        `Los resultados de la rúbrica por roles (sobre 100) y de la clásica (otra escala) se muestran por separado y no se promedian entre sí.`)}
${nota('ojo', 'Solo ves a tu distrito (no es un filtro del portal: la base de datos no entrega más) y solo evaluaciones <b>publicadas</b>: un borrador aparece como «Sin publicar», sin puntaje.')}`,
    },
    {
      id: 'reportes', titulo: 'Reportes de tu distrito',
      html: `
<p>Arriba de ${b('Reportes')} tienes <b>Todos los PE</b>: una hoja con todos los períodos de tu distrito a la vez (personas que participan, evaluaciones publicadas, resultado promedio, tareas, entregas a tiempo y vencidas). Desde la fila de un PE abres su reporte completo; ${b('Ver las personas que componen estas cifras')} muestra quiénes suman cada número. Solo incluye a las personas de tu distrito.</p>

<p>${b('Reportes')} (en ${b('Más')} en el celular) reúne dos cortes de tu distrito para llevar a una reunión:</p>
${captura('s-reportes', 'Reporte del distrito: un cuadro por período con publicadas, promedio, entregas a tiempo y vencidas.')}
${lista(
        `<b>Entre períodos:</b> por cada período, evaluaciones publicadas («4 de 5 personas»), promedio, entregas a tiempo («2 de 3 entregas con plazo») y tareas vencidas; y el promedio por rol de un período a otro.`,
        `<b>Por actividad:</b> las tareas vinculadas a cada actividad: entregadas, a tiempo, aprobadas, vencidas y puntos promedio.`)}
${pasos(
        `Abre ${b('Reportes')}.`,
        `Usa ${b('CSV por período')} o ${b('CSV por actividad')} para llevar el cuadro a una planilla (numerador y denominador salen en columnas separadas).`,
        `Usa ${b('Descargar PDF')} para imprimir la hoja con el tema claro.`)}
<p>Al final de la hoja, «Cómo se calcula» explica cada cifra. Cuando un denominador es 0 se muestra «—», nunca 0 %.</p>
${nota('consejo', 'Para el reporte completo de evaluaciones (ranking, detalle por persona, por competencia) pídeselo a la administración.')}`,
    },
    comunAvisos('secretario'),
    comunCuenta,
    {
      id: 'proximamente', titulo: 'Próximamente',
      html: `<p>Estas mejoras están en camino. Mientras llegan, cada una tiene su alternativa:</p>
${lista(
        `<b>Pedir que habiliten un rol a una persona.</b> Próximamente podrás proponérselo a la administración desde el portal. Por ahora, avísale y ella lo marca en ${b('Personas')} → ${b('Gestión')}.`,
        `<b>Reporte completo de evaluaciones de tu distrito</b> (ranking, detalle por persona y por competencia). Próximamente. Mientras tanto tienes ${b('Seguimiento')} y los dos cuadros de ${b('Reportes')}; el reporte completo se lo puedes pedir a la administración.`,
        `<b>Roles dentro de una actividad.</b> Próximamente. Por ahora una actividad lleva personas destinatarias y cada tarea lleva su rol.`)}
<p>Lo que no está en esta lista es porque así está pensado: por ejemplo, <b>puntuar la rúbrica la hace la administración</b> y cada secretaría ve solo su distrito.</p>`,
    },
  ],
  faq: [
    ...faqComun,
    [`No veo a una persona de mi distrito`, `La administración tiene que asignarle tu distrito en <i>Personas</i>. Hasta entonces, la base de datos no te la muestra.`],
    [`No me deja crear la tarea: dice «No tiene habilitado…»`, `Esa persona no tiene habilitado el rol que elegiste. Elige uno de sus roles habilitados (aparecen primero en la lista) o pide a la administración que se lo habilite en ${b('Personas')} → ${b('Gestión')}.`],
    [`Elegí a un equipo y no quedaron todas las personas`, `Un equipo agrega a sus miembros <b>de ese momento</b> y, en tu caso, solo los de tu distrito. Revisa los chips de arriba: ahí ves exactamente quiénes quedaron.`],
    [`No me deja aprobar una tarea`, `Dos causas: no tiene puntos (obligatorios de 0 a 10) o es una tarea tuya (nadie aprueba la propia). Pídele a la administración que la apruebe.`],
    [`¿Por qué «Devolver» me pide una observación?`, `Para que la persona sepa qué corregir. Escríbela concreta: qué falta y cómo lo quieres.`],
    [`Asigné una tarea y a la persona no le llegó el aviso`, `El aviso aparece en su campana y sale por correo en los minutos siguientes. Si no tiene correo registrado o aún no aprobaron su acceso, no se le envía.`],
  ],
};

/* ── Manual de la administración ─────────────────────────────────────── */
const admin = {
  archivo: 'admin', titulo: 'Manual para administración', sub: 'Cómo gestionar el portal de EIGHT CREATORS LABs',
  resumen: `Tienes el control completo: personas y accesos, evaluaciones, tareas y equipos, la nota de tareas, distritos con sus estadísticas, calendario, reportes, correos y la configuración de la rúbrica. Este manual explica <b>cada pantalla paso a paso</b> y separa lo que usas cada día (operación) de lo que configuras de vez en cuando.`,
  permisos: [
    ['Ver y gestionar a todas las personas', 'Sí'],
    ['Aprobar accesos y asignar rol, distrito, tipo de acceso y administración', 'Sí'],
    ['Evaluar y publicar evaluaciones', 'Sí'],
    ['Corregir los puntos de una tarea ya aprobada', 'Sí (es lo único que se corrige después)'],
    ['Crear períodos, activar uno, definir fechas', 'Sí'],
    ['Crear actividades (todo el equipo, un distrito o personas elegidas) y administrar los tipos (etiquetas)', 'Sí'],
    ['Describir cada rol (qué hace, responsabilidades, requisitos) y habilitar roles a cada persona', 'Sí'],
    ['Asignar un rol que la persona no tiene habilitado', 'Sí, como excepción: la tarea queda marcada «Excepción de rol»'],
    ['Ver el seguimiento de todas las personas en todos los períodos de la gestión', 'Sí'],
    ['Crear, editar, ordenar, desactivar y eliminar criterios', 'Sí (eliminar solo si ninguna evaluación lo usó)'],
    ['Crear versiones de perfiles por rol', 'Sí'],
    ['Crear equipos, sumar o retirar integrantes y archivarlos', 'Sí (solo la administración)'],
    ['Asignar y revisar tareas del equipo; poner una nota individual', 'Sí'],
    ['Cambiar las reglas de tareas de un período (peso, multiplicadores, mínimo)', 'Sí, con motivo si ya hay evaluaciones publicadas'],
    ['Corregir, anular o restaurar la nota de una tarea', 'Sí, con motivo (mínimo 5 caracteres)'],
    ['Evaluar y publicar a un distrito', 'Sí (solo la administración)'],
    ['Ver las estadísticas de Instagram de todos los distritos y corregirlas', 'Sí'],
    ['Ver los borradores de evaluación de personas y distritos', 'Sí (los demás no los ven)'],
    ['Ver el estado de los correos enviados', 'Sí'],
    ['Escribir en una gestión archivada', 'No: queda solo de lectura'],
    ['Generar y exportar reportes (incluidos entre períodos y por actividad)', 'Sí'],
  ],
  secciones: [
    comunAcceso('admin'),
    {
      id: 'bienvenida', titulo: 'Bienvenida y novedades',
      html: `
<p>Hay dos recorridos y los dos se abren solos una vez. Si <b>ya usabas el portal</b>, ves <b>Novedades del portal</b>: <i>describe cada rol</i>, <i>roles permitidos por persona</i>, <i>Nueva tarea con rol por persona</i>, <i>actividades para el equipo, un distrito o personas</i> y <i>seguimiento y reportes entre períodos</i>. Si <b>llegas ahora</b>, ves la <b>bienvenida</b>:</p>
<p>La bienvenida es una guía de cinco pasos: <b>revisar los períodos</b>, <b>describir los roles y sus perfiles</b>, <b>aprobar accesos y asignar rol y distrito</b>, <b>hacer tu primera evaluación</b> y <b>mirar el seguimiento global</b>. Cada paso te lleva a la pantalla; tu avance queda guardado y el ${b('Panel')} muestra la tarjeta ${b('Primeros pasos')} con ${b('Continuar')} hasta que termines (o digas ${b('Ahora no')}). Se repasa desde ${b('Mi cuenta')} → ${b('App')} → ${b('Bienvenida')}.</p>
<p>Cada recorrido tiene su versión para creator, secretaría y administración, y cada persona retoma donde quedó. En ${b('Mi cuenta')} → ${b('App')} puedes repasarlo. Las personas que ya usaban el portal cuando se aplicó la actualización 0025 reciben las <b>novedades</b>; quienes se registren desde entonces, la <b>bienvenida</b>.</p>`,
    },
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
${captura('a-panel', 'Panel: avisos que piden acción y el avance de evaluaciones.')}
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
${nota('consejo', 'Si dejaste borradores que ya no sirven, ' + b('Eliminar borrador') + ' (en el formulario de una persona) borra el borrador de esa persona, y ' + b('Eliminar el borrador') + ' o ' + b('Eliminar los N borradores') + ' (arriba, junto a los estados) borra los borradores del período. Antes de borrar se pide confirmación y las evaluaciones <b>publicadas</b> no se tocan.')}
${captura('a-evaluar-nucleo', 'Formulario: cada criterio tiene una barra, un número editable y botones − / +.')}
<h3>La barra de puntos</h3>
<p>Cada criterio se puntúa <b>de 0 hasta su propio peso</b>. Un criterio técnico con peso 30 va de 0 a 30; uno con peso 15, de 0 a 15; los criterios del núcleo, de 0 a 10. La escala se ve debajo del nombre («Escala 0 a 30 · peso 30»).</p>
${tabla(['Para…', 'Haz'], [
        ['Mover el valor', 'Arrastra la bolita de la barra con el dedo o el cursor.'],
        ['Elegir un número exacto', 'Escríbelo en la casilla de la derecha (si te pasas del máximo, se corrige solo).'],
        ['Ajustar de a uno', `Toca ${b('−')} o ${b('+')}. Desde «sin puntuar», ${b('+')} empieza en 1 y ${b('−')} en 0.`],
        ['Dejarlo sin puntuar', 'Borra el número de la casilla. «Sin puntuar» no vale 0: el criterio queda fuera del cálculo.']])}
${captura('a-evaluar-tecnico', 'Criterios técnicos: «Escala 0 a 30 · peso 30» y la barra por encima del número.')}
${nota('ojo', 'El <b>resultado final</b> de la persona incluye también su <b>nota de tareas</b> según las reglas del período (ver «Cómo cuentan las tareas en la evaluación»). Lo que ves en este formulario es solo la parte que tú puntúas.')}
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
${pasos(`Toca una tarjeta: se abre su perfil y una pestaña extra, ${b('Gestión')}.`, `En ${b('Gestión')} asignas <b>rol</b>, <b>distrito</b>, <b>tipo de acceso</b> (Creator, Secretario), <b>acceso aprobado</b>, <b>administración</b>, los <b>roles permitidos</b>, su <b>participación en el período</b> y puedes <b>eliminar</b> a la persona.`, `Para un registro nuevo: abre su tarjeta, asígnale rol y distrito y activa ${b('Acceso aprobado')}. Le llega un correo.`)}
<h3>Roles permitidos y preferencias</h3>
<p>En ${b('Gestión')} → <b>Roles permitidos</b> marcas, además del rol principal, los roles que esa persona puede asumir. Cada casilla se guarda al marcarla. Debajo ves <b>lo que la persona prefiere</b> (el orden que ella eligió y su rol predeterminado), solo para informar.</p>
${captura('a-roles-permitidos', 'Gestión de una persona: roles permitidos (casillas) y, debajo, sus preferencias de solo lectura.')}
${lista(
        `El <b>rol principal</b> define con qué perfil se evalúa a la persona. Los <b>permitidos</b> definen con qué roles se le pueden asignar tareas.`,
        `Una <b>preferencia</b> no concede ni quita nada: una persona puede preferir un rol que no tiene permitido (aparece como «No habilitado»).`,
        `Si quitas un rol permitido que la persona tenía como predeterminado, se limpia el predeterminado, pero su preferencia se conserva.`,
        `Los roles <b>funcionales</b> (administración, secretaría, miembro) son otra cosa y se cambian con ${b('Administradora')} y ${b('Tipo de miembro')}.`)}
${nota('ojo', 'Quien se registra queda con acceso pendiente, sin rol ni distrito, y no puede cambiarlos por su cuenta. Hasta que lo apruebes no entra al portal.')}
${nota('consejo', 'Si desactivas a alguien <b>en un período</b>, deja de contarse como pendiente por evaluar ahí, pero conserva su historia.')}`,
    },
    {
      id: 'accesos', titulo: 'Aprobar accesos y gestionar a una persona',
      html: `
<p>Quien se registra queda con <b>acceso pendiente</b>, sin rol ni distrito, y no puede entrar al portal hasta que lo apruebes. Recibes el aviso «Hay una solicitud de acceso».</p>
<h3>Aprobar a alguien nuevo</h3>
${pasos(
        `Abre ${b('Personas')} y, en el filtro de estado, elige ${b('Acceso pendiente')} (el número entre paréntesis dice cuántas hay).`,
        `Toca la tarjeta y abre la pestaña ${b('Gestión')}.`,
        `Asigna el <b>rol</b> (con qué perfil se evaluará), el <b>distrito</b> y el <b>tipo de acceso</b> (<i>Creator</i> o <i>Secretario</i>).`,
        `Activa ${b('Acceso aprobado')}. La persona recibe el aviso «Tu acceso fue aprobado» y ya puede entrar.`)}
<h3>Qué más se hace en «Gestión»</h3>
${tabla(['Campo', 'Para qué sirve'], [
        ['<b>Rol</b>', 'Define el perfil con que se la evalúa. Sin rol no se la puede evaluar en rúbrica por roles.'],
        ['<b>Roles permitidos</b>', 'Roles extra con los que se le pueden asignar tareas. Se guarda al marcar cada casilla. Abajo ves sus <b>preferencias</b> (solo lectura).'],
        ['<b>Distrito</b> y <b>Tipo de miembro</b>', 'El distrito decide qué secretaría la ve; el tipo, si es Creator o Secretaría.'],
        ['<b>Administradora</b>', 'Da el acceso de administración. No se evalúa a quien es admin.'],
        ['<b>Participación en el PE</b>', '«Participa / No participa en este período». Quien <b>no participa</b> no cuenta en resúmenes ni rankings <b>y ese PE deja de aparecerle por completo</b> (selectores, perfil y calendario). Conserva su historia.'],
        ['<b>Eliminar</b>', 'Borra a la persona. Pide confirmación; úsalo solo para cuentas que nunca debieron existir.']])}
<h3>Encontrar a quien necesita algo</h3>
<p>El filtro de estado de ${b('Personas')} te lleva directo a los pendientes: ${b('Acceso pendiente')}, ${b('Sin evaluar')}, ${b('Evaluación en borrador')}, ${b('Sin rol')}, ${b('Sin distrito')}, ${b('Inactivas en el período')} y ${b('Administradores')}. Los avisos del Panel abren Personas ya filtrado.</p>
${nota('ojo', 'Si no aprobaste a alguien, no es que el portal falle: hasta tu aprobación no entra. Y si la aprobaste y dice que no le llegan los correos, mira «Correos y avisos».')}`,
    },
    {
      id: 'tareas', titulo: 'Tareas: asignar, revisar y calificar',
      html: `
<p>${b('Tareas')} (menú izquierdo) es donde asignas trabajo a <b>cualquier persona</b> y revisas lo que entrega. Cada tarea tiene un <b>estado</b> que va cambiando: <i>Asignada → En curso → Entregada → Aprobada</i>, y puede pasar por <i>Devuelta</i>, <i>Bloqueada</i> o <i>Anulada</i>.</p>
${nota('ojo', 'Las tareas solo existen en períodos de <b>rúbrica por roles</b>. En un período clásico la pestaña lo explica y no deja crearlas.')}
<h3>Asignar una tarea, paso a paso</h3>
${pasos(
        `Abre ${b('Tareas')} y toca ${b('+ Nueva tarea')}. También puedes empezar desde el perfil de una persona (${b('Nueva tarea')}) o desde un día del calendario.`,
        `<b>Paso 1 · Qué.</b> Título, qué se espera, fecha límite, prioridad y el período (si hay varios de rúbrica por roles). Opcional: una <b>actividad</b> del calendario y el <b>rol para el que es el trabajo</b>.`,
        `<b>Paso 2 · Quién.</b> Busca por nombre, rol o distrito. Marca personas sueltas o un equipo entero. Cada persona muestra su rol, si tiene <b>habilitado</b> el rol elegido, si lo <b>prefiere</b> y su <b>carga</b> (tareas abiertas y vencidas).`,
        `<b>Paso 3 · Rol y resumen.</b> Elige un rol <i>por persona</i>; ves sus responsabilidades y con qué competencias se evalúa. Marca qué competencias evidencia la tarea (opcional; ${b('Sugerir las del rol')} marca las principales). Revisa el resumen.`,
        `Si aparecen avisos, léelos y marca ${b('Entiendo los avisos')}. Luego ${b('Crear N tareas')}. Cada persona recibe un aviso en la campana (y un correo, porque «tarea asignada» es esencial).`)}
${tabla(['Aviso al crear', 'Qué hacer'], [
        ['<b>Rol no habilitado</b> para esa persona', 'Como administración <b>sí puedes seguir</b>: la tarea se crea como <b>Excepción de rol</b> y queda marcada a la vista. Una secretaría no puede; tú sí. Si no era tu intención, cambia el rol o habilítalo en Personas → Gestión.'],
        ['Ya tiene una tarea abierta con el mismo título', 'Puede ser un duplicado. Si es a propósito, marca «Entiendo los avisos».'],
        ['Carga alta (5 o más abiertas) o tareas vencidas', 'Aviso: ya tiene mucho trabajo. Puedes crearla igual.'],
        ['No participa en el período · fecha límite ya pasada', 'La tarea no contaría en el resumen, o nacería vencida.']])}
<h3>Qué puede hacer cada parte</h3>
${tabla(['Quién', 'Qué hace con una tarea'], [
        ['La persona asignada', '<b>Empezar</b> (pasa a En curso), <b>Entregar</b> (enlace https y/o una nota; uno de los dos es obligatorio), <b>Bloquear</b> con el motivo («¿De qué o de quién depende?») y reanudar. No puede cambiar la fecha, ni aprobar, ni anular.'],
        ['Quien la asignó o la administración', '<b>Editar</b> (título, descripción, prioridad), <b>Mover la fecha límite</b>, <b>Aprobar y puntuar</b>, <b>Devolver para corregir</b>, <b>Anular</b>, ver el <b>Historial</b>.'],
        ['Nadie', 'Aprobar la <b>propia</b> tarea (lo impide la base de datos). Tampoco se evalúa a la administración.']])}
<h3>Revisar una entrega</h3>
${pasos(
        `En ${b('Tareas')} usa el filtro ${b('Por revisar')} (muestra el número) o busca por persona.`,
        `Pulsa ${b('Ver entrega')} y lee el enlace o la nota.`,
        `Si está bien: ${b('Aprobar y puntuar')}. Pon los <b>Puntos (0–10)</b> —obligatorios— y, si corresponde, el <b>Peso de la tarea</b> (cuánto cuenta frente a las demás; por defecto 1). Una tarea «propia» (iniciativa de la persona) siempre pesa 1.`,
        `Si hay que corregir: ${b('Devolver para corregir')} y escribe <b>Qué hay que corregir</b> (obligatorio y concreto). La persona recibe un aviso con tu observación (correo incluido).`)}
${nota('ejemplo', 'Entregó el reel del sábado: lo apruebas con 8 puntos y peso 2. Entra a su <b>nota de tareas</b> con el doble de peso que una tarea de peso 1 (ver «Cómo cuentan las tareas»).')}
${nota('consejo', 'Lo de «a tiempo» se mide en la <b>primera</b> entrega: devolver y corregir no la vuelve tarde. Así no se castiga a quien corrige bien.')}
<h3>Mover el plazo, bloquear y anular</h3>
${lista(
        `${b('Mover la fecha límite')}: eliges la <b>Nueva fecha</b> y escribes el <b>Motivo</b> (mínimo 5 caracteres). La fecha original queda registrada y la persona recibe un aviso («Cambió una tarea»).`,
        `${b('Bloquear')}: una tarea bloqueada <b>no cuenta como atrasada</b> mientras siga así; quien la asignó recibe el aviso.`,
        `${b('Anular la tarea')}: necesita un motivo. Una tarea anulada <b>no entra en ninguna cuenta</b> (ni en tareas, ni en promedios).`,
        `${b('Historial')}: cada cambio con quién, qué y cuándo. No se puede borrar.`)}
<h3>Corregir una nota ya aprobada</h3>
<p>Una vez aprobada, los puntos no se editan a mano: solo tú, desde la tarea, con ${b('Corregir nota')}, ${b('Anular nota')} o ${b('Restaurar nota')}, y siempre con un <b>motivo</b> (mínimo 5 caracteres). Cada cambio queda en el <b>historial de notas</b> con los pesos y reglas que regían en ese momento. Una tarea con historial de notas no se puede borrar.</p>`,
    },
    {
      id: 'equipos', titulo: 'Equipos y tareas del equipo',
      html: `
<p>Un <b>equipo</b> es un grupo de personas para <b>un período</b> de rúbrica por roles. Sirve para asignar <b>una tarea compartida</b> (no una copia por persona) y ver cómo rinde el grupo. Solo la administración crea y modifica equipos.</p>
<h3>Crear un equipo</h3>
${pasos(
        `Abre ${b('Equipos')} (menú izquierdo) y toca ${b('Nuevo equipo')}.`,
        `Escribe el <b>Nombre del equipo</b>, elige el <b>PE</b> (después <b>no se puede cambiar</b>) y, si quieres, una <b>Descripción</b>.`,
        `Opcional: el <b>Responsable de seguimiento</b> (quien acompaña al equipo y recibe sus avisos) y el <b>Ámbito</b> (un distrito: así solo pueden entrar personas de ese distrito).`,
        `Guarda y, dentro del equipo, toca ${b('Añadir integrantes')}. Busca y marca a las personas.`)}
${lista(
        `<b>Quién puede entrar:</b> acceso aprobado, que no sea administración y que <b>no esté desactivada en ese PE</b>.`,
        `Si el equipo tiene ámbito de distrito y quieres sumar a alguien de otro, usa la <b>Excepción de ámbito</b> y escribe el motivo: queda guardado.`,
        `${b('Retirar')} a un integrante pide un motivo. Quien entra o sale recibe un aviso (esencial, con correo).`,
        `${b('Cambiar estado')} (activo, inactivo, archivado): <b>archivar pide un motivo</b> y no se puede si el equipo tiene tareas del equipo abiertas. Los equipos no se borran.`)}
${nota('ojo', 'Si un integrante cambia de distrito o deja de participar en el PE, <b>nada cambia solo</b>: el equipo muestra una alerta y tú decides si lo retiras o lo dejas.')}
<h3>Asignar una tarea al equipo</h3>
${pasos(
        `Dentro del equipo, toca ${b('Nueva tarea de equipo')}.`,
        `Completa <b>Título</b>, <b>Instrucciones</b>, <b>Fecha límite</b>, <b>Prioridad</b>, el <b>Responsable</b> (opcional) y los <b>criterios que evidencia</b> (orientativo).`,
        `Guarda. Los integrantes <b>de ese momento</b> reciben el aviso «Tarea para tu equipo». Quien se suma después entra a las tareas todavía abiertas; quien se va sale de las abiertas o entregadas (las aprobadas y anuladas no cambian).`)}
<h3>Cómo avanza y cómo se califica</h3>
${tabla(['Paso', 'Quién', 'Qué ocurre'], [
        ['Avanzar', 'Cualquier integrante', 'Registra un aporte: <b>Qué se avanzó</b> y el <b>Avance del equipo (0 a 100 %)</b>. Queda con su autoría.'],
        ['Entregar', 'Cualquier integrante', '<b>Enlace de la entrega</b> (https) y/o <b>Nota de la entrega</b>. Es <b>una</b> entrega para todo el equipo; la primera mide el plazo.'],
        ['Aprobar', 'Administración (o la secretaría del distrito del equipo, si no participa)', '<b>Puntos (0–10)</b> y <b>Peso de la tarea</b>. La nota es <b>del grupo</b>: cada persona cuenta <b>una vez</b>.'],
        ['Devolver', 'Quien revisa', '<b>Observación para el equipo</b> (obligatoria).'],
        ['Mover plazo · Anular', 'Administración', '<b>Nueva fecha</b> y <b>Motivo</b>; anular pide motivo y solo tú la reabres.'],
        ['Nota individual', 'Quien revisa', 'Si una persona rindió distinto, le pones una <b>Nota individual</b> con evidencia (mínimo 10 caracteres). Reemplaza la del grupo solo para ella y se muestra aparte.']])}
<p>Una persona cuenta en una tarea del equipo si <b>participaba cuando se aprobó</b> o si <b>dejó al menos un aporte</b>. No hay archivos adjuntos: la evidencia es un enlace y/o una nota.</p>`,
    },
    {
      id: 'reglas', titulo: 'Cómo cuentan las tareas en la evaluación',
      html: `
<p>Las notas de las tareas <b>entran en el resultado</b> de cada persona. Tú decides cuánto pesan, <b>período por período</b>.</p>
<pre class="formula">individual = (1 − w) × (0,6 × técnico + 0,4 × núcleo) + w × nota de tareas
general    = (1 − w) × (0,4 × núcleo + 0,6 × percentil) + w × nota de tareas
nota de tareas = 100 × Σ(peso × nota ÷ 10) ÷ Σ(pesos) de las tareas que cuentan</pre>
<p>donde <b>w</b> es el peso de las tareas (por ejemplo 20 % → 0,2). Si la persona no tiene nota de tareas, se queda con su evaluación pura: <b>nadie baja por no tener tareas calificadas</b>.</p>
${tabla(['Cuenta', 'No cuenta (y nunca se rellena con 0)'], [
        ['Tareas <b>aprobadas</b> con puntos y no anuladas', 'Entregadas esperando revisión · en curso · devueltas · bloqueadas'],
        ['Tareas del equipo aprobadas (la nota del grupo)', 'Tareas anuladas o con la nota anulada'],
        ['Las de iniciativa propia, <b>si</b> la regla lo permite', 'Aprobadas antes de que existieran los puntos']])}
<h3>Cambiar las reglas de un período</h3>
${pasos(
        `Abre ${b('Equipos')} y busca el bloque de reglas del PE (resumen «Tareas: N % del resultado»). Toca ${b('Editar reglas')}.`,
        `Ajusta: <b>Peso de las tareas en el resultado</b> (0 a 100 %), <b>Multiplicador de las tareas individuales</b>, <b>Multiplicador de las tareas del equipo</b>, <b>Mínimo de tareas calificadas</b> (con menos, no hay nota de tareas), <b>¿Cuentan las iniciativas propias?</b> y <b>¿Las vencidas sin entregar cuentan como 0?</b> (No es lo recomendado).`,
        `Escribe el <b>Motivo del cambio</b> (obligatorio si el PE ya tiene evaluaciones publicadas) y guarda. Los resultados se <b>recalculan al instante</b> y el cambio queda en el historial.`)}
${nota('ojo', 'Los períodos que ya existían empiezan con <b>0 %</b> (para no mover resultados ya publicados). Los períodos nuevos nacen con <b>20 %</b>, marcado «Valor inicial, sin confirmar» hasta que lo guardes tú: es una decisión tuya.')}
${nota('consejo', 'En el perfil de cada persona, en «Cómo se compone tu evaluación», se ve pieza por pieza qué tarea cuenta, cuánto aporta y por qué una no cuenta.')}`,
    },
    {
      id: 'calendario', titulo: 'Calendario y actividades',
      html: `
<p>${b('Calendario')} reúne fechas de períodos, actividades y tareas. Desde un día puedes crear una actividad o asignar una tarea. Una <b>actividad</b> tiene título, fecha (o rango), un <b>tipo</b> (la etiqueta, que le da color) y <b>para quién</b> es.</p>
${tabla(['Para quién', 'Quién la ve', 'Quién puede crearla'], [
        ['Todo el equipo', 'Todas las personas', 'Solo administración'],
        ['Un distrito', 'Las personas de ese distrito (y su secretaría)', 'Administración; la secretaría, solo de su distrito'],
        ['Personas y equipos', 'Solo las personas elegidas, quien la creó, la administración y la secretaría del distrito de esas personas', 'Administración; la secretaría, solo con personas de su distrito']])}
${pasos(
        `Abre ${b('Configuración → Actividades')} y toca ${b('Nueva actividad')} (o, desde el calendario, ${b('Nueva actividad')} en un día).`,
        `Título, descripción, <b>Tipo</b> y fechas. En <b>Para quién</b> elige ${b('Todo el equipo')}, ${b('Un distrito')} (y cuál) o ${b('Personas y equipos')}.`,
        `Con <i>Personas y equipos</i> usas el mismo selector que en las tareas: buscas, filtras por Todos / Equipos / Personas y marcas un equipo (por distrito o por rol) o personas sueltas. Una frase te dice a cuántas personas se avisará.`,
        `Guarda. Las destinatarias reciben un aviso (y otro la víspera); quien no es destinataria no la ve en su calendario.`)}
<p>La lista de actividades dice, en cada una, a quién alcanza («Todo el equipo», «Distrito 08-01», «3 personas elegidas»). En ${b('Configuración → Actividades')} también administras los <b>tipos</b> (etiquetas: nombre y color de una paleta fija).</p>
${nota('ojo', 'Elegir un equipo agrega a sus miembros <b>de ese momento</b>; quien entre después al equipo no se suma sola. Una actividad con tareas vinculadas no se puede eliminar hasta desvincular esas tareas.')}`,
    },
    {
      id: 'distritos', titulo: 'Distritos: ranking acumulado y evaluación',
      html: `
<p>${b('Distritos')} (menú izquierdo, junto a Equipos) tiene arriba cuatro cifras (distritos evaluados, promedio global, mejor distrito y estadísticas de Instagram recibidas) y, debajo, el <b>ranking acumulado</b>: una fila por distrito con una columna por período (puntaje de 28), el <b>total</b>, el <b>promedio sobre 28</b> y el <b>porcentaje</b>, de mayor a menor. Abajo, el promedio de cada período y el <b>promedio global acumulado</b>.</p>
${lista(
        `<b>Solo cuentan las evaluaciones publicadas.</b> Un período sin evaluaciones publicadas se dice así y no entra a las columnas. Los borradores no mueven ningún promedio.`,
        `<b>El promedio</b> es el total ÷ los períodos en que el distrito fue evaluado (no se castiga por un PE que no tiene). Los <b>empates comparten posición</b>; a igualdad, manda el período más reciente.`,
        `<b>Períodos:</b> los botones de arriba eligen qué períodos entran al ranking.`,
        `<b>Mostrar:</b> ${b('Sin evaluar')}, ${b('En borrador')} y ${b('Sin estadísticas')} te dicen qué falta, sobre el último período incluido. Cada fila trae su estado (<i>Publicada</i>, <i>Borrador</i>, <i>Sin evaluar</i>) y si la secretaría ya envió sus estadísticas (<i>IG enviado</i> / <i>IG falta</i>).`,
        `${b('Exportar CSV')} baja la misma tabla (con totales, promedios y el promedio por período).`)}
<h3>Evaluar un distrito, paso a paso</h3>
${pasos(
        `Toca el distrito en la tabla: se abre su panel. Elige la pestaña ${b('Evaluación')} y el <b>período</b> (botones PE).`,
        `<b>Estadísticas de Instagram.</b> Arriba ves lo que envió la secretaría (cifras y su captura de prueba; toca la captura para verla grande). Los campos de abajo vienen <b>precargados</b> con esas cifras; corrígelas si hace falta o usa ${b('Usar estas cifras en la evaluación')}. Si la secretaría aún no envió nada, las escribes tú.`,
        `<b>Las 4 competencias</b>, cada una de <b>0 a 7</b> con su barra: <i>CGO</i> gestión y organización (orden y coherencia del feed), <i>CCT</i> creativa y técnica (creatividad y edición), <i>COM</i> comunicativa (claridad y estrategia del mensaje) y <i>CEE</i> ejecución estratégica (constancia y estrategia de publicación). Cada una admite un comentario. El máximo es <b>28</b>.`,
        `Escribe las <b>Notas / comentario general</b> si quieres.`,
        `${b('Guardar borrador')} (solo lo ves tú) o ${b('Publicar')}. Al publicar, el distrito entra al ranking y su secretaría ve su resultado. Si ya estaba publicada, puedes ${b('Volver a borrador')} o ${b('Confirmar cambios')}.`)}
${tabla(['Nivel (sobre 28)', 'Desde'], [['Excelente', '24'], ['Bueno', '17'], ['En proceso', '10'], ['Bajo', 'menos de 10']])}
<h3>Las otras pestañas del panel</h3>
${lista(
        `${b('Resumen')}: posición, promedio, porcentaje y nivel; la evolución por período y una tabla con las cuatro competencias de cada PE (los borradores aparecen marcados y solo tú los ves).`,
        `${b('Estadísticas')}: lo que envió la secretaría para el PE elegido y todo lo enviado antes, con quién lo subió y cuándo.`,
        `${b('Personas')}: la gente del distrito; al tocar a alguien se abre su perfil (reemplaza el panel; vuelve a abrir el distrito desde la tabla).`)}
<h3>Estadísticas de Instagram: qué hace la secretaría</h3>
<p>Cada secretaría sube, por período, las 7 cifras de la cuenta de su distrito con una <b>captura de pantalla como prueba</b> (se reduce sola a unos 100–250 KB antes de enviarse). Es <b>una entrega por distrito y período</b>, compartida: cualquier secretaría del distrito puede corregirla mientras el período siga abierto. Tú ves todo; las cifras no cambian la evaluación hasta que tú las uses.</p>
${nota('ojo', 'Si «Estadísticas» dice que aún no está activada, falta aplicar la migración 0043 en Supabase (ver «Qué depende de actualizaciones»).')}`,
    },
    {
      id: 'seguimiento', titulo: 'Seguimiento: todos los períodos, por rol',
      html: `
<p>${b('Seguimiento')} (menú izquierdo, entre Personas y Calendario) pone a <b>todas las personas</b> frente a <b>todos los períodos</b> de la gestión, agrupadas por rol. Es la forma de ver de un vistazo quién está al día, quién arrastra pendientes y cómo se movió cada rol.</p>
${lista(
        `<b>Indicadores:</b> evaluaciones publicadas (personas con evaluación publicada ÷ personas que participan, en los períodos ya en juego), entregas a tiempo (entregadas dentro del plazo ÷ entregadas con plazo, sobre la primera entrega) y tareas vencidas. Cada uno dice su «N de M»; el desplegable «¿Cómo se calcula?» lo explica.`,
        `<b>Filtros:</b> persona, distrito, rol y ${b('Solo con pendientes')}.`,
        `<b>Un grupo por rol</b> (se pliega) con una columna por período. Cada celda: el resultado con su nivel, o el estado («Borrador», «Sin publicar», «Sin evaluar», «No participa») y los hechos de las tareas. Toca un nombre para abrir el perfil.`,
        `A ti, como administración, se te muestran también los <b>borradores</b> (marcados); a las secretarías y a los miembros, no.`,
        `Rúbrica por roles (sobre 100) y rúbrica clásica (otra escala) van separadas: nunca se promedian ni se comparan.`)}
<p>Quién ve qué lo decide la base de datos: tú ves todo; una secretaría, solo su distrito; un miembro, solo su propio historial (en su ${b('Mi perfil')} → ${b('Períodos')}).</p>`,
    },
    {
      id: 'reportes', titulo: 'Reportes',
      html: `
<h3>Todos los PE a la vez</h3>
<p>${b('Reportes')} abre en <b>Todos los PE</b>: una hoja con <b>todos los períodos</b> de la gestión (personas que participan, evaluaciones publicadas, resultado promedio, tareas, entregas a tiempo y vencidas) y un comparador entre PE. Filtra por distrito, rol, rúbrica o estado del PE; ${b('Quitar filtros')} vuelve a ver todos. Desde la fila de un PE, ${b('Abrir el reporte completo de este PE')} te lleva a su detalle, y ${b('Ver las personas que componen estas cifras')} muestra quiénes suman cada número. ${b('Exportar CSV')} baja la misma hoja.</p>
${nota('consejo', 'Cada cifra dice de dónde sale («¿Cómo se calcula y de dónde sale cada cifra?»). Un porcentaje es siempre Σ numerador ÷ Σ denominador, nunca un promedio de porcentajes; la rúbrica por roles y la clásica nunca se mezclan.')}
<h3>Un PE en detalle</h3>
${pasos(`Abre ${b('Reportes')}.`, `Elige el período, el alcance (equipo, distrito, rol o una persona) y las secciones que quieres.`, `Revisa la hoja que se genera. ${b('Descargar PDF')} usa el tema claro; ${b('Exportar CSV')} descarga el ranking para una planilla.`)}
<h3>Secciones</h3>
${tabla(['Sección', 'Qué muestra'], [
        ['Resumen · Ranking · Por rol · Por competencia', 'Los cortes del período elegido.'],
        ['Detalle por persona · Evidencia de tareas · Sin evaluar', 'Fortalezas y margen de cada persona, los hechos de sus tareas y quién falta.'],
        ['<b>Entre períodos</b>', 'Cada período de la gestión: evaluaciones publicadas («7 de 9 personas»), promedio, entregas a tiempo («2 de 3») y tareas vencidas; y el promedio por rol de un período a otro.'],
        ['<b>Por actividad</b>', 'Las tareas vinculadas a cada actividad: entregadas ÷ asignadas, a tiempo ÷ con plazo, aprobadas ÷ entregadas, vencidas y puntos promedio.']])}
${captura('a-reportes-periodos', 'Sección «Entre períodos»: cada cifra con su numerador y su denominador.')}
<p>Los cuadros <i>Entre períodos</i> y <i>Por actividad</i> respetan el alcance que elijas (un distrito, un rol, una persona) y cada uno tiene su botón ${b('Descargar este cuadro (CSV)')}, con numerador y denominador en columnas separadas. Un denominador en 0 se muestra «—», nunca 0 %. Los resultados de la rúbrica por roles los calcula la base de datos; el reporte solo los presenta.</p>
${nota('consejo', 'Las secretarías tienen su propia pestaña ' + b('Reportes') + ' con estos dos cortes limitados a su distrito.')}
${nota('ojo', 'No hay exportación nativa a Excel (.xlsx): el CSV se abre con Excel. Los cortes por actividad necesitan las migraciones 0021, 0024 y 0025.')}`,
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
<p>Una tarjeta por rol con su <b>descripción</b>, sus <b>responsabilidades</b> y <b>requisitos</b> (se despliegan) y su perfil vigente: la barra apilada de pesos y las versiones anteriores.</p>
${captura('a-roles', 'Roles y perfiles: la descripción del rol, sus responsabilidades y requisitos, y su perfil de evaluación.')}
${pasos(
        `Toca el lápiz de un rol (o ${b('+ Nuevo rol')}).`,
        `Escribe <b>Qué hace este rol</b> (una o dos frases), <b>Responsabilidades</b> (una por línea) y <b>Requisitos</b>.`,
        `Guarda. Esos textos se muestran a quien recibe una tarea con ese rol, en la asignación y en la bienvenida y en ${b('Mi cuenta')} de cada persona.`)}
<p>Para el perfil de evaluación: para cambiar pesos, ${b('crea una versión nueva')}: los pesos técnicos deben sumar <b>exactamente 100</b>. Un perfil que ya usó alguna evaluación es inmutable; la versión nueva rige desde un período que aún no tenga evaluaciones de ese rol. Desde el diálogo del perfil también puedes ${b('Crear criterio')}.</p>
${nota('ojo', 'El peso de un criterio es lo que define su escala de puntaje (0 a su peso). Cambiar pesos en una versión nueva no altera evaluaciones ya guardadas: conservan su perfil.')}
<h3>Gestiones</h3>
${pasos(
        `Abre ${b('Configuración → Gestiones')} y toca ${b('Abrir gestión nueva')}.`,
        `Escribe el <b>Nombre</b> (por ejemplo 2027-2028) y confirma con ${b('Abrir gestión')}.`,
        `La gestión actual se <b>archiva</b> (queda en solo lectura) y la nueva arranca <b>sin evaluaciones ni período activo</b>, con los criterios, la rúbrica, el calendario, los períodos base y la última versión de cada perfil clonados como plantilla editable.`)}
${lista(
        `Para ver una gestión anterior, cámbiala al entrar al panel o con el selector de gestión; se abre en solo lectura.`,
        `Si no hay una gestión abierta, el registro de cuentas nuevas se cierra.`,
        `Después de abrirla: activa el primer período, revisa los roles y perfiles, y crea los equipos de cada PE.`)}`,
    },
    {
      id: 'correos', titulo: 'Correos y avisos: qué sale y cómo comprobarlo',
      html: `
<p>Cada hecho importante crea un <b>aviso</b> que aparece siempre en la campana. Además puede salir por <b>correo</b>. Son dos canales distintos: quien no tiene correo igual ve el aviso en el portal.</p>
<h3>Qué sale por correo por defecto</h3>
<p>Para no saturar los correos (con unas 25 personas, una tarea más una nota ya serían ~50) y cuidar el tope diario del remitente, <b>solo los avisos esenciales</b> van por correo sin que nadie haga nada:</p>
${tabla(['Esenciales (siempre por correo, no se pueden apagar)', 'Opcionales (solo campana, salvo que la persona los encienda)'], [
        ['Acceso aprobado · Solicitud de acceso · Tarea asignada · Tarea del equipo · Cambió una tarea · Te devolvieron la tarea · Tarea vencida · Calificación nueva o cambiada · Te sumaron o te retiraron de un equipo', 'Tarea por vencer · Entrega por revisar · Tarea aprobada · Tarea bloqueada · Actividad nueva y recordatorio · Observación nueva · Evaluaciones sin publicar · Cambió el estado de algo']])}
<p>Cada persona elige sus opcionales en ${b('la campana')} → ${b('Preferencias')}. Un esencial no se apaga. Los correos <b>no llevan puntajes ni el texto de una observación</b>: avisan y enlazan al portal (que pide sesión).</p>
<h3>Comprobar que se están enviando</h3>
${pasos(
        `Abre la campana → ${b('Preferencias')} → ${b('Estado de los correos')} (solo administración): resumen de los últimos 7 días por tipo y estado.`,
        `Lee los estados: <b>enviado</b> (el proveedor lo aceptó), <b>omitido</b> (la persona no tiene correo, o apagó ese aviso opcional; sigue en la campana), <b>simulado</b> (modo prueba: <b>no salió ningún correo</b>) y <b>fallido</b> (se agotaron los 5 intentos o la dirección es inválida).`,
        `Si hay <b>fallidos</b>, mira el motivo. Los fallos temporales se reintentan solos a los 5, 15, 60 y 180 minutos.`)}
<h3>Lo que se configura fuera del portal (Supabase)</h3>
${tabla(['Ajuste (Edge Functions → Secrets)', 'Valores y efecto'], [
        ['<code>CORREO_MODO</code>', '<b>produccion</b>: envía a las personas reales. <b>prueba</b>: no envía a nadie real (con <code>CORREO_PRUEBA_DESTINO</code> manda todo solo a esa dirección, con el asunto «[PRUEBA → …]»). Vacío o <b>apagado</b>: no toca la cola. Al cambiarlo, guarda el secreto y espera un minuto.'],
        ['<code>APPS_SCRIPT_URL</code> y <code>APPS_SCRIPT_SECRET</code>', 'El puente de Google que envía desde tu cuenta de Gmail.']])}
${nota('ojo', '<b>Límite del remitente:</b> una cuenta de Gmail personal envía hasta unos <b>100 destinatarios al día</b> (Workspace, unos 1.500). Un plan familiar de almacenamiento no lo cambia. Si se llega al tope, los avisos esperan y se reintentan; la campana sigue funcionando.')}
${nota('ojo', 'Los avisos que se generan mientras el modo es <b>prueba</b> se marcan «simulado» y <b>no se reenvían</b> al pasar a producción: quedan solo en la campana.')}
${nota('consejo', 'Cada persona puede recibir dos tipos de correo muy distintos: los de acceso (código de verificación, recuperar contraseña) y los avisos. Los de acceso se configuran aparte, en Authentication de Supabase.')}`,
    },
    comunAvisos('admin'),
    comunCuenta,
    {
      id: 'proximamente', titulo: 'Próximamente',
      html: `<p>Estas mejoras están en camino. Mientras llegan, cada una tiene su alternativa:</p>
${lista(
        `<b>Roles dentro de una actividad.</b> Próximamente. Por ahora una actividad lleva destinatarios (equipo, distrito o personas) y el rol se elige al asignar cada tarea.`,
        `<b>Habilitar roles en bloque.</b> Próximamente. Por ahora los roles permitidos se marcan persona por persona, en ${b('Personas')} → ${b('Gestión')}.`,
        `<b>Seguimiento y reportes entre gestiones.</b> Próximamente. Por ahora son de una gestión a la vez: cambia de gestión al entrar al panel.`,
        `<b>Exportación nativa a Excel (.xlsx).</b> Próximamente. Hoy tienes la hoja imprimible/PDF y el CSV, que Excel abre sin problema.`,
        `<b>Solicitud de rol desde la persona.</b> Próximamente. Hoy la persona declara sus preferencias y tú decides si le habilitas el rol.`)}`,
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
        ['Puntos por peso (barra de 0 a su peso)', '0023', 'Se evalúa de 1 a 5, como antes.'],
        ['Descripción de los roles, roles permitidos, preferencias y rol en cada tarea', '0021', 'Esos campos no aparecen; la asignación de tareas sigue por persona, sin rol.'],
        ['Actividades «para personas y equipos»', '0024 (y 0021)', 'Las actividades siguen siendo de todo el equipo o de un distrito; «Personas y equipos» aparece desactivado.'],
        ['Seguimiento global, bienvenida y novedades, y reporte por actividad', '0025 (el reporte por actividad también necesita 0021 y 0024)', 'Las pestañas lo explican; la bienvenida y las novedades no se muestran.'],
        ['La etiqueta «Hito» pasa a llamarse «Evento»', '0026', 'Se sigue viendo «Hito»; todo lo demás funciona igual.'],
        ['Fondo personalizado de la tarjeta de perfil', '0030', 'Mi cuenta no ofrece elegir fondo.'],
        ['Equipos y tareas del equipo; calificaciones (peso, corregir y anular notas); la nota de tareas integrada al resultado; vistas de equipos', '0031 → 0036', 'No aparecen Equipos ni las reglas por PE; las notas de tareas no entran al resultado.'],
        ['Avisos con catálogo, preferencias, estado de los correos y modo de prueba', '0040 y 0041', 'Los avisos siguen con el esquema anterior; no hay preferencias ni «Estado de los correos».'],
        ['Solo lo esencial va por correo por defecto', '0042', 'Todos los avisos opcionales también salen por correo.'],
        ['Estadísticas de Instagram del distrito (con captura de prueba)', '0043', '«Estadísticas» avisa que no está activada; el admin escribe las cifras a mano.'],
        ['Reporte general de todos los PE (con equipos y tareas del equipo)', '0050 y 0051', 'Reportes no ofrece «Todos los PE».']])}
<p>Orden recomendado: <b>0021 → 0024 → 0025 → 0026 → 0030 → 0031 → 0032 → 0033 → 0034 → 0035 → 0036 → 0040 → 0041 → 0042 → 0043 → 0050 → 0051</b>. Cada archivo está en <code>supabase/migrations</code> y se aplica completo, una sola vez, en el SQL Editor (o con la conexión de Supabase).</p>`,
    },
  ],
  faq: [
    ...faqComun,
    [`No puedo publicar una evaluación`, `Faltan criterios obligatorios por puntuar o campos obligatorios de registro. El contador «N de M obligatorios» y el mensaje al publicar dicen cuáles. Recuerda: un criterio opcional sin puntuar no bloquea.`],
    [`El puntaje máximo de un criterio cambió entre dos personas del mismo rol`, `Cada evaluación conserva el perfil (y por tanto los pesos) con el que se guardó. Si se creó una versión nueva del perfil, las evaluaciones nuevas usan la nueva; las anteriores, la suya.`],
    [`Una persona evaluada no tiene rol y no puedo evaluarla`, `Asígnale rol en ${b('Personas')} → su tarjeta → ${b('Gestión')}. Y confirma que el rol tenga un perfil en ${b('Roles y perfiles')}.`],
    [`Asigné un rol que la persona no tiene y la tarea dice «Excepción de rol»`, `Es lo esperado: como administración puedes salirte de lo habilitado, pero queda marcado a la vista. Si no era tu intención, edítala y cambia el rol, o habilita ese rol en ${b('Personas')} → ${b('Gestión')}.`],
    [`Creé una actividad para personas y alguien dice que no la ve`, `Solo la ven las personas elegidas, quien la creó, la administración y la secretaría de su distrito. Elegir un equipo agrega a sus miembros de ese momento; si la persona entró después, edita la actividad y agrégala.`],
    [`No puedo eliminar una actividad`, `Tiene tareas vinculadas. Desvincula esas tareas (editándolas) y luego elimínala.`],
    [`No puedo eliminar un criterio`, `Si alguna evaluación o perfil lo usó, solo puede desactivarse: así no se pierde la historia.`],
    [`Los pesos no suman 100 y no me deja guardar el perfil`, `Es una regla de la base de datos: los pesos técnicos de una versión suman exactamente 100. El diálogo muestra la suma en vivo.`],
    [`No me deja guardar en una gestión`, `Está archivada: es de solo lectura. Abre la gestión activa.`],
    [`Alguien dice que no le llegan los correos`, `Revisa que su acceso esté aprobado, que tenga correo registrado y que el aviso sea de los <b>esenciales</b> (los opcionales van solo a la campana, salvo que ella los encienda en Preferencias). Mira también «Estado de los correos» en la campana: ahí ves si salió, si se omitió o si falló.`],
    [`Los correos no salen a nadie`, `Revisa en Supabase (Edge Functions → Secrets) que <code>CORREO_MODO</code> sea <b>produccion</b>: en <i>prueba</i> los avisos quedan «simulado» y en vacío o <i>apagado</i> no se toca la cola. Después de cambiarlo, guarda y espera un minuto.`],
    [`Una persona dice que no ve un PE`, `Es lo esperado si está marcada «No participa» en ese PE (Personas → Gestión): para ella ese PE no existe. Si fue un error, márcala como participante y volverá a verlo.`],
    [`Ya aprobé una tarea y quiero cambiar los puntos`, `Abre la tarea → ${b('Corregir nota')} (o ${b('Anular nota')} / ${b('Restaurar nota')}) y escribe el motivo (mínimo 5 caracteres). Queda en el historial de notas y se recalcula el resultado.`],
    [`No me deja archivar un equipo`, `Tiene tareas del equipo abiertas. Ciérralas (aprobar, devolver o anular) y vuelve a intentarlo; archivar pide un motivo.`],
    [`Las estadísticas de Instagram de un distrito no aparecen`, `La secretaría de ese distrito aún no las envió para ese PE (verás «IG falta» en Distritos). Pídeselas o escríbelas tú dentro de la evaluación. Si la pantalla dice que no está activada, falta aplicar la migración 0043.`],
    [`Cambié las reglas de tareas y los resultados se movieron`, `Es lo esperado: al cambiar el peso o los multiplicadores del PE, los resultados se recalculan al instante. Queda registrado con tu motivo; si no querías el cambio, vuelve a las reglas anteriores.`],
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
    <p class="ay-aviso">Las capturas son del entorno de pruebas del portal con <b>datos de ejemplo</b> (nombres y cifras inventados). Si lees este manual en computadora verás las capturas de computadora; en el celular, las de celular.</p>
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
