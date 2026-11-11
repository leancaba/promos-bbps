const { checkPin, save, handler } = require('./_lib/store');

module.exports = handler(async (body, req) => {
  checkPin(req.headers['x-admin-pin']);
  const data = await save(body);
  return { ok: true, data };
}, ['POST']);
