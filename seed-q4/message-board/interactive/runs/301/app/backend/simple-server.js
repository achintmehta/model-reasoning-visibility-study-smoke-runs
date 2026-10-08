// Simple test to get PGLite working
async function testPGLite() {
  try {
    // Try different import methods
    const { PGLite } = await import('@electric-sql/pglite');
    console.log('Successfully imported PGLite');
    
    // Initialize PGLite
    const db = new PGLite();
    console.log('Successfully created PGLite instance');
    
    // Test a simple query
    const result = await db.query('SELECT version()');
    console.log('PostgreSQL version:', result.rows[0].version);
    
    return db;
  } catch (error) {
    console.error('Error with PGLite:', error);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

// Run the test
testPGLite();