import { PGlite } from '@electric-sql/pglite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../data');

// Initialize PGLite with file system persistence
const db = new PGlite({
  path: dbPath,
  createIfMissing: true
});

// Initialize database schema
async function initDB() {
  try {
    // Create columns table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS columns (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        position REAL NOT NULL DEFAULT 0
      );
    `);

    // Create cards table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        column_id TEXT NOT NULL,
        text TEXT NOT NULL,
        position REAL NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (column_id) REFERENCES columns(id)
      );
    `);

    // Seed default columns if none exist
    const columnCount = await db.result('SELECT COUNT(*) FROM columns;');
    if (parseInt(columnCount.rows[0].count) === 0) {
      await db.exec(`
        INSERT INTO columns (id, title, position) VALUES
          ('todo', 'To Do', 0),
          ('in-progress', 'In Progress', 1),
          ('done', 'Done', 2);
      `);
    }

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Helper function to get ordered cards for a column
async function getOrderedCards(columnId) {
  const result = await db.result(`
    SELECT * FROM cards 
    WHERE column_id = $1 
    ORDER BY position ASC;
  `, [columnId]);
  
  return result.rows;
}

// Helper function to get all columns with their cards
async function getBoardState() {
  const columnsResult = await db.result('SELECT * FROM columns ORDER BY position ASC;');
  const columns = columnsResult.rows;
  
  const boardState = await Promise.all(columns.map(async column => {
    const cards = await getOrderedCards(column.id);
    return { ...column, cards };
  }));
  
  return boardState;
}

// Helper function to handle position normalization
async function normalizePositions(columnId) {
  const cards = await getOrderedCards(columnId);
  
  if (cards.length <= 1) return; // No need to normalize if 0 or 1 cards

  // Assign evenly spaced positions
  const newPositions = cards.map((card, index) => index);
  
  await db.transaction(async (tx) => {
    for (let i = 0; i < cards.length; i++) {
      await tx.exec(`
        UPDATE cards 
        SET position = $1 
        WHERE id = $2;
      `, [newPositions[i], cards[i].id]);
    }
  });
  
  return getOrderedCards(columnId);
}

// Helper function to find position for new card
async function findInsertPosition(columnId, beforeId = null, afterId = null) {
  let position;

  if (beforeId && afterId) {
    // This should not happen in normal usage, but handle it just in case
    throw new Error('Both beforeId and afterId cannot be specified together');
  }

  if (beforeId) {
    // Get the position of the card before which we want to insert
    const beforeCard = await db.result(`
      SELECT position FROM cards WHERE id = $1;
    `, [beforeId]);
    
    if (beforeCard.rows.length === 0) {
      throw new Error(`Card with id ${beforeId} not found`);
    }
    
    position = beforeCard.rows[0].position;
  } else if (afterId) {
    // Get the position of the card after which we want to insert
    const afterCard = await db.result(`
      SELECT position FROM cards WHERE id = $1;
    `, [afterId]);
    
    if (afterCard.rows.length === 0) {
      throw new Error(`Card with id ${afterId} not found`);
    }
    
    position = afterCard.rows[0].position;
  } else {
    // Get the highest position in the column
    const lastCard = await db.result(`
      SELECT MAX(position) AS max_position FROM cards WHERE column_id = $1;
    `, [columnId]);
    
    position = lastCard.rows[0].max_position || -1;
  }

  // Use a fractional position between the reference position and the next position
  const nextCard = await db.result(`
    SELECT position FROM cards 
    WHERE column_id = $1 AND position > $2 
    ORDER BY position ASC 
    LIMIT 1;
  `, [columnId, position]);

  if (nextCard.rows.length > 0) {
    // Insert between current position and next position
    return (position + nextCard.rows[0].position) / 2;
  } else {
    // Append to the end
    return position + 1;
  }
}

export { db, initDB, getBoardState, normalizePositions, findInsertPosition };
