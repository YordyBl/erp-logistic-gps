import { ApiError } from '../api/client.js';

export interface MapPoint {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Google Maps URLs accept at most nine intermediate waypoints (three on mobile
 * browsers): https://developers.google.com/maps/documentation/urls/get-started
 */
export const MAX_ROUTE_WAYPOINTS = 9;

const coordinates = (point: MapPoint) => `${point.latitude},${point.longitude}`;

/** A pin on the given coordinates. */
export function googleMapsPlaceUrl(point: MapPoint): string {
  const params = new URLSearchParams({ api: '1', query: coordinates(point) });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/**
 * Driving directions through the points in the given order (first = origin,
 * last = destination); Google Maps does not reorder them. Points beyond the
 * waypoint limit are left out and counted in `omittedStops`.
 */
export function googleMapsRouteUrl(points: readonly MapPoint[]): { readonly url: string; readonly omittedStops: number } | null {
  if (points.length < 2) return null;
  const included = points.slice(0, MAX_ROUTE_WAYPOINTS + 2);
  const origin = included[0]!;
  const destination = included[included.length - 1]!;
  const waypoints = included.slice(1, -1);
  const params = new URLSearchParams({ api: '1', origin: coordinates(origin), destination: coordinates(destination) });
  if (waypoints.length > 0) params.set('waypoints', waypoints.map(coordinates).join('|'));
  params.set('travelmode', 'driving');
  return { url: `https://www.google.com/maps/dir/?${params.toString()}`, omittedStops: points.length - included.length };
}

const REASON_MESSAGES: Readonly<Record<string, string>> = {
  invalid_url: 'El enlace no es una dirección web válida.',
  unsupported_host: 'El enlace no es de Google Maps. Usa un enlace https de maps.app.goo.gl o google.com/maps.',
  unreachable: 'No se pudo contactar a Google Maps. Revisa la conexión e inténtalo de nuevo.',
  timeout: 'Google Maps tardó demasiado en responder. Inténtalo de nuevo.',
  redirect_invalid: 'El enlace redirige de una forma que no se puede seguir. Copia el enlace completo del lugar.',
  not_map_page: 'El enlace no lleva a un lugar de Google Maps.',
  no_coordinates: 'El enlace no trae coordenadas. Abre el lugar en Google Maps y copia el enlace de la barra de direcciones o “Compartir”.',
};

function reasonOf(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const { reason, issues } = details as { readonly reason?: unknown; readonly issues?: unknown };
  if (typeof reason === 'string') return reason;
  if (!Array.isArray(issues)) return undefined;
  for (const issue of issues as unknown[]) {
    const nested = typeof issue === 'object' && issue !== null ? (issue as { readonly reason?: unknown }).reason : undefined;
    if (typeof nested === 'string') return nested;
  }
  return undefined;
}

/** Spanish explanation when the error says why a map link failed; null for any other error. */
export function mapLinkFailureMessage(cause: unknown): string | null {
  const reason = cause instanceof ApiError ? reasonOf(cause.details) : undefined;
  return (reason === undefined ? undefined : REASON_MESSAGES[reason]) ?? null;
}

/** Spanish explanation of why a Google Maps link produced no coordinates. */
export function mapLinkErrorMessage(cause: unknown): string {
  return mapLinkFailureMessage(cause) ?? 'No se pudo obtener la ubicación del enlace de Google Maps.';
}
