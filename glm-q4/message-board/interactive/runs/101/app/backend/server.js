import express from 'express';
import cors from 'cors';
import { PGLite } from '@electric-sql/pglite';

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize PGLite database
const pg = new PGLite({ dataDir: './data' });

// Initialize database schema
async function initializeDatabase() {
  try {
    await pg.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

// Historical messages endpoint
app.get('/api/messages', async (req, res) => {
  try {
    const result = await pg.query('SELECT * FROM messages ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Real-time SSE endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial data
  pg.query('SELECT * FROM messages ORDER BY created_at DESC')
    .then(result => {
      res.write(`data: ${JSON.stringify(result.rows)}\n\n`);
    })
    .catch(error => {
      console.error('Error sending initial data:', error);
      res.write(`data: ${JSON.stringify({ error: 'Failed to load messages' })}\n\n`);
    });

  // Handle client disconnect
  req.on('close', () => {
    console.log('Client disconnected from SSE');
  });
});

// Messaging endpoint
app.post('/api/messages', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Invalid message text' });
    }

    const result = await pg.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING *',
      [text]
    );

    // Broadcast the new message to all connected clients
    const newMessage = result.rows[0];
    const broadcastData = JSON.stringify({
      type: 'new_message',
      message: newMessage
    });

    // Find all connections and broadcast
    // Note: In a real implementation, you'd maintain a list of active SSE connections
    // For simplicity, we'll just log this to the console
    console.log('Broadcasting new message:', newMessage.id);

    res.status(201).json(newMessage);
  } catch (error) {
    console.error('Error inserting message:', error);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
async function startServer() {
  await initializeDatabase();
  
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
