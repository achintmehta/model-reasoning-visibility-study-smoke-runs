const express = require('express');
const cors = require('cors');
const { db } = require('./db');
const http = require('http');
const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());

// Create messages table on startup
const initDb = async () => {
  await db.exec(`CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );`);
};

// SSE clients
const sseClients = new Set();

app.get('/api/stream', (req, res) => {
  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  // Keep connection open
  res.write('\n');

  const clientId = Date.now();
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

async function broadcastMessage(message) {
  const data = `data: ${JSON.stringify(message)}\n\n`;
  for (const client of sseClients) {
    client.write(data);
  }
}

app.get('/api/messages', async (req, res) => {
  try {
    const result = await db.all('SELECT id, text, created_at FROM messages ORDER BY created_at ASC');
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/messages', async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Text is required' });
  }
  try {
    const result = await db.all('INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at', text);
    const message = result[0];
    // Broadcast
    await broadcastMessage(message);
    res.status(201).json(message);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to insert message' });
  }
});

const server = http.createServer(app);

server.listen(port, async () => {
  console.log(`Server listening on http://localhost:${port}`);
  await initDb();
});
