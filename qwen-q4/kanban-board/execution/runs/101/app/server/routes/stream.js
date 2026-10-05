import { Router } from 'express';

const router = Router();

// Store active SSE connections
let clients = new Set();

/**
 * Broadcast an event to all connected SSE clients
 */
export function broadcastEvent(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(message);
    } catch (err) {
      console.error('Error broadcasting to client:', err);
    }
  }
}

/**
 * GET /api/stream - SSE endpoint for real-time updates
 */
router.get('/', (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial comment to keep connection alive
  res.write(': connected\n\n');

  clients.add(res);

  // Handle client disconnect
  req.on('close', () => {
    clients.delete(res);
  });

  // Handle errors
  res.on('error', () => {
    clients.delete(res);
  });
});

export { router as streamRouter };
