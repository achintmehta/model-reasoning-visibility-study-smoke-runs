const express = require('express');
const cors = require('cors');
const pkg = require('@electric-sql/pglite');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const DB_DIR = path.join(__dirname, 'pglite-data');

// Ensure DB directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR);
}

const pg = new pkg.PGlite(DB_DIR);

// SSE clients
let clients = [];

// Initialize Database
async function initDb() {
  try {
    await pg.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database initialized');
  } catch (err) {
    console.error('Error during DB initialization:', err);
  }
}

initDb().catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

// Helper to broadcast to SSE clients
function broadcast(message) {
  clients.forEach(client => {
    client.res.write(`data: ${JSON.stringify(message)}\n\n`);
  });
}

// GET /api/messages
app.get('/api/messages', async (req, res) => {
  try {
    const result = await pg.query('SELECT id, text, created_at FROM messages ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching messages');
  }
});

// POST /api/messages
app.post('/api/messages', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).send('Text is required');
  }

  try {
    const result = await pg.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at',
      [text]
    );
    const newMessage = result.rows[0];
    
    // Broadcast to all SSE clients
    broadcast(newMessage);

    res.status(201).json(newMessage);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error inserting message');
  }
});

// GET /api/stream (SSE)
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const client = { res };
  clients.push(client);

  req.on('close', () => {
    clients = clients.filter(c => c !== client);
  });
});

app.listen(port, () => {
  console.log(`Backend listening at http://localhost:${port}`);
});
