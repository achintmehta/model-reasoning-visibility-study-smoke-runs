import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: '../dist',
  },
});
