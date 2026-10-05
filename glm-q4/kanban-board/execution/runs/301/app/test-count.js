import { PGlite } from '@electric-sql/pglite';

const dataDir = './test-pglite';
const pg = new PGlite({ dataDir });

try {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS columns (id TEXT PRIMARY KEY, title TEXT NOT NULL, position INTEGER NOT NULL);
    INSERT INTO columns (id, title, position) VALUES
      ('todo', 'To Do', 0),
      ('inprogress', 'In Progress', 1),
      ('done', 'Done', 2)
  `);
  
  const result = await pg.query('SELECT COUNT(*) as count FROM columns');
  console.log('Query result:', result.rows);
} catch (error) {
  console.error('Error:', error);
}
