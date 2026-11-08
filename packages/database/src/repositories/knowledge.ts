import type { KnowledgeEntry } from '../generated/prisma/client.js';
import type { TenantTx } from '../with-tenant.js';

export const KNOWLEDGE_PAGE_MAX = 100;

/** Knowledge entries are saved with the persona (replace-all), never one by one. */
export const knowledge = {
  async findById(tx: TenantTx, tenantId: string, id: string): Promise<KnowledgeEntry | null> {
    return tx.knowledgeEntry.findUnique({ where: { tenantId_id: { tenantId, id } } });
  },

  async list(tx: TenantTx, tenantId: string, { take = KNOWLEDGE_PAGE_MAX }: { take?: number } = {}): Promise<KnowledgeEntry[]> {
    return tx.knowledgeEntry.findMany({
      where: { tenantId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: Math.min(Math.max(take, 1), KNOWLEDGE_PAGE_MAX),
    });
  },

  /** Replaces this tenant's whole knowledge list (part of the persona save, same transaction). */
  async replaceAll(
    tx: TenantTx,
    tenantId: string,
    entries: { titleEn: string; titleAr: string; contentEn: string; contentAr: string }[],
  ): Promise<number> {
    await tx.knowledgeEntry.deleteMany({ where: { tenantId } });
    if (entries.length === 0) return 0;
    const { count } = await tx.knowledgeEntry.createMany({ data: entries.map((e) => ({ tenantId, ...e })) });
    return count;
  },
};
