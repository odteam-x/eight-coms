'use strict';
/**
 * EIGHT CREATORS LABs — Criterios dinámicos (administración · migración 0020)
 * ───────────────────────────────────────────────────────────────────────────
 * La administración crea, edita, activa, desactiva, ordena y —si nunca se usó— elimina
 * criterios del catálogo sin tocar código. Extiende `criterios_v2`; no hay un sistema paralelo.
 *
 *   escala   puntaje 1–5 con anclas. Entra en las fórmulas. Común (núcleo) o del rol (técnico).
 *   si_no / opcion / texto   campos de REGISTRO: se guardan con la evaluación y no puntúan.
 *                            Son comunes a todos los roles.
 *
 * La base valida de verdad (criterios_v2_validar, criterios_v2_protegido); aquí se repite lo
 * barato para avisar antes de enviar y se muestran sus mensajes tal cual.
 * Comparte los globales de admin.js (patrón de admin-personas.js).
 */
const CriteriosAdmin = (() => {
  const dinamico = () => API.v2Dinamico(_criteriosV2);
  const enPerfil = key => (_perfiles || []).some(p => (p.perfil_criterios || []).some(x => x.criterio_key === key));

  const GRUPOS = [
    { id: 'nucleo',   titulo: 'Competencias comunes',  desc: 'Las mismas para todos los roles; se comparan en valor absoluto.',
      test: c => c.tipo === 'nucleo' && tipoCampoDe(c) === 'escala' },
    { id: 'registro', titulo: 'Campos de registro',    desc: 'Datos que se guardan con cada evaluación y no puntúan: sí/no, una opción o un texto.',
      test: c => c.tipo === 'nucleo' && tipoCampoDe(c) !== 'escala', soloDinamico: true },
    { id: 'tecnico',  titulo: 'Competencias del rol',  desc: 'Cada rol usa las suyas, con el peso que le da su perfil.',
      test: c => c.tipo === 'tecnico' },
  ];
  const ordenar = lista => [...lista].sort((a, b) => (a.activo === false) - (b.activo === false) || a.orden - b.orden || a.id - b.id);

  function filaHTML(c, i, lista, gestion) {
    const t = tipoCampoDe(c);
    const etqs = [
      t !== 'escala' ? `<span class="etiqueta etq-cian">${escHtml(TIPOS_CAMPO[t].etiqueta)}</span>` : '',
      c.obligatorio === false ? '<span class="etiqueta etq-gris" title="Si falta, igual se puede publicar">Opcional</span>' : '',
      c.activo === false ? '<span class="etiqueta etq-gris" title="No se ofrece en evaluaciones nuevas; lo ya evaluado se conserva">Desactivado</span>' : '',
      gestion && enPerfil(c.key) ? '<span class="etiqueta etq-azul" title="Un perfil lo pesa">En un perfil</span>' : '',
    ].join('');
    const cuerpo = t === 'escala' ? descriptoresHTML(c)
      : t === 'opcion' ? `<ul class="rub-opc">${(c.opciones || []).map(o => `<li>${escHtml(o)}</li>`).join('')}</ul>`
      : `<p class="v2-desc-nota">${escHtml(TIPOS_CAMPO[t].ayuda)}</p>`;
    const activos = lista.filter(x => x.activo !== false);
    const pos = lista.indexOf(c);
    const acc = gestion ? `<div class="rub-acc" role="group" aria-label="Acciones de ${escHtml(c.nombre)}">
        <button type="button" class="btn-icon" data-act="crit2Mover" data-arg="${c.id}" data-arg2="-1" aria-label="Subir ${escHtml(c.nombre)}" title="Subir"${pos === 0 ? ' disabled' : ''}><i data-lucide="chevron-up"></i></button>
        <button type="button" class="btn-icon" data-act="crit2Mover" data-arg="${c.id}" data-arg2="1" aria-label="Bajar ${escHtml(c.nombre)}" title="Bajar"${pos === lista.length - 1 ? ' disabled' : ''}><i data-lucide="chevron-down"></i></button>
        <button type="button" class="btn-icon" data-act="crit2Alternar" data-arg="${c.id}" aria-label="${c.activo === false ? 'Activar' : 'Desactivar'} ${escHtml(c.nombre)}" title="${c.activo === false ? 'Activar' : 'Desactivar'}"><i data-lucide="${c.activo === false ? 'eye' : 'eye-off'}"></i></button>
        <button type="button" class="btn-icon" data-act="crit2Editar" data-arg="${c.id}" aria-label="Editar ${escHtml(c.nombre)}" title="Editar"><i data-lucide="pencil"></i></button>
        <button type="button" class="btn-icon btn-icon--danger" data-act="crit2Borrar" data-arg="${c.id}" aria-label="Eliminar ${escHtml(c.nombre)}" title="Eliminar"><i data-lucide="trash-2"></i></button>
      </div>` : '';
    void activos; void i;
    return `<div class="rub-crit-wrap${c.activo === false ? ' rub-crit--off' : ''}${gestion ? ' rub-crit-wrap--gestion' : ''}">
      <details class="rub-crit"><summary class="fila-aj">
        <div class="fila-aj-txt"><div class="fila-aj-t">${escHtml(c.nombre)} ${etqs}</div>${c.descripcion ? `<div class="fila-aj-d">${escHtml(c.descripcion)}</div>` : ''}</div>
        <span class="fila-aj-ind"><i data-lucide="chevron-down"></i></span>
      </summary><div class="rub-anclas">${cuerpo}</div></details>
      ${acc}
    </div>`;
  }

  /** Catálogo completo: lectura para todos y, con 0020, gestión para la administración. */
  function pintar() {
    const cat = document.getElementById('catalogo-v2'); if (!cat) return;
    if (!v2Disponible() || !_criteriosV2.length) {
      renderVacio(cat, 'La rúbrica por roles aún no está activada en la base de datos (migración 0015).');
      return;
    }
    const gestion = dinamico();
    const grupos = GRUPOS.filter(g => !g.soloDinamico || gestion || _criteriosV2.some(g.test));
    const cab = gestion
      ? `<div class="cfg-toolbar crit2-barra">
           <p class="cfg-hint">Crea un criterio nuevo o ajusta los que hay. Lo que ya se evaluó se conserva: un criterio usado solo se desactiva, no se borra.</p>
           <button type="button" class="btn-save" data-act="crit2Nuevo" data-arg=""><i data-lucide="plus"></i>Nuevo criterio</button>
         </div>`
      : `<div class="v2-nota" role="note">Para crear y editar criterios desde aquí, aplica la migración <strong>0020</strong> en Supabase.</div>`;
    cat.innerHTML = cab + grupos.map(g => {
      const lista = ordenar(_criteriosV2.filter(g.test));
      const act = lista.filter(c => c.activo !== false).length;
      return `<h2 class="cuenta-t">${escHtml(g.titulo)} <span class="cuenta-cont">${act}${lista.length !== act ? ` · ${lista.length - act} desactivado${lista.length - act === 1 ? '' : 's'}` : ''}</span></h2>
        <p class="cfg-hint rub-desc">${escHtml(g.desc)}</p>
        ${lista.length ? `<div class="lista-aj">${lista.map((c, i) => filaHTML(c, i, lista, gestion)).join('')}</div>`
          : `<p class="cfg-hint">Aún no hay criterios aquí. Crea el primero con «Nuevo criterio».</p>`}`;
    }).join('<div style="height:var(--sec-main)"></div>');
    renderIconos(cat);
  }

  async function recargar() {
    _criteriosV2 = await API.getCriteriosV2();
    Store.set({ criteriosV2: _criteriosV2 });
    pintar();
    refrescarPesos();
  }

  /* ── Pesos del perfil: solo criterios técnicos de escala y activos ───── */
  function pesosHTML() {
    const lista = ordenar(_criteriosV2.filter(c => c.tipo === 'tecnico' && tipoCampoDe(c) === 'escala' && c.activo !== false));
    if (!lista.length) return '<p class="cfg-hint">Aún no hay criterios técnicos. Crea el primero con «Crear criterio».</p>';
    return lista.map(c => `
      <div class="v2-peso-fila">
        <label for="mpf-w-${escHtml(c.key)}">${escHtml(c.nombre)}${c.descripcion ? `<small>${escHtml(c.descripcion)}</small>` : ''}</label>
        <input class="cfg-inp" type="number" min="0" max="100" step="1" inputmode="numeric"
          id="mpf-w-${escHtml(c.key)}" data-key="${escHtml(c.key)}" data-input="actualizarSumaPerfil" placeholder="0">
      </div>`).join('');
  }

  /** Vuelve a pintar los pesos conservando lo que ya se escribió (p. ej. tras crear un criterio desde el modal). */
  function refrescarPesos(enfocar) {
    const host = document.getElementById('mpf-pesos'); if (!host || !document.getElementById('modal-perfil') || document.getElementById('modal-perfil').style.display === 'none') return;
    const previos = {};
    host.querySelectorAll('input').forEach(i => { if (i.value !== '') previos[i.dataset.key] = i.value; });
    host.innerHTML = pesosHTML();
    Object.entries(previos).forEach(([k, v]) => { const i = document.getElementById('mpf-w-' + k); if (i) i.value = v; });
    actualizarSumaPerfil();
    if (enfocar) document.getElementById('mpf-w-' + enfocar)?.focus();
  }

  return { pintar, recargar, pesosHTML, refrescarPesos, enPerfil };
})();

/* ══ Modal de criterio ═════════════════════════════════════════════════ */
let _crit2 = { id: null, desdePerfil: false };

/** `id`: criterio a editar (o null para uno nuevo). `grupo`: 'tecnico' fija el grupo (desde el perfil). */
function showCriterio2Modal(id, grupo) {
  if (!API.v2Dinamico(_criteriosV2)) { showToast('Aplica primero la migración 0020 para crear y editar criterios.', 'error'); return; }
  const c = id != null && id !== '' ? _criteriosV2.find(x => String(x.id) === String(id)) : null;
  _crit2 = { id: c?.id ?? null, desdePerfil: grupo === 'tecnico' && !c };
  const $ = s => document.getElementById(s);
  $('mc2-id').value = c?.id ?? '';
  $('mc2-nombre').value = c?.nombre || '';
  $('mc2-desc').value = c?.descripcion || '';
  $('mc2-grupo').value = c?.tipo || (grupo === 'tecnico' ? 'tecnico' : 'nucleo');
  document.querySelectorAll('input[name="mc2-tc"]').forEach(r => { r.checked = r.value === tipoCampoDe(c); });
  $('mc2-opciones').value = (c?.opciones || []).join('\n');
  $('mc2-d1').value = c?.desc_1 || ''; $('mc2-d3').value = c?.desc_3 || ''; $('mc2-d5').value = c?.desc_5 || '';
  $('mc2-obl').checked = c ? c.obligatorio !== false : true;
  $('mc2-act').checked = c ? c.activo !== false : true;
  const enPerfil = c && CriteriosAdmin.enPerfil(c.key);
  // Lo que un perfil ya pesa no cambia de tipo ni de grupo (la base también lo impide).
  document.querySelectorAll('input[name="mc2-tc"]').forEach(r => { r.disabled = !!enPerfil || (_crit2.desdePerfil && r.value !== 'escala'); });
  $('mc2-grupo').disabled = !!enPerfil || _crit2.desdePerfil;
  $('mc2-uso').hidden = !enPerfil;
  $('mc2-uso').textContent = enPerfil ? 'Este criterio está en un perfil: no se cambia su tipo ni su grupo, y no se elimina; solo se puede desactivar. Su nombre, descripción y anclas sí se pueden mejorar.' : '';
  $('mc2-err').textContent = '';
  setEl('modal-crit2-title', c ? 'Editar criterio' : (_crit2.desdePerfil ? 'Nuevo criterio técnico' : 'Nuevo criterio'));
  vistaCriterio2();
  openModal('modal-crit2');
}

/** Muestra solo los campos que corresponden al tipo elegido. */
function vistaCriterio2() {
  const t = document.querySelector('input[name="mc2-tc"]:checked')?.value || 'escala';
  document.getElementById('mc2-opc-field').hidden = t !== 'opcion';
  document.getElementById('mc2-anclas').hidden = t !== 'escala';
  const grupo = document.getElementById('mc2-grupo');
  const previo = _crit2.id != null ? _criteriosV2.find(x => x.id === _crit2.id) : null;
  const bloqueado = _crit2.desdePerfil || (previo && CriteriosAdmin.enPerfil(previo.key));
  // Un campo de registro es común a todos los roles; los técnicos son siempre de escala.
  if (t !== 'escala') grupo.value = 'nucleo';
  grupo.disabled = !!bloqueado || t !== 'escala';
  document.getElementById('mc2-obl-ayuda').textContent = t === 'escala'
    ? 'Si no es obligatorio y se deja sin puntuar, queda fuera del promedio (nunca vale 0) y la evaluación se puede publicar igual.'
    : 'Si no es obligatorio, la evaluación se puede publicar sin responderlo.';
}

function _opcionesDelModal() {
  return document.getElementById('mc2-opciones').value.split('\n').map(s => s.trim()).filter(Boolean);
}

async function guardarCriterio2() {
  const $ = s => document.getElementById(s);
  const err = $('mc2-err');
  const tipo_campo = document.querySelector('input[name="mc2-tc"]:checked')?.value || 'escala';
  const nombre = $('mc2-nombre').value.trim(), descripcion = $('mc2-desc').value.trim();
  const opciones = tipo_campo === 'opcion' ? _opcionesDelModal() : [];
  // Mismas reglas que la base (criterios_v2_validar): aquí solo para avisar antes de enviar.
  if (!nombre) { err.textContent = 'Escribe un nombre.'; $('mc2-nombre').focus(); return; }
  if (nombre.length > 80) { err.textContent = 'El nombre no puede pasar de 80 caracteres.'; return; }
  if (descripcion.length > 500) { err.textContent = 'La descripción no puede pasar de 500 caracteres.'; return; }
  if (tipo_campo === 'opcion') {
    if (opciones.length < 2 || opciones.length > 12) { err.textContent = 'Un campo de opciones necesita entre 2 y 12 opciones (una por línea).'; $('mc2-opciones').focus(); return; }
    if (opciones.some(o => o.length > 60)) { err.textContent = 'Cada opción puede tener hasta 60 caracteres.'; return; }
    if (new Set(opciones.map(o => o.toLowerCase())).size !== opciones.length) { err.textContent = 'Hay opciones repetidas.'; return; }
  }
  const tipo = tipo_campo === 'escala' ? $('mc2-grupo').value : 'nucleo';
  const previo = _crit2.id != null ? _criteriosV2.find(x => x.id === _crit2.id) : null;
  const btn = document.querySelector('#modal-crit2 .btn-save'); btn.disabled = true;
  const res = await API.saveCriterioV2({
    id: _crit2.id, nombre, descripcion, tipo, tipo_campo, opciones,
    obligatorio: $('mc2-obl').checked, activo: $('mc2-act').checked,
    desc_1: tipo_campo === 'escala' ? $('mc2-d1').value.trim() : '', desc_3: tipo_campo === 'escala' ? $('mc2-d3').value.trim() : '', desc_5: tipo_campo === 'escala' ? $('mc2-d5').value.trim() : '',
  });
  btn.disabled = false;
  if (!res.ok) { err.textContent = res.error; return; }   // mensajes de la base, ya redactados
  showToast(previo ? 'Criterio actualizado' : 'Criterio creado', 'ok');
  closeModal('modal-crit2');
  _criteriosV2 = await API.getCriteriosV2();
  Store.set({ criteriosV2: _criteriosV2 });
  CriteriosAdmin.pintar();
  // Si se creó desde el perfil, el criterio nuevo aparece en los pesos listo para recibir uno.
  CriteriosAdmin.refrescarPesos(!previo && tipo === 'tecnico' ? res.criterio?.key : null);
  if (typeof renderRoles === 'function') renderRoles();
}

async function alternarCriterio2(id) {
  const c = _criteriosV2.find(x => String(x.id) === String(id)); if (!c) return;
  const res = await API.saveCriterioV2({ ...c, activo: c.activo === false });
  if (!res.ok) { showToast(res.error, 'error'); return; }
  showToast(c.activo === false ? 'Criterio activado' : 'Criterio desactivado: lo ya evaluado se conserva', 'ok');
  await CriteriosAdmin.recargar();
}

function borrarCriterio2(id) {
  const c = _criteriosV2.find(x => String(x.id) === String(id)); if (!c) return;
  if (CriteriosAdmin.enPerfil(c.key)) {
    showToast('Ese criterio está en un perfil: solo se puede desactivar.', 'error');
    return;
  }
  Tareas.abrirModal({
    titulo: 'Eliminar criterio', confirmar: 'Eliminar',
    campos: [{ id: 'i', tipo: 'info', texto: `«${c.nombre}» se elimina del catálogo. Solo es posible si nunca se usó en una evaluación; si no, la base lo impedirá y podrás desactivarlo.` }],
    onConfirm: async () => {
      const r = await API.deleteCriterioV2(c.id);
      if (!r.ok) return r.error;
      showToast('Criterio eliminado', 'ok');
      await CriteriosAdmin.recargar();
      return null;
    },
  });
}

/** Sube o baja un criterio dentro de su grupo intercambiando su orden con el vecino. */
async function moverCriterio2(id, delta) {
  const c = _criteriosV2.find(x => String(x.id) === String(id)); if (!c) return;
  const mismoGrupo = _criteriosV2.filter(x => x.tipo === c.tipo && (tipoCampoDe(x) === 'escala') === (tipoCampoDe(c) === 'escala'));
  const lista = [...mismoGrupo].sort((a, b) => (a.activo === false) - (b.activo === false) || a.orden - b.orden || a.id - b.id);
  const i = lista.indexOf(c), j = i + Number(delta);
  if (j < 0 || j >= lista.length) return;
  const vecino = lista[j];
  let res;
  if (c.orden === vecino.orden) {
    // Orden empatado: se renumera el grupo en el orden mostrado.
    const nuevo = [...lista]; nuevo.splice(i, 1); nuevo.splice(j, 0, c);
    const base = Math.min(...lista.map(x => x.orden));
    const rs = await Promise.all(nuevo.map((x, k) => SB.from('criterios_v2').update({ orden: base + k }).eq('id', x.id)));
    res = rs.find(r => r.error) ? { ok: false, error: rs.find(r => r.error).error.message } : { ok: true };
  } else {
    res = await API.moverCriterioV2(c, vecino);
  }
  if (!res.ok) { showToast(res.error, 'error'); return; }
  await CriteriosAdmin.recargar();
}
