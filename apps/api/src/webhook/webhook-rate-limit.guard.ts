import { createHash } from 'node:crypto';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
  type OnModuleDestroy,
} from '@nestjs/common';
import { tenantKey } from '@mini-inbox/contracts';
import { Redis } from 'ioredis';
import { API_ENV, type ApiEnv } from '../config/api-env.js';
import { TenantContext } from '../tenant/tenant-context.service.js';

const WINDOW_SECONDS = 60;

interface WebhookRequest {
  body?: { from?: unknown };
}
interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

/**
 * Webhook rate limit: fixed one-minute windows counted in Redis, so the limit holds across several API instances.
 * - per sender within the tenant (WEBHOOK_RATE_PER_SENDER, default 30/min)
 * - per tenant overall (WEBHOOK_RATE_PER_TENANT, default 600/min)
 * Over the limit → 429 with Retry-After. Runs after WebhookTenantGuard, so the tenant is already verified.
 * Keys are tenant-namespaced (`t:{tenantId}:rl:…`) and hold a hash of the sender, never the number itself.
 * If Redis can't answer quickly the request is let through: the enqueue then fails fast with 503 anyway.
 */
@Injectable()
export class WebhookRateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly logger = new Logger(WebhookRateLimitGuard.name);
  private readonly redis: Redis;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly tenantContext: TenantContext,
  ) {
    this.redis = new Redis(env.REDIS_URL, { enableOfflineQueue: false, connectTimeout: 2000, commandTimeout: 500, maxRetriesPerRequest: 0 });
    this.redis.on('error', (err: NodeJS.ErrnoException) => this.logger.warn({ code: err.code }, 'redis connection error'));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const tenantId = this.tenantContext.tenantId();
    const from = context.switchToHttp().getRequest<WebhookRequest>().body?.from;
    const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const keys: [string, number][] = [[tenantKey(tenantId, 'rl', 'webhook', String(window)), this.env.WEBHOOK_RATE_PER_TENANT]];
    // An invalid sender is rejected by validation next; only a string can be counted.
    if (typeof from === 'string') {
      const sender = createHash('sha256').update(from).digest('hex').slice(0, 16);
      keys.push([tenantKey(tenantId, 'rl', 'sender', sender, String(window)), this.env.WEBHOOK_RATE_PER_SENDER]);
    }

    let counts: number[];
    try {
      const multi = this.redis.multi();
      for (const [key] of keys) multi.incr(key).expire(key, WINDOW_SECONDS * 2);
      const results = (await multi.exec()) ?? [];
      counts = keys.map((_, i) => Number(results[i * 2]?.[1] ?? 0));
    } catch (err) {
      this.logger.warn({ code: (err as NodeJS.ErrnoException).code }, 'rate limit check skipped');
      return true;
    }

    if (counts.some((count, i) => count > keys[i]![1])) {
      const retryAfter = WINDOW_SECONDS - (Math.floor(Date.now() / 1000) % WINDOW_SECONDS);
      context.switchToHttp().getResponse<HeaderResponse>().setHeader('Retry-After', String(retryAfter));
      this.logger.warn({ tenantId }, 'webhook rate limit exceeded');
      throw new HttpException('Too many messages, please retry later', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
