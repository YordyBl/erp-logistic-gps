import process from 'node:process';

import { defineConfig } from 'astro/config';

/**
 * Public site served by nginx at `/`; the ERP SPA lives at `/app`.
 * SITE_URL (for example https://erplogistic.pe) enables canonical URLs, Open Graph
 * absolute URLs and the sitemap. Without it those tags are left out.
 */
export default defineConfig({
  site: process.env.SITE_URL || undefined,
  trailingSlash: 'never',
  build: { format: 'file' },
  server: { port: 4321 },
});
