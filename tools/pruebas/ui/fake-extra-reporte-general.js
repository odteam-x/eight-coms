'use strict';
/* Extensión del simulador: reporte_general_pe (migración 0050).
   Solo para que la UI tenga algo que pintar; las reglas de verdad las prueba tools/pruebas/sql-0050.mjs.
   Se apoya en seguimiento_global del propio simulador (que ya filtra por quién llama) y reproduce el
   agrupamiento de la función SQL. Se carga detrás de fake-supabase-client.js (ver ui/server.mjs).
   ?rg=vacio  → gestión sin PE · ?rg=error → la función falla · ?rg=ausente → la migración no está aplicada. */
(() => {
  const orig = window.SB.rpc.bind(window.SB);
  const DB = window.__FAKE.DB;
  const modo = new URLSearchParams(location.search).get('rg') || sessionStorage.getItem('fake_rg') || '';
  if (modo) sessionStorage.setItem('fake_rg', modo === '0' ? '' : modo);
  const hoy = new Date().toISOString().slice(0, 10);
  const sum = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);

  async function reporte({ p_gestion, p_distrito, p_rol }) {
    const sg = await orig('seguimiento_global', { p_gestion });
    if (sg.error) throw new Error(sg.error.message);
    const s = sg.data.filter(r => (p_distrito == null || r.distrito === p_distrito || (p_distrito === '' && !r.distrito)) && (p_rol == null || r.rol_id === p_rol));
    const quienes = new Set(s.map(r => r.persona_id));
    const sesion = (await window.SB.auth.getUser()).data.user.id;
    const yo = DB.profiles.find(p => p.id === sesion);
    const v = yo.es_admin ? 'todo' : (yo.tipo_miembro === 'secretario' ? 'distrito' : 'propio');
    const ahora = new Date().toISOString();
    const pers = DB.periodos_evaluacion.filter(p => p.gestion_id === Number(p_gestion ?? 1)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const filas = pers.map((per, i) => {
      const f = s.filter(r => r.periodo_id === per.id), part = f.filter(r => r.participa), pub = part.filter(r => r.estado_eval === 'publicado');
      const val = r => per.modelo === 'v2' ? r.individual : r.total_clasico;
      const tk = DB.tareas.filter(t => t.periodo_id === per.id && quienes.has(t.asignada_a));
      const fin = per.fecha_jornada || per.fecha_entrega || per.fecha_fin_trabajo || per.fecha_inicio || null;
      const por = (key, nom) => [...new Map(f.map(r => [key(r), 1])).keys()].sort().map(k => {
        const g = f.filter(r => key(r) === k);
        return nom(k, g, { personas: g.length, participan: g.filter(r => r.participa).length, publicadas: g.filter(r => r.participa && r.estado_eval === 'publicado').length });
      });
      return {
        periodo_id: per.id, periodo_nombre: per.nombre, descripcion: per.descripcion || '', orden: i + 1, modelo: per.modelo, activo: !!per.activo,
        fecha_inicio: per.fecha_inicio || null, fecha_fin_trabajo: per.fecha_fin_trabajo || null, fecha_entrega: per.fecha_entrega || null, fecha_jornada: per.fecha_jornada || null,
        estado_pe: per.activo ? 'activo' : (per.fecha_inicio && per.fecha_inicio > hoy ? 'proximo' : (fin && fin < hoy ? 'cerrado' : (!per.fecha_inicio && !fin ? 'sin_fechas' : 'inactivo'))),
        vista: v, personas: f.length, participan: part.length, no_participan: f.length - part.length,
        eval_publicadas: pub.length, eval_no_publicadas: part.filter(r => ['borrador', 'sin_publicar'].includes(r.estado_eval)).length,
        eval_sin_evaluar: part.filter(r => r.estado_eval === 'sin_evaluar').length,
        n_resultados: pub.filter(r => val(r) != null).length, suma_resultado: sum(pub, val),
        n_nucleo: pub.filter(r => r.nucleo != null).length, suma_nucleo: sum(pub, r => r.nucleo), n_tecnico: pub.filter(r => r.tecnico != null).length, suma_tecnico: sum(pub, r => r.tecnico),
        tareas_aplican: per.modelo === 'v2',
        tareas_total: sum(f, r => r.tareas_total), tareas_asignadas: tk.filter(t => t.origen === 'asignada').length, tareas_propias: tk.filter(t => t.origen === 'propia').length,
        tareas_abiertas: sum(f, r => r.tareas_abiertas), tareas_en_revision: tk.filter(t => t.estado === 'entregada').length, tareas_aprobadas: sum(f, r => r.tareas_aprobadas),
        tareas_devueltas: tk.filter(t => t.estado === 'devuelta').length, tareas_bloqueadas: tk.filter(t => t.estado === 'bloqueada').length, tareas_vencidas: sum(f, r => r.tareas_vencidas),
        tareas_entregadas: tk.filter(t => t.origen === 'asignada' && t.entregada_en).length, con_plazo: sum(f, r => r.con_plazo), a_tiempo: sum(f, r => r.a_tiempo),
        puntos_suma: sum(f, r => r.puntos_suma), puntos_n: sum(f, r => r.puntos_n),
        actividades_con_tareas: new Set(tk.filter(t => t.actividad_id != null).map(t => t.actividad_id)).size,
        tareas_en_actividades: tk.filter(t => t.actividad_id != null).length, tareas_en_actividades_aprobadas: tk.filter(t => t.actividad_id != null && t.estado === 'aprobada').length,
        por_distrito: por(r => r.distrito || '', (k, g, c) => ({ distrito: k, ...c })),
        por_rol: por(r => r.rol_id ?? '', (k, g, c) => ({ rol_id: k === '' ? null : k, rol: g[0].rol_nombre || '', ...c })),
        g_personas: quienes.size, g_participan_alguno: new Set(s.filter(r => r.participa).map(r => r.persona_id)).size,
        g_con_publicada: new Set(s.filter(r => r.participa && r.estado_eval === 'publicado').map(r => r.persona_id)).size,
        generado_en: ahora,
      };
    });
    return filas;
  }

  window.SB.rpc = async (n, a) => {
    if (n !== 'reporte_general_pe') return orig(n, a);
    if (modo === 'ausente') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.reporte_general_pe' } };
    if (modo === 'error') return { data: null, error: { message: 'canceling statement due to statement timeout' } };
    if (modo === 'vacio') return { data: [], error: null };
    try { return { data: await reporte(a || {}), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; }
  };
})();
