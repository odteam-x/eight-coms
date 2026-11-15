// Mundo simulado para probar la sincronización en tiempo real con VARIAS SESIONES a la vez (sin red ni Supabase).
//
//   const mundo = new Mundo({ visible })      un solo «servidor»: tablas en memoria + bus de eventos postgres_changes
//   const a = mundo.sesion(usuario, { portal }) un cliente = una pestaña/dispositivo: SB falso, Auth falso, navigator, window, document, location
//   a.cargar('core/sync.js')                  carga el código REAL del repositorio en el contexto de esa sesión (vm), con globales como en el navegador
//
// Lo que imita de Supabase Realtime (y por qué importa):
//   · cada INSERT/UPDATE/DELETE publica un evento SOLO a los clientes cuya RLS deja ver la fila NUEVA (visible(tabla, fila, usuario));
//   · un DELETE no pasa por RLS y solo lleva la clave primaria (como el servicio real);
//   · un cliente sin red (a.cortar()) no recibe nada y sus canales pasan a CLOSED; los cambios que ocurren mientras tanto SE PIERDEN para él
//     (es justo lo que Sync debe compensar al volver con una resincronización);
//   · channel().on('postgres_changes', {table, filter:'col=eq.valor'}).subscribe(cb) → cb('SUBSCRIBED') de forma asíncrona.
// No imita: latencia real, orden entre tablas, límites del servicio. Eso solo se prueba contra el proyecto vivo.
import vm from 'node:vm';
import fs from 'node:fs';

export const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
export const espera = ms => new Promise(r => setTimeout(r, ms));
export async function hasta(cond, ms = 1500, paso = 10) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await espera(paso); } return !!(await cond()); }

export class Mundo {
  constructor({ visible } = {}) {
    this.tablas = new Map();       // nombre → fila[]
    this.visible = visible || (() => true);
    this.sesiones = new Set();
    this.log = [];                 // eventos publicados (para contar)
    this.idSig = 100;
  }
  tabla(n) { if (!this.tablas.has(n)) this.tablas.set(n, []); return this.tablas.get(n); }
  sembrar(n, filas) { this.tabla(n).push(...filas.map(f => ({ ...f }))); return this; }
  usuario(id) { return this.tabla('profiles').find(p => String(p.id) === String(id)) || null; }
  filas(n, usuario) { return this.tabla(n).filter(f => this.visible(n, f, usuario, this)).map(f => ({ ...f })); }

  // Escritura «como la base»: cambia la fila y publica el evento.
  insertar(n, fila) { const f = { id: this.idSig++, updated_at: new Date().toISOString(), ...fila }; this.tabla(n).push(f); this._pub(n, 'INSERT', f, null); return { ...f }; }
  actualizar(n, id, parche) {
    const t = this.tabla(n); const i = t.findIndex(f => String(f.id) === String(id)); if (i < 0) return null;
    const viejo = { ...t[i] }; t[i] = { ...t[i], ...parche, updated_at: new Date(Date.now() + this.idSig++).toISOString() };
    this._pub(n, 'UPDATE', { ...t[i] }, viejo); return { ...t[i] };
  }
  borrar(n, id) { const t = this.tabla(n); const i = t.findIndex(f => String(f.id) === String(id)); if (i < 0) return; const [v] = t.splice(i, 1); this._pub(n, 'DELETE', null, v); }

  _pub(tabla, eventType, nuevo, viejo) {
    this.log.push({ tabla, eventType });
    for (const s of this.sesiones) s._entregar(tabla, eventType, nuevo, viejo);
  }

  sesion(usuarioId, o = {}) { const s = new Sesion(this, usuarioId, o); this.sesiones.add(s); return s; }
}

class Canal {
  constructor(s, nombre) { this.s = s; this.nombre = nombre; this.enlaces = []; this.cb = null; this.activo = false; }
  on(tipo, filtro, cb) { this.enlaces.push({ tipo, filtro, cb }); return this; }
  subscribe(cb) {
    this.cb = cb; this.s.canales.add(this); this.activo = true;
    Promise.resolve().then(() => { if (!this.activo) return; if (this.s.sinRed || this.s.canalesRotos) { this.s.intentosSub++; this.cb && this.cb('CHANNEL_ERROR', new Error('sin conexión')); } else this.cb && this.cb('SUBSCRIBED'); });
    return this;
  }
}

export class Sesion {
  constructor(mundo, usuarioId, { portal = 'admin.html' } = {}) {
    this.m = mundo; this.uid = usuarioId; this.canales = new Set(); this.sinRed = false; this.canalesRotos = false; this.intentosSub = 0;
    this.escuchaVentana = {}; this.escuchaDoc = {}; this.redirigido = null; this.cerrada = false; this.toasts = []; this.recargas = 0;
    const s = this;
    this.nodos = {}; this.modales = [];
    const el = () => { const o = { dataset: {}, hidden: false, id: '', className: '', _txt: { textContent: '' }, setAttribute() {}, querySelector() { return o._txt; }, set innerHTML(v) {}, get innerHTML() { return ''; } }; return o; };
    this.document = {
      hidden: false, activeElement: null, body: { appendChild: n => { s.nodos[n.id] = n; } },
      getElementById: id => s.nodos[id] || null, createElement: el,
      querySelectorAll: sel => (/aria-modal/.test(sel) ? s.modales : []),
      addEventListener: (e, f) => { (s.escuchaDoc[e] ||= []).push(f); },
    };
    this.window = {
      addEventListener: (e, f) => { (s.escuchaVentana[e] ||= []).push(f); }, scrollY: 0, scrollTo() {},
    };
    this.navigator = { get onLine() { return !s.sinRed; } };
    this.location = { pathname: '/' + portal, replace: u => { s.redirigido = u; }, reload: () => { s.recargas++; } };
    this.SB = {
      channel: n => new Canal(s, n),
      removeChannel: c => { c.activo = false; s.canales.delete(c); },
      realtime: { connect: () => { s.conectado = true; } },
      auth: { onAuthStateChange: f => { s.authCb = f; }, signOut: async () => { s.cerrada = true; } },
      from: t => ({ select: async () => ({ data: s.m.filas(t, s.uid), error: null }) }),
    };
    this.Auth = { getProfile: async () => { const p = s.m.usuario(s.uid); return p ? { ...p } : null; } };
    this.ctx = vm.createContext({
      console, setTimeout, clearTimeout, Promise, Date, Math, JSON, Object, Array, Set, Map, Error, String, Number,
      SB: this.SB, Auth: this.Auth, navigator: this.navigator, window: this.window, document: this.document, location: this.location,
      showToast: (m, t) => { s.toasts.push(m); },
      requestAnimationFrame: f => f(),
    });
  }
  cargar(archivo, tras = '') { vm.runInContext(fs.readFileSync(ROOT + archivo, 'utf8') + '\n' + tras, this.ctx, { filename: archivo }); return this; }
  evalua(c) { return vm.runInContext(c, this.ctx); }
  get Sync() { return this.evalua('Sync'); }

  _entregar(tabla, tipo, nuevo, viejo) {
    if (this.sinRed || this.silencio) return;                 // lo que ocurre sin red (o con el socket dormido) NO llega
    for (const c of this.canales) {
      if (!c.activo) continue;
      for (const e of c.enlaces) {
        if (e.filtro.table !== tabla) continue;
        let payload;
        if (tipo === 'DELETE') payload = { eventType: tipo, new: {}, old: { id: viejo.id } };          // solo la clave primaria
        else {
          if (!this.m.visible(tabla, nuevo, this.uid, this.m)) continue;                                  // RLS sobre la fila NUEVA
          payload = { eventType: tipo, new: { ...nuevo }, old: viejo ? { id: viejo.id } : {} };
        }
        if (e.filtro.filter) { const mm = /^(\w+)=eq\.(.+)$/.exec(e.filtro.filter); const f = payload.new && Object.keys(payload.new).length ? payload.new : payload.old; if (mm && String(f[mm[1]]) !== mm[2]) continue; }
        Promise.resolve().then(() => e.cb(payload));
      }
    }
  }
  /** Se cae internet: los canales pasan a CLOSED y deja de llegar todo. */
  cortar() { this.sinRed = true; for (const c of [...this.canales]) c.cb && c.cb('CLOSED'); for (const f of this.escuchaVentana.offline || []) f(); }
  /** Vuelve internet: el navegador lo avisa; Sync decide qué hacer. */
  restaurar() { this.sinRed = false; for (const f of this.escuchaVentana.online || []) f(); }
  /** El servicio falla pero hay red (CHANNEL_ERROR): para probar el reintento con espera creciente. */
  romperCanales() { this.canalesRotos = true; for (const c of [...this.canales]) c.cb && c.cb('CHANNEL_ERROR', new Error('fallo del servicio')); }
  repararCanales() { this.canalesRotos = false; }
  /** iOS/Android duermen el socket de una pestaña en segundo plano SIN avisar: no llega nada y nadie se entera. */
  suspender() { this.silencio = true; }
  reanudar() { this.silencio = false; }
  ocultar() { this.document.hidden = true; for (const f of this.escuchaDoc.visibilitychange || []) f(); }
  mostrar() { this.document.hidden = false; for (const f of this.escuchaDoc.visibilitychange || []) f(); }
  abrirModal() { const d = { style: { display: 'flex' } }; this.modales.push(d); return () => { d.style.display = 'none'; }; }
}
