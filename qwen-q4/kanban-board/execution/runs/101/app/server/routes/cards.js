import { Router } from 'express';
import { getDb } from '../db.js';
import { broadcastEvent } from './stream.js';

const router = Router();

/**
 * Generate a unique ID using crypto or fallback
 */
function generateId(prefix = '') {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = prefix;
  for (let i = 0; i < 12; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Compute a fractional position between two values.
 * If no neighbors, returns a default.
 */
function computePosition(beforePos, afterPos) {
  if (beforePos !== null && afterPos !== null) {
    return (beforePos + afterPos) / 2;
  }
  if (beforePos !== null) {
    return beforePos + 0.5;
  }
  if (afterPos !== null) {
    return afterPos - 0.5;
  }
  return 1; // Default position when column is empty
}

/**
 * Check if positions in a column need renormalization.
 * Renormalize if any two adjacent cards have positions too close together.
 */
async function maybeRenormalizeColumn(db, columnId) {
  const { rows: cards } = await db.query(
    'SELECT id, position FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );

  if (cards.length <= 1) return;

  // Check for precision issues: adjacent positions too close
  const PRECISION_THRESHOLD = 1e-10;
  let needsRenormalize = false;
  for (let i = 1; i < cards.length; i++) {
    if (Math.abs(cards[i].position - cards[i - 1].position) < PRECISION_THRESHOLD) {
      needsRenormalize = true;
      break;
    }
  }

  if (!needsRenormalize) return;

  // Renormalize: assign evenly spaced positions
  for (let i = 0; i < cards.length; i++) {
    const newPosition = (i + 1) * 10; // Use larger steps to avoid future collisions
    await db.query(
      'UPDATE cards SET position = $1 WHERE id = $2',
      [newPosition, cards[i].id]
    );
  }

  // Broadcast the renormalized column state
  const { rows: normalizedCards } = await db.query(
    'SELECT id, column_id, text, position, created_at FROM cards WHERE column_id = $1 ORDER BY position',
    [columnId]
  );

  broadcastEvent({
    type: 'renormalize',
    column_id: columnId,
    cards: normalizedCards.map(c => ({
      id: c.id,
      column_id: c.column_id,
      text: c.text,
      position: c.position,
      created_at: c.created_at
    }))
  });
}

/**
 * POST /api/cards - Create a new card in a column
 */
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const { column_id, text } = req.body;

    if (!column_id || !text) {
      return res.status(400).json({ error: 'column_id and text are required' });
    }

    // Verify column exists
    const { rows: cols } = await db.query('SELECT id FROM columns WHERE id = $1', [column_id]);
    if (cols.length === 0) {
      return res.status(404).json({ error: 'Column not found' });
    }

    // Get the last card's position in this column to place new card after it
    const { rows: lastCards } = await db.query(
      'SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1',
      [column_id]
    );

    const lastPos = lastCards.length > 0 ? lastCards[0].position : 0;
    const newPosition = lastPos + 1;
    const id = generateId('card-');

    // Insert card
    await db.query(
      'INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4)',
      [id, column_id, text.trim(), newPosition]
    );

    // Fetch the canonical card
    const { rows: inserted } = await db.query(
      'SELECT id, column_id, text, position, created_at FROM cards WHERE id = $1',
      [id]
    );

    const card = inserted[0];

    // Broadcast to all connected clients
    broadcastEvent({
      type: 'create',
      card: {
        id: card.id,
        column_id: card.column_id,
        text: card.text,
        position: card.position,
        created_at: card.created_at
      }
    });

    res.status(201).json(card);
  } catch (err) {
    console.error('Error creating card:', err);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

/**
 * PATCH /api/cards/:id/move - Move a card within or across columns
 */
router.patch('/:id/move', async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { column_id, before_id, after_id } = req.body;

    if (!column_id) {
      return res.status(400).json({ error: 'column_id is required' });
    }

    // Verify column exists
    const { rows: cols } = await db.query('SELECT id FROM columns WHERE id = $1', [column_id]);
    if (cols.length === 0) {
      return res.status(404).json({ error: 'Column not found' });
    }

    // Verify card exists
    const { rows: existingCards } = await db.query(
      'SELECT id, column_id FROM cards WHERE id = $1',
      [id]
    );
    if (existingCards.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    const existingCard = existingCards[0];

    // Compute the new position based on before_id and after_id
    let beforePos = null;
    let afterPos = null;

    if (before_id) {
      const { rows: beforeRow } = await db.query(
        'SELECT position FROM cards WHERE id = $1 AND column_id = $2',
        [before_id, column_id]
      );
      if (beforeRow.length > 0) beforePos = beforeRow[0].position;
    }

    if (after_id) {
      const { rows: afterRow } = await db.query(
        'SELECT position FROM cards WHERE id = $1 AND column_id = $2',
        [after_id, column_id]
      );
      if (afterRow.length > 0) afterPos = afterRow[0].position;
    }

    const newPosition = computePosition(beforePos, afterPos);

    // Perform atomic update: update column_id and position in a single statement
    await db.query(
      'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3',
      [column_id, newPosition, id]
    );

    // Fetch the canonical card state
    const { rows: updated } = await db.query(
      'SELECT id, column_id, text, position, created_at FROM cards WHERE id = $1',
      [id]
    );

    const card = updated[0];

    // Check for precision issues and renormalize if needed
    await maybeRenormalizeColumn(db, column_id);

    // Broadcast the move to all connected clients
    broadcastEvent({
      type: 'move',
      card: {
        id: card.id,
        column_id: card.column_id,
        text: card.text,
        position: card.position,
        created_at: card.created_at
      }
    });

    res.json(card);
  } catch (err) {
    console.error('Error moving card:', err);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

/**
 * DELETE /api/cards/:id - Delete a card
 */
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;

    // Verify card exists
    const { rows: existingCards } = await db.query(
      'SELECT id FROM cards WHERE id = $1',
      [id]
    );
    if (existingCards.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    await db.query('DELETE FROM cards WHERE id = $1', [id]);

    broadcastEvent({
      type: 'delete',
      card_id: id
    });

    res.status(204).send();
  } catch (err) {
    console.error('Error deleting card:', err);
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

export { router as cardsRouter };
