import { Injectable, Logger } from '@nestjs/common';
import { CLASSIFICATION_FALLBACK, REPLY_PRIORITY } from '@mini-inbox/contracts';
import { ConversationStatus, Mode, SenderType, conversations, messages, withTenant } from '@mini-inbox/database';
import { UnrecoverableError, type Job } from 'bullmq';
import { AiRouter } from '../ai/ai-router.js';
import { PrismaService } from '../infra/prisma.service.js';
import { PersonaCache } from '../pipeline/persona-cache.js';
import { classificationSystemPrompt } from '../pipeline/prompts.js';
import { isWithinWorkingHours } from '../pipeline/working-hours.js';
import { parseJobPayload } from './job-context.js';
import { ReplyQueue } from './reply-queue.service.js';

export type InboundOutcome = 'ignored' | 'already-settled' | 'skipped-human' | 'skipped-closed' | 'out-of-hours' | 'classified';

/**
 * Stage 1 (`inbound-message`, FIFO): reload, check mode and working hours, classify, then queue the reply
 * with its priority. Every read is scoped to the job's tenant; IDs from the payload are re-checked.
 */
@Injectable()
export class InboundMessageHandler {
  private readonly logger = new Logger(InboundMessageHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: PersonaCache,
    private readonly ai: AiRouter,
    private readonly replies: ReplyQueue,
  ) {}

  async handle(job: Pick<Job, 'data'>): Promise<InboundOutcome> {
    const data = parseJobPayload(job.data);
    const { tenantId, conversationId, messageId } = data;

    const state = await withTenant(this.prisma.client, tenantId, async (tx) => {
      const message = await messages.findById(tx, tenantId, messageId);
      if (!message || message.conversationId !== conversationId || message.senderType !== SenderType.CUSTOMER) {
        return { kind: 'ignored' as const };
      }
      if (message.replyStatus !== 'PENDING') return { kind: 'already-settled' as const };
      const conversation = await conversations.findById(tx, tenantId, conversationId);
      if (!conversation) return { kind: 'ignored' as const };
      if (conversation.status === ConversationStatus.CLOSED) {
        // Closed by staff (D-047): no AI reply. A new customer message reopens the conversation.
        await messages.settle(tx, tenantId, messageId, 'SKIPPED');
        return { kind: 'skipped-closed' as const };
      }
      if (conversation.mode === Mode.HUMAN) {
        // Messages that arrive during a takeover belong to the human (no AI reply, also not after return to AI).
        await messages.settle(tx, tenantId, messageId, 'SKIPPED');
        return { kind: 'skipped-human' as const };
      }
      return { kind: 'pending' as const, text: message.body };
    });
    if (state.kind !== 'pending') {
      this.logger.log({ conversationId, messageId, outcome: state.kind }, 'inbound message not processed');
      return state.kind;
    }

    const snapshot = await this.cache.get(tenantId);
    if (!snapshot?.persona) throw new UnrecoverableError('tenant has no persona configuration');

    const open = isWithinWorkingHours(new Date(), { timeZone: snapshot.timeZone, ...snapshot.persona });
    if (!open) {
      // No classification and no model call: stage 2 sends the tenant's out-of-hours message, in arrival order.
      await this.replies.add(data, REPLY_PRIORITY.simple);
      this.logger.log({ conversationId, messageId }, 'out of working hours: reply queued without classification');
      return 'out-of-hours';
    }

    const classified = await this.ai.classify({ system: classificationSystemPrompt(snapshot), message: state.text });
    const labels = classified ?? CLASSIFICATION_FALLBACK;
    if (!classified) this.logger.warn({ conversationId, messageId }, 'classification unreadable: treated as complex');

    await withTenant(this.prisma.client, tenantId, (tx) => messages.setClassification(tx, tenantId, messageId, labels));
    await this.replies.add(data, REPLY_PRIORITY[labels.complexity]);
    this.logger.log({ conversationId, messageId, complexity: labels.complexity, intent: labels.intent }, 'inbound message classified');
    return 'classified';
  }
}
