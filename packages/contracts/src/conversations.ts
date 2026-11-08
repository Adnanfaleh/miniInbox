import { z } from 'zod';

/** Body of `POST /conversations/:id/reply` (staff manual reply). */
export const manualReplySchema = z.object({
  text: z
    .string()
    .max(4000)
    .refine((s) => s.trim().length > 0, 'must not be blank'),
});
export type ManualReply = z.infer<typeof manualReplySchema>;

export type ConversationMode = 'AI' | 'HUMAN';

/** Response of takeover and return-to-AI. */
export interface ConversationModeState {
  conversationId: string;
  mode: ConversationMode;
  modeChangedAt: string | null;
}

export interface ManualReplyCreated {
  messageId: string;
}

/** `GET /conversations` query. */
export const conversationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
});
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

/** `GET /conversations/:id` query. */
export const conversationDetailQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.uuid().optional(),
});
export type ConversationDetailQuery = z.infer<typeof conversationDetailQuerySchema>;

export type SenderTypeDto = 'CUSTOMER' | 'AI' | 'HUMAN' | 'SYSTEM';

export interface ConversationListItem {
  id: string;
  mode: ConversationMode;
  modeChangedAt: string | null;
  createdAt: string;
  customer: { id: string; label: string };
  lastMessage: { senderType: SenderTypeDto; preview: string; createdAt: string } | null;
}

export interface ConversationListResponse {
  items: ConversationListItem[];
  nextCursor: string | null;
}

export interface MessageDto {
  id: string;
  senderType: SenderTypeDto;
  body: string;
  createdAt: string;
  inReplyToMessageId: string | null;
  /** Customer messages only. */
  replyStatus: 'PENDING' | 'REPLIED' | 'SKIPPED' | 'FAILED' | null;
  complexity: 'simple' | 'complex' | null;
  intent: 'question' | 'booking' | 'complaint' | 'greeting' | 'other' | null;
}

export interface ConversationDetailResponse {
  conversation: Omit<ConversationListItem, 'lastMessage'>;
  messages: MessageDto[];
  /** Pass as `before` to load older messages; null when there are none. */
  olderCursor: string | null;
}
