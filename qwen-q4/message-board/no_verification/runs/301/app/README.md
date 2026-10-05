# Message Board

A real-time collaborative message board using embedded PGLite and Server-Sent Events (SSE).

## Features

- Post text messages to a shared board
- Real-time updates pushed to all connected clients via SSE
- Persistent storage using embedded PGLite (PostgreSQL in WASM)
- Lightweight Vanilla JS frontend built with Vite

## Getting Started

```bash
# Install dependencies
npm install

# Start both backend and frontend dev servers
npm run dev
```

The frontend will be available at `http://localhost:5173` and the backend API at `http://localhost:3001`.

## Architecture

- **Backend**: Express.js server with embedded PGLite database
- **Real-time**: Server-Sent Events (SSE) for pushing updates to clients
- **Frontend**: Vanilla JavaScript with Vite for fast development
- **Storage**: PGLite persists data to the `pglite-data/` directory on disk
