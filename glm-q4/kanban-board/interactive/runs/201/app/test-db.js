const { PGlite } = require('@electric-sql/pglite');

const pg = new PGlite({ location: './data' });

console.log('Testing database initialization...');

async function test() {
  try {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      column_id TEXT NOT NULL,
      text TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS cards_column_id_idx ON cards(column_id);
    CREATE INDEX IF NOT EXISTS cards_position_idx ON cards(column_id, position);
  `);

  console.log('Tables created');

  // Seed default columns
  const columns = await pg.query('SELECT COUNT(*) as count FROM columns');
  console.log('Column count:', columns.rows[0].count);

  if (columns.rows[0].count === '0') {
    await pg.exec(`
      INSERT INTO columns (id, title, position) VALUES
        ('todo', 'To Do', 0),
        ('in-progress', 'In Progress', 1),
        ('done', 'Done', 2)
    `);
    console.log('Default columns seeded');
  }

  // Test inserting a card
  await pg.exec("INSERT INTO cards (id, column_id, text, position) VALUES ('card-1', 'todo', 'Test card', 0)");
  console.log('Card inserted');

  // Test querying
  const result = await pg.query('SELECT * FROM cards');
  console.log('Cards:', result.rows);

  const columnResult = await pg.query('SELECT * FROM columns');
  console.log('Columns:', columnResult.rows);

  console.log('Database test completed successfully!');
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
}
}

test();
