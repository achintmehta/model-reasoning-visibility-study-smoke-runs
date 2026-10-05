import { defineConfig } from 'vite';

export default defineConfig({
  root: './client',
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true
      }
    }
  }
});
