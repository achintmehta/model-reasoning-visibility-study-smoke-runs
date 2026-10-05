import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

// PGLite data directory
const dataDir = join(__dirname, '..', '.kanban-data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db;
let clients = []; // SSE client writers

// SSE broadcast helper
function broadcast(event, data) {
  const payload = JSON.stringify(data);
  clients.forEach((writer) => {
    try {
      writer.write(`event: ${event}\ndata: ${payload}\n\n`);
    } catch (e) {
      // Client disconnected
    }
  });
}

// Helper: get rows from a db.sql result (returns array of objects)
function rows(result) {
  return result.rows;
}

// Initialize database
async function initDb() {
  db = await PGlite.create({
    dataDir: join(dataDir, 'pglite-data'),
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT NOT NULL REFERENCES columns(id),
      text TEXT NOT NULL,
      position REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_cards_column_position ON cards(column_id, position);
  `);

  // Seed default columns if empty
  const countResult = await db.sql`SELECT COUNT(*) as count FROM columns`;
  const count = parseInt(countResult.rows[0].count, 10);
  if (count === 0) {
    const cols = [
      { id: randomUUID(), title: 'To Do', position: 1 },
      { id: randomUUID(), title: 'In Progress', position: 2 },
      { id: randomUUID(), title: 'Done', position: 3 },
    ];
    for (const col of cols) {
      await db.sql`INSERT INTO columns (id, title, position) VALUES (${col.id}, ${col.title}, ${col.position})`;
    }
  }
}

// GET /api/board - return full board state
app.get('/api/board', async (_req, res) => {
  try {
    const colResult = await db.sql`SELECT id, title, position FROM columns ORDER BY position`;
    const columns = rows(colResult);

    const result = [];
    for (const col of columns) {
      const cardResult = await db.sql`
        SELECT id, column_id, text, position, created_at
        FROM cards WHERE column_id = ${col.id} ORDER BY position
      `;
      result.push({
        id: col.id,
        title: col.title,
        position: col.position,
        cards: rows(cardResult).map((c) => ({
          id: c.id,
          column_id: c.column_id,
          text: c.text,
          position: Number(c.position),
          created_at: c.created_at,
        })),
      });
    }

    res.json(result);
  } catch (e) {
    console.error('Error fetching board:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/cards - create a new card
app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;

  if (!columnId || !text) {
    return res.status(400).json({ error: 'columnId and text are required' });
  }

  // Check column exists
  const colCheck = await db.sql`SELECT id FROM columns WHERE id = ${columnId}`;
  if (rows(colCheck).length === 0) {
    return res.status(404).json({ error: 'Column not found' });
  }

  // Get max position in column
  const maxPosResult = await db.sql`
    SELECT COALESCE(MAX(position), 0) as max_pos FROM cards WHERE column_id = ${columnId}
  `;
  const maxPos = Number(maxPosResult.rows[0].max_pos);

  const newCard = {
    id: randomUUID(),
    column_id: columnId,
    text,
    position: maxPos + 1,
    created_at: new Date().toISOString(),
  };

  await db.sql`
    INSERT INTO cards (id, column_id, text, position, created_at)
    VALUES (${newCard.id}, ${newCard.column_id}, ${newCard.text}, ${newCard.position}, ${newCard.created_at})
  `;

  // Broadcast
  broadcast('card-created', newCard);

  res.json(newCard);
});

// PATCH /api/cards/:id/move - move a card to a new column/position
app.patch('/api/cards/:id/move', async (req, res) => {
  const { id } = req.params;
  const { columnId, beforeId, afterId } = req.body;

  if (!columnId) {
    return res.status(400).json({ error: 'columnId is required' });
  }

  // Check card exists
  const cardCheck = await db.sql`SELECT id, column_id FROM cards WHERE id = ${id}`;
  if (rows(cardCheck).length === 0) {
    return res.status(404).json({ error: 'Card not found' });
  }

  // Check target column exists
  const colCheck = await db.sql`SELECT id FROM columns WHERE id = ${columnId}`;
  if (rows(colCheck).length === 0) {
    return res.status(404).json({ error: 'Column not found' });
  }

  let newPosition;

  if (beforeId) {
    // Move before a specific card
    const beforeCard = await db.sql`SELECT position FROM cards WHERE id = ${beforeId}`;
    if (rows(beforeCard).length > 0) {
      newPosition = Number(beforeCard.rows[0].position) - 1;
    }
  } else if (afterId) {
    // Move after a specific card
    const afterCard = await db.sql`SELECT position FROM cards WHERE id = ${afterId}`;
    if (rows(afterCard).length > 0) {
      newPosition = Number(afterCard.rows[0].position) + 1;
    }
  } else {
    // No anchor, place at end
    const maxPosResult = await db.sql`
      SELECT COALESCE(MAX(position), 0) as max_pos FROM cards WHERE column_id = ${columnId}
    `;
    newPosition = Number(maxPosResult.rows[0].max_pos) + 1;
  }

  // If new position is <= 0, set to 1
  if (newPosition <= 0) {
    newPosition = 1;
  }

  // Atomic transaction: update column_id and position
  const now = new Date().toISOString();
  await db.exec('BEGIN');
  try {
    await db.sql`UPDATE cards SET column_id = ${columnId}, position = ${newPosition}, created_at = ${now} WHERE id = ${id}`;
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }

  // Read back the updated card
  const updatedCardResult = await db.sql`SELECT id, column_id, text, position, created_at FROM cards WHERE id = ${id}`;

  const card = {
    id: updatedCardResult.rows[0].id,
    column_id: updatedCardResult.rows[0].column_id,
    text: updatedCardResult.rows[0].text,
    position: Number(updatedCardResult.rows[0].position),
    created_at: updatedCardResult.rows[0].created_at,
  };

  // Check for position collisions and renormalize if needed
  await renormalizeColumn(columnId);

  // Broadcast the move
  broadcast('card-moved', card);

  res.json(card);
});

// Renormalize positions in a column to avoid precision exhaustion
async function renormalizeColumn(columnId) {
  const cardsResult = await db.sql`
    SELECT id, position FROM cards WHERE column_id = ${columnId} ORDER BY position
  `;
  const cards = rows(cardsResult);

  // Check for duplicate positions
  const positions = cards.map((c) => Number(c.position));
  const uniquePositions = new Set(positions);
  if (uniquePositions.size === positions.length) {
    return; // No collisions, no need to renormalize
  }

  // Renormalize: assign sequential positions 1, 2, 3, ...
  for (let i = 0; i < cards.length; i++) {
    await db.sql`UPDATE cards SET position = ${i + 1} WHERE id = ${cards[i].id} AND column_id = ${columnId}`;
  }

  // Broadcast the corrected order
  const updatedCardsResult = await db.sql`
    SELECT id, column_id, text, position, created_at
    FROM cards WHERE column_id = ${columnId} ORDER BY position
  `;
  broadcast('column-renormalized', {
    columnId,
    cards: rows(updatedCardsResult).map((c) => ({
      id: c.id,
      column_id: c.column_id,
      text: c.text,
      position: Number(c.position),
      created_at: c.created_at,
    })),
  });
}

// SSE endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial full board state
  (async () => {
    try {
      const colResult = await db.sql`SELECT id, title, position FROM columns ORDER BY position`;
      const columns = rows(colResult);

      const boardState = [];
      for (const col of columns) {
        const cardResult = await db.sql`
          SELECT id, column_id, text, position, created_at
          FROM cards WHERE column_id = ${col.id} ORDER BY position
        `;
        boardState.push({
          id: col.id,
          title: col.title,
          position: col.position,
          cards: rows(cardResult).map((c) => ({
            id: c.id,
            column_id: c.column_id,
            text: c.text,
            position: Number(c.position),
            created_at: c.created_at,
          })),
        });
      }

      res.write(`event: board-sync\ndata: ${JSON.stringify(boardState)}\n\n`);
    } catch (e) {
      console.error('Error sending initial board state:', e);
    }
  })();

  clients.push(res);

  req.on('close', () => {
    clients = clients.filter((c) => c !== res);
  });
});

// Start server
const PORT = process.env.SERVER_PORT || 3001;
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Kanban server running on port ${PORT}`);
  });
});
