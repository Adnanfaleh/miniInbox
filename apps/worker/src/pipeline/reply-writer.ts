import { Injectable, Logger } from '@nestjs/common';
import { EventType, Mode, SenderType, events, lockConversation, messages, withTenant } from '@mini-inbox/database';
import { PrismaService } from '../infra/prisma.service.js';

export type WriteOutcome = 'sent' | 'discarded' | 'already-settled' | 'not-found';

/**
 * The AI side of the handoff critical section (CLAUDE.md section 7). The reply text is drafted before this runs;
 * no model or network call happens while the lock is held.
 *   1. lock the conversation row (scoped by tenant, bounded lock wait)
 *   2. read the mode and the message state
 *   3. write the AI reply only if the mode is still AI and the message is still PENDING
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

      if (locked.mode !== Mode.AI) {
        await events.create(tx, tenantId, { conversationId, eventType: EventType.DRAFT_DISCARDED, messageId });
        await messages.settle(tx, tenantId, messageId, 'SKIPPED');
        this.logger.log({ conversationId, messageId }, 'AI draft discarded: conversation is in HUMAN mode');
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
