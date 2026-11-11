// Devuelve los datos más recientes directo del repositorio (sin esperar la nueva publicación).
const { readData, handler } = require('./_lib/store');

module.exports = handler(async () => ({ data: await readData() }), ['GET']);
