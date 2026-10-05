import express from 'express';
import cors from 'cors';
import { PGLite } from '@electric-sql/pglite';

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize PGLite database
const pg = new PGLite({
  dataDirectory: './data/pglite',
});

// Initialize database schema and seed initial data
async function initializeDatabase() {
  try {
    await pg.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Check if there are any messages, if not, add some seed data
    const result = await pg.query('SELECT COUNT(*) as count FROM messages');
    if (result.rows[0].count === '0') {
      await pg.exec(`
        INSERT INTO messages (text) VALUES
          ('Welcome to the real-time message board!'),
          ('This is a demonstration of PGLite with SSE'),
          ('Try posting a message and watch it appear instantly on all connected clients.')
      `);
    }
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Start the server
initializeDatabase().then(() => {
  // API: Get all messages
  app.get('/api/messages', async (req, res) => {
    try {
      const result = await pg.query('SELECT * FROM messages ORDER BY created_at DESC');
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  // API: Stream messages via SSE
  app.get('/api/stream', (req, res) => {
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Send initial connection confirmation
    res.write(': Connected to message stream\n\n');

    // Function to send a message to all connected clients
    const broadcastMessage = async (message) => {
      const eventData = JSON.stringify(message);
      res.write(`data: ${eventData}\n\n`);
    };

    // Send new messages to this client
    const sendNewMessage = async () => {
      try {
        const result = await pg.query(
          'SELECT id, text, created_at FROM messages ORDER BY created_at DESC LIMIT 1'
        );
        if (result.rows.length > 0) {
          const message = result.rows[0];
          // Format timestamp for display
          message.display_time = new Date(message.created_at).toLocaleTimeString();
          broadcastMessage(message);
        }
      } catch (error) {
        console.error('Error fetching latest message:', error);
      }
    };

    // Send the most recent message immediately
    sendNewMessage();

    // Poll for new messages every second
    const pollInterval = setInterval(sendNewMessage, 1000);

    // Cleanup on client disconnect
    req.on('close', () => {
      clearInterval(pollInterval);
      console.log('Client disconnected from SSE');
    });
  });

  // API: Post a new message
  app.post('/api/messages', async (req, res) => {
    try {
      const { text } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required' });
      }

      if (text.trim() === '') {
        return res.status(400).json({ error: 'Text cannot be empty' });
      }

      const result = await pg.query(
        'INSERT INTO messages (text) VALUES ($1) RETURNING id, text, created_at',
        [text.trim()]
      );

      const message = result.rows[0];
      message.display_time = new Date(message.created_at).toLocaleTimeString();

      // Broadcast the new message to all connected clients
      broadcastMessage(message);

      res.status(201).json(message);
    } catch (error) {
      console.error('Error creating message:', error);
      res.status(500).json({ error: 'Failed to create message' });
    }
  });

  // Start the server
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Messages API: http://localhost:${PORT}/api/messages`);
    console.log(`SSE Stream: http://localhost:${PORT}/api/stream`);
  });
});
