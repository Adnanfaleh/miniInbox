import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { AI_REPLY_QUEUE, INBOUND_MESSAGE_QUEUE, inboundMessageJobSchema } from '@mini-inbox/contracts';
import { messages, withTenant } from '@mini-inbox/database';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { WORKER_ENV, WORKER_SETTINGS, type WorkerEnv, type WorkerSettings } from '../config/worker-env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RedisService } from '../infra/redis.service.js';
import { AiReplyHandler } from './ai-reply.handler.js';
import { InboundMessageHandler } from './inbound-message.handler.js';
import { CLS_JOB_ID, CLS_TENANT_ID } from './job-context.js';
import { PendingRecovery } from './pending-recovery.service.js';
import { ReplyQueue } from './reply-queue.service.js';

/**
 * Runs the two consumers, the aging sweep, the recovery sweep for lost messages, and final-failure handling.
 * - Each job runs inside its own async context carrying tenantId and jobId, so every log line has them.
 * - A job that fails for good marks its message FAILED, so later messages in that conversation aren't blocked.
 * - Shutdown (SIGTERM/SIGINT via Nest shutdown hooks) waits for running jobs, then closes connections.
 */
@Injectable()
export class QueueWorkers implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QueueWorkers.name);
  private readonly workers: Worker[] = [];
  private agingTimer?: NodeJS.Timeout;
  private recoveryTimer?: NodeJS.Timeout;

  constructor(
    private readonly inbound: InboundMessageHandler,
    private readonly reply: AiReplyHandler,
    private readonly replyQueue: ReplyQueue,
    private readonly recovery: PendingRecovery,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly cls: ClsService,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(WORKER_SETTINGS) private readonly settings: WorkerSettings,
  ) {}

  onApplicationBootstrap(): void {
    if (this.settings.autorun) this.start();
  }

  /** Starts both consumers and the aging sweep. Called on boot, or by tests. */
  start(): void {
    if (this.workers.length > 0) return;
    const common = { prefix: this.redis.prefix, concurrency: this.env.WORKER_CONCURRENCY };
    this.workers.push(
      this.consume(INBOUND_MESSAGE_QUEUE, (job) => this.inbound.handle(job), common),
      this.consume(AI_REPLY_QUEUE, (job, token) => this.reply.handle(job, token), common),
    );
    this.agingTimer = setInterval(() => {
      this.replyQueue.promoteAged().catch((err: Error) => this.logger.warn({ error: err.name }, 'aging sweep failed'));
    }, this.settings.agingSweepMs);
    const recover = () => this.recovery.sweep().catch((err: Error) => this.logger.warn({ error: err.name }, 'recovery sweep failed'));
    void recover();
    this.recoveryTimer = setInterval(() => void recover(), this.settings.recoverySweepMs);
    this.logger.log({ concurrency: this.env.WORKER_CONCURRENCY }, 'queue consumers started');
  }

  private consume(
    queueName: string,
    handler: (job: Job, token?: string) => Promise<unknown>,
    options: { prefix: string; concurrency: number },
  ): Worker {
    const worker = new Worker(
      queueName,
      (job, token) =>
        this.cls.run(() => {
          // Context for logs only; the handler still takes the tenant from the validated payload.
          const tenantId = (job.data as { tenantId?: unknown })?.tenantId;
          this.cls.set(CLS_TENANT_ID, typeof tenantId === 'string' ? tenantId : undefined);
          this.cls.set(CLS_JOB_ID, job.id);
          return handler(job, token);
        }),
      { connection: this.redis.create(), ...options },
    );
    worker.on('failed', (job, err) => void this.onFailed(queueName, job, err));
    worker.on('stalled', (jobId) => this.logger.warn({ queue: queueName, jobId }, 'job stalled'));
    worker.on('error', (err) => this.logger.error({ queue: queueName, error: err.name }, 'worker error'));
    return worker;
  }

  /** Error names and codes only: error messages from libraries can echo data. */
  private async onFailed(queueName: string, job: Job | undefined, err: Error): Promise<void> {
    if (!job) return;
    const final = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.warn(
      { queue: queueName, jobId: job.id, attemptsMade: job.attemptsMade, final, error: err.name, code: (err as NodeJS.ErrnoException).code },
      'job failed',
    );
    if (!final) return;
    const parsed = inboundMessageJobSchema.safeParse(job.data);
    if (!parsed.success) return;
    const { tenantId, messageId } = parsed.data;
    try {
      await withTenant(this.prisma.client, tenantId, (tx) => messages.settle(tx, tenantId, messageId, 'FAILED'));
    } catch (e) {
      this.logger.error({ jobId: job.id, error: (e as Error).name }, 'could not mark message FAILED');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.agingTimer) clearInterval(this.agingTimer);
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    await Promise.all(this.workers.map((w) => w.close()));
    this.workers.length = 0;
  }
}
