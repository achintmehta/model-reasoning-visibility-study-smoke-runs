import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { fileURLToPath } from 'url';
// Simple UUID generator that doesn't rely on crypto
function generateId() {
  return 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

// Get __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create necessary directories
const DATA_DIR = path.join(__dirname, 'data');
const FRONTEND_PUBLIC = path.join(__dirname, 'frontend', 'public');

// Store active SSE connections
const sseClients = new Set();

// In-memory database
let boardData = {
  columns: [
    { id: 'todo', title: 'To Do', position: 0, cards: [] },
    { id: 'in-progress', title: 'In Progress', position: 1, cards: [] },
    { id: 'done', title: 'Done', position: 2, cards: [] }
  ]
};

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// API routes - these must come before static file serving
app.get('/api/board', (req, res) => {
  try {
    // Return a copy of the board data to prevent external modification
    const columnsWithCards = boardData.columns.map(column => ({
      ...column,
      cards: [...column.cards]
    }));
    
    res.json({ columns: columnsWithCards });
  } catch (error) {
    console.error('Error fetching board state:', error);
    res.status(500).json({ error: 'Failed to fetch board state' });
  }
});

app.post('/api/cards', (req, res) => {
  try {
    const { columnId, text } = req.body;
    
    if (!columnId || !text) {
      return res.status(400).json({ error: 'columnId and text are required' });
    }

    const column = getColumn(columnId);
    if (!column) {
      return res.status(404).json({ error: 'Column not found' });
    }

    // Get next position for the column
    const position = getNextPosition(columnId);
    
    // Create the card
    const cardId = generateId();
    const newCard = {
      id: cardId,
      column_id: columnId,
      text: text,
      position: position,
      created_at: new Date().toISOString()
    };
    
    // Add the card to the column
    column.cards.push(newCard);
    
    // Save changes
    saveBoardData();
    
    // Broadcast the update
    broadcastEvent('card-created', { columnId, column: { ...column } });
    
    // Return the created card
    res.status(201).json({ id: cardId, columnId, text, position });
  } catch (error) {
    console.error('Error creating card:', error);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

app.patch('/api/cards/:id/move', (req, res) => {
  try {
    const cardId = req.params.id;
    const { columnId, beforeId, afterId } = req.body;
    
    if (!columnId) {
      return res.status(400).json({ error: 'columnId is required' });
    }

    // Find the card and its current column
    const cardRef = getCard(cardId);
    if (!cardRef) {
      return res.status(404).json({ error: 'Card not found' });
    }
    
    const { card, column: sourceColumn } = cardRef;
    
    // If moving to the same column and no position change, do nothing
    if (sourceColumn.id === columnId && (!beforeId && !afterId)) {
      return res.json({ ...card, column_id: sourceColumn.id });
    }
    
    // Remove card from source column
    sourceColumn.cards = sourceColumn.cards.filter(c => c.id !== cardId);
    
    // Get target column
    const targetColumn = getColumn(columnId);
    if (!targetColumn) {
      // Put the card back in the source column
      sourceColumn.cards.push(card);
      saveBoardData();
      return res.status(404).json({ error: 'Target column not found' });
    }
    
    let position;
    
    // Calculate new position
    if (beforeId && afterId) {
      // Between two cards
      const beforeCard = targetColumn.cards.find(c => c.id === beforeId);
      const afterCard = targetColumn.cards.find(c => c.id === afterId);
      
      if (!beforeCard || !afterCard) {
        // Put the card back in the source column
        sourceColumn.cards.push(card);
        saveBoardData();
        return res.status(400).json({ error: 'Before or after card not found in target column' });
      }
      
      position = (beforeCard.position + afterCard.position) / 2;
    } else if (beforeId) {
      // Before a specific card
      const beforeCard = targetColumn.cards.find(c => c.id === beforeId);
      
      if (!beforeCard) {
        // Put the card back in the source column
        sourceColumn.cards.push(card);
        saveBoardData();
        return res.status(400).json({ error: 'Before card not found in target column' });
      }
      
      position = beforeCard.position - 0.1;
    } else if (afterId) {
      // After a specific card
      const afterCard = targetColumn.cards.find(c => c.id === afterId);
      
      if (!afterCard) {
        // Put the card back in the source column
        sourceColumn.cards.push(card);
        saveBoardData();
        return res.status(400).json({ error: 'After card not found in target column' });
      }
      
      position = afterCard.position + 0.1;
    } else {
      // End of the column
      position = getNextPosition(columnId);
    }
    
    // Update card's column and position
    card.column_id = columnId;
    card.position = position;
    
    // Add card to target column
    targetColumn.cards.push(card);
    
    // Save changes
    saveBoardData();
    
    // Prepare data for broadcast
    const sourceColumnForBroadcast = sourceColumn.cards.length > 0 
      ? { ...sourceColumn } 
      : null;
    const targetColumnForBroadcast = { ...targetColumn };
    
    // Broadcast the move
    broadcastEvent('card-moved', { 
      cardId, 
      sourceColumnId: sourceColumn.id, 
      targetColumnId: targetColumn.id,
      sourceColumn: sourceColumnForBroadcast,
      targetColumn: targetColumnForBroadcast
    });
    
    // Return the updated card
    res.json({ ...card, column_id: columnId });
  } catch (error) {
    console.error('Error moving card:', error);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

// SSE endpoint - must come before static file serving
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send initial heartbeat to keep connection alive
  const heartbeatInterval = setInterval(() => {
    res.write(':\n\n');
  }, 30000);
  
  // Add client to the set
  sseClients.add(res);
  
  // Handle client disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    sseClients.delete(res);
  });
});

// Serve static files from frontend/public
app.use(express.static(FRONTEND_PUBLIC));

// Serve index.html for all other routes to support client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC, 'index.html'));
});

// Initialize database (load from file or create initial data)
async function initDB() {
  try {
    // Create data directory if it doesn't exist
    try {
      await fsPromises.access(DATA_DIR);
    } catch {
      await fsPromises.mkdir(DATA_DIR, { recursive: true });
      console.log('Created data directory at', DATA_DIR);
    }

    // Try to load data from file
    const dataPath = path.join(DATA_DIR, 'board.json');
    try {
      const dataBuffer = await fsPromises.readFile(dataPath);
      boardData = JSON.parse(dataBuffer.toString());
      console.log('Loaded board data from file');
    } catch {
      // If file doesn't exist, use initial data
      console.log('Using initial board data');
      // Add some sample cards
      boardData.columns[0].cards.push({
        id: generateId(),
        text: 'Sample Task 1',
        position: 1,
        created_at: new Date().toISOString()
      });
      boardData.columns[0].cards.push({
        id: generateId(),
        text: 'Sample Task 2',
        position: 2,
        created_at: new Date().toISOString()
      });
      boardData.columns[1].cards.push({
        id: generateId(),
        text: 'Sample Task 3',
        position: 1,
        created_at: new Date().toISOString()
      });
    }

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Save board data to file
async function saveBoardData() {
  try {
    const dataPath = path.join(DATA_DIR, 'board.json');
    const dataString = JSON.stringify(boardData, null, 2);
    await fsPromises.writeFile(dataPath, dataString);
  } catch (error) {
    console.error('Error saving board data:', error);
  }
}

// Helper function to broadcast events to all SSE clients
function broadcastEvent(eventType, data) {
  const eventData = JSON.stringify(data);
  sseClients.forEach(client => {
    client.write(`event: ${eventType}\n`);
    client.write(`data: ${eventData}\n\n`);
  });
}

// Helper function to get the next available position in a column
function getNextPosition(columnId) {
  const column = boardData.columns.find(c => c.id === columnId);
  if (!column) return 1;
  
  const cards = column.cards;
  if (cards.length === 0) return 1; // First position in the column
  
  const lastPosition = cards[cards.length - 1].position;
  
  // Check for position collisions/exhaustion
  if (lastPosition > 1000000) {
    // Renormalize positions if they get too large
    renormalizePositions(columnId);
    return 1;
  }
  
  // Use a position between the last one and the one before it (if it exists)
  if (cards.length === 1) {
    return lastPosition + 1;
  }
  
  const prevPosition = cards[cards.length - 2].position;
  return (prevPosition + lastPosition) / 2;
}

// Helper function to renormalize positions in a column
function renormalizePositions(columnId) {
  const column = boardData.columns.find(c => c.id === columnId);
  if (!column) return;
  
  // Sort cards by position first to ensure correct order
  column.cards.sort((a, b) => a.position - b.position);
  
  // Renormalize positions
  for (let i = 0; i < column.cards.length; i++) {
    column.cards[i].position = i + 1;
  }
  
  // Save changes and broadcast update
  saveBoardData();
  broadcastEvent('column-update', { column });
}

// Helper function to get a column by ID
function getColumn(columnId) {
  return boardData.columns.find(c => c.id === columnId);
}

// Helper function to get a card by ID
function getCard(cardId) {
  for (const column of boardData.columns) {
    const card = column.cards.find(c => c.id === cardId);
    if (card) return { card, column };
  }
  return null;
}

// API endpoint to get board state
app.get('/api/board', (req, res) => {
  try {
    // Return a copy of the board data to prevent external modification
    const columnsWithCards = boardData.columns.map(column => ({
      ...column,
      cards: [...column.cards]
    }));
    
    res.json({ columns: columnsWithCards });
  } catch (error) {
    console.error('Error fetching board state:', error);
    res.status(500).json({ error: 'Failed to fetch board state' });
  }
});

// API endpoint to create a new card
app.post('/api/cards', (req, res) => {
  try {
    const { columnId, text } = req.body;
    
    if (!columnId || !text) {
      return res.status(400).json({ error: 'columnId and text are required' });
    }

    const column = getColumn(columnId);
    if (!column) {
      return res.status(404).json({ error: 'Column not found' });
    }

    // Get next position for the column
    const position = getNextPosition(columnId);
    
    // Create the card
    const cardId = generateId();
    const newCard = {
      id: cardId,
      column_id: columnId,
      text: text,
      position: position,
      created_at: new Date().toISOString()
    };
    
    // Add the card to the column
    column.cards.push(newCard);
    
    // Save changes
    saveBoardData();
    
    // Broadcast the update
    broadcastEvent('card-created', { columnId, column: { ...column } });
    
    // Return the created card
    res.status(201).json({ id: cardId, columnId, text, position });
  } catch (error) {
    console.error('Error creating card:', error);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

// API endpoint to move a card
app.patch('/api/cards/:id/move', (req, res) => {
  try {
    const cardId = req.params.id;
    const { columnId, beforeId, afterId } = req.body;
    
    if (!columnId) {
      return res.status(400).json({ error: 'columnId is required' });
    }

    // Find the card and its current column
    const cardRef = getCard(cardId);
    if (!cardRef) {
      return res.status(404).json({ error: 'Card not found' });
    }
    
    const { card, column: sourceColumn } = cardRef;
    
    // If moving to the same column and no position change, do nothing
    if (sourceColumn.id === columnId && (!beforeId && !afterId)) {
      return res.json({ ...card, column_id: sourceColumn.id });
    }
    
    // Remove card from source column
    sourceColumn.cards = sourceColumn.cards.filter(c => c.id !== cardId);
    
    // Get target column
    const targetColumn = getColumn(columnId);
    if (!targetColumn) {
      // Put the card back in the source column
      sourceColumn.cards.push(card);
      saveBoardData();
      return res.status(404).json({ error: 'Target column not found' });
    }
    
    let position;
    
    // Calculate new position
    if (beforeId && afterId) {
      // Between two cards
      const beforeCard = targetColumn.cards.find(c => c.id === beforeId);
      const afterCard = targetColumn.cards.find(c => c.id === afterId);
      
      if (!beforeCard || !afterCard) {
        // Put the card back in the source column
        sourceColumn.cards.push(card);
        saveBoardData();
        return res.status(400).json({ error: 'Before or after card not found in target column' });
      }
      
      position = (beforeCard.position + afterCard.position) / 2;
    } else if (beforeId) {
      // Before a specific card
      const beforeCard = targetColumn.cards.find(c => c.id === beforeId);
      
      if (!beforeCard) {
        // Put the card back in the source column
        sourceColumn.cards.push(card);
        saveBoardData();
        return res.status(400).json({ error: 'Before card not found in target column' });
      }
      
      position = beforeCard.position - 0.1;
    } else if (afterId) {
      // After a specific card
      const afterCard = targetColumn.cards.find(c => c.id === afterId);
      
      if (!afterCard) {
        // Put the card back in the source column
        sourceColumn.cards.push(card);
        saveBoardData();
        return res.status(400).json({ error: 'After card not found in target column' });
      }
      
      position = afterCard.position + 0.1;
    } else {
      // End of the column
      position = getNextPosition(columnId);
    }
    
    // Update card's column and position
    card.column_id = columnId;
    card.position = position;
    
    // Add card to target column
    targetColumn.cards.push(card);
    
    // Save changes
    saveBoardData();
    
    // Prepare data for broadcast
    const sourceColumnForBroadcast = sourceColumn.cards.length > 0 
      ? { ...sourceColumn } 
      : null;
    const targetColumnForBroadcast = { ...targetColumn };
    
    // Broadcast the move
    broadcastEvent('card-moved', { 
      cardId, 
      sourceColumnId: sourceColumn.id, 
      targetColumnId: targetColumn.id,
      sourceColumn: sourceColumnForBroadcast,
      targetColumn: targetColumnForBroadcast
    });
    
    // Return the updated card
    res.json({ ...card, column_id: columnId });
  } catch (error) {
    console.error('Error moving card:', error);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

// SSE endpoint to stream updates
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send initial heartbeat to keep connection alive
  const heartbeatInterval = setInterval(() => {
    res.write(':\n\n');
  }, 30000);
  
  // Add client to the set
  sseClients.add(res);
  
  // Handle client disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    sseClients.delete(res);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Frontend available at http://localhost:${PORT}`);
  });
});