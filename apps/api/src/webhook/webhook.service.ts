import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { InboundMessage, InboundMessageAccepted } from '@mini-inbox/contracts';
import {
  ConversationStatus,
  EventType,
  Mode,
  Prisma,
  ReplyStatus,
  SenderType,
  conversations,
  customers,
  events,
  lockConversation,
  messages,
  type TenantTx,
} from '@mini-inbox/database';
import { TenantDb } from '../database/tenant-db.service.js';
import { InboundMessageProducer } from '../queue/inbound-message.producer.js';

interface Stored extends InboundMessageAccepted {
  tenantId: string;
  duplicate: boolean;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly producer: InboundMessageProducer,
  ) {}

  /**
   * Stores the inbound message under the verified tenant, then enqueues it (awaited) and returns its IDs.
   * A repeated `externalId` returns the stored message and enqueues it again: the job ID makes that a no-op
   * if the job exists, and it recovers a message whose earlier enqueue failed.
   */
  async receive(input: InboundMessage): Promise<InboundMessageAccepted> {
    const stored = await this.storeWithRetry(input);
    await this.producer.enqueue({
      tenantId: stored.tenantId,
      conversationId: stored.conversationId,
      messageId: stored.messageId,
    });
    // IDs only: never the text or the sender address.
    this.logger.log(
      { messageId: stored.messageId, conversationId: stored.conversationId, duplicate: stored.duplicate },
      'inbound message accepted',
    );
    return { messageId: stored.messageId, conversationId: stored.conversationId };
  }

  /** Two first messages from the same new sender can race on the unique keys. One retry resolves it. */
  private async storeWithRetry(input: InboundMessage): Promise<Stored> {
    try {
      return await this.store(input);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return this.store(input);
      throw err;
    }
  }

  private store(input: InboundMessage): Promise<Stored> {
    return this.db.run(async (tx, tenantId) => {
      const existing = await messages.findByExternalId(tx, tenantId, input.externalId);
      if (existing) {
        // A channel retry repeats the same sender. The same message ID from a different sender is a client bug:
        // refuse it (409) instead of silently answering with another customer's message.
        const conversation = await conversations.findById(tx, tenantId, existing.conversationId);
        const sender = conversation ? await customers.findById(tx, tenantId, conversation.customerId) : null;
        if (sender?.externalRef !== input.from) {
          this.logger.warn({ messageId: existing.id, conversationId: existing.conversationId }, 'externalId reused by a different sender');
          throw new ConflictException('externalId already used by a different sender');
        }
        return { tenantId, messageId: existing.id, conversationId: existing.conversationId, duplicate: true };
      }
      const customer = await customers.findOrCreateByExternalRef(tx, tenantId, input.from);
      const conversation = await conversations.findOrCreateForCustomer(tx, tenantId, customer.id);
      if (conversation.status === ConversationStatus.CLOSED) await this.reopen(tx, tenantId, conversation.id);
      const message = await messages.create(tx, tenantId, {
        conversationId: conversation.id,
        senderType: SenderType.CUSTOMER,
        body: input.text,
        externalId: input.externalId,
        replyStatus: ReplyStatus.PENDING,
      });
      return { tenantId, messageId: message.id, conversationId: conversation.id, duplicate: false };
    });
  }

  /**
   * The customer wrote to a closed conversation: reopen the same conversation, always in AI mode (D-047), so the new
   * message gets an AI reply even if staff had taken over before closing. Under the row lock, like close.
   */
  private async reopen(tx: TenantTx, tenantId: string, conversationId: string): Promise<void> {
    const locked = await lockConversation(tx, tenantId, conversationId);
    if (!locked || locked.status !== ConversationStatus.CLOSED) return; // reopened by a concurrent message
    const now = new Date();
    await conversations.setStatus(tx, tenantId, conversationId, ConversationStatus.OPEN, now);
    if (locked.mode !== Mode.AI) await conversations.setMode(tx, tenantId, conversationId, Mode.AI, now);
    await events.create(tx, tenantId, { conversationId, eventType: EventType.REOPENED });
    this.logger.log({ conversationId, previousMode: locked.mode }, 'conversation reopened by a customer message');
  }
}
