const express = require('express');
const cors = require('cors');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// PGLite instance
let db = null;

// SSE connections
const sseConnections = [];

// ==================== Database Setup ====================

const DATA_DIR = path.join(__dirname, '..', 'data');

async function initDatabase() {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = await PGlite.create({
    dataDir: DATA_DIR,
  });

  // Create tables
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default columns if empty
  const existing = await db.query('SELECT COUNT(*) AS count FROM columns');
  if (parseInt(existing.rows[0].count) === 0) {
    const colIds = [
      { id: 'col-todo', title: 'To Do', position: 1 },
      { id: 'col-progress', title: 'In Progress', position: 2 },
      { id: 'col-done', title: 'Done', position: 3 },
    ];

    for (const col of colIds) {
      await db.query(
        'INSERT INTO columns (id, title, position) VALUES ($1, $2, $3)',
        [col.id, col.title, col.position]
      );
    }
  }
}

// ==================== SSE Helpers ====================

function broadcast(eventData) {
  const dataStr = JSON.stringify(eventData);
  for (let i = sseConnections.length - 1; i >= 0; i--) {
    const res = sseConnections[i];
    try {
      res.write(`data: ${dataStr}\n\n`);
    } catch (err) {
      sseConnections.splice(i, 1);
    }
  }
}

function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.write('event: connected\ndata: {"type":"connected"}\n\n');
  sseConnections.push(res);
  res.on('close', () => {
    const idx = sseConnections.indexOf(res);
    if (idx !== -1) {
      sseConnections.splice(idx, 1);
    }
  });
}

// ==================== Position Helpers ====================

async function computeNewPosition(tx, columnId, beforeId, afterId, cardId) {
  // Get all cards in the target column ordered by position, excluding the card being moved
  const allCards = await tx.query(
    'SELECT id, position FROM cards WHERE column_id = $1 AND id != $2 ORDER BY position',
    [columnId, cardId]
  );

  const cards = allCards.rows;

  if (cards.length === 0) {
    return 1;
  }

  if (beforeId && afterId) {
    const beforeCard = cards.find(c => c.id === beforeId);
    const afterCard = cards.find(c => c.id === afterId);
    if (beforeCard && afterCard) {
      return (beforeCard.position + afterCard.position) / 2;
    }
    // If one of them doesn't exist in this column, fall through
  }

  if (beforeId) {
    const beforeCard = cards.find(c => c.id === beforeId);
    if (beforeCard) {
      const idx = cards.findIndex(c => c.id === beforeId);
      if (idx > 0) {
        const prevCard = cards[idx - 1];
        return (prevCard.position + beforeCard.position) / 2;
      }
      // It's the first card, insert before it
      return beforeCard.position - 1;
    }
  }

  if (afterId) {
    const afterCard = cards.find(c => c.id === afterId);
    if (afterCard) {
      const idx = cards.findIndex(c => c.id === afterId);
      if (idx < cards.length - 1) {
        const nextCard = cards[idx + 1];
        return (afterCard.position + nextCard.position) / 2;
      }
      // It's the last card, insert after it
      return afterCard.position + 1;
    }
  }

  // Default: insert at the end
  return cards[cards.length - 1].position + 1;
}

async function renormalizeColumn(tx, columnId) {
  const result = await tx.query(
    'SELECT id FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );

  const cards = result.rows;
  if (cards.length === 0) return;

  for (let i = 0; i < cards.length; i++) {
    const pos = (i + 1) * 1.0;
    await tx.query(
      'UPDATE cards SET position = $1 WHERE id = $2',
      [pos, cards[i].id]
    );
  }
}

async function getFullBoardState() {
  const columnsResult = await db.query(
    'SELECT id, title, position FROM columns ORDER BY position'
  );

  const columns = columnsResult.rows.map(col => ({
    id: col.id,
    title: col.title,
    position: col.position,
    cards: [],
  }));

  const cardsResult = await db.query(
    'SELECT id, column_id, text, position, created_at FROM cards ORDER BY column_id, position'
  );

  for (const card of cardsResult.rows) {
    const column = columns.find(c => c.id === card.column_id);
    if (column) {
      column.cards.push({
        id: card.id,
        text: card.text,
        position: card.position,
        created_at: card.created_at,
      });
    }
  }

  return { columns };
}

// ==================== API Routes ====================

// GET /api/board
app.get('/api/board', async (req, res) => {
  try {
    const board = await getFullBoardState();
    res.json(board);
  } catch (err) {
    console.error('Error fetching board:', err);
    res.status(500).json({ error: 'Failed to fetch board' });
  }
});

// POST /api/cards
app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;

  if (!columnId || !text) {
    return res.status(400).json({ error: 'columnId and text are required' });
  }

  try {
    const cardId = `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    let position;
    await db.transaction(async (tx) => {
      const maxResult = await tx.query(
        'SELECT COALESCE(MAX(position), 0) AS maxPos FROM cards WHERE column_id = $1',
        [columnId]
      );
      position = parseFloat(maxResult.rows[0].maxPos) + 1;

      await tx.query(
        'INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4)',
        [cardId, columnId, text, position]
      );
    });

    const card = {
      id: cardId,
      text,
      column_id: columnId,
      position,
      created_at: new Date().toISOString(),
    };

    broadcast({
      type: 'card_created',
      card,
      columnId,
    });

    res.json(card);
  } catch (err) {
    console.error('Error creating card:', err);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

// PATCH /api/cards/:id/move
app.patch('/api/cards/:id/move', async (req, res) => {
  const { id } = req.params;
  const { columnId, beforeId, afterId } = req.body;

  if (!columnId) {
    return res.status(400).json({ error: 'columnId is required' });
  }

  try {
    // Verify card exists
    const cardResult = await db.query(
      'SELECT * FROM cards WHERE id = $1',
      [id]
    );

    if (cardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    let renormalized = false;

    // Atomic transaction
    await db.transaction(async (tx) => {
      const newPosition = await computeNewPosition(tx, columnId, beforeId, afterId, id);

      await tx.query(
        'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3',
        [columnId, newPosition, id]
      );

      // Check for collisions
      const allCards = await tx.query(
        'SELECT id, position FROM cards WHERE column_id = $1 ORDER BY position',
        [columnId]
      );

      let needsRenorm = false;
      for (let i = 0; i < allCards.rows.length - 1; i++) {
        const current = allCards.rows[i];
        const next = allCards.rows[i + 1];
        if (Math.abs(next.position - current.position) < 0.001) {
          needsRenorm = true;
          break;
        }
      }

      if (needsRenorm) {
        await renormalizeColumn(tx, columnId);
        renormalized = true;
      }
    });

    // Get the updated card
    const updatedCardResult = await db.query(
      'SELECT * FROM cards WHERE id = $1',
      [id]
    );

    const updatedCard = updatedCardResult.rows[0];

    // Broadcast
    if (renormalized) {
      const board = await getFullBoardState();
      broadcast({
        type: 'renormalized',
        columns: board.columns,
      });
    } else {
      broadcast({
        type: 'card_moved',
        card: {
          id: updatedCard.id,
          text: updatedCard.text,
          column_id: columnId,
          position: updatedCard.position,
          created_at: updatedCard.created_at,
        },
        columnId,
      });
    }

    res.json({
      card: updatedCard,
      columnId,
    });
  } catch (err) {
    console.error('Error moving card:', err);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

// GET /api/stream - SSE endpoint
app.get('/api/stream', (req, res) => {
  setupSSE(res);
});

// ==================== Start Server ====================

async function start() {
  try {
    await initDatabase();
    console.log('Database initialized');

    app.listen(PORT, () => {
      console.log(`Kanban server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
