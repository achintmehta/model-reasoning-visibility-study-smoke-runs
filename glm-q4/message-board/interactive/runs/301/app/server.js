import express from 'express';
import cors from 'cors';
import * as PGLiteModule from '@electric-sql/pglite';
const { PGlite } = PGLiteModule;

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize PGLite database
const dbDir = './data';
const pg = new PGLite({ location: dbDir });

// Initialize database
async function initDatabase() {
  try {
    // Create messages table if it doesn't exist
    await pg.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
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
const clients = new Set();
let messageId = 0;

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const clientId = Date.now();
  const client = {
    id: clientId,
    res
  };
  clients.add(client);

  console.log(`Client connected. Total clients: ${clients.size}`);

  // Send a ping every 30 seconds to keep alive
  const heartbeat = setInterval(() => {
    const ping = `event: ping\ndata: ${new Date().toISOString()}\n\n`;
    client.res.write(ping);
  }, 30000);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(client);
    console.log(`Client disconnected. Total clients: ${clients.size}`);
  });
});

// Broadcast a new message to all connected clients
function broadcastMessage(message) {
  const eventData = JSON.stringify(message);
  const data = `data: ${eventData}\n\n`;
  const errorData = `data: ${JSON.stringify({ error: 'Failed to send message' })}\n\n`;

  clients.forEach(client => {
    try {
      client.res.write(data);
    } catch (error) {
      console.error('Error broadcasting to client:', error);
    }
  });
}

// Messaging endpoint
app.post('/api/messages', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Insert into database
    const result = await pg.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at',
      [text]
    );

    const newMessage = result.rows[0];

    // Broadcast to all connected clients
    broadcastMessage(newMessage);

    res.status(201).json(newMessage);
  } catch (error) {
    console.error('Error creating message:', error);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

// Start server
app.listen(PORT, async () => {
  await initDatabase();
  console.log(`Server running on port ${PORT}`);
  console.log(`SSE endpoint: http://localhost:${PORT}/api/stream`);
  console.log(`API endpoint: http://localhost:${PORT}/api/messages`);
});
