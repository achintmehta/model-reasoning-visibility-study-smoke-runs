import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'node:crypto';

// Work around PGLite getter issue in this version
const pgliteModule = await import('@electric-sql/pglite');
const PGLite = Object.getOwnPropertyDescriptor(pgliteModule, 'PGlite')?.value;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

let db;
const clients = new Set();

// SSE endpoint
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const client = res;
  clients.add(client);
  client.write(`data: {"type":"connected"}\n\n`);

  req.on('close', () => {
    clients.delete(client);
  });
});

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(msg);
    } catch (e) {
      // client disconnected
    }
  }
}

// Board state endpoint
app.get('/api/board', async (req, res) => {
  try {
    const columns = await db.query('SELECT id, title, position FROM columns ORDER BY position');
    const result = [];

    for (const col of columns.rows) {
      const cards = await db.query(
        'SELECT id, column_id, text, position, created_at FROM cards WHERE column_id = $1 ORDER BY position',
        [col.id]
      );
      result.push({
        id: col.id,
        title: col.title,
        position: col.position,
        cards: cards.rows,
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Error fetching board:', err);
    res.status(500).json({ error: 'Failed to fetch board' });
  }
});

// Create card
app.post('/api/cards', async (req, res) => {
  try {
    const { columnId, text } = req.body;

    if (!columnId || !text) {
      return res.status(400).json({ error: 'columnId and text are required' });
    }

    // Get the max position in the column to append at the end
    const maxPos = await db.query(
      'SELECT MAX(position) as max_pos FROM cards WHERE column_id = $1',
      [columnId]
    );

    const currentMax = maxPos.rows[0].max_pos;
    const newPosition = currentMax === null ? 0 : currentMax + 1;

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await db.query(
      'INSERT INTO cards (id, column_id, text, position, created_at) VALUES ($1, $2, $3, $4, $5)',
      [id, columnId, text, newPosition, createdAt]
    );

    const card = { id, column_id: columnId, text, position: newPosition, created_at: createdAt };

    broadcast('card_created', { card, columnId });

    res.status(201).json(card);
  } catch (err) {
    console.error('Error creating card:', err);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

// Move card
app.patch('/api/cards/:id/move', async (req, res) => {
  try {
    const cardId = req.params.id;
    const { columnId, beforeId, afterId } = req.body;

    if (!columnId) {
      return res.status(400).json({ error: 'columnId is required' });
    }

    // Get current card info
    const currentCard = await db.query('SELECT id, column_id, position FROM cards WHERE id = $1', [cardId]);
    if (currentCard.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    // Compute new position using fractional ordering
    let newPosition;

    if (beforeId && afterId) {
      // Between two cards
      const before = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
      const after = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);

      if (before.rows.length > 0 && after.rows.length > 0) {
        const beforePos = before.rows[0].position;
        const afterPos = after.rows[0].position;

        // Check for precision issues
        const diff = beforePos - afterPos;
        if (diff < 1e-10) {
          // Positions too close, renormalize column
          await renormalizeColumn(columnId);
          const before2 = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
          const after2 = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);
          newPosition = (before2.rows[0].position + after2.rows[0].position) / 2;
        } else {
          newPosition = (beforePos + afterPos) / 2;
        }
      } else {
        newPosition = await getEndPosition(columnId);
      }
    } else if (beforeId) {
      // Before a card (at the end, before the last card)
      const before = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
      if (before.rows.length > 0) {
        const maxPos = await db.query('SELECT MAX(position) as max_pos FROM cards WHERE column_id = $1', [columnId]);
        const currentMax = maxPos.rows[0].max_pos;
        if (currentMax !== null && before.rows[0].position === currentMax) {
          newPosition = currentMax + 1;
        } else {
          // Insert before the given card
          const afterCards = await db.query(
            'SELECT MIN(position) as min_pos FROM cards WHERE column_id = $1 AND position > $2',
            [columnId, before.rows[0].position]
          );
          if (afterCards.rows[0].min_pos !== null) {
            newPosition = (before.rows[0].position + afterCards.rows[0].min_pos) / 2;
          } else {
            newPosition = before.rows[0].position - 1;
          }
        }
      } else {
        newPosition = await getEndPosition(columnId);
      }
    } else if (afterId) {
      // After a card (at the beginning, after the first card)
      const after = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);
      if (after.rows.length > 0) {
        const minPos = await db.query('SELECT MIN(position) as min_pos FROM cards WHERE column_id = $1', [columnId]);
        const currentMin = minPos.rows[0].min_pos;
        if (currentMin !== null && after.rows[0].position === currentMin) {
          newPosition = currentMin - 1;
        } else {
          const beforeCards = await db.query(
            'SELECT MAX(position) as max_pos FROM cards WHERE column_id = $1 AND position < $2',
            [columnId, after.rows[0].position]
          );
          if (beforeCards.rows[0].max_pos !== null) {
            newPosition = (after.rows[0].position + beforeCards.rows[0].max_pos) / 2;
          } else {
            newPosition = after.rows[0].position + 1;
          }
        }
      } else {
        newPosition = await getEndPosition(columnId);
      }
    } else {
      // No neighbors specified, append at end
      newPosition = await getEndPosition(columnId);
    }

    // Check if position collides with existing card in target column
    const existingPos = await db.query(
      'SELECT id FROM cards WHERE column_id = $1 AND position = $2 AND id != $3',
      [columnId, newPosition, cardId]
    );
    if (existingPos.rows.length > 0) {
      await renormalizeColumn(columnId);
      newPosition = await getEndPosition(columnId);
    }

    // Atomic update
    await db.query(
      'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3',
      [columnId, newPosition, cardId]
    );

    const updatedCard = await db.query(
      'SELECT id, column_id, text, position, created_at FROM cards WHERE id = $1',
      [cardId]
    );

    broadcast('card_moved', { card: updatedCard.rows[0], columnId });

    res.json(updatedCard.rows[0]);
  } catch (err) {
    console.error('Error moving card:', err);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

// Delete card
app.delete('/api/cards/:id', async (req, res) => {
  try {
    const cardId = req.params.id;

    const existing = await db.query('SELECT column_id FROM cards WHERE id = $1', [cardId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    const columnId = existing.rows[0].column_id;

    await db.query('DELETE FROM cards WHERE id = $1', [cardId]);

    broadcast('card_deleted', { cardId, columnId });

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting card:', err);
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

// Get end position for a column
async function getEndPosition(columnId) {
  const maxPos = await db.query(
    'SELECT MAX(position) as max_pos FROM cards WHERE column_id = $1',
    [columnId]
  );
  const currentMax = maxPos.rows[0].max_pos;
  return currentMax === null ? 0 : currentMax + 1;
}

// Renormalize positions in a column
async function renormalizeColumn(columnId) {
  const cards = await db.query(
    'SELECT id, position FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );

  const rows = cards.rows;
  for (let i = 0; i < rows.length; i++) {
    await db.query('UPDATE cards SET position = $1 WHERE id = $2', [i, rows[i].id]);
  }

  // Broadcast the renormalized state
  const updatedCards = await db.query(
    'SELECT id, column_id, text, position, created_at FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );

  broadcast('column_renormalized', { columnId, cards: updatedCards.rows });
}

// Initialize database
async function initDB() {
  const dataDir = path.join(__dirname, 'pglite-data');

  db = new PGLite({
    dataDir,
  });

  await db.waitReady;

  // Create tables
  await db.query(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position INTEGER NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT NOT NULL REFERENCES columns(id),
      text TEXT NOT NULL,
      position REAL NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // Seed default columns if empty
  const existing = await db.query('SELECT COUNT(*) as count FROM columns');
  if (existing.rows[0].count === 0) {
    const defaultColumns = [
      { id: crypto.randomUUID(), title: 'To Do', position: 0 },
      { id: crypto.randomUUID(), title: 'In Progress', position: 1 },
      { id: crypto.randomUUID(), title: 'Done', position: 2 },
    ];

    for (const col of defaultColumns) {
      await db.query(
        'INSERT INTO columns (id, title, position) VALUES ($1, $2, $3)',
        [col.id, col.title, col.position]
      );
    }
  }
}

// Start server
const PORT = process.env.PORT || 3001;

initDB().then(() => {
  console.log('PGLite database initialized');
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
