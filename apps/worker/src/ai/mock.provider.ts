import type { Classification } from '@mini-inbox/contracts';
import type { AiProvider, ClassifyRequest, ReplyRequest, ReplyResult } from './ai-provider.js';

/**
 * MOCK AI PROVIDER: local development without a key, and automated tests. Not a real integration.
 * Replies are prefixed "[MOCK]" so they can never be mistaken for model output.
 *
 * Deterministic markers in the customer text drive test scenarios:
 *   [complex] → complexity "complex"     [garbage] → unreadable classification (null)
 *   [unanswerable] → answerable: false    [fail] → throws, like a network error
 * Every request is recorded in `calls` so tests can check exactly what context the model received.
 */
export class MockAiProvider implements AiProvider {
  readonly name = 'mock' as const;
  readonly calls: { kind: 'classify' | 'reply'; system: string; text: string }[] = [];
  /** Test hook: runs after a reply is drafted, before it is returned (e.g. to simulate a takeover). */
  beforeReplyReturns?: (request: ReplyRequest) => Promise<void>;

  async classify(request: ClassifyRequest): Promise<Classification | null> {
    this.calls.push({ kind: 'classify', system: request.system, text: request.message });
    if (request.message.includes('[fail]')) throw Object.assign(new Error('mock network error'), { code: 'ECONNRESET' });
    if (request.message.includes('[garbage]')) return null;
    return {
      complexity: request.message.includes('[complex]') ? 'complex' : 'simple',
      intent: /\b(hi|hello)\b|مرحبا/i.test(request.message) ? 'greeting' : 'question',
    };
  }

  async reply(request: ReplyRequest): Promise<ReplyResult> {
    const last = request.turns.at(-1)?.content ?? '';
    this.calls.push({ kind: 'reply', system: request.system, text: request.turns.map((t) => `${t.role}: ${t.content}`).join('\n') });
    if (last.includes('[fail]')) throw Object.assign(new Error('mock network error'), { code: 'ECONNRESET' });
    await this.beforeReplyReturns?.(request);
    if (last.includes('[unanswerable]')) return { kind: 'ok', answerable: false, reply: '' };
    return { kind: 'ok', answerable: true, reply: `[MOCK] reply to: ${last.slice(0, 60)}` };
  }

  reset(): void {
    this.calls.length = 0;
    this.beforeReplyReturns = undefined;
  }
}
