import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { personaCacheKey } from '@mini-inbox/contracts';
import { Redis } from 'ioredis';
import { API_ENV, type ApiEnv } from '../config/api-env.js';

/**
 * Clears one tenant's persona cache entry after a persona save, so the next AI reply uses the new settings.
 * The key always carries the tenant (`t:{<tenantId>}:persona`). If Redis is unavailable the save still succeeds
 * and a warning is logged; the stale entry expires within its 60-second TTL (applicant decision).
 */
@Injectable()
export class PersonaCacheInvalidator implements OnModuleDestroy {
  private readonly logger = new Logger(PersonaCacheInvalidator.name);
  private readonly redis: Redis;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.redis = new Redis(env.REDIS_URL, { enableOfflineQueue: false, connectTimeout: 2000, commandTimeout: 2000, maxRetriesPerRequest: 0 });
    this.redis.on('error', (err: NodeJS.ErrnoException) => this.logger.warn({ code: err.code }, 'redis connection error'));
  }

  async invalidate(tenantId: string): Promise<boolean> {
    try {
      await this.redis.del(personaCacheKey(tenantId));
      return true;
    } catch (err) {
      this.logger.warn({ code: (err as NodeJS.ErrnoException).code }, 'persona cache not cleared; it expires within 60s');
      return false;
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
