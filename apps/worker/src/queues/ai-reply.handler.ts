import { Inject, Injectable, Logger } from '@nestjs/common';
import { Mode, SenderType, conversations, messages, withTenant } from '@mini-inbox/database';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { AiRouter } from '../ai/ai-router.js';
import { WORKER_SETTINGS, type WorkerSettings } from '../config/worker-env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { replyLanguage } from '../pipeline/language.js';
import { PersonaCache } from '../pipeline/persona-cache.js';
import { replySystemPrompt, toChatTurns } from '../pipeline/prompts.js';
import { ReplyWriter, type WriteOutcome } from '../pipeline/reply-writer.js';
import { trimToLength } from '../pipeline/trim.js';
import { isWithinWorkingHours } from '../pipeline/working-hours.js';
import { parseJobPayload } from './job-context.js';

export type ReplyOutcome = 'ignored' | 'already-settled' | 'skipped-human' | 'waiting' | WriteOutcome;

/**
 * Stage 2 (`ai-reply`, priority): keep arrival order inside the conversation, draft the reply outside any lock,
 * then hand it to ReplyWriter, which re-checks the mode under the row lock.
 */
@Injectable()
export class AiReplyHandler {
  private readonly logger = new Logger(AiReplyHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: PersonaCache,
    private readonly ai: AiRouter,
    private readonly writer: ReplyWriter,
    @Inject(WORKER_SETTINGS) private readonly settings: WorkerSettings,
  ) {}

  /** `job` and `token` are needed to delay the job while an older message is pending. */
  async handle(job: Pick<Job, 'data' | 'moveToDelayed'>, token?: string): Promise<ReplyOutcome> {
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
      if (conversation.mode === Mode.HUMAN) {
        await messages.settle(tx, tenantId, messageId, 'SKIPPED');
        return { kind: 'skipped-human' as const };
      }
      // Arrival order inside one conversation: an older PENDING message is answered first, even if it is complex.
      if (await messages.hasOlderPending(tx, tenantId, message)) return { kind: 'waiting' as const };
      return { kind: 'ready' as const, message };
    });

    if (state.kind === 'waiting') {
      this.logger.log({ conversationId, messageId }, 'waiting for an older message in the conversation');
      await job.moveToDelayed(Date.now() + this.settings.orderWaitMs, token);
      throw new DelayedError();
    }
    if (state.kind !== 'ready') {
      this.logger.log({ conversationId, messageId, outcome: state.kind }, 'reply not needed');
      return state.kind;
    }

    const snapshot = await this.cache.get(tenantId);
    if (!snapshot?.persona) throw new UnrecoverableError('tenant has no persona configuration');
    const p = snapshot.persona;
    const language = replyLanguage(p.languagePreference, state.message.body);

    let text: string;
    if (!isWithinWorkingHours(new Date(), { timeZone: snapshot.timeZone, ...p })) {
      text = language === 'ar' ? p.outOfHoursMessageAr : p.outOfHoursMessageEn;
    } else {
      const history = await withTenant(this.prisma.client, tenantId, (tx) =>
        messages.listRecentUpTo(tx, tenantId, state.message, this.settings.historySize),
      );
      const result = await this.ai.reply({ system: replySystemPrompt(snapshot, language), turns: toChatTurns(history) });
      const answered = result.kind === 'ok' && result.answerable && result.reply.trim().length > 0;
      text = answered ? trimToLength(result.reply, p.replyMaxLength) : language === 'ar' ? p.outOfKbMessageAr : p.outOfKbMessageEn;
    }

    const outcome = await this.writer.write(tenantId, conversationId, messageId, text);
    this.logger.log({ conversationId, messageId, outcome }, 'reply stage finished');
    return outcome;
  }
}
