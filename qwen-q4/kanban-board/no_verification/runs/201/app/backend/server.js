import express from 'express';
import cors from 'cors';
import { PGLite } from '@electric-sql/pglite';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'pglite-data');

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true });

// Initialize PGLite with persistent storage
const db = new PGLite({
  dataDirectory: DATA_DIR,
});

// SSE connections
const sseConnections = new Set();

// Helper: Generate a unique ID
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Helper: Get a card's position
async function getCardPosition(cardId) {
  const { rows } = await db.query(
    'SELECT position FROM cards WHERE id = $1',
    [cardId]
  );
  return rows.length > 0 ? parseFloat(rows[0].position) : null;
}

// Helper: Get max position in a column
async function getMaxPosition(columnId) {
  const { rows } = await db.query(
    'SELECT MAX(position) as max_pos FROM cards WHERE column_id = $1',
    [columnId]
  );
  return rows[0].max_pos !== null ? parseFloat(rows[0].max_pos) : 0;
}

// Helper: Get min position in a column
async function getMinPosition(columnId) {
  const { rows } = await db.query(
    'SELECT MIN(position) as min_pos FROM cards WHERE column_id = $1',
    [columnId]
  );
  return rows[0].min_pos !== null ? parseFloat(rows[0].min_pos) : 0;
}

// Helper: Compute a fractional position between two values
function between(a, b) {
  return (a + b) / 2;
}

// Helper: Renormalize positions in a column if precision is exhausted
async function renormalizeColumn(columnId) {
  const { rows } = await db.query(
    'SELECT id, position FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );

  if (rows.length === 0) return;

  // Check for collisions or precision exhaustion
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].position - rows[i - 1].position < 1e-10) {
      // Collision detected, renormalize
      const updates = rows.map((row, idx) =>
        db.query('UPDATE cards SET position = $1 WHERE id = $2', [idx * 1000, row.id])
      );
      await Promise.all(updates);

      // Broadcast the corrected order
      const { rows: correctedCards } = await db.query(
        'SELECT id FROM cards WHERE column_id = $1 ORDER BY position',
        [columnId]
      );
      broadcast('columnRenormalized', {
        column_id: columnId,
        card_order: correctedCards.map(c => c.id)
      });
      return;
    }
  }

  // Check if range is too large (precision exhaustion risk)
  if (rows.length > 0) {
    const range = rows[rows.length - 1].position - rows[0].position;
    if (range > 1e8) {
      const updates = rows.map((row, idx) =>
        db.query('UPDATE cards SET position = $1 WHERE id = $2', [idx * 1000, row.id])
      );
      await Promise.all(updates);

      const { rows: correctedCards } = await db.query(
        'SELECT id FROM cards WHERE column_id = $1 ORDER BY position',
        [columnId]
      );
      broadcast('columnRenormalized', {
        column_id: columnId,
        card_order: correctedCards.map(c => c.id)
      });
    }
  }
}

// Helper: Broadcast an event to all SSE connections
function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const conn of sseConnections) {
    try {
      conn.write(message);
    } catch (e) {
      // Connection may be closed, ignore
    }
  }
}

// Helper: Get full board state
async function getBoardState() {
  const { rows: columns } = await db.query('SELECT * FROM columns ORDER BY position');
  const board = [];

  for (const col of columns) {
    const { rows: cards } = await db.query(
      'SELECT * FROM cards WHERE column_id = $1 ORDER BY position',
      [col.id]
    );
    board.push({
      column: col,
      cards: cards.map(c => ({
        id: c.id,
        column_id: c.column_id,
        text: c.text,
        position: c.position,
        created_at: c.created_at
      }))
    });
  }

  return board;
}

// Initialize database schema and seed data
async function initDatabase() {
  await db.waitReady;

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
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Seed default columns if empty
  const { rows: existingColumns } = await db.query('SELECT id FROM columns');
  if (existingColumns.length === 0) {
    await db.query(`
      INSERT INTO columns (id, title, position) VALUES
        ('col-todo', 'To Do', 0),
        ('col-in-progress', 'In Progress', 1),
        ('col-done', 'Done', 2)
    `);
  }
}

// Create Express app
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// GET /api/board - Return full board state
app.get('/api/board', async (req, res) => {
  try {
    const board = await getBoardState();
    res.json(board);
  } catch (err) {
    console.error('Error fetching board:', err);
    res.status(500).json({ error: 'Failed to fetch board state' });
  }
});

// POST /api/cards - Create a new card
app.post('/api/cards', async (req, res) => {
  try {
    const { column_id, text } = req.body;

    if (!column_id || !text) {
      return res.status(400).json({ error: 'column_id and text are required' });
    }

    // Verify column exists
    const { rows: cols } = await db.query('SELECT id FROM columns WHERE id = $1', [column_id]);
    if (cols.length === 0) {
      return res.status(404).json({ error: 'Column not found' });
    }

    const id = generateId();
    const maxPos = await getMaxPosition(column_id);
    const position = maxPos + 1000;

    await db.query(
      'INSERT INTO cards (id, column_id, text, position, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [id, column_id, text, position]
    );

    const card = { id, column_id, text, position };

    // Broadcast the new card
    broadcast('cardCreated', { card, column_id });

    res.status(201).json(card);
  } catch (err) {
    console.error('Error creating card:', err);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

// PATCH /api/cards/:id/move - Move/reorder a card
app.patch('/api/cards/:id/move', async (req, res) => {
  try {
    const { id } = req.params;
    const { column_id, before_id, after_id } = req.body;

    if (!column_id) {
      return res.status(400).json({ error: 'column_id is required' });
    }

    // Verify column exists
    const { rows: cols } = await db.query('SELECT id FROM columns WHERE id = $1', [column_id]);
    if (cols.length === 0) {
      return res.status(404).json({ error: 'Column not found' });
    }

    // Get current card info
    const { rows: cardRows } = await db.query(
      'SELECT id, column_id, text, position FROM cards WHERE id = $1',
      [id]
    );
    if (cardRows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    const currentCard = cardRows[0];
    const oldColumnId = currentCard.column_id;

    // Compute new position
    let newPosition;

    if (before_id && after_id) {
      // Position between two cards
      const beforePos = await getCardPosition(before_id);
      const afterPos = await getCardPosition(after_id);
      if (beforePos !== null && afterPos !== null) {
        newPosition = between(afterPos, beforePos);
      } else {
        const maxPos = await getMaxPosition(column_id);
        newPosition = maxPos + 1000;
      }
    } else if (after_id) {
      // After a specific card
      const afterPos = await getCardPosition(after_id);
      if (afterPos !== null) {
        newPosition = afterPos + 1000;
      } else {
        const maxPos = await getMaxPosition(column_id);
        newPosition = maxPos + 1000;
      }
    } else if (before_id) {
      // Before a specific card
      const beforePos = await getCardPosition(before_id);
      if (beforePos !== null) {
        newPosition = beforePos - 1000;
      } else {
        const minPos = await getMinPosition(column_id);
        newPosition = minPos - 1000;
      }
    } else {
      // End of column (default)
      const maxPos = await getMaxPosition(column_id);
      newPosition = maxPos + 1000;
    }

    // Perform atomic update: update column and position
    await db.query(
      'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3',
      [column_id, newPosition, id]
    );

    // Check for position collisions and renormalize if needed
    await renormalizeColumn(column_id);

    // Get the canonical card state after all updates
    const { rows: updatedCardRows } = await db.query(
      'SELECT id, column_id, text, position FROM cards WHERE id = $1',
      [id]
    );
    const canonicalCard = updatedCardRows[0];

    // Get the full order for the target column for reconciliation
    const { rows: columnCards } = await db.query(
      'SELECT id FROM cards WHERE column_id = $1 ORDER BY position',
      [column_id]
    );
    const cardOrder = columnCards.map(c => c.id);

    // Also get the old column's card order if it changed
    let oldColumnCardOrder = null;
    if (oldColumnId !== column_id) {
      const { rows: oldColumnCards } = await db.query(
        'SELECT id FROM cards WHERE column_id = $1 ORDER BY position',
        [oldColumnId]
      );
      oldColumnCardOrder = oldColumnCards.map(c => c.id);
    }

    // Broadcast the move with canonical state
    broadcast('cardMoved', {
      card: canonicalCard,
      column_id: column_id,
      old_column_id: oldColumnId,
      card_order: cardOrder,
      old_column_card_order: oldColumnCardOrder
    });

    res.json({
      card: canonicalCard,
      card_order: cardOrder,
      old_column_card_order: oldColumnCardOrder
    });
  } catch (err) {
    console.error('Error moving card:', err);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

// GET /api/stream - SSE endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial heartbeat
  res.write(': connected\n\n');

  const conn = res;
  sseConnections.add(conn);

  // Handle client disconnect
  req.on('close', () => {
    sseConnections.delete(conn);
  });

  // Keep-alive: send periodic comments
  const interval = setInterval(() => {
    try {
      conn.write(': heartbeat\n\n');
    } catch (e) {
      clearInterval(interval);
      sseConnections.delete(conn);
    }
  }, 15000);

  // Cleanup on close
  res.on('finish', () => {
    clearInterval(interval);
    sseConnections.delete(conn);
  });
});

// Initialize database and start server
initDatabase().then(() => {
  console.log('Database initialized');
  app.listen(PORT, () => {
    console.log(`Kanban backend running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
