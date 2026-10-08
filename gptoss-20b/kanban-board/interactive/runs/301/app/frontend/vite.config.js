import { defineConfig } from 'vite';
export default defineConfig({
  root: 'frontend',
  publicDir: 'frontend/public',
  build: { outDir: '../dist' }
});
