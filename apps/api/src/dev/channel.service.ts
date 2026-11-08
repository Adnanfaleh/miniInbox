import { Injectable } from '@nestjs/common';
import { CHANNEL_THREAD_LIMIT, type ChannelThreadResponse } from '@mini-inbox/contracts';
import { conversations, customers, messages } from '@mini-inbox/database';
import { TenantDb } from '../database/tenant-db.service.js';

/**
 * DEV STAND-IN for a channel delivering replies to the customer. Reads one sender's thread with the tenant in
 * request context (set by WebhookTenantGuard from the URL). Tenant-scoped transaction and RLS, like every read.
 */
@Injectable()
export class ChannelService {
  constructor(private readonly db: TenantDb) {}

  thread(from: string): Promise<ChannelThreadResponse> {
    return this.db.run(async (tx, tenantId) => {
      const customer = await customers.findByExternalRef(tx, tenantId, from);
      const conversation = customer ? await conversations.findByCustomer(tx, tenantId, customer.id) : null;
      if (!conversation) return { mode: null, messages: [] };
      const page = await messages.listPage(tx, tenantId, conversation.id, { take: CHANNEL_THREAD_LIMIT });
      return {
        mode: conversation.mode,
        // Customer view only: no reply status, classification or links to other records.
        messages: page.map((m) => ({ id: m.id, senderType: m.senderType, body: m.body, createdAt: m.createdAt.toISOString() })),
      };
    });
  }
}
