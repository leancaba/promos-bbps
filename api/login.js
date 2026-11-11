const { checkPin, handler } = require('./_lib/store');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = handler(async (body) => {
  try {
    checkPin(body.pin);
  } catch (e) {
    await wait(700); // frena intentos repetidos
    throw e;
  }
  return { ok: true };
}, ['POST']);
