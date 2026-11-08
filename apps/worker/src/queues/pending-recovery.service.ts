import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  INBOUND_MESSAGE_JOB,
  INBOUND_MESSAGE_JOB_OPTIONS,
  INBOUND_MESSAGE_QUEUE,
  aiReplyJobId,
  inboundMessageJobId,
  type InboundMessageJob,
} from '@mini-inbox/contracts';
import { messages, tenants, withTenant } from '@mini-inbox/database';
import { Queue, type Job } from 'bullmq';
import { WORKER_SETTINGS, type WorkerSettings } from '../config/worker-env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RedisService } from '../infra/redis.service.js';
import { ReplyQueue } from './reply-queue.service.js';

/** Job states that mean "still being handled": the message is not lost. */
const LIVE_STATES = new Set(['waiting', 'delayed', 'active', 'prioritized', 'waiting-children']);

/**
 * Recovery sweep for messages whose queue job was lost.
 *
 * A message is stored before it is queued. If the enqueue fails (Redis down → 503) and the channel never retries,
 * or Redis loses its data, the message stays PENDING with no job. Nothing would ever answer it, and every later
 * message in that conversation would wait behind it (arrival order). This sweep finds PENDING customer messages
 * older than `recoverAfterMs` that have no live job in either queue, and queues them again with the same job ID.
 *
 * Runs per tenant inside that tenant's context (RLS). Logs IDs only.
 */
@Injectable()
export class PendingRecovery implements OnModuleDestroy {
  private readonly logger = new Logger(PendingRecovery.name);
  private readonly inboundQueue: Queue<InboundMessageJob>;

  constructor(
    redis: RedisService,
    private readonly replyQueue: ReplyQueue,
    private readonly prisma: PrismaService,
    @Inject(WORKER_SETTINGS) private readonly settings: WorkerSettings,
  ) {
    this.inboundQueue = new Queue<InboundMessageJob>(INBOUND_MESSAGE_QUEUE, { connection: redis.create(), prefix: redis.prefix });
  }

  /** Re-queues lost messages. Returns how many were queued again. */
  async sweep(now: number = Date.now()): Promise<number> {
    const olderThan = new Date(now - this.settings.recoverAfterMs);
    let recovered = 0;
    for (const tenantId of await tenants.listIds(this.prisma.client)) {
      const stale = await withTenant(this.prisma.client, tenantId, (tx) => messages.listStalePending(tx, tenantId, olderThan));
      for (const m of stale) {
        if (await this.requeueIfLost({ tenantId, conversationId: m.conversationId, messageId: m.id })) recovered++;
      }
    }
    if (recovered > 0) this.logger.warn({ recovered }, 'lost pending messages queued again');
    return recovered;
  }

  private async requeueIfLost(job: InboundMessageJob): Promise<boolean> {
    const inboundId = inboundMessageJobId(job.tenantId, job.messageId);
    const existing = [await this.inboundQueue.getJob(inboundId), await this.replyQueue.queue.getJob(aiReplyJobId(job.tenantId, job.messageId))].filter(
      (j): j is Job => Boolean(j),
    );
    const states = await Promise.all(existing.map((j) => j.getState()));
    if (states.some((s) => LIVE_STATES.has(s))) return false;
    // Finished job records with this ID would make the new add a no-op, so clear them first.
    await Promise.all(existing.map((j) => j.remove().catch(() => undefined)));
    await this.inboundQueue.add(INBOUND_MESSAGE_JOB, job, { ...INBOUND_MESSAGE_JOB_OPTIONS, jobId: inboundId });
    this.logger.warn({ tenantId: job.tenantId, conversationId: job.conversationId, messageId: job.messageId }, 'lost pending message queued again');
    return true;
  }

  async onModuleDestroy(): Promise<void> {
    await this.inboundQueue.close().catch(() => undefined);
  }
}
