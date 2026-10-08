import express from 'express';
import cors from 'cors';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// SSE connections tracker
const sseConnections = new Set();

// Broadcast a message to all connected SSE clients
function broadcast(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseConnections) {
    try {
      res.write(message);
    } catch (err) {
      // Connection may have been closed, remove it
      sseConnections.delete(res);
    }
  }
}

// Initialize PGLite with filesystem persistence
const dbPath = resolve(process.cwd(), 'pglite-data');
if (!existsSync(dbPath)) {
  mkdirSync(dbPath, { recursive: true });
}

let db;

async function initDatabase() {
  // Dynamic import to avoid ESM issues with PGLite
  const { PGlite } = await import('@electric-sql/pglite');

  db = new PGlite('pglite-data');

  await db.waitReady;

  // Create the messages table if it doesn't exist
  await db.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('Database initialized successfully');
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

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Message text is required' });
    }

    const result = await db.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at',
      [text.trim()]
    );

    const newMessage = result.rows[0];

    // Broadcast to all SSE clients
    broadcast(newMessage);

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
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial comment to keep connection alive
  res.write(': connected\n\n');

  // Add to active connections
  sseConnections.add(res);

  // Handle client disconnect
  req.on('close', () => {
    sseConnections.delete(res);
  });

  req.on('error', () => {
    sseConnections.delete(res);
  });
});

// Start server
async function start() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
