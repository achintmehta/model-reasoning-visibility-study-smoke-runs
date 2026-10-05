const express = require('express');
const cors = require('cors');
const { PGlite } = require('@electric-sql/pglite');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Initialize PGLite with local persistence
const dbPath = path.join(__dirname, 'pgdata');
const db = new PGlite({ dataDir: dbPath });

// Initialize database schema
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

initDb().catch(err => console.error('Database initialization failed:', err));

// Store active SSE clients
let clients = [];

function broadcast(message) {
  const data = `data: ${JSON.stringify(message)}\n\n`;
  clients.forEach(client => client.res.write(data));
}

// GET /api/messages - Fetch historical messages
app.get('/api/messages', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM messages ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/messages - Post a new message
app.post('/api/messages', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  try {
    const result = await db.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at',
      [text]
    );
    const newMessage = result.rows[0];
    
    // Broadcast the new message to all SSE clients
    broadcast(newMessage);
    
    res.status(201).json(newMessage);
  } catch (err) {
    console.error('Error inserting message:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/stream - SSE endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const client = { res };
  clients.push(client);

  console.log('Client connected to stream');

  req.on('close', () => {
    clients = clients.filter(c => c !== client);
    console.log('Client disconnected from stream');
  });
});

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
});
