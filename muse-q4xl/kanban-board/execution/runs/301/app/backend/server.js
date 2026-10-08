import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'kanban.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const app = express();
app.use(cors());
app.use(express.json());

let db;
let clients = [];

async function initDb() {
  db = await PGlite.create(DB_PATH);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      position NUMERIC NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      id SERIAL PRIMARY KEY,
      column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      position NUMERIC NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const { rows } = await db.query('SELECT COUNT(*) as count FROM columns');
  if (Number(rows[0].count) === 0) {
    await db.exec(`
      INSERT INTO columns (title, position) VALUES
        ('To Do', 0),
        ('In Progress', 1),
        ('Done', 2);
    `);
  }
}

function broadcast(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => {
    try {
      client.res.write(payload);
    } catch (e) {
      // ignore
    }
  });
}

async function getBoard() {
  const cols = await db.query('SELECT id, title, position FROM columns ORDER BY position');
  const board = [];
  for (const col of cols.rows) {
    const cards = await db.query(
      'SELECT id, column_id, text, position, created_at FROM cards WHERE column_id = $1 ORDER BY position',
      [col.id]
    );
    board.push({
      id: col.id,
      title: col.title,
      position: Number(col.position),
      cards: cards.rows.map(c => ({
        id: c.id,
        columnId: c.column_id,
        text: c.text,
        position: Number(c.position),
        createdAt: c.created_at
      }))
    });
  }
  return board;
}

async function normalizeColumnPositions(columnId) {
  // Reassign positions with spacing
  const cards = await db.query(
    'SELECT id FROM cards WHERE column_id = $1 ORDER BY position, id',
    [columnId]
  );
  const step = 1024;
  for (let i = 0; i < cards.rows.length; i++) {
    await db.query('UPDATE cards SET position = $1 WHERE id = $2', [i * step, cards.rows[i].id]);
  }
}

app.get('/api/board', async (req, res) => {
  try {
    const board = await getBoard();
    res.json({ columns: board });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load board' });
  }
});

app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  if (!columnId || !text) {
    return res.status(400).json({ error: 'columnId and text required' });
  }
  try {
    await db.exec('BEGIN');
    const maxRes = await db.query('SELECT COALESCE(MAX(position), -1) as maxpos FROM cards WHERE column_id = $1', [columnId]);
    const maxPos = maxRes.rows[0].maxpos == null ? -1 : Number(maxRes.rows[0].maxpos);
    const position = maxPos + 1;
    const insertRes = await db.query(
      'INSERT INTO cards (column_id, text, position) VALUES ($1, $2, $3) RETURNING id, column_id, text, position, created_at',
      [columnId, text, position]
    );
    await db.exec('COMMIT');
    const card = insertRes.rows[0];
    const cardObj = {
      id: card.id,
      columnId: card.column_id,
      text: card.text,
      position: Number(card.position),
      createdAt: card.created_at
    };
    broadcast('card-created', { card: cardObj });
    res.status(201).json(cardObj);
  } catch (e) {
    await db.exec('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

app.patch('/api/cards/:id/move', async (req, res) => {
  const cardId = Number(req.params.id);
  const { columnId, beforeId, afterId } = req.body;
  if (!columnId) {
    return res.status(400).json({ error: 'columnId required' });
  }
  try {
    await db.exec('BEGIN');
    // Get current card
    const cur = await db.query('SELECT id, column_id, position FROM cards WHERE id = $1', [cardId]);
    if (cur.rows.length === 0) {
      await db.exec('ROLLBACK');
      return res.status(404).json({ error: 'Card not found' });
    }
    const current = cur.rows[0];

    // Compute new position
    let newPosition;
    const beforeIdNum = beforeId ? Number(beforeId) : null;
    const afterIdNum = afterId ? Number(afterId) : null;

    // Helper to fetch position
    const getPos = async (id) => {
      if (!id) return null;
      const r = await db.query('SELECT position FROM cards WHERE id = $1', [id]);
      return r.rows.length ? Number(r.rows[0].position) : null;
    };

    const posBefore = await getPos(beforeIdNum);
    const posAfter = await getPos(afterIdNum);

    if (beforeIdNum && afterIdNum) {
      // Ensure they are in target column
      const beforeCard = await db.query('SELECT column_id FROM cards WHERE id = $1', [beforeIdNum]);
      const afterCard = await db.query('SELECT column_id FROM cards WHERE id = $1', [afterIdNum]);
      const beforeCol = beforeCard.rows[0]?.column_id;
      const afterCol = afterCard.rows[0]?.column_id;
      if (beforeCol !== columnId || afterCol !== columnId) {
        // If IDs refer to cards in different column, treat as edge
        newPosition = posAfter !== null ? posAfter + 1 : posBefore !== null ? posBefore - 1 : 0;
      } else {
        if (posBefore === null || posAfter === null) {
          newPosition = posAfter !== null ? posAfter + 1 : 0;
        } else {
          if (Math.abs(posBefore - posAfter) < 1e-9) {
            // Renormalize
            await normalizeColumnPositions(columnId);
            // Re-fetch positions
            const reBefore = await getPos(beforeIdNum);
            const reAfter = await getPos(afterIdNum);
            newPosition = (reAfter + reBefore) / 2;
          } else {
            newPosition = (posAfter + posBefore) / 2;
          }
        }
      }
    } else if (afterIdNum) {
      newPosition = posAfter !== null ? posAfter + 1 : 0;
    } else if (beforeIdNum) {
      newPosition = posBefore !== null ? posBefore - 1 : 0;
    } else {
      // empty column or append
      const maxRes = await db.query('SELECT COALESCE(MAX(position), -1) as maxpos FROM cards WHERE column_id = $1', [columnId]);
      const maxPos = maxRes.rows[0].maxpos == null ? -1 : Number(maxRes.rows[0].maxpos);
      newPosition = maxPos + 1;
    }

    // Update card
    await db.query('UPDATE cards SET column_id = $1, position = $2 WHERE id = $3', [columnId, newPosition, cardId]);

    // If moving within same column and position collision risk, optionally renormalize if needed
    // Simple check: if before and after both present and gap tiny
    if (beforeIdNum && afterIdNum && Math.abs(posBefore - posAfter) < 1e-6) {
      await normalizeColumnPositions(columnId);
    }

    await db.exec('COMMIT');

    // Fetch canonical card
    const updated = await db.query('SELECT id, column_id, text, position, created_at FROM cards WHERE id = $1', [cardId]);
    const cardObj = {
      id: updated.rows[0].id,
      columnId: updated.rows[0].column_id,
      text: updated.rows[0].text,
      position: Number(updated.rows[0].position),
      createdAt: updated.rows[0].created_at
    };

    broadcast('card-moved', { card: cardObj });
    res.json(cardObj);
  } catch (e) {
    await db.exec('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const client = { id: clientId, res };
  clients.push(client);

  // Send initial comment to keep connection alive
  res.write(': connected\n\n');

  req.on('close', () => {
    clients = clients.filter(c => c.id !== clientId);
  });
});

const PORT = process.env.PORT || 3001;
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to init DB', err);
});
