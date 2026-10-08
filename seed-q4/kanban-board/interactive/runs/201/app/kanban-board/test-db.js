const { PGlite } = require('@electric-sql/pglite');
const path = require('path');
const fs = require('fs').promises;

// Create necessary directories if they don't exist
const DATA_DIR = path.join(__dirname, 'data');

async function testDB() {
  try {
    console.log('Initializing PGlite...');
    await fs.mkdir(DATA_DIR, { recursive: true });
    const db = new PGlite({ 
      dir: DATA_DIR,
      defaultDatabase: 'kanban'
    });
    
    console.log('Creating tables...');
    await db.exec(`
      CREATE TABLE IF NOT EXISTS columns (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        position REAL NOT NULL DEFAULT 0
      );
      
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        column_id TEXT NOT NULL REFERENCES columns(id),
        text TEXT NOT NULL,
        position REAL NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE
      );
    `);
    
    console.log('Checking columns count...');
    const columnsCount = await db.query('SELECT COUNT(*) FROM columns');
    console.log('Columns count:', columnsCount.rows[0].count);
    
    if (columnsCount.rows[0].count === '0') {
      console.log('Seeding default columns...');
      await db.exec(`
        INSERT INTO columns (id, title, position) VALUES
        ('todo', 'To Do', 0),
        ('in-progress', 'In Progress', 1),
        ('done', 'Done', 2);
      `);
    }
    
    console.log('Verifying columns...');
    const columns = await db.query('SELECT * FROM columns');
    console.log('Columns in database:', columns.rows);
    
    console.log('DB test completed successfully!');
    return db;
  } catch (error) {
    console.error('Error in DB test:', error);
    throw error;
  }
}

testDB();