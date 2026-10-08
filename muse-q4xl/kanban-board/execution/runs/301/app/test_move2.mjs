import { PGlite } from '@electric-sql/pglite';
const db = await PGlite.create('./data/kanban.db');
await db.exec('BEGIN');
await db.query('UPDATE cards SET column_id = $1, position = $2 WHERE id = $3', [2,0,2]);
await db.exec('COMMIT');
console.log('done');
