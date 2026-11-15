import { describe, expect, it } from 'vitest';

import { ApiError } from '../api/client.js';
import { googleMapsPlaceUrl, googleMapsRouteUrl, mapLinkErrorMessage, MAX_ROUTE_WAYPOINTS } from './googleMaps.js';

const point = (index: number) => ({ latitude: -12 - index / 100, longitude: -77 - index / 100 });

describe('googleMapsPlaceUrl', () => {
  it('builds a search URL that pins the coordinates', () => {
    expect(googleMapsPlaceUrl({ latitude: -12.084, longitude: -77.035 }))
      .toBe('https://www.google.com/maps/search/?api=1&query=-12.084%2C-77.035');
  });
});

describe('googleMapsRouteUrl', () => {
  it('keeps the given visiting order: first point is the origin, last is the destination', () => {
    const result = googleMapsRouteUrl([point(0), point(1), point(2), point(3)]);

    expect(result).toEqual({
      url: 'https://www.google.com/maps/dir/?api=1&origin=-12%2C-77&destination=-12.03%2C-77.03'
        + '&waypoints=-12.01%2C-77.01%7C-12.02%2C-77.02&travelmode=driving',
      omittedStops: 0,
    });
  });

  it('omits the waypoints parameter for a two-point route', () => {
    expect(googleMapsRouteUrl([point(0), point(1)])?.url)
      .toBe('https://www.google.com/maps/dir/?api=1&origin=-12%2C-77&destination=-12.01%2C-77.01&travelmode=driving');
  });

  it('returns nothing when there are fewer than two points', () => {
    expect(googleMapsRouteUrl([point(0)])).toBeNull();
  });

  it('stops at the Google Maps waypoint limit and reports the stops left out', () => {
    const points = Array.from({ length: MAX_ROUTE_WAYPOINTS + 4 }, (_, index) => point(index));

    const result = googleMapsRouteUrl(points);

    const url = new URL(result!.url);
    expect(url.searchParams.get('waypoints')?.split('|')).toHaveLength(MAX_ROUTE_WAYPOINTS);
    expect(url.searchParams.get('destination')).toBe(`${point(MAX_ROUTE_WAYPOINTS + 1).latitude},${point(MAX_ROUTE_WAYPOINTS + 1).longitude}`);
    expect(result!.omittedStops).toBe(2);
  });
});

describe('mapLinkErrorMessage', () => {
  it.each([
    ['invalid_url', 'El enlace no es una dirección web válida.'],
    ['unsupported_host', 'El enlace no es de Google Maps. Usa un enlace https de maps.app.goo.gl o google.com/maps.'],
    ['no_coordinates', 'El enlace no trae coordenadas. Abre el lugar en Google Maps y copia el enlace de la barra de direcciones o “Compartir”.'],
    ['timeout', 'Google Maps tardó demasiado en responder. Inténtalo de nuevo.'],
  ])('explains the %s reason in Spanish', (reason, message) => {
    const error = new ApiError('The Google Maps link could not be resolved to coordinates.', 422,
      'GOOGLE_MAPS_LINK_UNRESOLVED', { reason });

    expect(mapLinkErrorMessage(error)).toBe(message);
  });

  it('reads the reason from a route planning validation issue', () => {
    const error = new ApiError('Google Maps link could not be resolved', 400, 'DELIVERY_ROUTE_INVALID_INPUT',
      { issues: [{ path: 'origin.googleMapsUrl', message: 'x', reason: 'no_coordinates' }] });

    expect(mapLinkErrorMessage(error)).toContain('El enlace no trae coordenadas.');
  });

  it('falls back to a generic message for unknown failures', () => {
    expect(mapLinkErrorMessage(new Error('boom'))).toBe('No se pudo obtener la ubicación del enlace de Google Maps.');
  });
});
