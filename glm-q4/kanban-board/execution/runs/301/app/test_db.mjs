const pglite = await import('@electric-sql/pglite');
const { PGlite } = pglite;

const dataDir = './pglite-data';
const pg = new PGlite({ dataDir });

async function test() {
  try {
    // Check if columns table exists
    const result = await pg.query(`
      SELECT * FROM columns ORDER BY position
    `);
    console.log('Columns:', result.rows);
    
    // Check if cards table exists
    const cardsResult = await pg.query(`
      SELECT * FROM cards
    `);
    console.log('Cards:', cardsResult.rows);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
