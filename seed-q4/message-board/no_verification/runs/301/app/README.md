# Real-Time Message Board

A simple real-time message board application built with:
- Node.js + Express (backend)
- PGLite (embedded PostgreSQL for data storage)
- Server-Sent Events (SSE) for real-time updates
- Vanilla JavaScript + Vite (frontend)

## Features

- Persistent message storage using PGLite (no external database required)
- Real-time updates for all connected clients via SSE
- Simple, lightweight frontend with Vanilla JavaScript
- Easy setup with no manual configuration needed

## Getting Started

### Prerequisites

- Node.js (v14 or later)
- npm (v6 or later)

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd realtime-message-board
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Running the Application

Start the development server (runs both backend and frontend):
```bash
npm run dev
```

- Backend server will run on `http://localhost:3000`
- Frontend will be available at `http://localhost:5173` (automatically opens in your browser)

### Building for Production

1. Build the frontend:
   ```bash
   npm run build
   ```

2. Start the production server:
   ```bash
   npm start
   ```

## Project Structure

```
realtime-message-board/
├── data/                 # PGLite database storage (auto-created)
├── frontend/             # Frontend code (Vanilla JS + Vite)
│   ├── index.html        # Main HTML file
│   ├── main.js           # Frontend logic
│   ├── vite.config.js    # Vite configuration
│   └── package.json      # Frontend dependencies
├── server.js             # Express backend server
├── package.json          # Root package.json (backend + dev dependencies)
├── .gitignore            # Git ignore rules
└── README.md             # This file
```

## Technologies Used

- **Backend**: Node.js, Express, PGLite
- **Frontend**: Vanilla JavaScript, Vite
- **Real-time**: Server-Sent Events (SSE)
- **Storage**: PGLite (embedded PostgreSQL)

## License

This project is open source and available under the [MIT License](LICENSE).