import express from 'express';
import cors from 'cors';
import { PGLite } from '@electric-sql/pglite';
import path from 'path';

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Initialize PGLite with a local directory for persistence
const db = new PGLite('./pgdata');

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

  // Seed default columns if empty
  const result = await db.query('SELECT count(*) FROM columns');
  if (parseInt(result.rows[0].count) === 0) {
    await db.exec(`
      INSERT INTO columns (id, title, position) VALUES 
      ('todo', 'To Do', 1),
      ('inprogress', 'In Progress', 2),
      ('done', 'Done', 3);
    `);
    console.log('Database seeded with default columns.');
  }
}

// SSE management
let clients = [];
function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => client.res.write(message));
}

// API Endpoints
app.get('/api/board', async (req, res) => {
  try {
    const columnsRes = await db.query('SELECT * FROM columns ORDER BY position');
    const cardsRes = await db.query('SELECT * FROM cards ORDER BY position');
    
    const columns = columnsRes.rows.map(col => ({
      ...col,
      cards: cardsRes.rows.filter(card => card.column_id === col.id)
    }));
    
    res.json(columns);
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
    const id = Math.random().toString(36).substring(2, 11);
    
    // Find the last card's position in the column
    const lastCardRes = await db.query(
      'SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1',
      [columnId]
    );
    
    const position = lastCardRes.rows.length > 0 
      ? lastCardRes.rows[0].position + 1000 
      : 1000;

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

async function renormalizeColumn(columnId) {
  const res = await db.query(
    'SELECT id FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );
  const cards = res.rows;
  
  for (let i = 0; i < cards.length; i++) {
    const newPos = (i + 1) * 1000;
    await db.query('UPDATE cards SET position = $1 WHERE id = $2', [newPos, cards[i].id]);
  }
  
  // Broadcast the whole column's cards to ensure everyone is synced
  const updatedCardsRes = await db.query(
    'SELECT * FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );
  
  broadcast('columnRenormalized', {
    columnId,
    cards: updatedCardsRes.rows
  });
}

app.patch('/api/cards/:id/move', async (req, res) => {
  const { id } = req.params;
  const { columnId, beforeId, afterId } = req.body;

  try {
    await db.exec('BEGIN');

    let position;
    if (beforeId && afterId) {
      const beforeRes = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
      const afterRes = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);
      if (!beforeRes.rows[0] || !afterRes.rows[0]) throw new Error('Invalid beforeId or afterId');
      
      const pos1 = beforeRes.rows[0].position;
      const pos2 = afterRes.rows[0].position;
      position = (pos1 + pos2) / 2;
      
      // Simple precision check: if the gap is too small, renormalize
      if (Math.abs(pos1 - pos2) < 0.000001) {
        // We will renormalize after the transaction commits to avoid deadlock/complexity
        // or just flag it.
      }
    } else if (beforeId) {
      const beforeRes = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
      if (!beforeRes.rows[0]) throw new Error('Invalid beforeId');
      position = beforeRes.rows[0].position + 1000;
    } else if (afterId) {
      const afterRes = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);
      if (!afterRes.rows[0]) throw new Error('Invalid afterId');
      position = afterRes.rows[0].position - 1000;
    } else {
      position = 1000;
    }

    await db.query(
      'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3',
      [columnId, position, id]
    );

    await db.exec('COMMIT');

    const cardRes = await db.query('SELECT * FROM cards WHERE id = $1', [id]);
    const updatedCard = cardRes.rows[0];

    broadcast('cardMoved', updatedCard);
    
    // Check if we should renormalize after commit
    // For this exercise, we can periodically renormalize or check for small gaps
    // Let's just check if the position has too many decimals (roughly)
    if (position.toString().split('.')[1]?.length > 10) {
      await renormalizeColumn(columnId);
    }

    res.json(updatedCard);
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

  const client = { res };
  clients.push(client);

  req.on('close', () => {
    clients = clients.filter(c => c !== client);
  });
});

initDb().then(() => {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
