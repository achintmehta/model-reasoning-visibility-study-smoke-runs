import { PGlite } from '@electric-sql/pglite';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../data/db');

let db;

// Initialize the database connection
export async function initDB() {
  db = new PGlite({ 
    auth: { mode: 'trust' },
    path: dbPath
  });

  // Create tables if they don't exist
  await createTables();
  
  // Seed default columns if none exist
  await seedDefaultColumns();
  
  return db;
}

// Create columns and cards tables
async function createTables() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT NOT NULL,
      text TEXT NOT NULL,
      position REAL NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE
    );
  `);
}

// Seed default columns
async function seedDefaultColumns() {
  const result = await db.query('SELECT COUNT(*) FROM columns');
  const count = parseInt(result.rows[0].count);
  
  if (count === 0) {
    await db.exec(`
      INSERT INTO columns (id, title, position) VALUES
        ('todo', 'To Do', 1),
        ('in-progress', 'In Progress', 2),
        ('done', 'Done', 3);
    `);
  }
}

// Get all columns with their cards, ordered by position
export async function getBoardState() {
  const columnsResult = await db.query('SELECT * FROM columns ORDER BY position');
  const columns = columnsResult.rows;
  
  for (let column of columns) {
    // Use string concatenation for PGLite
    const cardsResult = await db.query(`
      SELECT * FROM cards WHERE column_id = '${column.id}' ORDER BY position
    `);
    column.cards = cardsResult.rows;
  }
  
  return columns;
}

// Create a new card in a column
export async function createCard(columnId, text) {
  const id = crypto.randomUUID();
  const position = await getNextCardPosition(columnId);
  
  // Use string concatenation for PGLite (not ideal, but works for testing)
  await db.exec(`
    INSERT INTO cards (id, column_id, text, position) 
    VALUES ('${id}', '${columnId}', '${text}', ${position})
  `);
  
  return getCardById(id);
}

// Get the next position for a new card in a column
async function getNextCardPosition(columnId) {
  // Use string concatenation for PGLite
  const result = await db.query(`
    SELECT MAX(position) FROM cards WHERE column_id = '${columnId}'
  `);
  const maxPosition = result.rows[0]?.max ? parseFloat(result.rows[0].max) : null;
  
  return maxPosition ? maxPosition + 1 : 1;
}

// Get a card by ID
export async function getCardById(id) {
  // Use string concatenation for PGLite
  const result = await db.query(`SELECT * FROM cards WHERE id = '${id}'`);
  return result.rows[0];
}

// Move a card to a new column and/or position
export async function moveCard(cardId, targetColumnId, beforeId, afterId) {
  return db.transaction(async (tx) => {
    // Get the card we're moving
    const cardResult = await tx.query(`SELECT * FROM cards WHERE id = '${cardId}'`);
    const card = cardResult.rows[0];
    
    if (!card) {
      throw new Error('Card not found');
    }
    
    // Remove the card from its current column
    await tx.exec(`DELETE FROM cards WHERE id = '${cardId}'`);
    
    // Get the new position for the card in the target column
    let newPosition;
    
    if (beforeId && afterId) {
      // This should not happen as per our API design
      throw new Error('Invalid: both beforeId and afterId provided');
    } else if (beforeId) {
      // Insert before the card with beforeId
      const beforeResult = await tx.query(`
        SELECT position FROM cards WHERE id = '${beforeId}' AND column_id = '${targetColumnId}'
      `);
      const beforeCard = beforeResult.rows[0];
      
      if (!beforeCard) {
        throw new Error('Before card not found in target column');
      }
      
      newPosition = (beforeCard.position + 1) / 2;
    } else if (afterId) {
      // Insert after the card with afterId
      const afterResult = await tx.query(`
        SELECT position FROM cards WHERE id = '${afterId}' AND column_id = '${targetColumnId}'
      `);
      const afterCard = afterResult.rows[0];
      
      if (!afterCard) {
        throw new Error('After card not found in target column');
      }
      
      newPosition = (afterCard.position + 1) / 2;
    } else {
      // Append to the end of the column
      const maxResult = await tx.query(`
        SELECT MAX(position) FROM cards WHERE column_id = '${targetColumnId}'
      `);
      const maxPosition = maxResult.rows[0]?.max ? parseFloat(maxResult.rows[0].max) : null;
      
      newPosition = maxPosition ? maxPosition + 1 : 1;
    }
    
    // Insert the card in its new position
    await tx.exec(`
      INSERT INTO cards (id, column_id, text, position) 
      VALUES ('${cardId}', '${targetColumnId}', '${card.text}', ${newPosition})
    `);
    
    // Return the updated card
    const updatedResult = await tx.query(`SELECT * FROM cards WHERE id = '${cardId}'`);
    return updatedResult.rows[0];
  });
}

// Handle position collisions or precision exhaustion
export async function renormalizeColumnPositions(columnId) {
  // Use string concatenation for PGLite
  const cardsResult = await db.query(`
    SELECT id, text FROM cards WHERE column_id = '${columnId}' ORDER BY position
  `);
  const cards = cardsResult.rows;
  
  // Renormalize positions to integers
  for (let i = 0; i < cards.length; i++) {
    await db.exec(`
      UPDATE cards SET position = ${i + 1} WHERE id = '${cards[i].id}'
    `);
  }
  
  // Return the updated cards
  // Use string concatenation for PGLite
  const updatedResult = await db.query(`
    SELECT * FROM cards WHERE column_id = '${columnId}' ORDER BY position
  `);
  return updatedResult.rows;
}