# Real-time Message Board

A traditional client-server web application with real-time capabilities using PGLite and Server-Sent Events.

## Features

- Simple message board with text messages
- Real-time updates via Server-Sent Events (SSE)
- Persistent storage with PGLite (embedded PostgreSQL)
- Lightweight vanilla JS frontend with Vite

## Getting Started

### Prerequisites

- Node.js 18+

### Installation

```bash
npm install
```

This installs dependencies for root, backend, and frontend.

### Development

Start both backend and frontend:

```bash
npm run dev
```

- Backend runs on http://localhost:3001
- Frontend runs on http://localhost:5173

The backend will create a `backend/data` directory for PGLite persistence.

## API Endpoints

- `GET /api/messages` - Fetch all messages
- `POST /api/messages` - Create a new message
- `GET /api/stream` - SSE stream for real-time updates

## Architecture

- **Backend**: Express.js with PGLite embedded database
- **Frontend**: Vanilla JS SPA with Vite dev server
- **Real-time**: Server-Sent Events for one-way communication
- **Database**: PGLite persists to local filesystem
