export interface MapLinkCoordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Why a map link produced no coordinates. Safe to show to clients: it names the
 * failure class only, never the remote response or the redirect targets.
 */
export type MapLinkFailureReason =
  | 'invalid_url'
  | 'unsupported_host'
  | 'unreachable'
  | 'timeout'
  | 'redirect_invalid'
  | 'not_map_page'
  | 'no_coordinates';

export class MapLinkResolutionError extends Error {
  constructor(readonly reason: MapLinkFailureReason, message: string = `Map link could not be resolved: ${reason}`) {
    super(message);
    this.name = 'MapLinkResolutionError';
  }
}

/** Reason for any failure: errors that are not typed count as an unreachable service. */
export function mapLinkFailureReason(error: unknown): MapLinkFailureReason {
  return error instanceof MapLinkResolutionError ? error.reason : 'unreachable';
}

export interface MapLinkResolver {
  /** Rejects with `MapLinkResolutionError` when the link yields no coordinates. */
  resolve(url: string): Promise<MapLinkCoordinates>;
}
