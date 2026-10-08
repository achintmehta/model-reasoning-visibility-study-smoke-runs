const { PGlite } = require('@electric-sql/pglite');
const path = require('path');
(async () => {
  const db = new PGlite(path.join(__dirname, 'backend', 'data'));
  const {rows}=await db.query('INSERT INTO cards (column_id,text,position) VALUES (1,$1,$2) RETURNING id,position', ['direct',1000]);
  console.log(rows);
})();
