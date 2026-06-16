import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../static',
    emptyOutDir: true,
    // maplibre-gl alone is ~1.1 MB minified and lives in its own vendor-map
    // chunk; raise the advisory limit above it while still catching a runaway
    // app bundle.
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Geo stack (maplibre-gl + terra-draw + adapter) is the heaviest
          // dependency; keep it in its own long-lived chunk.
          if (id.includes('node_modules/maplibre-gl') || id.includes('node_modules/terra-draw')) {
            return 'vendor-map';
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/lucide-react') || id.includes('node_modules/sonner') || id.includes('node_modules/@radix-ui')) {
            return 'vendor-ui';
          }
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/auth': 'http://localhost:8000',
    },
  },
})
