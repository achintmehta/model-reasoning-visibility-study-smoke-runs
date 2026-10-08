import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: path => path.startsWith('/api') ? path.replace(/^\/api/, '') : path,
      },
      '/stream': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: path => path.startsWith('/stream') ? path.replace(/^\/stream/, '') : path,
      },
    },
  },
});
