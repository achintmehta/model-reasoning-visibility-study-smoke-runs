const express = require('express');
const cors = require('cors');
const { PGlite } = require('@electric-sql/pglite');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// ─── PGLite Setup ──────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'pgdata');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db;

async function initDB() {
  db = new PGlite(DATA_DIR);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      position REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      column_id UUID NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      position REAL NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Seed default columns if empty
  const count = await db.query('SELECT COUNT(*) AS cnt FROM columns');
  if (parseInt(count.rows[0].cnt) === 0) {
    await db.exec(`
      INSERT INTO columns (id, title, position) VALUES
        (gen_random_uuid(), 'To Do', 1),
        (gen_random_uuid(), 'In Progress', 2),
        (gen_random_uuid(), 'Done', 3);
    `);
  }
}

// Wait for DB to be ready before starting server
const dbReady = initDB().catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

// ─── SSE Broadcast System ──────────────────────────────────────
const subscribers = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subscribers) {
    if (!res.writableEnded) {
      res.write(payload);
    }
  }
}

// ─── Board State Endpoint ──────────────────────────────────────
app.get('/api/board', async (_req, res) => {
  try {
    await dbReady;
    const columnsRes = await db.query(
      'SELECT id, title FROM columns ORDER BY position'
    );
    const result = [];

    for (const col of columnsRes.rows) {
      const cardsRes = await db.query(
        'SELECT id, text, position FROM cards WHERE column_id = $1 ORDER BY position',
        [col.id]
      );
      result.push({
        id: col.id,
        title: col.title,
        cards: cardsRes.rows.map(r => ({
          id: r.id,
          text: r.text,
          position: r.position
        }))
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Board query error:', err);
    res.status(500).json({ error: 'Failed to fetch board' });
  }
});

// ─── Create Card ───────────────────────────────────────────────
app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;

  if (!columnId || !text) {
    return res.status(400).json({ error: 'columnId and text are required' });
  }

  try {
    await dbReady;
    // Get the max position in the target column
    const maxRes = await db.query(
      'SELECT COALESCE(MAX(position), 0) AS maxPos FROM cards WHERE column_id = $1',
      [columnId]
    );
    const newPos = (maxRes.rows[0].maxpos || 0) + 1;

    // Insert the card
    const insertRes = await db.query(
      `INSERT INTO cards (column_id, text, position) VALUES ($1, $2, $3) RETURNING id, column_id, text, position, created_at`,
      [columnId, text, newPos]
    );

    const card = { ...insertRes.rows[0], columnId };
    broadcast('card-created', card);
    res.json(card);
  } catch (err) {
    console.error('Create card error:', err);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

// ─── Move Card ─────────────────────────────────────────────────
app.patch('/api/cards/:id/move', async (req, res) => {
  const { id } = req.params;
  const { columnId, beforeId, afterId } = req.body;

  if (!columnId) {
    return res.status(400).json({ error: 'columnId is required' });
  }

  try {
    await dbReady;
    // Compute the new position using fractional positioning
    let newPos;

    if (beforeId && afterId) {
      const bothRes = await db.query(
        'SELECT id, position FROM cards WHERE column_id = $1 AND id IN ($2, $3)',
        [columnId, beforeId, afterId]
      );
      const beforeCard = bothRes.rows.find(r => r.id === beforeId);
      const afterCard = bothRes.rows.find(r => r.id === afterId);

      if (beforeCard && afterCard) {
        newPos = (beforeCard.position + afterCard.position) / 2;
      } else {
        // Fallback: use the max position + 1
        const maxRes = await db.query(
          'SELECT COALESCE(MAX(position), 0) AS maxPos FROM cards WHERE column_id = $1',
          [columnId]
        );
        newPos = (maxRes.rows[0].maxpos || 0) + 1;
      }
    } else if (beforeId) {
      const beforeRes = await db.query(
        'SELECT position FROM cards WHERE column_id = $1 AND id = $2',
        [columnId, beforeId]
      );
      if (beforeRes.rows.length > 0) {
        newPos = beforeRes.rows[0].position - 1;
      } else {
        const maxRes = await db.query(
          'SELECT COALESCE(MAX(position), 0) AS maxPos FROM cards WHERE column_id = $1',
          [columnId]
        );
        newPos = (maxRes.rows[0].maxpos || 0) + 1;
      }
    } else if (afterId) {
      const afterRes = await db.query(
        'SELECT position FROM cards WHERE column_id = $1 AND id = $2',
        [columnId, afterId]
      );
      if (afterRes.rows.length > 0) {
        newPos = afterRes.rows[0].position + 1;
      } else {
        const maxRes = await db.query(
          'SELECT COALESCE(MAX(position), 0) AS maxPos FROM cards WHERE column_id = $1',
          [columnId]
        );
        newPos = (maxRes.rows[0].maxpos || 0) + 1;
      }
    } else {
      // No anchor: append to end
      const maxRes = await db.query(
        'SELECT COALESCE(MAX(position), 0) AS maxPos FROM cards WHERE column_id = $1',
        [columnId]
      );
      newPos = (maxRes.rows[0].maxpos || 0) + 1;
    }

    // Check for position collision / precision exhaustion
    const existingRes = await db.query(
      'SELECT id, position FROM cards WHERE column_id = $1 AND id != $2',
      [columnId, id]
    );

    let needsRenormalize = false;
    for (const row of existingRes.rows) {
      if (Math.abs(row.position - newPos) < 0.0001) {
        needsRenormalize = true;
        break;
      }
    }

    // Also check if position is too extreme (precision exhaustion)
    if (!needsRenormalize && (Math.abs(newPos) > 1e8 || Math.abs(newPos) < 1e-8)) {
      needsRenormalize = true;
    }

    let finalNewPos = newPos;

    // Atomic transaction: move card and renormalize if needed
    const result = await db.transaction(async (tx) => {
      // Update the card's column and position
      const updateRes = await tx.query(
        `UPDATE cards SET column_id = $1, position = $2 WHERE id = $3 RETURNING id, column_id, text, position, created_at`,
        [columnId, finalNewPos, id]
      );

      if (updateRes.rows.length === 0) {
        throw new Error('Card not found');
      }

      const card = { ...updateRes.rows[0], columnId };

      // Renormalize the entire column if needed
      if (needsRenormalize) {
        await renormalizeColumn(tx, columnId);
        // Re-read the card after renormalization
        const reReadRes = await tx.query(
          'SELECT id, column_id, text, position, created_at FROM cards WHERE id = $1',
          [id]
        );
        if (reReadRes.rows.length > 0) {
          card.position = reReadRes.rows[0].position;
        }
      }

      return card;
    });

    broadcast('card-moved', result);
    res.json(result);
  } catch (err) {
    console.error('Move card error:', err);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

// ─── Renormalization Helper ────────────────────────────────────
async function renormalizeColumn(tx, columnId) {
  const cardsRes = await tx.query(
    'SELECT id FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );

  let pos = 1;
  for (const card of cardsRes.rows) {
    await tx.query(
      'UPDATE cards SET position = $1 WHERE id = $2',
      [pos, card.id]
    );
    pos += 1;
  }

  // Broadcast the full column reordering
  const reorderedCards = await tx.query(
    'SELECT id, text, position FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );

  broadcast('column-renormalized', {
    columnId,
    cards: reorderedCards.rows.map(r => ({ id: r.id, text: r.text, position: r.position }))
  });
}

// ─── SSE Stream Endpoint ───────────────────────────────────────
app.get('/api/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Wait for DB and send initial board state
  try {
    await dbReady;
    const columnsRes = await db.query(
      'SELECT id, title FROM columns ORDER BY position'
    );
    const result = [];

    for (const col of columnsRes.rows) {
      const cardsRes = await db.query(
        'SELECT id, text, position FROM cards WHERE column_id = $1 ORDER BY position',
        [col.id]
      );
      result.push({
        id: col.id,
        title: col.title,
        cards: cardsRes.rows.map(r => ({
          id: r.id,
          text: r.text,
          position: r.position
        }))
      });
    }

    res.write(`event: board-initial\ndata: ${JSON.stringify(result)}\n\n`);
  } catch (err) {
    console.error('SSE initial state error:', err);
  }

  subscribers.add(res);

  req.on('close', () => {
    subscribers.delete(res);
  });
});

// ─── Start Server (waits for DB) ──────────────────────────────
dbReady.then(() => {
  app.listen(PORT, () => {
    console.log(`Kanban board server running on http://localhost:${PORT}`);
  });
});
