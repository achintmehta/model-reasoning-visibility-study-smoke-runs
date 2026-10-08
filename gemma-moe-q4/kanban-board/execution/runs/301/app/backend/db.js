import { PGLite } from '@electric-sql/pglite';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

let db;

export async function getDb() {
  if (db) return db;

  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }

  db = new PGLite(DATA_DIR);
  await setupSchema();
  return db;
}

async function setupSchema() {
  // Note: db is not yet assigned to the module-level db, 
  // but we are inside the getDb function where it is.
  // However, we need to use the local db instance.
  // Wait, let's refine this.
}
