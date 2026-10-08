const express = require('express');
const { db } = require('../db');
const { broadcast } = require('./common');
const router = express.Router();
const crypto = require('crypto');

function getNextPosition(columnId) {
  return db.get(`SELECT MAX(position) as maxPos FROM cards WHERE column_id = ?`, [columnId])
    .then(r => (r.maxPos !== null ? r.maxPos + 1 : 1));
}

router.post('/cards', async (req, res) => {
  const { columnId, text } = req.body;
  if (!columnId) return res.status(400).json({error: 'columnId required'});
  try {
    const id = crypto.randomUUID();
    const pos = await getNextPosition(columnId);
    await db.run('INSERT INTO cards (id, column_id, text, position) VALUES (?, ?, ?, ?)', [id, columnId, text, pos]);
    const card = { id, column_id: columnId, text, position: pos };
    broadcast('create', card);
    res.status(201).json(card);
  } catch (err) {
    console.error(err);
    res.status(500).json({error: err.message});
  }
});

router.patch('/cards/:id/move', async (req, res) => {
  const { id } = req.params;
  const { columnId: newColumnId, beforeId, afterId } = req.body;
  if (!newColumnId) return res.status(400).json({error: 'columnId required'});
  try {
    // Fetch card
    const card = await db.get('SELECT * FROM cards WHERE id = ?', [id]);
    if (!card) return res.status(404).json({error: 'Card not found'});
    // Determine new positions
    let beforePos = null;
    let afterPos = null;
    if (beforeId) {
      const before = await db.get('SELECT position FROM cards WHERE id = ?', [beforeId]);
      beforePos = before.position;
    }
    if (afterId) {
      const after = await db.get('SELECT position FROM cards WHERE id = ?', [afterId]);
      afterPos = after.position;
    }
    let newPos;
    if (beforePos !== null && afterPos !== null) {
      newPos = (beforePos + afterPos) / 2;
    } else if (beforePos !== null) {
      newPos = beforePos - 0.5;
    } else if (afterPos !== null) {
      newPos = afterPos + 0.5;
    } else {
      // empty column
      newPos = await getNextPosition(newColumnId);
    }
    // Update card
    await db.run('UPDATE cards SET column_id = ?, position = ? WHERE id = ?', [newColumnId, newPos, id]);
    const updatedCard = { ...card, column_id: newColumnId, position: newPos };
    broadcast('move', updatedCard);
    res.json(updatedCard);
  } catch (err) {
    console.error(err);
    res.status(500).json({error: err.message});
  }
});

module.exports = router;
