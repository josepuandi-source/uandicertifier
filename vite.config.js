import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Serves /api/* from server/auth.js during `vite dev` and `vite preview`, the
// same handlers Vercel runs from api/*.js in production.
function localApi(mode) {
  const mount = async (server) => {
    Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
    const auth = await import('./server/auth.js');
    const routes = { '/api/login': auth.login, '/api/logout': auth.logout, '/api/me': auth.me, '/api/stamp': auth.stamp };
    server.middlewares.use((req, res, next) => {
      const fn = routes[req.url.split('?')[0]];
      return fn ? auth.safe(fn)(req, res) : next();
    });
  };
  return { name: 'local-api', configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), localApi(mode)],
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
}));
