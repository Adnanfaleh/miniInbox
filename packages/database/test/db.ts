// Test helpers for database-level isolation tests. Runs against mini_inbox_test only.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

function requireTestUrl(name: string): string {
  const url = process.env[name];
  if (!url) throw new Error(`${name} is not set (see .env.example)`);
  // Guard: these tests truncate tables, so never point them at the development database.
  if (!new URL(url).pathname.endsWith('_test')) throw new Error(`${name} must point at a *_test database`);
  return url;
}

export const TEST_DATABASE_URL = requireTestUrl('TEST_DATABASE_URL');

/** Owner role (superuser, bypasses RLS). Used only to arrange fixtures and to check what really changed. */
export const owner = new pg.Pool({ connectionString: requireTestUrl('TEST_MIGRATION_DATABASE_URL'), max: 2 });

/**
 * app_user, as the API and worker connect. max: 1 forces connection reuse, so the tests also cover a pooled
 * connection that carried another tenant's context in an earlier transaction.
 */
export const app = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });

export const TENANT_TABLES = [
  'persona_configs',
  'knowledge_entries',
  'customers',
  'conversations',
  'messages',
  'conversation_events',
] as const;

/** Runs `fn` as app_user inside one transaction with app.tenant_id set transaction-locally, then rolls back or commits. */
export async function asTenant<T>(
  tenantId: string | null,
  fn: (c: pg.PoolClient) => Promise<T>,
  { commit = true }: { commit?: boolean } = {},
): Promise<T> {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const result = await fn(c);
    await c.query(commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

/** Expects `promise` to reject with the given Postgres SQLSTATE code. */
export async function expectPgError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const actual = (err as { code?: string }).code;
    if (actual === code) return;
    throw new Error(`expected SQLSTATE ${code}, got ${actual ?? 'none'}: ${(err as Error).message}`);
  }
  throw new Error(`expected SQLSTATE ${code}, but the statement succeeded`);
}

export interface TenantFixture {
  tenantId: string;
  customerId: string;
  conversationId: string;
  messageId: string;
  knowledgeId: string;
  eventId: string;
}

export async function resetDatabase(): Promise<void> {
  await owner.query(`TRUNCATE ${['tenants', ...TENANT_TABLES].map((t) => `"${t}"`).join(', ')} CASCADE`);
}

/** Creates one tenant with one row in every tenant table, as the owner. `marker` tags the text columns. */
export async function createTenantFixture(marker: string, externalRef: string): Promise<TenantFixture> {
  const q = async (sql: string, params: unknown[]) => (await owner.query<{ id: string }>(sql, params)).rows[0]!.id;
  const tenantId = await q(`INSERT INTO tenants (name, time_zone) VALUES ($1, 'Asia/Riyadh') RETURNING id`, [
    `tenant-${marker}`,
  ]);
  await owner.query(
    `INSERT INTO persona_configs (tenant_id, tone, language_preference, reply_type, reply_max_length,
       business_instructions, out_of_kb_message_en, out_of_kb_message_ar, out_of_hours_message_en,
       out_of_hours_message_ar, working_days, work_start, work_end, updated_at)
     VALUES ($1, $2::text, 'en', 'short_answer', 300, $2::text, $2::text, $2::text, $2::text, $2::text, 'MON-FRI', '09:00', '17:00', now())`,
    [tenantId, `persona-${marker}`],
  );
  const knowledgeId = await q(
    `INSERT INTO knowledge_entries (tenant_id, title_en, title_ar, content_en, content_ar, updated_at)
     VALUES ($1, $2::text, $2::text, $2::text, $2::text, now()) RETURNING id`,
    [tenantId, `kb-${marker}`],
  );
  const customerId = await q(`INSERT INTO customers (tenant_id, external_ref) VALUES ($1, $2) RETURNING id`, [
    tenantId,
    externalRef,
  ]);
  const conversationId = await q(
    `INSERT INTO conversations (tenant_id, customer_id) VALUES ($1, $2) RETURNING id`,
    [tenantId, customerId],
  );
  const messageId = await q(
    `INSERT INTO messages (tenant_id, conversation_id, sender_type, external_id, body)
     VALUES ($1, $2, 'CUSTOMER', $3, $4) RETURNING id`,
    [tenantId, conversationId, `ext-${marker}`, `body-${marker}`],
  );
  const eventId = await q(
    `INSERT INTO conversation_events (tenant_id, conversation_id, event_type, message_id)
     VALUES ($1, $2, 'TAKEOVER', $3) RETURNING id`,
    [tenantId, conversationId, messageId],
  );
  return { tenantId, customerId, conversationId, messageId, knowledgeId, eventId };
}

/** Snapshot of one tenant's rows in every tenant table, read as the owner (bypasses RLS). */
export async function snapshot(tenantId: string): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of TENANT_TABLES) {
    out[t] = (await owner.query(`SELECT * FROM "${t}" WHERE tenant_id = $1 ORDER BY 1`, [tenantId])).rows;
  }
  return out;
}
