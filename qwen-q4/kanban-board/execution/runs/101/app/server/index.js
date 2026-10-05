import express from 'express';
import cors from 'cors';
import { initializeDatabase } from './db.js';
import { boardRouter } from './routes/board.js';
import { cardsRouter } from './routes/cards.js';
import { streamRouter } from './routes/stream.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Initialize PGLite database (creates data directory if needed)
await initializeDatabase();

// Routes
app.use('/api/board', boardRouter);
app.use('/api/cards', cardsRouter);
app.use('/api/stream', streamRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Kanban server running on http://localhost:${PORT}`);
});
