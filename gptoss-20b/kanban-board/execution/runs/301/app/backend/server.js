"use strict";
const express = require('express');
const cors = require('cors');
const path = require('path');
const { PGLite } = require('@electric-sql/pglite');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4000;
const dbPath = path.join(__dirname, 'data', 'pglite.db');

// Ensure data directory exists
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

const db = new PGLite({ path: dbPath });

const initDB = async () => {
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const rows = await db.exec('SELECT COUNT(*) AS cnt FROM columns;');
  if (rows[0].cnt === 0) {
    // Seed columns
    await db.exec(`
      INSERT INTO columns (id, title, position) VALUES
        (hex(randomblob(8)), 'To Do', 1),
        (hex(randomblob(8)), 'In Progress', 2),
        (hex(randomblob(8)), 'Done', 3);
    `);
  }
};

let sseClients = [];

const broadcast = (event) => {
  const data = JSON.stringify(event);
  sseClients.forEach(client => {
    client.res.write(`data: ${data}\n\n`);
  });
};

app.use(cors());
app.use(express.json());

app.get('/api/board', async (req, res) => {
  const cols = await db.exec('SELECT * FROM columns ORDER BY position');
  const board = [];
  for (const col of cols) {
    const cards = await db.exec('SELECT id, column_id, text, position, created_at FROM cards WHERE column_id = ? ORDER BY position', [col.id]);
    board.push({ id: col.id, title: col.title, position: col.position, cards });
  }
  res.json({ columns: board });
});

app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  const id = crypto.randomUUID();
  const maxPosRow = await db.exec('SELECT MAX(position) AS max_pos FROM cards WHERE column_id = ?', [columnId]);
  const maxPos = maxPosRow[0].max_pos || 0;
  const position = maxPos + 1;
  await db.exec('INSERT INTO cards (id, column_id, text, position) VALUES (?, ?, ?, ?)', [id, columnId, text, position]);
  const card = { id, column_id: columnId, text, position };
  // broadcast create
  broadcast({ type: 'create', card });
  res.status(201).json({ card });
});

app.patch('/api/cards/:id/move', async (req, res) => {
  const cardId = req.params.id;
  const { columnId, beforeId, afterId } = req.body;
  // Fetch current card
  const [oldCard] = await db.exec('SELECT * FROM cards WHERE id = ?', [cardId]);
  if (!oldCard) {
    return res.status(404).json({ error: 'Card not found' });
  }

  // Determine new position
  let minPos = 0, maxPos = 0;
  if (beforeId) {
    const [beforeCard] = await db.exec('SELECT position FROM cards WHERE id = ?', [beforeId]);
    maxPos = beforeCard.position;
  }
  if (afterId) {
    const [afterCard] = await db.exec('SELECT position FROM cards WHERE id = ?', [afterId]);
    minPos = afterCard.position;
  }

  let newPos;
  if (beforeId && afterId) {
    newPos = (minPos + maxPos) / 2;
  } else if (afterId) {
    newPos = minPos + 1;
  } else if (beforeId) {
    newPos = maxPos - 1;
  } else {
    // move to end of column
    const maxRow = await db.exec('SELECT MAX(position) AS mx FROM cards WHERE column_id = ?', [columnId]);
    newPos = (maxRow[0].mx || 0) + 1;
  }

  // Simple collision detection
  const collision = await db.exec('SELECT COUNT(*) AS cnt FROM cards WHERE column_id = ? AND position = ?', [columnId, newPos]);
  if (collision[0].cnt > 0) {
    // normalize positions in column
    const columnCards = await db.exec('SELECT id, position FROM cards WHERE column_id = ? ORDER BY position', [columnId]);
    for (let i=0; i<columnCards.length; i++) {
      const updPos = i + 1;
      await db.exec('UPDATE cards SET position = ? WHERE id = ?', [updPos, columnCards[i].id]);
      if (columnCards[i].id === cardId) newPos = updPos;
    }
  }

  await db.exec('UPDATE cards SET column_id = ?, position = ? WHERE id = ?', [columnId, newPos, cardId]);
  const card = { id: cardId, column_id: columnId, position: newPos };
  broadcast({ type: 'move', card });
  res.json({ card });
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Connection', 'keep-alive');

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

app.listen(PORT, async () => {
  await initDB();
  console.log(`Server running on port ${PORT}`);
});
