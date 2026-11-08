import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { classificationSchema, replySchema, type Classification } from '@mini-inbox/contracts';
import type { AiProvider, ClassifyRequest, ReplyRequest, ReplyResult } from './ai-provider.js';

/**
 * Anthropic Messages API with structured outputs (`messages.parse` + `zodOutputFormat`).
 * The key comes from the environment only. Retries are owned by BullMQ (maxRetries: 0), and each call is bounded
 * by a 30s timeout. Effort is `low`: classification and short knowledge-base answers don't need deep reasoning.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 0 });
  }

  async classify(request: ClassifyRequest): Promise<Classification | null> {
    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: 2048,
        system: request.system,
        messages: [{ role: 'user', content: request.message }],
        output_config: { effort: 'low', format: zodOutputFormat(classificationSchema) },
      });
      if (response.stop_reason === 'refusal') return null;
      return response.parsed_output ?? null;
    } catch (err) {
      // API and network errors are retried by the queue. Anything else is unreadable output: fall back.
      if (err instanceof Anthropic.APIError) throw err;
      return null;
    }
  }

  async reply(request: ReplyRequest): Promise<ReplyResult> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 4096,
      system: request.system,
      messages: request.turns,
      output_config: { effort: 'low', format: zodOutputFormat(replySchema) },
    });
    if (response.stop_reason === 'refusal') return { kind: 'refused' };
    const parsed = response.parsed_output;
    // Unreadable reply output is retried like any other transient failure.
    if (!parsed) throw new Error(`unreadable reply output (stop_reason ${response.stop_reason})`);
    return { kind: 'ok', answerable: parsed.answerable, reply: parsed.reply };
  }
}
