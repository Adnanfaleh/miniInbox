import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { replyLanguage, type ConversationModeState, type ManualReplyCreated } from '@mini-inbox/contracts';
import {
  EventType,
  Mode,
  SenderType,
  conversations,
  events,
  lockConversation,
  messages,
  persona,
  type TenantTx,
} from '@mini-inbox/database';
import { TenantDb } from '../database/tenant-db.service.js';
import { HANDOFF_NOTICES } from './handoff-notices.js';

/**
 * Takeover, return to AI and manual replies. Each runs the same critical section as the AI worker:
 * lock the conversation row (tenant-scoped, bounded wait) → read the mode → write only if the mode allows → commit.
 * No network call happens while the lock is held.
 */
@Injectable()
export class ConversationModeService {
  private readonly logger = new Logger(ConversationModeService.name);

  constructor(private readonly db: TenantDb) {}

  takeover(conversationId: string): Promise<ConversationModeState> {
    return this.db.run(async (tx, tenantId) => {
      const locked = await lockConversation(tx, tenantId, conversationId);
      if (!locked) throw new NotFoundException();
      if (locked.mode === Mode.HUMAN) return this.state(tx, tenantId, conversationId); // already taken over
      const now = new Date();
      await conversations.setMode(tx, tenantId, conversationId, Mode.HUMAN, now);
      await events.create(tx, tenantId, { conversationId, eventType: EventType.TAKEOVER });
      // Pending customer messages are left as they are: the worker sees HUMAN mode and marks them skipped.
      const noticed = await this.notice(tx, tenantId, conversationId, 'takeover');
      this.logger.log({ conversationId, noticed }, 'conversation taken over');
      return { conversationId, mode: 'HUMAN', modeChangedAt: now.toISOString() };
    });
  }

  returnToAi(conversationId: string): Promise<ConversationModeState> {
    return this.db.run(async (tx, tenantId) => {
      const locked = await lockConversation(tx, tenantId, conversationId);
      if (!locked) throw new NotFoundException();
      if (locked.mode === Mode.AI) return this.state(tx, tenantId, conversationId); // already with the AI
      const now = new Date();
      // Messages from the takeover period belong to the human: the AI must never answer them.
      const skipped = await messages.skipPendingInConversation(tx, tenantId, conversationId);
      await conversations.setMode(tx, tenantId, conversationId, Mode.AI, now);
      await events.create(tx, tenantId, { conversationId, eventType: EventType.RETURN_TO_AI });
      const noticed = await this.notice(tx, tenantId, conversationId, 'return');
      this.logger.log({ conversationId, skipped, noticed }, 'conversation returned to AI');
      return { conversationId, mode: 'AI', modeChangedAt: now.toISOString() };
    });
  }

  reply(conversationId: string, text: string): Promise<ManualReplyCreated> {
    return this.db.run(async (tx, tenantId) => {
      const locked = await lockConversation(tx, tenantId, conversationId);
      if (!locked) throw new NotFoundException();
      if (locked.mode !== Mode.HUMAN) throw new ConflictException('Take over the conversation before replying');
      const message = await messages.create(tx, tenantId, { conversationId, senderType: SenderType.HUMAN, body: text });
      this.logger.log({ conversationId, messageId: message.id }, 'manual reply stored');
      return { messageId: message.id };
    });
  }

  private async state(tx: TenantTx, tenantId: string, conversationId: string): Promise<ConversationModeState> {
    const c = await conversations.findById(tx, tenantId, conversationId);
    if (!c) throw new NotFoundException();
    return { conversationId: c.id, mode: c.mode, modeChangedAt: c.modeChangedAt?.toISOString() ?? null };
  }

  /** Stores the handoff notice as a SYSTEM message if the tenant has notices on. Returns whether one was stored. */
  private async notice(tx: TenantTx, tenantId: string, conversationId: string, kind: 'takeover' | 'return'): Promise<boolean> {
    const config = await persona.get(tx, tenantId);
    if (!config?.handoffNoticesEnabled) return false;
    const latest = await messages.latestCustomerMessage(tx, tenantId, conversationId);
    const language = replyLanguage(config.languagePreference, latest?.body ?? '');
    await messages.create(tx, tenantId, { conversationId, senderType: SenderType.SYSTEM, body: HANDOFF_NOTICES[kind][language] });
    return true;
  }
}
