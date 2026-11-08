import type { Mode } from './generated/prisma/enums.js';
import type { TenantTx } from './with-tenant.js';

export interface LockedConversation {
  id: string;
  mode: Mode;
}

/**
 * D-002 critical section, step 1: lock the conversation row, scoped by tenant, and return its current mode.
 * Must run inside `withTenant`. The lock is released at commit or rollback. Waits are bounded by the
 * transaction's lock_timeout. Returns null if the conversation doesn't exist in this tenant.
 */
export async function lockConversation(
  tx: TenantTx,
  tenantId: string,
  conversationId: string,
): Promise<LockedConversation | null> {
  const rows = await tx.$queryRaw<LockedConversation[]>`
    SELECT id, mode FROM conversations
    WHERE tenant_id = ${tenantId}::uuid AND id = ${conversationId}::uuid
    FOR UPDATE`;
  return rows[0] ?? null;
}
