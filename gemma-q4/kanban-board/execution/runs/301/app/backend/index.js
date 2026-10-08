const express = require('express');
const cors = require('cors');
const { PGlite } = require('@electric-sql/pglite');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Persistence directory
const pgdataDir = path.join(__dirname, 'pgdata');
if (!fs.existsSync(pgdataDir)) {
  fs.mkdirSync(pgdataDir, { recursive: true });
}

const db = new PGlite({ dataDir: pgdataDir });

// Initialize database
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

  // Seed default columns if none exist
  const { rows: existingColumns } = await db.query('SELECT id FROM columns');
  if (existingColumns.length === 0) {
    await db.exec(`
      INSERT INTO columns (id, title, position) VALUES 
      ('col-1', 'To Do', 1),
      ('col-2', 'In Progress', 2),
      ('col-3', 'Done', 3);
    `);
    console.log('Seeded default columns');
  }
}

initDb().catch(err => console.error('DB initialization error:', err));

// SSE clients management
let clients = [];
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => client.res.write(payload));
}

// Helper to renormalize positions in a column
async function renormalizeColumn(columnId) {
  await db.exec(`
    WITH updated AS (
      SELECT id, row_number() OVER (ORDER BY position) as new_pos
      FROM cards
      WHERE column_id = ${db.escapeValue(columnId)}
    )
    UPDATE cards
    SET position = updated.new_pos
    FROM updated
    WHERE cards.id = updated.id;
  `);
  
  const { rows: cards } = await db.query('SELECT * FROM cards WHERE column_id = $1 ORDER BY position', [columnId]);
  broadcast('column_updated', { columnId, cards });
}

// API Endpoints

// GET /api/board
app.get('/api/board', async (req, res) => {
  try {
    const { rows: columns } = await db.query('SELECT * FROM columns ORDER BY position');
    const { rows: cards } = await db.query('SELECT * FROM cards ORDER BY position');
    
    const board = columns.map(col => ({
      ...col,
      cards: cards.filter(card => card.column_id === col.id)
    }));
    
    res.json(board);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stream
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

// POST /api/cards
app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  if (!columnId || !text) return res.status(400).json({ error: 'Missing columnId or text' });

  try {
    const { rows: cards } = await db.query('SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1', [columnId]);
    const position = cards.length > 0 ? cards[0].position + 1 : 1;
    const id = uuidv4();

    await db.query('INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4)', [id, columnId, text, position]);
    
    const newCard = { id, column_id: columnId, text, position };
    broadcast('card_created', newCard);
    
    res.status(201).json(newCard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cards/:id/move
app.patch('/api/cards/:id/move', async (req, res) => {
  const { id } = req.params;
  const { columnId, beforeId, afterId } = req.body;

  try {
    let position;
    const beforeRes = beforeId ? await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]) : null;
    const afterRes = afterId ? await db.query('SELECT position FROM cards WHERE id = $1', [afterId]) : null;

    const posBefore = beforeRes?.rows[0]?.position;
    const posAfter = afterRes?.rows[0]?.position;

    if (posBefore !== undefined && posAfter !== undefined) {
      position = (posBefore + posAfter) / 2;
    } else if (posBefore !== undefined) {
      position = posBefore + 1;
    } else if (posAfter !== undefined) {
      position = posAfter / 2;
    } else {
      position = 1;
    }

    await db.query('UPDATE cards SET column_id = $1, position = $2 WHERE id = $3', [columnId, position, id]);
    
    const { rows: cardRows } = await db.query('SELECT * FROM cards WHERE id = $1', [id]);
    const card = cardRows[0];

    const { rows: colCards } = await db.query('SELECT position FROM cards WHERE column_id = $1 ORDER BY position', [columnId]);
    let needsRenormalization = false;
    for (let i = 0; i < colCards.length - 1; i++) {
      if (colCards[i+1].position - colCards[i].position < 1e-8) {
        needsRenormalization = true;
        break;
      }
    }

    if (needsRenormalization) {
      await renormalizeColumn(columnId);
    }

    const { rows: updatedColCards } = await db.query('SELECT * FROM cards WHERE column_id = $1 ORDER BY position', [columnId]);
    broadcast('column_updated', { columnId, cards: updatedColCards });
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Backend listening at http://localhost:${port}`);
});
