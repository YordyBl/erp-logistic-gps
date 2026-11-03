import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';

import type { WebSocketIdentity } from './WebSocketTicketStore.js';
import { WebSocketTicketStore } from './WebSocketTicketStore.js';

interface SocketClient {
  readonly socket: WebSocket;
  identity: WebSocketIdentity;
}

export interface TrackingWebSocketHubOptions {
  readonly tickets: WebSocketTicketStore;
  readonly resolveIdentity: (ticketIdentity: WebSocketIdentity) => Promise<WebSocketIdentity | null>;
  readonly snapshot: (identity: WebSocketIdentity) => Promise<unknown>;
  readonly identityRefreshMilliseconds?: number;
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
  private publication = Promise.resolve();
  private readonly identityTimer: NodeJS.Timeout;

  constructor(private readonly server: Server, private readonly options: TrackingWebSocketHubOptions) {
    this.server.on('upgrade', this.onUpgrade);
    this.identityTimer = setInterval(() => {
      this.enqueue(() => this.revalidateClients());
    }, options.identityRefreshMilliseconds ?? 30_000);
    this.identityTimer.unref();
    this.webSockets.on('connection', (socket, request, rawIdentity) => {
      const client = { socket, identity: rawIdentity as WebSocketIdentity };
      this.clients.add(client);
      socket.on('error', () => this.clients.delete(client));
      socket.on('close', () => this.clients.delete(client));
      socket.on('message', (data) => {
        if (data.toString() === '{"type":"snapshot"}') {
          this.enqueue(() => this.sendSnapshot(client));
        } else {
          socket.close(1008, 'Unsupported message');
        }
      });
      this.enqueue(() => this.sendSnapshot(client));
    });
  }

  issueTicket(identity: WebSocketIdentity, origin?: string): { ticket: string; expiresAt: string } {
    return this.options.tickets.issue(identity, origin);
  }

  /** Publish a tenant-scoped hint and a freshly authorized snapshot to each live subscriber. */
  publish(organizationId: string, kind: 'route' | 'order' | 'position'): Promise<void> {
    return this.enqueue(async () => {
      const sequence = ++this.sequence;
      const clients = [...this.clients].filter(
        ({ identity }) => identity.organizationId === organizationId,
      );
      await Promise.all(clients.map(async (client) => {
        if (client.socket.readyState !== WebSocket.OPEN) return;
        try {
          const snapshot = await this.options.snapshot(client.identity);
          client.socket.send(JSON.stringify({
            type: 'update',
            sequence,
            kind,
            snapshot,
          }));
        } catch {
          client.socket.close(1011, 'Unable to refresh tracking snapshot');
          this.clients.delete(client);
        }
      }));
    });
  }

  async close(): Promise<void> {
    clearInterval(this.identityTimer);
    this.server.off('upgrade', this.onUpgrade);
    for (const { socket } of this.clients) socket.close(1001, 'Server shutting down');
    this.clients.clear();
    await new Promise<void>((resolve) => this.webSockets.close(() => resolve()));
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.publication.then(operation);
    this.publication = next.catch(() => undefined);
    return next;
  }

  private async sendSnapshot(client: SocketClient): Promise<void> {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    try {
      const snapshot = await this.options.snapshot(client.identity);
      client.socket.send(JSON.stringify({ type: 'snapshot', sequence: this.sequence, data: snapshot }));
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
