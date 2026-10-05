# Real-time Message Board

A lightweight, real-time message board application built with:
- **Backend**: Node.js with Express and embedded PGLite (PostgreSQL)
- **Real-time**: Server-Sent Events (SSE) for instant message updates
- **Frontend**: Vanilla JavaScript with Vite

## Features

- Post text messages to a shared board
- Real-time updates via Server-Sent Events (no polling)
- Persistent storage using embedded PGLite database
- Simple, fast frontend with minimal dependencies
- Automatic reconnection for SSE connections

## Installation

1. Install dependencies:
```bash
npm install
```

## Development

Start the development servers:
```bash
npm run dev
```

This will:
- Start the backend on port 3001
- Start the frontend on port 3000
- Proxy API requests to the backend

The application will be available at: `http://localhost:3000`

## API Endpoints

### GET /api/messages
Fetch all messages from the database.

### GET /api/stream
SSE endpoint for real-time message updates.

### POST /api/messages
Create a new message (body: `{ "text": "your message" }`)

## Project Structure

```
.
├── server.js           # Express server with PGLite
├── package.json        # Project dependencies
├── vite.config.js      # Vite configuration
├── public/
│   ├── index.html      # Frontend HTML
│   └── main.js         # Frontend JavaScript
└── dist/               # Built frontend (generated)
```

## Technologies

- **Express**: Web server framework
- **@electric-sql/pglite**: Embedded PostgreSQL
- **Vite**: Build tool for the frontend
- **Server-Sent Events**: One-way real-time communication
