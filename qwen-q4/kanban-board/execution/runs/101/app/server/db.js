import { PGlite } from '@electric-sql/pglite';
import { NodeFS } from '@electric-sql/pglite/nodefs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'pglite-data');

let db = null;

export async function initializeDatabase() {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const nodefs = new NodeFS(DATA_DIR);

  db = new PGlite({
    fs: nodefs
  });

  // Create tables
  await db.query(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position REAL NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT NOT NULL REFERENCES columns(id),
      text TEXT NOT NULL,
      position REAL NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Seed default columns if empty
  const { rows: existingColumns } = await db.query('SELECT id FROM columns');
  if (existingColumns.length === 0) {
    const defaultColumns = [
      { id: 'col-todo', title: 'To Do', position: 1 },
      { id: 'col-progress', title: 'In Progress', position: 2 },
      { id: 'col-done', title: 'Done', position: 3 }
    ];

    for (const col of defaultColumns) {
      await db.query(
        'INSERT INTO columns (id, title, position) VALUES ($1, $2, $3)',
        [col.id, col.title, col.position]
      );
    }
  }

  console.log('Database initialized successfully');
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}
