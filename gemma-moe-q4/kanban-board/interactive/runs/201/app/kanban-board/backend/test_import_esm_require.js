import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PGLite } = require('@electric-sql/pglite');

console.log('PGLite:', PGLite);
if (PGLite) {
  const db = new PGLite(':memory:');
  console.log('PGLite instance created successfully');
} else {
  console.log('PGLite is undefined');
}
