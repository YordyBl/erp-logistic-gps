import type { S3EvidenceObjectStorageConfig } from '../modules/delivery-execution/infrastructure/S3EvidenceObjectStorage.js';

export function loadEvidenceStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): S3EvidenceObjectStorageConfig {
  const endpoint = required(env.EVIDENCE_S3_ENDPOINT, 'EVIDENCE_S3_ENDPOINT');
  const bucket = required(env.EVIDENCE_S3_BUCKET, 'EVIDENCE_S3_BUCKET');
  const accessKey = required(env.EVIDENCE_S3_ACCESS_KEY, 'EVIDENCE_S3_ACCESS_KEY');
  const secretKey = required(env.EVIDENCE_S3_SECRET_KEY, 'EVIDENCE_S3_SECRET_KEY');
  const region = required(env.EVIDENCE_S3_REGION, 'EVIDENCE_S3_REGION');
  const parsed = new URL(endpoint);

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username !== '' ||
      parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error('EVIDENCE_S3_ENDPOINT must be an HTTP(S) URL without credentials, query or fragment');
  }
  if (env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('EVIDENCE_S3_ENDPOINT must use HTTPS in production');
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error('EVIDENCE_S3_BUCKET must be a valid S3 bucket name');
  }

  return { endpoint, bucket, accessKey, secretKey, region };
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}
