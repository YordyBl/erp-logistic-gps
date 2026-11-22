import type { Clock } from '../../../shared/clock.js';
import type { PositionProvider, RoutePosition, RoutePositionContext } from './ports/PositionProvider.js';
import type { RoutePositionStore } from '../infrastructure/RoutePositionTypeOrmStore.js';

export interface RoutePositionSimulationConfig {
  readonly intervalMilliseconds: number;
  readonly retentionDays: number;
  /** False outside an explicit development environment: history is still pruned, nothing is simulated. */
  readonly samplingEnabled: boolean;
}

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
    private readonly onSimulatedStopsReached: (route: RoutePositionContext, position: RoutePosition) =>
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
    if (!this.config.samplingEnabled) return;
    const routes = await this.store.findActiveRoutes();
    for (const route of routes) {
      try {
        const position: RoutePosition | null = await this.provider.sample(route, now);
        if (position !== null && await this.store.record(position)) {
          await this.onPositionRecorded(position);
          if (hasReachedSimulatedStops(route, position)) {
            await this.onSimulatedStopsReached(route, position);
          }
        }
      } catch (error) {
        this.onError(error);
      }
    }
  }
}

/** Only recorded simulated samples of opted-in, dispatcher-owned simulations close stops. */
function hasReachedSimulatedStops(route: RoutePositionContext, position: RoutePosition): boolean {
  return position.source === 'simulated' && route.simulatedCompletionEnabled === true &&
    route.simulationActorUserId !== undefined && (position.reachedStopCount ?? 0) > 0;
}
