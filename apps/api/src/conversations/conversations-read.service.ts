import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ConversationDetailQuery,
  ConversationDetailResponse,
  ConversationListQuery,
  ConversationListResponse,
  MessageDto,
} from '@mini-inbox/contracts';
import { EventType, conversations, customers, events, messages, type Message } from '@mini-inbox/database';
import { TenantDb } from '../database/tenant-db.service.js';

const PREVIEW_LENGTH = 120;

/** Display label for a customer in the tenant's own dashboard: the name if known, else the sender address. */
const customerLabel = (c: { displayName: string | null; externalRef: string }) => c.displayName ?? c.externalRef;

/** Explicit response shape: no tenant_id or other internal columns. */
function toMessageDto(m: Message): MessageDto {
  return {
    id: m.id,
    senderType: m.senderType,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    inReplyToMessageId: m.inReplyToMessageId,
    replyStatus: m.replyStatus,
    complexity: m.complexity,
    intent: m.intent,
  };
}

/** Tenant-scoped, bounded reads for the dashboard. The tenant comes from the request context via TenantDb. */
@Injectable()
export class ConversationsReadService {
  constructor(private readonly db: TenantDb) {}

  list(query: ConversationListQuery): Promise<ConversationListResponse> {
    return this.db.run(async (tx, tenantId) => {
      const rows = await conversations.listSummaries(tx, tenantId, { take: query.limit, cursorId: query.cursor, status: query.status });
      const items = rows.map((c) => {
        const last = c.messages[0];
        return {
          id: c.id,
          mode: c.mode,
          modeChangedAt: c.modeChangedAt?.toISOString() ?? null,
          status: c.status,
          statusChangedAt: c.statusChangedAt?.toISOString() ?? null,
          createdAt: c.createdAt.toISOString(),
          customer: { id: c.customer.id, label: customerLabel(c.customer) },
          lastMessage: last
            ? { senderType: last.senderType, preview: last.body.slice(0, PREVIEW_LENGTH), createdAt: last.createdAt.toISOString() }
            : null,
        };
      });
      return { items, nextCursor: items.length === query.limit ? items[items.length - 1]!.id : null };
    });
  }

  detail(conversationId: string, query: ConversationDetailQuery): Promise<ConversationDetailResponse> {
    return this.db.run(async (tx, tenantId) => {
      const conversation = await conversations.findById(tx, tenantId, conversationId);
      if (!conversation) throw new NotFoundException();
      const customer = await customers.findById(tx, tenantId, conversation.customerId);
      if (!customer) throw new NotFoundException();
      const page = await messages.listPage(tx, tenantId, conversationId, { take: query.limit, beforeId: query.before });
      // Closed / reopened markers for the staff view, from the audit log (times only).
      const lifecycle = (await events.listLifecycle(tx, tenantId, conversationId)).map((e) => ({
        type: e.eventType === EventType.CLOSED ? ('CLOSED' as const) : ('REOPENED' as const),
        at: e.createdAt.toISOString(),
      }));
      return {
        conversation: {
          id: conversation.id,
          mode: conversation.mode,
          modeChangedAt: conversation.modeChangedAt?.toISOString() ?? null,
          status: conversation.status,
          statusChangedAt: conversation.statusChangedAt?.toISOString() ?? null,
          createdAt: conversation.createdAt.toISOString(),
          customer: { id: customer.id, label: customerLabel(customer) },
        },
        messages: page.map(toMessageDto),
        lifecycle,
        olderCursor: page.length === query.limit ? page[0]!.id : null,
      };
    });
  }
}
