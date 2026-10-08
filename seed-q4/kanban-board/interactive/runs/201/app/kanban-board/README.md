# Collaborative Kanban Board

A real-time collaborative Kanban board built with Node.js, Express, PGLite, and Server-Sent Events (SSE). Multiple users can view the same board and create cards, move them between columns, and reorder them within a column via drag-and-drop. All connected clients converge on the same board state in real time.

## Features

- Real-time collaborative Kanban board with ordered columns and cards
- Drag-and-drop to move cards across columns and reorder within columns
- Persistent storage using embedded PGLite (PostgreSQL)
- Server-Sent Events (SSE) for real-time synchronization
- Optimistic UI updates with reconciliation against server-authoritative state
- Fractional position ordering for efficient card repositioning

## Technologies

- **Backend**: Node.js, Express, PGLite (embedded PostgreSQL)
- **Frontend**: Vanilla JavaScript (with Vite for development)
- **Real-time**: Server-Sent Events (SSE)
- **Drag-and-drop**: Native HTML5 drag-and-drop API

## Getting Started

### Prerequisites

- Node.js (v14 or later)
- npm (v6 or later)

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd kanban-board
   ```

2. Install dependencies:
   ```bash
   npm install
   cd frontend && npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

   This will start both the backend server (on port 3000) and the frontend development server (on port 5173 with proxy to backend).

4. Open your browser and navigate to `http://localhost:5173` to use the Kanban board.

## Project Structure

```
kanban-board/
├── src/                  # Backend source code
│   └── server.js         # Express server with API endpoints and SSE
├── data/                 # PGLite data directory (auto-created)
├── frontend/             # Frontend source code
│   ├── src/              # Frontend JavaScript and CSS
│   ├── public/           # Static assets
│   └── vite.config.js    # Vite configuration
├── package.json          # Backend dependencies and scripts
└── README.md             # Project documentation
```

## API Endpoints

### Backend API

- `GET /api/board` - Get the current state of the board (columns and cards)
- `POST /api/cards` - Create a new card in a specific column
- `PATCH /api/cards/:id/move` - Move a card to a different column or position
- `GET /api/stream` - Server-Sent Events endpoint for real-time updates

### Frontend

The frontend is a single-page application that:
- Fetches the initial board state from the API
- Renders columns and cards
- Implements drag-and-drop for card manipulation
- Connects to the SSE endpoint for real-time updates
- Uses optimistic UI updates and reconciles with server state

## Architecture

### Server-Authoritative State

The server is the source of truth for the board state. Clients send intent to move or create cards, but the server computes the final canonical position and persists it. Clients then reconcile their optimistic UI state with the server's authoritative state.

### Fractional Position Ordering

Each card has a `position` value within its column. When inserting a card between two others, we use a value between their positions, avoiding a full re-index on every move. This keeps moves cheap and ordering stable under concurrent edits.

### Real-time Synchronization

We use Server-Sent Events (SSE) for real-time updates from server to clients. This is simple, native over HTTP, and avoids WebSocket dependencies while meeting our one-way push requirement.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.