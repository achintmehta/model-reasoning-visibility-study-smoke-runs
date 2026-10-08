const express = require('express');
const cors = require('cors');
const PGLite = require('@electric-sql/pglite').PGLite;
const path = require('path');
const fs = require('fs');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

const DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR);
}

const db = new PGLite(DB_DIR);

// SSE clients management
let clients = [];

async function initDb() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('Database initialized');
}

initDb().catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

// GET /api/messages - Fetch historical messages
app.get('/api/messages', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM messages ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching messages');
  }
});

// POST /api/messages - Post a new message
app.post('/api/messages', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).send('Text is required');
  }

  try {
    const result = await db.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING *',
      [text]
    );
    const newMessage = result.rows[0];

    // Broadcast to all SSE clients
    clients.forEach(client => {
      client.write(`data: ${JSON.stringify(newMessage)}\n\n`);
    });

    res.status(201).json(newMessage);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error saving message');
  }
});

// GET /api/stream - SSE endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const clientId = Date.now();
  const newClient = {
    id: clientId,
    write: (data) => res.write(data)
  };

  clients.push(newClient);
  console.log(`Client connected: ${clientId}. Total clients: ${clients.length}`);

  req.on('close', () => {
    clients = clients.filter(c => c.id !== clientId);
    console.log(`Client disconnected: ${clientId}. Total clients: ${clients.length}`);
  });
});

app.listen(port, () => {
  console.log(`Backend server listening at http://localhost:${port}`);
});
