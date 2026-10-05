import { PGlite } from '@electric-sql/pglite';

const dataDir = './test-pglite';
const pg = new PGlite({ dataDir });

try {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS test (id TEXT PRIMARY KEY, value TEXT);
    INSERT INTO test (id, value) VALUES ('1', 'test1'), ('2', 'test2');
  `);
  
  const result = await pg.query('SELECT * FROM test');
  console.log('Query result:', result.rows);
} catch (error) {
  console.error('Error:', error);
}
