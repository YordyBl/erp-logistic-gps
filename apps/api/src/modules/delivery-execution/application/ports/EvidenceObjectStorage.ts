import type { EvidenceMimeType } from './DeliveryEvidenceStore.js';

export interface EvidenceObjectStorage {
  put(key: string, bytes: Buffer, mimeType: EvidenceMimeType): Promise<void>;
  get(key: string): Promise<Buffer>;
}
