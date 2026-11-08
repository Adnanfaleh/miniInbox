import type { ConversationEvent } from '../generated/prisma/client.js';
import type { EventType } from '../generated/prisma/enums.js';
import { RecordNotFoundError } from '../errors.js';
import type { TenantTx } from '../with-tenant.js';

export const EVENT_PAGE_MAX = 200;

export const events = {
  /** Records an audit event (IDs only, no message bodies). Referenced rows must be in the same tenant. */
  async create(
    tx: TenantTx,
    tenantId: string,
    input: { conversationId: string; eventType: EventType; messageId?: string },
  ): Promise<ConversationEvent> {
    const conversation = await tx.conversation.findUnique({
      where: { tenantId_id: { tenantId, id: input.conversationId } },
      select: { id: true },
    });
    if (!conversation) throw new RecordNotFoundError('conversation');
    if (input.messageId) {
      const message = await tx.message.findUnique({
        where: { tenantId_id: { tenantId, id: input.messageId } },
        select: { conversationId: true },
      });
      if (!message || message.conversationId !== input.conversationId) throw new RecordNotFoundError('message');
    }
    return tx.conversationEvent.create({
      data: {
        tenantId,
        conversationId: input.conversationId,
        eventType: input.eventType,
        messageId: input.messageId ?? null,
      },
    });
  },

  /** Closed / reopened events of one conversation, oldest first: the most recent `take` of them (D-047). */
  async listLifecycle(tx: TenantTx, tenantId: string, conversationId: string, take = 100): Promise<ConversationEvent[]> {
    const rows = await tx.conversationEvent.findMany({
      where: { tenantId, conversationId, eventType: { in: ['CLOSED', 'REOPENED'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(take, 1), EVENT_PAGE_MAX),
    });
    return rows.reverse();
  },

  async listForConversation(tx: TenantTx, tenantId: string, conversationId: string): Promise<ConversationEvent[]> {
    return tx.conversationEvent.findMany({
      where: { tenantId, conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: EVENT_PAGE_MAX,
    });
  },
};
