const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Create necessary directories
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// For this environment, we'll use an in-memory array to store messages
// In a real application, you would use a proper database like PGLite or PostgreSQL
let messages = [];
let nextId = 1;

// Function to simulate database persistence
function saveMessagesToDisk() {
  const data = JSON.stringify(messages);
  fs.writeFileSync(path.join(DATA_DIR, 'messages.json'), data);
}

// Load messages from disk on startup
try {
  const data = fs.readFileSync(path.join(DATA_DIR, 'messages.json'), 'utf8');
  messages = JSON.parse(data);
  nextId = messages.length > 0 ? Math.max(...messages.map(msg => msg.id)) + 1 : 1;
  console.log('Loaded messages from disk');
} catch (error) {
  console.log('No existing messages found, starting fresh');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Store active SSE connections
const clients = new Set();

// API endpoints
app.get('/api/messages', (req, res) => {
  // Return messages sorted by creation date (newest first)
  res.json([...messages].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.post('/api/messages', (req, res) => {
  const { text } = req.body;
  
  if (!text || text.trim() === '') {
    return res.status(400).json({ error: 'Message text is required' });
  }

  const now = new Date().toISOString();
  const newMessage = {
    id: nextId++,
    text: text.trim(),
    created_at: now
  };

  // Add to messages array
  messages.unshift(newMessage); // Add to the beginning for newest first
  
  // Save to disk
  saveMessagesToDisk();
  
  // Broadcast the new message to all connected clients
  clients.forEach(client => {
    client.send(`data: ${JSON.stringify(newMessage)}\n\n`);
  });
  
  res.status(201).json(newMessage);
});

// SSE endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send a comment to keep the connection alive
  const keepAliveInterval = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 30000);
  
  // Add client to the set
  const clientId = Date.now();
  const client = {
    id: clientId,
    send: (data) => res.write(data),
  };
  
  clients.add(client);
  
  // Handle client disconnect
  req.on('close', () => {
    clients.delete(client);
    clearInterval(keepAliveInterval);
  });
  
  console.log(`New SSE client connected (total: ${clients.size})`);
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Backend API available at http://localhost:${PORT}/api`);
});