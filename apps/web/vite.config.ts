import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

/** In development, /seguimiento serves its own page instead of the ERP fallback (nginx does this in production). */
function trackingPageInDev(): Plugin {
  return {
    name: 'tracking-page-in-dev',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url === '/seguimiento' || request.url?.startsWith('/seguimiento?')) request.url = '/seguimiento.html';
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), trackingPageInDev()],
  resolve: {
    alias: {
      '@': page('./src'),
    },
  },
  build: {
    rollupOptions: {
      // Two separate pages: the ERP (index.html) and the public tracking page.
      input: { main: page('./index.html'), seguimiento: page('./seguimiento.html') },
    },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', ws: true },
    },
  },
});
