import type { Request, Response } from 'express';

/**
 * Refresh-token cookie transport (ADR-003 §4).
 *
 * The cookie is the only place the raw refresh token is sent to the client.
 * `HttpOnly` keeps it away from JavaScript, `SameSite=Strict` removes the need
 * for a separate CSRF token in the MVP, and `Secure` is configuration-driven so
 * local plain-HTTP development can opt out explicitly (S9).
 *
 * The path is narrowed to the auth endpoints: the browser does not attach the
 * refresh secret to every delivery-orders request.
 */
export const REFRESH_COOKIE_NAME = 'erp_refresh_token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export interface RefreshCookieConfig {
  /** `COOKIE_SECURE`; false only for local HTTP development. */
  readonly secure: boolean;
  /** Refresh-token lifetime in seconds; rendered as `Max-Age`. */
  readonly maxAgeSeconds: number;
}

function refreshCookieOptions(config: RefreshCookieConfig) {
  return {
    httpOnly: true,
    secure: config.secure,
    sameSite: 'strict' as const,
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(
  response: Response,
  refreshToken: string,
  config: RefreshCookieConfig,
): void {
  response.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...refreshCookieOptions(config),
    // Express accepts milliseconds and emits `Max-Age` in seconds.
    maxAge: config.maxAgeSeconds * 1000,
  });
}

/**
 * Expires the cookie immediately.
 *
 * `maxAge: 0` is deliberate: it renders `Max-Age=0`, which every browser
 * treats as deletion, and keeps the response shape identical to a normal set.
 */
export function clearRefreshCookie(
  response: Response,
  config: RefreshCookieConfig,
): void {
  response.cookie(REFRESH_COOKIE_NAME, '', {
    ...refreshCookieOptions(config),
    maxAge: 0,
  });
}

/**
 * Reads the refresh token from the raw `Cookie` header.
 *
 * Parsing is local and conservative: no dependency is added just for one
 * cookie, malformed segments are ignored, and a missing/empty value is
 * `undefined` so the route can answer the documented 401.
 */
export function readRefreshCookie(request: Request): string | undefined {
  const header = request.headers.cookie;

  if (header === undefined) {
    return undefined;
  }

  for (const segment of header.split(';')) {
    const separator = segment.indexOf('=');

    if (separator === -1) {
      continue;
    }

    const name = segment.slice(0, separator).trim();

    if (name !== REFRESH_COOKIE_NAME) {
      continue;
    }

    const rawValue = segment.slice(separator + 1).trim();

    if (rawValue.length === 0) {
      return undefined;
    }

    try {
      return decodeURIComponent(rawValue);
    } catch {
      // A malformed escape is not a token; treat it like a missing cookie.
      return undefined;
    }
  }

  return undefined;
}
