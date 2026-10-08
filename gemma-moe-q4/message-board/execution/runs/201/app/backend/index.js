const express = require('express');
const cors = require('cors');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

const DB_PATH = path.join(__dirname, 'pgdata');

// Ensure DB directory exists (PGLite might handle it, but good to be sure)
if (!fs.existsSync(DB_PATH)) {
  fs.mkdirSync(DB_PATH);
}

let db;
let clients = [];

async function initDb() {
  db = new PGlite(DB_PATH);
  await db.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('PGLite initialized');
}

// SSE setup
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const clientId = Date.now();
  const newClient = {
    id: clientId,
    res
  };

  clients.push(newClient);
  console.log(`Client connected: ${clientId}. Total clients: ${clients.length}`);

  req.on('close', () => {
    console.log(`Client disconnected: ${clientId}`);
    clients = clients.filter(client => client.id !== clientId);
  });
});

function broadcast(message) {
  const data = JSON.stringify(message);
  clients.forEach(client => {
    client.res.write(`data: ${data}\n\n`);
  });
}

// API Endpoints
app.get('/api/messages', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM messages ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching messages');
  }
});

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
    broadcast(newMessage);

    res.status(201).json(newMessage);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error saving message');
  }
});

async function startServer() {
  await initDb();
  app.listen(port, () => {
    console.log(`Backend listening at http://localhost:${port}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
