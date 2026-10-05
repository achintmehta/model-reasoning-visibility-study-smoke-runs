import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';
import path from 'path';
import fs from 'fs';

const app = express();
app.use(cors());
app.use(express.json());

const DB_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR);
}

const db = new PGlite(DB_DIR);

const clients = new Set();

async function broadcast(event, data) {
  const payload = JSON.stringify({ event, data });
  for (const res of clients) {
    try {
      res.write(`data: ${payload}\\n\\n`);
    } catch (err) {
      console.error('Error broadcasting to a client', err);
    }
  }
}

async function initDb() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT REFERENCES columns(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      position REAL NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const colCount = await db.query('SELECT COUNT(*) as count FROM columns');
  if (parseInt(colCount.rows[0].count) === 0) {
    await db.exec(`
      INSERT INTO columns (id, title, position) VALUES 
      ('col-1', 'To Do', 1.0),
      ('col-2', 'In Progress', 2.0),
      ('col-3', 'Done', 3.0);
    `);
  }
}

app.get('/api/board', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        c.id as col_id, c.title as col_title, c.position as col_position,
        card.id as card_id, card.text as card_text, card.position as card_position
      FROM columns c
      LEFT JOIN cards card ON c.id = card.column_id
      ORDER BY c.position, card.position;
    `);

    const columnsMap = {};
    result.rows.forEach(row => {
      if (!columnsMap[row.col_id]) {
        columnsMap[row.col_id] = {
          id: row.col_id,
          title: row.col_title,
          position: row.col_position,
          cards: []
        };
      }
      if (row.card_id) {
        columnsMap[row.col_id].cards.push({
          id: row.card_id,
          text: row.card_text,
          position: row.card_position
        });
      }
    });

    res.json(Object.values(columnsMap).sort((a, b) => a.position - b.position));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  if (!columnId || !text) return res.status(400).json({ error: 'Missing columnId or text' });

  const id = `card-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  try {
    await db.transaction(async (tx) => {
      const lastCard = await tx.query(
        'SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1',
        [columnId]
      );
      
      let position = 1.0;
      if (lastCard.rows.length > 0) {
        position = parseFloat(lastCard.rows[0].position) + 1.0;
      }

      await tx.query(
        'INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4)',
        [id, columnId, text, position]
      );
    });

    const cardRes = await db.query('SELECT * FROM cards WHERE id = $1', [id]);
    const newCard = cardRes.rows[0];
    
    await broadcast('card_created', {
      id: newCard.id,
      columnId: newCard.column_id,
      text: newCard.text,
      position: newCard.position
    });

    res.status(201).json({
      id: newCard.id,
      columnId: newCard.column_id,
      text: newCard.text,
      position: newCard.position
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/cards/:id/move', async (req, res) => {
  const { id } = req.params;
  const { columnId, beforeId, afterId } = req.body;

  try {
    await db.transaction(async (tx) => {
      const cardRes = await tx.query('SELECT column_id FROM cards WHERE id = $1', [id]);
      if (cardRes.rows.length === 0) throw new Error('Card not found');
      
      let minPos = 0;
      let maxPos = Infinity;

      if (afterId) {
        const aRes = await tx.query('SELECT position FROM cards WHERE id = $1', [afterId]);
        if (aRes.rows.length > 0) minPos = parseFloat(aRes.rows[0].position);
      }
      if (beforeId) {
        const bRes = await tx.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
        if (bRes.rows.length > 0) maxPos = parseFloat(bRes.rows[0].position);
      }

      let newPosition;
      if (minPos === maxPos || maxPos === Infinity) {
        newPosition = minPos + 1.0;
      } else {
        newPosition = (minPos + maxPos) / 2;
      }

      await tx.query(
        'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3',
        [columnId, newPosition, id]
      );

      const cards = await tx.query(
        'SELECT id, position FROM cards WHERE column_id = $1 ORDER BY position ASC',
        [columnId]
      );
      
      let needsRenormalization = false;
      for (let i = 1; i < cards.rows.length; i++) {
        if (parseFloat(cards.rows[i].position) - parseFloat(cards.rows[i-1].position) < 0.000001) {
          needsRenormalization = true;
          break;
        }
      }

      if (needsRenormalization) {
        for (let i = 0; i < cards.rows.length; i++) {
          await tx.exec('UPDATE cards SET position = $1 WHERE id = $2', [i + 1.0, cards.rows[i].id]);
        }
        const updatedCards = await tx.query('SELECT id, text, position FROM cards WHERE column_id = $1 ORDER BY position ASC', [columnId]);
        await broadcast('column_updated', {
          columnId,
          cards: updatedCards.rows.map(r => ({ id: r.id, text: r.text, position: r.position }))
        });
      }
    });

    const cardRes = await db.query('SELECT * FROM cards WHERE id = $1', [id]);
    const updatedCard = cardRes.rows[0];

    await broadcast('card_moved', {
      id: updatedCard.id,
      columnId: updatedCard.column_id,
      text: updatedCard.text,
      position: updatedCard.position
    });

    res.json({
      id: updatedCard.id,
      columnId: updatedCard.column_id,
      text: updatedCard.text,
      position: updatedCard.position
    });
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

const PORT = 3000;
app.listen(PORT, async () => {
  await initDb();
  console.log(`Server listening on port ${PORT}`);
});
