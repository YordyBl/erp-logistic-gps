import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import type { RoutePosition } from '../application/ports/PositionProvider.js';
import { TrackingWebSocketHub } from '../infrastructure/TrackingWebSocketHub.js';
import { WebSocketTicketStore, type WebSocketIdentity } from '../infrastructure/WebSocketTicketStore.js';

interface TestSocket {
  once(event: 'open', listener: () => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'message', listener: (data: Buffer) => void): this;
  once(event: 'close', listener: () => void): this;
  on(event: 'message', listener: (data: Buffer) => void): this;
  close(): void;
}

interface TestSocketConstructor {
  new (url: string, options: { headers: Record<string, string> }): TestSocket;
}

const WebSocketClient = createRequire(import.meta.url)('ws') as TestSocketConstructor;
const origin = 'http://localhost:5173';

const firstIdentity: WebSocketIdentity = {
  id: 'a92a4997-812b-4539-99e6-6f8b0de81325',
  organizationId: '1ef02128-d9e3-41f4-86af-c2a29c08b87c',
  role: 'DISPATCHER',
};
const otherIdentity: WebSocketIdentity = {
  id: 'b92a4997-812b-4539-99e6-6f8b0de81325',
  organizationId: '2ef02128-d9e3-41f4-86af-c2a29c08b87c',
  role: 'DISPATCHER',
};

const driverIdentity: WebSocketIdentity = {
  id: 'c92a4997-812b-4539-99e6-6f8b0de81325',
  organizationId: firstIdentity.organizationId,
  role: 'DRIVER',
};

const openSockets: TestSocket[] = [];
afterEach(() => {
  for (const socket of openSockets.splice(0)) socket.close();
});

describe('TrackingWebSocketHub', () => {
  it('sends fresh snapshots and ordered tenant-scoped updates to ticket holders', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addresses = server.address() as AddressInfo;
    const snapshots: string[] = [];
    const hub = new TrackingWebSocketHub(server, {
      tickets: new WebSocketTicketStore(),
      resolveIdentity: async (identity) => identity,
      snapshot: async (identity) => {
        snapshots.push(identity.organizationId);
        return { payload: { organizationId: identity.organizationId, userId: identity.id }, routeIds: [] };
      },
    });

    try {
      const first = connect(hub, firstIdentity, addresses.port);
      const second = connect(hub, otherIdentity, addresses.port);
      const [firstSocket, secondSocket] = await Promise.all([first.opened, second.opened]);
      openSockets.push(firstSocket, secondSocket);
      const firstInitial = JSON.parse((await first.initial).toString());
      const secondInitial = JSON.parse((await second.initial).toString());
      expect(firstInitial).toMatchObject({
        type: 'snapshot',
        data: { organizationId: firstIdentity.organizationId, userId: firstIdentity.id },
      });
      expect(secondInitial).toMatchObject({
        type: 'snapshot',
        data: { organizationId: otherIdentity.organizationId, userId: otherIdentity.id },
      });

      const nextFirstMessage = message(firstSocket);
      await hub.publish(firstIdentity.organizationId, 'route');
      const update = JSON.parse((await nextFirstMessage).toString());

      expect(update).toMatchObject({
        type: 'update',
        sequence: 1,
        kind: 'route',
        snapshot: { organizationId: firstIdentity.organizationId },
      });
      expect(snapshots.filter((id) => id === firstIdentity.organizationId)).toHaveLength(2);
      expect(snapshots.filter((id) => id === otherIdentity.organizationId)).toHaveLength(1);
    } finally {
      await hub.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('loads one snapshot per organization for all of its dispatchers on each update', async () => {
    const { server, port } = await listen();
    const calls: WebSocketIdentity[] = [];
    const hub = new TrackingWebSocketHub(server, {
      tickets: new WebSocketTicketStore(),
      resolveIdentity: async (identity) => identity,
      snapshot: async (identity) => {
        calls.push(identity);
        return { payload: { organizationId: identity.organizationId }, routeIds: [] };
      },
    });

    try {
      const dispatchers = await Promise.all([0, 1, 2].map((index) => open(hub, {
        ...firstIdentity, id: `${index}2a4997-812b-4539-99e6-6f8b0de81325`,
      }, port)));
      const other = await open(hub, otherIdentity, port);
      expect(calls).toHaveLength(4);

      await hub.publish(firstIdentity.organizationId, 'order');
      await Promise.all(dispatchers.map((client) => client.waitFor(2)));

      expect(calls).toHaveLength(5);
      for (const client of dispatchers) {
        expect(client.messages[1]).toMatchObject({ type: 'update', kind: 'order',
          snapshot: { organizationId: firstIdentity.organizationId } });
      }
      expect(other.messages).toHaveLength(1);
    } finally {
      await hub.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('forwards positions without snapshots only to tenant clients that follow the route', async () => {
    const { server, port } = await listen();
    let calls = 0;
    const routeIdsByUser = new Map([
      [firstIdentity.id, ['route-1', 'route-2']],
      [driverIdentity.id, ['route-2']],
      [otherIdentity.id, ['route-1', 'route-9']],
    ]);
    const hub = new TrackingWebSocketHub(server, {
      tickets: new WebSocketTicketStore(),
      resolveIdentity: async (identity) => identity,
      snapshot: async (identity) => {
        calls += 1;
        return { payload: {}, routeIds: routeIdsByUser.get(identity.id) ?? [] };
      },
    });

    try {
      const dispatcher = await open(hub, firstIdentity, port);
      const driver = await open(hub, driverIdentity, port);
      const other = await open(hub, otherIdentity, port);
      expect(calls).toBe(3);

      hub.publishPosition(position(firstIdentity.organizationId, 'route-1'));
      hub.publishPosition(position(firstIdentity.organizationId, 'route-2'));
      hub.publishPosition(position(otherIdentity.organizationId, 'route-9'));
      await Promise.all([dispatcher.waitFor(3), driver.waitFor(2), other.waitFor(2)]);

      expect(calls).toBe(3);
      expect(dispatcher.messages.slice(1).map(routeOf)).toEqual(['route-1', 'route-2']);
      // The driver follows only route-2, and the other tenant never sees this tenant's route-1.
      expect(driver.messages.slice(1).map(routeOf)).toEqual(['route-2']);
      expect(other.messages.slice(1)).toEqual([expect.objectContaining({
        type: 'position',
        position: expect.objectContaining({ organizationId: otherIdentity.organizationId, routeId: 'route-9' }),
      })]);
      expect(dispatcher.messages[1]?.position).not.toHaveProperty('reachedStopCount');
    } finally {
      await hub.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('coalesces hints that arrive during a rebuild into one more rebuild', async () => {
    const { server, port } = await listen();
    let calls = 0;
    let release: (() => void) | undefined;
    let gate: Promise<void> | undefined;
    const hub = new TrackingWebSocketHub(server, {
      tickets: new WebSocketTicketStore(),
      resolveIdentity: async (identity) => identity,
      snapshot: async () => {
        calls += 1;
        await gate;
        return { payload: { calls }, routeIds: [] };
      },
    });

    try {
      const client = await open(hub, firstIdentity, port);
      gate = new Promise<void>((resolve) => { release = resolve; });
      const first = hub.publish(firstIdentity.organizationId, 'route');
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(calls).toBe(2);
      const burst = [
        hub.publish(firstIdentity.organizationId, 'order'),
        hub.publish(firstIdentity.organizationId, 'route'),
        hub.publish(firstIdentity.organizationId, 'order'),
        hub.publish(firstIdentity.organizationId, 'route'),
        hub.publish(firstIdentity.organizationId, 'order'),
      ];
      release?.();
      await Promise.all([first, ...burst]);
      await client.waitFor(3);

      // One initial snapshot, the running rebuild and a single rebuild for the whole burst.
      expect(calls).toBe(3);
      expect(client.messages.slice(1)).toEqual([
        expect.objectContaining({ type: 'update', kind: 'route' }),
        expect.objectContaining({ type: 'update', kind: 'order,route' }),
      ]);
    } finally {
      await hub.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('closes an established socket when the user is no longer active', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    let active = true;
    const hub = new TrackingWebSocketHub(server, {
      tickets: new WebSocketTicketStore(),
      identityRefreshMilliseconds: 10,
      resolveIdentity: async (identity) => active ? identity : null,
      snapshot: async () => ({ payload: { routes: [] }, routeIds: [] }),
    });

    try {
      const connection = connect(hub, firstIdentity, address.port);
      const socket = await connection.opened;
      openSockets.push(socket);
      await connection.initial;
      const closed = new Promise<void>((resolve) => socket.once('close', resolve));
      active = false;
      await closed;
    } finally {
      await hub.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

function connect(hub: TrackingWebSocketHub, identity: WebSocketIdentity, port: number) {
  const issued = hub.issueTicket(identity, origin);
  const socket = new WebSocketClient(
    `ws://127.0.0.1:${port}/api/v1/tracking/socket?ticket=${encodeURIComponent(issued.ticket)}`,
    { headers: { Origin: origin } },
  );
  const opened = new Promise<TestSocket>((resolve, reject) => {
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
  return { socket, opened, initial: message(socket) };
}

async function listen() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

interface ReceivedMessage {
  readonly type?: string;
  readonly kind?: string;
  readonly position?: { readonly routeId?: string };
  readonly [key: string]: unknown;
}

/** Connects and records every message; resolves once the initial snapshot has arrived. */
async function open(hub: TrackingWebSocketHub, identity: WebSocketIdentity, port: number) {
  const connection = connect(hub, identity, port);
  const socket = await connection.opened;
  openSockets.push(socket);
  const messages: ReceivedMessage[] = [JSON.parse((await connection.initial).toString()) as ReceivedMessage];
  const waiters: (() => void)[] = [];
  socket.on('message', (data) => {
    messages.push(JSON.parse(data.toString()) as ReceivedMessage);
    for (const wake of waiters.splice(0)) wake();
  });
  const waitFor = async (count: number): Promise<void> => {
    while (messages.length < count) await new Promise<void>((resolve) => waiters.push(resolve));
  };
  return { messages, waitFor };
}

function routeOf(received: ReceivedMessage): string | undefined {
  return received.position?.routeId;
}

function position(organizationId: string, routeId: string): RoutePosition {
  return {
    organizationId, routeId, driverId: 'driver-1', latitude: -12.05, longitude: -77.04,
    accuracyMeters: 5, speedMetersPerSecond: 8, source: 'simulated',
    recordedAt: '2026-11-15T15:00:00.000Z', receivedAt: '2026-11-15T15:00:00.000Z', reachedStopCount: 1,
  };
}

function message(socket: TestSocket): Promise<Buffer> {
  return new Promise((resolve) => socket.once('message', resolve));
}
