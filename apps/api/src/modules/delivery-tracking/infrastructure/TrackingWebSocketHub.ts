import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';

import type { RoutePosition } from '../application/ports/PositionProvider.js';
import type { WebSocketIdentity } from './WebSocketTicketStore.js';
import { WebSocketTicketStore } from './WebSocketTicketStore.js';

export type TrackingUpdateKind = 'route' | 'order';

/** What a client is allowed to see, plus the routes whose live positions it follows. */
export interface TrackingHubSnapshot {
  readonly payload: unknown;
  readonly routeIds: readonly string[];
}

interface SocketClient {
  readonly socket: WebSocket;
  identity: WebSocketIdentity;
  /** Routes of the last snapshot sent to this client; position deltas are filtered by them. */
  routeIds: ReadonlySet<string>;
}

/** A rebuild that is queued for an organization but has not started yet. */
interface QueuedRebuild {
  readonly kinds: Set<TrackingUpdateKind>;
  readonly done: Promise<void>;
}

interface OrganizationQueue {
  tail: Promise<void>;
  queued: QueuedRebuild | null;
  pending: number;
}

export interface TrackingWebSocketHubOptions {
  readonly tickets: WebSocketTicketStore;
  readonly resolveIdentity: (ticketIdentity: WebSocketIdentity) => Promise<WebSocketIdentity | null>;
  readonly snapshot: (identity: WebSocketIdentity) => Promise<TrackingHubSnapshot>;
  /**
   * Identities with the same key see the same snapshot, so one rebuild loads it
   * once for all of them. Defaults to the organization for back-office users and
   * the user for drivers, who only see their own route.
   */
  readonly snapshotKey?: (identity: WebSocketIdentity) => string;
  readonly identityRefreshMilliseconds?: number;
}

export function defaultSnapshotKey(identity: WebSocketIdentity): string {
  return identity.role === 'DRIVER' ? `user:${identity.id}` : `org:${identity.organizationId}`;
}

/** Authenticated ephemeral update channel. Reconnects always receive a fresh snapshot. */
export class TrackingWebSocketHub {
  private readonly webSockets = new WebSocketServer({
    noServer: true,
    maxPayload: 1_024,
    perMessageDeflate: false,
  });
  private readonly clients = new Set<SocketClient>();
  private readonly onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    void this.handleUpgrade(request, socket, head).catch(() => socket.destroy());
  };
  private sequence = 0;
  private revalidation = Promise.resolve();
  private readonly organizations = new Map<string, OrganizationQueue>();
  private readonly identityTimer: NodeJS.Timeout;

  constructor(private readonly server: Server, private readonly options: TrackingWebSocketHubOptions) {
    this.server.on('upgrade', this.onUpgrade);
    this.identityTimer = setInterval(() => {
      this.revalidation = this.revalidation.then(() => this.revalidateClients()).catch(() => undefined);
    }, options.identityRefreshMilliseconds ?? 30_000);
    this.identityTimer.unref();
    this.webSockets.on('connection', (socket, request, rawIdentity) => {
      const client: SocketClient = { socket, identity: rawIdentity as WebSocketIdentity, routeIds: new Set() };
      this.clients.add(client);
      socket.on('error', () => this.clients.delete(client));
      socket.on('close', () => this.clients.delete(client));
      socket.on('message', (data) => {
        if (data.toString() === '{"type":"snapshot"}') {
          void this.enqueue(client.identity.organizationId, () => this.sendSnapshot(client));
        } else {
          socket.close(1008, 'Unsupported message');
        }
      });
      void this.enqueue(client.identity.organizationId, () => this.sendSnapshot(client));
    });
  }

  issueTicket(identity: WebSocketIdentity, origin?: string): { ticket: string; expiresAt: string } {
    return this.options.tickets.issue(identity, origin);
  }

  /**
   * Publish a tenant-scoped hint and a freshly authorized snapshot to each live
   * subscriber. Hints that arrive while a rebuild for the organization is already
   * waiting join it, so a burst costs at most the running rebuild plus one more.
   */
  publish(organizationId: string, kind: TrackingUpdateKind): Promise<void> {
    const queue = this.queueFor(organizationId);
    if (queue.queued !== null) {
      queue.queued.kinds.add(kind);
      return queue.queued.done;
    }
    const kinds = new Set<TrackingUpdateKind>([kind]);
    const done = this.enqueue(organizationId, () => {
      // From here on, new hints need another rebuild: this one may already miss them.
      if (queue.queued?.kinds === kinds) queue.queued = null;
      return this.rebuild(organizationId, kinds);
    });
    queue.queued = { kinds, done };
    return done;
  }

  /** Forward one position to the tenant's clients that follow its route. Never queries. */
  publishPosition(position: RoutePosition): void {
    // The same fields the snapshot carries: simulation progress stays on the server.
    const visible = { ...position };
    delete visible.reachedStopCount;
    let message: string | undefined;
    for (const client of this.clients) {
      if (client.identity.organizationId !== position.organizationId ||
          !client.routeIds.has(position.routeId) ||
          client.socket.readyState !== WebSocket.OPEN) continue;
      message ??= JSON.stringify({ type: 'position', sequence: ++this.sequence, position: visible });
      client.socket.send(message);
    }
  }

  async close(): Promise<void> {
    clearInterval(this.identityTimer);
    this.server.off('upgrade', this.onUpgrade);
    for (const { socket } of this.clients) socket.close(1001, 'Server shutting down');
    this.clients.clear();
    await new Promise<void>((resolve) => this.webSockets.close(() => resolve()));
  }

  private queueFor(organizationId: string): OrganizationQueue {
    let queue = this.organizations.get(organizationId);
    if (queue === undefined) {
      queue = { tail: Promise.resolve(), queued: null, pending: 0 };
      this.organizations.set(organizationId, queue);
    }
    return queue;
  }

  /** Operations of one organization run in order; organizations do not wait for each other. */
  private enqueue(organizationId: string, operation: () => Promise<void>): Promise<void> {
    const queue = this.queueFor(organizationId);
    queue.pending += 1;
    const next = queue.tail.then(operation);
    queue.tail = next.catch(() => undefined).finally(() => {
      queue.pending -= 1;
      if (queue.pending === 0 && this.organizations.get(organizationId) === queue) {
        this.organizations.delete(organizationId);
      }
    });
    return next;
  }

  private async rebuild(organizationId: string, kinds: ReadonlySet<TrackingUpdateKind>): Promise<void> {
    const sequence = ++this.sequence;
    const kind = [...kinds].sort().join(',');
    const keyOf = this.options.snapshotKey ?? defaultSnapshotKey;
    const snapshots = new Map<string, Promise<TrackingHubSnapshot>>();
    const clients = [...this.clients].filter(
      ({ identity }) => identity.organizationId === organizationId,
    );
    await Promise.all(clients.map(async (client) => {
      if (client.socket.readyState !== WebSocket.OPEN) return;
      const key = keyOf(client.identity);
      let snapshot = snapshots.get(key);
      if (snapshot === undefined) {
        snapshot = this.options.snapshot(client.identity);
        snapshots.set(key, snapshot);
      }
      try {
        const { payload, routeIds } = await snapshot;
        client.routeIds = new Set(routeIds);
        client.socket.send(JSON.stringify({ type: 'update', sequence, kind, snapshot: payload }));
      } catch {
        client.socket.close(1011, 'Unable to refresh tracking snapshot');
        this.clients.delete(client);
      }
    }));
  }

  private async sendSnapshot(client: SocketClient): Promise<void> {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    try {
      const { payload, routeIds } = await this.options.snapshot(client.identity);
      client.routeIds = new Set(routeIds);
      client.socket.send(JSON.stringify({ type: 'snapshot', sequence: this.sequence, data: payload }));
    } catch {
      client.socket.close(1011, 'Unable to load tracking snapshot');
      this.clients.delete(client);
    }
  }

  private async revalidateClients(): Promise<void> {
    await Promise.all([...this.clients].map(async (client) => {
      const identity = await this.options.resolveIdentity(client.identity).catch(() => null);
      if (identity === null) {
        client.socket.close(1008, 'Authentication is no longer valid');
        this.clients.delete(client);
      } else {
        client.identity = identity;
      }
    }));
  }

  private async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const onSocketError = (): void => { socket.destroy(); };
    socket.on('error', onSocketError);
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/v1/tracking/socket') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const ticket = url.searchParams.get('ticket');
    const identity = ticket === null
      ? null
      : this.options.tickets.consume(ticket, request.headers.origin);
    const currentIdentity = identity === null
      ? null
      : await this.options.resolveIdentity(identity).catch(() => null);
    if (currentIdentity === null || socket.destroyed) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    socket.removeListener('error', onSocketError);
    this.webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      this.webSockets.emit('connection', webSocket, request, currentIdentity);
    });
  }
}
