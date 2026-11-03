import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { TrackingWebSocketHub } from '../infrastructure/TrackingWebSocketHub.js';
import { WebSocketTicketStore, type WebSocketIdentity } from '../infrastructure/WebSocketTicketStore.js';

interface TestSocket {
  once(event: 'open', listener: () => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'message', listener: (data: Buffer) => void): this;
  once(event: 'close', listener: () => void): this;
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
        return { organizationId: identity.organizationId, userId: identity.id };
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

  it('closes an established socket when the user is no longer active', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    let active = true;
    const hub = new TrackingWebSocketHub(server, {
      tickets: new WebSocketTicketStore(),
      identityRefreshMilliseconds: 10,
      resolveIdentity: async (identity) => active ? identity : null,
      snapshot: async () => ({ routes: [] }),
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

function message(socket: TestSocket): Promise<Buffer> {
  return new Promise((resolve) => socket.once('message', resolve));
}
