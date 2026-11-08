import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Classification } from '@mini-inbox/contracts';
import { AI_PROVIDER, type AiProvider, type ClassifyRequest, type ReplyRequest, type ReplyResult } from './ai-provider.js';

/**
 * The single entry point for model calls (CLAUDE.md section 3). Logs provider, duration and outcome only:
 * never prompts, customer text or replies. Tenant and job IDs come from the logging context.
 */
@Injectable()
export class AiRouter {
  private readonly logger = new Logger(AiRouter.name);

  constructor(@Inject(AI_PROVIDER) private readonly provider: AiProvider) {}

  get providerName(): AiProvider['name'] {
    return this.provider.name;
  }

  async classify(request: ClassifyRequest): Promise<Classification | null> {
    const started = Date.now();
    const result = await this.provider.classify(request);
    this.logger.log({ provider: this.provider.name, ms: Date.now() - started, readable: result !== null }, 'classified');
    return result;
  }

  async reply(request: ReplyRequest): Promise<ReplyResult> {
    const started = Date.now();
    const result = await this.provider.reply(request);
    this.logger.log(
      { provider: this.provider.name, ms: Date.now() - started, outcome: result.kind === 'ok' ? (result.answerable ? 'answer' : 'not-in-kb') : 'refused' },
      'reply drafted',
    );
    return result;
  }
}
