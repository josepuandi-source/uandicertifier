import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split heavy libs into their own long-cacheable chunks.
        manualChunks: {
          react: ['react', 'react-dom'],
          pdf: ['pdf-lib'],
          zip: ['jszip'],
        },
      },
    },
  },
});
