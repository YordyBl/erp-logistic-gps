import { MapLinkResolutionError, type MapLinkResolver } from '../application/ports/MapLinkResolver.js';

export interface MapCoordinates {
  readonly latitude: number;
  readonly longitude: number;
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Hosts whose `/maps` pages are Google Maps (global and Peru domains). */
const MAP_PATH_HOSTS = new Set(['google.com', 'www.google.com', 'google.com.pe', 'www.google.com.pe']);
/** Hosts that only serve Google Maps, so any path is a map page. */
const MAP_ROOT_HOSTS = new Set(['maps.google.com', 'maps.google.com.pe']);
/** Consent interstitial: never requested; only its `continue` map URL is read. */
const CONSENT_HOST = 'consent.google.com';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_URL_LENGTH = 2_048;
const MAX_REDIRECTS = 5;
const RESOLUTION_TIMEOUT_MILLISECONDS = 10_000;

/** Resolves only Google Maps URLs; every redirect is revalidated before a request. */
export class GoogleMapsLinkResolver implements MapLinkResolver {
  constructor(private readonly fetcher: Fetcher = fetch,
    private readonly timeoutMilliseconds: number = RESOLUTION_TIMEOUT_MILLISECONDS) {}

  async resolve(input: string): Promise<MapCoordinates> {
    let current = parseAllowedUrl(input);
    const directCoordinates = parseCoordinates(current);
    if (directCoordinates !== null) return directCoordinates;
    const deadline = Date.now() + this.timeoutMilliseconds;

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new MapLinkResolutionError('timeout');
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
        throw new MapLinkResolutionError(controller.signal.aborted ? 'timeout' : 'unreachable');
      } finally {
        clearTimeout(timeout);
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        await discardBody(response);
        if (location === null || redirects === MAX_REDIRECTS) {
          throw new MapLinkResolutionError('redirect_invalid');
        }
        const consentTarget = consentContinueUrl(location, current);
        if (consentTarget !== null) {
          // Google may send a server to a consent page depending on its region; the map URL
          // it would return to is in `continue`, so read that instead of requesting consent.
          const coordinates = parseCoordinates(consentTarget);
          if (coordinates === null) throw new MapLinkResolutionError('no_coordinates');
          return coordinates;
        }
        current = parseAllowedUrl(location, current);
        continue;
      }

      await discardBody(response);
      if (!response.ok || !isGoogleMapsPage(current)) {
        throw new MapLinkResolutionError('not_map_page');
      }
      const coordinates = parseCoordinates(current);
      if (coordinates === null) throw new MapLinkResolutionError('no_coordinates');
      return coordinates;
    }

    throw new MapLinkResolutionError('redirect_invalid');
  }
}

function parseAllowedUrl(input: string, base?: URL): URL {
  if (input.length === 0 || input.length > MAX_URL_LENGTH) {
    throw new MapLinkResolutionError('invalid_url');
  }

  let url: URL;
  try {
    url = new URL(input, base);
  } catch {
    throw new MapLinkResolutionError('invalid_url');
  }

  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' ||
      (url.port !== '' && url.port !== '443') || (!isShortLink(url) && !isGoogleMapsPage(url))) {
    throw new MapLinkResolutionError('unsupported_host');
  }
  return url;
}

/** Google Maps share links: `maps.app.goo.gl/...` and the legacy `goo.gl/maps/...`. */
function isShortLink(url: URL): boolean {
  return url.hostname === 'maps.app.goo.gl' ||
    (url.hostname === 'goo.gl' && url.pathname.startsWith('/maps/'));
}

function isGoogleMapsPage(url: URL): boolean {
  if (MAP_ROOT_HOSTS.has(url.hostname)) return true;
  return MAP_PATH_HOSTS.has(url.hostname) && (url.pathname === '/maps' || url.pathname.startsWith('/maps/'));
}

/** The allowed map URL a consent redirect returns to, or null when the redirect is not to consent. */
function consentContinueUrl(location: string, base: URL): URL | null {
  let url: URL;
  try {
    url = new URL(location, base);
  } catch {
    throw new MapLinkResolutionError('invalid_url');
  }
  if (url.protocol !== 'https:' || url.hostname !== CONSENT_HOST) return null;
  const target = url.searchParams.get('continue');
  if (target === null) throw new MapLinkResolutionError('redirect_invalid');
  const map = parseAllowedUrl(target);
  if (!isGoogleMapsPage(map)) throw new MapLinkResolutionError('unsupported_host');
  return map;
}

/** A named place's exact coordinates (`!3d<lat>!4d<lng>`), preferred over any other pair. */
const PLACE_PAIR = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/;
/** Embedded maps (`/maps/embed?pb=...`) write the centre longitude first: `!2d<lng>!3d<lat>`. */
const EMBED_PAIR = /!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/;
/** Degrees, minutes and seconds, as in `12°05'02.4"S 77°02'06.0"W`. */
const DMS_PAIR = /(\d{1,2})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)["″]\s*([NS])[\s,]*(\d{1,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)["″]\s*([EW])/i;
/**
 * Any decimal `lat,lng` pair (optional spaces after the comma). Decimals are
 * required so unrelated integers such as `hl=1,2` are never read as a location.
 */
const COORDINATE_PAIR = /(?<![\d.])(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)(?![\d.])/g;

/**
 * Google moves coordinates around: `/maps/@lat,lng,17z`, `/maps/search/lat,+lng`,
 * `?q=lat,lng`, `?ll=lat,lng`, ... One rule covers them all instead of a pattern
 * per format: after the place pair, the first valid pair in the decoded path,
 * then in each query value, wins.
 */
function parseCoordinates(url: URL): MapCoordinates | null {
  const raw = `${url.pathname}${url.search}`;
  const place = raw.match(PLACE_PAIR);
  const fromPlace = place?.[1] === undefined || place[2] === undefined
    ? null : validatedCoordinates(place[1], place[2]);
  if (fromPlace !== null) return fromPlace;
  const embed = raw.match(EMBED_PAIR);
  const fromEmbed = embed?.[1] === undefined || embed[2] === undefined
    ? null : validatedCoordinates(embed[2], embed[1]);
  if (fromEmbed !== null) return fromEmbed;

  for (const text of [decodedPath(url.pathname), ...url.searchParams.values()]) {
    for (const pair of text.matchAll(COORDINATE_PAIR)) {
      const coordinates = pair[1] === undefined || pair[2] === undefined
        ? null : validatedCoordinates(pair[1], pair[2]);
      if (coordinates !== null) return coordinates;
    }
  }
  for (const text of [decodedPath(url.pathname), ...url.searchParams.values()]) {
    const fromDms = parseDms(text);
    if (fromDms !== null) return fromDms;
  }
  return null;
}

function parseDms(text: string): MapCoordinates | null {
  const match = text.match(DMS_PAIR);
  if (match === null) return null;
  const [, latD, latM, latS, latH, lngD, lngM, lngS, lngH] = match;
  const decimal = (degrees?: string, minutes?: string, seconds?: string) =>
    Number(degrees) + Number(minutes) / 60 + Number(seconds) / 3600;
  const latitude = decimal(latD, latM, latS) * (latH?.toUpperCase() === 'S' ? -1 : 1);
  const longitude = decimal(lngD, lngM, lngS) * (lngH?.toUpperCase() === 'W' ? -1 : 1);
  // Seconds carry at most one decimal in practice; six decimals (~0.1 m) avoid float noise.
  return validatedCoordinates(latitude.toFixed(6), longitude.toFixed(6));
}

/** Path text with `%2C`/`%20` decoded and `+` read as a space, as Google writes it. */
function decodedPath(pathname: string): string {
  const spaced = pathname.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
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
