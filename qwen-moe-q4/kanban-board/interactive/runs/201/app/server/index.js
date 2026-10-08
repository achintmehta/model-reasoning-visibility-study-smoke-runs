import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

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
  const countResult = await db.exec(`SELECT COUNT(*) as count FROM columns`);
  const count = parseInt(countResult[0].rows[0].count, 10);
  if (count === 0) {
    const cols = [
      { id: crypto.randomUUID(), title: 'To Do', position: 1 },
      { id: crypto.randomUUID(), title: 'In Progress', position: 2 },
      { id: crypto.randomUUID(), title: 'Done', position: 3 },
    ];
    for (const col of cols) {
      await db.exec(
        `INSERT INTO columns (id, title, position) VALUES ('${col.id}', '${col.title}', ${col.position})`
      );
    }
  }
}

// Helper: safely escape text for SQL
function sqlEscape(str) {
  return str.replace(/'/g, "''");
}

// GET /api/board - return full board state
app.get('/api/board', async (_req, res) => {
  try {
    const colResult = await db.exec(`SELECT id, title, position FROM columns ORDER BY position`);
    const columns = colResult[0].rows;

    const result = [];
    for (const col of columns) {
      const cardResult = await db.exec(
        `SELECT id, column_id, text, position, created_at FROM cards WHERE column_id = '${sqlEscape(col.id)}' ORDER BY position`
      );
      result.push({
        id: col.id,
        title: col.title,
        position: col.position,
        cards: cardResult[0].rows.map((c) => ({
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
  const colCheck = await db.exec(`SELECT id FROM columns WHERE id = '${sqlEscape(columnId)}'`);
  if (colCheck[0].rows.length === 0) {
    return res.status(404).json({ error: 'Column not found' });
  }

  // Get max position in column
  const maxPosResult = await db.exec(
    `SELECT COALESCE(MAX(position), 0) as max_pos FROM cards WHERE column_id = '${sqlEscape(columnId)}'`
  );
  const maxPos = Number(maxPosResult[0].rows[0].max_pos);

  const newCard = {
    id: crypto.randomUUID(),
    column_id: columnId,
    text,
    position: maxPos + 1,
    created_at: new Date().toISOString(),
  };

  await db.exec(
    `INSERT INTO cards (id, column_id, text, position, created_at) VALUES ('${newCard.id}', '${sqlEscape(newCard.column_id)}', '${sqlEscape(newCard.text)}', ${newCard.position}, '${newCard.created_at}')`
  );

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
  const cardCheck = await db.exec(`SELECT id, column_id FROM cards WHERE id = '${sqlEscape(id)}'`);
  if (cardCheck[0].rows.length === 0) {
    return res.status(404).json({ error: 'Card not found' });
  }

  // Check target column exists
  const colCheck = await db.exec(`SELECT id FROM columns WHERE id = '${sqlEscape(columnId)}'`);
  if (colCheck[0].rows.length === 0) {
    return res.status(404).json({ error: 'Column not found' });
  }

  let newPosition;

  if (beforeId) {
    // Move before a specific card
    const beforeCard = await db.exec(`SELECT position FROM cards WHERE id = '${sqlEscape(beforeId)}'`);
    if (beforeCard[0].rows.length > 0) {
      newPosition = Number(beforeCard[0].rows[0].position) - 1;
    }
  } else if (afterId) {
    // Move after a specific card
    const afterCard = await db.exec(`SELECT position FROM cards WHERE id = '${sqlEscape(afterId)}'`);
    if (afterCard[0].rows.length > 0) {
      newPosition = Number(afterCard[0].rows[0].position) + 1;
    }
  } else {
    // No anchor, place at end
    const maxPosResult = await db.exec(
      `SELECT COALESCE(MAX(position), 0) as max_pos FROM cards WHERE column_id = '${sqlEscape(columnId)}'`
    );
    newPosition = Number(maxPosResult[0].rows[0].max_pos) + 1;
  }

  // If new position is <= 0, set to 1
  if (newPosition <= 0) {
    newPosition = 1;
  }

  // Atomic transaction: update column_id and position
  const now = new Date().toISOString();
  await db.exec(`
    BEGIN;
    UPDATE cards SET column_id = '${sqlEscape(columnId)}', position = ${newPosition}, created_at = '${now}' WHERE id = '${sqlEscape(id)}';
    COMMIT;
  `);

  // Read back the updated card
  const updatedCardResult = await db.exec(
    `SELECT id, column_id, text, position, created_at FROM cards WHERE id = '${sqlEscape(id)}'`
  );

  const card = {
    id: updatedCardResult[0].rows[0].id,
    column_id: updatedCardResult[0].rows[0].column_id,
    text: updatedCardResult[0].rows[0].text,
    position: Number(updatedCardResult[0].rows[0].position),
    created_at: updatedCardResult[0].rows[0].created_at,
  };

  // Check for position collisions and renormalize if needed
  await renormalizeColumn(columnId);

  // Broadcast the move
  broadcast('card-moved', card);

  res.json(card);
});

// Renormalize positions in a column to avoid precision exhaustion
async function renormalizeColumn(columnId) {
  const cardsResult = await db.exec(
    `SELECT id, position FROM cards WHERE column_id = '${sqlEscape(columnId)}' ORDER BY position`
  );
  const cards = cardsResult[0].rows;

  // Check for duplicate positions
  const positions = cards.map((c) => Number(c.position));
  const uniquePositions = new Set(positions);
  if (uniquePositions.size === positions.length) {
    return; // No collisions, no need to renormalize
  }

  // Renormalize: assign sequential positions 1, 2, 3, ...
  for (let i = 0; i < cards.length; i++) {
    await db.exec(
      `UPDATE cards SET position = ${i + 1} WHERE id = '${sqlEscape(cards[i].id)}' AND column_id = '${sqlEscape(columnId)}'`
    );
  }

  // Broadcast the corrected order
  const updatedCardsResult = await db.exec(
    `SELECT id, column_id, text, position, created_at FROM cards WHERE column_id = '${sqlEscape(columnId)}' ORDER BY position`
  );
  broadcast('column-renormalized', {
    columnId,
    cards: updatedCardsResult[0].rows.map((c) => ({
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
      const colResult = await db.exec(`SELECT id, title, position FROM columns ORDER BY position`);
      const columns = colResult[0].rows;

      const boardState = [];
      for (const col of columns) {
        const cardResult = await db.exec(
          `SELECT id, column_id, text, position, created_at FROM cards WHERE column_id = '${sqlEscape(col.id)}' ORDER BY position`
        );
        boardState.push({
          id: col.id,
          title: col.title,
          position: col.position,
          cards: cardResult[0].rows.map((c) => ({
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
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
