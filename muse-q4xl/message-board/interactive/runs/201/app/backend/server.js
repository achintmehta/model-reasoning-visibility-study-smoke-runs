import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const dataDir = path.join(__dirname, 'data');
await fs.mkdir(dataDir, { recursive: true });

const db = new PGlite({ dataDir });
await db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`);

const clients = new Set();

function broadcast(message) {
  const payload = `data: ${JSON.stringify(message)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(payload);
    } catch {}
  }
}

app.get('/api/messages', async (req, res) => {
  try {
    const result = await db.query('SELECT id, text, created_at FROM messages ORDER BY id ASC');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now() + Math.random();
  const client = { id: clientId, res };
  clients.add(client);

  res.write(`: connected\n\n`);

  req.on('close', () => {
    clients.delete(client);
  });
});

app.post('/api/messages', async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Text is required' });
  }
  try {
    const result = await db.query('INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at', [text.trim()]);
    const message = result.rows[0];
    broadcast(message);
    res.status(201).json(message);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
