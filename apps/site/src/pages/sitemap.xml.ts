import type { APIRoute } from 'astro';

/** Only the public landing; the privacy page joins once it is final. */
const PATHS = ['/'];

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL('http://localhost');
  const urls = PATHS.map((path) => `  <url><loc>${new URL(path, base).href}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
