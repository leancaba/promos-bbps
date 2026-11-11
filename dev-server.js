// Servidor para probar la web en tu computadora:  node dev-server.js
// Guarda los cambios del panel directamente en esta carpeta (no usa GitHub).
// PIN de prueba: el de la variable ADMIN_PIN, o 1234 si no la definís.

const http = require('http');
const fs = require('fs');
const path = require('path');

process.env.ADMIN_PIN = process.env.ADMIN_PIN || '1234';
delete process.env.GITHUB_TOKEN; // en local siempre guarda en disco
delete process.env.VERCEL;
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const api = {
  '/api/login': require('./api/login'),
  '/api/data': require('./api/data'),
  '/api/save': require('./api/save'),
  '/api/import-logos': require('./api/import-logos'),
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (api[url.pathname]) return api[url.pathname](req, res);
  if (url.pathname.startsWith('/api/')) { res.statusCode = 404; return res.end('{}'); }

  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (!path.extname(p)) p += '.html'; // cleanUrls: /admin -> admin.html
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT) || /[\\/](api|node_modules)[\\/]|dev-server/.test(file)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('No encontrado'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  });
}).listen(PORT, () => console.log(`Directorio BBPS en http://localhost:${PORT}  (PIN: ${process.env.ADMIN_PIN})`));
