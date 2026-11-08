import { Injectable, Logger } from '@nestjs/common';
import { PERSONA_CACHE_TTL_SECONDS, personaCacheKey } from '@mini-inbox/contracts';
import { knowledge, persona, tenants, withTenant } from '@mini-inbox/database';
import { PrismaService } from '../infra/prisma.service.js';
import { RedisService } from '../infra/redis.service.js';
import { buildSnapshot, type TenantSnapshot } from './tenant-snapshot.js';

/**
 * Cache of one tenant's persona + knowledge (`t:{<tenantId>}:persona`, 60s TTL; the persona API clears it on save).
 * Isolation:
 * - the key always carries the tenant, built by one helper;
 * - a cached value is used only if its own tenantId matches the requested tenant;
 * - a miss loads only that tenant's rows, through `withTenant`.
 * Redis problems never block a reply: the snapshot is then read from the database.
 */
@Injectable()
export class PersonaCache {
  private readonly logger = new Logger(PersonaCache.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async get(tenantId: string): Promise<TenantSnapshot | null> {
    const key = personaCacheKey(tenantId);
    try {
      const raw = await this.redis.cache.get(key);
      if (raw) {
        const cached = JSON.parse(raw) as TenantSnapshot;
        if (cached.tenantId === tenantId) return cached;
        this.logger.error({ key }, 'cache entry belongs to another tenant; ignored');
      }
    } catch (err) {
      this.logger.warn({ code: (err as NodeJS.ErrnoException).code }, 'persona cache read failed');
    }

    const snapshot = await this.load(tenantId);
    if (snapshot) {
      await this.redis.cache
        .set(key, JSON.stringify(snapshot), 'EX', PERSONA_CACHE_TTL_SECONDS)
        .catch((err: NodeJS.ErrnoException) => this.logger.warn({ code: err.code }, 'persona cache write failed'));
    }
    return snapshot;
  }

  private async load(tenantId: string): Promise<TenantSnapshot | null> {
    const tenant = await tenants.findById(this.prisma.client, tenantId);
    if (!tenant) return null;
    const [p, k] = await withTenant(this.prisma.client, tenantId, (tx) =>
      Promise.all([persona.get(tx, tenantId), knowledge.list(tx, tenantId)]),
    );
    return buildSnapshot(tenant, p, k);
  }
}
