// Almacenamiento de datos e imágenes.
// En producción (Vercel) todo se guarda como archivos dentro del repositorio de GitHub:
//   data/locales.json  ·  uploads/logos/*.webp  ·  uploads/promos/*.webp
// Cada guardado es un commit; Vercel vuelve a publicar la web automáticamente.
// En la computadora (node dev-server.js, sin GITHUB_TOKEN) se escribe directo en la carpeta del proyecto.

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const DATA_PATH = 'data/locales.json';
const UPLOAD_RE = /^uploads\/(logos|promos)\/[a-z0-9][a-z0-9-]{0,80}\.(webp|png|jpe?g|gif)$/;
// Sitios desde donde se pueden importar logos (los que usa bahiablancaplazashopping.com)
const LOGO_HOSTS = ['i.imgur.com', 'ik.imagekit.io', 'bahiablancaplazashopping.com', 'cdn.bigmedia.es'];
const MAX_FILE_BYTES = 3 * 1024 * 1024;

const env = (k, d = '') => (process.env[k] || d).trim();
const useGitHub = () => !!env('GITHUB_TOKEN');

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

/* ------------------------- autenticación ------------------------- */
function checkPin(pin) {
  const expected = env('ADMIN_PIN');
  if (!expected) throw new HttpError(500, 'Falta configurar ADMIN_PIN en Vercel.');
  const a = crypto.createHash('sha256').update(String(pin || '')).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'PIN incorrecto');
}

/* ------------------------- validación ------------------------- */
function cleanStr(v, max) { return String(v ?? '').replace(/\s+$/g, '').replace(/^\s+/g, '').slice(0, max); }

function okLogoUrl(u) {
  try {
    const url = new URL(String(u || ''));
    return url.protocol === 'https:' && LOGO_HOSTS.includes(url.hostname) ? url.href : '';
  } catch { return ''; }
}

function sanitize(data) {
  if (!data || typeof data !== 'object') throw new HttpError(400, 'Datos inválidos');
  const okPath = (p) => (p && UPLOAD_RE.test(p) ? p : '');
  const banner = data.banner || {};
  const seen = new Set();
  const locales = (Array.isArray(data.locales) ? data.locales : []).map((l) => {
    const id = cleanStr(l.id, 90).toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!id || seen.has(id)) throw new HttpError(400, 'Hay locales con identificador repetido o vacío');
    seen.add(id);
    const nombre = cleanStr(l.nombre, 80);
    if (!nombre) throw new HttpError(400, 'Todos los locales necesitan un nombre');
    return {
      id,
      nombre,
      rubro: String(l.rubro || '').split(',').map((r) => cleanStr(r, 40)).filter(Boolean).slice(0, 5).join(', '),
      logo: l.logo && l.logo.startsWith('uploads/') ? okPath(l.logo) : '',
      logoUrl: l.logo ? '' : okLogoUrl(l.logoUrl),
      promos: (Array.isArray(l.promos) ? l.promos : [])
        .map((p) => ({ titulo: cleanStr(p.titulo, 120), descripcion: cleanStr(p.descripcion, 600) }))
        .filter((p) => p.titulo || p.descripcion)
        .slice(0, 30),
    };
  });
  return {
    updatedAt: new Date().toISOString(),
    banner: { desktop: okPath(banner.desktop), mobile: okPath(banner.mobile) },
    locales,
  };
}

function checkFiles(uploads, deletes) {
  for (const u of uploads) {
    if (!UPLOAD_RE.test(u.path || '')) throw new HttpError(400, 'Nombre de archivo no permitido: ' + u.path);
    if (typeof u.content !== 'string' || !u.content) throw new HttpError(400, 'Imagen vacía');
    if (Buffer.byteLength(u.content, 'base64') > MAX_FILE_BYTES) throw new HttpError(413, 'La imagen supera los 3 MB');
  }
  for (const d of deletes) if (!UPLOAD_RE.test(d || '')) throw new HttpError(400, 'No se puede borrar ' + d);
}

/* ------------------------- GitHub ------------------------- */
async function gh(method, url, body) {
  const repo = env('GITHUB_REPO');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new HttpError(500, 'Falta configurar GITHUB_REPO (usuario/repositorio) en Vercel.');
  const res = await fetch(`https://api.github.com/repos/${repo}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${env('GITHUB_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'directorio-bbps',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { message: text }; }
  if (!res.ok) {
    const hint = res.status === 401 ? ' (revisá GITHUB_TOKEN)' : res.status === 404 ? ' (revisá GITHUB_REPO y los permisos del token)' : '';
    throw new HttpError(502, `GitHub respondió ${res.status}: ${json.message || ''}${hint}`);
  }
  return json;
}
const branch = () => env('GITHUB_BRANCH', 'main');

async function ghRead() {
  const f = await gh('GET', `/contents/${DATA_PATH}?ref=${encodeURIComponent(branch())}`);
  return JSON.parse(Buffer.from(f.content, 'base64').toString('utf8'));
}

async function ghCommit({ data, uploads, deletes, message }) {
  const ref = await gh('GET', `/git/ref/heads/${encodeURIComponent(branch())}`);
  const parent = ref.object.sha;
  const commit = await gh('GET', `/git/commits/${parent}`);

  const tree = [];
  for (const u of uploads) {
    const blob = await gh('POST', '/git/blobs', { content: u.content, encoding: 'base64' });
    tree.push({ path: u.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const dataBlob = await gh('POST', '/git/blobs', { content: JSON.stringify(data, null, 2) + '\n', encoding: 'utf-8' });
  tree.push({ path: DATA_PATH, mode: '100644', type: 'blob', sha: dataBlob.sha });

  // sólo borra archivos que existen (si no, GitHub rechaza el árbol)
  if (deletes.length) {
    const full = await gh('GET', `/git/trees/${commit.tree.sha}?recursive=1`);
    const existing = new Set((full.tree || []).map((t) => t.path));
    const uploaded = new Set(uploads.map((u) => u.path));
    deletes.filter((d) => existing.has(d) && !uploaded.has(d))
      .forEach((d) => tree.push({ path: d, mode: '100644', type: 'blob', sha: null }));
  }

  const newTree = await gh('POST', '/git/trees', { base_tree: commit.tree.sha, tree });
  const newCommit = await gh('POST', '/git/commits', { message, tree: newTree.sha, parents: [parent] });
  await gh('PATCH', `/git/refs/heads/${encodeURIComponent(branch())}`, { sha: newCommit.sha });
}

/* ------------------------- disco local ------------------------- */
const ROOT = path.join(__dirname, '..', '..');

async function fsRead() {
  return JSON.parse(await fs.readFile(path.join(ROOT, DATA_PATH), 'utf8'));
}
async function fsCommit({ data, uploads, deletes }) {
  for (const u of uploads) {
    const p = path.join(ROOT, u.path);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, Buffer.from(u.content, 'base64'));
  }
  const uploaded = new Set(uploads.map((u) => u.path));
  for (const d of deletes) if (!uploaded.has(d)) await fs.rm(path.join(ROOT, d), { force: true });
  await fs.writeFile(path.join(ROOT, DATA_PATH), JSON.stringify(data, null, 2) + '\n');
}

/* ------------------------- interfaz ------------------------- */
async function readData() {
  if (useGitHub()) return ghRead();
  if (process.env.VERCEL) throw new HttpError(500, 'Falta configurar GITHUB_TOKEN en Vercel.');
  return fsRead();
}

async function save({ baseUpdatedAt, data, uploads = [], deletes = [], message }) {
  if (!useGitHub() && process.env.VERCEL) throw new HttpError(500, 'Falta configurar GITHUB_TOKEN en Vercel.');
  if (!Array.isArray(uploads) || !Array.isArray(deletes)) throw new HttpError(400, 'Datos inválidos');
  checkFiles(uploads, deletes);

  const current = await readData();
  if (baseUpdatedAt && current.updatedAt && baseUpdatedAt !== current.updatedAt) {
    throw new HttpError(409, 'Los datos cambiaron desde otro dispositivo. Se recargó la información: revisá y guardá de nuevo.', { data: current });
  }
  const clean = sanitize(data);
  await write(clean, uploads, deletes, message);
  return clean;
}

async function write(clean, uploads, deletes, message) {
  const msg = cleanStr(message || 'Actualización desde el panel', 120);
  if (useGitHub()) await ghCommit({ data: clean, uploads, deletes, message: msg });
  else await fsCommit({ data: clean, uploads, deletes });
}

/* ---------- importar logos externos al repositorio ---------- */
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const slugify = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'local';

async function download(href) {
  const url = new URL(href);
  if (url.hostname === 'ik.imagekit.io') url.searchParams.set('tr', 'w-600'); // ImageKit lo achica a 600 px
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'directorio-bbps' } });
  if (!res.ok) throw new Error(`respuesta ${res.status}`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!EXT[type]) throw new Error(`formato no soportado (${type || 'desconocido'})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FILE_BYTES) throw new Error('imagen de más de 3 MB');
  if (buf.length < 50) throw new Error('imagen vacía');
  return { content: buf.toString('base64'), ext: EXT[type] };
}

async function importLogos(ids) {
  if (!useGitHub() && process.env.VERCEL) throw new HttpError(500, 'Falta configurar GITHUB_TOKEN en Vercel.');
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'No se indicaron locales');
  const want = new Set(ids.slice(0, 20));
  const current = await readData();
  const data = sanitize(current);
  const targets = data.locales.filter((l) => want.has(l.id) && l.logoUrl && !l.logo);
  const uploads = [], ok = [], failed = [];
  const stamp = Date.now().toString(36);
  await Promise.all(targets.map(async (l) => {
    try {
      const img = await download(l.logoUrl);
      const path = `uploads/logos/${slugify(l.id)}-${stamp}.${img.ext}`;
      uploads.push({ path, content: img.content });
      l.logo = path;
      l.logoUrl = '';
      ok.push(l.nombre);
    } catch (e) {
      failed.push({ nombre: l.nombre, error: e.message || 'error' });
    }
  }));
  if (uploads.length) await write(data, uploads, [], `Logos importados (${uploads.length})`);
  return { data: uploads.length ? data : current, ok, failed };
}

/* ------------------------- helpers HTTP ------------------------- */
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function handler(fn, methods) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) return send(res, 405, { error: 'Método no permitido' });
      const body = req.method === 'GET' ? {} : await readBody(req);
      const out = await fn(body, req);
      send(res, 200, out);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      send(res, status, { error: e.message || 'Error inesperado', ...(e.extra || {}) });
    }
  };
}

module.exports = { checkPin, readData, save, importLogos, handler, HttpError };
