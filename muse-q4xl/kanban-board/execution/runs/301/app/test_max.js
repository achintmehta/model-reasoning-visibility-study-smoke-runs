import { PGlite } from '@electric-sql/pglite';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const db = await PGlite.create(path.join(__dirname, 'data/kanban.db'));
const res = await db.query('SELECT COALESCE(MAX(position), -1) as maxPos FROM cards WHERE column_id = $1', [1]);
console.log(res.rows);
await db.close();
