const express = require('express');
const cors = require('cors');
const { PGlite } = require('@electric-sql/pglite');
const path = require('path');
const fs = require('fs').promises;

// Create necessary directories if they don't exist
const DATA_DIR = path.join(__dirname, '../data');

// Initialize Express app
const app = express();
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  methods: ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// Initialize PGlite
let db;
async function initDB() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  db = new PGlite({ 
    dir: DATA_DIR,
    defaultDatabase: 'kanban'
  });
  
  // Create tables if they don't exist
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS columns (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        position REAL NOT NULL DEFAULT 0
      );
      
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        column_id TEXT NOT NULL REFERENCES columns(id),
        text TEXT NOT NULL,
        position REAL NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE
      );
    `);
    
    // Seed default columns if none exist
    const columnsCount = await db.query('SELECT COUNT(*) FROM columns');
    console.log('Columns count:', columnsCount.rows[0].count);
    
    if (columnsCount.rows[0].count === '0') {
      await db.exec(`
        INSERT INTO columns (id, title, position) VALUES
        ('todo', 'To Do', 0),
        ('in-progress', 'In Progress', 1),
        ('done', 'Done', 2);
      `);
      console.log('Seeded default columns');
    }
    
    // Verify columns were created
    const columns = await db.query('SELECT * FROM columns');
    console.log('Columns in database:', columns.rows);
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// API endpoints
app.get('/api/board', async (req, res) => {
  try {
    const columns = await db.query(`
      SELECT c.id, c.title, c.position, 
             json_agg(json_build_object(
               'id', ca.id,
               'text', ca.text,
               'position', ca.position,
               'created_at', ca.created_at
             ) ORDER BY ca.position ASC) AS cards
      FROM columns c
      LEFT JOIN cards ca ON c.id = ca.column_id
      GROUP BY c.id, c.title, c.position
      ORDER BY c.position ASC;
    `);
    
    res.json(columns.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch board data' });
  }
});

app.post('/api/cards', async (req, res) => {
  try {
    const { columnId, text } = req.body;
    
    // Get the highest position in the column
    const result = await db.query(
      'SELECT MAX(position) AS max_pos FROM cards WHERE column_id = $1',
      [columnId]
    );
    
    const maxPos = result.rows[0].max_pos || 0;
    const newPosition = maxPos + 1;
    
    // Generate a unique ID
    const cardId = `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Insert the new card
    await db.exec(
      'INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4)',
      [cardId, columnId, text, newPosition]
    );
    
    // Get the full card data to return
    const card = await db.query(
      'SELECT * FROM cards WHERE id = $1',
      [cardId]
    );
    
    // Broadcast the event to all SSE clients
    broadcastEvent('cardCreated', card.rows[0]);
    
    res.json(card.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create card' });
  }
});

app.patch('/api/cards/:id/move', async (req, res) => {
  try {
    const { id } = req.params;
    const { columnId, beforeId, afterId } = req.body;
    
    // Start a transaction to ensure atomicity
    await db.beginTransaction();
    
    try {
      // Get the card we're moving
      const cardResult = await db.query('SELECT * FROM cards WHERE id = $1 FOR UPDATE', [id]);
      if (cardResult.rows.length === 0) {
        await db.rollbackTransaction();
        return res.status(404).json({ error: 'Card not found' });
      }
      
      const card = cardResult.rows[0];
      
      // If we're moving to a different column, remove from current column first
      if (card.column_id !== columnId) {
        await db.exec('DELETE FROM cards WHERE id = $1', [id]);
      }
      
      // Calculate new position
      let newPosition;
      
      if (beforeId && afterId) {
        // Between two cards
        const beforeCard = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
        const afterCard = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);
        
        if (beforeCard.rows.length === 0 || afterCard.rows.length === 0) {
          await db.rollbackTransaction();
          return res.status(400).json({ error: 'Before or after card not found' });
        }
        
        newPosition = (parseFloat(beforeCard.rows[0].position) + parseFloat(afterCard.rows[0].position)) / 2;
      } else if (beforeId) {
        // Before a specific card
        const beforeCard = await db.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
        if (beforeCard.rows.length === 0) {
          await db.rollbackTransaction();
          return res.status(400).json({ error: 'Before card not found' });
        }
        newPosition = parseFloat(beforeCard.rows[0].position) - 0.1;
      } else if (afterId) {
        // After a specific card
        const afterCard = await db.query('SELECT position FROM cards WHERE id = $1', [afterId]);
        if (afterCard.rows.length === 0) {
          await db.rollbackTransaction();
          return res.status(400).json({ error: 'After card not found' });
        }
        newPosition = parseFloat(afterCard.rows[0].position) + 0.1;
      } else {
        // At the end of the column
        const maxPosResult = await db.query('SELECT MAX(position) AS max_pos FROM cards WHERE column_id = $1', [columnId]);
        newPosition = (maxPosResult.rows[0].max_pos || 0) + 1;
      }
      
      // Handle position collisions
      const cardsAtPosition = await db.query(
        'SELECT id FROM cards WHERE column_id = $1 AND position = $2',
        [columnId, newPosition]
      );
      
      if (cardsAtPosition.rows.length > 0) {
        // Renormalize positions in the column
        await renormalizePositions(columnId);
        
        // Recalculate position after renormalization
        const maxPosResult = await db.query('SELECT MAX(position) AS max_pos FROM cards WHERE column_id = $1', [columnId]);
        newPosition = (maxPosResult.rows[0].max_pos || 0) + 1;
      }
      
      // Insert the card in the new position
      await db.exec(
        'INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4)',
        [card.id, columnId, card.text, newPosition]
      );
      
      // Commit the transaction
      await db.commitTransaction();
      
      // Get the updated card data
      const updatedCard = await db.query('SELECT * FROM cards WHERE id = $1', [card.id]);
      
      // Broadcast the event to all SSE clients
      broadcastEvent('cardMoved', {
        card: updatedCard.rows[0],
        oldColumnId: card.column_id
      });
      
      res.json(updatedCard.rows[0]);
    } catch (error) {
      await db.rollbackTransaction();
      res.status(500).json({ error: 'Failed to move card' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to start transaction' });
  }
});

// SSE endpoint
const sseClients = new Set();

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send initial data
  res.write('event: init\ndata: {"type": "init"}\n\n');
  
  // Add client to the set
  const clientId = Date.now();
  const client = {
    id: clientId,
    res: res
  };
  
  sseClients.add(client);
  
  // Remove client on connection close
  req.on('close', () => {
    sseClients.delete(client);
  });
});

// Function to broadcast events to all SSE clients
function broadcastEvent(eventType, data) {
  const eventData = JSON.stringify(data);
  
  for (const client of sseClients) {
    try {
      client.res.write(`event: ${eventType}\ndata: ${eventData}\n\n`);
    } catch (error) {
      // Client disconnected, remove from set
      sseClients.delete(client);
    }
  }
}

// Function to renormalize positions in a column
async function renormalizePositions(columnId) {
  const cards = await db.query(
    'SELECT id, position FROM cards WHERE column_id = $1 ORDER BY position ASC',
    [columnId]
  );
  
  // Assign new positions starting from 0, incrementing by 1
  for (let i = 0; i < cards.rows.length; i++) {
    await db.exec(
      'UPDATE cards SET position = $1 WHERE id = $2',
      [i, cards.rows[i].id]
    );
  }
  
  // Broadcast the renormalization event
  broadcastEvent('positionsRenormalized', { columnId, cards: cards.rows });
}

// Start server
const PORT = 3000;
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});