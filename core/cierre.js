'use strict';
/* ════════════════════════════════════════════════════════════════════════════
 * EIGHT CREATORS LABs — Listas de verificación del período (solo administración, solo lectura)
 *
 *   Cierre.cierre(datos)    «Cierre del período»: lo que hay que tener listo ANTES de dar por cerrado un PE (fechas, reglas de tareas
 *                           confirmadas, entregas revisadas, todas las personas evaluadas y publicadas, estadísticas y evaluación de cada
 *                           distrito). Devuelve filas { id, ok, titulo, detalle, tab, cta }.
 *   Cierre.preparar(datos)  «Preparar la evaluación»: lo que debe existir ANTES de evaluar (cada rol en uso con su perfil vigente, cada
 *                           persona con rol y distrito, fechas completas, reglas confirmadas).
 *   Cierre.html(lista, opciones)  pinta una lista como filas con su estado y un botón que lleva a donde se resuelve.
 *
 * NO calcula notas, NO corrige nada, NO bloquea ninguna acción: solo junta, en un lugar, comprobaciones sobre datos que ya están
 * cargados (o que el Panel ya pidió) y dice dónde mirar. Un renglón cuya comprobación no se pudo hacer se OMITE (no se afirma lo que
 * no se comprobó). Todo texto pasa por escHtml. Acciones: ACCIONES.tabSinBtn (lleva a una pestaña).
 * ════════════════════════════════════════════════════════════════════════════ */
const Cierre = (() => {
  const pl = (n, uno, varios) => (n === 1 ? uno : varios);
  const fechasFaltan = pe => ['fecha_inicio', 'fecha_fin_trabajo', 'fecha_entrega', 'fecha_jornada'].filter(k => !pe?.[k]).length;
  const evaluables = (users, inactivos) => (users || []).filter(u => !u.es_admin && u.aprobado !== false && !(inactivos && inactivos.has(u.id)));

  /** Fila de comprobación. `ok` null = no se pudo comprobar (la fila se omite). */
  const fila = (id, ok, titulo, detalle, tab, cta) => ({ id, ok, titulo, detalle, tab, cta });
  const limpia = filas => filas.filter(f => f.ok !== null && f.ok !== undefined);

  /**
   * datos: { pe, users, inactivos:Set, evaluaciones:[{evaluado_id,estado}], v2:boolean,
   *          reglas:{confirmado}|null, porRevisar:number|null, distritos:[{id,nombre}]|null,
   *          estadisticas:[{distrito_id}]|null, evalsDistrito:[{distrito_id,estado}]|null }
   */
  function cierre(d) {
    const { pe } = d; if (!pe) return [];
    const out = [];
    const f = fechasFaltan(pe);
    out.push(fila('fechas', f === 0, 'Fechas del período completas', f ? `Faltan ${f} de las 4 fechas (inicio, fin del trabajo, entrega, jornada).` : 'Las cuatro fechas están puestas.', 'periodos', 'Abrir Períodos'));
    if (d.v2) {
      const rc = d.reglas ? !!d.reglas.confirmado : null;
      out.push(fila('reglas', rc, 'Reglas de calificación de tareas confirmadas', rc === false ? 'El peso de las tareas sigue «sin confirmar»: guarda las reglas para confirmarlas.' : 'Las reglas están confirmadas.', 'tareas', 'Abrir Tareas'));
      const pr = d.porRevisar;
      out.push(fila('revisar', pr == null ? null : pr === 0, 'Entregas por revisar', pr ? `${pr} ${pl(pr, 'entrega espera', 'entregas esperan')} revisión.` : 'No hay entregas esperando revisión.', 'tareas', 'Revisar'));
    }
    const ev = evaluables(d.users, d.inactivos);
    const evs = d.evaluaciones || [];
    const pub = new Set(evs.filter(e => e.estado === 'publicado').map(e => e.evaluado_id));
    const sinPub = ev.filter(u => !pub.has(u.id)).length;
    out.push(fila('evaluaciones', sinPub === 0, 'Todas las personas con evaluación publicada', sinPub ? `${sinPub} de ${ev.length} ${pl(sinPub, 'persona no tiene', 'personas no tienen')} evaluación publicada.` : `Las ${ev.length} personas que participan tienen evaluación publicada.`, 'evaluar', 'Evaluar'));
    if (d.distritos && d.distritos.length) {
      const est = new Set((d.estadisticas || []).map(e => e.distrito_id));
      const sinEst = d.estadisticas ? d.distritos.filter(x => !est.has(x.id)).length : null;
      out.push(fila('estadisticas', sinEst == null ? null : sinEst === 0, 'Estadísticas de Instagram de cada distrito', sinEst ? `${sinEst} de ${d.distritos.length} ${pl(sinEst, 'distrito no envió', 'distritos no enviaron')} sus estadísticas.` : `Los ${d.distritos.length} distritos enviaron sus estadísticas.`, 'distritos', 'Ver distritos'));
      const evd = new Set((d.evalsDistrito || []).filter(e => e.estado === 'publicado').map(e => e.distrito_id));
      const sinEvD = d.evalsDistrito ? d.distritos.filter(x => !evd.has(x.id)).length : null;
      out.push(fila('eval-distritos', sinEvD == null ? null : sinEvD === 0, 'Cada distrito evaluado y publicado', sinEvD ? `${sinEvD} de ${d.distritos.length} ${pl(sinEvD, 'distrito falta', 'distritos faltan')} por evaluar o publicar.` : 'Todos los distritos tienen evaluación publicada.', 'distritos', 'Evaluar distritos'));
    }
    return limpia(out);
  }

  /** datos: { pe, users, roles, perfiles, periodos, perfilVigente:fn(rolId, peId), v2:boolean, reglas:{confirmado}|null } */
  function preparar(d) {
    const { pe } = d; if (!pe) return [];
    const out = [];
    const aprob = (d.users || []).filter(u => !u.es_admin && u.aprobado !== false);
    const sinRol = aprob.filter(u => !u.rol_id).length;
    out.push(fila('rol', sinRol === 0, 'Cada persona tiene su rol', sinRol ? `${sinRol} ${pl(sinRol, 'persona aprobada no tiene', 'personas aprobadas no tienen')} rol: sin rol no se puede evaluar.` : 'Todas las personas aprobadas tienen rol.', 'usuarios', 'Abrir Personas'));
    const sinDist = aprob.filter(u => !u.distrito).length;
    out.push(fila('distrito', sinDist === 0, 'Cada persona tiene su distrito', sinDist ? `${sinDist} ${pl(sinDist, 'persona no tiene', 'personas no tienen')} distrito.` : 'Todas las personas aprobadas tienen distrito.', 'usuarios', 'Abrir Personas'));
    if (d.v2 && typeof d.perfilVigente === 'function') {
      const enUso = [...new Set(aprob.map(u => u.rol_id).filter(Boolean))];
      const sinPerfil = enUso.filter(r => !d.perfilVigente(r, pe.id));
      const nombre = id => (d.roles || []).find(r => String(r.id) === String(id))?.nombre || 'rol';
      out.push(fila('perfiles', sinPerfil.length === 0, 'Cada rol en uso tiene su perfil de evaluación', sinPerfil.length ? `Sin perfil vigente: ${sinPerfil.map(nombre).join(', ')}.` : 'Todos los roles en uso tienen perfil vigente.', 'roles', 'Abrir Roles y perfiles'));
    }
    const f = fechasFaltan(pe);
    out.push(fila('fechas', f === 0, 'Fechas del período completas', f ? `Faltan ${f} de las 4 fechas.` : 'Las cuatro fechas están puestas.', 'periodos', 'Abrir Períodos'));
    if (d.v2) {
      const rc = d.reglas ? !!d.reglas.confirmado : null;
      out.push(fila('reglas', rc, 'Reglas de calificación de tareas confirmadas', rc === false ? 'El peso de las tareas sigue «sin confirmar».' : 'Las reglas están confirmadas.', 'tareas', 'Abrir Tareas'));
    }
    return limpia(out);
  }

  const resumen = lista => ({ ok: lista.filter(f => f.ok).length, total: lista.length });

  /** opciones: { titulo, sub, plegable } */
  function html(lista, { titulo = '', sub = '', plegable = false, id = 'cierre' } = {}) {
    if (!lista.length) return '';
    const r = resumen(lista);
    const filas = lista.map(f => `<li class="cr-fila${f.ok ? ' cr-ok' : ''}">
        <i data-lucide="${f.ok ? 'circle-check' : 'circle-alert'}" class="cr-ico" aria-hidden="true"></i>
        <div class="cr-txt"><span class="cr-t">${escHtml(f.titulo)}<span class="sr-only">${f.ok ? ' (listo)' : ' (pendiente)'}</span></span><small class="cr-d">${escHtml(f.detalle)}</small></div>
        ${f.ok ? '' : `<button type="button" class="atn-acc" data-act="tabSinBtn" data-arg="${escHtml(f.tab)}">${escHtml(f.cta)}<i data-lucide="chevron-right" aria-hidden="true"></i></button>`}
      </li>`).join('');
    const cab = `<span class="cr-t-h">${escHtml(titulo)}</span><span class="cr-prog" role="img" aria-label="${r.ok} de ${r.total} listos">${r.ok} de ${r.total} listos</span>`;
    const cuerpo = `${sub ? `<p class="cr-sub">${escHtml(sub)}</p>` : ''}<ul class="cr-lista">${filas}</ul>`;
    return plegable
      ? `<section class="cr" id="${escHtml(id)}"><details class="cr-det"${r.ok === r.total ? '' : ' open'}><summary class="cr-sum">${cab}</summary>${cuerpo}</details></section>`
      : `<section class="cr" id="${escHtml(id)}"><header class="cr-cab">${cab}</header>${cuerpo}</section>`;
  }

  return { cierre, preparar, html, resumen };
})();
window.Cierre = Cierre;
