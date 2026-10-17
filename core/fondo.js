'use strict';
/**
 * EIGHT CREATORS LABs — Fondo de la tarjeta de perfil
 * ───────────────────────────────────────────────────
 * Cada persona elige cuál de los siete patrones de la marca (img/patrones/patron-1…7.webp) lleva su tarjeta: la
 * cabecera de Mi perfil y la banda de Inicio. «Automático» (valor nulo) deja el de siempre, derivado del id.
 *
 *   · Las opciones son SOLO las que ya tenemos: los siete patrones. No se sube ni se dibuja nada.
 *   · Se guarda en `profiles.fondo` (1–7 o NULL, migración 0030). La propia persona escribe su fila (RLS) y quien puede
 *     abrir su perfil (secretaría de su distrito, administración) ve el mismo fondo.
 *   · Sin la migración, elegir avisa con claridad y no cambia nada.
 * La vista previa y la tarjeta se repintan al instante; el estado seleccionado lo dicen el aro, la marca ✓ y aria-checked.
 */
const Fondo = (() => {
  const N = 7;
  const _auto = id => [...String(id || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % N;
  let _p = null;

  /** 0–6: clase `pat-N` de la tarjeta de esta persona (su elección, o la automática). */
  function clase(p) {
    const f = Number(p?.fondo);
    return Number.isInteger(f) && f >= 1 && f <= N ? f - 1 : _auto(p?.id);
  }

  const _actual = () => (Number.isInteger(Number(_p?.fondo)) && Number(_p.fondo) >= 1 && Number(_p.fondo) <= N ? Number(_p.fondo) : 0);

  function _html() {
    const sel = _actual();
    const op = (n) => {
      const on = sel === n;
      return `<button type="button" role="radio" aria-checked="${on}" class="fondo-op sup-marca pat-${n - 1}${on ? ' on' : ''}" data-act="fondoElegir" data-arg="${n}" aria-label="Fondo ${n}">${on ? '<i data-lucide="check" aria-hidden="true"></i>' : ''}</button>`;
    };
    return `
      <h3 class="cuenta-t" id="cu-t-fondo">Fondo de tu perfil</h3>
      <div class="lista-aj fondo-caja">
        <div class="fondo-vista sup-marca pat-${clase(_p)}" id="fondo-vista" aria-hidden="true"><span>Así se ve tu tarjeta</span></div>
        <div class="fondo-opciones" role="radiogroup" aria-labelledby="cu-t-fondo">
          <button type="button" role="radio" aria-checked="${sel === 0}" class="fondo-op fondo-op--auto${sel === 0 ? ' on' : ''}" data-act="fondoElegir" data-arg="0" aria-label="Fondo automático">
            ${sel === 0 ? '<i data-lucide="check" aria-hidden="true"></i>' : ''}<span>Auto</span></button>
          ${Array.from({ length: N }, (_, i) => op(i + 1)).join('')}
        </div>
        <p class="fondo-nota">Lo ven también quienes pueden abrir tu perfil (tu secretaría y la administración).</p>
      </div>`;
  }

  /** Lo llama Mi cuenta al pintarse. */
  function montar(host, perfil) {
    if (!host || !perfil) return;
    _p = perfil;
    host.innerHTML = _html();
    if (typeof renderIconos === 'function') renderIconos(host);
  }

  /** Repinta las tarjetas de ESTA persona que ya están en pantalla (Inicio, Mi perfil) sin recargar nada. */
  function aplicar() {
    if (!_p) return;
    const c = 'pat-' + clase(_p);
    document.querySelectorAll(`[data-persona="${CSS.escape(String(_p.id))}"]`).forEach(el => {
      el.className = el.className.replace(/\bpat-\d\b/, c);
    });
    const vista = document.getElementById('fondo-vista');
    if (vista) vista.className = vista.className.replace(/\bpat-\d\b/, c);
  }

  /** @param {number} n 1–7, o 0 para volver al automático */
  async function elegir(n) {
    if (!_p || !Number.isInteger(n) || n < 0 || n > N) return;
    const antes = _p.fondo ?? null, nuevo = n === 0 ? null : n;
    if ((antes ?? 0) === n) return;
    _p.fondo = nuevo;
    montar(document.getElementById('cuenta-fondo'), _p);
    aplicar();
    const r = await API.updateMiFondo(_p.id, nuevo);
    if (r.ok) { showToast(nuevo ? 'Fondo guardado.' : 'Fondo automático.', 'success'); return; }
    _p.fondo = antes;
    montar(document.getElementById('cuenta-fondo'), _p);
    aplicar();
    showToast(r.noDisponible ? 'Elegir el fondo se activa con una actualización de la base de datos; todavía no está disponible.' : 'No se pudo guardar el fondo: ' + r.error, 'error');
  }

  return { N, clase, montar, aplicar, elegir };
})();
