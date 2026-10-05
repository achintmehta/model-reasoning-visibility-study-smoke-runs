const express = require('express');
const cors = require('cors');
const pg = require('@electric-sql/pglite');
const fs = require('fs');
const path = require('path');

// PGLite is lazily loaded via getter - access it properly
const PGLite = Object.getOwnPropertyDescriptor(pg, 'PGlite').get.call(pg);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// SSE clients tracking
const sseClients = new Set();

// Ensure data directory exists for PGLite persistence
const DATA_DIR = path.join(__dirname, '..', 'pglite-data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize PGLite
let db;

async function initDB() {
  db = new PGLite({
    dataDirectory: DATA_DIR,
  });

  // Wait for PGLite to be ready (it initializes automatically)
  await db.waitReady;

  // Create messages table if it doesn't exist
  await db.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('PGLite database initialized successfully');
}

// GET /api/messages - Fetch all messages
app.get('/api/messages', async (req, res) => {
  try {
    const result = await db.query('SELECT id, text, created_at FROM messages ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/messages - Create a new message
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
    broadcastMessage(newMessage);

    res.status(201).json(newMessage);
  } catch (err) {
    console.error('Error creating message:', err);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

// GET /api/stream - SSE endpoint
app.get('/api/stream', (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial comment to keep connection alive
  res.write(': connected\n\n');

  // Add client to set
  sseClients.add(res);

  // Handle client disconnect
  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Broadcast a message to all connected SSE clients
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
}

// Start server
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
