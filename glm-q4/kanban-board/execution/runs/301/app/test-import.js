import { PGlite } from '@electric-sql/pglite';
console.log('Import successful:', PGlite);
const pg = new PGlite({ dataDir: './test-pglite' });
console.log('PGLite instance created');
