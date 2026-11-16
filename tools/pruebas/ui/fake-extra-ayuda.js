'use strict';
/* «Pedir ayuda» (0068) en el simulador: tablas y RPC con las mismas reglas que la base (visibilidad por rol y distrito, toma atómica,
   permisos de quien pidió / tomó / administra). Sin avisos ni auditoría. Se carga DESPUÉS de fake-supabase-client.js y se engancha a
   `window.__FAKE` (DB, U y, desde fake-supabase-client.js, `__FAKE.RPC`, `me`, `esAdmin`, `esSec`, `permitidos`).
   `?ayuda=0` simula una base SIN la migración (la pantalla lo dice). Para ver la pantalla: admin.html?as=admin, secretario.html?as=sec, user.html?as=m1. */
(() => {
  const F = window.__FAKE; if (!F || !F.RPC) return;
  const { DB, U, RPC, meId, me, esAdmin, esSec, permitidos } = F;
  const ahora = () => new Date().toISOString();
  const dia = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const hace = h => new Date(Date.now() - h * 3600000).toISOString();
  const base = { gestion_id: 1, tomada_por: null, tomada_en: null, resuelta_en: null, confirmada_en: null, cancelada_en: null, enlace: null, descripcion: '', fecha_limite: null };

  DB.ayuda_pedidos = new URLSearchParams(location.search).get('ayuda') === '0' ? undefined : [
    { ...base, id: 1, titulo: 'Fotos del taller de redacción', descripcion: 'Necesito 10 fotos del taller del jueves para la nota. Con créditos de quien las tome.', rol_id: 1, prioridad: 'alta', fecha_limite: dia(3), enlace: 'https://drive.example.com/taller', alcance: 'todos', distrito: '08-01', estado: 'abierta', solicitante_id: U.r1, created_at: hace(5), updated_at: hace(5) },
    { ...base, id: 2, titulo: 'Redactar la nota de la jornada de cierre', descripcion: 'Una nota de 300 palabras con los datos de la jornada.', rol_id: 2, prioridad: 'normal', fecha_limite: dia(6), alcance: 'todos', distrito: '08-01', estado: 'abierta', solicitante_id: U.m1, created_at: hace(30), updated_at: hace(30) },
    { ...base, id: 3, titulo: 'Retratos del equipo para el gafete', rol_id: 1, prioridad: 'urgente', fecha_limite: dia(-1), alcance: 'distrito', distrito: '08-01', estado: 'tomada', solicitante_id: U.r1, tomada_por: U.m1, tomada_en: hace(20), created_at: hace(50), updated_at: hace(20) },
    { ...base, id: 4, titulo: 'Corregir la ortografía del boletín', descripcion: 'Revisar tildes y puntuación antes de publicar.', rol_id: 2, prioridad: 'baja', alcance: 'todos', distrito: '08-01', estado: 'resuelta', solicitante_id: U.m1, tomada_por: U.r1, tomada_en: hace(70), resuelta_en: hace(10), created_at: hace(80), updated_at: hace(10) },
    { ...base, id: 5, titulo: 'Apoyo con la agenda del mes', descripcion: 'Ordenar las fechas del calendario del distrito.', rol_id: 3, prioridad: 'normal', fecha_limite: dia(9), alcance: 'distrito', distrito: '08-01', estado: 'abierta', solicitante_id: U.m1, created_at: hace(8), updated_at: hace(8) },
    { ...base, id: 6, titulo: 'Fotos de la visita al distrito 08-02', rol_id: 1, prioridad: 'normal', alcance: 'distrito', distrito: '08-02', estado: 'abierta', solicitante_id: U.r2, created_at: hace(3), updated_at: hace(3) },
  ];
  DB.ayuda_eventos = (DB.ayuda_pedidos || []).flatMap(p => [
    { pedido_id: p.id, tipo: 'creada', actor_id: p.solicitante_id, persona_id: null, de: null, a: 'abierta', nota: null, created_at: p.created_at },
    ...(p.tomada_por ? [{ pedido_id: p.id, tipo: 'tomada', actor_id: p.tomada_por, persona_id: p.tomada_por, de: 'abierta', a: 'tomada', nota: null, created_at: p.tomada_en }] : []),
    ...(p.estado === 'resuelta' ? [{ pedido_id: p.id, tipo: 'resuelta', actor_id: p.tomada_por, persona_id: p.tomada_por, de: 'tomada', a: 'resuelta', nota: 'Revisé todo el boletín', created_at: p.resuelta_en }] : []),
  ]).map((e, i) => ({ id: i + 1, ...e }));

  const nombre = id => (DB.profiles.find(p => p.id === id) || {}).nombre || null;
  const rolN = id => (DB.roles.find(r => r.id === id) || {}).nombre || '';
  const distDe = id => (DB.profiles.find(p => p.id === id) || {}).distrito || null;
  const misRoles = () => permitidos(meId);
  const afin = p => misRoles().includes(Number(p.rol_id)) && (p.alcance === 'todos' || p.distrito === distDe(meId));
  const ve = p => esAdmin() || p.solicitante_id === meId || p.tomada_por === meId || (p.estado === 'abierta' && afin(p)) || (esSec() && p.distrito && p.distrito === me().distrito);
  const puede = p => p.estado === 'abierta' && p.solicitante_id !== meId && afin(p);
  const ev = (p, tipo, persona, de, a, nota) => DB.ayuda_eventos.push({ id: DB.ayuda_eventos.length + 1, pedido_id: p.id, tipo, actor_id: meId, persona_id: persona || null, de, a, nota: String(nota || '').trim() || null, created_at: ahora() });
  const emitir = p => { try { F.emitir('ayuda_pedidos', 'UPDATE', { ...p }, { id: p.id }); } catch (e) { /* sin tiempo real */ } };
  const cargar = id => { const p = (DB.ayuda_pedidos || []).find(x => String(x.id) === String(id)); if (!p || !ve(p)) throw new Error('Esa solicitud de ayuda no existe o no puedes verla.'); return p; };
  const fila = p => ({ ...p, rol_nombre: rolN(p.rol_id), solicitante_nombre: nombre(p.solicitante_id), tomada_nombre: nombre(p.tomada_por), puedo_tomar: puede(p) });
  const tocar = (p, c) => { Object.assign(p, c, { updated_at: ahora() }); emitir(p); return true; };

  Object.assign(RPC, {
    ayuda_listar: () => { if (!DB.ayuda_pedidos) throw new Error('Could not find the function public.ayuda_listar'); return DB.ayuda_pedidos.filter(ve).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(fila); },
    ayuda_historial: a => { const p = (DB.ayuda_pedidos || []).find(x => String(x.id) === String(a.p_id)); if (!p || !ve(p)) return []; return DB.ayuda_eventos.filter(e => e.pedido_id === p.id).map(e => ({ ...e, actor_nombre: nombre(e.actor_id), persona_nombre: nombre(e.persona_id) })); },
    ayuda_crear: a => {
      const t = String(a.p_titulo || '').trim();
      if (t.length < 3 || t.length > 120) throw new Error('El título debe tener entre 3 y 120 caracteres.');
      if (!DB.roles.some(r => r.id === a.p_rol_id)) throw new Error('Elige un rol que exista.');
      if (a.p_enlace && !/^https?:\/\/[^\s]+$/i.test(a.p_enlace)) throw new Error('El enlace debe empezar por http:// o https://.');
      if (a.p_alcance === 'distrito' && !distDe(meId)) throw new Error('Tu cuenta no tiene distrito: pide la ayuda a todo el equipo.');
      if (DB.ayuda_pedidos.filter(p => p.solicitante_id === meId && ['abierta', 'tomada'].includes(p.estado)).length >= 10) throw new Error('Ya tienes 10 solicitudes en curso. Cierra o cancela alguna antes de pedir otra.');
      const p = { ...base, id: DB.ayuda_pedidos.length + 1, titulo: t, descripcion: String(a.p_descripcion || '').trim(), rol_id: a.p_rol_id, prioridad: a.p_prioridad || 'normal', fecha_limite: a.p_fecha_limite || null, enlace: a.p_enlace || null,
        alcance: a.p_alcance || 'todos', distrito: distDe(meId), estado: 'abierta', solicitante_id: meId, created_at: ahora(), updated_at: ahora() };
      DB.ayuda_pedidos.push(p); ev(p, 'creada', null, null, 'abierta', null); emitir(p); return p.id;
    },
    ayuda_tomar: a => {
      const p = (DB.ayuda_pedidos || []).find(x => String(x.id) === String(a.p_id));
      if (!p) throw new Error('Esa solicitud de ayuda no existe o no puedes verla.');
      if (puede(p)) { ev(p, 'tomada', meId, 'abierta', 'tomada', null); return tocar(p, { estado: 'tomada', tomada_por: meId, tomada_en: ahora() }); }
      if (!ve(p) && !afin(p)) throw new Error('Esa solicitud de ayuda no existe o no puedes verla.');
      if (p.estado === 'tomada') throw new Error('Ya la tomó alguien más.');
      if (p.estado !== 'abierta') throw new Error('Esta solicitud ya no está abierta.');
      if (p.solicitante_id === meId) throw new Error('No puedes tomar tu propia solicitud.');
      throw new Error('Esta solicitud es para otro rol.');
    },
    ayuda_soltar: a => { const p = cargar(a.p_id); if (p.estado !== 'tomada') throw new Error('Solo se puede soltar una solicitud que está tomada.'); if (!(p.tomada_por === meId || esAdmin())) throw new Error('Solo quien la tomó (o la administración) puede soltarla.'); ev(p, 'soltada', p.tomada_por, 'tomada', 'abierta', a.p_nota); return tocar(p, { estado: 'abierta', tomada_por: null, tomada_en: null }); },
    ayuda_resolver: a => { const p = cargar(a.p_id); if (p.estado !== 'tomada') throw new Error('Solo se puede resolver una solicitud que está tomada.'); if (!(p.tomada_por === meId || esAdmin())) throw new Error('Solo quien la tomó (o la administración) puede marcarla resuelta.'); ev(p, 'resuelta', p.tomada_por, 'tomada', 'resuelta', a.p_nota); return tocar(p, { estado: 'resuelta', resuelta_en: ahora(), confirmada_en: null }); },
    ayuda_confirmar: a => { const p = cargar(a.p_id); if (p.estado !== 'resuelta') throw new Error('Solo se confirma una solicitud que ya está resuelta.'); if (!(p.solicitante_id === meId || esAdmin())) throw new Error('Solo quien pidió la ayuda (o la administración) la confirma.'); ev(p, 'confirmada', p.tomada_por, 'resuelta', 'resuelta', null); return tocar(p, { confirmada_en: ahora() }); },
    ayuda_reabrir: a => { const p = cargar(a.p_id); if (p.estado !== 'resuelta') throw new Error('Solo se reabre una solicitud que está resuelta.'); if (!(p.solicitante_id === meId || esAdmin())) throw new Error('Solo quien pidió la ayuda (o la administración) puede reabrirla.'); if (String(a.p_nota || '').trim().length < 3) throw new Error('Cuenta en una frase qué falta: así quien te ayuda sabe qué retomar.'); ev(p, 'reabierta', p.tomada_por, 'resuelta', 'tomada', a.p_nota); return tocar(p, { estado: p.tomada_por ? 'tomada' : 'abierta', resuelta_en: null, confirmada_en: null }); },
    ayuda_cancelar: a => { const p = cargar(a.p_id); if (!['abierta', 'tomada'].includes(p.estado)) throw new Error('Solo se cancela una solicitud abierta o tomada.'); if (!(p.solicitante_id === meId || esAdmin())) throw new Error('Solo quien pidió la ayuda (o la administración) puede cancelarla.'); ev(p, 'cancelada', p.tomada_por, p.estado, 'cancelada', a.p_nota); return tocar(p, { estado: 'cancelada', cancelada_en: ahora() }); },
    ayuda_candidatas: a => { if (!esAdmin()) throw new Error('Solo la administración consulta esto.'); const p = cargar(a.p_id); return DB.profiles.filter(x => permitidos(x.id).includes(Number(p.rol_id)) && x.id !== p.solicitante_id && x.aprobado !== false).map(x => ({ id: x.id, nombre: x.nombre })); },
    ayuda_reasignar: a => { if (!esAdmin()) throw new Error('Solo la administración reasigna solicitudes.'); const p = cargar(a.p_id); if (!['abierta', 'tomada'].includes(p.estado)) throw new Error('Solo se reasigna una solicitud abierta o tomada.'); if (!permitidos(a.p_persona).includes(Number(p.rol_id))) throw new Error('Esa persona no tiene el rol que se pidió.'); ev(p, 'reasignada', a.p_persona, p.estado, 'tomada', a.p_nota); return tocar(p, { estado: 'tomada', tomada_por: a.p_persona, tomada_en: ahora() }); },
  });
})();
