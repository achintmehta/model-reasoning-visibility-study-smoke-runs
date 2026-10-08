const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pglite } = require('@electric-sql/pglite');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, '..', 'frontend')));

let db;
const clients = new Set();

// Helper to send SSE
function broadcast(msg) {
  const payload = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

// Initialize database and start server
(async () => {
  // Create PGLite with persistent file
  db = new Pglite(path.join(__dirname, '..', 'pglite.db'));

  // Wait for the database to be ready
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Routes
  app.get('/api/messages', async (req, res) => {
    try {
      const result = await db.query('SELECT id, text, created_at FROM messages ORDER BY id ASC');
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Database error' });
    }
  });

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
      const newMsg = result.rows[0];
      broadcast(newMsg);
      res.status(201).json(newMsg);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.get('/api/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');
    clients.add(res);

    req.on('close', () => {
      clients.delete(res);
    });
  });

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
})();
