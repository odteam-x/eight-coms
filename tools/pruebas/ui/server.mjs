import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
const AQUI = fileURLToPath(new URL('.', import.meta.url));
// Sirve el repo REAL (dos niveles arriba) con los mismos headers de vercel.json,
// CSP enforcing incluida. Lo único que cambia es supabase-client.js.
const ROOT = path.resolve(process.argv[2] || path.join(AQUI, '../../..'));
const PORT = Number(process.argv[3] || 3100);
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const headers = Object.fromEntries(vercel.headers[0].headers.map(h => [h.key, h.value]));
let FAKE = fs.readFileSync(process.argv[4] || path.join(AQUI, 'fake-supabase-client.js'), 'utf8');
// Extensiones del simulador (ui/fake-extra-*.js): cada una añade RPC sin tocar el archivo principal.
for (const f of fs.readdirSync(AQUI).filter(n => /^fake-extra-.*\.js$/.test(n)).sort()) FAKE += '\n' + fs.readFileSync(path.join(AQUI, f), 'utf8');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  if (p === '/supabase-client.js') { res.setHeader('Content-Type', MIME['.js']); return res.end(FAKE); }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('404'); }
  res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
  res.end(fs.readFileSync(f));
}).listen(PORT, () => console.log('listo en http://localhost:' + PORT));
