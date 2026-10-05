const db = require('../db');

async function getBoard() {
  const { rows: columns } = await db.query('SELECT id, title, position FROM columns ORDER BY position;');
  const board = [];
  for (const col of columns) {
    const { rows: cards } = await db.query('SELECT id, column_id, text, position, created_at FROM cards WHERE column_id = ? ORDER BY position;', [col.id]);
    board.push({
      id: col.id,
      title: col.title,
      position: col.position,
      cards: cards.map(c => ({ id: c.id, columnId: c.column_id, text: c.text, position: c.position, createdAt: c.created_at }))
    });
  }
  return board;
}

async function createCard(columnId, text) {
  // find max position
  const { rows } = await db.query('SELECT MAX(position) as maxPos FROM cards WHERE column_id = ?;', [columnId]);
  const maxPos = rows[0].maxPos || 0;
  const position = maxPos + 1;
  await db.query('INSERT INTO cards (column_id, text, position, created_at) VALUES (?, ?, ?, datetime('now'));', [columnId, text, position]);
  const { rows: idRows } = await db.query('SELECT last_insert_rowid() as id;');
  const id = idRows[0].id;
  const card = {
    id,
    columnId,
    text,
    position,
    createdAt: new Date().toISOString()
  };
  return card;}
}

async function moveCard(id, columnId, beforeId, afterId) {
  // compute new position
  let between = [];
  if (beforeId) {
    const { rows } = await db.query('SELECT position FROM cards WHERE id = ?;', [beforeId]);
    between.push(rows[0].position);
  }
  if (afterId) {
    const { rows } = await db.query('SELECT position FROM cards WHERE id = ?;', [afterId]);
    between.push(rows[0].position);
  }
  let newPos;
  const epsilon = 0.000001;
  if (between.length === 2) {
    newPos = (between[0] + between[1]) / 2;
  } else if (between.length === 1) {
    // only one side
    if (beforeId) {
      newPos = between[0] + epsilon;
    } else if (afterId) {
      newPos = between[0] - epsilon;
    }
  } else {
    // no reference: place at end
    const { rows } = await db.query('SELECT MAX(position) as maxPos FROM cards WHERE column_id = ?;', [columnId]);
    newPos = (rows[0].maxPos || 0) + 1;
  }
  // perform update
  await db.exec(`BEGIN;`);
  await db.query(`UPDATE cards SET column_id = ?, position = ? WHERE id = ?;`, [columnId, newPos, id]);
  await db.exec(`COMMIT;`);

  const { rows: c } = await db.query('SELECT id, column_id, text, position, created_at FROM cards WHERE id = ?;', [id]);
  const card = c[0];
  return {
    id: card.id,
    columnId: card.column_id,
    text: card.text,
    position: card.position,
    createdAt: card.created_at
  };
}

module.exports = { getBoard, createCard, moveCard };
