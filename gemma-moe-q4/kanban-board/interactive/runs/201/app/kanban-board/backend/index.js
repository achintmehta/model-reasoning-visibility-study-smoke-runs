import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR);
}

const db = new PGlite(DB_DIR);

// SSE management
let clients = [];

const broadcast = (type, data) => {
  clients.forEach(client => {
    client.res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  });
};

async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position DOUBLE PRECISION NOT NULL
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT REFERENCES columns(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      position DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const colCount = await db.query('SELECT COUNT(*) FROM columns');
  if (parseInt(colCount.rows[0].count) === 0) {
    await db.query(`
      INSERT INTO columns (id, title, position) VALUES
      ('col-1', 'To Do', 1.0),
      ('col-2', 'In Progress', 2.0),
      ('col-3', 'Done', 3.0);
    `);
    console.log('Seeded columns');
  }
}

await initDb();

// API Endpoints

app.get('/api/board', async (req, res) => {
  try {
    const columns = await db.query('SELECT * FROM columns ORDER BY position ASC');
    const cards = await db.query('SELECT * FROM cards ORDER BY position ASC');

    const board = columns.rows.map(col => ({
      ...col,
      cards: cards.rows.filter(card => card.column_id === col.id)
    }));

    res.json(board);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching board');
  }
});

app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  if (!columnId || !text) return res.status(400).send('Missing columnId or text');

  try {
    const lastCard = await db.query(
      'SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1',
      [columnId]
    );
    
    let newPosition = 1.0;
    if (lastCard.rows.length > 0) {
      newPosition = lastCard.rows[0].position + 1.0;
    }

    const id = `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await db.query(
      'INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4)',
      [id, columnId, text, newPosition]
    );

    const newCard = { id, column_id: columnId, text, position: newPosition };
    
    broadcast('CARD_CREATED', newCard);
    res.status(201).json(newCard);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating card');
  }
});

app.patch('/api/cards/:id/move', async (req, res) => {
  const { id } = req.params;
  const { columnId, beforeId, afterId } = req.body;

  try {
    let updatedCard;

    await db.transaction(async (tx) => {
      const cardResult = await tx.query('SELECT column_id, position FROM cards WHERE id = $1', [id]);
      if (cardResult.rows.length === 0) throw new Error('Card not found');
      
      let newPosition;
      if (beforeId && afterId) {
        const beforeResult = await tx.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
        const afterResult = await tx.query('SELECT position FROM cards WHERE id = $1', [afterId]);
        if (beforeResult.rows.length === 0 || afterResult.rows.length === 0) throw new Error('Invalid beforeId or afterId');
        newPosition = (beforeResult.rows[0].position + afterResult.rows[0].position) / 2;
      } else if (beforeId) {
        const beforeResult = await tx.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
        if (beforeResult.rows.length === 0) throw new Error('Invalid beforeId');
        newPosition = beforeResult.rows[0].position + 1.0;
      } else if (afterId) {
        const afterResult = await tx.query('SELECT position FROM cards WHERE id = $1', [afterId]);
        if (afterResult.rows.length === 0) throw new Error('Invalid afterId');
        newPosition = afterResult.rows[0].position - 1.0;
      } else {
        const lastCard = await tx.query(
          'SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1',
          [columnId]
        );
        newPosition = lastCard.rows.length > 0 ? lastCard.rows[0].position + 1.0 : 1.0;
      }

      await tx.query(
        'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3',
        [columnId, newPosition, id]
      );

      const collisionCheck = await tx.query(
        'SELECT id FROM cards WHERE column_id = $1 AND position = $2',
        [columnId, newPosition]
      );
      
      if (collisionCheck.rows.length > 1) {
          const allCards = await tx.query(
              'SELECT id, text FROM cards WHERE column_id = $1 ORDER BY position ASC',
              [columnId]
          );
          for (let i = 0; i < allCards.rows.length; i++) {
              await tx.query(
                  'UPDATE cards SET position = $1 WHERE id = $2',
                  [i + 1.0, allCards.rows[i].id]
              );
          }
          const finalCardResult = await tx.query('SELECT id, column_id, text, position FROM cards WHERE id = $1', [id]);
          updatedCard = finalCardResult.rows[0];
      } else {
          const cardDetails = await tx.query('SELECT text FROM cards WHERE id = $1', [id]);
          updatedCard = { id, column_id: columnId, text: cardDetails.rows[0].text, position: newPosition };
      }
    });

    broadcast('CARD_MOVED', updatedCard);
    res.json(updatedCard);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error moving card: ' + err.message);
  }
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  clients.push(newClient);

  console.log(`Client ${clientId} connected`);

  req.on('close', () => {
    console.log(`Client ${clientId} disconnected`);
    clients = clients.filter(c => c.id !== clientId);
  });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
