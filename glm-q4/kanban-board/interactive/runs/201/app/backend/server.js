import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';

const app = express();
const PORT = 3001;
const pg = new PGlite('./data');

// Middleware
app.use(cors());
app.use(express.json());

// Database initialization
async function initDatabase() {
  console.log('Initializing database...');

  // Drop tables if they exist to ensure clean state
  await pg.exec('DROP TABLE IF EXISTS cards, CASCADE');
  await pg.exec('DROP TABLE IF EXISTS columns, CASCADE');

  await pg.exec(`
    CREATE TABLE columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position INTEGER NOT NULL
    );

    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      column_id TEXT NOT NULL,
      text TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX cards_column_id_idx ON cards(column_id);
    CREATE INDEX cards_position_idx ON cards(column_id, position);
  `);

  // Seed default columns
  await pg.exec(`
    INSERT INTO columns (id, title, position) VALUES
      ('todo', 'To Do', 0),
      ('in-progress', 'In Progress', 1),
      ('done', 'Done', 2)
  `);

  console.log('Database initialized successfully');
}

// Helper: Get all columns with their cards ordered by position
async function getBoardState() {
  const result = await pg.query(`
    SELECT 
      c.id,
      c.title,
      c.position,
      CASE
        WHEN COUNT(card.id) = 0 THEN '[]'::jsonb
        ELSE jsonb_agg(
          jsonb_build_object(
            'id', card.id,
            'column_id', card.column_id,
            'text', card.text,
            'position', card.position,
            'created_at', card.created_at
          )
          ORDER BY card.position ASC
        )
      END as cards
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
    // Insert at the end (after the last card)
    const result = await pg.query(`
      SELECT COALESCE(MAX(position), -1) + 1 as max_pos FROM cards
      WHERE column_id = (SELECT column_id FROM cards WHERE id = '${cardId}')
    `);
    return result.rows[0].max_pos;
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
    SELECT position FROM cards WHERE id = '${afterId}'
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

    await pg.exec(`
      INSERT INTO cards (id, column_id, text, position)
      VALUES ('${cardId}', '${columnId}', '${text.replace(/'/g, "''")}', ${position})
    `);

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

    const [card, targetColumnCards] = await Promise.all([
      getCard(id),
      pg.query(`SELECT * FROM cards WHERE column_id = '${columnId}' ORDER BY position ASC`)
    ]);

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

    // Update card
    await pg.exec(`
      UPDATE cards 
      SET column_id = '${columnId}', position = ${newPosition}
      WHERE id = '${id}'
    `);

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
