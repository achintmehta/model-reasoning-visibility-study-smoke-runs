import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

let pglite;
const clients = [];

async function initDB() {
  // Ensure data directory exists
  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  pglite = await PGlite.create({
    dataDir: `file://${dataDir}`
  });

  await pglite.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('Database initialized successfully');
}

// GET /api/messages - Fetch all messages for initial state
app.get('/api/messages', async (req, res) => {
  try {
    const result = await pglite.query(
      'SELECT id, text, created_at FROM messages ORDER BY created_at ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/messages - Insert a new message and broadcast to SSE clients
app.post('/api/messages', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required and cannot be empty' });
    }

    const result = await pglite.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at',
      [text.trim()]
    );

    const message = result.rows[0];

    // Broadcast new message to all active SSE clients
    const data = JSON.stringify(message);
    clients.forEach((client) => {
      client.res.write(`data: ${data}\n\n`);
    });

    res.json(message);
  } catch (err) {
    console.error('Error posting message:', err);
    res.status(500).json({ error: 'Failed to post message' });
  }
});

// GET /api/stream - SSE endpoint for real-time message updates
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Add this client to the active connections list
  clients.push({ res });

  // Clean up when client disconnects
  req.on('close', () => {
    const index = clients.findIndex((c) => c.res === res);
    if (index !== -1) {
      clients.splice(index, 1);
    }
  });
});

async function start() {
  await initDB();
  app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
  });
}

start();
