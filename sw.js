/* EIGHT CREATORS LABs — service worker mínimo.
 *
 * Existe para que Android ofrezca «Instalar app» y para que, sin conexión, la persona vea una pantalla
 * clara en vez del dinosaurio del navegador. NO guarda datos ni código del sitio: el portal no tiene build
 * y sirve datos de Supabase con permisos por persona, así que cachear scripts o respuestas mostraría
 * versiones viejas o datos de otra sesión. Solo se guarda offline.html y el icono.
 * Sube VERSION si cambias este archivo o offline.html. */
const VERSION = 'ec-v2';
const OFFLINE = '/offline.html';
const PRECACHE = [OFFLINE, '/favicon-64.png', '/icono-redondo-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  // Solo las navegaciones (abrir una página). Todo lo demás —scripts, estilos, Supabase— va directo a la red.
  if (r.method !== 'GET' || r.mode !== 'navigate') return;
  e.respondWith(fetch(r).catch(() => caches.match(OFFLINE)));
});
