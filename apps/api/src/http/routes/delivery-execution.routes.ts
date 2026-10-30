import { Router, raw, type RequestHandler } from 'express';
import { z } from 'zod';

import type { DeliveryExecutionModule } from '../../modules/delivery-execution/composition/composition-root.js';
import { DeliveryEvidenceValidationError } from '../../modules/delivery-execution/domain/errors/DeliveryExecutionError.js';
import { MAX_EVIDENCE_IMAGE_BYTES } from '../../modules/delivery-execution/domain/EvidenceImage.js';
import { requireRole } from '../middleware/require-role.js';
import { getAuthenticatedUser } from '../request-context.js';
import { requireOrganizationId } from '../middleware/organization-resolver.js';

const evidenceParamsSchema = z.strictObject({ orderId: z.uuid() });
const downloadParamsSchema = z.strictObject({ evidenceId: z.uuid() });
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function createDeliveryExecutionRouter(
  module: DeliveryExecutionModule,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.use(authenticate);

  router.post(
    '/delivery-orders/:orderId/evidence',
    requireRole('DRIVER'),
    raw({ type: [...ALLOWED_MIME_TYPES], limit: MAX_EVIDENCE_IMAGE_BYTES }),
    async (request, response) => {
      const params = evidenceParamsSchema.safeParse(request.params);
      if (!params.success || !Buffer.isBuffer(request.body)) {
        throw new DeliveryEvidenceValidationError('Upload delivery evidence request is invalid');
      }
      const actor = getAuthenticatedUser(response);
      if (actor === undefined) throw new DeliveryEvidenceValidationError('Authenticated actor is missing');
      const idempotencyKey = request.header('Idempotency-Key');
      if (idempotencyKey === undefined) {
        throw new DeliveryEvidenceValidationError('Idempotency-Key header is required');
      }
      const result = await module.uploadEvidence.execute({
        organizationId: requireOrganizationId(response),
        orderId: params.data.orderId,
        actorUserId: actor.id,
        idempotencyKey,
        declaredMimeType: request.header('Content-Type') ?? '',
        bytes: request.body,
      });
      response.status(201).json({ data: result.evidence });
    },
  );

  router.get('/delivery-orders/:orderId/evidence', requireRole('ADMIN', 'DISPATCHER', 'DRIVER'),
    async (request, response) => {
      const params = evidenceParamsSchema.safeParse(request.params);
      if (!params.success) throw new DeliveryEvidenceValidationError('Evidence query is invalid');
      const actor = getAuthenticatedUser(response);
      if (actor === undefined) throw new DeliveryEvidenceValidationError('Authenticated actor is missing');
      const result = await module.listEvidence.execute({
        organizationId: requireOrganizationId(response),
        orderId: params.data.orderId,
        actorUserId: actor.id,
      });
      response.status(200).json({ data: result.evidence });
    });

  router.get('/evidence/:evidenceId/download', requireRole('ADMIN', 'DISPATCHER', 'DRIVER'),
    async (request, response) => {
      const params = downloadParamsSchema.safeParse(request.params);
      if (!params.success) throw new DeliveryEvidenceValidationError('Evidence query is invalid');
      const actor = getAuthenticatedUser(response);
      if (actor === undefined) throw new DeliveryEvidenceValidationError('Authenticated actor is missing');
      const result = await module.downloadEvidence.execute({
        organizationId: requireOrganizationId(response),
        evidenceId: params.data.evidenceId,
        actorUserId: actor.id,
      });
      response.status(200)
        .set('Cache-Control', 'private, no-store')
        .set('X-Content-Type-Options', 'nosniff')
        .set('Content-Disposition', `attachment; filename="evidence-${result.evidence.id}"`)
        .type(result.evidence.mimeType)
        .send(result.bytes);
    });

  return router;
}
