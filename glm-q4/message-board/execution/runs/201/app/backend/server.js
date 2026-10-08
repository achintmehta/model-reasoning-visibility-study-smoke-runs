import express from 'express';
import cors from 'cors';

// Initialize PGLite with persistent storage
const dataDir = './data';
let pg;

async function initPGlite() {
  const { PGlite: PGliteClass } = await import('@electric-sql/pglite');
  pg = new PGliteClass({ dataDir });
  return pg;
}

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
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

// Historical messages endpoint
app.get('/api/messages', async (req, res) => {
  try {
    const result = await pg.query('SELECT * FROM messages ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// SSE endpoint for real-time updates
app.get('/api/stream', (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial connection acknowledgment
  res.write(': connected\n\n');

  // Send initial messages
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

  // Keep connection alive
  req.on('close', () => {
    console.log('Client disconnected from SSE');
  });
});

// Messaging endpoint
app.post('/api/messages', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Message text is required' });
    }

    await pg.query('INSERT INTO messages (text) VALUES ($1)', [text]);
    console.log('Message inserted:', text);

    // Get the newly inserted message
    const result = await pg.query('SELECT * FROM messages ORDER BY created_at DESC LIMIT 1');
    const newMessage = result.rows[0];

    res.status(201).json(newMessage);
  } catch (error) {
    console.error('Error inserting message:', error);
    res.status(500).json({ error: 'Failed to insert message' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
async function startServer() {
  try {
    pg = await initPGlite();
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
