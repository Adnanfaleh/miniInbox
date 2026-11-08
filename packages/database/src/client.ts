import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

/**
 * Creates a Prisma client over the pg driver adapter (Prisma 7).
 *
 * The API and worker pass DATABASE_URL (app_user), so row-level security applies to every query.
 * Tenant-scoped access goes through `withTenant()` (Phase 3), which sets `app.tenant_id` per transaction.
 * Without that context, tenant tables return no rows (fails closed).
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  if (!connectionString) throw new Error('createPrismaClient: connection string is required');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
