import { Injectable, Logger } from '@nestjs/common';
import { ConversationStatus, EventType, Mode, SenderType, events, lockConversation, messages, withTenant } from '@mini-inbox/database';
import { PrismaService } from '../infra/prisma.service.js';

export type WriteOutcome = 'sent' | 'discarded' | 'already-settled' | 'not-found';

/**
 * The AI side of the handoff critical section (CLAUDE.md section 7). The reply text is drafted before this runs;
 * no model or network call happens while the lock is held.
 *   1. lock the conversation row (scoped by tenant, bounded lock wait)
 *   2. read the mode and the message state
 *   3. write the AI reply only if the mode is still AI, the conversation is still OPEN and the message is still PENDING
 *   4. commit
 * If staff took over in the meantime, the draft is discarded and recorded (IDs only, no body).
 */
@Injectable()
export class ReplyWriter {
  private readonly logger = new Logger(ReplyWriter.name);

  constructor(private readonly prisma: PrismaService) {}

  write(tenantId: string, conversationId: string, messageId: string, text: string): Promise<WriteOutcome> {
    return withTenant(this.prisma.client, tenantId, async (tx) => {
      const locked = await lockConversation(tx, tenantId, conversationId);
      if (!locked) return 'not-found';
      const inbound = await messages.findById(tx, tenantId, messageId);
      if (!inbound || inbound.conversationId !== conversationId) return 'not-found';
      if (inbound.replyStatus !== 'PENDING') return 'already-settled';

      // Staff took over, or closed the conversation (D-047), while the draft was being written.
      if (locked.mode !== Mode.AI || locked.status !== ConversationStatus.OPEN) {
        await events.create(tx, tenantId, { conversationId, eventType: EventType.DRAFT_DISCARDED, messageId });
        await messages.settle(tx, tenantId, messageId, 'SKIPPED');
        const reason = locked.status !== ConversationStatus.OPEN ? 'conversation is closed' : 'conversation is in HUMAN mode';
        this.logger.log({ conversationId, messageId, reason }, 'AI draft discarded');
        return 'discarded';
      }

      const reply = await messages.create(tx, tenantId, {
        conversationId,
        senderType: SenderType.AI,
        body: text,
        inReplyToMessageId: messageId,
      });
      await events.create(tx, tenantId, { conversationId, eventType: EventType.AI_REPLY_SENT, messageId: reply.id });
      await messages.settle(tx, tenantId, messageId, 'REPLIED');
      return 'sent';
    });
  }
}
