const express = require('express');
const cors = require('cors');
const { PGLite } = require('@electric-sql/pglite');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(cors());
app.use(express.json());

// Initialize PGLite
const db = new PGLite({
  // Persist data to a file inside data directory
  // The constructor accepts an options object; `database` is the name
  database: path.join(DATA_DIR, 'messages.db'),
});

async function initDB() {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await db.run(createTableSQL);
}

// SSE state
const sseClients = [];
function addClient(res) {
  sseClients.push(res);
}
function removeClient(res) {
  const index = sseClients.indexOf(res);
  if (index !== -1) sseClients.splice(index, 1);
}
function broadcastMsg(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  sseClients.forEach((client) => {
    client.write(data);
  });
}

// Endpoint: GET /api/messages
app.get('/api/messages', async (req, res) => {
  try {
    const rows = await db.all('SELECT id, text, created_at FROM messages ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Endpoint: POST /api/messages
app.post('/api/messages', async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Text is required' });
  }
  try {
    const insertSQL = 'INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at';
    const result = await db.get(insertSQL, [text]);
    broadcastMsg(result);
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Endpoint: GET /api/stream
app.get('/api/stream', (req, res) => {
  // Set headers for SSE
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Connection', 'keep-alive');

  // Send initial comment to keep connection alive on some proxies
  res.write(':
\n');

  addClient(res);

  req.on('close', () => {
    removeClient(res);
    res.end();
  });
});

// Start server

app.use(express.static('client/dist'));


async function start() {
  await initDB();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

start();
