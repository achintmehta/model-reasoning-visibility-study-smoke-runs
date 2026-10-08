import { PGlite } from '@electric-sql/pglite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '..', 'pglite-data');

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true });

let db = null;

export async function getDb() {
  if (db) return db;

  db = await PGlite.create({
    dataDir: DATA_DIR,
    relaxedDurability: true,
  });

  await initializeSchema();
  return db;
}

async function initializeSchema() {
  // Create tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      position REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cards_column_position ON cards(column_id, position);
  `);

  // Seed default columns if none exist
  const count = await db.query('SELECT COUNT(*) as count FROM columns');
  if (count.rows[0].count === 0) {
    const columns = [
      { id: generateId(), title: 'To Do', position: 0 },
      { id: generateId(), title: 'In Progress', position: 100 },
      { id: generateId(), title: 'Done', position: 200 },
    ];

    const now = new Date().toISOString();

    for (const col of columns) {
      await db.query(
        'INSERT INTO columns (id, title, position) VALUES ($1, $2, $3)',
        [col.id, col.title, col.position]
      );
    }

    // Insert a sample card in To Do to demonstrate the board
    const sampleCol = columns[0];
    await db.query(
      'INSERT INTO cards (id, column_id, text, position, created_at) VALUES ($1, $2, $3, $4, $5)',
      [generateId(), sampleCol.id, 'Sample card - drag me around!', 50, now]
    );
  }
}

function generateId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export { generateId };
