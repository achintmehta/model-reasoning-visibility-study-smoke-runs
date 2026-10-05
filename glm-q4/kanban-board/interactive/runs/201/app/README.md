# Collaborative Kanban Board

A real-time collaborative Kanban board with Server-Sent Events (SSE) for real-time synchronization.

## Features

- **Real-time collaboration**: All connected clients see the same board state in real-time
- **Drag-and-drop**: Move cards between columns and reorder within columns
- **Optimistic UI**: Cards update immediately on your client, then reconcile with server state
- **Persistent storage**: Board state is saved to local disk using PGLite
- **PostgreSQL-like queries**: Uses embedded PGLite for powerful SQL queries

## Project Structure

```
.
├── backend/
│   └── server.js          # Express server with PGLite and SSE
├── frontend/
│   ├── src/
│   │   ├── main.js        # Frontend application
│   │   └── app.css        # Styling
│   └── index.html
├── dist/                  # Build output
├── data/                  # PGLite database (auto-created)
├── package.json           # Root package.json with dev scripts
└── README.md
```

## Installation

1. Install dependencies:
```bash
npm install
```

## Running the Application

Start the development server with both backend and frontend:
```bash
npm run dev
```

This will:
1. Start the backend server on port 3001
2. Start the frontend dev server on port 5173
3. Initialize the database with default columns (To Do, In Progress, Done)

## API Endpoints

### GET /api/board
Returns all columns with their cards ordered by position.

### POST /api/cards
Creates a new card at the end of a specified column.

**Request body:**
```json
{
  "columnId": "todo",
  "text": "New task"
}
```

### PATCH /api/cards/:id/move
Moves a card to a new position within a column.

**Request body:**
```json
{
  "columnId": "in-progress",
  "beforeId": "card-123",
  "afterId": "card-456"
}
```

### GET /api/stream
Server-Sent Events endpoint for real-time synchronization. Clients connect to this endpoint to receive updates.

## How It Works

### Backend
- **Express.js**: Web server with CORS and JSON parsing
- **PGLite**: Embedded PostgreSQL for persistent storage
- **SSE**: Server-Sent Events for real-time updates
- **Position-based ordering**: Cards are stored with numeric positions for efficient reordering

### Frontend
- **Vite**: Build tool and dev server
- **Vanilla JavaScript**: No framework dependencies
- **Drag-and-drop**: Native HTML5 drag-and-drop API
- **Optimistic updates**: Cards move immediately on your client
- **SSE client**: Connects to `/api/stream` to receive server updates

### Concurrency Handling
- Server is authoritative on card ordering
- Clients send move intent (which card, where to place it)
- Server computes canonical position and broadcasts it
- Clients reconcile their optimistic state with server state
- Position collisions are detected and normalized

## Testing Real-time Collaboration

1. Open the application in multiple browser tabs (or use Incognito mode)
2. Create a card in one tab - it appears in all tabs
3. Move a card between columns - all clients see the change
4. Reorder cards - all clients converge on the same order
5. Reload any tab - it shows the same state as the server

## Database Schema

### columns table
- `id`: Primary key (TEXT)
- `title`: Column title (TEXT)
- `position`: Order within board (INTEGER)

### cards table
- `id`: Primary key (TEXT)
- `column_id`: Reference to columns table (TEXT)
- `text`: Card content (TEXT)
- `position`: Order within column (INTEGER)
- `created_at`: Timestamp of creation (TIMESTAMP)

## License

MIT
