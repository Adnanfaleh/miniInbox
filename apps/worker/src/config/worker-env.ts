import { Global, Logger, Module } from '@nestjs/common';
import { loadEnv, workerEnvSchema, type WorkerEnv } from '@mini-inbox/config';
import { AI_PROVIDER, type AiProvider } from '../ai/ai-provider.js';
import { AnthropicProvider } from '../ai/anthropic.provider.js';
import { MockAiProvider } from '../ai/mock.provider.js';

export const WORKER_ENV = 'WORKER_ENV';
export type { WorkerEnv };

/** Tunables with production defaults. Tests override them through this token. */
export interface WorkerSettings {
  /** Start consuming on boot. Tests start the consumers themselves. */
  autorun: boolean;
  /** How long a reply job waits before re-checking that older messages in its conversation are settled. */
  orderWaitMs: number;
  /** A complex reply job waiting this long is raised to the simple priority. */
  agingAfterMs: number;
  /** How often the aging sweep runs. */
  agingSweepMs: number;
  /** Messages of history given to the model. */
  historySize: number;
  /** Retries for reply jobs (inbound jobs carry the producer's options). */
  replyAttempts: number;
  replyBackoffMs: number;
}

export const WORKER_SETTINGS = 'WORKER_SETTINGS';
export const DEFAULT_WORKER_SETTINGS: WorkerSettings = {
  autorun: true,
  orderWaitMs: 2000,
  agingAfterMs: 60_000,
  agingSweepMs: 15_000,
  historySize: 10,
  replyAttempts: 5,
  replyBackoffMs: 2000,
};

/**
 * Picks the AI provider: Anthropic when a key is set (the model is then required by the env schema),
 * otherwise the labelled MOCK provider, with a warning on every boot.
 */
function aiProviderFactory(env: WorkerEnv): AiProvider {
  if (env.ANTHROPIC_API_KEY && env.AI_MODEL) return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.AI_MODEL);
  new Logger('AiProvider').warn('ANTHROPIC_API_KEY is not set: using the MOCK AI provider. Replies are not real model output.');
  return new MockAiProvider();
}

@Global()
@Module({
  providers: [
    { provide: WORKER_ENV, useFactory: (): WorkerEnv => loadEnv(workerEnvSchema) },
    { provide: WORKER_SETTINGS, useValue: DEFAULT_WORKER_SETTINGS },
    { provide: AI_PROVIDER, inject: [WORKER_ENV], useFactory: aiProviderFactory },
  ],
  exports: [WORKER_ENV, WORKER_SETTINGS, AI_PROVIDER],
})
export class WorkerConfigModule {}
