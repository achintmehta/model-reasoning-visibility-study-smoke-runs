const express = require('express');
const cors = require('cors');
const { Database } = require('@electric-sql/pglite');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const dbPath = path.join(__dirname, 'data.db');
const db = new Database({
  file: dbPath,
});

// Initialize tables if not exist
async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS columns (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      position NUMERIC NOT NULL
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id SERIAL PRIMARY KEY,
      column_id INT REFERENCES columns(id) ON DELETE CASCADE,
      text TEXT,
      position NUMERIC NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Seed if empty
  const { rows: colRows } = await db.query('SELECT COUNT(*) as c FROM columns;');
  if (parseInt(colRows[0].c, 10) === 0) {
    await db.query('INSERT INTO columns (title, position) VALUES
      (\'To Do\', 1),
      (\'In Progress\', 2),
      (\'Done\', 3);');
  }
}

initDb();

// GET /api/board
app.get('/api/board', async (req, res) => {
  const { rows: cols } = await db.query('SELECT id, title, position FROM columns ORDER BY position;');
  const board = [];
  for (const col of cols) {
    const { rows: cards } = await db.query('SELECT id, column_id, text, position FROM cards WHERE column_id = $1 ORDER BY position;', [col.id]);
    board.push({ ...col, cards });
  }
  res.json(board);
});

// POST /api/cards
// POST /api/cards
app.post('/api/cards', async (req, res, next) => {
  const { columnId, text } = req.body;
  if (!columnId) return res.status(400).json({ error: 'columnId required' });
  const { rows: maxPosRows } = await db.query('SELECT COALESCE(MAX(position), 0) as maxpos FROM cards WHERE column_id = $1;', [columnId]);
  const newPos = parseFloat(maxPosRows[0].maxpos) + 1;
  const { rows: inserted } = await db.query(
    'INSERT INTO cards (column_id, text, position) VALUES ($1, $2, $3) RETURNING id, column_id, text, position;',
    [columnId, text, newPos]
  );
  const card = inserted[0];
  // Broadcast create event
  broadcast('create', card);
  res.json(card);
});

// PATCH /api/cards/:id/move
app.patch('/api/cards/:id/move', async (req, res, next) => {
  const cardId = parseInt(req.params.id, 10);
  const { columnId, beforeId, afterId } = req.body; // beforeId, afterId optional
  if (!columnId) return res.status(400).json({ error: 'columnId required' });
  // Begin transaction
  await db.query('BEGIN;');
  // Fetch current card
  const { rows: cardRows } = await db.query('SELECT * FROM cards WHERE id = $1;', [cardId]);
  if (!cardRows[0]) {
    await db.query('ROLLBACK;');
    return res.status(404).json({ error: 'Card not found' });
  }
  const newPosInfo = await computePosition(columnId, beforeId, afterId);
  const { newPos } = newPosInfo;
  await db.query(
    'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3;',
    [columnId, newPos, cardId]
  );
  await db.query('COMMIT;');
  const { rows: updated } = await db.query('SELECT id, column_id, text, position FROM cards WHERE id = $1;', [cardId]);
  const card = updated[0];
  broadcast('move', card);
  res.json(card);
});

async function computePosition(columnId, beforeId, afterId) {
  // Determine positions of neighbors
  let afterPos = 0;
  let beforePos = 0;
  if (beforeId) {
    const { rows } = await db.query('SELECT position FROM cards WHERE id = $1;', [beforeId]);
    if (rows[0]) beforePos = parseFloat(rows[0].position);
  }
  if (afterId) {
    const { rows } = await db.query('SELECT position FROM cards WHERE id = $1;', [afterId]);
    if (rows[0]) afterPos = parseFloat(rows[0].position);
  }
  const newPos = (afterPos + beforePos) / 2;
  return { newPos };
}

// SSE
const clients = [];
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const clientId = Date.now();
  clients.push(res);
  req.on('close', () => {
    const idx = clients.findIndex(c => c === res);
    if (idx !== -1) clients.splice(idx, 1);
  });
});

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => res.write(payload));
}

// Hook into POST and PATCH to broadcast
app.post('/api/cards', async (req, res, next) => {
  // We'll handle here but earlier defined same route. Let's skip broadcast.
  next();
});

app.listen(3000, () => console.log('Backend listening on http://localhost:3000'));
