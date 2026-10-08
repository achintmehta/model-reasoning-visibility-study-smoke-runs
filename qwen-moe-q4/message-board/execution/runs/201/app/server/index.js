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

// PGLite setup
const dataDir = join(__dirname, '..', '.pglite-data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

let db;

async function initDatabase() {
  db = await PGlite.create({
    dataDir: dataDir,
    relaxedDurability: true
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  console.log('Database initialized successfully');
}

// SSE connections storage
const sseClients = [];

// GET /api/messages - Fetch historical messages
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
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/messages - Create a new message
app.post('/api/messages', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ error: 'Message text is required and must be a non-empty string' });
    }

    const result = await db.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at',
      [text.trim()]
    );

    const message = result.rows[0];

    // Broadcast to all SSE clients
    const messageData = JSON.stringify({
      id: message.id,
      text: message.text,
      created_at: message.created_at
    });

    for (const client of sseClients) {
      client.res.write(`data: ${messageData}\n\n`);
    }

    res.status(201).json(message);
  } catch (err) {
    console.error('Error creating message:', err);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

// GET /api/stream - SSE endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial connection message
  res.write(':\n\n');

  // Add this client to the SSE clients list
  sseClients.push({ res });

  // Handle client disconnect
  req.on('close', () => {
    const index = sseClients.findIndex(c => c.res === res);
    if (index !== -1) {
      sseClients.splice(index, 1);
    }
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
