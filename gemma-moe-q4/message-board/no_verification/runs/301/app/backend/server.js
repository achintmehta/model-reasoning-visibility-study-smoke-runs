import express from 'express';
import cors from 'cors';
import { PGLite } from '@electric-sql/pglite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import EventEmitter from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3001;
const eventEmitter = new EventEmitter();

app.use(cors());
app.use(express.json());

const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

let db;

async function initDb() {
  db = new PGLite(DATA_DIR);
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('Database initialized');
}

app.get('/api/messages', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM messages ORDER BY created_at ASC');
    res.json(result.toArray());
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching messages');
  }
});

app.post('/api/messages', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).send('Text is required');
  }

  try {
    const result = await db.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING *',
      [text]
    );
    const newMessage = result.toArray()[0];
    
    // Broadcast to SSE clients
    eventEmitter.emit('newMessage', newMessage);
    
    res.status(201).json(newMessage);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error saving message');
  }
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const onMessage = (newMessage) => {
    res.write(`data: ${JSON.stringify(newMessage)}\n\n`);
  };

  eventEmitter.on('newMessage', onMessage);

  req.on('close', () => {
    eventEmitter.removeListener('newMessage', onMessage);
    res.end();
  });
});

async function startServer() {
  await initDb();
  app.listen(port, () => {
    console.log(`Backend listening at http://localhost:${port}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
