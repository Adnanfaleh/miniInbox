// Database-level tenant-isolation tests (CLAUDE.md section 10; workflow/phase-2-plan.md).
// These prove the backstop: row-level security, composite FKs and per-tenant unique keys, as app_user.
// App-level scoping (every query filtered by tenant_id) is tested from Phase 3 on.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../src/client.js';
import {
  TENANT_TABLES,
  TEST_DATABASE_URL,
  app,
  asTenant,
  createTenantFixture,
  expectPgError,
  owner,
  resetDatabase,
  snapshot,
  type TenantFixture,
} from './db.js';

const RLS_VIOLATION = '42501'; // insufficient_privilege: also raised for "new row violates row-level security policy"
const FK_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';
const SAME_PERSON = 'whatsapp:+966500000001';

let A: TenantFixture;
let B: TenantFixture;

beforeEach(async () => {
  await resetDatabase();
  // The same real person messages both tenants (D-001).
  A = await createTenantFixture('A', SAME_PERSON);
  B = await createTenantFixture('B', SAME_PERSON);
});

afterAll(async () => {
  await app.end();
  await owner.end();
});

describe('RLS: reads', () => {
  it.each(TENANT_TABLES)('%s: tenant B sees only its own rows, even with no tenant filter', async (table) => {
    const rows = await asTenant(B.tenantId, async (c) => (await c.query(`SELECT tenant_id FROM "${table}"`)).rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant_id === B.tenantId)).toBe(true);
  });

  it.each(TENANT_TABLES)('%s: tenant B reading A\'s rows by tenant_id gets nothing', async (table) => {
    const { rowCount } = await asTenant(B.tenantId, (c) =>
      c.query(`SELECT 1 FROM "${table}" WHERE tenant_id = $1`, [A.tenantId]),
    );
    expect(rowCount).toBe(0);
  });

  it('tenant B cannot read A\'s message by ID', async () => {
    const { rowCount } = await asTenant(B.tenantId, (c) => c.query(`SELECT body FROM messages WHERE id = $1`, [A.messageId]));
    expect(rowCount).toBe(0);
  });
});

describe('RLS: missing context fails closed', () => {
  it.each(TENANT_TABLES)('%s: no tenant context returns 0 rows without an error', async (table) => {
    const { rowCount } = await asTenant(null, (c) => c.query(`SELECT 1 FROM "${table}"`));
    expect(rowCount).toBe(0);
  });

  it('a pooled connection that carried tenant A in an earlier transaction sees nothing afterwards', async () => {
    await asTenant(A.tenantId, (c) => c.query('SELECT 1 FROM customers'));
    // Same physical connection (pool max 1). The setting now reads back as '' rather than NULL.
    const setting = await asTenant(null, async (c) => (await c.query(`SELECT current_setting('app.tenant_id', true) AS v`)).rows[0].v);
    expect(setting).toBe('');
    for (const table of TENANT_TABLES) {
      const { rowCount } = await asTenant(null, (c) => c.query(`SELECT 1 FROM "${table}"`));
      expect(rowCount, table).toBe(0);
    }
  });
});

describe('RLS: writes', () => {
  it('tenant B cannot insert a row stamped with A\'s tenant_id (WITH CHECK)', async () => {
    await expectPgError(
      asTenant(B.tenantId, (c) => c.query(`INSERT INTO customers (tenant_id, external_ref) VALUES ($1, 'intruder')`, [A.tenantId])),
      RLS_VIOLATION,
    );
    await expectPgError(
      asTenant(B.tenantId, (c) =>
        c.query(`INSERT INTO messages (tenant_id, conversation_id, sender_type, body) VALUES ($1, $2, 'HUMAN', 'x')`, [
          A.tenantId,
          A.conversationId,
        ]),
      ),
      RLS_VIOLATION,
    );
  });

  it('tenant B cannot update or delete A\'s rows, and A\'s data is unchanged', async () => {
    const before = await snapshot(A.tenantId);
    await asTenant(B.tenantId, async (c) => {
      for (const table of TENANT_TABLES) {
        const upd = await c.query(`UPDATE "${table}" SET tenant_id = tenant_id WHERE tenant_id = $1`, [A.tenantId]);
        expect(upd.rowCount, `update ${table}`).toBe(0);
      }
      expect((await c.query(`UPDATE conversations SET mode = 'HUMAN' WHERE id = $1`, [A.conversationId])).rowCount).toBe(0);
      // Children first, so FK restrictions are not what stops the delete.
      for (const table of [...TENANT_TABLES].reverse()) {
        const del = await c.query(`DELETE FROM "${table}" WHERE tenant_id = $1`, [A.tenantId]);
        expect(del.rowCount, `delete ${table}`).toBe(0);
      }
    });
    expect(await snapshot(A.tenantId)).toEqual(before);
  });

  it('tenant B cannot move its own row into tenant A', async () => {
    await expectPgError(
      asTenant(B.tenantId, (c) => c.query(`UPDATE knowledge_entries SET tenant_id = $1 WHERE id = $2`, [A.tenantId, B.knowledgeId])),
      RLS_VIOLATION,
    );
  });
});

describe('Composite foreign keys reject cross-tenant links', () => {
  it('a message under tenant A pointing at B\'s conversation is rejected, even for the owner', async () => {
    await expectPgError(
      owner.query(`INSERT INTO messages (tenant_id, conversation_id, sender_type, body) VALUES ($1, $2, 'CUSTOMER', 'x')`, [
        A.tenantId,
        B.conversationId,
      ]),
      FK_VIOLATION,
    );
    await expectPgError(
      asTenant(A.tenantId, (c) =>
        c.query(`INSERT INTO messages (tenant_id, conversation_id, sender_type, body) VALUES ($1, $2, 'CUSTOMER', 'x')`, [
          A.tenantId,
          B.conversationId,
        ]),
      ),
      FK_VIOLATION,
    );
  });

  it('a conversation under tenant A pointing at B\'s customer is rejected', async () => {
    await expectPgError(
      owner.query(`INSERT INTO conversations (tenant_id, customer_id) VALUES ($1, $2)`, [A.tenantId, B.customerId]),
      FK_VIOLATION,
    );
  });

  it('an event under tenant A pointing at B\'s message is rejected (D-011)', async () => {
    await expectPgError(
      owner.query(`INSERT INTO conversation_events (tenant_id, conversation_id, event_type, message_id) VALUES ($1, $2, 'AI_REPLY_SENT', $3)`, [
        A.tenantId,
        A.conversationId,
        B.messageId,
      ]),
      FK_VIOLATION,
    );
  });

  it('a reply under tenant A to B\'s message is rejected (D-014)', async () => {
    await expectPgError(
      owner.query(
        `INSERT INTO messages (tenant_id, conversation_id, sender_type, body, in_reply_to_message_id) VALUES ($1, $2, 'AI', 'x', $3)`,
        [A.tenantId, A.conversationId, B.messageId],
      ),
      FK_VIOLATION,
    );
  });

  it('a primary key cannot be changed under its children (ON UPDATE RESTRICT)', async () => {
    await expectPgError(
      owner.query(`UPDATE customers SET id = gen_random_uuid() WHERE id = $1`, [A.customerId]),
      FK_VIOLATION,
    );
  });
});

describe('Customer identity (D-001) and per-tenant unique keys', () => {
  it('the same person in two tenants gets two different random customer IDs', async () => {
    const { rows } = await owner.query(`SELECT id, tenant_id FROM customers WHERE external_ref = $1`, [SAME_PERSON]);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
    for (const r of rows) expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('a duplicate (tenant_id, external_ref) is rejected', async () => {
    await expectPgError(
      asTenant(A.tenantId, (c) => c.query(`INSERT INTO customers (tenant_id, external_ref) VALUES ($1, $2)`, [A.tenantId, SAME_PERSON])),
      UNIQUE_VIOLATION,
    );
  });

  it('a second conversation for the same customer is rejected (D-012)', async () => {
    await expectPgError(
      asTenant(A.tenantId, (c) => c.query(`INSERT INTO conversations (tenant_id, customer_id) VALUES ($1, $2)`, [A.tenantId, A.customerId])),
      UNIQUE_VIOLATION,
    );
  });

  it('external_id dedupes per tenant: the same ID in another tenant is allowed, a repeat in one tenant is not (D-010)', async () => {
    await asTenant(B.tenantId, (c) =>
      c.query(`INSERT INTO messages (tenant_id, conversation_id, sender_type, external_id, body) VALUES ($1, $2, 'CUSTOMER', 'ext-A', 'x')`, [
        B.tenantId,
        B.conversationId,
      ]),
    );
    await expectPgError(
      asTenant(A.tenantId, (c) =>
        c.query(`INSERT INTO messages (tenant_id, conversation_id, sender_type, external_id, body) VALUES ($1, $2, 'CUSTOMER', 'ext-A', 'x')`, [
          A.tenantId,
          A.conversationId,
        ]),
      ),
      UNIQUE_VIOLATION,
    );
  });

  it('messages without external_id (AI, HUMAN) do not collide', async () => {
    await asTenant(A.tenantId, async (c) => {
      for (let i = 0; i < 2; i++) {
        await c.query(`INSERT INTO messages (tenant_id, conversation_id, sender_type, body) VALUES ($1, $2, 'HUMAN', 'x')`, [
          A.tenantId,
          A.conversationId,
        ]);
      }
    });
  });

  it('at most one reply per inbound message (D-014)', async () => {
    const reply = `INSERT INTO messages (tenant_id, conversation_id, sender_type, body, in_reply_to_message_id) VALUES ($1, $2, 'AI', 'x', $3)`;
    await asTenant(A.tenantId, (c) => c.query(reply, [A.tenantId, A.conversationId, A.messageId]));
    await expectPgError(asTenant(A.tenantId, (c) => c.query(reply, [A.tenantId, A.conversationId, A.messageId])), UNIQUE_VIOLATION);
  });
});

describe('app_user privileges (D-016)', () => {
  it('is not a superuser, cannot bypass RLS and owns no table', async () => {
    const role = (await owner.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user'`)).rows[0];
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    const owned = await owner.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'app_user'`);
    expect(owned.rowCount).toBe(0);
  });

  it('cannot TRUNCATE a tenant table (TRUNCATE ignores RLS)', async () => {
    await expectPgError(asTenant(A.tenantId, (c) => c.query('TRUNCATE messages')), RLS_VIOLATION);
  });

  it('can read tenants but cannot create or change them', async () => {
    const { rowCount } = await asTenant(null, (c) => c.query('SELECT id FROM tenants'));
    expect(rowCount).toBe(2);
    await expectPgError(asTenant(null, (c) => c.query(`INSERT INTO tenants (name, time_zone) VALUES ('x', 'UTC')`)), RLS_VIOLATION);
    await expectPgError(asTenant(null, (c) => c.query(`UPDATE tenants SET name = 'x'`)), RLS_VIOLATION);
  });
});

describe('Prisma client over the pg adapter, as app_user', () => {
  it('returns only the context tenant\'s rows, and none without context', async () => {
    const prisma = createPrismaClient(TEST_DATABASE_URL);
    try {
      const scoped = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${A.tenantId}, true)`;
        return tx.conversation.findMany({ select: { id: true, tenantId: true } });
      });
      expect(scoped).toEqual([{ id: A.conversationId, tenantId: A.tenantId }]);
      expect(await prisma.conversation.findMany()).toEqual([]);
    } finally {
      await prisma.$disconnect();
    }
  });
});
