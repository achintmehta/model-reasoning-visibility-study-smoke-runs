import { PGlite } from '@electric-sql/pglite';
const db = await PGlite.create('./data/kanban.db');
await db.exec('BEGIN');
console.log('begin ok');
await db.exec('COMMIT');
console.log('commit ok');
