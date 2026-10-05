import express from 'express';
import cors from 'cors';
import { getDb, generateId } from './db.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// SSE connections management
const sseClients = new Set();

// Broadcast an event to all SSE clients
function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    if (client.readyState === 1) {
      try {
        client.write(message);
      } catch (e) {
        // Client may have disconnected
      }
    }
  }
}

// ---- Helper: Get board state as JSON ----

async function getBoardState(db) {
  const columnsRes = await db.query(
    'SELECT id, title, position FROM columns ORDER BY position'
  );

  const columns = columnsRes.rows.map((col) => ({
    id: col.id,
    title: col.title,
    position: parseFloat(col.position),
    cards: [],
  }));

  const cardsRes = await db.query(
    'SELECT id, column_id, text, position, created_at FROM cards ORDER BY column_id, position'
  );

  for (const card of cardsRes.rows) {
    const column = columns.find((c) => c.id === card.column_id);
    if (column) {
      column.cards.push({
        id: card.id,
        columnId: card.column_id,
        text: card.text,
        position: parseFloat(card.position),
        createdAt: card.created_at,
      });
    }
  }

  return columns;
}

// ---- Helper: Calculate end position for a column ----

async function getEndPosition(db, columnId, excludeCardId = null) {
  const query = excludeCardId
    ? 'SELECT COALESCE(MAX(position), 0) as max_pos FROM cards WHERE column_id = $1 AND id != $2'
    : 'SELECT COALESCE(MAX(position), 0) as max_pos FROM cards WHERE column_id = $1';
  const params = excludeCardId ? [columnId, excludeCardId] : [columnId];
  const res = await db.query(query, params);
  return parseFloat(res.rows[0].max_pos) + 50;
}

// ---- Helper: Renormalize a column's positions ----

async function renormalizeColumn(db, columnId) {
  const cardsRes = await db.query(
    'SELECT id, position FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );

  const cards = cardsRes.rows;
  if (cards.length === 0) return;

  const spacing = 100;
  const start = 50;

  for (let i = 0; i < cards.length; i++) {
    const newPos = start + i * spacing;
    await db.query(
      'UPDATE cards SET position = $1 WHERE id = $2 AND column_id = $3',
      [newPos, cards[i].id, columnId]
    );
  }
}

// ---- Board State Endpoint ----

app.get('/api/board', async (req, res) => {
  try {
    const db = await getDb();
    const columns = await getBoardState(db);
    res.json({ columns });
  } catch (err) {
    console.error('Error fetching board:', err);
    res.status(500).json({ error: 'Failed to fetch board' });
  }
});

// ---- Create Card Endpoint ----

app.post('/api/cards', async (req, res) => {
  try {
    const { columnId, text } = req.body;

    if (!columnId || !text) {
      return res.status(400).json({ error: 'columnId and text are required' });
    }

    const db = await getDb();

    // Check if column exists
    const columnRes = await db.query('SELECT id FROM columns WHERE id = $1', [columnId]);
    if (columnRes.rows.length === 0) {
      return res.status(404).json({ error: 'Column not found' });
    }

    // Calculate position: end of column
    const position = await getEndPosition(db, columnId);

    const cardId = generateId();
    const now = new Date().toISOString();

    await db.query(
      'INSERT INTO cards (id, column_id, text, position, created_at) VALUES ($1, $2, $3, $4, $5)',
      [cardId, columnId, text, position, now]
    );

    const card = {
      id: cardId,
      columnId,
      text,
      position,
      createdAt: now,
    };

    // Broadcast the new card
    broadcast('card-created', { card, columnId });

    res.json(card);
  } catch (err) {
    console.error('Error creating card:', err);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

// ---- Move Card Endpoint ----

app.patch('/api/cards/:id/move', async (req, res) => {
  try {
    const { id } = req.params;
    const { columnId, beforeId, afterId } = req.body;

    if (!columnId) {
      return res.status(400).json({ error: 'columnId is required' });
    }

    const db = await getDb();

    // Get the card's current state
    const cardRes = await db.query('SELECT * FROM cards WHERE id = $1', [id]);
    if (cardRes.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    const oldCard = cardRes.rows[0];
    const oldColumnId = oldCard.column_id;

    // Verify target column exists
    const columnRes = await db.query('SELECT id FROM columns WHERE id = $1', [columnId]);
    if (columnRes.rows.length === 0) {
      return res.status(404).json({ error: 'Target column not found' });
    }

    // Calculate the new position
    let newPosition;

    if (beforeId && afterId) {
      // Insert between two cards
      const beforeRes = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
      const afterRes = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);

      if (beforeRes.rows.length > 0 && afterRes.rows.length > 0) {
        newPosition = (parseFloat(beforeRes.rows[0].position) + parseFloat(afterRes.rows[0].position)) / 2;
      } else {
        newPosition = await getEndPosition(db, columnId, id);
      }
    } else if (beforeId) {
      // Insert before a specific card
      const beforeRes = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
      if (beforeRes.rows.length > 0) {
        newPosition = parseFloat(beforeRes.rows[0].position) / 2;
      } else {
        newPosition = await getEndPosition(db, columnId, id);
      }
    } else if (afterId) {
      // Insert after a specific card
      const afterRes = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);
      if (afterRes.rows.length > 0) {
        newPosition = parseFloat(afterRes.rows[0].position) + 50;
      } else {
        newPosition = await getEndPosition(db, columnId, id);
      }
    } else {
      // Append to end
      newPosition = await getEndPosition(db, columnId, id);
    }

    // Clamp position to reasonable range
    if (newPosition < 0) newPosition = 50;

    // Perform the move atomically
    await db.query(
      'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3',
      [columnId, newPosition, id]
    );

    // Check for position collisions and renormalize if needed
    const needsRenormalization = await checkAndRenormalize(db, columnId);

    const card = {
      id,
      columnId,
      text: oldCard.text,
      position: newPosition,
      createdAt: oldCard.created_at,
    };

    // Broadcast the move
    broadcast('card-moved', { card, columnId });

    if (needsRenormalization) {
      // Renormalize and broadcast the corrected order
      const normalizedColumns = await getBoardState(db);
      broadcast('columns-renormalized', { columns: normalizedColumns });
    }

    res.json(card);
  } catch (err) {
    console.error('Error moving card:', err);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

async function checkAndRenormalize(db, columnId) {
  // Get all cards in the column sorted by position
  const cardsRes = await db.query(
    'SELECT id, position FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );

  const cards = cardsRes.rows;
  if (cards.length === 0) return false;

  let needsRenormalization = false;

  // Check for precision exhaustion (positions too close together)
  for (let i = 1; i < cards.length; i++) {
    const diff = Math.abs(parseFloat(cards[i].position) - parseFloat(cards[i - 1].position));
    if (diff < 0.1) {
      needsRenormalization = true;
      break;
    }
  }

  // Check for negative positions
  for (const card of cards) {
    if (parseFloat(card.position) < 0) {
      needsRenormalization = true;
      break;
    }
  }

  if (needsRenormalization) {
    await renormalizeColumn(db, columnId);
  }

  return needsRenormalization;
}

// ---- SSE Endpoint ----

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Type',
  });

  // Send initial board state
  (async () => {
    try {
      const db = await getDb();
      const columns = await getBoardState(db);
      res.write(`event: columns-renormalized\ndata: ${JSON.stringify({ columns })}\n\n`);
    } catch (err) {
      console.error('Error sending initial state:', err);
    }
  })();

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// ---- Start Server ----

async function start() {
  // Initialize database
  await getDb();
  console.log('Database initialized');

  app.listen(PORT, () => {
    console.log(`Kanban board server running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
