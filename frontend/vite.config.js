import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Dev server proxies /api to the backend so the frontend runs cross-origin-free.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5178,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});
