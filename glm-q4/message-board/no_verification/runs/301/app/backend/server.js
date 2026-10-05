const express = require('express');
const { PGLite } = require('@electric-sql/pglite');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize PGLite with persistence
const pglite = new PGLite({
  dataDir: './pglite-data',
  blob: {
    type: 'fs',
    path: './pglite-data'
  }
});

// Store SSE connections
const clients = new Set();

// Initialize database
async function initDatabase() {
  try {
    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

// Get all messages
app.get('/api/messages', async (req, res) => {
  try {
    const result = await pglite.exec('SELECT * FROM messages ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Error fetching messages' });
  }
});

// SSE endpoint - stream new messages
app.get('/api/stream', (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Add client to the set of active connections
  clients.add(res);

  // Clean up client when connection closes
  req.on('close', () => {
    clients.delete(res);
  });

  console.log('Client connected to SSE');
});

// Post a new message
app.post('/api/messages', async (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Message text is required' });
  }

  try {
    // Insert message into database
    await pglite.exec('INSERT INTO messages (text) VALUES ($1)', [text]);

    // Broadcast to all connected clients
    const newMessage = { text, created_at: new Date().toISOString() };
    broadcastMessage(newMessage);

    res.status(201).json({ success: true, message: newMessage });
  } catch (error) {
    console.error('Error creating message:', error);
    res.status(500).json({ error: 'Error creating message' });
  }
});

// Broadcast message to all SSE clients
function broadcastMessage(message) {
  const data = `data: ${JSON.stringify(message)}\n\n`;

  for (const client of clients) {
    try {
      client.write(data);
    } catch (error) {
      console.error('Error writing to client:', error);
      clients.delete(client);
    }
  }
}

// Initialize database and start server
async function startServer() {
  await initDatabase();

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`SSE endpoint: http://localhost:${PORT}/api/stream`);
    console.log(`API endpoint: http://localhost:${PORT}/api/messages`);
  });
}

startServer();
