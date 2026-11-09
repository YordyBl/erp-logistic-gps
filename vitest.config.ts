import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['apps/api/src/**/*.test.ts', 'apps/web/src/**/*.test.{ts,tsx}'],
    setupFiles: ['apps/web/src/test/setup.ts'],
  },
});
