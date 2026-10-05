# Collaborative Kanban Board

A real-time collaborative Kanban board built with:
- **Node.js** + Express backend
- **PGLite** (embedded PostgreSQL) for persistent storage
- **Server-Sent Events (SSE)** for real-time synchronization
- **Vanilla JS** + Vite frontend with drag-and-drop

## Features

- Create cards in any column
- Move cards between columns via drag-and-drop
- Reorder cards within a column via drag-and-drop
- Real-time synchronization across all connected clients
- Optimistic UI updates with server reconciliation
- Fractional positioning for efficient card ordering

## Getting Started

```bash
# Install dependencies
npm install
npm run install:all

# Start development servers
npm run dev
```

The frontend will be available at http://localhost:3000 and the backend API at http://localhost:3001.

## Architecture

### Backend
- Express server with CORS and JSON body parsing
- Embedded PGLite database persisted to `server/pglite-data/`
- REST API endpoints for board state and mutations
- SSE endpoint for real-time event broadcasting

### Frontend
- Single Page Application with vanilla JavaScript
- Drag-and-drop using HTML5 Drag and Drop API
- SSE connection for real-time updates
- Optimistic UI updates reconciled against server state

### Ordering
- Fractional positioning: each card has a numeric `position` within its column
- Inserting between two cards uses the midpoint of their positions
- Automatic renormalization when precision is exhausted

## API

### GET /api/board
Returns the full board state with all columns and their cards.

### POST /api/cards
Create a new card.
```json
{
  "column_id": "uuid",
  "text": "Card title"
}
```

### PATCH /api/cards/:id/move
Move a card within or across columns.
```json
{
  "column_id": "uuid",
  "before_id": "uuid",
  "after_id": "uuid"
}
```

### DELETE /api/cards/:id
Delete a card.

### GET /api/stream
SSE endpoint for real-time updates. Events:
- `create`: New card created
- `move`: Card moved
- `delete`: Card deleted
- `renormalize`: Column positions renormalized
