// Import PGLite
const { PGLite } = await import('@electric-sql/pglite');
const path = require('path');
const fs = require('fs');

// Create necessary directories
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// Initialize PGLite with file system persistence
const db = new PGLite({ 
  path: path.join(DATA_DIR, 'messages.db') 
});

// Initialize database schema
async function initDatabase() {
  try {
    // Create messages table if it doesn't exist
    await db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Export the database instance and initialization function
module.exports = { db, initDatabase };