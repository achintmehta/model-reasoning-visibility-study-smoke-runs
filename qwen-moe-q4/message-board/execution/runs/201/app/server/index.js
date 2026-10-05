import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize PGLite with filesystem persistence
const DATA_DIR = join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Clean up stale lock files from previous runs
try {
  const staleFiles = fs.readdirSync(DATA_DIR).filter(
    (f) => f.startsWith('.s.PGSQL') || f === 'postmaster.pid'
  );
  staleFiles.forEach((f) => fs.unlinkSync(join(DATA_DIR, f)));
} catch {
  // Ignore errors during cleanup
}

const pglite = new PGlite({
  dataDir: DATA_DIR,
  relaxedDurability: true,
});

// SSE client tracking
const sseClients = [];

// Initialize database
async function initDatabase() {
  await pglite.waitReady;
  await pglite.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

// Get historical messages
app.get('/api/messages', async (req, res) => {
  try {
    const result = await pglite.query(
      'SELECT id, text, created_at FROM messages ORDER BY created_at ASC'
    );
    const messages = result.rows.map((row) => ({
      id: row.id,
      text: row.text,
      created_at: row.created_at,
    }));
    res.json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// SSE endpoint for real-time updates
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const client = res;
  sseClients.push(client);

  client.on('close', () => {
    const index = sseClients.indexOf(client);
    if (index !== -1) {
      sseClients.splice(index, 1);
    }
  });
});

// Broadcast a message to all SSE clients
function broadcastMessage(message) {
  const data = JSON.stringify(message);
  const payload = `data: ${data}\n\n`;
  sseClients.forEach((client) => {
    client.write(payload);
  });
}

// Post a new message
app.post('/api/messages', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ error: 'Message text is required' });
    }

    const result = await pglite.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at',
      [text.trim()]
    );

    const message = {
      id: result.rows[0].id,
      text: result.rows[0].text,
      created_at: result.rows[0].created_at,
    };

    // Broadcast to all SSE clients
    broadcastMessage(message);

    res.status(201).json(message);
  } catch (err) {
    console.error('Error posting message:', err);
    res.status(500).json({ error: 'Failed to post message' });
  }
});

// Start server
async function start() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
