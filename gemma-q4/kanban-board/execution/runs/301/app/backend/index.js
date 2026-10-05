const express = require('express');
const cors = require('cors');
const { PGlite } = require('@electric-sql/pglite');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;
const DB_PATH = path.join(__dirname, 'pglite_data');

// Initialize PGLite with filesystem persistence
const db = new PGlite({ dataDir: DB_PATH });

// SSE clients
let clients = [];

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => client.res.write(payload));
}

async function renormalizeColumn(columnId) {
  const { rows: cards } = await db.query('SELECT id FROM cards WHERE column_id = $1 ORDER BY position', [columnId]);
  for (let i = 0; i < cards.length; i++) {
    const newPos = (i + 1) * 100;
    await db.query('UPDATE cards SET position = $1 WHERE id = $2', [newPos, cards[i].id]);
  }
  
  // Broadcast the updated state of the column
  const { rows: updatedCards } = await db.query('SELECT * FROM cards WHERE column_id = $1 ORDER BY position', [columnId]);
  broadcast('columnRenormalized', { columnId, cards: updatedCards });
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
      column_id TEXT NOT NULL REFERENCES columns(id),
      text TEXT NOT NULL,
      position REAL NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const { rows: colRows } = await db.query('SELECT id FROM columns');
  if (colRows.length === 0) {
    await db.exec(`
      INSERT INTO columns (id, title, position) VALUES 
      ('todo', 'To Do', 100),
      ('inprogress', 'In Progress', 200),
      ('done', 'Done', 300);
    `);
  }
}

app.get('/api/board', async (req, res) => {
  try {
    const cols = await db.query('SELECT * FROM columns ORDER BY position');
    const cards = await db.query('SELECT * FROM cards ORDER BY position');
    
    const board = cols.rows.map(col => ({
      ...col,
      cards: cards.rows.filter(card => card.column_id === col.id)
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
    const { rows: cards } = await db.query('SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1', [columnId]);
    const lastPos = cards.length > 0 ? cards[0].position : 0;
    const newPos = lastPos + 100;
    const id = Math.random().toString(36).substring(2, 9);

    await db.query('INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4)', [id, columnId, text, newPos]);
    
    const newCard = { id, column_id: columnId, text, position: newPos };
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
    let attempt = 0;
    let success = false;
    let updatedCard = null;

    while (!success && attempt < 2) {
      attempt++;
      
      let posAbove = 0;
      if (afterId) {
        const { rows } = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);
        if (rows.length > 0) posAbove = rows[0].position;
      }

      let posBelow = 1000000;
      if (beforeId) {
        const { rows } = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
        if (rows.length > 0) posBelow = rows[0].position;
      }

      if (afterId === null && beforeId === null) {
        posAbove = 0;
        posBelow = 1000;
      } else if (afterId === null) {
        posAbove = 0;
      } else if (beforeId === null) {
        posBelow = posAbove + 1000;
      }

      const newPos = (posAbove + posBelow) / 2;

      if (Math.abs(newPos - posAbove) < 0.000001 || Math.abs(newPos - posBelow) < 0.000001) {
        await renormalizeColumn(columnId);
        continue;
      }

      await db.query('UPDATE cards SET column_id = $1, position = $2 WHERE id = $3', [columnId, newPos, id]);
      const { rows: cardRows } = await db.query('SELECT * FROM cards WHERE id = $1', [id]);
      updatedCard = cardRows[0];
      success = true;
    }

    if (updatedCard) {
      broadcast('cardMoved', updatedCard);
      res.json(updatedCard);
    } else {
      res.status(500).json({ error: 'Failed to move card' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('DB init failed', err);
  process.exit(1);
});
