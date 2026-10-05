import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

const dbDir = path.join(process.cwd(), 'data');

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir);
}

const db = new PGlite(dbDir);

export default db;
