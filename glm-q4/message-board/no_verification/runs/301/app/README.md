# Message Board

A simple real-time message board application built with embedded PGLite and Server-Sent Events (SSE).

## Features

- ✨ Real-time message updates via SSE
- 💾 Persistent storage using PGLite (embedded PostgreSQL)
- 🚀 Fast and lightweight frontend
- 🎨 Clean, modern UI

## Project Structure

```
message-board/
├── backend/
│   ├── package.json          # Backend dependencies
│   └── server.js             # Express server with PGLite and SSE
├── frontend/
│   ├── index.html            # Main HTML file
│   ├── main.js               # Frontend JavaScript
│   ├── style.css             # Frontend styles
│   ├── package.json          # Frontend dependencies
│   └── vite.config.js        # Vite configuration
├── package.json              # Root package.json with scripts
└── pglite-data/              # Database data (auto-created)
```

## Installation

1. Install root dependencies:
   ```bash
   npm install
   ```

2. Install backend dependencies:
   ```bash
   npm install --prefix backend
   ```

3. Install frontend dependencies:
   ```bash
   npm install --prefix frontend
   ```

## Running the Application

Start the development servers:
```bash
npm run dev
```

This will:
- Start the backend server on port 3000
- Start the Vite frontend dev server on port 5173
- Serve the frontend with hot reload

## Usage

1. Open your browser and navigate to `http://localhost:5173`
2. Type a message in the input field and click "Post"
3. Watch messages appear instantly in the message list
4. Open multiple tabs to see updates propagate to all tabs in real-time

## API Endpoints

### GET /api/messages
Fetch all messages from the database.
```bash
curl http://localhost:3000/api/messages
```

### GET /api/stream
SSE endpoint that streams new messages to connected clients.

### POST /api/messages
Post a new message.
```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, world!"}'
```

## Technology Stack

- **Backend**: Node.js, Express, PGLite (embedded PostgreSQL), CORS
- **Frontend**: Vanilla JavaScript, Vite
- **Real-time**: Server-Sent Events (SSE)
- **Database**: PGLite with persistent storage

## Notes

- PGLite stores data in the `pglite-data/` directory
- The database is automatically created on first run
- SSE connections are automatically re-established on reconnect
- The application is designed for local development and single-instance deployment
