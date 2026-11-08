// Seed tests (workflow/phase-10-plan.md): idempotent, one record per tenant for the shared person, no AI content.
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

  it('seeds customer messages only, as history that is not waiting for a reply', async () => {
    const senders = (await owner.query(`SELECT DISTINCT sender_type, reply_status FROM messages`)).rows;
    expect(senders).toEqual([{ sender_type: 'CUSTOMER', reply_status: null }]);
  });
});
