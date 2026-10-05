const express = require('express');
const cors = require('cors');
const { PGLite } = require('@electric-sql/pglite');
const path = require('path');
const { promisify } = require('util');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory set of SSE connections
const clients = new Set();
let nextClientId = 1;

// Initialize PGLite
const dbPath = path.join(__dirname, 'data.db');
const db = new PGLite(dbPath);

async function initDB() {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;
  await db.exec(createTableSQL);
}

async function start() {
  await initDB();

  // GET /api/messages – return all messages
  app.get('/api/messages', async (req, res) => {
    try {
      const rows = await db.prepare('SELECT id, text, created_at FROM messages ORDER BY id ASC').all();
      res.json(rows);
    } catch (err) {
      console.error('Error fetching messages', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // POST /api/messages – create a new message
  app.post('/api/messages', async (req, res) => {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "text" field' });
    }
    try {
      const result = await db.exec(`INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at`, [text]);
const inserted = result[0].rows[0];
      const inserted = result[0];
      // Broadcast to SSE clients
      const payload = JSON.stringify(inserted);
      for (const clientRes of clients) {
        clientRes.write(`data: ${payload}\n\n`);
      }
      res.status(201).json(inserted);
    } catch (err) {
      console.error('Error inserting message', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // SSE endpoint
  app.get('/api/stream', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    const clientId = nextClientId++;
    console.log(`Client ${clientId} connected to SSE`);
    clients.add(res);
    req.on('close', () => {
      console.log(`Client ${clientId} disconnected from SSE`);
      clients.delete(res);
    });
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Backend server running on http://localhost:${port}`);
  });
}

start();
