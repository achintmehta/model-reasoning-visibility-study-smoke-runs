const express = require('express');
const cors = require('cors');
const { PGlite } = require('@electric-sql/pglite');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize PGLite with persistent storage
const pg = new PGlite({ location: './data' });

// Database initialization
async function initDatabase() {
  console.log('Initializing database...');
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT NOT NULL,
      text TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS cards_column_id_idx ON cards(column_id);
    CREATE INDEX IF NOT EXISTS cards_position_idx ON cards(column_id, position);
  `);

  // Seed default columns if empty
  const columns = await pg.query('SELECT COUNT(*) as count FROM columns');
  if (columns.rows[0].count === '0') {
    await pg.exec(`
      INSERT INTO columns (id, title, position) VALUES
        ('todo', 'To Do', 0),
        ('in-progress', 'In Progress', 1),
        ('done', 'Done', 2)
    `);
    console.log('Default columns seeded');
  }

  console.log('Database initialized successfully');
}

// Helper: Get all columns with their cards ordered by position
async function getBoardState() {
  const result = await pg.query(`
    SELECT 
      c.*,
      jsonb_agg(
        jsonb_build_object(
          'id', card.id,
          'column_id', card.column_id,
          'text', card.text,
          'position', card.position,
          'created_at', card.created_at
        )
        ORDER BY card.position ASC
      ) as cards
    FROM columns c
    LEFT JOIN cards card ON c.id = card.column_id
    GROUP BY c.id, c.title, c.position
    ORDER BY c.position ASC
  `);

  return result.rows.map(row => ({
    id: row.id,
    title: row.title,
    position: row.position,
    cards: row.cards || []
  }));
}

// Helper: Get a card by ID
async function getCard(id) {
  const result = await pg.query(`SELECT * FROM cards WHERE id = '${id}'`);
  return result.rows[0] || null;
}

// Helper: Get position value between two cards
async function getCardPositionBetween(cardId, beforeId, afterId) {
  if (!beforeId && !afterId) {
    // Insert at position 0 (beginning)
    return 0;
  }

  if (beforeId && !afterId) {
    // Insert before the first card
    const result = await pg.query(`
      SELECT MIN(position) as min_pos FROM cards 
      WHERE column_id = (SELECT column_id FROM cards WHERE id = '${cardId}')
    `);
    return result.rows[0].min_pos - 1;
  }

  if (!beforeId && afterId) {
    // Insert after the last card
    const result = await pg.query(`
      SELECT MAX(position) as max_pos FROM cards 
      WHERE column_id = (SELECT column_id FROM cards WHERE id = '${cardId}')
    `);
    return result.rows[0].max_pos + 1;
  }

  // Insert between beforeId and afterId
  const result = await pg.query(`
    SELECT 
      CASE 
        WHEN '${beforeId}' IS NULL THEN (SELECT MAX(position) + 1 FROM cards WHERE column_id = (SELECT column_id FROM cards WHERE id = '${cardId}'))
        ELSE (SELECT position FROM cards WHERE id = '${beforeId}')
      END as position
  `);

  return result.rows[0].position;
}

// API: Get board state
app.get('/api/board', async (req, res) => {
  try {
    const board = await getBoardState();
    res.json(board);
  } catch (error) {
    console.error('Error getting board state:', error);
    res.status(500).json({ error: 'Failed to get board state' });
  }
});

// API: Create a card
app.post('/api/cards', async (req, res) => {
  try {
    const { columnId, text } = req.body;

    if (!columnId || !text) {
      return res.status(400).json({ error: 'columnId and text are required' });
    }

    const cardId = `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const position = await getCardPositionBetween(cardId, null, null);

    await pg.exec(`INSERT INTO cards (id, column_id, text, position) VALUES ('${cardId}', '${columnId}', '${text}', ${position})`);

    const card = await getCard(cardId);
    broadcast({ type: 'create', card });
    res.json(card);
  } catch (error) {
    console.error('Error creating card:', error);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

// API: Move a card
app.patch('/api/cards/:id/move', async (req, res) => {
  try {
    const { id } = req.params;
    const { columnId, beforeId, afterId } = req.body;

    const card = await getCard(id);

    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }

    // Check if target column is valid
    const columnExists = await pg.query(`SELECT id FROM columns WHERE id = '${columnId}'`);
    if (columnExists.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid column ID' });
    }

    // Calculate new position
    const newPosition = await getCardPositionBetween(id, beforeId, afterId);

    // Update card in transaction
    await pg.exec(`UPDATE cards SET column_id = '${columnId}', position = ${newPosition} WHERE id = '${id}'`);

    const updatedCard = await getCard(id);
    broadcast({ type: 'move', card: updatedCard });
    res.json(updatedCard);
  } catch (error) {
    console.error('Error moving card:', error);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

// SSE Endpoint
const clients = new Set();

app.get('/api/stream', (req, res) => {
  req.on('close', () => {
    clients.delete(res);
  });

  clients.add(res);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
});

// Broadcast function
function broadcast(event) {
  const data = JSON.stringify(event);
  clients.forEach(client => {
    client.write(`data: ${data}\n\n`);
  });
}

// Handle position collisions and normalization
async function handleCollision(columnId) {
  const result = await pg.query(`
    SELECT COUNT(*) as count, MIN(position) as min_pos, MAX(position) as max_pos
    FROM cards 
    WHERE column_id = '${columnId}'
  `);

  const { count, min_pos, max_pos } = result.rows[0];

  // Check for collisions or excessive gaps
  if (count > 0 && (min_pos < 0 || max_pos >= count * 2)) {
    await pg.exec(`
      UPDATE cards 
      SET position = (ROW_NUMBER() OVER (PARTITION BY column_id ORDER BY position ASC) - 1)
      WHERE column_id = '${columnId}'
    `);

    const updatedCards = await pg.query(`
      SELECT * FROM cards WHERE column_id = '${columnId}' ORDER BY position ASC
    `);

    broadcast({ type: 'normalize', columnId, cards: updatedCards.rows });
    return true;
  }

  return false;
}

// Heartbeat to keep SSE connections alive
setInterval(() => {
  clients.forEach(client => {
    client.write(': heartbeat\n\n');
  });
}, 30000);

// Initialize and start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize server:', err);
  process.exit(1);
});
