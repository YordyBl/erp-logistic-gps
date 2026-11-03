import type { Clock } from '../../../shared/clock.js';
import type { PositionProvider, RoutePosition, RoutePositionContext } from './ports/PositionProvider.js';
import type { RoutePositionStore } from '../infrastructure/RoutePositionTypeOrmStore.js';

export interface RoutePositionSimulationConfig {
  readonly intervalMilliseconds: number;
  readonly retentionDays: number;
}

const DESTINATION_ARRIVAL_RADIUS_METERS = 50;

export class RoutePositionSimulator {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly store: RoutePositionStore,
    private readonly provider: PositionProvider,
    private readonly clock: Clock,
    private readonly config: RoutePositionSimulationConfig,
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly onPositionRecorded: (position: RoutePosition) => void | Promise<void> = () => undefined,
    private readonly onDestinationReached: (route: RoutePositionContext, position: RoutePosition) =>
      void | Promise<void> = () => undefined,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.runAndSchedule();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  private async runAndSchedule(): Promise<void> {
    if (!this.running) return;
    this.inFlight = this.tick();
    try {
      await this.inFlight;
    } catch (error) {
      this.onError(error);
    } finally {
      this.inFlight = undefined;
      if (this.running) {
        this.timer = setTimeout(() => void this.runAndSchedule(), this.config.intervalMilliseconds);
      }
    }
  }

  private async tick(): Promise<void> {
    const now = this.clock.now();
    const cutoff = new Date(Date.parse(now) - this.config.retentionDays * 24 * 60 * 60 * 1_000)
      .toISOString();
    await this.store.pruneReceivedBefore(cutoff);
    const routes = await this.store.findActiveRoutes();
    for (const route of routes) {
      try {
        const position: RoutePosition | null = await this.provider.sample(route, now);
        if (position !== null && await this.store.record(position)) {
          await this.onPositionRecorded(position);
          if (isSimulatedDeliveryArrival(route, position)) {
            await this.onDestinationReached(route, position);
          }
        }
      } catch (error) {
        this.onError(error);
      }
    }
  }
}

function isSimulatedDeliveryArrival(route: RoutePositionContext, position: RoutePosition): boolean {
  if (position.source !== 'simulated' || route.simulatedCompletionEnabled !== true ||
      route.driverUserId === undefined || route.stops.length !== 1) return false;
  const destination = route.stops[0];
  if (destination === undefined || destination.latitude === null || destination.longitude === null) return false;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(destination.latitude - position.latitude);
  const longitudeDelta = toRadians(destination.longitude - position.longitude);
  const startLatitude = toRadians(position.latitude);
  const endLatitude = toRadians(destination.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  const distanceMeters = 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, haversine)));
  return distanceMeters <= DESTINATION_ARRIVAL_RADIUS_METERS;
}
