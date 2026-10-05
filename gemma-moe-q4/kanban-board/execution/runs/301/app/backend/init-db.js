import db from './db.js';

export async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position DOUBLE PRECISION NOT NULL
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT REFERENCES columns(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      position DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default columns if they don't exist
  const { rows: columns } = await db.query('SELECT id FROM columns');
  if (columns.length === 0) {
    await db.query(`
      INSERT INTO columns (id, title, position) VALUES
      ('col-1', 'To Do', 1.0),
      ('col-2', 'In Progress', 2.0),
      ('col-3', 'Done', 3.0);
    `);
    console.log('Seeded default columns');
  }
}
