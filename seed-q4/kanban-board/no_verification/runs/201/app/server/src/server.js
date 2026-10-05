import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { db, initDB, getBoardState, normalizePositions, findInsertPosition } from './db.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
await initDB();

// Store active SSE connections
const clients = new Set();

// SSE endpoint
app.get('/api/stream', (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send a comment to keep the connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  // Add client to the set
  const clientId = uuidv4();
  const client = { id: clientId, res };
  clients.add(client);

  // Send initial board state
  getBoardState().then(boardState => {
    res.write(`data: ${JSON.stringify({ type: 'initial-state', payload: boardState })}\n\n`);
  });

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(client);
    console.log(`Client disconnected: ${clientId}`);
  });

  console.log(`Client connected: ${clientId}`);
});

// Broadcast function
const broadcast = (event, data) => {
  const message = `data: ${JSON.stringify({ type: event, payload: data })}\n\n`;
  clients.forEach(client => {
    client.res.write(message);
  });
};

// Get board state endpoint
app.get('/api/board', async (req, res) => {
  try {
    const boardState = await getBoardState();
    res.json(boardState);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch board state' });
  }
});

// Create card endpoint
app.post('/api/cards', async (req, res) => {
  try {
    const { columnId, text } = req.body;
    
    if (!columnId || !text) {
      return res.status(400).json({ error: 'columnId and text are required' });
    }

    // Check if column exists
    const columnExists = await db.result(`
      SELECT EXISTS(SELECT 1 FROM columns WHERE id = $1);
    `, [columnId]);
    
    if (!columnExists.rows[0].exists) {
      return res.status(404).json({ error: `Column with id ${columnId} not found` });
    }

    // Find position for new card (append to end by default)
    const position = await findInsertPosition(columnId);
    
    // Generate card ID
    const cardId = uuidv4();
    
    // Insert card into database
    await db.exec(`
      INSERT INTO cards (id, column_id, text, position) 
      VALUES ($1, $2, $3, $4);
    `, [cardId, columnId, text, position]);

    // Get the full card object
    const newCard = await db.result(`
      SELECT * FROM cards WHERE id = $1;
    `, [cardId]);

    // Broadcast the new card
    broadcast('card-created', { card: newCard.rows[0], columnId });
    
    res.status(201).json(newCard.rows[0]);
  } catch (error) {
    console.error('Error creating card:', error);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

// Move card endpoint
app.patch('/api/cards/:id/move', async (req, res) => {
  try {
    const cardId = req.params.id;
    const { columnId, beforeId, afterId } = req.body;

    if (!columnId) {
      return res.status(400).json({ error: 'columnId is required' });
    }

    // Check if card exists
    const card = await db.result(`
      SELECT * FROM cards WHERE id = $1;
    `, [cardId]);
    
    if (card.rows.length === 0) {
      return res.status(404).json({ error: `Card with id ${cardId} not found` });
    }

    // Check if target column exists
    const columnExists = await db.result(`
      SELECT EXISTS(SELECT 1 FROM columns WHERE id = $1);
    `, [columnId]);
    
    if (!columnExists.rows[0].exists) {
      return res.status(404).json({ error: `Column with id ${columnId} not found` });
    }

    // Start transaction to ensure atomicity
    await db.transaction(async (tx) => {
      const currentCard = card.rows[0];
      
      // If moving to a different column, remove from source first
      if (currentCard.column_id !== columnId) {
        await tx.exec(`
          DELETE FROM cards WHERE id = $1;
        `, [cardId]);
      }

      // Find new position
      let position;
      try {
        position = await findInsertPosition(columnId, beforeId, afterId);
      } catch (error) {
        // If reference card not found, append to end
        position = await findInsertPosition(columnId);
      }

      // Insert/update card in target column
      await tx.exec(`
        INSERT INTO cards (id, column_id, text, position) 
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET 
          column_id = EXCLUDED.column_id,
          position = EXCLUDED.position;
      `, [cardId, columnId, currentCard.text, position]);

      // Check for position collisions and normalize if needed
      const cardsInColumn = await tx.result(`
        SELECT position FROM cards WHERE column_id = $1 ORDER BY position ASC;
      `, [columnId]);
      
      const positions = cardsInColumn.rows.map(c => c.position);
      const hasDuplicates = new Set(positions).size !== positions.length;
      
      if (hasDuplicates) {
        await normalizePositions(columnId);
      }
    });

    // Get the updated card
    const updatedCard = await db.result(`
      SELECT * FROM cards WHERE id = $1;
    `, [cardId]);

    // Broadcast the move
    broadcast('card-moved', { 
      card: updatedCard.rows[0], 
      sourceColumnId: card.rows[0].column_id,
      targetColumnId: columnId
    });
    
    res.json(updatedCard.rows[0]);
  } catch (error) {
    console.error('Error moving card:', error);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});