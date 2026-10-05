const { PGLite } = require('@electric-sql/pglite');

// Path to store data
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'kanban.db');

// Ensure directory exists
const fs = require('fs');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new PGLite({ name: dbPath });

module.exports = db;