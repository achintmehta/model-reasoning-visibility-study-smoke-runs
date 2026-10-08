import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'pglite-data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// --- PGlite Initialization ---
const db = new PGlite({
  dataDir: DATA_DIR,
});

// --- Database Schema & Seeding ---
async function initDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position REAL NOT NULL
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT NOT NULL REFERENCES columns(id),
      text TEXT NOT NULL,
      position REAL NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Seed default columns if empty
  const { rows: existingColumns } = await db.query('SELECT id FROM columns');
  if (existingColumns.length === 0) {
    const defaults = ['To Do', 'In Progress', 'Done'];
    for (let i = 0; i < defaults.length; i++) {
      await db.query(
        'INSERT INTO columns (id, title, position) VALUES ($1, $2, $3)',
        [generateId(), defaults[i], i]
      );
    }
  }
}

// --- SSE Connection Management ---
const sseClients = new Set();

function broadcast(event, data) {
  const formattedData = JSON.stringify(data);
  const message = `event: ${event}\ndata: ${formattedData}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch (e) {
      // Client disconnected, will be cleaned up
    }
  }
}

// --- Utility ---
function generateId() {
  return crypto.randomUUID();
}

function mid(a, b) {
  if (a === undefined && b === undefined) return 0.5;
  if (a === undefined) return b + 0.5;
  if (b === undefined) return a - 0.5;
  return (a + b) / 2;
}

// Renormalize positions for a column to prevent precision exhaustion
async function renormalizeColumn(columnId) {
  const { rows } = await db.query(
    'SELECT id, position FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );

  if (rows.length === 0) return;

  const updateQueries = [];
  for (let i = 0; i < rows.length; i++) {
    updateQueries.push({
      id: rows[i].id,
      position: i
    });
  }

  for (const { id, position } of updateQueries) {
    await db.query(
      'UPDATE cards SET position = $1 WHERE id = $2',
      [position, id]
    );
  }

  // Broadcast the corrected order
  const { rows: updatedCards } = await db.query(
    'SELECT c.*, col.id as column_id FROM cards c JOIN columns col ON c.column_id = col.id WHERE c.column_id = $1 ORDER BY c.position',
    [columnId]
  );
  broadcast('renormalize', { columnId, cards: updatedCards });
}

// Check if a new position would cause precision issues
function needsRenormalization(newPos, existingPositions) {
  for (const pos of existingPositions) {
    if (Math.abs(newPos - pos) < 1e-10) {
      return true;
    }
  }
  return false;
}

// --- Express Server ---
const app = express();
app.use(cors());
app.use(express.json());

// GET /api/board - Return full board state
app.get('/api/board', async (req, res) => {
  try {
    const { rows: columns } = await db.query(
      'SELECT * FROM columns ORDER BY position'
    );

    const board = [];
    for (const col of columns) {
      const { rows: cards } = await db.query(
        'SELECT * FROM cards WHERE column_id = $1 ORDER BY position',
        [col.id]
      );
      board.push({
        ...col,
        cards: cards.map(c => ({ ...c, column_id: col.id }))
      });
    }

    res.json(board);
  } catch (err) {
    console.error('Error fetching board:', err);
    res.status(500).json({ error: 'Failed to fetch board' });
  }
});

// POST /api/cards - Create a new card
app.post('/api/cards', async (req, res) => {
  try {
    const { column_id, text } = req.body;

    if (!column_id || !text) {
      return res.status(400).json({ error: 'column_id and text are required' });
    }

    // Get the max position in the column to append at the end
    const { rows: posRows } = await db.query(
      'SELECT MAX(position) as max_pos FROM cards WHERE column_id = $1',
      [column_id]
    );
    const maxPos = posRows[0].max_pos;
    const newPosition = maxPos === null ? 0 : maxPos + 1;

    const id = generateId();
    const now = new Date().toISOString();

    await db.query(
      'INSERT INTO cards (id, column_id, text, position, created_at) VALUES ($1, $2, $3, $4, $5)',
      [id, column_id, text, newPosition, now]
    );

    // Fetch the created card with column info
    const { rows } = await db.query(
      'SELECT c.*, col.id as column_id FROM cards c JOIN columns col ON c.column_id = col.id WHERE c.id = $1',
      [id]
    );
    const card = rows[0];

    // Broadcast to all clients
    broadcast('create', { card, columnId: column_id });

    res.status(201).json(card);
  } catch (err) {
    console.error('Error creating card:', err);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

// PATCH /api/cards/:id/move - Move card within or across columns
app.patch('/api/cards/:id/move', async (req, res) => {
  try {
    const { id } = req.params;
    const { column_id, before_id, after_id } = req.body;

    if (!column_id) {
      return res.status(400).json({ error: 'column_id is required' });
    }

    // Start a transaction
    await db.query('BEGIN');

    try {
      // Get current card state
      const { rows: cardRows } = await db.query(
        'SELECT * FROM cards WHERE id = $1',
        [id]
      );

      if (cardRows.length === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: 'Card not found' });
      }

      const card = cardRows[0];
      const oldColumnId = card.column_id;

      // Calculate new position based on before_id and after_id
      let newPosition;
      if (before_id && after_id) {
        const { rows: rangeRows } = await db.query(
          'SELECT position FROM cards WHERE id = ANY($1)',
          [[before_id, after_id]]
        );
        const positions = rangeRows.map(r => r.position);
        newPosition = mid(positions[0], positions[1]);
      } else if (before_id) {
        const { rows: rangeRows } = await db.query(
          'SELECT position FROM cards WHERE id = $1',
          [before_id]
        );
        const beforePos = rangeRows[0].position;
        const { rows: prevRows } = await db.query(
          'SELECT position FROM cards WHERE column_id = $1 AND position < $2 ORDER BY position DESC LIMIT 1',
          [column_id, beforePos]
        );
        const prevPos = prevRows.length > 0 ? prevRows[0].position : undefined;
        newPosition = mid(prevPos, beforePos);
      } else if (after_id) {
        const { rows: rangeRows } = await db.query(
          'SELECT position FROM cards WHERE id = $1',
          [after_id]
        );
        const afterPos = rangeRows[0].position;
        const { rows: nextRows } = await db.query(
          'SELECT position FROM cards WHERE column_id = $1 AND position > $2 ORDER BY position ASC LIMIT 1',
          [column_id, afterPos]
        );
        const nextPos = nextRows.length > 0 ? nextRows[0].position : undefined;
        newPosition = mid(afterPos, nextPos);
      } else {
        // No reference cards - append at end of column
        const { rows: posRows } = await db.query(
          'SELECT MAX(position) as max_pos FROM cards WHERE column_id = $1 AND id != $2',
          [column_id, id]
        );
        const maxPos = posRows[0].max_pos;
        newPosition = maxPos === null ? 0 : maxPos + 1;
      }

      // Check for precision issues
      const { rows: existingPositions } = await db.query(
        'SELECT position FROM cards WHERE column_id = $1 AND id != $2',
        [column_id, id]
      );
      const positions = existingPositions.map(r => r.position);

      if (needsRenormalization(newPosition, positions)) {
        // Renormalize the target column
        await db.query('ROLLBACK');
        await renormalizeColumn(column_id);
        
        // Retry with renormalized positions
        await db.query('BEGIN');
        const { rows: newPositions } = await db.query(
          'SELECT position FROM cards WHERE column_id = $1 AND id != $2',
          [column_id, id]
        );
        const newPositionList = newPositions.map(r => r.position);
        
        if (before_id && after_id) {
          const { rows: rangeRows } = await db.query(
            'SELECT position FROM cards WHERE id = ANY($1)',
            [[before_id, after_id]]
          );
          const posArr = rangeRows.map(r => r.position);
          newPosition = mid(posArr[0], posArr[1]);
        } else if (before_id) {
          const { rows: rangeRows } = await db.query(
            'SELECT position FROM cards WHERE id = $1',
            [before_id]
          );
          const beforePos = rangeRows[0].position;
          const { rows: prevRows } = await db.query(
            'SELECT position FROM cards WHERE column_id = $1 AND position < $2 ORDER BY position DESC LIMIT 1',
            [column_id, beforePos]
          );
          const prevPos = prevRows.length > 0 ? prevRows[0].position : undefined;
          newPosition = mid(prevPos, beforePos);
        } else if (after_id) {
          const { rows: rangeRows } = await db.query(
            'SELECT position FROM cards WHERE id = $1',
            [after_id]
          );
          const afterPos = rangeRows[0].position;
          const { rows: nextRows } = await db.query(
            'SELECT position FROM cards WHERE column_id = $1 AND position > $2 ORDER BY position ASC LIMIT 1',
            [column_id, afterPos]
          );
          const nextPos = nextRows.length > 0 ? nextRows[0].position : undefined;
          newPosition = mid(afterPos, nextPos);
        } else {
          const { rows: posRows } = await db.query(
            'SELECT MAX(position) as max_pos FROM cards WHERE column_id = $1 AND id != $2',
            [column_id, id]
          );
          const maxPos = posRows[0].max_pos;
          newPosition = maxPos === null ? 0 : maxPos + 1;
        }
      }

      // Update card position and column atomically
      await db.query(
        'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3',
        [column_id, newPosition, id]
      );

      // Commit transaction
      await db.query('COMMIT');

      // Fetch the updated card
      const { rows } = await db.query(
        'SELECT c.*, col.id as column_id FROM cards c JOIN columns col ON c.column_id = col.id WHERE c.id = $1',
        [id]
      );
      const updatedCard = rows[0];

      // Broadcast move to all clients
      broadcast('move', {
        card: updatedCard,
        columnId: column_id,
        oldColumnId: oldColumnId
      });

      res.json(updatedCard);
    } catch (txErr) {
      await db.query('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    console.error('Error moving card:', err);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

// DELETE /api/cards/:id - Delete a card
app.delete('/api/cards/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { rows } = await db.query(
      'SELECT column_id FROM cards WHERE id = $1',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    const columnId = rows[0].column_id;

    await db.query('DELETE FROM cards WHERE id = $1', [id]);

    broadcast('delete', { cardId: id, columnId });

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting card:', err);
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

// GET /api/stream - SSE endpoint
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Send initial comment to keep connection alive
  res.write(': connected\n\n');

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// --- Start Server ---
const PORT = process.env.PORT || 3001;

async function start() {
  try {
    await initDatabase();
    console.log('Database initialized');
    
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
