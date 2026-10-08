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

  const { rows: columns } = await db.query('SELECT id FROM columns');
  if (columns.length === 0) {
    await db.exec(`
      INSERT INTO columns (id, title, position) VALUES 
      ('todo', 'To Do', 1),
      ('inprogress', 'In Progress', 2),
      ('done', 'Done', 3);
    `);
    console.log('Seeded default columns');
  }
}

// SSE Clients
let clients = [];

function broadcast(event, data) {
  const payload = JSON.stringify(data);
  clients.forEach(client => {
    client.res.write(`event: ${event}\ndata: ${payload}\n\n`);
  });
}

async function renormalizeColumn(columnId) {
  const { rows: cards } = await db.query('SELECT id FROM cards WHERE column_id = $1 ORDER BY position', [columnId]);
  for (let i = 0; i < cards.length; i++) {
    await db.query('UPDATE cards SET position = $1 WHERE id = $2', [i + 1, cards[i].id]);
  }
  const { rows: updatedCards } = await db.query('SELECT * FROM cards WHERE column_id = $1 ORDER BY position', [columnId]);
  broadcast('columnRenormalized', { columnId, cards: updatedCards });
}

// API Endpoints
app.get('/api/board', async (req, res) => {
  try {
    const columnsResult = await db.query('SELECT * FROM columns ORDER BY position');
    const columns = columnsResult.rows;
    
    const board = [];
    for (const col of columns) {
      const cardsResult = await db.query('SELECT * FROM cards WHERE column_id = $1 ORDER BY position', [col.id]);
      board.push({
        ...col,
        cards: cardsResult.rows
      });
    }
    
    res.json(board);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  if (!columnId || !text) {
    return res.status(400).send('columnId and text are required');
  }

  try {
    const id = Math.random().toString(36).substr(2, 9);
    
    // Get the current max position in the column
    const { rows } = await db.query('SELECT MAX(position) as maxPos FROM cards WHERE column_id = $1', [columnId]);
    const maxPos = rows[0]?.maxPos || 0;
    const position = maxPos + 1;

    await db.query(
      'INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4)',
      [id, columnId, text, position]
    );

    const newCard = { id, column_id: columnId, text, position };
    broadcast('cardCreated', newCard);
    res.status(201).json(newCard);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.patch('/api/cards/:id/move', async (req, res) => {
  const { id } = req.params;
  const { columnId, beforeId, afterId } = req.body;

  try {
    await db.exec('BEGIN');

    // Calculate new position
    let newPosition;
    if (beforeId && afterId) {
      const { rows } = await db.query('SELECT id, position FROM cards WHERE id IN ($1, $2)', [beforeId, afterId]);
      const pos1 = rows.find(r => r.id === beforeId)?.position;
      const pos2 = rows.find(r => r.id === afterId)?.position;
      
      if (pos1 !== undefined && pos2 !== undefined) {
        newPosition = (pos1 + pos2) / 2;
      } else {
        // Fallback if one is missing
        newPosition = (pos1 || pos2 || 0) + 0.1;
      }
    } else if (beforeId) {
      const { rows } = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
      const pos = rows[0]?.position;
      newPosition = pos ? pos - 1 : 0;
    } else if (afterId) {
      const { rows } = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);
      const pos = rows[0]?.position;
      newPosition = pos ? pos + 1 : 1;
    } else {
      // Move to empty column or just set a default
      const { rows } = await db.query('SELECT MAX(position) as maxPos FROM cards WHERE column_id = $1', [columnId]);
      newPosition = (rows[0]?.maxPos || 0) + 1;
    }

    await db.query(
      'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3',
      [columnId, newPosition, id]
    );

    // Check for collisions
    const { rows: collisions } = await db.query(
      'SELECT id FROM cards WHERE column_id = $1 AND position = $2 AND id != $3',
      [columnId, newPosition, id]
    );

    if (collisions.length > 0) {
      await renormalizeColumn(columnId);
    }

    await db.exec('COMMIT');

    const { rows: cardRows } = await db.query('SELECT * FROM cards WHERE id = $1', [id]);
    const card = cardRows[0];
    
    broadcast('cardMoved', card);
    res.json(card);
  } catch (err) {
    await db.exec('ROLLBACK');
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

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

initDb().then(() => {
  app.listen(port, () => {
    console.log(`Backend listening at http://localhost:${port}`);
  });
}).catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
