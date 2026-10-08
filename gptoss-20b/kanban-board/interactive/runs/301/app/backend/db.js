const { PGLite } = require('@electric-sql/pglite');
const path = require('path');

// Use relative path to store the db file in backend/data
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'pglite.db');
const db = new PGLite({ path: dbPath });

async function init() {
  // Create tables if they don't exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      text TEXT,
      position INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  // Seed default columns if table empty
  const res = await db.get(`SELECT COUNT(*) as count FROM columns`);
  if (res.count === 0) {
    await db.exec(`
      INSERT INTO columns (id, title, position) VALUES
        ("1", "To Do", 1),
        ("2", "In Progress", 2),
        ("3", "Done", 3);
    `);
  }
}

exports.db = db;
exports.init = init;
