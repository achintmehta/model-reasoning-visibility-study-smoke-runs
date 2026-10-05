const { PGlite } = require('@electric-sql/pglite');

const pg = new PGlite({ location: './data' });

console.log('Testing insertion...');

async function test() {
  try {
    // First, try the INSERT statement
    await pg.exec(`
      INSERT INTO columns (id, title, position) VALUES
        ('todo', 'To Do', 0),
        ('in-progress', 'In Progress', 1),
        ('done', 'Done', 2)
    `);

    console.log('INSERT succeeded');

    // Check the result
    const result = await pg.query('SELECT * FROM columns');
    console.log('Columns:', result.rows);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
