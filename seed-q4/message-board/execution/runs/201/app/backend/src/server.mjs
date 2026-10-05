import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Get __dirname for ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create data directory if it doesn't exist
const DATA_DIR = path.join(__dirname, '..', 'data');
await fs.mkdir(DATA_DIR, { recursive: true }).catch(err => console.error('Failed to create data directory:', err));

// Initialize SQLite database
const dbPath = path.join(DATA_DIR, 'sqlite.db');
const db = new Database(dbPath, { verbose: console.log });

// Database initialization: create messages table if it doesn't exist
function initDatabase() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
  }
}

// Track active SSE connections
const sseClients = new Set();

// SSE endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial heartbeat
  const heartbeatInterval = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);

  // Add client to the set
  const clientId = Date.now();
  sseClients.add(res);

  console.log(`SSE client connected (total: ${sseClients.size})`);

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    sseClients.delete(res);
    console.log(`SSE client disconnected (total: ${sseClients.size})`);
  });
});

// Get all messages
app.get('/api/messages', (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM messages ORDER BY created_at DESC');
    const messages = stmt.all();
    res.json(messages);
  } catch (error) {
    console.error('Failed to fetch messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Add new message
app.post('/api/messages', (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Message text is required' });
    }

    // Insert message into database
    const stmt = db.prepare('INSERT INTO messages (text) VALUES (?)');
    const info = stmt.run(text.trim());
    
    // Get the newly inserted message
    const getStmt = db.prepare('SELECT * FROM messages WHERE id = ?');
    const newMessage = getStmt.get(info.lastInsertRowid);

    // Broadcast the new message to all SSE clients
    sseClients.forEach(client => {
      client.write(`data: ${JSON.stringify(newMessage)}\n\n`);
    });

    res.status(201).json(newMessage);
  } catch (error) {
    console.error('Failed to add message:', error);
    res.status(500).json({ error: 'Failed to add message' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initDatabase();
  console.log(`Server running on port ${PORT}`);
});