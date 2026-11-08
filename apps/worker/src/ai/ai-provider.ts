import type { Classification } from '@mini-inbox/contracts';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClassifyRequest {
  system: string;
  /** The customer's message. */
  message: string;
}

export interface ReplyRequest {
  system: string;
  /** Recent conversation turns, ending with the customer's message being answered. */
  turns: ChatTurn[];
}

export type ReplyResult = { kind: 'ok'; answerable: boolean; reply: string } | { kind: 'refused' };

/**
 * A model backend behind the AI router. Implementations must:
 * - throw on network errors and timeouts (the queue retries the job);
 * - return null from `classify` when the output can't be read (the pipeline falls back to "complex");
 * - never log prompts or replies.
 */
export interface AiProvider {
  readonly name: 'anthropic' | 'mock';
  classify(request: ClassifyRequest): Promise<Classification | null>;
  reply(request: ReplyRequest): Promise<ReplyResult>;
}

/** Injection token for the active provider. */
export const AI_PROVIDER = 'AI_PROVIDER';
