'use strict';
/**
 * EIGHT CREATORS LABs — Inicio: «¿qué me toca ahora?»
 * ─────────────────────────────────────────────────────
 * La primera pantalla de miembro y secretario. No repite el perfil: señala lo
 * que pide atención (tareas devueltas o por vencer), cuándo es lo siguiente
 * (próximas fechas) y en qué estado está mi evaluación del período en curso.
 *
 * PRESENTACIÓN. Ningún cálculo: la evaluación sale de resultados_periodo()
 * (rúbrica por roles) o de calcScore() (rúbrica clásica), las tareas de
 * API.getTareas() y las fechas de los períodos tal cual. En períodos
 * anteriores a la rúbrica por roles no hay tareas asignables: se dice y se
 * remite a Entregas, donde sigue el formulario de trabajos.
 *
 * Quién ve qué lo decide RLS. El secretario añade su bloque propio (pulso del
 * distrito) por el hook `extra`.
 *
 * Depende de: config.js, core/store.js, core/render.js, core/rubrica.js,
 * core/ui.js, core/tareas.js, api.js.
 */
const Inicio = (() => {

  const _patron = id => [...String(id || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 7;
  const _primerNombre = n => String(n || '').trim().split(/\s+/)[0] || '';

  /** Período «en curso»: el activo, o el último creado si no hay ninguno. */
  const _periodo = () => Store.periodoActivo?.() || (Store.periodos() || []).slice(-1)[0] || null;

  /** Mi evaluación del período: { v2, fila } | { v2:false, total, row } | null. */
  async function _evaluacion(persona, periodo) {
    if (!periodo) return null;
    if (esPeriodoV2(periodo)) {
      const r = await API.getResultadosV2(periodo.id);
      if (!r.ok) throw new Error(r.error);
      const fila = r.rows.find(x => x.evaluado_id === persona.id) || null;
      return fila ? { v2: true, fila } : null;
    }
    const ev = await API.getEvaluacion(periodo.id, persona.id);
    if (!ev || ev.estado !== 'publicado') return null;
    const row = { evaluado_id: persona.id, ext: Number(ev.bono_ext) || 0, puntajes: parseJSON(ev.puntajes) };
    return { v2: false, row, total: calcScore(row) };
  }

  /* ── Bloques ─────────────────────────────────────────────────────────── */

  function _heroHTML(persona, periodo, proximo) {
    const estado = periodo ? estadoPeriodo(periodo) : null;
    return `
      <section class="inicio-hero sup-marca pat-${_patron(persona.id)}" aria-labelledby="inicio-titulo">
        <div class="inicio-saludo">
          ${periodo ? `<span class="tag-marca">${escHtml(estado?.label || 'Período')} · ${escHtml(periodo.pe)}</span>` : ''}
          <h2 class="inicio-titulo" id="inicio-titulo">Hola, ${escHtml(_primerNombre(persona.nombre) || 'bienvenido')}</h2>
          <p class="inicio-sub">${periodo
            ? escHtml(periodo.nombre && periodo.nombre !== periodo.pe ? periodo.nombre : `Período ${periodo.pe}`)
            : 'Todavía no hay un período en curso.'}</p>
        </div>
        ${proximo ? `
        <div class="inicio-cuenta" role="group" aria-label="Próxima fecha">
          <div class="inicio-dias"><span data-cuenta="${proximo.dias}" data-dec="0">${proximo.dias}</span></div>
          <div class="inicio-dias-lbl">${proximo.dias === 1 ? 'día' : 'días'} para<br><strong>${escHtml(proximo.etiqueta.toLowerCase())}</strong>
            <span class="inicio-dias-pe">${escHtml(proximo.pe)} · ${escHtml(fechaCortaISO(proximo.fecha))}</span></div>
        </div>` : ''}
      </section>`;
  }

  function _evaluacionHTML(persona, periodo, ev) {
    const cab = `<div class="pf-card-cab"><h3 class="pf-h">Tu evaluación</h3>
      <button type="button" class="pf-enlace" data-act="tab" data-arg="perfil">Ver mi perfil<i data-lucide="arrow-right" aria-hidden="true"></i></button></div>`;
    if (!periodo) return `${cab}<p class="pf-vacio">Cuando haya un período en curso verás aquí cómo vas.</p>`;
    if (!ev) {
      const f = fechaLarga(fechaDisponibilidad(periodo, Store.get('calendario') || null));
      return `${cab}<p class="pf-vacio">Aún no hay evaluación publicada para ${escHtml(periodo.pe)}.${f ? ` Se publica el ${escHtml(f)}.` : ''}</p>`;
    }
    const v = ev.v2 ? ev.fila.individual : ev.total;
    const max = ev.v2 ? 100 : MAX_TOTAL();
    const color = ev.v2 ? scoreColorV2(v) : scoreColor(v);
    const nivel = ev.v2 ? nivelV2(v) : { key: scoreClass(v), label: scoreLabel(v) };
    return `${cab}
      <div class="inicio-eval">
        ${anilloHTML({ valor: v, max, color, etiqueta: `${fmtNum(v)} de ${max}`, decimales: 0 })}
        <div class="inicio-eval-txt">
          <span class="nivel-badge ${nivel.key}">${escHtml(nivel.label)}</span>
          <p class="pf-vacio">${ev.v2
            ? `Individual sobre 100. ${ev.fila.rol_pequeno ? 'Tu rol tiene menos de 4 personas: se usa tu técnico en valor absoluto.' : `Percentil ${fmtNum(ev.fila.percentil, 0)} en tu rol.`}`
            : `Puntaje de ${max}, con la rúbrica clásica.`}</p>
        </div>
      </div>`;
  }

  /** Tareas que piden atención: devueltas primero, luego por fecha. */
  function _atenderHTML(periodo, datos) {
    const cab = (titulo) => `<div class="pf-card-cab"><h3 class="pf-h">${titulo}</h3>
      <button type="button" class="pf-enlace" data-act="tab" data-arg="trabajos">Ir a Entregas<i data-lucide="arrow-right" aria-hidden="true"></i></button></div>`;
    if (!periodo || !esPeriodoV2(periodo)) {
      return `${cab('Para atender')}<p class="pf-vacio">Este período usa el registro de trabajos: lo que hiciste se agrega en Entregas.</p>`;
    }
    if (!datos || datos.noDisponible) return `${cab('Para atender')}<p class="pf-vacio">Las tareas todavía no están activas.</p>`;
    if (datos.error) return `${cab('Para atender')}<p class="pf-vacio" role="alert">No se pudieron cargar las tareas.</p>`;
    const abiertas = datos.tareas.filter(t => ['asignada', 'en_curso', 'devuelta', 'bloqueada'].includes(t.estado));
    const peso = t => (t.estado === 'devuelta' ? 0 : 1);
    abiertas.sort((a, b) => peso(a) - peso(b) || String(a.fecha_limite || '9999').localeCompare(String(b.fecha_limite || '9999')));
    if (!abiertas.length) return `${cab('Para atender')}<p class="pf-vacio">Sin tareas pendientes. ${datos.tareas.length ? 'Todo lo asignado está entregado.' : 'Cuando te asignen una, aparecerá aquí.'}</p>`;
    const E = Tareas.ESTADOS;
    return `${cab(`Para atender <small>${abiertas.length} abierta${abiertas.length === 1 ? '' : 's'}</small>`)}
      <ul class="pf-tareas pf-tareas--compacta">${abiertas.slice(0, 4).map(t => {
        const e = E[t.estado] || E.asignada;
        return `<li class="pf-tarea"><span class="tk-pill tk-pill--${e.cls}">${escHtml(e.txt)}</span>
          <div class="pf-tarea-txt"><div class="pf-tarea-t">${escHtml(t.titulo)}</div><div class="pf-tarea-m">${Tareas.plazoHTML(t)}</div></div></li>`;
      }).join('')}</ul>
      ${abiertas.length > 4 ? `<p class="pf-nota">y ${abiertas.length - 4} más en Entregas.</p>` : ''}`;
  }

  function _fechasHTML(hitos) {
    const cab = `<div class="pf-card-cab"><h3 class="pf-h">Próximas fechas</h3>
      <button type="button" class="pf-enlace" data-act="tab" data-arg="trabajos">Ver línea de tiempo<i data-lucide="arrow-right" aria-hidden="true"></i></button></div>`;
    if (!hitos.length) return `${cab}<p class="pf-vacio">No hay fechas próximas cargadas.</p>`;
    return `${cab}<ol class="inicio-fechas">${hitos.map(h => `
      <li class="inicio-fecha">
        <time class="inicio-fecha-dia" datetime="${escHtml(h.fecha)}">${escHtml(fechaCortaISO(h.fecha))}</time>
        <span class="inicio-fecha-txt">${escHtml(h.etiqueta)} <small>${escHtml(h.pe)}</small></span>
        <span class="inicio-fecha-rel">${escHtml(textoDias(h.dias))}</span>
      </li>`).join('')}</ol>`;
  }

  /**
   * @param {object}   o
   * @param {Element}  o.el
   * @param {object}   o.persona  { id, nombre }
   * @param {function} [o.extra]  (contenedor, { periodo }) → rellena un bloque extra
   *                              (el secretario pinta aquí el pulso de su distrito)
   */
  async function montar({ el, persona, extra = null }) {
    if (!el || !persona) return;
    const periodo = _periodo();
    const proximos = proximosHitos(Store.periodos(), 4);
    el.innerHTML = esqueletoHTML('perfil');

    let ev = null, datos = null, falla = null;
    try {
      [ev, datos] = await Promise.all([
        _evaluacion(persona, periodo),
        periodo && esPeriodoV2(periodo)
          ? API.getTareas({ periodoId: periodo.id, userId: persona.id })
              .then(r => ({ noDisponible: !!r.noDisponible, error: (!r.ok && !r.noDisponible) ? r.error : null, tareas: r.ok ? r.tareas : [] }))
          : Promise.resolve(null),
      ]);
    } catch (e) { falla = e; }
    if (falla) { renderError(el, falla.message || String(falla), () => montar({ el, persona, extra })); return; }

    el.innerHTML = `
      ${_heroHTML(persona, periodo, proximos[0] || null)}
      <div class="inicio-cuerpo m-content">
        <div class="inicio-grid">
          <section class="pf-card" aria-label="Tu evaluación">${_evaluacionHTML(persona, periodo, ev)}</section>
          <section class="pf-card" aria-label="Para atender">${_atenderHTML(periodo, datos)}</section>
          <section class="pf-card pf-card--ancha" aria-label="Próximas fechas">${_fechasHTML(proximos)}</section>
          ${extra ? '<div class="inicio-extra" id="inicio-extra"></div>' : ''}
        </div>
      </div>`;
    animarEntrada(el);
    if (extra) await extra(document.getElementById('inicio-extra'), { periodo });
  }

  return { montar };
})();
