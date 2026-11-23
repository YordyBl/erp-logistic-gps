/**
 * Public tracking contract: the only data a recipient's link may reveal.
 * Built field by field on the server; never an internal DTO.
 */
export type PublicTrackingStatus = 'scheduled' | 'in_transit' | 'delivered' | 'failed';

/**
 * Where the driver is, from the recipient's point of view.
 * - `moving`: on the way; the position is shown.
 * - `at_other_stop`: handing over another order; the position is hidden.
 * - `stale`: no update for a while; shown as last known position.
 */
export type DriverPositionState = 'moving' | 'at_other_stop' | 'stale';

/** [longitude, latitude]. The server rounds the driver position before sending it. */
export type MapPoint = readonly [longitude: number, latitude: number];

export interface PublicTracking {
  readonly company: {
    readonly name: string;
    readonly initials: string;
    readonly color: string;
    /** Digits only with country code, or null when the company has not set one. */
    readonly whatsapp: string | null;
  };
  readonly sender: string;
  readonly publicCode: string;
  readonly status: PublicTrackingStatus;
  /** YYYY-MM-DD in Lima time. */
  readonly plannedDate: string;
  readonly timeWindow: 'AM' | 'PM';
  readonly deliveryAddress: string;
  /** The delivery address on the map (the recipient's own address). */
  readonly destination: MapPoint;
  readonly recipientName: string;
  readonly packages: string;
  readonly driver: { readonly firstName: string; readonly vehicle: 'moto' | 'camioneta'; readonly plate: string } | null;
  /** Present while the route is in progress. */
  readonly route: {
    readonly stopsBefore: number;
    readonly path: readonly MapPoint[];
    readonly driver: { readonly state: DriverPositionState; readonly at: MapPoint; readonly updatedAt: string };
  } | null;
  readonly delivery: { readonly deliveredAt: string; readonly receivedBy: string; readonly photoUrls: readonly string[] } | null;
  readonly failure: { readonly at: string; readonly reason: string } | null;
}
