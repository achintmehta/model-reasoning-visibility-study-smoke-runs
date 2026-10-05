const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pglite } = require('@electric-sql/pglite');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Serve static files from public folder
app.use(express.static('public'));

// PGLite instance
const db = new Pglite({ dataFile: 'pglite.db' });

// Database initialization
(async () => {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`
  );
})();

// Store active EventSource responses
const clients = new Set();

// Helper to broadcast message
function broadcast(message) {
  const data = `data: ${JSON.stringify(message)}\n\n`;
  for (const res of clients) {
    res.write(data);
  }
}

// GET history
app.get('/api/messages', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM messages ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST new message
app.post('/api/messages', async (req, res) => {
  const { text } = req.body;
  if (typeof text !== 'string' || text.trim() === '') {
    return res.status(400).json({ error: 'Text is required' });
  }
  try {
    // Insert the new message
  await db.exec(`INSERT INTO messages (text) VALUES (?)`, [text]);
    // Retrieve inserted row
    const [row] = await db.all(`SELECT * FROM messages WHERE id = last_insert_rowid()`);
    const message = { id: row.id, text: row.text, created_at: row.created_at };
    res.status(201).json(message);
    broadcast(message); // Send to SSE clients
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Database error' });
  }
});

// SSE stream
app.get('/api/stream', (req, res) => {
  // Set headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Add to clients set
  clients.add(res);

  // Remove on close
  req.on('close', () => {
    clients.delete(res);
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
