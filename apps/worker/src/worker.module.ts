import { Module } from '@nestjs/common';
import { ClsModule, ClsService } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { AiRouter } from './ai/ai-router.js';
import { WORKER_ENV, WorkerConfigModule, type WorkerEnv } from './config/worker-env.js';
import { PrismaService } from './infra/prisma.service.js';
import { RedisService } from './infra/redis.service.js';
import { PersonaCache } from './pipeline/persona-cache.js';
import { ReplyWriter } from './pipeline/reply-writer.js';
import { AiReplyHandler } from './queues/ai-reply.handler.js';
import { InboundMessageHandler } from './queues/inbound-message.handler.js';
import { CLS_JOB_ID, CLS_TENANT_ID } from './queues/job-context.js';
import { QueueWorkers } from './queues/queue-workers.service.js';
import { ReplyQueue } from './queues/reply-queue.service.js';

/**
 * Worker application (no HTTP server). Consumes `inbound-message` (classify) and `ai-reply` (reply).
 * Logs are structured and carry tenantId and jobId from the job's async context, never message content.
 */
@Module({
  imports: [
    ClsModule.forRoot({ global: true }),
    WorkerConfigModule,
    LoggerModule.forRootAsync({
      imports: [WorkerConfigModule],
      inject: [ClsService, WORKER_ENV],
      useFactory: (cls: ClsService, env: WorkerEnv) => ({
        pinoHttp: {
          level: env.NODE_ENV === 'test' ? 'silent' : 'info',
          mixin: () => (cls.isActive() ? { tenantId: cls.get<string | undefined>(CLS_TENANT_ID), jobId: cls.get<string | undefined>(CLS_JOB_ID) } : {}),
          redact: { paths: ['*.body', '*.text', '*.reply', '*.system', '*.from', '*.externalRef', '*.apiKey'], censor: '[redacted]' },
        },
      }),
    }),
  ],
  providers: [
    PrismaService,
    RedisService,
    AiRouter,
    PersonaCache,
    ReplyWriter,
    ReplyQueue,
    InboundMessageHandler,
    AiReplyHandler,
    QueueWorkers,
  ],
})
export class WorkerModule {}
