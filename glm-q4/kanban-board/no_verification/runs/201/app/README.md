# Collaborative Kanban Board

A real-time collaborative Kanban board built with Node.js, PGLite, and Server-Sent Events (SSE).

## Features

- **Real-time Collaboration**: Multiple users can work on the same board simultaneously
- **Drag-and-Drop**: Move cards between columns and reorder within columns
- **Optimistic UI**: Cards update immediately, then reconcile with server state
- **Persistent Storage**: Board state is saved to local disk using PGLite
- **Server-Sent Events**: Real-time synchronization via SSE

## Project Structure

```
kanban-board/
├── backend/
│   └── server.js          # Express server with PGLite
├── frontend/
│   ├── index.html         # Frontend HTML
│   ├── main.js            # Frontend application
│   └── vite.config.js     # Vite configuration
├── package.json           # Root package.json
└── README.md              # This file
```

## Installation

1. Install dependencies:
```bash
npm install
```

## Development

Start both the backend and frontend development servers:

```bash
npm run dev
```

The backend server will start on `http://localhost:3000` and the frontend on `http://localhost:5173`.

## API Endpoints

### GET /api/board
Returns the current state of all columns and their cards.

### POST /api/cards
Creates a new card in a specified column.
**Body:**
```json
{
  "columnId": "todo",
  "text": "New task"
}
```

### PATCH /api/cards/:id/move
Moves a card to a new position.
**Body:**
```json
{
  "columnId": "in-progress",
  "beforeId": null,
  "afterId": null
}
```

### GET /api/stream
Server-Sent Events endpoint for real-time updates.

## Features in Detail

### Fractional Position Ordering
Each card has a numeric `position` within its column. When moving between two cards, the new position is calculated as the average of the two positions. This avoids full re-indexing on every move.

### Server-Authoritative Ordering
The server computes the final canonical position for each move and broadcasts it to all clients. Clients reconcile their optimistic updates against this canonical state.

### Real-time Synchronization
All create and move operations are broadcast via SSE to all connected clients, ensuring all clients converge on the same state.

### Atomic Operations
Card moves are performed atomically in a single transaction, ensuring a card never appears in two columns simultaneously.

## Acceptance Criteria

- ✅ Newly created card appears on every connected client
- ✅ Moving a card across columns updates all clients; card exists in exactly one column
- ✅ Two clients reordering cards within the same column converge to one identical order
- ✅ Concurrent moves of the same card leave it in exactly one place on all clients
- ✅ Reloading any client reproduces the server's exact board state
- ✅ Card ordering within each column is total and stable; no two cards occupy the same rendered slot

## Technology Stack

- **Backend**: Node.js with Express
- **Database**: PGLite (embedded PostgreSQL)
- **Real-time**: Server-Sent Events (SSE)
- **Frontend**: Vanilla JavaScript with Vite

## License

MIT
