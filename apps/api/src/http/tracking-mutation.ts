export type TrackingMutationKind = 'route' | 'order';

const ORDER_ROOT = '/api/v1/delivery-orders';

/** Restrict update notifications to routes that mutate route/order state. */
export function classifyTrackingMutation(method: string, path: string): TrackingMutationKind | null {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return null;

  if (path === '/api/v1/delivery-routes' || path.startsWith('/api/v1/delivery-routes/')) {
    return 'route';
  }

  if (method === 'POST' && (
    path === ORDER_ROOT ||
    path === `${ORDER_ROOT}/import` ||
    /^\/api\/v1\/delivery-orders\/[^/]+\/cancel$/.test(path)
  )) return 'order';

  if (method === 'PATCH' && /^\/api\/v1\/delivery-orders\/[^/]+$/.test(path)) {
    return 'order';
  }

  return null;
}
