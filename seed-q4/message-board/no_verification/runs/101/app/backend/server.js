const express = require('express');
const cors = require('cors');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs').promises;
const path = require('path');
const { fileURLToPath } = require('url');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'pglite_data');

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Initialize PGLite
let db;
async function initDB() {
  try {
    // Create data directory if it doesn't exist
    await fs.mkdir(DB_PATH, { recursive: true });
    
    // Initialize PGLite
    db = new PGlite({ 
      path: DB_PATH 
    });
    
    // Run initialization script
    const initSql = await fs.readFile(path.join(__dirname, 'init.sql'), 'utf8');
    await db.exec(initSql);
    
    console.log('PGLite database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
}

// Store active SSE connections
const clients = new Set();

// SSE endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Add client to the set
  const clientId = Date.now().toString();
  const client = {
    id: clientId,
    res
  };
  clients.add(client);
  
  console.log(`New SSE client connected (total: ${clients.size})`);
  
  // Send initial comment to prevent browser from closing the connection
  res.write(': initial connection established\n\n');
  
  // Handle client disconnect
  req.on('close', () => {
    clients.delete(client);
    console.log(`SSE client disconnected (total: ${clients.size})`);
  });
});

// Get all messages
app.get('/api/messages', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM messages ORDER BY created_at DESC');
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
    
    const result = await db.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at',
      [text.trim()]
    );
    
    const newMessage = result.rows[0];
    
    // Broadcast to all SSE clients
    clients.forEach(client => {
      client.res.write(`data: ${JSON.stringify(newMessage)}\n\n`);
    });
    
    res.status(201).json(newMessage);
  } catch (error) {
    console.error('Error creating message:', error);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

// Start server
async function startServer() {
  try {
    await initDB();
    
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();