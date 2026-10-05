import { PGlite } from '@electric-sql/pglite';

const dataDir = './test-simple-pglite2';
const pg = new PGlite({ dataDir });

try {
  console.log('Creating tables...');
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS columns (id TEXT PRIMARY KEY, title TEXT NOT NULL, position INTEGER NOT NULL);
  `);
  
  console.log('Seeding columns...');
  await pg.exec(`INSERT INTO columns (id, title, position) VALUES ('todo', 'To Do', 0)`);
  await pg.exec(`INSERT INTO columns (id, title, position) VALUES ('inprogress', 'In Progress', 1)`);
  await pg.exec(`INSERT INTO columns (id, title, position) VALUES ('done', 'Done', 2)`);
  
  console.log('Seeding complete');
  const result = await pg.query('SELECT * FROM columns');
  console.log('Query result:', result.rows);
  const count = await pg.query('SELECT COUNT(*) as count FROM columns');
  console.log('Count:', count.rows[0].count);
} catch (error) {
  console.error('Error:', error);
}
