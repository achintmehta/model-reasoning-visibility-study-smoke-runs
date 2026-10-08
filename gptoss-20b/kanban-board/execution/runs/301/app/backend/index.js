const express = require('express');
const cors = require('cors');
const { PGLite } = require('@electric-sql/pglite');
const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize PGLite (SQLite file in ./data/kanban.sqlite)
const db = new PGLite({
  path: './data/kanban.sqlite',
});

// Ensure data directory exists
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });

// DB initialization
const initDB = async () => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      position REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      column_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      position REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE
    );
  `);

  // Seed default columns if empty
  const { rows } = await db.query('SELECT COUNT(*) AS count FROM columns');
  if (rows[0].count === 0) {
    const defaultColumns = [
      { title: 'To Do', position: 1 },
      { title: 'In Progress', position: 2 },
      { title: 'Done', position: 3 }
    ];
    const stmt = db.prepare('INSERT INTO columns (title, position) VALUES (?, ?)');
    for (const col of defaultColumns) {
      stmt.run(col.title, col.position);
    }
    stmt.finalize();
  }
};

// SSE utilities
const sseClients = [];
const sendEvent = (data) => {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res) => res.write(payload));
};

app.get('/api/stream', (req, res) => {
  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('\n');
  sseClients.push(res);
  req.on('close', () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

// Board state endpoint
app.get('/api/board', async (req, res) => {
  const columns = await db.all('SELECT * FROM columns ORDER BY position');
  const board = [];
  for (const col of columns) {
    const cards = await db.all(
      'SELECT * FROM cards WHERE column_id = $id ORDER BY position',
      { $id: col.id }
    );
    board.push({ ...col, cards });
  }
  res.json(board);
});

// Create card at end of column
app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  if (!columnId || !text) return res.status(400).json({ error: 'columnId and text required' });
  await db.expunge(); // Clear any prepared statements
  const { rows } = await db.query('SELECT MAX(position) as maxPos FROM cards WHERE column_id = $columnId', { $columnId: columnId });
  const maxPos = rows[0].maxPos !== null ? rows[0].maxPos : 0;
  const newPos = maxPos + 1;
  const result = await db.run('INSERT INTO cards (column_id, text, position) VALUES ($cid, $txt, $pos)', {
    $cid: columnId,
    $txt: text,
    $pos: newPos
  });
  const card = await db.get('SELECT * FROM cards WHERE id = $id', { $id: result.lastInsertRowid });
  // Broadcast
  sendEvent({ type: 'create', card });
  res.status(201).json(card);
});

// Move card
app.patch('/api/cards/:id/move', async (req, res) => {
  const cardId = parseInt(req.params.id, 10);
  const { columnId, beforeId, afterId } = req.body;
  if (!columnId) return res.status(400).json({ error: 'columnId required' });
  // Fetch positions
  const getPos = async (id) => {
    if (!id) return null;
    const row = await db.get('SELECT position FROM cards WHERE id = $id', { $id: id });
    return row ? row.position : null;
  };

  const beforePos = await getPos(beforeId);
  const afterPos = await getPos(afterId);

  let newPos;
  if (beforePos !== null) {
    newPos = beforePos - 0.5;
  } else if (afterPos !== null) {
    newPos = afterPos + 0.5;
  } else {
    // No surrounding cards; place at end
    const { rows } = await db.query('SELECT MAX(position) as maxPos FROM cards WHERE column_id = $cid', { $cid: columnId });
    newPos = (rows[0].maxPos !== null ? rows[0].maxPos : 0) + 1;
  }

  // Atomic transaction
  await db.exec('BEGIN TRANSACTION');
  await db.run('UPDATE cards SET column_id = $cid, position = $pos WHERE id = $id', {
    $cid: columnId,
    $pos: newPos,
    $id: cardId
  });
  await db.exec('COMMIT');

  const card = await db.get('SELECT * FROM cards WHERE id = $id', { $id: cardId });
  // Broadcast
  sendEvent({ type: 'move', card });
  res.json(card);
});

// Initialize DB then start server
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to init DB', err);
  });
