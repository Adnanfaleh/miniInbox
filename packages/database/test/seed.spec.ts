// Seed tests (workflow/phase-10-plan.md): idempotent, one record per tenant for the shared person, no AI content,
// the last customer message per conversation queued once and never re-queued after the worker settles it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../src/client.js';
import { SEED_TENANTS, SHARED_PERSON, seed } from '../src/seed.js';
import { TENANT_TABLES, app, owner, resetDatabase } from './db.js';

const ownerPrisma = createPrismaClient(process.env.TEST_MIGRATION_DATABASE_URL!);

beforeAll(async () => {
  await resetDatabase();
});
afterAll(async () => {
  await ownerPrisma.$disconnect();
  await app.end();
  await owner.end();
});

const counts = async () => {
  const out: Record<string, number> = {};
  for (const t of ['tenants', ...TENANT_TABLES]) out[t] = Number((await owner.query(`SELECT count(*) FROM "${t}"`)).rows[0].count);
  return out;
};

describe('seed', () => {
  it('is idempotent: a second run changes no row counts', async () => {
    await seed(ownerPrisma);
    const first = await counts();
    await seed(ownerPrisma);
    expect(await counts()).toEqual(first);
    expect(first).toMatchObject({ tenants: 2, persona_configs: 2, customers: 4, conversations: 4, messages: 5, conversation_events: 0 });
  });

  it('gives the person who messages both tenants two different random customer IDs, one per tenant', async () => {
    const rows = (await owner.query(`SELECT id, tenant_id FROM customers WHERE external_ref = $1 ORDER BY tenant_id`, [SHARED_PERSON])).rows;
    expect(rows.map((r) => r.tenant_id)).toEqual([SEED_TENANTS.coffee, SEED_TENANTS.clinic]);
    expect(rows[0].id).not.toBe(rows[1].id);
    for (const r of rows) expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('seeds different personas, knowledge and time zones per tenant', async () => {
    const tenants = (await owner.query(`SELECT id, time_zone FROM tenants ORDER BY id`)).rows;
    expect(tenants.map((t) => t.time_zone)).toEqual(['Asia/Riyadh', 'Europe/London']);
    const personas = (await owner.query(`SELECT tenant_id, reply_type, language_preference FROM persona_configs ORDER BY tenant_id`)).rows;
    expect(personas).toEqual([
      { tenant_id: SEED_TENANTS.coffee, reply_type: 'friendly', language_preference: 'match_customer' },
      { tenant_id: SEED_TENANTS.clinic, reply_type: 'professional', language_preference: 'en' },
    ]);
    const kb = (await owner.query(`SELECT tenant_id, count(*)::int AS n FROM knowledge_entries GROUP BY tenant_id ORDER BY tenant_id`)).rows;
    expect(kb).toEqual([
      { tenant_id: SEED_TENANTS.coffee, n: 4 },
      { tenant_id: SEED_TENANTS.clinic, n: 4 },
    ]);
  });

  it('seeds customer messages only; the last one per conversation waits for the worker, earlier ones are history', async () => {
    const senders = (await owner.query(`SELECT DISTINCT sender_type FROM messages`)).rows;
    expect(senders).toEqual([{ sender_type: 'CUSTOMER' }]);
    const rows = (
      await owner.query(
        `SELECT conversation_id, reply_status,
                created_at = max(created_at) OVER (PARTITION BY conversation_id) AS is_last
           FROM messages`,
      )
    ).rows;
    for (const r of rows) expect(r.reply_status).toBe(r.is_last ? 'PENDING' : null);
    expect(rows.filter((r) => r.reply_status === 'PENDING')).toHaveLength(4);
  });

  it('returns exactly the pending messages to queue, with tenant-matching IDs, and the same IDs on a re-run', async () => {
    const pendingRows = (await owner.query(`SELECT tenant_id, conversation_id, id FROM messages WHERE reply_status = 'PENDING'`)).rows;
    const expected = pendingRows.map((r) => ({ tenantId: r.tenant_id, conversationId: r.conversation_id, messageId: r.id }));
    const sort = (a: { messageId: string }, b: { messageId: string }) => a.messageId.localeCompare(b.messageId);
    const { pending } = await seed(ownerPrisma);
    expect([...pending].sort(sort)).toEqual([...expected].sort(sort));
    expect([...(await seed(ownerPrisma)).pending].sort(sort)).toEqual([...expected].sort(sort));
  });

  it('never re-queues a message the worker already settled', async () => {
    const settled = (await owner.query(`SELECT id FROM messages WHERE reply_status = 'PENDING' ORDER BY id LIMIT 2`)).rows;
    await owner.query(`UPDATE messages SET reply_status = 'REPLIED' WHERE id = $1`, [settled[0].id]);
    await owner.query(`UPDATE messages SET reply_status = 'SKIPPED' WHERE id = $1`, [settled[1].id]);
    const { pending } = await seed(ownerPrisma);
    const ids = pending.map((p) => p.messageId);
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain(settled[0].id);
    expect(ids).not.toContain(settled[1].id);
    const after = (await owner.query(`SELECT reply_status FROM messages WHERE id = ANY($1::uuid[]) ORDER BY id`, [settled.map((s) => s.id)])).rows;
    expect(after.map((r) => r.reply_status)).toEqual(['REPLIED', 'SKIPPED']);
  });

  it('upgrades a database seeded before queueing: a never-queued last message becomes pending', async () => {
    await resetDatabase();
    await seed(ownerPrisma);
    await owner.query(`UPDATE messages SET reply_status = NULL`);
    const { pending } = await seed(ownerPrisma);
    expect(pending).toHaveLength(4);
    const statuses = (await owner.query(`SELECT reply_status, count(*)::int AS n FROM messages GROUP BY reply_status ORDER BY reply_status`)).rows;
    expect(statuses).toEqual([
      { reply_status: 'PENDING', n: 4 },
      { reply_status: null, n: 1 },
    ]);
  });
});
