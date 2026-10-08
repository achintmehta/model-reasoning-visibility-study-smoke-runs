const express = require('express');
const cors = require('cors');
const pgModule = require('@electric-sql/pglite');
// PGLite uses a lazy-loaded getter that requires `this` context to resolve
const PGLite = Object.getOwnPropertyDescriptor(pgModule, 'PGlite').get.call(pgModule);
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Store active SSE connections
let sseConnections = [];

// PGLite data directory
const DATA_DIR = path.join(__dirname, 'pglite-data');

async function initDB() {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new PGLite({
    WALMode: 'filesystem',
    filename: path.join(DATA_DIR, 'pglite')
  });

  await db.waitReady;

  // Create messages table if it doesn't exist
  await db.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  return db;
}

let db;

async function startServer() {
  db = await initDB();
  console.log('PGLite database initialized');

  // GET /api/messages - Fetch all messages (historical data)
  app.get('/api/messages', async (req, res) => {
    try {
      const result = await db.query(
        'SELECT id, text, created_at FROM messages ORDER BY created_at ASC'
      );
      // Format dates as ISO strings
      const messages = result.rows.map(row => ({
        id: row.id,
        text: row.text,
        created_at: row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(row.created_at).toISOString()
      }));
      res.json(messages);
    } catch (err) {
      console.error('Error fetching messages:', err);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  // POST /api/messages - Create a new message and broadcast via SSE
  app.post('/api/messages', async (req, res) => {
    try {
      const { text } = req.body;

      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'Message text is required' });
      }

      const result = await db.query(
        'INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at',
        [text.trim()]
      );

      const message = result.rows[0];
      message.created_at = message.created_at instanceof Date
        ? message.created_at.toISOString()
        : new Date(message.created_at).toISOString();

      // Broadcast to all SSE connections
      broadcastMessage(message);

      res.status(201).json(message);
    } catch (err) {
      console.error('Error creating message:', err);
      res.status(500).json({ error: 'Failed to create message' });
    }
  });

  // GET /api/stream - SSE endpoint for real-time updates
  app.get('/api/stream', (req, res) => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering if behind proxy

    // Send initial comment to prevent caching issues
    res.write(': connected\n\n');

    // Add connection to active list
    const connection = res;
    sseConnections.push(connection);

    // Handle client disconnect
    req.on('close', () => {
      sseConnections = sseConnections.filter(conn => conn !== connection);
    });
  });

  function broadcastMessage(message) {
    const data = JSON.stringify(message);
    const event = `data: ${data}\n\n`;

    const disconnected = [];
    for (const conn of sseConnections) {
      try {
        if (!conn.writableEnded) {
          conn.write(event);
        } else {
          disconnected.push(conn);
        }
      } catch (err) {
        console.error('Error broadcasting to client:', err);
        disconnected.push(conn);
      }
    }

    // Clean up disconnected clients
    if (disconnected.length > 0) {
      sseConnections = sseConnections.filter(
        conn => !disconnected.includes(conn)
      );
    }
  }

  app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
