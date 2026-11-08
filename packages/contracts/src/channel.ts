import { z } from 'zod';
import type { ConversationMode, SenderTypeDto } from './conversations.js';
import { senderSchema } from './webhook.js';

/**
 * DEV STAND-IN for a messaging channel delivering replies back to the customer:
 * `GET /dev/channel/:tenantId/messages?from=<phone>`. `from` follows the webhook's sender rule.
 */
export const channelThreadQuerySchema = z.object({ from: senderSchema });
export type ChannelThreadQuery = z.infer<typeof channelThreadQuerySchema>;

/** What the customer sees: who wrote each message and its text. No internal fields (status, classification, IDs of other records). */
export interface ChannelMessage {
  id: string;
  senderType: SenderTypeDto;
  body: string;
  createdAt: string;
}

export interface ChannelThreadResponse {
  /** null when this address has not written to this tenant yet. */
  mode: ConversationMode | null;
  messages: ChannelMessage[];
}

/** Last N messages shown to the customer. */
export const CHANNEL_THREAD_LIMIT = 100;
