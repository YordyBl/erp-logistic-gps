import type { MapLinkResolver } from '../application/ports/MapLinkResolver.js';

export interface MapCoordinates {
  readonly latitude: number;
  readonly longitude: number;
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const ALLOWED_HOSTS = new Set(['maps.app.goo.gl', 'google.com', 'www.google.com', 'maps.google.com']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_URL_LENGTH = 2_048;
const MAX_REDIRECTS = 5;
const RESOLUTION_TIMEOUT_MILLISECONDS = 10_000;

/** Resolves only Google Maps URLs; every redirect is revalidated before a request. */
export class GoogleMapsLinkResolver implements MapLinkResolver {
  constructor(private readonly fetcher: Fetcher = fetch) {}

  async resolve(input: string): Promise<MapCoordinates> {
    let current = parseAllowedUrl(input);
    const directCoordinates = parseCoordinates(current);
    if (directCoordinates !== null) return directCoordinates;
    const deadline = Date.now() + RESOLUTION_TIMEOUT_MILLISECONDS;

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Google Maps link resolution timed out');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), remaining);
      let response: Response;
      try {
        response = await this.fetcher(current, {
          method: 'GET',
          redirect: 'manual',
          headers: { accept: 'text/html' },
          signal: controller.signal,
        });
      } catch {
        throw new Error('Google Maps link could not be resolved');
      } finally {
        clearTimeout(timeout);
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        await discardBody(response);
        if (location === null || redirects === MAX_REDIRECTS) {
          throw new Error('Google Maps link has an invalid redirect chain');
        }
        current = parseAllowedUrl(location, current);
        continue;
      }

      await discardBody(response);
      if (!response.ok || !isGoogleMapsPage(current)) {
        throw new Error('Google Maps link did not resolve to a map page');
      }
      const coordinates = parseCoordinates(current);
      if (coordinates === null) throw new Error('Google Maps link does not identify a location');
      return coordinates;
    }

    throw new Error('Google Maps link has too many redirects');
  }
}

function parseAllowedUrl(input: string, base?: URL): URL {
  if (input.length === 0 || input.length > MAX_URL_LENGTH) {
    throw new Error('Google Maps URL is invalid');
  }

  let url: URL;
  try {
    url = new URL(input, base);
  } catch {
    throw new Error('Google Maps URL is invalid');
  }

  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' ||
      (url.port !== '' && url.port !== '443') || !ALLOWED_HOSTS.has(url.hostname) ||
      (url.hostname !== 'maps.app.goo.gl' && !isGoogleMapsPage(url))) {
    throw new Error('Only HTTPS Google Maps links are supported');
  }
  return url;
}

function isGoogleMapsPage(url: URL): boolean {
  return url.hostname !== 'maps.app.goo.gl' &&
    (url.pathname === '/maps' || url.pathname.startsWith('/maps/'));
}

function parseCoordinates(url: URL): MapCoordinates | null {
  const content = `${url.pathname}${url.search}`;
  const placeCoordinates = content.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (placeCoordinates !== null) {
    const latitude = placeCoordinates[1];
    const longitude = placeCoordinates[2];
    if (latitude !== undefined && longitude !== undefined) {
      return validatedCoordinates(latitude, longitude);
    }
  }

  const viewportCoordinates = content.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (viewportCoordinates !== null) {
    const latitude = viewportCoordinates[1];
    const longitude = viewportCoordinates[2];
    if (latitude !== undefined && longitude !== undefined) {
      return validatedCoordinates(latitude, longitude);
    }
  }

  for (const key of ['q', 'query', 'destination', 'daddr']) {
    const value = url.searchParams.get(key);
    if (value === null) continue;
    const pair = value.replace(/^loc:/i, '').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    const latitude = pair?.[1];
    const longitude = pair?.[2];
    if (latitude !== undefined && longitude !== undefined) {
      return validatedCoordinates(latitude, longitude);
    }
  }
  return null;
}

function validatedCoordinates(latitudeValue: string, longitudeValue: string): MapCoordinates | null {
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The redirect and location are all that are needed; no response body is read.
  }
}
