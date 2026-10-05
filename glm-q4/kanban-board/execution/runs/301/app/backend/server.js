import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize PGLite
const dataDir = './pglite-data';
const pg = new PGlite({ dataDir });

// Database initialization
async function initDatabase() {
  console.log('Initializing database...');
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT NOT NULL,
      text TEXT NOT NULL,
      position REAL NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS cards_column_id ON cards(column_id);
    CREATE INDEX IF NOT EXISTS cards_position ON cards(column_id, position);
  `);
  console.log('Creating tables...');

  // Seed default columns if they don't exist
  const columns = await pg.query('SELECT COUNT(*) as count FROM columns');
  console.log('Column count:', columns.rows[0].count);
  if (columns.rows[0].count === '0') {
    console.log('Seeding default columns...');
    await pg.exec(`INSERT INTO columns (id, title, position) VALUES ('todo', 'To Do', 0)`);
    await pg.exec(`INSERT INTO columns (id, title, position) VALUES ('inprogress', 'In Progress', 1)`);
    await pg.exec(`INSERT INTO columns (id, title, position) VALUES ('done', 'Done', 2)`);
    console.log('Default columns seeded');
  } else {
    console.log('Columns already exist');
  }
}

// Helper: get column position range
async function getColumnPositionRange(columnId) {
  const result = await pg.query(
    'SELECT MIN(position) as min_pos, MAX(position) as max_pos FROM cards WHERE column_id = $1',
    [columnId]
  );
  return result.rows[0];
}

// Helper: calculate position between two cards
function calculatePosition(afterId, beforeId) {
  if (!afterId && !beforeId) return null; // First card in column
  if (!afterId) return null; // Last card
  
  const afterPos = parseFloat(afterId);
  const beforePos = beforeId ? parseFloat(beforeId) : null;
  
  if (!beforeId) return afterPos + 1; // Append to end
  
  // Position between afterId and beforeId
  return (afterPos + beforePos) / 2;
}

// Helper: renormalize column positions
async function renormalizeColumnPositions(columnId) {
  const result = await pg.query(
    'SELECT id, position FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );
  
  const newPositions = [];
  for (let i = 0; i < result.rows.length; i++) {
    const card = result.rows[i];
    newPositions.push({ id: card.id, position: i });
  }
  
  // Batch update
  await pg.exec(`
    UPDATE cards 
    SET position = $2 
    WHERE id = $1
  `, newPositions.map(p => [p.id, p.position]));
  
  return newPositions;
}

// API: Get board state
app.get('/api/board', async (req, res) => {
  try {
    const columns = await pg.query(`
      SELECT * FROM columns ORDER BY position
    `);
    
    const columnsWithCards = await Promise.all(
      columns.rows.map(async (column) => {
        const cards = await pg.query(`
          SELECT * FROM cards 
          WHERE column_id = $1 
          ORDER BY position
        `, [column.id]);
        
        return {
          ...column,
          cards: cards.rows
        };
      })
    );
    
    res.json({ columns: columnsWithCards });
  } catch (error) {
    console.error('Error fetching board:', error);
    res.status(500).json({ error: 'Failed to fetch board' });
  }
});

// API: Create a card
app.post('/api/cards', async (req, res) => {
  try {
    const { columnId, text } = req.body;
    
    if (!columnId || !text) {
      return res.status(400).json({ error: 'columnId and text are required' });
    }
    
    // Get position at the end of the column
    const range = await getColumnPositionRange(columnId);
    const position = !range.max_pos ? 0 : range.max_pos + 1;
    
    const cardId = `card_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await pg.exec(`
      INSERT INTO cards (id, column_id, text, position)
      VALUES ($1, $2, $3, $4)
    `, [cardId, columnId, text, position]);
    
    const card = await pg.query(
      'SELECT * FROM cards WHERE id = $1',
      [cardId]
    );
    
    broadcast({
      type: 'card-created',
      card: card.rows[0]
    });
    
    res.json(card.rows[0]);
  } catch (error) {
    console.error('Error creating card:', error);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

// API: Move a card
app.patch('/api/cards/:id/move', async (req, res) => {
  try {
    const { id } = req.params;
    const { columnId, beforeId, afterId } = req.body;
    
    // Validate card exists
    const card = await pg.query(
      'SELECT * FROM cards WHERE id = $1',
      [id]
    );
    
    if (card.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }
    
    // Calculate new position
    const position = calculatePosition(afterId, beforeId);
    
    // Get current column to check if changing column
    const currentColumnId = card.rows[0].column_id;
    
    // Update in a transaction
    await pg.exec(`
      BEGIN;
      
      -- Remove card from old column
      UPDATE cards 
      SET column_id = $2, position = $3 
      WHERE id = $1;
      
      -- Renormalize if we changed columns or need to fix positions
      -- Note: We'll handle renormalization in the update by checking if positions need fixing
      
      COMMIT;
    `, [id, columnId, position]);
    
    // Check if we need to renormalize due to position collision or precision issues
    const newRange = await getColumnPositionRange(columnId);
    
    // If we added a position in the middle of existing cards and it collides, renormalize
    if (position !== null && newRange.min_pos !== newRange.max_pos) {
      const cards = await pg.query(
        'SELECT id, position FROM cards WHERE column_id = $1',
        [columnId]
      );
      
      // Check if there are duplicate or colliding positions
      const positions = cards.rows.map(c => parseFloat(c.position));
      const hasDuplicates = positions.length !== new Set(positions).size;
      const hasCollisions = positions.some(p => 
        positions.some(q => Math.abs(p - q) < 0.001 && p !== q)
      );
      
      if (hasDuplicates || hasCollisions) {
        await renormalizeColumnPositions(columnId);
      }
    }
    
    // Get the updated card
    const updatedCard = await pg.query(
      'SELECT * FROM cards WHERE id = $1',
      [id]
    );
    
    broadcast({
      type: 'card-moved',
      card: updatedCard.rows[0]
    });
    
    res.json(updatedCard.rows[0]);
  } catch (error) {
    console.error('Error moving card:', error);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

// SSE endpoint
const clients = [];
app.get('/api/stream', (req, res) => {
  req.socket.setTimeout(0);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  clients.push(res);
  
  req.on('close', () => {
    const index = clients.indexOf(res);
    if (index > -1) {
      clients.splice(index, 1);
    }
  });
});

// Broadcast event to all clients
function broadcast(event) {
  const message = `data: ${JSON.stringify(event)}\n\n`;
  clients.forEach(client => {
    client.write(message);
  });
}

// Start server
async function start() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
