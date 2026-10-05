# Realtime Message Board

A simple message board application with real-time updates using PGLite (embedded PostgreSQL) and Server-Sent Events (SSE).

## Features

- Post and view text messages
- Real-time updates via Server-Sent Events
- Persistent storage using PGLite
- Lightweight, vanilla JavaScript frontend
- No external database dependencies

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Start the development servers:
```bash
npm run dev
```

This will:
- Start the backend server on port 3001 with PGLite database
- Start the frontend dev server on port 5173

3. Open your browser to:
```
http://localhost:5173
```

## Project Structure

```
.
├── backend/
│   └── server.js          # Express server with PGLite and SSE
├── frontend/
│   ├── src/
│   │   ├── main.js        # Frontend logic for message board
│   │   ├── style.css      # Styling for the message board
│   │   └── index.html     # Main HTML template
│   ├── index.html         # Entry point for Vite
│   └── vite.config.js     # Vite configuration
├── package.json           # Root package.json
└── README.md              # This file
```

## API Endpoints

### GET /api/messages
Fetch all messages from the database.

**Response:** Array of message objects
```json
[
  {
    "id": 1,
    "text": "Hello, World!",
    "created_at": "2026-10-04T19:44:32.156Z"
  }
]
```

### GET /api/stream
Server-Sent Events endpoint for real-time updates.
- Sends all messages on connection
- Sends new messages as they are inserted
- Automatically closes after sending all initial messages

### POST /api/messages
Create a new message.

**Request Body:**
```json
{
  "text": "Your message here"
}
```

**Response:** Created message object
```json
{
  "id": 2,
  "text": "Your message here",
  "created_at": "2026-10-04T19:45:00.000Z"
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok"
}
```

## Tech Stack

### Backend
- **Node.js** - Runtime environment
- **Express** - Web framework
- **@electric-sql/pglite** - Embedded PostgreSQL database
- **cors** - CORS middleware

### Frontend
- **Vite** - Build tool and dev server
- **Vanilla JavaScript** - No framework overhead
- **CSS** - Modern styling with gradients and animations

## How It Works

1. **Backend**: The Express server initializes PGLite with persistent storage in the `./data` directory. It creates a `messages` table with `id`, `text`, and `created_at` columns.

2. **SSE**: When a client connects to `/api/stream`, the server:
   - Sends connection acknowledgment
   - Sends all existing messages
   - Keeps the connection open to push new messages
   - Closes the connection after sending initial messages

3. **Frontend**: The client:
   - Fetches initial messages on page load
   - Connects to SSE stream for real-time updates
   - Appends new messages to the DOM automatically
   - Sends new messages via POST request

## Development

### Backend Scripts
- `npm run dev:server` - Start backend server with auto-reload
- `node backend/server.js` - Start backend server without auto-reload

### Frontend Scripts
- `npm run dev:client` - Start frontend dev server
- `npm run build` - Build frontend for production
- `npm run preview` - Preview production build

## Notes

- PGLite data is stored in the `./data` directory
- SSE connections are closed after initial data is sent to avoid keeping connections open indefinitely
- The application is designed for local development and single-instance deployment
