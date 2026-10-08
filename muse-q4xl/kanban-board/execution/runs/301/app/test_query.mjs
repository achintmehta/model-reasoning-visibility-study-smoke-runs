import { PGlite } from '@electric-sql/pglite';
import path from 'path';
const db = await PGlite.create('./data/kanban.db');
const res = await db.query('SELECT COALESCE(MAX(position), -1) as maxPos FROM cards WHERE column_id = $1', [1]);
console.log(res);
