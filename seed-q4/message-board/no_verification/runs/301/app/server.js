const express = require('express');
const cors = require('cors');
const { PGLite } = require('@electric-sql/pglite');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create data directory if it doesn't exist
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// Initialize PGLite with file system persistence
const db = new PGLite({ 
  path: path.join(DATA_DIR, 'message-board.db') 
});

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the frontend build directory in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'frontend', 'dist')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
  });
}

// Database initialization - create messages table if it doesn't exist
async function initDB() {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

// Store active SSE connections
const sseConnections = new Set();

// SSE endpoint - stream new messages to clients
app.get('/api/stream', (req, res) => {
  console.log('New SSE connection established');
  
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send initial comment to prevent browser from closing the connection
  res.write(': heartbeat\n\n');
  
  // Add connection to the set
  sseConnections.add(res);
  
  // Handle client disconnect
  req.on('close', () => {
    console.log('SSE connection closed');
    sseConnections.delete(res);
  });
});

// Get all messages (for initial load)
app.get('/api/messages', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, text, created_at 
      FROM messages 
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Post a new message
app.post('/api/messages', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Message text is required' });
    }
    
    // Insert message into database
    const result = await db.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at',
      [text.trim()]
    );
    
    const newMessage = result.rows[0];
    
    // Broadcast the new message to all active SSE connections
    sseConnections.forEach(conn => {
      conn.write(`data: ${JSON.stringify(newMessage)}\n\n`);
    });
    
    res.status(201).json(newMessage);
  } catch (error) {
    console.error('Error creating message:', error);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

// Start server after initializing DB
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Frontend available at http://localhost:${PORT}`);
  });
});