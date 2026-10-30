import { describe, expect, it } from 'vitest';

import { loadEvidenceStorageConfig } from './evidence-storage-config.js';

const validEnv = {
  EVIDENCE_S3_ENDPOINT: 'http://localhost:9000',
  EVIDENCE_S3_BUCKET: 'delivery-evidence',
  EVIDENCE_S3_ACCESS_KEY: 'local-access',
  EVIDENCE_S3_SECRET_KEY: 'local-secret',
  EVIDENCE_S3_REGION: 'us-east-1',
};

describe('loadEvidenceStorageConfig', () => {
  it('requires complete endpoint, bucket and credentials', () => {
    expect(() => loadEvidenceStorageConfig({})).toThrow('EVIDENCE_S3_ENDPOINT is required');
    expect(loadEvidenceStorageConfig(validEnv)).toMatchObject({
      endpoint: 'http://localhost:9000', bucket: 'delivery-evidence', region: 'us-east-1',
    });
  });

  it('rejects endpoints with embedded credentials or a query', () => {
    expect(() => loadEvidenceStorageConfig({ ...validEnv,
      EVIDENCE_S3_ENDPOINT: 'http://user:pass@localhost:9000' })).toThrow();
    expect(() => loadEvidenceStorageConfig({ ...validEnv,
      EVIDENCE_S3_ENDPOINT: 'http://localhost:9000?public=true' })).toThrow();
  });

  it('requires HTTPS in production', () => {
    expect(() => loadEvidenceStorageConfig({ ...validEnv, NODE_ENV: 'production' })).toThrow('HTTPS');
    expect(loadEvidenceStorageConfig({ ...validEnv, NODE_ENV: 'production',
      EVIDENCE_S3_ENDPOINT: 'https://objects.example.test' }).endpoint)
      .toBe('https://objects.example.test');
  });

  it('rejects invalid bucket names', () => {
    expect(() => loadEvidenceStorageConfig({ ...validEnv, EVIDENCE_S3_BUCKET: 'Bad_Bucket' }))
      .toThrow();
  });
});
