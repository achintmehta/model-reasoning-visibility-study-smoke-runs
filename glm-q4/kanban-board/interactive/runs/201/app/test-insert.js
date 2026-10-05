const { PGlite } = require('@electric-sql/pglite');

const pg = new PGlite({ location: './data' });

console.log('Testing INSERT...');

async function test() {
  try {
    await pg.exec("INSERT INTO columns (id, title, position) VALUES ('todo', 'To Do', 0)");
    console.log('Column inserted');

    const result = await pg.query('SELECT * FROM columns');
    console.log('Columns:', result.rows);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
