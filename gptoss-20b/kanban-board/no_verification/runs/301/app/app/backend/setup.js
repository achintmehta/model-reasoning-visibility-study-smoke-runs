const db = require('./db');

async function init() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      position REAL NOT NULL
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      position REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Seed default columns if empty
  const { rows } = await db.query('SELECT COUNT(*) as cnt FROM columns;');
  if (rows[0].cnt === 0) {
    const defaultColumns = ['To Do', 'In Progress', 'Done'];
    for (let i = 0; i < defaultColumns.length; i++) {
      const pos = i + 1; // integer positions
      await db.query(`INSERT INTO columns (title, position) VALUES (?, ?);`, [defaultColumns[i], pos]);
    }
    console.log('Initialized default columns');
  } else {
    console.log('Columns already exist');
  }
}

init().catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
