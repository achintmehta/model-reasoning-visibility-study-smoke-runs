import { Router } from 'express';
import { getDb } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const db = getDb();

    // Get all columns ordered by position
    const { rows: columns } = await db.query(
      'SELECT id, title, position FROM columns ORDER BY position'
    );

    // For each column, get its cards ordered by position
    const board = [];
    for (const col of columns) {
      const { rows: cards } = await db.query(
        'SELECT id, column_id, text, position, created_at FROM cards WHERE column_id = $1 ORDER BY position',
        [col.id]
      );
      board.push({
        ...col,
        cards: cards.map(c => ({
          id: c.id,
          column_id: c.column_id,
          text: c.text,
          position: c.position,
          created_at: c.created_at
        }))
      });
    }

    res.json(board);
  } catch (err) {
    console.error('Error fetching board:', err);
    res.status(500).json({ error: 'Failed to fetch board state' });
  }
});

export { router as boardRouter };
