import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Ensure data directory exists for PGLite persistence
const dataDir = join(__dirname, 'pglite-data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize PGLite with filesystem persistence
const db = new PGlite({
  dataDir: `file://${dataDir}`,
});

// SSE clients registry - store raw res objects instead of wrapping write
const sseClients = [];

// ---- Database Initialization ----

async function initDatabase() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  console.log('Database initialized.');
}

// ---- API Routes ----

// GET /api/messages - Fetch all messages
app.get('/api/messages', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, text, created_at FROM messages ORDER BY created_at ASC'
    );
    const messages = result.rows.map((row) => ({
      id: row.id,
      text: row.text,
      created_at: row.created_at,
    }));
    res.json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/messages - Insert a new message and broadcast via SSE
app.post('/api/messages', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    const result = await db.query(
      "INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at",
      [text]
    );
    const message = {
      id: result.rows[0].id,
      text: result.rows[0].text,
      created_at: result.rows[0].created_at,
    };

    // Broadcast to all SSE clients
    broadcast(message);

    res.status(201).json(message);
  } catch (err) {
    console.error('Error inserting message:', err);
    res.status(500).json({ error: 'Failed to insert message' });
  }
});

// GET /api/stream - SSE endpoint for real-time updates
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);

  req.on('close', () => {
    const index = sseClients.indexOf(res);
    if (index !== -1) {
      sseClients.splice(index, 1);
    }
  });
});

// Broadcast function
function broadcast(message) {
  const data = JSON.stringify(message);
  const payload = `data: ${data}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (err) {
      console.error('SSE broadcast error:', err);
    }
  }
}

// ---- Start Server ----

async function start() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
