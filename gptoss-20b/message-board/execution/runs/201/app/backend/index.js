import express from 'express';
import cors from 'cors';
import { PGLite } from '@electric-sql/pglite';

const app = express();
app.use(cors());
app.use(express.json());

// Initialize PGLite; by default writes to in-memory but can set a file
const db = new PGLite({ path: 'backend/db.sqlite' });
const sseClients = new Set();

async function initDB() {
  await db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );`);
}
await initDB();

app.get('/api/messages', async (req, res) => {
  const rows = await db.all('SELECT id, text, created_at FROM messages ORDER BY id ASC');
  res.json(rows);
});

app.post('/api/messages', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  await db.run('INSERT INTO messages (text) VALUES (?)', [text]);
  const msg = await db.get(`SELECT id, text, created_at FROM messages WHERE id = last_insert_rowid()`);
  broadcast(msg);
  res.json(msg);
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const client of sseClients) {
    client.write(data);
  }
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
