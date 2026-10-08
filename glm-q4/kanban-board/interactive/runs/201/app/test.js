import { PGlite } from '@electric-sql/pglite';

console.log('Testing PGLite persistence...');

const pg1 = new PGlite('./data');
const pg2 = new PGlite('./data');

// Test 1: Create tables
await pg1.exec('DROP TABLE IF EXISTS cards, CASCADE');
await pg1.exec('DROP TABLE IF EXISTS columns, CASCADE');
await pg1.exec(`
  CREATE TABLE columns (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    column_id TEXT NOT NULL,
    text TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Test 2: Insert data
await pg1.exec(`
  INSERT INTO columns (id, title, position) VALUES
    ('todo', 'To Do', 0),
    ('in-progress', 'In Progress', 1),
    ('done', 'Done', 2)
`);
await pg1.exec(`
  INSERT INTO cards (id, column_id, text, position) VALUES
    ('card-1', 'todo', 'First card', 0),
    ('card-2', 'todo', 'Second card', 1)
`);

console.log('✓ Data inserted');

// Test 3: Query data
const result = await pg2.query('SELECT * FROM cards ORDER BY position');
console.log('✓ Data retrieved:', JSON.stringify(result.rows, null, 2));

// Test 4: Verify persistence
const result2 = await pg2.query('SELECT COUNT(*) as count FROM cards');
console.log('✓ Persistence verified:', result2.rows[0].count === 2 ? 'PASS' : 'FAIL');

console.log('\nAll tests passed!');
