const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./db');
const http = require('http');
const { getBoard, createCard, moveCard } = require('./handlers/board');
const { eventEmitter, sendEvent } = require('./sse');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(bodyParser.json());

// API routes
app.get('/api/board', async (req, res) => {
  const board = await getBoard();
  res.json(board);
});

app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  const card = await createCard(columnId, text);
  sendEvent('create', card); // broadcast
  res.json(card);
});

app.patch('/api/cards/:id/move', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { columnId, beforeId, afterId } = req.body;
  const card = await moveCard(id, columnId, beforeId, afterId);
  sendEvent('move', card);
  res.json(card);
});

// SSE endpoint
app.get('/api/stream', (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Register connection
  const onEvent = (type, data) => {
    const payload = JSON.stringify({ type, data });
    res.write(`data: ${payload}\n\n`);
  };

  eventEmitter.on('event', onEvent);

  req.on('close', () => {
    eventEmitter.off('event', onEvent);
  });
});

const PORT = 4000;
server.listen(PORT, () => {
  console.log(`Kanban server listening on port ${PORT}`);
});
