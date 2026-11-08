import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@mini-inbox/database';
import { WORKER_ENV, type WorkerEnv } from '../config/worker-env.js';

/**
 * Prisma client connected as app_user (row-level security applies). Tenant data is always read through
 * `withTenant(client, job.data.tenantId, ...)`, so every query runs in the job's tenant context.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(WORKER_ENV) env: WorkerEnv) {
    this.client = createPrismaClient(env.DATABASE_URL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
