const express = require('express');
const { db } = require('../db');
const router = express.Router();

router.get('/board', async (req, res) => {
  try {
    const columns = await db.all('SELECT * FROM columns ORDER BY position ASC');
    const colMap = {};
    columns.forEach(col => { col.cards = []; colMap[col.id] = col; });
    const cards = await db.all('SELECT * FROM cards ORDER BY column_id, position ASC');
    cards.forEach(card => {
      const col = colMap[card.column_id];
      if (col) col.cards.push(card);
    });
    res.json(columns);
  } catch (err) {
    console.error(err);
    res.status(500).json({error: err.message});
  }
});

module.exports = router;
