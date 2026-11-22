import type { PublicTracking } from './types.js';

/**
 * Stand-in for `GET /api/v1/public/tracking` until the backend exists.
 * Demo links: /seguimiento#k=demo-programado, demo-camino, demo-otra-parada,
 * demo-sin-senal, demo-entregado, demo-fallido. Any other key behaves like an
 * expired, revoked or unknown link.
 */

export class TrackingUnavailableError extends Error {
  constructor() {
    super('Tracking link is not available');
    this.name = 'TrackingUnavailableError';
  }
}

const BASE: Omit<PublicTracking, 'status' | 'route' | 'delivery' | 'failure'> = {
  company: { name: 'Courier Express', initials: 'CE', color: '#1e3a8a', whatsapp: '51900000123' },
  sender: 'Librería Ática',
  publicCode: 'LIM-0144',
  plannedDate: '2026-11-22',
  timeWindow: 'AM',
  deliveryAddress: 'Jr. Bolognesi 455, Barranco',
  recipientName: 'Carmen Paredes',
  packages: '2 cajas',
  driver: { firstName: 'María', vehicle: 'moto', plate: 'BXK-482' },
};

/** Sample route from Miraflores to Barranco (illustrative coordinates). */
const PATH = [
  [-77.0302, -12.1222], [-77.0291, -12.1268], [-77.0272, -12.1318],
  [-77.0251, -12.1371], [-77.0233, -12.1418], [-77.0219, -12.1458],
] as const;
const DESTINATION = PATH[5];

function secondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function scenario(key: string): PublicTracking | null {
  switch (key) {
    case 'demo-programado':
      return { ...BASE, plannedDate: '2026-11-23', status: 'scheduled', driver: null, route: null, delivery: null, failure: null };
    case 'demo-camino':
      return {
        ...BASE, status: 'in_transit', delivery: null, failure: null,
        route: { stopsBefore: 2, path: PATH, destination: DESTINATION, driver: { state: 'moving', at: PATH[2], updatedAt: secondsAgo(30) } },
      };
    case 'demo-otra-parada':
      return {
        ...BASE, status: 'in_transit', delivery: null, failure: null,
        route: { stopsBefore: 1, path: PATH, destination: DESTINATION, driver: { state: 'at_other_stop', at: PATH[3], updatedAt: secondsAgo(20) } },
      };
    case 'demo-sin-senal':
      return {
        ...BASE, status: 'in_transit', delivery: null, failure: null,
        route: { stopsBefore: 2, path: PATH, destination: DESTINATION, driver: { state: 'stale', at: PATH[1], updatedAt: secondsAgo(12 * 60) } },
      };
    case 'demo-entregado':
      return {
        ...BASE, status: 'delivered', route: null, failure: null,
        delivery: { deliveredAt: '2026-11-22T15:42:00.000Z', receivedBy: 'Carmen Paredes', photoUrls: ['/seguimiento-demo/entrega.svg'] },
      };
    case 'demo-fallido':
      return {
        ...BASE, status: 'failed', route: null, delivery: null,
        failure: { at: '2026-11-22T16:05:00.000Z', reason: 'No encontró a nadie en la dirección' },
      };
    default:
      return null;
  }
}

export async function fetchPublicTracking(key: string): Promise<PublicTracking> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const data = scenario(key);
  if (data === null) throw new TrackingUnavailableError();
  return data;
}
