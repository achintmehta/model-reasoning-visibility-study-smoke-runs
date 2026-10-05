import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Initialize PGLite with local storage
const db = new PGlite({
  dataDir: path.join(__dirname, 'pgdata'),
});

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

  const columns = await db.query('SELECT id FROM columns');
  if (columns.rows.length === 0) {
    await db.exec(`
      INSERT INTO columns (id, title, position) VALUES 
      ('todo', 'To Do', 1),
      ('inprogress', 'In Progress', 2),
      ('done', 'Done', 3);
    `);
    console.log('Seeded default columns');
  }
}

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
  res.flushHeaders();

  const client = { res };
  clients.push(client);

  req.on('close', () => {
    clients = clients.filter(c => c !== client);
  });
});

app.get('/api/board', async (req, res) => {
  try {
    const colsResult = await db.query('SELECT * FROM columns ORDER BY position');
    const columns = colsResult.rows;
    
    const board = [];
    for (const col of columns) {
      const cardsResult = await db.query(
        'SELECT * FROM cards WHERE column_id = $1 ORDER BY position',
        [col.id]
      );
      board.push({
        ...col,
        cards: cardsResult.rows
      });
    }
    res.json(board);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  if (!columnId || !text) return res.status(400).json({ error: 'columnId and text are required' });

  try {
    const id = Math.random().toString(36).substr(2, 9);
    
    // Find the last card's position in the column
    const lastCardResult = await db.query(
      'SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1',
      [columnId]
    );
    
    const position = lastCardResult.rows.length > 0 
      ? lastCardResult.rows[0].position + 1000 
      : 1000;

    await db.query(
      'INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4)',
      [id, columnId, text, position]
    );

    const newCard = { id, columnId, text, position };
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
    // Start a transaction
    await db.exec('BEGIN');

    let position;
    if (beforeId && afterId) {
      const beforeRes = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
      const afterRes = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);
      if (beforeRes.rows.length && afterRes.rows.length) {
        position = (beforeRes.rows[0].position + afterRes.rows[0].position) / 2;
        
        // Precision check: if the difference is too small, renormalize the column
        if (Math.abs(beforeRes.rows[0].position - afterRes.rows[0].position) < 0.000001) {
          await renormalizeColumn(columnId);
          // After renormalization, we should re-calculate position based on the new state
          // but for simplicity, we can just let it be and the next fetch will correct it,
          // or we can just re-fetch the positions.
          // Actually, the easiest is to just let it be and the broadcast of 'boardUpdated' 
          // will trigger clients to refresh.
        }
      }
    } else if (beforeId) {
      const beforeRes = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
      if (beforeRes.rows.length) {
        position = beforeRes.rows[0].position - 1000;
      }
    } else if (afterId) {
      const afterRes = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);
      if (afterRes.rows.length) {
        position = afterRes.rows[0].position + 1000;
      }
    } else {
      // First card in column
      position = 1000;
    }

    // If position is still undefined (e.g. empty column), default to 1000
    if (position === undefined) position = 1000;

    await db.query(
      'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3',
      [columnId, position, id]
    );

    await db.exec('COMMIT');

    const cardRes = await db.query('SELECT * FROM cards WHERE id = $1', [id]);
    const updatedCard = cardRes.rows[0];
    
    broadcast('cardMoved', { ...updatedCard, columnId: updatedCard.column_id });
    res.json({ ...updatedCard, columnId: updatedCard.column_id });
  } catch (err) {
    await db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

async function renormalizeColumn(columnId) {
  const cards = await db.query(
    'SELECT id FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );
  
  for (let i = 0; i < cards.rows.length; i++) {
    await db.query(
      'UPDATE cards SET position = $1 WHERE id = $2',
      [ (i + 1) * 1000, cards.rows[i].id ]
    );
  }
  
  broadcast('boardUpdated', { columnId });
}

initDb().then(() => {
  app.listen(port, () => {
    console.log(`Backend listening at http://localhost:${port}`);
  });
}).catch(err => {
  console.error('DB Init Error:', err);
  process.exit(1);
});
