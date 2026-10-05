const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { PGlite } = require('@electric-sql/pglite');

const app = express();
app.use(cors());
app.use(express.json());

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize PGlite
const db = new PGlite(DATA_DIR);

async function initDb() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      position NUMERIC NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      id SERIAL PRIMARY KEY,
      column_id INTEGER REFERENCES columns(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      position NUMERIC NOT NULL,
      created_at TIMESTAMP DEFAULT now()
    );
  `);

  // Seed default columns if empty
  const { rows: cols } = await db.query('SELECT id FROM columns');
  if (cols.length === 0) {
    await db.exec(`
      INSERT INTO columns (title, position) VALUES
      ('To Do', 1000),
      ('In Progress', 2000),
      ('Done', 3000);
    `);
  }
}

initDb().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('DB init error', err);
  process.exit(1);
});

// SSE clients
const clients = new Set();

function broadcast(eventType, data) {
  const payload = `event: ${eventType}\n data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch (e) {
      clients.delete(res);
    }
  }
}

// API: Get board
app.get('/api/board', async (req, res) => {
  try {
    const { rows: columns } = await db.query('SELECT id, title, position FROM columns ORDER BY position');
    const board = [];
    for (const col of columns) {
      const { rows: cards } = await db.query(
        'SELECT id, column_id, text, position, created_at FROM cards WHERE column_id = $1 ORDER BY position',
        [col.id]
      );
      board.push({
        id: col.id,
        title: col.title,
        position: col.position,
        cards
      });
    }
    res.json(board);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch board' });
  }
});

// API: Create card
app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  if (!columnId || !text) {
    return res.status(400).json({ error: 'columnId and text required' });
  }
  try {
    await db.exec('BEGIN');
    // Find max position
    const { rows } = await db.query('SELECT COALESCE(MAX(position), 0) as maxpos FROM cards WHERE column_id = $1', [columnId]);
    const newPos = Number(rows[0].maxpos) + 1000;
    const result = await db.query(
      'INSERT INTO cards (column_id, text, position) VALUES ($1, $2, $3) RETURNING id, column_id, text, position, created_at',
      [columnId, text, newPos]
    );
    await db.exec('COMMIT');
    const card = result.rows[0];
    broadcast('card-created', { card, columnId });
    res.status(201).json(card);
  } catch (err) {
    await db.exec('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

// Helper to compute new position
async function computeNewPosition(columnId, beforeId, afterId, movingCardId) {
  // Get cards in column except moving card
  const params = [columnId];
  let query = 'SELECT id, position FROM cards WHERE column_id = $1';
  if (movingCardId) {
    query += ' AND id != $2';
    params.push(movingCardId);
  }
  query += ' ORDER BY position';
  const { rows } = await db.query(query, params);
  const posMap = new Map(rows.map(r => [r.id, Number(r.position)]));

  let beforePos = null;
  let afterPos = null;
  if (beforeId) {
    beforePos = posMap.get(Number(beforeId)) ?? null;
  }
  if (afterId) {
    afterPos = posMap.get(Number(afterId)) ?? null;
  }

  let newPos;
  if (beforeId && afterId) {
    if (beforePos === null || afterPos === null) {
      // fallback to end
      newPos = (afterPos ?? 0) + 1000;
    } else {
      newPos = (beforePos + afterPos) / 2;
      // avoid precision issues
      if (Math.abs(newPos - beforePos) < 1e-6 || Math.abs(newPos - afterPos) < 1e-6) {
        newPos = null; // signal renormalize
      }
    }
  } else if (beforeId) {
    newPos = (beforePos ?? 0) + 1000;
  } else if (afterId) {
    newPos = (afterPos ?? 0) - 1000;
    if (newPos < 0) newPos = 0;
  } else {
    // empty column or append
    const maxPos = rows.reduce((max, r) => Math.max(max, Number(r.position)), 0);
    newPos = maxPos + 1000;
  }

  // Ensure positive
  if (newPos === null || newPos <= 0) newPos = 1000;
  return newPos;
}

// Renormalize column
async function renormalizeColumn(columnId) {
  const { rows } = await db.query(
    'SELECT id FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );
  await db.exec('BEGIN');
  for (let i = 0; i < rows.length; i++) {
    const newPos = (i + 1) * 1000;
    await db.query('UPDATE cards SET position = $1 WHERE id = $2', [newPos, rows[i].id]);
  }
  await db.exec('COMMIT');
  // Fetch updated cards
  const { rows: updated } = await db.query(
    'SELECT id, column_id, text, position, created_at FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );
  broadcast('column-reordered', { columnId, cards: updated });
}

// API: Move card
app.patch('/api/cards/:id/move', async (req, res) => {
  const cardId = Number(req.params.id);
  const { columnId, beforeId, afterId } = req.body;
  if (!columnId) {
    return res.status(400).json({ error: 'columnId required' });
  }
  try {
    await db.exec('BEGIN');
    const { rows: existing } = await db.query('SELECT id, column_id, position FROM cards WHERE id = $1', [cardId]);
    if (existing.length === 0) {
      await db.exec('ROLLBACK');
      return res.status(404).json({ error: 'Card not found' });
    }
    const oldColumnId = existing[0].column_id;
    const newPos = await computeNewPosition(columnId, beforeId, afterId, cardId);
    // If position is too close, renormalize later
    await db.query(
      'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3',
      [columnId, newPos, cardId]
    );
    await db.exec('COMMIT');

    // Fetch canonical card
    const { rows: cardRows } = await db.query(
      'SELECT id, column_id, text, position, created_at FROM cards WHERE id = $1',
      [cardId]
    );
    const card = cardRows[0];

    // Check if renormalization needed
    const { rows: neighbors } = await db.query(
      'SELECT position FROM cards WHERE column_id = $1 AND id != $2 ORDER BY position',
      [columnId, cardId]
    );
    // Simple check: if newPos is very close to neighbors, renormalize
    const neighborPositions = neighbors.map(r => Number(r.position));
    const minDiff = Math.min(...neighborPositions.map(p => Math.abs(p - newPos)), 1e9);
    if (minDiff < 0.001) {
      await renormalizeColumn(columnId);
      // After renormalization, fetch updated card
      const { rows: updatedCard } = await db.query(
        'SELECT id, column_id, text, position, created_at FROM cards WHERE id = $1',
        [cardId]
      );
      return res.json(updatedCard[0]);
    }

    // Broadcast move
    broadcast('card-moved', { card, fromColumnId: oldColumnId, toColumnId: columnId });
    res.json(card);
  } catch (err) {
    await db.exec('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

// SSE endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send comment to keep connection alive
  res.write(': connected\n\n');
  clients.add(res);

  req.on('close', () => {
    clients.delete(res);
  });
});
