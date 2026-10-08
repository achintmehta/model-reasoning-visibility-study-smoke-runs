const express = require('express');
const cors = require('cors');
const { Database } = require('@electric-sql/pglite');
const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

const db = new Database({
  location: 'kanban.db',
  // By default, PGLite works in memory. We persist to file here.
});

// Initialize schema
const init = async () => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position NUMERIC NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT NOT NULL,
      text TEXT NOT NULL,
      position NUMERIC NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (column_id) REFERENCES columns(id)
    );
  `);
  // Seed columns if empty
  const { rows } = await db.exec('SELECT COUNT(*) AS cnt FROM columns;');
  if (rows[0].cnt === 0) {
    const columns = [
      { id: 'col-1', title: 'To Do', position: 1 },
      { id: 'col-2', title: 'In Progress', position: 2 },
      { id: 'col-3', title: 'Done', position: 3 }
    ];
    for (const c of columns) {
      await db.exec(`INSERT INTO columns (id, title, position) VALUES ($1, $2, $3)`, [c.id, c.title, c.position]);
    }
  }
};

init();

app.get('/api/board', async (req, res) => {
  const columnsRes = await db.exec('SELECT id, title, position FROM columns ORDER BY position;');
  const columns = columnsRes.rows;
  const board = [];
  for (const col of columns) {
    const cardsRes = await db.exec('SELECT id, column_id, text, position FROM cards WHERE column_id = $1 ORDER BY position;', [col.id]);
    board.push({
      id: col.id,
      title: col.title,
      cards: cardsRes.rows
    });
  }
  res.json(board);
});

app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  const id = `card-${Date.now()}`;
  // Determine new position: max + 1
  const posRes = await db.exec('SELECT MAX(position) AS maxPos FROM cards WHERE column_id = $1;', [columnId]);
  const pos = (posRes.rows[0].maxpos || 0) + 1;
  await db.exec('INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4);', [id, columnId, text, pos]);
  const card = { id, column_id: columnId, text, position: pos };
  // TODO: Broadcast via SSE
  res.json({ success: true, card });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});