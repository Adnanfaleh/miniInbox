import type { Conversation } from '../generated/prisma/client.js';
import type { ConversationStatus, Mode } from '../generated/prisma/enums.js';
import { RecordNotFoundError } from '../errors.js';
import type { TenantTx } from '../with-tenant.js';

export const CONVERSATION_PAGE_MAX = 50;

export const conversations = {
  async findById(tx: TenantTx, tenantId: string, id: string): Promise<Conversation | null> {
    return tx.conversation.findUnique({ where: { tenantId_id: { tenantId, id } } });
  },

  /** Lookup only (no create): this tenant's conversation with one of its customers. */
  async findByCustomer(tx: TenantTx, tenantId: string, customerId: string): Promise<Conversation | null> {
    return tx.conversation.findUnique({ where: { tenantId_customerId: { tenantId, customerId } } });
  },

  /** One conversation per customer per tenant (D-012). Throws if the customer is not in this tenant. */
  async findOrCreateForCustomer(tx: TenantTx, tenantId: string, customerId: string): Promise<Conversation> {
    const customer = await tx.customer.findUnique({
      where: { tenantId_id: { tenantId, id: customerId } },
      select: { id: true },
    });
    if (!customer) throw new RecordNotFoundError('customer');
    return tx.conversation.upsert({
      where: { tenantId_customerId: { tenantId, customerId } },
      create: { tenantId, customerId },
      update: {},
    });
  },

  /** Newest first by created_at (D-015), with an (created_at, id) cursor. `take` is capped. */
  async list(
    tx: TenantTx,
    tenantId: string,
    { take = CONVERSATION_PAGE_MAX, cursorId }: { take?: number; cursorId?: string } = {},
  ): Promise<Conversation[]> {
    return tx.conversation.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(take, 1), CONVERSATION_PAGE_MAX),
      ...(cursorId ? { cursor: { tenantId_id: { tenantId, id: cursorId } }, skip: 1 } : {}),
    });
  },

  /**
   * The dashboard list: newest first, each with its customer and last message, in one query (no N+1).
   * Nested rows belong to the same tenant through the composite foreign keys, and RLS applies to them too.
   */
  async listSummaries(
    tx: TenantTx,
    tenantId: string,
    { take = CONVERSATION_PAGE_MAX, cursorId, status }: { take?: number; cursorId?: string; status?: ConversationStatus } = {},
  ) {
    return tx.conversation.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(take, 1), CONVERSATION_PAGE_MAX),
      ...(cursorId ? { cursor: { tenantId_id: { tenantId, id: cursorId } }, skip: 1 } : {}),
      select: {
        id: true,
        mode: true,
        modeChangedAt: true,
        status: true,
        statusChangedAt: true,
        createdAt: true,
        customer: { select: { id: true, displayName: true, externalRef: true } },
        messages: {
          where: { tenantId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { senderType: true, body: true, createdAt: true },
        },
      },
    });
  },

  /**
   * Sets the mode. Callers must hold the row lock (`lockConversation`) in the same transaction (D-002).
   * Returns the number of rows changed: 0 means not found in this tenant.
   */
  async setMode(tx: TenantTx, tenantId: string, id: string, mode: Mode, changedAt: Date = new Date()): Promise<number> {
    const { count } = await tx.conversation.updateMany({
      where: { tenantId, id },
      data: { mode, modeChangedAt: changedAt },
    });
    return count;
  },

  /**
   * Sets the lifecycle status (OPEN / CLOSED, D-047). Callers must hold the row lock (`lockConversation`) in the
   * same transaction. Returns the number of rows changed: 0 means not found in this tenant.
   */
  async setStatus(tx: TenantTx, tenantId: string, id: string, status: ConversationStatus, changedAt: Date = new Date()): Promise<number> {
    const { count } = await tx.conversation.updateMany({
      where: { tenantId, id },
      data: { status, statusChangedAt: changedAt },
    });
    return count;
  },
};
