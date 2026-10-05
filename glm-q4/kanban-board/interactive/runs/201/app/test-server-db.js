const { PGlite } = require('@electric-sql/pglite');

// Test the exact same initialization that the server uses
const pg = new PGlite({ location: './data' });

console.log('Testing server initialization...');

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

    // Seed default columns if empty
    const columns = await pg.query('SELECT COUNT(*) as count FROM columns');
    console.log('Column count before seeding:', columns.rows[0].count);

    if (columns.rows[0].count === '0') {
      await pg.exec(`
        INSERT INTO columns (id, title, position) VALUES
          ('todo', 'To Do', 0),
          ('in-progress', 'In Progress', 1),
          ('done', 'Done', 2)
      `);
      console.log('Default columns seeded');
    } else {
      console.log('Columns already exist');
    }

    const columns2 = await pg.query('SELECT COUNT(*) as count FROM columns');
    console.log('Column count after seeding:', columns2.rows[0].count);

    const result = await pg.query('SELECT * FROM columns');
    console.log('Columns:', result.rows);

    const result2 = await pg.query('SELECT * FROM cards');
    console.log('Cards:', result2.rows);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
