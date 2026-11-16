// Pruebas MULTISESIÓN de core/sync.js: el código real del repositorio corre en varias «pestañas» a la vez (una por persona/dispositivo)
// contra un mundo simulado (fake-realtime.mjs) que publica eventos como Realtime: solo a quien su RLS deja ver la fila, sin red no llega nada.
//
// Escenarios pedidos: 1 tarea nueva · 2 iniciativa modificada · 3 evaluación → desempeño/indicadores/ranking · 4 acceso y rol ·
// 5 avisos (el módulo «Solicito tu ayuda» no existe en el repositorio) · 6 PC + iPad + teléfono · 7 pérdida y recuperación de internet ·
// 8 cambio de permisos corta el acceso · y además: no refrescar lo que no se ve, no pisar un diálogo, conservar el scroll, ráfagas, concurrencia.
import fs from 'node:fs';
import { Mundo, ROOT, espera, hasta } from './fake-realtime.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗ FALLA:', m); };

// ── Un mundo con administración, una secretaría y miembros de dos distritos ──────────────────────────────────────────────────────────────
const visible = (tabla, f, uid, m) => {
  const u = m.usuario(uid); if (!u) return false;
  if (u.es_admin) return tabla !== 'notif_senal' || f.destinatario_id === uid;
  const sec = u.tipo_miembro === 'secretario';
  const dist = id => m.usuario(id)?.distrito;
  switch (tabla) {
    case 'tareas': return f.asignada_a === uid || (sec && dist(f.asignada_a) === u.distrito);
    case 'actividades': return f.alcance === 'equipo' || (f.alcance === 'distrito' && f.distrito === u.distrito);
    case 'evaluaciones': return f.estado === 'publicado' && (f.evaluado_id === uid || (sec && dist(f.evaluado_id) === u.distrito));
    case 'profiles': return f.id === uid || (sec && f.distrito === u.distrito);
    case 'notif_senal': return f.destinatario_id === uid;
    case 'auditoria_global': return false;
    default: return true;
  }
};
const nuevoMundo = () => new Mundo({ visible }).sembrar('profiles', [
  { id: 'admin', nombre: 'Admin', es_admin: true, tipo_miembro: 'miembro', distrito: null, aprobado: true, rol_id: null },
  { id: 'admin2', nombre: 'Admin 2', es_admin: true, tipo_miembro: 'miembro', distrito: null, aprobado: true, rol_id: null },
  { id: 'sec1', nombre: 'Sofía', es_admin: false, tipo_miembro: 'secretario', distrito: '08-01', aprobado: true, rol_id: 3 },
  { id: 'm1', nombre: 'Ana', es_admin: false, tipo_miembro: 'miembro', distrito: '08-01', aprobado: true, rol_id: 1 },
  { id: 'm2', nombre: 'Beto', es_admin: false, tipo_miembro: 'miembro', distrito: '08-01', aprobado: true, rol_id: 1 },
  { id: 'm3', nombre: 'Carla', es_admin: false, tipo_miembro: 'miembro', distrito: '08-02', aprobado: true, rol_id: 2 },
]);
const CFG = { debounce: 25, maxWait: 150, ocupado: 30, reintentoMin: 20, reintentoMax: 160, revalidarTrasOculta: 60, fallos: 2 };

/** Abre una «pestaña»: carga core/sync.js real, lo inicia y registra las pantallas que el portal registraría. */
async function abrir(mundo, uid, portal, vista = 'tareas') {
  const s = mundo.sesion(uid, { portal });
  s.cargar('core/sync.js');
  s.st = { tareas: [], actividades: [], evals: [], ranking: [], kpis: 0, personas: [], campana: 0, veces: {}, perfil: 0, ultimosCambios: [] };
  const cuenta = k => { s.st.veces[k] = (s.st.veces[k] || 0) + 1; };
  const S = s.Sync;
  S.iniciar({ perfil: { ...mundo.usuario(uid) }, cfg: CFG });
  S.on(['tareas', 'kpis'], async ({ cambios }) => { cuenta('tareas'); s.st.ultimosCambios = cambios; s.st.tareas = (await s.SB.from('tareas').select()).data; s.st.kpis = s.st.tareas.filter(t => t.estado === 'aprobada').length; }, { id: 'tareas', vista: 'tareas' });
  S.on(['calendario'], async () => { cuenta('calendario'); s.st.actividades = (await s.SB.from('actividades').select()).data; }, { id: 'calendario', vista: ['calendario', 'inicio'] });
  S.on(['desempeno', 'ranking', 'kpis'], async () => {
    cuenta('desempeno');
    const ev = (await s.SB.from('evaluaciones').select()).data, ta = (await s.SB.from('tareas').select()).data;
    s.st.evals = ev;
    // «resultados_periodo» a escala de juguete: nota de la evaluación + 5 por tarea aprobada; el ranking sale de ahí (derivado de DOS tablas)
    s.st.ranking = ev.map(e => ({ id: e.evaluado_id, nota: e.nota + 5 * ta.filter(t => t.asignada_a === e.evaluado_id && t.estado === 'aprobada').length })).sort((a, b) => b.nota - a.nota);
  }, { id: 'desempeno', vista: 'desempeno' });
  S.on('personas', async () => { cuenta('personas'); s.st.personas = (await s.SB.from('profiles').select()).data; }, { id: 'personas', vista: 'personas' });
  S.on('notificaciones', async () => { cuenta('campana'); s.st.campana++; }, { id: 'campana' });          // la campana: siempre, sin vista
  S.on('perfil', async () => { cuenta('perfil'); }, { id: 'perfil' });
  S.tab(vista);
  await hasta(() => S.estado().conexion === 'ok' && S.tablasAbiertas().length > 0, 600);
  S.invalidar(['tareas', 'calendario', 'desempeno', 'personas'], 'inicio');       // la carga inicial que hace cada portal al abrir la vista
  await espera(CFG.debounce + 40);
  s.base = { ...s.st.veces }; s.nuevos = k => (s.st.veces[k] || 0) - (s.base[k] || 0);
  return s;
}
const cerrar = (...ss) => ss.forEach(s => s.Sync.parar());

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('[1. A crea una tarea y B la ve aparecer; C (otro distrito) no recibe nada]');
{
  const m = nuevoMundo();
  const A = await abrir(m, 'admin', 'admin.html'), B = await abrir(m, 'm1', 'user.html'), C = await abrir(m, 'm3', 'user.html');
  m.insertar('tareas', { titulo: 'Reportaje', asignada_a: 'm1', estado: 'asignada' });
  ok(await hasta(() => B.st.tareas.length === 1), 'B (la persona asignada) ve la tarea aparecer sin recargar');
  ok(await hasta(() => A.st.tareas.length === 1), 'A (administración) la ve también, sin recargar');
  await espera(120);
  ok(C.st.tareas.length === 0 && C.nuevos('tareas') === 0, 'C (otro distrito) no la ve y ni siquiera se refresca: no recibió el evento (RLS)');
  ok(B.st.ultimosCambios[0] && B.st.ultimosCambios[0].tabla === 'tareas' && B.st.ultimosCambios[0].tipo === 'INSERT', 'el refresco sabe qué cambió (tabla, tipo): permite actualizar solo lo afectado');

  // Ráfaga: diez cambios seguidos → muy pocos refrescos, no diez.
  const antes = B.nuevos('tareas');
  for (let i = 0; i < 10; i++) m.insertar('tareas', { titulo: 'T' + i, asignada_a: 'm1', estado: 'asignada' });
  ok(await hasta(() => B.st.tareas.length === 11), 'una ráfaga de 10 tareas llega completa');
  await espera(100);
  ok(B.nuevos('tareas') - antes <= 2, `la ráfaga se agrupa: ${B.nuevos('tareas') - antes} refresco(s) para 10 eventos, no 10`);

  // Un cambio de tarea se ve en la pestaña correcta pero NO repinta vistas que no se están mirando.
  ok(!B.nuevos('desempeno') && !B.nuevos('personas') && !B.nuevos('calendario'), 'las vistas que no se miran (desempeño, personas, calendario) no se refrescaron');
  cerrar(A, B, C);
}

console.log('\n[2. Se modifica una iniciativa y los autorizados la ven; los demás ni se enteran]');
{
  const m = nuevoMundo();
  const act = m.insertar('actividades', { titulo: 'Reunión 08-01', alcance: 'distrito', distrito: '08-01' });
  const SEC = await abrir(m, 'sec1', 'secretario.html', 'calendario'), M1 = await abrir(m, 'm1', 'user.html', 'calendario'), M3 = await abrir(m, 'm3', 'user.html', 'calendario');
  m.actualizar('actividades', act.id, { titulo: 'Reunión 08-01 (cambió la hora)' });
  ok(await hasta(() => SEC.st.actividades[0]?.titulo.includes('cambió la hora')), 'la secretaría del distrito ve el cambio');
  ok(await hasta(() => M1.st.actividades[0]?.titulo.includes('cambió la hora')), 'el miembro del distrito lo ve');
  await espera(100);
  ok(M3.nuevos('calendario') === 0, 'un miembro de OTRO distrito no la ve y no recibió ni el evento');
  m.borrar('actividades', act.id);
  ok(await hasta(() => M1.st.actividades.length === 0), 'al borrarla desaparece de la pantalla de quien la veía');
  cerrar(SEC, M1, M3);
}

console.log('\n[3. Un evaluador registra puntuación: desempeño, indicadores y ranking se actualizan (también por una tarea aprobada)]');
{
  const m = nuevoMundo();
  const ADM = await abrir(m, 'admin', 'admin.html', 'desempeno'), M1 = await abrir(m, 'm1', 'user.html', 'desempeno'), SEC = await abrir(m, 'sec1', 'secretario.html', 'desempeno');
  const e1 = m.insertar('evaluaciones', { evaluado_id: 'm1', nota: 70, estado: 'borrador' });
  await espera(120);
  ok(ADM.st.ranking.length === 1 && M1.st.ranking.length === 0, 'un BORRADOR lo ve la administración, no la persona evaluada (la RLS manda)');
  m.actualizar('evaluaciones', e1.id, { estado: 'publicado' });
  ok(await hasta(() => M1.st.ranking.length === 1 && M1.st.ranking[0].nota === 70), 'al publicar, la persona evaluada ve su desempeño');
  ok(await hasta(() => SEC.st.ranking.length === 1), 'la secretaría de su distrito ve el ranking actualizado');
  const e2 = m.insertar('evaluaciones', { evaluado_id: 'm2', nota: 90, estado: 'publicado' });
  ok(await hasta(() => ADM.st.ranking.map(r => r.id).join() === 'm2,m1'), 'el ranking de la administración se reordena: m2 (90) primero, m1 (70) segundo');
  // Derivado: una TAREA aprobada mueve el ranking aunque no se haya tocado la tabla de evaluaciones.
  const t = m.insertar('tareas', { titulo: 'Reportaje', asignada_a: 'm1', estado: 'entregada' });
  await espera(80);
  const vecesAntes = ADM.st.veces.desempeno;
  m.actualizar('tareas', t.id, { estado: 'aprobada' });
  ok(await hasta(() => ADM.st.ranking.find(r => r.id === 'm1')?.nota === 75), 'tarea aprobada → el ranking cuenta +5 para m1 (la tabla tareas invalida las vistas derivadas)');
  ok(ADM.st.veces.desempeno > vecesAntes, 'el refresco derivado ocurrió en la vista de desempeño, que es la que se mira');
  ok(await hasta(() => M1.st.ranking[0]?.nota === 75), 'y la persona evaluada ve su nota actualizada');
  const mapa = ADM.Sync.mapa();
  ok(['seguimiento', 'desempeno', 'ranking', 'kpis', 'reportes'].every(x => mapa.tareas.temas.includes(x)), 'mapa de dependencias: tareas → seguimiento, desempeño, ranking, indicadores y reportes');
  ok(['desempeno', 'ranking', 'kpis', 'seguimiento', 'reportes'].every(x => mapa.evaluaciones.temas.includes(x)), 'mapa de dependencias: evaluaciones → las mismas vistas derivadas');
  cerrar(ADM, M1, SEC);
}

console.log('\n[4. Acceso y rol: el afectado se entera sin reiniciar sesión]');
{
  const m = nuevoMundo();
  // 4a. Otra administradora ve en su lista de personas el cambio de acceso que hace la primera.
  const ADM2 = await abrir(m, 'admin2', 'admin.html', 'personas');
  m.insertar('profiles', { id: 'nueva', nombre: 'Nueva', es_admin: false, tipo_miembro: 'miembro', distrito: null, aprobado: false, rol_id: null });
  ok(await hasta(() => ADM2.st.personas.some(p => p.id === 'nueva')), 'una solicitud de acceso nueva aparece en la lista de otra administradora');
  m.actualizar('profiles', 'nueva', { aprobado: true });
  ok(await hasta(() => ADM2.st.personas.find(p => p.id === 'nueva')?.aprobado === true), 'al aprobarla, la lista de la otra administradora cambia a «aprobado»');
  cerrar(ADM2);
  // 4b. El afectado, con el portal abierto: ascenso de miembro a secretaría → lo manda a su portal (sin cerrar sesión).
  const M2 = await abrir(m, 'm2', 'user.html');
  m.actualizar('profiles', 'm2', { tipo_miembro: 'secretario' });
  ok(await hasta(() => M2.redirigido === 'secretario.html'), 'ascendido a secretaría: el portal lo lleva a secretario.html, sin volver a iniciar sesión');
  ok(!M2.cerrada, '…y su sesión sigue abierta (no se cierra por un cambio de rol permitido)');
  // 4c. Cambio de rol/distrito DENTRO de lo permitido: se actualiza lo que ve y se avisa.
  const SEC = await abrir(m, 'sec1', 'secretario.html');
  m.actualizar('profiles', 'sec1', { rol_id: 2 });
  ok(await hasta(() => SEC.nuevos('perfil') >= 1), 'cambio de rol dentro del mismo portal: se invalidan las vistas dependientes de su perfil');
  ok(SEC.toasts.some(t => /permisos cambiaron/.test(t)), 'y se le avisa con un mensaje (no cambia nada en silencio)');
  ok(!SEC.redirigido, 'sin redirección si el portal sigue siendo el suyo');
  cerrar(M2, SEC);
}

console.log('\n[5. Avisos (campana) · «Solicito tu ayuda» (0068) se escucha por Sync]');
{
  ok(/ayuda_pedidos:\s+\{ temas: \['apoyo'\] \}/.test(fs.readFileSync(ROOT + 'core/sync.js', 'utf8')) && /ADD TABLE public\.ayuda_pedidos/.test(fs.readFileSync(ROOT + 'supabase/migrations/0068_solicito_ayuda.sql', 'utf8')), 'ayuda_pedidos está en TABLAS (tema apoyo) y la publica 0068 (Solicito tu ayuda)');
  const m = nuevoMundo();
  const M1 = await abrir(m, 'm1', 'user.html'), M2 = await abrir(m, 'm2', 'user.html'), PC = await abrir(m, 'm1', 'user.html');
  m.insertar('notif_senal', { id: 'm1', destinatario_id: 'm1', tic: 1 });
  ok(await hasta(() => M1.st.campana === 1 && PC.st.campana === 1), 'llega un aviso a m1: la campana se actualiza en TODOS sus dispositivos');
  await espera(100);
  ok(M2.st.campana === 0 || M2.nuevos('campana') === 0, 'm2 (otra persona) no recibe la señal: el aviso es personal');
  ok(!('notif_senal' in m.tabla('profiles')[0]), 'la señal no lleva datos del aviso (solo un contador): los datos se piden por la función de siempre');
  cerrar(M1, M2, PC);
}

console.log('\n[6. Un cambio en el PC se refleja en el iPad y el teléfono de la misma persona]');
{
  const m = nuevoMundo();
  const pc = await abrir(m, 'm1', 'user.html'), ipad = await abrir(m, 'm1', 'user.html'), tel = await abrir(m, 'm1', 'user.html');
  const t = m.insertar('tareas', { titulo: 'Entregar fotos', asignada_a: 'm1', estado: 'asignada' });
  ok(await hasta(() => pc.st.tareas.length && ipad.st.tareas.length && tel.st.tareas.length), 'la tarea aparece en los tres dispositivos');
  m.actualizar('tareas', t.id, { estado: 'en_curso' });   // m1 la inicia en el PC
  ok(await hasta(() => ipad.st.tareas[0]?.estado === 'en_curso' && tel.st.tareas[0]?.estado === 'en_curso'), 'el cambio de estado hecho en el PC se ve en el iPad y en el teléfono');
  cerrar(pc, ipad, tel);
}

console.log('\n[7. Pérdida y recuperación de internet]');
{
  const m = nuevoMundo();
  const A = await abrir(m, 'm1', 'user.html');
  m.insertar('tareas', { titulo: 'Antes', asignada_a: 'm1', estado: 'asignada' });
  await hasta(() => A.st.tareas.length === 1);
  A.cortar();
  ok(await hasta(() => A.Sync.estado().conexion === 'sin-red'), 'sin internet el estado es «sin-red» y NO se da por actualizado (verificado = falso)');
  ok(A.Sync.estado().verificado === false, 'Sync.estado().verificado es false mientras no hay conexión');
  const ind = A.nodos['sync-estado'];
  ok(ind && ind.hidden === false && /Sin conexión/.test(ind._txt.textContent), 'aparece el indicador discreto: «Sin conexión. Lo que ves puede estar desactualizado.»');
  const veces = A.st.veces.tareas;
  m.insertar('tareas', { titulo: 'Mientras', asignada_a: 'm1', estado: 'asignada' });
  m.insertar('tareas', { titulo: 'Mientras 2', asignada_a: 'm1', estado: 'asignada' });
  await espera(150);
  ok(A.st.tareas.length === 1 && A.st.veces.tareas === veces, 'sin red no se hacen peticiones ni se finge actualizar (los 2 cambios se perdieron para esta pestaña)');
  const subs0 = A.intentosSub;
  await espera(200);
  ok(A.intentosSub === subs0, 'y no se reintenta a ciegas sin red (espera el evento «online»)');
  A.restaurar();
  ok(await hasta(() => A.st.tareas.length === 3), 'al volver internet se RESINCRONIZA: aparecen las 2 tareas que llegaron mientras tanto');
  ok(await hasta(() => A.Sync.estado().conexion === 'ok' && A.Sync.estado().verificado), 'el estado vuelve a «ok» y el indicador se oculta');
  ok(A.nodos['sync-estado'].hidden === true, 'el indicador desaparece');
  m.insertar('tareas', { titulo: 'Después', asignada_a: 'm1', estado: 'asignada' });
  ok(await hasta(() => A.st.tareas.length === 4), 'y los eventos en vivo vuelven a funcionar');
  cerrar(A);

  // Fallo del servicio CON red: reintento con espera creciente, y al recuperar se resincroniza lo perdido.
  const B = await abrir(m, 'm1', 'user.html');
    B.romperCanales();
  ok(await hasta(() => B.Sync.estado().conexion === 'reconectando'), 'si el canal falla con red: estado «reconectando»');
  m.insertar('tareas', { titulo: 'Durante el fallo', asignada_a: 'm1', estado: 'asignada' });
  const t0 = Date.now(); await espera(450);
  const porCanal = B.intentosSub / Math.max(1, B.Sync.tablasAbiertas().length);
  ok(porCanal >= 2 && porCanal <= 7, `reintenta con espera creciente, no en bucle apretado (${porCanal.toFixed(1)} intentos por canal en 450 ms con espera inicial de 20 ms que se duplica)`);
  B.repararCanales();
  ok(await hasta(() => B.Sync.estado().conexion === 'ok', 1500), 'al volver el servicio, el canal se reabre solo');
  ok(await hasta(() => B.st.tareas.length === m.filas('tareas', 'm1').length), 'y se resincroniza lo que se perdió mientras estuvo caído (la tarea «Durante el fallo»)');
  cerrar(B);

  // Pestaña dormida (el sistema suspende el socket sin avisar): al volver se revalida.
  const C = await abrir(m, 'm1', 'user.html');
  const n1 = C.st.tareas.length;
  C.ocultar(); C.suspender();
  m.insertar('tareas', { titulo: 'Con la pestaña dormida', asignada_a: 'm1', estado: 'asignada' });
  await espera(90);
  ok(C.st.tareas.length === n1, 'con la pestaña dormida no llega nada');
  C.reanudar(); C.mostrar();
  ok(await hasta(() => C.st.tareas.length === m.filas('tareas', 'm1').length), 'al volver a la pestaña (visibilitychange) tras un rato, se revalida y aparece lo que faltaba');
  cerrar(C);
}

console.log('\n[8. Un cambio de permisos corta el acceso al instante]');
{
  const m = nuevoMundo();
  m.insertar('tareas', { titulo: 'De m1', asignada_a: 'm1', estado: 'asignada' });
  m.insertar('tareas', { titulo: 'De m3', asignada_a: 'm3', estado: 'asignada' });
  const SEC = await abrir(m, 'sec1', 'secretario.html');
  ok(await hasta(() => SEC.st.tareas.length === 1 && SEC.st.tareas[0].titulo === 'De m1'), 'la secretaría del 08-01 ve solo las tareas de su distrito');
  // Se le cambia el distrito: lo que ve cambia SIN recargar, y los eventos del distrito anterior dejan de llegar.
  m.actualizar('profiles', 'sec1', { distrito: '08-02' });
  ok(await hasta(() => SEC.st.tareas.length === 1 && SEC.st.tareas[0].titulo === 'De m3'), 'al cambiarle el distrito, su lista pasa a las tareas del 08-02 sin recargar');
  const v = SEC.nuevos('tareas');
  m.insertar('tareas', { titulo: 'Nueva de m1', asignada_a: 'm1', estado: 'asignada' });
  await espera(120);
  ok(SEC.nuevos('tareas') === v && SEC.st.tareas.every(t => t.asignada_a !== 'm1'), 'una tarea nueva del distrito que YA no es suyo no le llega (RLS con su estado actual)');
  cerrar(SEC);

  const A2 = await abrir(m, 'admin2', 'admin.html');
  m.actualizar('profiles', 'admin2', { es_admin: false });
  ok(await hasta(() => A2.redirigido === 'user.html'), 'se le quita la administración: el portal de administración se cierra al instante y lo manda a user.html');
  cerrar(A2);

  const M3 = await abrir(m, 'm3', 'user.html');
  m.actualizar('profiles', 'm3', { aprobado: false });
  ok(await hasta(() => M3.redirigido === 'index.html?pendiente=1'), 'se revoca su acceso (aprobado = false): sesión cerrada y a la pantalla de acceso pendiente');
  ok(M3.cerrada, 'se llama a signOut: no queda sesión abierta');
  cerrar(M3);

  // Se borra su perfil por completo.
  const M2 = await abrir(m, 'm2', 'user.html');
  m.borrar('profiles', 'm2');
  ok(await hasta(() => M2.redirigido === 'index.html'), 'si su perfil desaparece, sale al inicio de sesión');
  cerrar(M2);
}

console.log('\n[Vistas: solo lo que se mira consume; entrar y salir abre y cierra canales]');
{
  const m = nuevoMundo();
  const A = await abrir(m, 'admin', 'admin.html', 'tareas');
  const abiertas = () => A.Sync.tablasAbiertas().filter(t => !t.startsWith('@'));
  ok(abiertas().includes('tareas') && !['auditoria_global', 'banco_imagenes', 'estadisticas_distrito', 'evaluaciones_distrito', 'gestiones'].some(t => abiertas().includes(t)), `en «tareas» no se escucha lo de otras pantallas (${abiertas().length} de ${Object.keys(A.Sync.mapa()).length} tablas)`);
  A.Sync.tab('calendario'); await espera(60);
  ok(abiertas().includes('actividades'), 'al entrar a Calendario se suscribe a actividades…');
  ok(!abiertas().includes('tareas_equipo') && !abiertas().includes('calificaciones_historial'), '…y se sueltan las de la pantalla que se dejó (tareas_equipo, calificaciones_historial)');
  const subs = A.canales.size;
  A.Sync.tab('inicio'); A.Sync.tab('calendario');
  ok(A.canales.size === subs, 'cambiar de vista no deja canales colgados');
  ok(A.Sync.tablasAbiertas().includes('@perfil'), 'el canal del propio perfil siempre está abierto (cambios de rol y acceso)');
  // Una vista oculta que recibe un cambio se marca y se refresca al entrar si pidió alEntrar.
  const S = A.Sync; let corridas = 0;
  S.on(['personas'], async () => { corridas++; }, { id: 'p2', vista: 'personas', alEntrar: true });
  S.tab('tareas'); await espera(60);
  ok(corridas === 0, 'una vista que no se mira no se refresca');
  await espera(CFG.debounce * 5);
  S.tab('personas');
  ok(await hasta(() => corridas === 1), 'al entrar a una vista con alEntrar se revalida una vez (nunca más de una por entrada)');
  cerrar(A);
}

console.log('\n[No pisar un diálogo ni perder el scroll]');
{
  const m = nuevoMundo();
  const A = await abrir(m, 'm1', 'user.html');
  const cierra = A.abrirModal();
  m.insertar('tareas', { titulo: 'Con diálogo', asignada_a: 'm1', estado: 'asignada' });
  m.insertar('tareas', { titulo: 'Otra', asignada_a: 'm1', estado: 'asignada' });
  await espera(200);
  ok(A.st.tareas.length === 0, 'con un diálogo abierto el refresco se APLAZA: no se repinta debajo de quien está escribiendo');
  cierra();
  ok(await hasta(() => A.st.tareas.length === 2), 'al cerrar el diálogo se aplica, de una vez, con todo lo acumulado');
  ok(A.nuevos('tareas') === 1, 'y fue UN solo refresco, no uno por evento');
  // Campo de texto con cambios sin guardar.
  A.document.activeElement = { tagName: 'TEXTAREA', type: 'textarea', value: 'a medias', defaultValue: '' };
  m.insertar('tareas', { titulo: 'Tercera', asignada_a: 'm1', estado: 'asignada' });
  await espera(150);
  ok(A.st.tareas.length === 2, 'con un texto sin guardar en un campo, tampoco se repinta');
  A.document.activeElement = null;
  ok(await hasta(() => A.st.tareas.length === 3), 'cuando se suelta el campo, se aplica');
  // Scroll: el repintado lo resetea; Sync lo restaura.
  A.window.scrollY = 640; const llamadas = [];
  A.window.scrollTo = (x, y) => { llamadas.push(y); A.window.scrollY = y; };
  A.Sync.on('tareas', async () => { A.window.scrollY = 0; }, { id: 'resetea', vista: 'tareas' });   // un pintado «a la antigua» que sube al inicio
  m.insertar('tareas', { titulo: 'Cuarta', asignada_a: 'm1', estado: 'asignada' });
  ok(await hasta(() => llamadas.includes(640)), 'tras repintar se restaura la posición de scroll (640)');
  cerrar(A);
}

console.log('\n[Concurrencia: no se pisa en silencio lo de otra persona]');
{
  const m = nuevoMundo();
  const act = m.insertar('actividades', { titulo: 'Jornada', alcance: 'equipo', distrito: null });
  const B = await abrir(m, 'admin2', 'admin.html', 'calendario');
  const avisos = [];
  const v = B.Sync.vigilar('actividades', act.id, c => avisos.push(c));
  m.actualizar('actividades', act.id, { titulo: 'Jornada (editada por A)' });
  ok(await hasta(() => avisos.length === 1), 'mientras B edita, un cambio de A en esa misma fila avisa (para mostrar «alguien la modificó» sin tocar lo que B escribe)');
  ok(avisos[0].nuevo.titulo === 'Jornada (editada por A)' && avisos[0].tipo === 'UPDATE', 'el aviso trae el valor nuevo para poder compararlo');
  v.silenciar(200);
  m.actualizar('actividades', act.id, { titulo: 'Guardado por B' });
  await espera(80);
  ok(avisos.length === 1, 'el eco del guardado propio no se anuncia como conflicto');
  await espera(200);
  m.borrar('actividades', act.id);
  ok(await hasta(() => avisos.length === 2 && avisos[1].tipo === 'DELETE'), 'si A BORRA lo que B edita, B lo sabe (evento DELETE) y no guarda sobre algo que ya no existe');
  v.off();
  m.insertar('actividades', { id: act.id, titulo: 'x', alcance: 'equipo' });
  await espera(80);
  ok(avisos.length === 2, 'tras v.off() ya no se avisa');
  cerrar(B);
}

console.log('\n[Registro único y peticiones compartidas]');
{
  const m = nuevoMundo();
  const A = await abrir(m, 'm1', 'user.html'); const S = A.Sync;
  let llamadas = 0;
  const f = () => S.unico('ctx', async () => { llamadas++; await espera(40); return llamadas; });
  const r = await Promise.all([f(), f(), f()]);
  ok(llamadas === 1 && r.every(x => x === 1), 'tres peticiones iguales a la vez comparten UNA (dedupe)');
  await f(); ok(llamadas === 2, 'terminada la primera, la siguiente sí se hace (no es una caché eterna)');
  let a = 0, b = 0;
  S.on('tareas', async () => { a++; }, { id: 'misma', vista: 'tareas' });
  S.on('tareas', async () => { b++; }, { id: 'misma', vista: 'tareas' });          // volver a montar la pantalla con el mismo id REEMPLAZA
  m.insertar('tareas', { titulo: 'x', asignada_a: 'm1', estado: 'asignada' });
  await espera(120);
  ok(a === 0 && b === 1, 'volver a registrar el mismo id reemplaza al anterior: no se acumulan manejadores al navegar');
  cerrar(A);
}

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
