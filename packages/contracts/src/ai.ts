import { z } from 'zod';

/** What the classifier returns for one customer message (complexity drives priority; intent is stored). */
export const classificationSchema = z.object({
  complexity: z.enum(['simple', 'complex']),
  intent: z.enum(['question', 'booking', 'complaint', 'greeting', 'other']),
});
export type Classification = z.infer<typeof classificationSchema>;

/** Fallback when the classifier's output can't be read: still answered, at the lower priority. */
export const CLASSIFICATION_FALLBACK: Classification = { complexity: 'complex', intent: 'other' };

/** What the reply call returns. `answerable: false` means "not in the knowledge base". */
export const replySchema = z.object({
  answerable: z.boolean(),
  reply: z.string(),
});
export type AiReply = z.infer<typeof replySchema>;
