const { PGlite } = require('@electric-sql/pglite');

const pg = new PGlite({ location: './data' });

console.log('Testing complete flow...');

async function test() {
  try {
    // Create tables separately
    await pg.exec("CREATE TABLE columns (id TEXT PRIMARY KEY, title TEXT NOT NULL, position INTEGER NOT NULL)");
    console.log('Columns table created');

    await pg.exec("CREATE TABLE cards (id TEXT PRIMARY KEY, column_id TEXT NOT NULL, text TEXT NOT NULL, position INTEGER NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
    console.log('Cards table created');

    // Create indexes
    await pg.exec("CREATE INDEX IF NOT EXISTS cards_column_id_idx ON cards(column_id)");
    console.log('Index created');

    await pg.exec("CREATE INDEX IF NOT EXISTS cards_position_idx ON cards(column_id, position)");
    console.log('Index created');

    // Insert columns
    await pg.exec("INSERT INTO columns (id, title, position) VALUES ('todo', 'To Do', 0)");
    console.log('Column inserted');

    await pg.exec("INSERT INTO columns (id, title, position) VALUES ('in-progress', 'In Progress', 1)");
    console.log('Column inserted');

    await pg.exec("INSERT INTO columns (id, title, position) VALUES ('done', 'Done', 2)");
    console.log('Column inserted');

    // Check
    const result = await pg.query('SELECT * FROM columns');
    console.log('Columns:', result.rows);

    const result2 = await pg.query('SELECT * FROM cards');
    console.log('Cards:', result2.rows);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
