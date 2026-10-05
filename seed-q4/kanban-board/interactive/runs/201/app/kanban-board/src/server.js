import express from 'express';
import cors from 'cors';
import { initDB, getBoardState, createCard, moveCard, renormalizeColumnPositions } from './db.js';
import { initSSE, broadcastEvent } from './sse.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
let db;

async function startServer() {
  try {
    db = await initDB();
    console.log('Database initialized successfully');
    
    // Start server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// API Endpoints

// Get board state
app.get('/api/board', async (req, res) => {
  try {
    const boardState = await getBoardState();
    res.json(boardState);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get board state' });
  }
});

// Create a new card
app.post('/api/cards', async (req, res) => {
  try {
    const { columnId, text } = req.body;
    
    if (!columnId || !text) {
      return res.status(400).json({ error: 'columnId and text are required' });
    }
    
    const card = await createCard(columnId, text);
    
    // Broadcast the card creation
    broadcastEvent('cardCreated', card);
    
    res.status(201).json(card);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create card' });
  }
});

// Move a card
app.patch('/api/cards/:id/move', async (req, res) => {
  try {
    const { id } = req.params;
    const { columnId, beforeId, afterId } = req.body;
    
    if (!columnId) {
      return res.status(400).json({ error: 'columnId is required' });
    }
    
    const card = await moveCard(id, columnId, beforeId, afterId);
    
    // Broadcast the card movement
    broadcastEvent('cardMoved', { card, columnId });
    
    res.json(card);
  } catch (error) {
    res.status(500).json({ error: 'Failed to move card' });
  }
});

// Renormalize column positions
app.post('/api/columns/:id/renormalize', async (req, res) => {
  try {
    const { id } = req.params;
    const cards = await renormalizeColumnPositions(id);
    
    // Broadcast the column update
    broadcastEvent('columnRenormalized', { columnId: id, cards });
    
    res.json(cards);
  } catch (error) {
    res.status(500).json({ error: 'Failed to renormalize column positions' });
  }
});

// SSE endpoint
app.get('/api/stream', (req, res) => {
  initSSE(req, res);
});

// Serve frontend static files - this should come after all API routes
app.use(express.static(path.join(__dirname, '../frontend/public')));

// Start the server
startServer();