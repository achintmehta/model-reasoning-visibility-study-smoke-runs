import express from 'express';
import cors from 'cors';
import * as pglite from '@electric-sql/pglite';
import path from 'path';
import crypto from 'crypto';

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Initialize PGLite with a local directory for persistence
const db = new pglite.PGlite('/tmp/pglite_data');

// Database initialization
async function initDb() {
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

  const { rows: columns } = await db.query('SELECT * FROM columns');
  if (columns.length === 0) {
    await db.exec(`
      INSERT INTO columns (id, title, position) VALUES 
      ('todo', 'To Do', 1),
      ('inprogress', 'In Progress', 2),
      ('done', 'Done', 3);
    `);
  }
}

await initDb();

// SSE setup
let clients = [];
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => client.res.write(payload));
}

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const client = { res };
  clients.push(client);

  req.on('close', () => {
    clients = clients.filter(c => c !== client);
  });
});

app.get('/api/board', async (req, res) => {
  try {
    const columnsResult = await db.query('SELECT * FROM columns ORDER BY position');
    const columns = columnsResult.rows;

    const board = await Promise.all(columns.map(async (col) => {
      const cardsResult = await db.query('SELECT * FROM cards WHERE column_id = $1 ORDER BY position', [col.id]);
      return {
        ...col,
        cards: cardsResult.rows
      };
    }));

    res.json(board);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  if (!columnId || !text) return res.status(400).json({ error: 'Missing columnId or text' });

  try {
    const cardId = crypto.randomUUID();
    
    // Find the last card's position in the column
    const lastCardResult = await db.query('SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1', [columnId]);
    const lastPosition = lastCardResult.rows.length > 0 ? lastCardResult.rows[0].position : 0;
    const position = lastPosition + 1000; // Simple spacing

    await db.query('INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4)', [cardId, columnId, text, position]);
    
    const newCard = { id: cardId, column_id: columnId, text, position };
    broadcast('cardCreated', newCard);
    res.status(201).json(newCard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/cards/:id/move', async (req, res) => {
  const { id } = req.params;
  const { columnId, beforeId, afterId } = req.body;

  try {
    // Atomic move using a transaction
    await db.exec('BEGIN');
    
    let newPosition;
    if (beforeId && afterId) {
      const beforeRes = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
      const afterRes = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);
      if (beforeRes.rows.length && afterRes.rows.length) {
        newPosition = (beforeRes.rows[0].position + afterRes.rows[0].position) / 2;
      }
    } else if (beforeId) {
      const beforeRes = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
      if (beforeRes.rows.length) {
        newPosition = beforeRes.rows[0].position - 1000;
      }
    } else if (afterId) {
      const afterRes = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);
      if (afterRes.rows.length) {
        newPosition = afterRes.rows[0].position + 1000;
      }
    } else {
      // Moving into empty column or first card
      const lastCardResult = await db.query('SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1', [columnId]);
      newPosition = lastCardResult.rows.length > 0 ? lastCardResult.rows[0].position + 1000 : 1000;
    }

    // Fallback for cases where beforeId/afterId were not found or both null
    if (newPosition === undefined) {
        const lastCardResult = await db.query('SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1', [columnId]);
        newPosition = lastCardResult.rows.length > 0 ? lastCardResult.rows[0].position + 1000 : 1000;
    }

    await db.query('UPDATE cards SET column_id = $1, position = $2 WHERE id = $3', [columnId, newPosition, id]);
    await db.exec('COMMIT');

    const cardResult = await db.query('SELECT * FROM cards WHERE id = $1', [id]);
    const updatedCard = cardResult.rows[0];
    
    broadcast('cardMoved', updatedCard);
    res.json(updatedCard);
  } catch (err) {
    await db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
