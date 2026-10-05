import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

const db = new PGlite(path.join(DATA_DIR, 'kanban.db'));

// SSE management
const clients = new Set();

async function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.write(message);
  }
}

async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS columns (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      position DOUBLE PRECISION NOT NULL
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id SERIAL PRIMARY KEY,
      column_id INTEGER REFERENCES columns(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      position DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed columns if empty
  const { rows: existingColumns } = await db.query('SELECT COUNT(*) FROM columns');
  if (parseInt(existingColumns[0].count) === 0) {
    await db.query(`INSERT INTO columns (title, position) VALUES ('To Do', 10.0);`);
    await db.query(`INSERT INTO columns (title, position) VALUES ('In Progress', 20.0);`);
    await db.query(`INSERT INTO columns (title, position) VALUES ('Done', 30.0);`);
  }
}

async function renormalizeColumn(tx, columnId) {
  const { rows: cards } = await tx.query(
    'SELECT id FROM cards WHERE column_id = $1 ORDER BY position ASC',
    [columnId]
  );
  
  let currentPos = 10.0;
  for (const card of cards) {
    await tx.query(
      'UPDATE cards SET position = $1 WHERE id = $2',
      [currentPos, card.id]
    );
    currentPos += 10.0;
  }
}

// API Endpoints

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

app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  if (!columnId || !text) {
    return res.status(400).send('Missing columnId or text');
  }

  try {
    const card = await db.transaction(async (tx) => {
      const { rows: lastCard } = await tx.query(
        'SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1',
        [columnId]
      );
      const newPosition = lastCard.length > 0 ? lastCard[0].position + 10.0 : 10.0;

      const { rows: newCard } = await tx.query(
        'INSERT INTO cards (column_id, text, position) VALUES ($1, $2, $3) RETURNING *',
        [columnId, text, newPosition]
      );
      return newCard[0];
    });

    await broadcast('card-created', card);
    res.json(card);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.patch('/api/cards/:id/move', async (req, res) => {
  const cardId = parseInt(req.params.id);
  const { columnId, beforeId, afterId } = req.body;

  if (!cardId || !columnId) {
    return res.status(400).send('Missing cardId or columnId');
  }

  try {
    const movedCard = await db.transaction(async (tx) => {
      const { rows: currentCardRows } = await tx.query(
        'SELECT column_id, position FROM cards WHERE id = $1',
        [cardId]
      );
      if (currentCardRows.length === 0) throw new Error('Card not found');
      const currentCard = currentCardRows[0];

      let newPosition;
      
      const getPos = async (id) => {
        if (!id) return null;
        const { rows: r } = await tx.query('SELECT position FROM cards WHERE id = $1', [id]);
        return r.length > 0 ? r[0].position : null;
      };

      const posBefore = await getPos(beforeId);
      const posAfter = await getPos(afterId);

      if (beforeId && afterId) {
        newPosition = (posBefore + posAfter) / 2;
      } else if (beforeId) {
        newPosition = posBefore - 1.0;
      } else if (afterId) {
        newPosition = posAfter + 1.0;
      } else {
        const { rows: lastCard } = await tx.query(
          'SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1',
          [columnId]
        );
        newPosition = lastCard.length > 0 ? lastCard[0].position + 10.0 : 10.0;
      }

      const { rows: updatedCard } = await tx.query(
        'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3 RETURNING *',
        [columnId, newPosition, cardId]
      );

      if (updatedCard.length === 0) throw new Error('Update failed');

      const { rows: collisionCheck } = await tx.query(
        'SELECT id FROM cards WHERE column_id = $1 AND position = $2',
        [columnId, newPosition]
      );
      
      if (collisionCheck.length > 1 || newPosition < 0.000001) {
        await renormalizeColumn(tx, columnId);
        const { rows: reFetchedCard } = await tx.query(
          'SELECT * FROM cards WHERE id = $1',
          [cardId]
        );
        return reFetchedCard[0];
      }

      return updatedCard[0];
    });

    await broadcast('card-moved', movedCard);
    res.json(movedCard);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  req.on('close', () => {
    clients.delete(res);
  });

  clients.add(res);
  res.write(': ok\n\n');
});

const PORT = 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initDb();
});
