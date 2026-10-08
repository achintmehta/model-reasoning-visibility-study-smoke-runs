import { defineConfig } from 'vite';

export default defineConfig({
  root: 'frontend',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: false,
        configure: (proxy) => {
          // Don't proxy SSE connections - they need to be direct
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.url === '/api/stream') {
              // Let the SSE connection pass through as-is
            }
          });
        },
      },
    },
  },
});
