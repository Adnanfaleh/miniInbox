import { Injectable, Logger } from '@nestjs/common';
import type { InboundMessage, InboundMessageAccepted } from '@mini-inbox/contracts';
import { Prisma, ReplyStatus, SenderType, conversations, customers, messages } from '@mini-inbox/database';
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
        return { tenantId, messageId: existing.id, conversationId: existing.conversationId, duplicate: true };
      }
      const customer = await customers.findOrCreateByExternalRef(tx, tenantId, input.from);
      const conversation = await conversations.findOrCreateForCustomer(tx, tenantId, customer.id);
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
}
