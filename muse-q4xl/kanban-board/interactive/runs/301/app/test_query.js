const { PGlite } = require('@electric-sql/pglite');
const path = require('path');
(async () => {
  const db = new PGlite(path.join(__dirname, 'backend', 'data'));
  const { rows } = await db.query('SELECT COALESCE(MAX(position), 0) as maxpos FROM cards WHERE column_id = $1', [1]);
  console.log(rows);
  console.log(Object.keys(rows[0]));
})();
