// Descarga los logos que todavía apuntan a otro sitio y los guarda dentro del repositorio.
const { checkPin, importLogos, handler } = require('./_lib/store');

module.exports = handler(async (body, req) => {
  checkPin(req.headers['x-admin-pin']);
  return importLogos(body.ids);
}, ['POST']);
