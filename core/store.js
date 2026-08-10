'use strict';
/**
 * EIGHT CREATORS LABs — Estado único (Fase 3A)
 * ─────────────────────────────────────────────
 * Un solo período gobierna TODA la página.
 *
 * Antes secretario.js tenía cuatro variables independientes — mPE, rPE, dPE
 * y _trabajosPE — así que el usuario elegía "PE2" en Mi Score y el ranking
 * se quedaba en PE1. Aquí el período vive una sola vez y quien cambia lo
 * notifica a todas las secciones suscritas.
 *
 * CLAVE CANÓNICA: `periodoId` (UUID). El nombre ("PE4") es solo etiqueta de
 * UI. El admin escribe por periodo_id y el portal leía por nombre: esa
 * costura es justo donde nacía el bug del período.
 *
 * Depende de: nada. Cárgalo antes que core/render.js.
 */
const Store = (() => {

  const _state = {
    profile:     null,
    periodos:    [],     // [{ id, pe, nombre, activo, inicio, ... }]
    criterios:   [],
    periodoId:   null,   // UUID del período seleccionado
    data:        null,   // payload de API.getData (la Fase 3B lo desmonta)
    lastUpdated: null,
  };

  const _cargado = new Set();   // pestañas ya cargadas (3.11)
  const _subs    = [];          // suscriptores al cambio de período

  /* ── Lectura ──────────────────────────────────────────────────────── */
  const get       = k => _state[k];
  const periodos  = () => _state.periodos;
  const criterios = () => _state.criterios;
  const profile   = () => _state.profile;
  const data      = () => _state.data;
  const lastUpdated = () => _state.lastUpdated;

  /** Objeto del período seleccionado, o null. */
  function periodo() {
    if (_state.periodoId == null) return null;
    return _state.periodos.find(p => String(p.id) === String(_state.periodoId)) || null;
  }
  const periodoId     = () => _state.periodoId;
  const periodoNombre = () => periodo()?.pe ?? null;

  /** El período marcado activo en la base, o null si no hay ninguno. */
  const periodoActivo = () => _state.periodos.find(p => p.activo) || null;

  /* ── Escritura ────────────────────────────────────────────────────── */
  function set(patch) { Object.assign(_state, patch); }

  /**
   * Cambia el período seleccionado y avisa a los suscriptores.
   * Acepta id (preferido) o nombre (compatibilidad con la UI actual).
   * Devuelve true solo si hubo cambio real.
   */
  function setPeriodo(idOrNombre) {
    if (idOrNombre == null) return false;
    const p = _state.periodos.find(x => String(x.id) === String(idOrNombre))
           || _state.periodos.find(x => x.pe === idOrNombre);
    if (!p) return false;
    if (String(p.id) === String(_state.periodoId)) return false;

    _state.periodoId = p.id;
    _subs.forEach(fn => {
      try { fn(p); } catch (e) { console.error('[Store] suscriptor falló:', e); }
    });
    return true;
  }

  /** Se llama cuando cambia el período. Repinta tu sección aquí. */
  function onPeriodoChange(fn) { if (typeof fn === 'function') _subs.push(fn); }

  /* ── Política de carga por pestaña (3.11) ─────────────────────────
   * Una sola regla para todas: se carga la primera vez y solo se vuelve a
   * cargar si alguien invalida explícitamente. Antes cada pestaña decidía
   * por su cuenta: Períodos re-renderizaba siempre, Reportes se cargaba una
   * vez y no se refrescaba nunca, Trabajos pedía datos en cada cambio.
   */
  const necesitaCarga = tab => !_cargado.has(tab);
  const marcarCargado = tab => { _cargado.add(tab); };
  const invalidar     = tab => { tab ? _cargado.delete(tab) : _cargado.clear(); };

  return {
    get, set,
    profile, periodos, criterios, data, lastUpdated,
    periodo, periodoId, periodoNombre, periodoActivo,
    setPeriodo, onPeriodoChange,
    necesitaCarga, marcarCargado, invalidar,
  };
})();
