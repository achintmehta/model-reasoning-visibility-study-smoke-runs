const { PGlite } = require('@electric-sql/pglite');

const pg = new PGlite({ location: './data' });

console.log('Testing columns...');

async function test() {
  try {
    // First, try to create the table
    await pg.exec("CREATE TABLE IF NOT EXISTS columns (id TEXT PRIMARY KEY, title TEXT NOT NULL, position INTEGER NOT NULL)");
    console.log('Table created');

    // Check if the table exists
    const result = await pg.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'columns'");
    console.log('Columns table exists:', result.rows.length > 0);

    // Try a simple INSERT
    try {
      await pg.exec("INSERT INTO columns (id, title, position) VALUES ('test1', 'Test', 1)");
      console.log('INSERT succeeded');
    } catch (err) {
      console.log('INSERT failed:', err.message);
    }

    // Check the result
    const result2 = await pg.query('SELECT * FROM columns');
    console.log('All columns:', result2.rows);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
