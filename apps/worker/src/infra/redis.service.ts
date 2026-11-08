import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { WORKER_ENV, type WorkerEnv } from '../config/worker-env.js';

/**
 * Redis connections for the worker. BullMQ workers need `maxRetriesPerRequest: null` (they block on Redis and
 * must survive reconnects); each queue/worker gets its own connection from `create()`. `cache` is a separate
 * client for tenant-namespaced cache keys.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly connections: Redis[] = [];
  readonly cache: Redis;

  constructor(@Inject(WORKER_ENV) private readonly env: WorkerEnv) {
    this.cache = this.create();
  }

  create(): Redis {
    const connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    connection.on('error', (err: NodeJS.ErrnoException) => this.logger.warn({ code: err.code }, 'redis connection error'));
    this.connections.push(connection);
    return connection;
  }

  get prefix(): string {
    return this.env.QUEUE_PREFIX;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.connections.map((c) => c.quit().catch(() => c.disconnect())));
  }
}
