import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import type {
  OperationsReport,
  OperationsReportRequest,
} from '../../infrastructure/dispatch/OperationsReportTypeOrmQuery.js';
import { HttpError } from '../errors.js';
import { requireOrganizationId } from '../middleware/organization-resolver.js';
import { requireRole } from '../middleware/require-role.js';

export interface OperationsReportQuery {
  getReport(organizationId: string, request: OperationsReportRequest): Promise<OperationsReport>;
}

/** The longest period one report may cover (a leap year). */
export const MAX_REPORT_DAYS = 366;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value),
    'must be a calendar day');

const reportQuerySchema = z.strictObject({
  from: isoDay,
  to: isoDay,
  compareFrom: isoDay.optional(),
  compareTo: isoDay.optional(),
  includeSimulated: z.enum(['true', 'false']).optional(),
}).superRefine((query, context) => {
  const check = (from: string, to: string, path: string) => {
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    if (days < 0) context.addIssue({ code: 'custom', path: [path], message: 'the period ends before it starts' });
    else if (days + 1 > MAX_REPORT_DAYS) context.addIssue({ code: 'custom', path: [path], message: `the period may cover at most ${MAX_REPORT_DAYS} days` });
  };
  check(query.from, query.to, 'to');
  if ((query.compareFrom === undefined) !== (query.compareTo === undefined)) {
    context.addIssue({ code: 'custom', path: ['compareTo'], message: 'compareFrom and compareTo go together' });
  } else if (query.compareFrom !== undefined && query.compareTo !== undefined) {
    check(query.compareFrom, query.compareTo, 'compareTo');
  }
});

/**
 * `GET /reports/operations`: period KPIs, comparison, weekly series, incidents
 * and breakdowns by district and driver. Days are Lima calendar days.
 */
export function createReportsRouter(query: OperationsReportQuery, authenticate: RequestHandler): Router {
  const router = Router();

  router.get('/operations', authenticate, requireRole('ADMIN', 'DISPATCHER'), async (request, response) => {
    const parsed = reportQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new HttpError(400, 'REPORT_INVALID_QUERY', 'Report query is invalid', {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })),
      });
    }
    const { from, to, compareFrom, compareTo, includeSimulated } = parsed.data;

    const report = await query.getReport(requireOrganizationId(response), {
      period: { from, to },
      comparison: compareFrom === undefined || compareTo === undefined ? null : { from: compareFrom, to: compareTo },
      includeSimulated: includeSimulated === 'true',
    });
    response.set('Cache-Control', 'private, no-store').json({ data: report });
  });

  return router;
}
