# Real-Time Message Board

A lightweight, real-time message board built with Node.js, PGLite, and Server-Sent Events (SSE).

## Features

- 📝 Post and view text messages
- ⚡ Real-time updates via Server-Sent Events
- 💾 Persistent storage using embedded PGLite database
- 🚀 No external database setup required
- 🎨 Simple, clean UI

## Tech Stack

- **Backend**: Node.js with Express
- **Database**: PGLite (embedded PostgreSQL)
- **Real-time**: Server-Sent Events (SSE)
- **Frontend**: Vanilla JavaScript with Vite

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

The application will start with:
- Backend server on `http://localhost:3000`
- Frontend dev server on `http://localhost:5173`

## Usage

1. Open `http://localhost:5173` in your browser
2. Post a message in the text input
3. Open the same page in a new tab
4. Both pages will receive real-time updates when you post a message

## API Endpoints

- `GET /api/messages` - Fetch all messages
- `GET /api/stream` - SSE endpoint for real-time updates
- `POST /api/messages` - Post a new message

## Project Structure

```
.
├── index.html          # Frontend UI
├── server.js           # Backend server with PGLite
├── vite.config.js      # Vite configuration
├── package.json        # Project dependencies
└── README.md           # This file
```

## Development

Run the development server with:
```bash
npm run dev
```

Build for production:
```bash
npm run build
```

Preview the production build:
```bash
npm run preview
```

## License

MIT
