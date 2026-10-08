try {
  const pglite = await import('@electric-sql/pglite');
  console.log('Import successful');
  console.log('PGlite:', pglite.PGLite);
  const { PGlite } = pglite;
  console.log('PGlite destructured:', PGlite);
  const dataDir = './pglite-data';
  const pg = new PGlite({ dataDir });
  console.log('PGlite instance created:', pg);
} catch (error) {
  console.error('Error:', error);
  console.error('Stack:', error.stack);
}
