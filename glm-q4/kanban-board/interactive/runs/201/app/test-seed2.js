const { PGlite } = require('@electric-sql/pglite');

const pg = new PGlite({ location: './data' });

console.log('Testing insertion with individual statements...');

async function test() {
  try {
    // First, try the INSERT statement
    await pg.exec("INSERT INTO columns (id, title, position) VALUES ('todo', 'To Do', 0)");
    console.log('INSERT 1 succeeded');

    await pg.exec("INSERT INTO columns (id, title, position) VALUES ('in-progress', 'In Progress', 1)");
    console.log('INSERT 2 succeeded');

    await pg.exec("INSERT INTO columns (id, title, position) VALUES ('done', 'Done', 2)");
    console.log('INSERT 3 succeeded');

    // Check the result
    const result = await pg.query('SELECT * FROM columns');
    console.log('Columns:', result.rows);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
