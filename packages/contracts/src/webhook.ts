import { z } from 'zod';

/**
 * Body of `POST /webhook/:tenantId/message`. Caps match the database columns (external_id 200, external_ref 320).
 * Unknown keys are stripped, so a `tenantId` in the body is never read.
 */
export const inboundMessageSchema = z.object({
  /** The channel's message ID. Deduplicated per tenant. */
  externalId: z.string().trim().min(1).max(200),
  /** The sender's address on the channel. Contact data: never logged. */
  from: z.string().trim().min(1).max(320),
  /** Message text. Never logged. */
  text: z
    .string()
    .max(4000)
    .refine((s) => s.trim().length > 0, 'must not be blank'),
});

export type InboundMessage = z.infer<typeof inboundMessageSchema>;

export interface InboundMessageAccepted {
  messageId: string;
  conversationId: string;
}
