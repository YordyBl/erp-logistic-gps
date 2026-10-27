/**
 * Shared HTTP contracts.
 *
 * Placeholder: the health payload is the first contract both the API and the
 * web client will consume. Versioned request/response schemas arrive with the
 * pilot modules.
 */
export interface HealthResponse {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}
