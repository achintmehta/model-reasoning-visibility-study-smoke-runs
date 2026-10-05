const { PGlite } = require('@electric-sql/pglite');

const pg = new PGlite({ location: './test-data' });

pg.exec('CREATE TABLE IF NOT EXISTS test (id TEXT, value TEXT)')
  .then(() => {
    console.log('Table created');
    return pg.exec("INSERT INTO test (id, value) VALUES ('test1', 'hello')");
  })
  .then(() => {
    console.log('Insert successful');
    return pg.query('SELECT * FROM test');
  })
  .then(result => {
    console.log('Query result:', result.rows);
  })
  .catch(e => {
    console.error('Error:', e);
  });
