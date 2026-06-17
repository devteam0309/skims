/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Resolve the QA-credentials flag to a STATIC literal at build time so the seeded test
  // accounts/password in Login.jsx are dead-code-eliminated from the production bundle.
  // (A bare `import.meta.env.VITE_SHOW_QA_CREDS` stays a runtime lookup and cannot be DCE'd.)
  const showQaCreds = mode !== 'production' || env.VITE_SHOW_QA_CREDS === 'true';

  return {
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SHOW_QA_CREDS': JSON.stringify(showQaCreds ? 'true' : 'false'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/tests/setup.js',
    css: false,
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-charts': ['recharts'],
          'vendor-motion': ['framer-motion'],
          'vendor-sweetalert': ['sweetalert2'],
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  };
});
