const pglite = await import('@electric-sql/pglite');
console.log('Type:', typeof pglite);
console.log('Keys:', Object.keys(pglite));
const keys = Object.keys(pglite);
for (const key of keys) {
  console.log(`${key}:`, typeof pglite[key]);
  if (key === 'PGlite') {
    console.log('PGlite value:', pglite[key]);
  }
}
