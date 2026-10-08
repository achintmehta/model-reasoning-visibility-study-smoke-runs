const express = require('express');
const cors = require('cors');
const { PGLite } = require('@electric-sql/pglite');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR);
}

const db = new PGLite(DB_DIR);

// SSE management
let clients = [];

const broadcast = (event, data) => {
  clients.forEach(client => {
    client.res.write(`event: ${event}\n`);
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
};

async function initDb() {
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
  `);

  const columnCount = await db.query('SELECT COUNT(*) as count FROM columns');
  if (parseInt(columnCount.rows[0].count) === 0) {
    await db.exec(`
      INSERT INTO columns (id, title, position) VALUES 
      ('col-1', 'To Do', 1.0),
      ('col-2', 'In Progress', 2.0),
      ('col-3', 'Done', 3.0);
    `);
    console.log('Database seeded.');
  }
}

app.get('/api/board', async (req, res) => {
  try {
    const columnsResult = await db.query('SELECT * FROM columns ORDER BY position ASC');
    const columns = columnsResult.rows.map(col => ({ ...col }));

    for (const col of columns) {
      const cardsResult = await db.query(
        'SELECT * FROM cards WHERE column_id = $1 ORDER BY position ASC',
        [col.id]
      );
      col.cards = cardsResult.rows.map(card => ({ ...card }));
    }

    res.json(columns);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching board');
  }
});

app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  if (!columnId || !text) {
    return res.status(400).send('Missing columnId or text');
  }

  try {
    const id = `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Find the last card's position in the column
    const lastCardRes = await db.query(
      'SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1',
      [columnId]
    );
    
    let position = 1.0;
    if (lastCardRes.rows.length > 0) {
      position = lastCardRes.rows[0].position + 1.0;
    }

    await db.query(
      'INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4)',
      [id, columnId, text, position]
    );

    const newCard = { id, column_id: columnId, text, position };
    
    // Broadcast to all clients
    broadcast('card_created', { columnId, card: newCard });

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
    // Note: PGLite transaction implementation might differ slightly from standard pg, 
    // but using await tx.query should work for atomicity in PGLite.
    // For PGLite, we often use the transaction method.
    await db.transaction(async (tx) => {
      // 1. Check if card exists and get its current state
      const cardRes = await tx.query('SELECT * FROM cards WHERE id = $1', [id]);
      if (cardRes.rows.length === 0) {
        throw new Error('Card not found');
      }
      const card = cardRes.rows[0];

      // 2. Calculate new position
      let newPosition = 50.0; // Default fallback

      if (beforeId && afterId) {
        // Between two cards
        const beforeRes = await tx.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
        const afterRes = await tx.query('SELECT position FROM cards WHERE id = $1', [afterId]);
        
        if (beforeRes.rows.length > 0 && afterRes.rows.length > 0) {
          newPosition = (beforeRes.rows[0].position + afterRes.rows[0].position) / 2;
        } else if (beforeRes.rows.length > 0) {
          newPosition = beforeRes.rows[0].position + 1.0;
        } else if (afterRes.rows.length > 0) {
          newPosition = afterRes.rows[0].position - 1.0;
        }
      } else if (beforeId) {
        // Before a specific card
        const beforeRes = await tx.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
        if (beforeRes.rows.length > 0) {
          newPosition = beforeRes.rows[0].position - 1.0;
        }
      } else if (afterId) {
        // After a specific card
        const afterRes = await tx.query('SELECT position FROM cards WHERE id = $1', [afterId]);
        if (afterRes.rows.length > 0) {
          newPosition = afterRes.rows[0].position + 1.0;
        }
      }

      // 3. Update card
      await tx.query(
        'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3',
        [columnId, newPosition, id]
      );

      // Check for collisions and renormalize if needed
      const collisionRes = await tx.query(
        'SELECT id FROM cards WHERE column_id = $1 AND position = $2',
        [columnId, newPosition]
      );

      if (collisionRes.rows.length > 1) {
        // Collision detected! Renormalize the column.
        const cardsRes = await tx.query(
          'SELECT id FROM cards WHERE column_id = $1 ORDER BY position ASC',
          [columnId]
        );
        const cardIds = cardsRes.rows.map(r => r.id);
        for (let i = 0; i < cardIds.length; i++) {
          await tx.query(
            'UPDATE cards SET position = $1 WHERE id = $2',
            [i + 1.0, cardIds[i]]
          );
        }
      }

      // Get the final state of the card to return to client
      const finalCardRes = await tx.query('SELECT * FROM cards WHERE id = $1', [id]);
      const finalCard = finalCardRes.rows[0];
      
      // Broadcast the move
      broadcast('card_moved', { columnId, card: finalCard });

      res.json(finalCard);
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error moving card');
  }
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  clients.push(newClient);

  req.on('close', () => {
    clients = clients.filter(c => c.id !== clientId);
  });
});

async function start() {
  await initDb();
  const PORT = 3001;
  app.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
  });
}

start();
