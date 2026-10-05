import express from 'express';
import cors from 'cors';
import { PGLite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Express Setup ---
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// --- SSE Connection Management ---
const sseClients = new Set();

// --- PGLite Initialization ---
const dbDir = path.join(__dirname, 'pglite-data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db;

async function initDB() {
  db = new PGLite({
    dataDir: dbDir,
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

  console.log('PGLite initialized and messages table ready.');
}

// --- API Routes ---

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

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
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
  res.flushHeaders();

  // Send an initial comment to keep the connection alive
  res.write(': connected\n\n');

  // Add client to set
  sseClients.add(res);

  // Handle client disconnection
  req.on('close', () => {
    sseClients.delete(res);
  });
});

// --- SSE Broadcast Helper ---
function broadcast(message) {
  const data = JSON.stringify(message);
  const event = `data: ${data}\n\n`;

  // Remove any clients that fail to write (disconnected)
  for (const client of sseClients) {
    try {
      if (!client.writableEnded) {
        client.write(event);
      }
    } catch (err) {
      console.error('Error writing to SSE client:', err);
      sseClients.delete(client);
    }
  }
}

// --- Start Server ---
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
