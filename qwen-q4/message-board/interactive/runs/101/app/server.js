const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Load PGLite - use Object.assign to resolve lazy-loaded getters
const pgliteModule = require('@electric-sql/pglite');
const PGLite = Object.assign({}, pgliteModule).PGlite;

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend in production (when built)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
}

// SSE connections tracking
const sseClients = new Set();

// Initialize PGLite with persistence to local filesystem
const dataDir = path.join(__dirname, 'pglite-data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db;

async function initDB() {
  console.log('Initializing PGLite...');
  db = new PGLite({
    dataDirectory: dataDir,
    walMode: 'filesystem',
  });

  await db.waitReady;

  // Create messages table if it doesn't exist
  await db.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  console.log('Database initialized and ready.');
}

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

// POST /api/messages - Insert a new message and broadcast via SSE
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

    // Broadcast to all SSE clients
    broadcastMessage(newMessage);

    res.status(201).json(newMessage);
  } catch (err) {
    console.error('Error inserting message:', err);
    res.status(500).json({ error: 'Failed to post message' });
  }
});

// GET /api/stream - SSE endpoint for real-time updates
app.get('/api/stream', (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Add client to tracking set
  sseClients.add(res);

  // Handle client disconnect
  req.on('close', () => {
    sseClients.delete(res);
  });

  console.log(`SSE client connected. Total: ${sseClients.size}`);
});

// Broadcast a message to all active SSE connections
function broadcastMessage(message) {
  const data = JSON.stringify(message);
  const event = `data: ${data}\n\n`;

  const disconnected = [];
  for (const client of sseClients) {
    try {
      if (!client.writableEnded) {
        client.write(event);
      } else {
        disconnected.push(client);
      }
    } catch (err) {
      console.error('Error writing to SSE client:', err);
      disconnected.push(client);
    }
  }

  // Clean up disconnected clients
  for (const client of disconnected) {
    sseClients.delete(client);
  }

  console.log(`Broadcasted message ${message.id} to ${sseClients.size} clients.`);
}

// Start the server
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Backend server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
