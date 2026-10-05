import * as pglite from '@electric-sql/pglite';
console.log('All exports:', Object.keys(pglite));
for (const key of Object.keys(pglite)) {
  console.log(`Key: ${key}, Type of value: ${typeof pglite[key]}`);
}
