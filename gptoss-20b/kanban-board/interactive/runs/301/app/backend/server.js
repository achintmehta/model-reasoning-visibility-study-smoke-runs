const express = require('express');
const cors = require('cors');
const { db, init } = require('./db');
const boardRoutes = require('./routes/board');
const cardsRoutes = require('./routes/cards');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', boardRoutes);
app.use('/api', cardsRoutes);

// SSE support
let clients = [];
function broadcast(event, data) {
  const payload = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => res.write(payload));
}
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write('data: connected\n\n');
  clients.push(res);
  req.on('close', () => {
    clients = clients.filter(c => c !== res);
  });
});

const PORT = process.env.PORT || 3000;

init().then(() => {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
  // Expose broadcast to routes
  require('./routes/common').setBroadcast(broadcast);
});
