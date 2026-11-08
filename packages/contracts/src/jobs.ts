import { z } from 'zod';

/** FIFO queue for inbound customer messages. Produced by the webhook, consumed by the worker (Phase 5). */
export const INBOUND_MESSAGE_QUEUE = 'inbound-message';
export const INBOUND_MESSAGE_JOB = 'inbound-message';

/** IDs only: no message text or contact data in Redis. The worker reloads everything, scoped by tenant. */
export const inboundMessageJobSchema = z.strictObject({
  tenantId: z.uuid(),
  conversationId: z.uuid(),
  messageId: z.uuid(),
});

export type InboundMessageJob = z.infer<typeof inboundMessageJobSchema>;

/**
 * Job ID includes the tenant so deduplication is per tenant. BullMQ rejects `:` in custom IDs, hence the dot.
 * Re-adding the same ID while the job still exists is a no-op.
 */
export function inboundMessageJobId(tenantId: string, messageId: string): string {
  return `${tenantId}.${messageId}`;
}

/** Priority queue for AI replies (stage 2). Fed by the inbound-message worker after classification. */
export const AI_REPLY_QUEUE = 'ai-reply';
export const AI_REPLY_JOB = 'ai-reply';

/** Same shape as the inbound job: IDs only. */
export const aiReplyJobSchema = inboundMessageJobSchema;
export type AiReplyJob = InboundMessageJob;

/** BullMQ priority: lower number runs first. Simple messages (and out-of-hours notices) go first. */
export const REPLY_PRIORITY = { simple: 1, complex: 2 } as const;

export const aiReplyJobId = inboundMessageJobId;
