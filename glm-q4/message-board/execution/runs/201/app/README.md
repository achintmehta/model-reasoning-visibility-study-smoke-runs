# Realtime Message Board

A simple message board with real-time updates using PGLite (embedded PostgreSQL) and Server-Sent Events (SSE).

## Features

- Post and view text messages
- Real-time updates via Server-Sent Events (SSE)
- Persistent storage using PGLite (embedded PostgreSQL)
- Simple, lightweight frontend with vanilla JavaScript
- No external database required - runs entirely in Node.js

## Project Structure

```
.
├── backend/
│   └── server.js          # Express server with PGLite and SSE
├── frontend/
│   ├── index.html         # Main HTML file
│   ├── src/
│   │   └── main.js        # Client-side JavaScript
│   └── vite.config.js     # Vite configuration
├── data/                  # PGLite data directory (auto-created)
├── dist/                  # Build output (auto-created)
└── package.json           # Root package.json
```

## Getting Started

### Prerequisites

- Node.js 18 or higher

### Installation

1. Install dependencies:
```bash
npm install
```

2. Start the development servers:
```bash
npm run dev
```

This will:
- Start the backend server on port 3001
- Start the frontend development server on port 5173

### Usage

1. Open your browser and navigate to [http://localhost:5173](http://localhost:5173)
2. Enter a message in the input field and click "Send"
3. Watch messages appear in real-time as they're posted

### API Endpoints

- `GET /health` - Health check endpoint
- `GET /api/messages` - Fetch all messages
- `POST /api/messages` - Create a new message
- `GET /api/stream` - SSE endpoint for real-time updates

## Technologies Used

- **Backend**: Node.js with Express.js
- **Database**: PGLite (embedded PostgreSQL via WASM)
- **Real-time**: Server-Sent Events (SSE)
- **Frontend**: Vanilla JavaScript with Vite

## Building for Production

```bash
npm run build
```

This will create a production build in the `dist/` directory.

## Development

The application uses file watching for development:

- Backend: Auto-restarts when `backend/server.js` changes
- Frontend: Auto-reloads when frontend files change

## Architecture

### Backend (Express + PGLite)

1. Initializes PGLite with persistent storage to `./data` directory
2. Creates a `messages` table with `id`, `text`, and `created_at` columns
3. Provides REST API endpoints for CRUD operations
4. Maintains SSE connections for real-time broadcasting

### Frontend (Vanilla JS + Vite)

1. Fetches initial messages on page load
2. Connects to SSE stream for real-time updates
3. Renders messages with timestamps
4. Submits new messages via HTTP POST

## License

MIT
