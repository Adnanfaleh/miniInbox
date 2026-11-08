import type { Message } from '../generated/prisma/client.js';
import type { Complexity, Intent, ReplyStatus, SenderType } from '../generated/prisma/enums.js';
import { RecordNotFoundError } from '../errors.js';
import type { TenantTx } from '../with-tenant.js';

export const MESSAGE_PAGE_MAX = 200;

export interface CreateMessageInput {
  conversationId: string;
  senderType: SenderType;
  body: string;
  /** Inbound only: the webhook's dedupe key (D-010). */
  externalId?: string;
  /** The inbound message this reply answers (D-014). */
  inReplyToMessageId?: string;
  /** Customer messages start as PENDING (D-032). */
  replyStatus?: ReplyStatus;
}

export const messages = {
  async findById(tx: TenantTx, tenantId: string, id: string): Promise<Message | null> {
    return tx.message.findUnique({ where: { tenantId_id: { tenantId, id } } });
  },

  async findByExternalId(tx: TenantTx, tenantId: string, externalId: string): Promise<Message | null> {
    return tx.message.findUnique({ where: { tenantId_externalId: { tenantId, externalId } } });
  },

  /** The reply already stored for an inbound message, if any (D-014). */
  async findReplyTo(tx: TenantTx, tenantId: string, inboundMessageId: string): Promise<Message | null> {
    return tx.message.findUnique({
      where: { tenantId_inReplyToMessageId: { tenantId, inReplyToMessageId: inboundMessageId } },
    });
  },

  /**
   * Stores a message under `tenantId`. The conversation (and the replied-to message) must belong to the same
   * tenant: the check here rejects a mismatch with RecordNotFoundError, and the composite FKs reject it in the
   * database if this check is ever bypassed (CLAUDE.md section 4.2).
   */
  async create(tx: TenantTx, tenantId: string, input: CreateMessageInput): Promise<Message> {
    const conversation = await tx.conversation.findUnique({
      where: { tenantId_id: { tenantId, id: input.conversationId } },
      select: { id: true },
    });
    if (!conversation) throw new RecordNotFoundError('conversation');
    if (input.inReplyToMessageId) {
      const original = await tx.message.findUnique({
        where: { tenantId_id: { tenantId, id: input.inReplyToMessageId } },
        select: { conversationId: true },
      });
      if (!original || original.conversationId !== input.conversationId) throw new RecordNotFoundError('message');
    }
    return tx.message.create({
      data: {
        tenantId,
        conversationId: input.conversationId,
        senderType: input.senderType,
        body: input.body,
        externalId: input.externalId ?? null,
        inReplyToMessageId: input.inReplyToMessageId ?? null,
        replyStatus: input.replyStatus ?? null,
      },
    });
  },

  /**
   * Moves a customer message from PENDING to a final state. Only a PENDING message changes, so a retry or a
   * late worker can't overwrite a settled one. Returns the number of rows changed (0 or 1).
   */
  async settle(tx: TenantTx, tenantId: string, id: string, status: Exclude<ReplyStatus, 'PENDING'>): Promise<number> {
    const { count } = await tx.message.updateMany({
      where: { tenantId, id, replyStatus: 'PENDING' },
      data: { replyStatus: status },
    });
    return count;
  },

  /** Stores the classifier's labels on a customer message (D-023). Returns rows changed. */
  async setClassification(
    tx: TenantTx,
    tenantId: string,
    id: string,
    labels: { complexity: Complexity; intent: Intent },
  ): Promise<number> {
    const { count } = await tx.message.updateMany({ where: { tenantId, id }, data: labels });
    return count;
  },

  /** True if an older customer message in the same conversation is still PENDING (arrival order, D-026). */
  async hasOlderPending(tx: TenantTx, tenantId: string, message: Pick<Message, 'id' | 'conversationId' | 'createdAt'>): Promise<boolean> {
    const older = await tx.message.findFirst({
      where: {
        tenantId,
        conversationId: message.conversationId,
        replyStatus: 'PENDING',
        id: { not: message.id },
        OR: [{ createdAt: { lt: message.createdAt } }, { createdAt: message.createdAt, id: { lt: message.id } }],
      },
      select: { id: true },
    });
    return older !== null;
  },

  /** The last `take` messages up to and including `upTo`, oldest first (the model's context window). */
  async listRecentUpTo(
    tx: TenantTx,
    tenantId: string,
    upTo: Pick<Message, 'conversationId' | 'createdAt'>,
    take: number,
  ): Promise<Message[]> {
    const rows = await tx.message.findMany({
      where: { tenantId, conversationId: upTo.conversationId, createdAt: { lte: upTo.createdAt } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(take, 1), MESSAGE_PAGE_MAX),
    });
    return rows.reverse();
  },

  /**
   * On return to AI: every customer message still PENDING in the conversation arrived during the takeover and
   * belongs to the human, so it is marked SKIPPED and the AI never answers it. Returns rows changed.
   */
  async skipPendingInConversation(tx: TenantTx, tenantId: string, conversationId: string): Promise<number> {
    const { count } = await tx.message.updateMany({
      where: { tenantId, conversationId, senderType: 'CUSTOMER', replyStatus: 'PENDING' },
      data: { replyStatus: 'SKIPPED' },
    });
    return count;
  },

  /** The conversation's most recent customer message, if any. */
  async latestCustomerMessage(tx: TenantTx, tenantId: string, conversationId: string): Promise<Message | null> {
    return tx.message.findFirst({
      where: { tenantId, conversationId, senderType: 'CUSTOMER' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  },

  /**
   * One page of a conversation's history for the dashboard: the latest `take` messages, or the ones before
   * `beforeId`, returned oldest first. `beforeId` must be a message of the same tenant and conversation,
   * otherwise the page is empty.
   */
  async listPage(
    tx: TenantTx,
    tenantId: string,
    conversationId: string,
    { take = 50, beforeId }: { take?: number; beforeId?: string } = {},
  ): Promise<Message[]> {
    let before: { createdAt: Date; id: string } | undefined;
    if (beforeId) {
      const anchor = await tx.message.findUnique({
        where: { tenantId_id: { tenantId, id: beforeId } },
        select: { createdAt: true, id: true, conversationId: true },
      });
      if (!anchor || anchor.conversationId !== conversationId) return [];
      before = anchor;
    }
    const rows = await tx.message.findMany({
      where: {
        tenantId,
        conversationId,
        ...(before ? { OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(take, 1), MESSAGE_PAGE_MAX),
    });
    return rows.reverse();
  },

  /** Oldest first. `take` is capped so history reads stay bounded. */
  async listForConversation(
    tx: TenantTx,
    tenantId: string,
    conversationId: string,
    { take = MESSAGE_PAGE_MAX }: { take?: number } = {},
  ): Promise<Message[]> {
    return tx.message.findMany({
      where: { tenantId, conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: Math.min(Math.max(take, 1), MESSAGE_PAGE_MAX),
    });
  },
};
