import { PGlite } from '@electric-sql/pglite';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const db = await PGlite.create(path.join(__dirname, 'data/kanban.db'));
const res = await db.query('SELECT id, column_id, text, position, created_at FROM cards WHERE id = $1', [1]);
console.log(res.rows);
await db.close();
