import type { PrismaClient, Tenant } from '../generated/prisma/client.js';
import { isUuid } from '../with-tenant.js';

/**
 * `tenants` is the global table (not tenant-scoped, no RLS). The app role can only read it.
 * Used by the tenant-header guard to verify that a tenant exists.
 */
export const tenants = {
  /** Returns null for unknown or malformed IDs, so the caller can answer 404 for both. */
  async findById(prisma: PrismaClient, id: string): Promise<Tenant | null> {
    if (!isUuid(id)) return null;
    return prisma.tenant.findUnique({ where: { id } });
  },

  /**
   * Tenant IDs only, for the worker's recovery sweep, which then reads each tenant inside its own tenant context.
   * No tenant data is read here.
   */
  async listIds(prisma: PrismaClient): Promise<string[]> {
    return (await prisma.tenant.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map((t) => t.id);
  },

  /**
   * DEV STAND-IN ONLY: the one cross-tenant read, used by the development tenant picker (`GET /dev/tenants`).
   * IDs and names only. Real staff login replaces the picker.
   */
  async listForDevPicker(prisma: PrismaClient): Promise<{ id: string; name: string }[]> {
    return prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 100 });
  },
};
