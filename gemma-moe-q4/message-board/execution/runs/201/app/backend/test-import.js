import * as pglite from '@electric-sql/pglite';
console.log('All exports:', Object.keys(pglite));
try {
  const { PGLite } = pglite;
  console.log('PGLite found:', !!PGLite);
} catch (e) {
  console.error('Error during PGLite check:', e);
}
