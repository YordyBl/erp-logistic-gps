import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';

import { S3EvidenceObjectStorage } from '../infrastructure/S3EvidenceObjectStorage.js';

const storageConfig = {
  endpoint: 'http://minio.test:9000',
  bucket: 'delivery-evidence',
  accessKey: 'local-access-key',
  secretKey: 'local-secret-key',
  region: 'us-east-1',
};

describe('S3EvidenceObjectStorage', () => {
  it('creates a private object with a SigV4 request and reads it back', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response('image-bytes', { status: 200 }));
    const storage = new S3EvidenceObjectStorage(storageConfig, fetcher, () => new Date('2026-10-29T12:00:00.000Z'));

    await storage.put('tenant/order/evidence.bin', Buffer.from('image-bytes'), 'image/jpeg');
    const result = await storage.get('tenant/order/evidence.bin');

    expect(result.toString()).toBe('image-bytes');
    const putRequest = fetcher.mock.calls[1]![1] as RequestInit;
    const headers = new Headers(putRequest.headers);
    expect(headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=local-access-key\//);
    expect(headers.get('x-amz-content-sha256')).toMatch(/^[a-f0-9]{64}$/);
    expect(headers.get('x-amz-acl')).toBeNull();
    expect(putRequest.method).toBe('PUT');
  });

  it('does not delete persisted evidence when the object write fails', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    const storage = new S3EvidenceObjectStorage(storageConfig, fetcher);

    await expect(storage.put('tenant/order/evidence.bin', Buffer.from('image'), 'image/jpeg'))
      .rejects.toThrow();
    expect(fetcher.mock.calls.map(([url, init]) => [String(url), (init as RequestInit).method]))
      .toEqual([
        ['http://minio.test:9000/delivery-evidence', 'PUT'],
        ['http://minio.test:9000/delivery-evidence/tenant/order/evidence.bin', 'PUT'],
      ]);
  });

  it('round-trips through a local S3-compatible HTTP endpoint using signed requests', async () => {
    let object: Buffer | undefined;
    let observedHeaders: Record<string, string | string[] | undefined> = {};
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        if (request.url === '/delivery-evidence' && request.method === 'PUT') {
          response.writeHead(200).end();
          return;
        }
        if (request.url === '/delivery-evidence/round-trip/photo' && request.method === 'PUT') {
          observedHeaders = request.headers;
          object = Buffer.concat(chunks);
          response.writeHead(200).end();
          return;
        }
        if (request.url === '/delivery-evidence/round-trip/photo' && request.method === 'GET') {
          response.writeHead(200).end(object ?? Buffer.alloc(0));
          return;
        }
        response.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Local test server did not bind');

    try {
      const storage = new S3EvidenceObjectStorage({
        ...storageConfig,
        endpoint: `http://127.0.0.1:${address.port}`,
      });
      const input = Buffer.from('real HTTP bytes');
      await storage.put('round-trip/photo', input, 'image/jpeg');
      await expect(storage.get('round-trip/photo')).resolves.toEqual(input);
      expect(observedHeaders.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
      expect(observedHeaders['x-amz-content-sha256']).toMatch(/^[a-f0-9]{64}$/);
      expect(observedHeaders['x-amz-acl']).toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error === undefined) resolve(); else reject(error);
      }));
    }
  });
});
