const express = require('express');
const cors = require('cors');
const { PGlite } = require('@electric-sql/pglite');
const path = require('path');
const fs = require('fs').promises;

// Create data directory if it doesn't exist
const DATA_DIR = path.join(__dirname, 'pglite-data');

async function initServer() {
  // Ensure data directory exists
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log(`Created PGLite data directory at ${DATA_DIR}`);
  }

  // Initialize PGLite
  const db = new PGlite({
    auth: { username: 'postgres', password: 'postgres' },
    path: DATA_DIR
  });

  // Initialize database schema
  await initSchema(db);
  
  // Seed initial data
  await seedInitialData(db);

  // Set up Express server
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve frontend in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'frontend/dist')));
  }

  // API endpoints
  app.get('/api/board', async (req, res) => {
    try {
      const board = await getBoardState(db);
      res.json(board);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/cards', async (req, res) => {
    try {
      const card = await createCard(db, req.body);
      broadcastEvent('cardCreated', card);
      res.status(201).json(card);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch('/api/cards/:id/move', async (req, res) => {
    try {
      const card = await moveCard(db, req.params.id, req.body);
      broadcastEvent('cardMoved', card);
      res.json(card);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // SSE endpoint
  const clients = new Set();
  
  app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Send initial board state
    getBoardState(db).then(board => {
      res.write(`event: initialBoard\ndata: ${JSON.stringify(board)}\n\n`);
    });
    
    // Add client to set
    const clientId = Date.now();
    const client = {
      id: clientId,
      res
    };
    clients.add(client);
    
    // Handle client disconnect
    req.on('close', () => {
      clients.delete(client);
    });
  });

  // Broadcast function for SSE
  function broadcastEvent(eventType, data) {
    clients.forEach(client => {
      client.res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    });
  }

  // Start server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Database helper functions
  async function initSchema(db) {
    // Create columns table
    await db.query(`
      CREATE TABLE IF NOT EXISTS columns (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        position NUMERIC NOT NULL DEFAULT 0
      )
    `);
    
    // Create cards table
    await db.query(`
      CREATE TABLE IF NOT EXISTS cards (
        id SERIAL PRIMARY KEY,
        column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        position NUMERIC NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create index
    await db.query(`
      CREATE INDEX IF NOT EXISTS cards_column_position_idx 
      ON cards (column_id, position)
    `);
    
    console.log('Database schema initialized');
  }

  async function seedInitialData(db) {
    const columnCount = await db.query('SELECT COUNT(*) FROM columns');
    if (columnCount.rows[0].count === '0') {
      await db.query(`
        INSERT INTO columns (title, position) 
        VALUES 
          ('To Do', 0),
          ('In Progress', 1),
          ('Done', 2)
      `);
      console.log('Seeded initial columns');
    }
  }

  async function getBoardState(db) {
    const columnsResult = await db.query('SELECT * FROM columns ORDER BY position ASC');
    const columns = columnsResult.rows;
    
    for (const column of columns) {
      const cardsResult = await db.query(
        'SELECT * FROM cards WHERE column_id = $1 ORDER BY position ASC',
        [column.id]
      );
      column.cards = cardsResult.rows;
    }
    
    return { columns };
  }

  async function createCard(db, { columnId, text }) {
    // Get the highest position in the target column
    const result = await db.query(
      'SELECT MAX(position) AS max_position FROM cards WHERE column_id = $1',
      [columnId]
    );
    
    const maxPosition = result.rows[0].max_position || 0;
    const newPosition = maxPosition + 1; // Simple increment for now
    
    const insertResult = await db.query(
      'INSERT INTO cards (column_id, text, position) VALUES ($1, $2, $3) RETURNING *',
      [columnId, text, newPosition]
    );
    
    return insertResult.rows[0];
  }

  // Helper function to renormalize positions in a column
  async function renormalizeColumnPositions(db, columnId) {
    // Get all cards in the column sorted by position
    const cardsResult = await db.query(
      'SELECT id, position FROM cards WHERE column_id = $1 ORDER BY position ASC',
      [columnId]
    );
    
    const cards = cardsResult.rows;
    
    if (cards.length <= 1) {
      // No need to renormalize if there are 0 or 1 cards
      return;
    }
    
    // Assign new positions with 1.0 spacing
    for (let i = 0; i < cards.length; i++) {
      await db.query(
        'UPDATE cards SET position = $1 WHERE id = $2',
        [i, cards[i].id]
      );
    }
    
    console.log(`Renormalized positions for column ${columnId}`);
    
    // Broadcast the updated column to all clients
    const columnResult = await db.query(
      'SELECT * FROM columns WHERE id = $1',
      [columnId]
    );
    
    const column = columnResult.rows[0];
    
    const cardsResultUpdated = await db.query(
      'SELECT * FROM cards WHERE column_id = $1 ORDER BY position ASC',
      [columnId]
    );
    
    column.cards = cardsResultUpdated.rows;
    
    broadcastEvent('columnRenormalized', column);
  }
  
  async function moveCard(db, cardId, { columnId, beforeId, afterId }) {
    // Start transaction
    await db.beginTransaction();
    
    try {
      // Get the card we're moving
      const cardResult = await db.query(
        'SELECT * FROM cards WHERE id = $1 FOR UPDATE',
        [cardId]
      );
      
      if (!cardResult.rows[0]) {
        throw new Error('Card not found');
      }
      
      const card = cardResult.rows[0];
      
      // If moving to a different column, remove from current column first
      if (card.column_id !== columnId) {
        await db.query('DELETE FROM cards WHERE id = $1', [cardId]);
      }
      
      // Get the new position
      let newPosition;
      
      if (beforeId && afterId) {
        throw new Error('Specify either beforeId or afterId, not both');
      }
      
      if (beforeId) {
        // Insert before the card with beforeId
        const beforeCard = await db.query(
          'SELECT position FROM cards WHERE id = $1 AND column_id = $2 FOR UPDATE',
          [beforeId, columnId]
        );
        
        if (!beforeCard.rows[0]) {
          throw new Error('Before card not found in target column');
        }
        
        newPosition = (beforeCard.rows[0].position - 1) / 2;
      } else if (afterId) {
        // Insert after the card with afterId
        const afterCard = await db.query(
          'SELECT position FROM cards WHERE id = $1 AND column_id = $2 FOR UPDATE',
          [afterId, columnId]
        );
        
        if (!afterCard.rows[0]) {
          throw new Error('After card not found in target column');
        }
        
        newPosition = (afterCard.rows[0].position + 1) / 2;
      } else {
        // Append to the end of the column
        const maxPositionResult = await db.query(
          'SELECT MAX(position) AS max_position FROM cards WHERE column_id = $1',
          [columnId]
        );
        
        newPosition = (maxPositionResult.rows[0].max_position || 0) + 1;
      }
      
      // Check for position collisions (this is a simple check; in a real app
      // you might want to check for a range of positions around the target)
      const collisionCheck = await db.query(
        'SELECT COUNT(*) AS count FROM cards WHERE column_id = $1 AND position = $2',
        [columnId, newPosition]
      );
      
      if (collisionCheck.rows[0].count > 0) {
        // If there's a collision, renormalize the entire column
        await renormalizeColumnPositions(db, columnId);
        
        // After renormalization, get the last position and append the card
        const maxPositionResult = await db.query(
          'SELECT MAX(position) AS max_position FROM cards WHERE column_id = $1',
          [columnId]
        );
        
        newPosition = (maxPositionResult.rows[0].max_position || 0) + 1;
      }
      
      // Insert the card in the new position
      const insertResult = await db.query(
        'INSERT INTO cards (column_id, text, position) VALUES ($1, $2, $3) RETURNING *',
        [columnId, card.text, newPosition]
      );
      
      // Commit transaction
      await db.commitTransaction();
      
      return insertResult.rows[0];
    } catch (error) {
      // Rollback transaction on error
      await db.rollbackTransaction();
      throw error;
    }
  }
}

// Start the server
initServer().catch(console.error);