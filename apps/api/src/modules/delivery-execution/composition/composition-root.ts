import type { DataSource } from 'typeorm';

import { SystemClock, type Clock } from '../../../shared/clock.js';
import type { DeliveryEvidenceStore } from '../application/ports/DeliveryEvidenceStore.js';
import type { EvidenceObjectStorage } from '../application/ports/EvidenceObjectStorage.js';
import {
  DownloadDeliveryEvidenceUseCase,
  ListDeliveryEvidenceUseCase,
  UploadDeliveryEvidenceUseCase,
} from '../application/use-cases/DeliveryEvidenceUseCases.js';

export interface DeliveryExecutionModuleOptions {
  readonly store: DeliveryEvidenceStore;
  readonly objectStorage: EvidenceObjectStorage;
  readonly clock?: Clock;
}

export function createDeliveryExecutionModule(options: DeliveryExecutionModuleOptions) {
  return {
    uploadEvidence: new UploadDeliveryEvidenceUseCase(
      options.store,
      options.objectStorage,
      options.clock ?? new SystemClock(),
    ),
    listEvidence: new ListDeliveryEvidenceUseCase(options.store),
    downloadEvidence: new DownloadDeliveryEvidenceUseCase(options.store, options.objectStorage),
  };
}

export type DeliveryExecutionModule = ReturnType<typeof createDeliveryExecutionModule>;

export async function createDeliveryExecutionModuleFromDataSource(
  dataSource: DataSource,
  objectStorage: EvidenceObjectStorage,
  options: Omit<DeliveryExecutionModuleOptions, 'store' | 'objectStorage'> = {},
): Promise<DeliveryExecutionModule> {
  const { DeliveryEvidenceTypeOrmStore } = await import(
    '../infrastructure/persistence/DeliveryEvidenceTypeOrmStore.js'
  );
  return createDeliveryExecutionModule({
    ...options,
    objectStorage,
    store: new DeliveryEvidenceTypeOrmStore(dataSource),
  });
}
