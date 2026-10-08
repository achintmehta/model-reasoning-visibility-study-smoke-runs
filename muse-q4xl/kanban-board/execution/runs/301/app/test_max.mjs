import { PGlite } from '@electric-sql/pglite';
const db = await PGlite.create('./data/kanban.db');
const res = await db.query('SELECT COALESCE(MAX(position), -1) as maxpos FROM cards WHERE column_id = $1', [2]);
console.log(res.rows[0]);
