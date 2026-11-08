import type { Prisma, PrismaClient } from './generated/prisma/client.js';
import { InvalidTenantIdError } from './errors.js';

/** A transaction client that already has the tenant context set. Only `withTenant` creates one. */
export type TenantTx = Prisma.TransactionClient;

export interface WithTenantOptions {
  /** How long to wait for a row lock before failing (D-002: bounded lock waits). Default 2000 ms. */
  lockTimeoutMs?: number;
  /** Upper bound for any single statement. Default 5000 ms. */
  statementTimeoutMs?: number;
  /** Upper bound for the whole transaction, enforced by Prisma. Default 10000 ms. */
  transactionTimeoutMs?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * The single entry point for tenant data (CLAUDE.md section 4.3).
 *
 * Opens one short interactive transaction, sets `app.tenant_id` transaction-locally (so a pooled connection
 * can never carry it into another tenant's transaction), bounds lock and statement time, then runs `fn`.
 * Row-level security uses `app.tenant_id` as the backstop. Repositories still filter by `tenantId` explicitly.
 *
 * Never call a model or any network service inside `fn`: the transaction holds a connection and maybe a row lock.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
  options: WithTenantOptions = {},
): Promise<T> {
  if (!isUuid(tenantId)) throw new InvalidTenantIdError();
  const lockTimeout = `${options.lockTimeoutMs ?? 2000}ms`;
  const statementTimeout = `${options.statementTimeoutMs ?? 5000}ms`;
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT
        set_config('app.tenant_id', ${tenantId}, true),
        set_config('lock_timeout', ${lockTimeout}, true),
        set_config('statement_timeout', ${statementTimeout}, true)`;
      return fn(tx);
    },
    { maxWait: 5000, timeout: options.transactionTimeoutMs ?? 10_000 },
  );
}
