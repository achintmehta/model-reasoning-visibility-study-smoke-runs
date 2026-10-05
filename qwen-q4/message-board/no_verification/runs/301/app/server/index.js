const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { PGLite } = require('@electric-sql/pglite');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// SSE clients tracking
const sseClients = new Set();

// Helper: send SSE event to all connected clients
function broadcast(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch (err) {
      // Client disconnected, cleanup will happen on 'close' event
      console.warn('Failed to send SSE event to client:', err.message);
    }
  }
}

// Initialize PGLite and start server
async function startServer() {
  // Ensure data directory exists
  const dataDir = path.join(__dirname, '..', 'pglite-data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Initialize PGLite with persistence
  const db = new PGLite({
    dataDirectory: dataDir
  });
  await db.waitReady;

  // Create messages table if it doesn't exist
  await db.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  console.log('PGLite initialized and messages table ready.');

  // GET /api/messages - Fetch all historical messages
  app.get('/api/messages', async (req, res) => {
    try {
      const result = await db.query('SELECT id, text, created_at FROM messages ORDER BY created_at ASC');
      res.json(result.rows);
    } catch (err) {
      console.error('Error fetching messages:', err);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  // POST /api/messages - Insert a new message
  app.post('/api/messages', async (req, res) => {
    try {
      const { text } = req.body;

      if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: 'Message text is required' });
      }

      const result = await db.query(
        'INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at',
        [text.trim()]
      );

      const newMessage = result.rows[0];
      console.log(`New message posted (id: ${newMessage.id})`);

      // Broadcast to all SSE clients
      broadcast(newMessage);

      res.status(201).json(newMessage);
    } catch (err) {
      console.error('Error posting message:', err);
      res.status(500).json({ error: 'Failed to post message' });
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

    // Add client to tracking set
    sseClients.add(res);
    console.log(`SSE client connected. Total: ${sseClients.size}`);

    // Handle client disconnection
    req.on('close', () => {
      sseClients.delete(res);
      console.log(`SSE client disconnected. Total: ${sseClients.size}`);
    });

    // Handle errors
    res.on('error', () => {
      sseClients.delete(res);
      console.log(`SSE client error. Total: ${sseClients.size}`);
    });
  });

  // Start listening
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
