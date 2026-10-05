import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const dataDir = './data';
const pg = new PGlite({ dataDir });

async function initDatabase() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('Database initialized successfully');
}

app.get('/api/messages', async (req, res) => {
  try {
    const result = await pg.query('SELECT * FROM messages ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.write(': connected\n\n');
  pg.query('SELECT * FROM messages ORDER BY created_at ASC').then(result => {
    result.rows.forEach(row => {
      res.write(`data: ${JSON.stringify(row)}\n\n`);
    });
    res.write(': end\n\n');
  }).catch(error => {
    console.error('Error fetching initial messages:', error);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to fetch messages' })}\n\n`);
    res.end();
  });
  req.on('close', () => {
    console.log('Client disconnected from SSE');
  });
});

app.post('/api/messages', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Message text is required' });
    }
    await pg.query('INSERT INTO messages (text) VALUES ($1)', [text]);
    console.log('Message inserted:', text);
    const result = await pg.query('SELECT * FROM messages ORDER BY created_at DESC LIMIT 1');
    const newMessage = result.rows[0];
    res.status(201).json(newMessage);
  } catch (error) {
    console.error('Error inserting message:', error);
    res.status(500).json({ error: 'Failed to insert message' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

async function startServer() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`API endpoint: http://localhost:${PORT}/api/messages`);
      console.log(`SSE endpoint: http://localhost:${PORT}/api/stream`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
