import { inboundMessageJobSchema, type InboundMessageJob } from '@mini-inbox/contracts';
import { UnrecoverableError } from 'bullmq';

/**
 * Validates a job payload. A malformed payload (missing tenantId, extra fields such as message text) fails
 * immediately without retries: retrying can't fix it, and processing it without a tenant is worse than failing.
 */
export function parseJobPayload(data: unknown): InboundMessageJob {
  const parsed = inboundMessageJobSchema.safeParse(data);
  if (!parsed.success) throw new UnrecoverableError('invalid job payload');
  return parsed.data;
}

export const CLS_TENANT_ID = 'tenantId';
export const CLS_JOB_ID = 'jobId';
