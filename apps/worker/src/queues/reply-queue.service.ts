import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { AI_REPLY_JOB, AI_REPLY_QUEUE, REPLY_PRIORITY, aiReplyJobId, aiReplyJobSchema, type AiReplyJob } from '@mini-inbox/contracts';
import { Queue } from 'bullmq';
import { WORKER_SETTINGS, type WorkerSettings } from '../config/worker-env.js';
import { RedisService } from '../infra/redis.service.js';

/**
 * Producer for the `ai-reply` priority queue, plus priority aging.
 * Priority: 1 = simple (and out-of-hours notices), 2 = complex. BullMQ runs lower numbers first, FIFO within one.
 * Aging: a complex job waiting longer than `agingAfterMs` is raised to priority 1, so it can't starve.
 */
@Injectable()
export class ReplyQueue implements OnModuleDestroy {
  private readonly logger = new Logger(ReplyQueue.name);
  readonly queue: Queue<AiReplyJob>;

  constructor(
    redis: RedisService,
    @Inject(WORKER_SETTINGS) private readonly settings: WorkerSettings,
  ) {
    this.queue = new Queue<AiReplyJob>(AI_REPLY_QUEUE, { connection: redis.create(), prefix: redis.prefix });
  }

  async add(job: AiReplyJob, priority: number): Promise<void> {
    const data = aiReplyJobSchema.parse(job);
    await this.queue.add(AI_REPLY_JOB, data, {
      jobId: aiReplyJobId(data.tenantId, data.messageId),
      priority,
      attempts: this.settings.replyAttempts,
      backoff: { type: 'exponential', delay: this.settings.replyBackoffMs },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });
  }

  /** Raises complex jobs that have waited too long. Returns how many were promoted. */
  async promoteAged(now: number = Date.now()): Promise<number> {
    const waiting = await this.queue.getJobs(['prioritized'], 0, 999);
    let promoted = 0;
    for (const job of waiting) {
      if (job.priority === REPLY_PRIORITY.complex && now - job.timestamp >= this.settings.agingAfterMs) {
        await job.changePriority({ priority: REPLY_PRIORITY.simple }).catch(() => undefined);
        promoted++;
      }
    }
    if (promoted > 0) this.logger.log({ promoted }, 'aged complex replies promoted');
    return promoted;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close().catch(() => undefined);
  }
}
