import { Inject, Injectable, Logger, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import {
  INBOUND_MESSAGE_JOB,
  INBOUND_MESSAGE_JOB_OPTIONS,
  INBOUND_MESSAGE_QUEUE,
  inboundMessageJobId,
  inboundMessageJobSchema,
  type InboundMessageJob,
} from '@mini-inbox/contracts';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { API_ENV, type ApiEnv } from '../config/api-env.js';

/** Upper bound for one enqueue, so an unavailable Redis fails the webhook fast (503) instead of hanging. */
const ENQUEUE_TIMEOUT_MS = 3000;

/**
 * Producer for the FIFO `inbound-message` queue. Uses its own Redis connection tuned to fail fast:
 * no offline queue (commands fail at once while disconnected), short connect/command timeouts, no per-command
 * retries. ioredis keeps reconnecting in the background, so enqueueing works again once Redis is back.
 */
@Injectable()
export class InboundMessageProducer implements OnModuleDestroy {
  private readonly logger = new Logger(InboundMessageProducer.name);
  private readonly connection: Redis;
  private readonly queue: Queue<InboundMessageJob>;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.connection = new Redis(env.REDIS_URL, {
      enableOfflineQueue: false,
      connectTimeout: 2000,
      commandTimeout: 2000,
      maxRetriesPerRequest: 0,
    });
    // Without a listener, ioredis reports connection errors as unhandled. Log the code only.
    this.connection.on('error', (err: NodeJS.ErrnoException) => this.logger.warn({ code: err.code }, 'redis connection error'));
    this.queue = new Queue<InboundMessageJob>(INBOUND_MESSAGE_QUEUE, { connection: this.connection, prefix: env.QUEUE_PREFIX });
    this.queue.on('error', (err: NodeJS.ErrnoException) => this.logger.warn({ code: err.code }, 'queue error'));
  }

  /**
   * Adds the job and resolves once Redis has stored it. Re-adding an existing job ID is a no-op, which makes
   * duplicate webhook deliveries safe. Throws 503 if Redis is unavailable.
   */
  async enqueue(job: InboundMessageJob): Promise<void> {
    const data = inboundMessageJobSchema.parse(job);
    const jobId = inboundMessageJobId(data.tenantId, data.messageId);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.queue.add(INBOUND_MESSAGE_JOB, data, { ...INBOUND_MESSAGE_JOB_OPTIONS, jobId }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('enqueue timed out'), { code: 'ETIMEDOUT' })), ENQUEUE_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      this.logger.warn(
        { messageId: data.messageId, conversationId: data.conversationId, code: (err as NodeJS.ErrnoException).code },
        'enqueue failed',
      );
      throw new ServiceUnavailableException();
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close().catch(() => undefined);
    this.connection.disconnect();
  }
}
