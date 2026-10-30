import { createHash, createHmac } from 'node:crypto';

export interface S3EvidenceObjectStorageConfig {
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly region: string;
}

type Fetcher = (input: URL | string, init?: RequestInit) => Promise<Response>;

/** Private path-style S3-compatible storage adapter; evidence is never made public. */
export class S3EvidenceObjectStorage {
  private bucketReady: Promise<void> | undefined;

  constructor(
    private readonly config: S3EvidenceObjectStorageConfig,
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    const endpoint = new URL(config.endpoint);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username !== '' ||
        endpoint.password !== '' || endpoint.search !== '' || endpoint.hash !== '') {
      throw new Error('Evidence storage endpoint must be an HTTP(S) origin without credentials or query');
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) ||
        config.accessKey.trim() === '' || config.secretKey.trim() === '' || config.region.trim() === '') {
      throw new Error('Evidence storage configuration is invalid');
    }
  }

  async put(key: string, bytes: Buffer, mimeType: string): Promise<void> {
    validateObjectKey(key);
    if (bytes.length < 1 || bytes.length > 5_000_000 ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      throw new Error('Evidence object metadata is invalid');
    }
    await this.ensureBucket();
    const response = await this.request('PUT', key, bytes, mimeType);
    if (!response.ok) throw storageError('Evidence object upload failed', response.status);
  }

  async get(key: string): Promise<Buffer> {
    validateObjectKey(key);
    await this.ensureBucket();
    const response = await this.request('GET', key);
    if (!response.ok) throw storageError('Evidence object read failed', response.status);
    return readBounded(response, 5_000_000);
  }

  private ensureBucket(): Promise<void> {
    if (this.bucketReady === undefined) {
      this.bucketReady = this.request('PUT').then(async (response) => {
        if (!response.ok && response.status !== 409) {
          throw storageError('Evidence bucket initialization failed', response.status);
        }
      }).catch((error: unknown) => {
        this.bucketReady = undefined;
        throw error;
      });
    }
    return this.bucketReady;
  }

  private async request(
    method: 'GET' | 'PUT',
    key?: string,
    body?: Buffer,
    mimeType?: string,
  ): Promise<Response> {
    const endpoint = new URL(this.config.endpoint);
    const basePath = endpoint.pathname.replace(/\/$/, '');
    const encodedKey = key === undefined ? '' : `/${key.split('/').map(encodeRfc3986).join('/')}`;
    const path = `${basePath}/${encodeRfc3986(this.config.bucket)}${encodedKey}`;
    const url = new URL(endpoint.origin);
    url.pathname = path;

    const payloadHash = sha256(body ?? Buffer.alloc(0));
    const timestamp = this.now().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = timestamp.slice(0, 8);
    const headers = new Headers({
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': timestamp,
    });
    if (mimeType !== undefined) headers.set('content-type', mimeType);

    const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${timestamp}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${date}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256', timestamp, scope, sha256(Buffer.from(canonicalRequest)),
    ].join('\n');
    const signingKey = hmac(
      hmac(hmac(hmac(Buffer.from(`AWS4${this.config.secretKey}`), date), this.config.region), 's3'),
      'aws4_request',
    );
    const signature = hmac(signingKey, stringToSign).toString('hex');
    headers.set('authorization',
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`);

    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(10_000) };
    if (body !== undefined) init.body = new Uint8Array(body);
    return this.fetcher(url, init);
  }
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function storageError(message: string, status: number): Error {
  return new Error(`${message} (storage status ${status})`);
}

function validateObjectKey(key: string): void {
  const segments = key.split('/');
  if (key.length === 0 || key.length > 512 || segments.some((segment) =>
    segment === '' || segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error('Evidence object key is invalid');
  }
}

async function readBounded(response: Response, maximumBytes: number): Promise<Buffer> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > maximumBytes) {
    await response.body?.cancel();
    throw new Error('Evidence object exceeds its persisted size limit');
  }
  if (response.body === null) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.length;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error('Evidence object exceeds its persisted size limit');
      }
      chunks.push(Buffer.from(part.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}
