import express from 'express';
import cors from 'cors';
import { PGLite } from '@electric-sql/pglite';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, 'data');

const app = express();
app.use(cors());
app.use(express.json());

let db;
const clients = new Set();

async function initDb() {
  try {
    await fs.access(DB_DIR);
  } catch {
    await fs.mkdir(DB_DIR, { recursive: true });
  }

  db = new PGLite(DB_DIR);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      position REAL NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_cards_column_position ON cards(column_id, position);
  `);

  const colCountRes = await db.query('SELECT COUNT(*) FROM columns');
  if (parseInt(colCountRes.rows[0].count) === 0) {
    await db.exec(`
      INSERT INTO columns (id, title, position) VALUES 
      ('col-1', 'To Do', 1000),
      ('col-2', 'In Progress', 2000),
      ('col-3', 'Done', 3000);
    `);
  }
}

async function broadcast(type, data) {
  const message = JSON.stringify({ type, data });
  for (const client of clients) {
    try {
      client.write(`data: ${message}\n\n`);
    } catch (err) {
      console.error('Error broadcasting to client:', err);
      clients.delete(client);
    }
  }
}

async function renormalizeColumn(columnId) {
  await db.transaction(async (tx) => {
    const cards = await tx.query(
      'SELECT id FROM cards WHERE column_id = $1 ORDER BY position ASC',
      [columnId]
    );
    
    for (let i = 0; i < cards.rows.length; i++) {
      const newPos = (i + 1) * 1000.0;
      await tx.query('UPDATE cards SET position = $1 WHERE id = $2', [newPos, cards.rows[i].id]);
    }
  });
}

app.get('/api/board', async (req, res) => {
  const columns = await db.query('SELECT * FROM columns ORDER BY position ASC');
  const cards = await db.query('SELECT * FROM cards ORDER BY position ASC');
  
  const board = columns.rows.map(col => ({
    ...col,
    cards: cards.rows.filter(card => card.column_id === col.id)
  }));
  
  res.json(board);
});

app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  if (!columnId || !text) {
    return res.status(400).json({ error: 'Missing columnId or text' });
  }

  const id = crypto.randomUUID();
  
  const lastCardRes = await db.query(
    'SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1',
    [columnId]
  );
  
  let position = 1000.0;
  if (lastCardRes.rows.length > 0) {
    position = lastCardRes.rows[0].position + 1000.0;
  }

  await db.query(
    'INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4)',
    [id, columnId, text, position]
  );

  const newCard = { id, column_id: columnId, text, position };
  
  await broadcast('card_created', newCard);
  
  res.status(201).json(newCard);
});

app.patch('/api/cards/:id/move', async (req, res) => {
  const { id } = req.params;
  const { columnId, beforeId, afterId } = req.body;

  try {
    await db.transaction(async (tx) => {
      const cardRes = await tx.query('SELECT column_id FROM cards WHERE id = $1', [id]);
      if (cardRes.rows.length === 0) {
        throw new Error('Card not found');
      }

      let newPosition = 0;

      if (!beforeId && !afterId) {
        newPosition = 1000.0; 
      } else if (beforeId && !afterId) {
        const beforeRes = await tx.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
        if (beforeRes.rows.length > 0) {
          newPosition = beforeRes.rows[0].position / 2;
        } else {
          newPosition = 1000.0;
        }
      } else if (!beforeId && afterId) {
        const afterRes = await tx.query('SELECT position FROM cards WHERE id = $1', [afterId]);
        if (afterRes.rows.length > 0) {
          newPosition = afterRes.rows[0].position + 1000.0;
        } else {
          newPosition = 1000.0;
        }
      } else {
        const afterRes = await tx.query('SELECT position FROM cards WHERE id = $1', [afterId]);
        const beforeRes = await tx.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
        
        if (afterRes.rows.length > 0 && beforeRes.rows.length > 0) {
          newPosition = (afterRes.rows[0].position + beforeRes.rows[0].position) / 2;
        } else if (afterRes.rows.length > 0) {
          newPosition = afterRes.rows[0].position + 1000.0;
        } else if (beforeRes.rows.length > 0) {
          newPosition = beforeRes.rows[0].position / 2;
        } else {
          newPosition = 1000.0;
        }
      }

      const collisionRes = await tx.query('SELECT id FROM cards WHERE column_id = $1 AND position = $2', [columnId, newPosition]);
      if (collisionRes.rows.length > 0) {
        newPosition += 0.00000001; 
      }

      await tx.query(
        'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3',
        [columnId, newPosition, id]
      );
      
      if (newPosition < 0.0001) {
        await renormalizeColumn(columnId);
      }
    });

    const updatedCardRes = await db.query('SELECT * FROM cards WHERE id = $1', [id]);
    const updatedCard = updatedCardRes.rows[0];
    
    await broadcast('card_moved', updatedCard);
    
    res.json(updatedCard);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  clients.add(res);
  req.on('close', () => {
    clients.delete(res);
  });
});

const PORT = 3001;
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to init DB:', err);
});
