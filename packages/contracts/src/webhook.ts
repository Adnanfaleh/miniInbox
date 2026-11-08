import { z } from 'zod';

/**
 * A sender is a phone number in international form: `+` then 8 to 15 digits, nothing else (no spaces, dashes,
 * brackets or emails). One fixed form means the same person always maps to the same customer record in a tenant.
 * Customers stored earlier with another form (seeded emails) stay as history; they can't send new messages.
 */
export const SENDER_PATTERN = /^\+[0-9]{8,15}$/;
export const senderSchema = z.string().regex(SENDER_PATTERN, 'must be + followed by 8 to 15 digits, with no spaces');

/**
 * Body of `POST /webhook/:tenantId/message`. Caps match the database columns (external_id 200).
 * Unknown keys are stripped, so a `tenantId` in the body is never read.
 */
export const inboundMessageSchema = z.object({
  /** The channel's message ID. Deduplicated per tenant. */
  externalId: z.string().trim().min(1).max(200),
  /** The sender's phone number. Contact data: never logged. */
  from: senderSchema,
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
