const { PGLite } = require('@electric-sql/pglite');
const db = new PGLite({ name: 'realtime-board.db' });
module.exports = { db };
