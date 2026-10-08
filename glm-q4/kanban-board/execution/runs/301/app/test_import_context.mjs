import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';

const dataDir = './pglite-data';
const pg = new PGLite({ dataDir });

console.log('PGlite initialized successfully');
console.log('Type:', typeof pg);
