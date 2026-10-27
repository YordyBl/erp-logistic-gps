/**
 * API entry point.
 *
 * Foundations milestone: the process boots and announces itself. HTTP transport,
 * database wiring and the composition root arrive with the first modules.
 */
const DEFAULT_PORT = 3000;

const port = Number(process.env.API_PORT ?? DEFAULT_PORT);

console.log(`[api] erp-logistic API starting on port ${port}`);
console.log('[api] HTTP transport is not wired yet (foundations milestone).');
