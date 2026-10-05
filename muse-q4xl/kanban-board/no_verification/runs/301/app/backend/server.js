const express = require('express');
const cors = require('cors');
const { PGlite } = require('@electric-sql/pglite');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs').promises;

const app = express();
app.use(cors());
app.use(express.json());

const DATA_DIR = path.join(__dirname, 'data');
const PORT = process.env.PORT || 3000;

let pg;
let clients = new Set();

async function init() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  pg = new PGlite(DATA_DIR);

  await pg.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position REAL NOT NULL
    )
  `);
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      position REAL NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pg.exec('SELECT COUNT(*) AS count FROM columns');
  const count = parseInt(rows[0].count, 10);
  if (count === 0) {
    await pg.exec(`
      INSERT INTO columns (id, title, position) VALUES
        ('col-todo', 'To Do', 1024),
        ('col-inprogress', 'In Progress', 2048),
        ('col-done', 'Done', 3072)
    `);
  }
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch (e) {
      clients.delete(client);
    }
  }
}

async function getBoard() {
  const colsRes = await pg.exec('SELECT id, title, position FROM columns ORDER BY position');
  const columns = [];
  for (const col of colsRes.rows) {
    const cardsRes = await pg.exec('SELECT id, text, position FROM cards WHERE column_id = $1 ORDER BY position', [col.id]);
    columns.push({
      id: col.id,
      title: col.title,
      position: col.position,
      cards: cardsRes.rows.map(r => ({ id: r.id, text: r.text, position: r.position }))
    });
  }
  return columns;
}

async function renormalizeColumn(columnId) {
  const cardsRes = await pg.exec('SELECT id FROM cards WHERE column_id = $1 ORDER BY position', [columnId]);
  const step = 1024;
  for (let i = 0; i < cardsRes.rows.length; i++) {
    const newPos = (i + 1) * step;
    await pg.exec('UPDATE cards SET position = $1 WHERE id = $2', [newPos, cardsRes.rows[i].id]);
  }
  // broadcast corrected order
  const updatedCards = await pg.exec('SELECT id, text, position FROM cards WHERE column_id = $1 ORDER BY position', [columnId]);
  broadcast('cards-renormalized', { columnId, cards: updatedCards.rows });
}

async function computeNewPosition(columnId, beforeId, afterId, excludeCardId = null) {
  const whereExclude = excludeCardId ? `AND id <> '${excludeCardId}'` : '';
  // fetch positions
  let posBefore = null;
  let posAfter = null;
  if (beforeId) {
    const res = await pg.exec('SELECT position FROM cards WHERE id = $1 AND column_id = $2', [beforeId, columnId]);
    if (res.rows.length) posBefore = res.rows[0].position;
  }
  if (afterId) {
    const res = await pg.exec('SELECT position FROM cards WHERE id = $1 AND column_id = $2', [afterId, columnId]);
    if (res.rows.length) posAfter = res.rows[0].position;
  }

  if (!beforeId && !afterId) {
    // append at end
    const maxRes = await pg.exec(`SELECT MAX(position) AS maxPos FROM cards WHERE column_id = $1 ${excludeCardId ? 'AND id <> $2' : ''}`, excludeCardId ? [columnId, excludeCardId] : [columnId]);
    const maxPos = maxRes.rows[0].maxPos;
    if (maxPos == null) return 1024;
    return maxPos + 1024;
  }
  if (!beforeId) {
    // insert before first? Actually afterId is last
    return posAfter ? posAfter / 2 : 512;
  }
  if (!afterId) {
    return posBefore ? posBefore * 2 : 2048;
  }
  // between
  const newPos = (posBefore + posAfter) / 2;
  // check precision exhaustion
  if (Math.abs(newPos - posBefore) < 1e-9 || Math.abs(posAfter - newPos) < 1e-9) {
    await renormalizeColumn(columnId);
    // after renormalize, recompute positions
    const resBefore = await pg.exec('SELECT position FROM cards WHERE id = $1 AND column_id = $2', [beforeId, columnId]);
    const resAfter = await pg.exec('SELECT position FROM cards WHERE id = $1 AND column_id = $2', [afterId, columnId]);
    posBefore = resBefore.rows[0]?.position;
    posAfter = resAfter.rows[0]?.position;
    return (posBefore + posAfter) / 2;
  }
  return newPos;
}

app.get('/api/board', async (req, res) => {
  try {
    const board = await getBoard();
    res.json(board);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load board' });
  }
});

app.post('/api/cards', async (req, res) => {
  try {
    const { columnId, text } = req.body;
    if (!columnId || !text) return res.status(400).json({ error: 'columnId and text required' });
    const id = randomUUID();
    const maxRes = await pg.exec('SELECT MAX(position) AS maxPos FROM cards WHERE column_id = $1', [columnId]);
    const maxPos = maxRes.rows[0].maxPos;
    const position = maxPos == null ? 1024 : maxPos + 1024;
    await pg.exec('INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4)', [id, columnId, text, position]);
    const card = { id, columnId, text, position };
    broadcast('card-created', { card });
    res.status(201).json(card);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

app.patch('/api/cards/:id/move', async (req, res) => {
  try {
    const cardId = req.params.id;
    const { columnId, beforeId, afterId } = req.body;
    if (!columnId) return res.status(400).json({ error: 'columnId required' });
    const cardRes = await pg.exec('SELECT id, column_id, position FROM cards WHERE id = $1', [cardId]);
    if (!cardRes.rows.length) return res.status(404).json({ error: 'Card not found' });
    const newPos = await computeNewPosition(columnId, beforeId, afterId, cardId);
    await pg.exec('BEGIN');
    await pg.exec('UPDATE cards SET column_id = $1, position = $2 WHERE id = $3', [columnId, newPos, cardId]);
    await pg.exec('COMMIT');
    const updated = await pg.exec('SELECT id, column_id, text, position FROM cards WHERE id = $1', [cardId]);
    const card = updated.rows[0];
    broadcast('card-moved', { card: { id: card.id, columnId: card.column_id, text: card.text, position: card.position } });
    res.json({ id: card.id, columnId: card.column_id, position: card.position });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(': connected\n\n');
  clients.add(res);
  req.on('close', () => {
    clients.delete(res);
  });
  // heartbeat
  const interval = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);
  req.on('close', () => clearInterval(interval));
});

init().then(() => {
  app.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to init', err);
  process.exit(1);
});
