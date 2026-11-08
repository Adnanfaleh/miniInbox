import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@mini-inbox/database';
import { API_ENV, type ApiEnv } from '../config/api-env.js';

/**
 * The Prisma client, connected as app_user (DATABASE_URL), so row-level security applies.
 * Feature code must not query tenant tables through `client` directly: use `TenantDb.run()`.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.client = createPrismaClient(env.DATABASE_URL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
