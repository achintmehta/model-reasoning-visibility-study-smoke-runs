import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdir } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Initialize PGLite with file system persistence
const dataDir = join(__dirname, 'data');
await mkdir(dataDir, { recursive: true });

const pg = new PGlite(join(dataDir, 'db'));

// Initialize database
await pg.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);

// Track SSE clients
const clients = new Set();

function broadcastMessage(message) {
  const data = `data: ${JSON.stringify(message)}\n\n`;
  for (const client of clients) {
    client.write(data);
  }
}

// SSE endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  res.write('\n'); // Initial newline
  
  clients.add(res);
  
  req.on('close', () => {
    clients.delete(res);
  });
});

// Get messages
app.get('/api/messages', async (req, res) => {
  try {
    const result = await pg.query('SELECT id, text, created_at FROM messages ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Post message
app.post('/api/messages', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ error: 'Message text is required' });
    }
    
    const result = await pg.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at',
      [text.trim()]
    );
    
    const message = result.rows[0];
    broadcastMessage(message);
    
    res.status(201).json(message);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save message' });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
