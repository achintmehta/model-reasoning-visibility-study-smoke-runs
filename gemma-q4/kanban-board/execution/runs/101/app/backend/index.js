import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';
import { NodeFS } from '@electric-sql/pglite/nodefs';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;
const DB_PATH = path.join(process.cwd(), 'pgdata');

// Initialize PGLite with persistence
const db = new PGlite({
  fs: new NodeFS(DB_PATH)
});

// DB Initialization
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

  const columns = await db.query('SELECT * FROM columns');
  if (columns.rows.length === 0) {
    await db.exec(`
      INSERT INTO columns (id, title, position) VALUES 
      ('todo', 'To Do', 1),
      ('inprogress', 'In Progress', 2),
      ('done', 'Done', 3);
    `);
  }
}

await initDb();

// SSE logic
let clients = [];
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => client.res.write(payload));
}

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const client = { res };
  clients.push(client);

  req.on('close', () => {
    clients = clients.filter(c => c !== client);
  });
});

app.get('/api/board', async (req, res) => {
  const colsRes = await db.query('SELECT * FROM columns ORDER BY position');
  const columns = colsRes.rows;
  
  const board = [];
  for (const col of columns) {
    const cardsRes = await db.query('SELECT * FROM cards WHERE column_id = $1 ORDER BY position', [col.id]);
    board.push({
      ...col,
      cards: cardsRes.rows
    });
  }
  res.json(board);
});

app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  const id = Math.random().toString(36).substring(2, 9);
  
  // Get last card position
  const lastCard = await db.query('SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1', [columnId]);
  const position = lastCard.rows.length > 0 ? lastCard.rows[0].position + 1000 : 1000;

  await db.query('INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4)', [id, columnId, text, position]);
  
  const newCard = { id, columnId, text, position };
  broadcast('cardCreated', newCard);
  res.status(201).json(newCard);
});

app.patch('/api/cards/:id/move', async (req, res) => {
  const { id } = req.params;
  const { columnId, beforeId, afterId } = req.body;

  let position;
  
  // Compute position
  if (beforeId && afterId) {
    const before = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
    const after = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);
    if (before.rows.length && after.rows.length) {
      position = (before.rows[0].position + after.rows[0].position) / 2;
    }
  } else if (beforeId) {
    const before = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
    if (before.rows.length) {
      position = before.rows[0].position - 1000;
    }
  } else if (afterId) {
    const after = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);
    if (after.rows.length) {
      position = after.rows[0].position + 1000;
    }
  } else {
    // Empty column or first card
    position = 1000;
  }

  // If position is not determined, default it
  if (position === undefined) position = 1000;

  // Update atomically
  await db.exec('BEGIN');
  try {
    await db.query('UPDATE cards SET column_id = $1, position = $2 WHERE id = $3', [columnId, position, id]);
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    res.status(500).json({ error: 'Database error' });
    return;
  }

  const updatedCard = { id, columnId, position };
  broadcast('cardMoved', updatedCard);
  res.json(updatedCard);
});

app.listen(PORT, () => {
  console.log(`Backend server running at http://localhost:${PORT}`);
});
