'use strict';
/* ════════════════════════════════════════════════════════════════════════════
 * EIGHT CREATORS LABs — Configuración general (solo administración)
 *
 * Un solo lugar desde el que se llega a TODO lo configurable del portal, agrupado por apartado. Cada fila dice qué se configura,
 * cuál es el valor actual (cuando ya está cargado en la pantalla) y lleva su botón «Configurar», que abre la pantalla que lo edita.
 * Los ajustes pequeños que no tienen pantalla propia (tema, selector de entrada) se cambian aquí mismo.
 *
 *   Configuracion.montar(host, { datos })   pinta el índice y los apartados. `datos()` devuelve conteos ya cargados
 *                                           ({ gestion, periodos, periodoActivo, personas, pendientes, roles, distritos }).
 *
 * Para añadir un ajuste nuevo a la plataforma basta con sumar su fila al apartado que corresponda en APARTADOS: no hay otra lista.
 * Todo texto dinámico pasa por escHtml; las acciones usan ACCIONES (irTab, tema, fn) y nunca onclick.
 * Depende de: config.js (escHtml, renderIconos).
 * ════════════════════════════════════════════════════════════════════════════ */
const Configuracion = (() => {
  const ir = (tab, etq = 'Configurar') => ({ tipo: 'ir', tab, etq });

  /** Cada apartado: id, título, una línea de contexto y sus filas (qué se configura). `valor(d)` es opcional. */
  const APARTADOS = [
    { id: 'organizacion', icono: 'map-pin', titulo: 'Organización', texto: 'Cómo se divide el trabajo en el tiempo y entre las personas.', filas: [
      { t: 'Gestión', d: 'El año de trabajo. Cada gestión tiene sus propios períodos, criterios, rúbrica y calendario; al abrir una nueva se archiva la anterior.', valor: d => d.gestion, acc: ir('gestiones') },
      { t: 'Períodos de evaluación', d: 'Nombre, fechas (inicio, fin del trabajo, entrega, jornada), modelo de rúbrica y cuál está activo.', valor: d => d.periodos != null ? `${d.periodos} períodos${d.periodoActivo ? ' · activo: ' + d.periodoActivo : ''}` : '', acc: ir('periodos') },
      { t: 'Distritos', d: 'Evaluación de distrito, ranking acumulado y estadísticas de Instagram por período.', valor: d => d.distritos != null ? `${d.distritos} distritos` : '', acc: ir('distritos') },
      { t: 'Personas y accesos', d: 'Aprobar accesos, tipo de acceso, distrito, rol, roles habilitados, participación por período y gafete.', valor: d => d.personas != null ? `${d.personas} personas${d.pendientes ? ' · ' + d.pendientes + ' por aprobar' : ''}` : '', acc: ir('usuarios') },
      { t: 'Equipos', d: 'Crear equipos por período, integrantes, responsable y ámbito de distrito.', acc: ir('equipos') },
    ] },
    { id: 'evaluacion', icono: 'clipboard-check', titulo: 'Evaluación', texto: 'Qué se mide, con qué peso y cómo cuentan las tareas.', filas: [
      { t: 'Roles y perfiles', d: 'Los roles del equipo (descripción, responsabilidades, requisitos) y el perfil de evaluación de cada uno, con sus criterios y pesos.', valor: d => d.roles != null ? `${d.roles} roles` : '', acc: ir('roles') },
      { t: 'Rúbrica y criterios', d: 'Competencias comunes (núcleo), campos de registro y criterios de los períodos clásicos.', acc: ir('rubrica') },
      { t: 'Reglas de calificación de tareas', d: 'Por período: peso de las tareas en el resultado, multiplicadores, mínimo de tareas, iniciativas propias, vencidas y si se pierden los puntos sin tareas.', acc: ir('tareas', 'Abrir en Tareas') },
      { t: 'Niveles de desempeño', d: 'Solo lectura. Rúbrica por roles: Excelente desde 87, Bueno desde 67, En desarrollo desde 37 (sobre 100). Clásica: 26, 20 y 11 de 30. Distritos: 87, 67 y 37 % de 28.', tipo: 'info' },
    ] },
    { id: 'calendario', icono: 'calendar-days', titulo: 'Calendario y actividades', texto: 'Lo que se programa para el equipo y los distritos.', filas: [
      { t: 'Tipos de actividad', d: 'Los tipos (etiquetas) con su nombre y color. Crear y ver las actividades se hace desde el Calendario: Lista de actividades.', acc: ir('calendario', 'Abrir actividades') },
      { t: 'Calendario', d: 'Vista del mes con períodos, actividades y tareas.', acc: ir('agenda', 'Abrir') },
    ] },
    { id: 'comunicacion', icono: 'bell', titulo: 'Comunicación', texto: 'Avisos, correos y recursos compartidos.', filas: [
      { t: 'Avisos y correos', d: 'Qué sale por la campana y por correo lo define la plataforma; cada persona elige sus avisos opcionales en Mi cuenta. Los esenciales (tarea asignada, acceso, cambios de plazo) siempre se envían.', tipo: 'info' },
      { t: 'Banco de imágenes', d: 'Imágenes de apoyo y recursos para el equipo.', acc: ir('banco', 'Abrir') },
    ] },
    { id: 'apariencia', icono: 'image', titulo: 'Apariencia y entrada', texto: 'Cómo se ve el portal para ti y cómo empiezas cada sesión.', filas: [
      { t: 'Tema', d: 'Oscuro, claro o rosa. Se recuerda en este dispositivo.', acc: { tipo: 'tema' } },
      { t: 'Selector de entrada', d: 'Vuelve a mostrar «¿Con qué vas a trabajar?» (gestión y período) al entrar.', acc: { tipo: 'fn', arg: 'restablecerEntrada', etq: 'Volver a mostrar' } },
      { t: 'Mi cuenta', d: 'Tu nombre, foto, contraseña y preferencias de aviso.', acc: ir('cuenta', 'Abrir') },
    ] },
    { id: 'seguridad', icono: 'history', titulo: 'Seguridad y registro', texto: 'Quién cambió qué y cómo se acredita a las personas.', filas: [
      { t: 'Auditoría', d: 'Registro de cambios de personas, períodos, gestiones, evaluaciones, notas, reglas y equipos, con filtros y descarga en CSV.', acc: ir('auditoria', 'Abrir') },
      { t: 'Gafetes', d: 'Cada persona tiene su gafete con QR. Se abre, revoca o reactiva desde su perfil, en Personas.', tipo: 'info' },
      { t: 'Reportes', d: 'Reporte general, por distrito y por equipo, con exportación.', acc: ir('reportes', 'Abrir') },
    ] },
  ];

  function _accion(f) {
    const a = f.acc;
    if (!a) return '';
    if (a.tipo === 'tema') {
      const t = document.documentElement.dataset.theme || 'dark';
      return `<div class="seg" role="group" aria-label="Tema">${[['dark', 'Oscuro'], ['light', 'Claro'], ['rosa', 'Rosa']].map(([k, e]) => `<button type="button" class="seg-btn${t === k ? ' active' : ''}" aria-pressed="${t === k}" data-act="tema" data-arg="${k}">${e}</button>`).join('')}</div>`;
    }
    if (a.tipo === 'fn') return `<button type="button" class="btn-out" data-act="fn" data-arg="${escHtml(a.arg)}">${escHtml(a.etq || 'Configurar')}</button>`;
    return `<button type="button" class="btn-out" data-act="irTab" data-arg="${escHtml(a.tab)}">${escHtml(a.etq)}</button>`;
  }

  function _fila(f, d) {
    let v = '';
    try { v = f.valor ? f.valor(d) || '' : ''; } catch (e) { v = ''; }
    return `<li class="cg-fila">
      <div class="cg-fila-txt"><h4 class="pf-sub cg-fila-t">${escHtml(f.t)}</h4><p class="cg-fila-d">${escHtml(f.d)}</p>${v ? `<p class="cg-fila-v">${escHtml(v)}</p>` : ''}</div>
      <div class="cg-fila-acc">${_accion(f)}</div></li>`;
  }

  function montar(host, { datos } = {}) {
    if (!host) return;
    const d = (typeof datos === 'function' ? datos() : null) || {};
    host.innerHTML = `<div id="cg-preparar"></div><div class="cg">
      <nav class="cg-indice" aria-label="Apartados de configuración"><ul>${APARTADOS.map(a => `<li><a href="#cg-${escHtml(a.id)}" data-act="cgIr" data-arg="${escHtml(a.id)}"><i data-lucide="${escHtml(a.icono)}" aria-hidden="true"></i><span>${escHtml(a.titulo)}</span></a></li>`).join('')}</ul></nav>
      <div class="cg-apartados">${APARTADOS.map(a => `<section class="tarjeta cg-ap" id="cg-${escHtml(a.id)}" aria-labelledby="cg-t-${escHtml(a.id)}">
        <h2 class="cuenta-t" id="cg-t-${escHtml(a.id)}">${escHtml(a.titulo)}</h2><p class="cg-ap-txt">${escHtml(a.texto)}</p>
        <ul class="cg-filas">${a.filas.map(f => _fila(f, d)).join('')}</ul></section>`).join('')}</div></div>`;
    renderIconos?.(host);
  }

  /** Salta al apartado (sin cambiar la dirección de la página). */
  function ir_(id) {
    const el = document.getElementById('cg-' + id);
    if (el) el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  return { montar, ir: ir_, APARTADOS };
})();
window.Configuracion = Configuracion;
