import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize PGLite with filesystem persistence
const DATA_DIR = join(__dirname, '..', 'data');
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = join(DATA_DIR, 'messages.db');
const db = await new PGlite({
  dataDir: DB_PATH,
  relaxedDurability: true,
});

// Initialize database schema
await db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

// SSE connections storage
const clients = [];

// GET /api/messages - Fetch all messages
app.get('/api/messages', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, text, created_at FROM messages ORDER BY created_at ASC'
    );
    const messages = result.rows.map(row => ({
      id: row.id,
      text: row.text,
      created_at: row.created_at
    }));
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET /api/stream - SSE endpoint for real-time updates
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const client = { res };
  clients.push(client);

  // Send a connection event
  res.write('event: connected\ndata: {"status":"connected"}\n\n');

  // Handle client disconnect
  req.on('close', () => {
    const index = clients.indexOf(client);
    if (index > -1) {
      clients.splice(index, 1);
    }
  });
});

// Broadcast a message to all connected SSE clients
function broadcast(message) {
  const data = JSON.stringify(message);
  clients.forEach(client => {
    client.res.write(`event: message\ndata: ${data}\n\n`);
  });
}

// POST /api/messages - Create a new message
app.post('/api/messages', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required and must be a string' });
    }

    const result = await db.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at',
      [text.trim()]
    );

    const message = {
      id: result.rows[0].id,
      text: result.rows[0].text,
      created_at: result.rows[0].created_at
    };

    // Broadcast to all SSE clients
    broadcast(message);

    res.status(201).json(message);
  } catch (error) {
    console.error('Error creating message:', error);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Message board server running on http://localhost:${PORT}`);
  console.log(`Database persisted at: ${DB_PATH}`);
});
