import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

const app = express();
app.use(cors());
app.use(express.json());

let db;
const clients = new Set();

async function initDb() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }

  db = new PGlite(DATA_DIR);
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position DOUBLE PRECISION NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT REFERENCES columns(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      position DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const { rows: columns } = await db.query('SELECT COUNT(*) as count FROM columns');
  if (parseInt(columns[0].count) === 0) {
    await db.query(`
      INSERT INTO columns (id, title, position) VALUES
      ('col-1', 'To Do', 10),
      ('col-2', 'In Progress', 20),
      ('col-3', 'Done', 30);
    `);
    console.log('Seeded default columns');
  }
}

function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload });
  for (const client of clients) {
    client.write(`data: ${message}\n\n`);
  }
}

// 2.4 Get board state
app.get('/api/board', async (req, res) => {
  try {
    const { rows: columns } = await db.query('SELECT * FROM columns ORDER BY position ASC');
    const columnsWithCards = await Promise.all(columns.map(async (col) => {
      const { rows: cards } = await db.query(
        'SELECT * FROM cards WHERE column_id = $1 ORDER BY position ASC',
        [col.id]
      );
      return { ...col, cards };
    }));
    res.json(columnsWithCards);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

// 3.3 SSE endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  clients.add(res);

  req.on('close', () => {
    clients.delete(res);
  });
});

// 3.1 Create card
app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  if (!columnId || !text) {
    return res.status(400).send('Missing columnId or text');
  }

  try {
    const id = crypto.randomUUID();
    
    const { rows: lastCard } = await db.query(
      'SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1',
      [columnId]
    );
    
    let position = 100; 
    if (lastCard.length > 0) {
      position = lastCard[0].position + 10;
    }

    await db.query(
      'INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4)',
      [id, columnId, text, position]
    );

    const newCard = { id, columnId, text, position };
    broadcast('CARD_CREATED', newCard);

    res.status(201).json(newCard);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

// Helper to renormalize a column and return all its cards
async function renormalizeColumn(columnId) {
  const { rows: cards } = await db.query(
    'SELECT * FROM cards WHERE column_id = $1 ORDER BY position ASC',
    [columnId]
  );
  
  for (let i = 0; i < cards.length; i++) {
    await db.query(
      'UPDATE cards SET position = $1 WHERE id = $2',
      [i * 10, cards[i].id]
    );
  }

  const { rows: updatedCards } = await db.query(
    'SELECT * FROM cards WHERE column_id = $1 ORDER BY position ASC',
    [columnId]
  );
  return updatedCards;
}

// 3.2 Move card
app.patch('/api/cards/:id/move', async (req, res) => {
  const { id } = req.params;
  const { columnId, beforeId, afterId } = req.body;

  try {
    await db.query('BEGIN');

    const { rows: currentCardRows } = await db.query('SELECT column_id FROM cards WHERE id = $1', [id]);
    if (currentCardRows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).send('Card not found');
    }

    // 1. Calculate new position
    let newPosition = 50; 

    if (beforeId && afterId) {
      const { rows: beforeCard } = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
      const { rows: afterCard } = await db.query('SELECT position FROM cards WHERE id = $2', [afterId]);
      if (beforeCard.length > 0 && afterCard.length > 0) {
        newPosition = (beforeCard[0].position + afterCard[0].position) / 2;
      } else if (beforeCard.length > 0) {
        newPosition = beforeCard[0].position - 5;
      } else if (afterCard.length > 0) {
        newPosition = afterCard[0].position + 5;
      }
    } else if (beforeId) {
      const { rows: beforeCard } = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
      if (beforeCard.length > 0) {
        newPosition = beforeCard[0].position - 5;
      }
    } else if (afterId) {
      const { rows: afterCard } = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);
      if (afterCard.length > 0) {
        newPosition = afterCard[0].position + 5;
      }
    } else {
      const { rows: lastCard } = await db.query(
        'SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1',
        [columnId]
      );
      if (lastCard.length > 0) {
        newPosition = lastCard[0].position + 10;
      }
    }

    // 2. Update the card
    await db.query(
      'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3',
      [columnId, newPosition, id]
    );

    // 3. Check for collision/precision issues
    const { rows: collisionCheck } = await db.query(
      'SELECT id FROM cards WHERE column_id = $1 AND position = $2 AND id != $3',
      [columnId, newPosition, id]
    );

    if (collisionCheck.length > 0) {
      await renormalizeColumn(columnId);
      const { rows: updatedCards } = await db.query(
        'SELECT * FROM cards WHERE column_id = $1 ORDER BY position ASC',
        [columnId]
      );
      await db.query('COMMIT');
      broadcast('COLUMN_UPDATED', { columnId, cards: updatedCards });
      const { rows: card } = await db.query('SELECT * FROM cards WHERE id = $1', [id]);
      return res.json(card[0]);
    }

    await db.query('COMMIT');

    const { rows: updatedCardRows } = await db.query(
      'SELECT * FROM cards WHERE id = $1',
      [id]
    );
    const updatedCard = updatedCardRows[0];
    
    broadcast('CARD_MOVED', updatedCard);
    res.json(updatedCard);

  } catch (err) {
    await db.query('ROLLBACK');
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

const PORT = 3001;

async function startServer() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
