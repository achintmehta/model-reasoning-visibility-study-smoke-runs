let clients = new Set();

export function initSSE(req, res) {
  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  };
  
  res.writeHead(200, headers);
  
  const clientId = Date.now();
  const client = res;
  
  clients.add(client);
  
  // Send a comment every 15 seconds to keep the connection alive
  const keepAliveInterval = setInterval(() => {
    client.write(': keep-alive\n\n');
  }, 15000);
  
  client.on('close', () => {
    clients.delete(client);
    clearInterval(keepAliveInterval);
  });
  
  return clientId;
}

export function broadcastEvent(eventType, data) {
  const eventData = JSON.stringify(data);
  
  for (const client of clients) {
    try {
      client.write(`event: ${eventType}\n`);
      client.write(`data: ${eventData}\n\n`);
    } catch (error) {
      clients.delete(client);
    }
  }
}