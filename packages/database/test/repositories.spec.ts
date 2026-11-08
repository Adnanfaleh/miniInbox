// Tenant-isolation tests for the data-access layer (CLAUDE.md section 10; workflow/phase-3-plan.md).
// Every repository function is called as tenant B with tenant A's IDs: it must find nothing, change nothing,
// or throw RecordNotFoundError, and A's rows must be unchanged. Runs as app_user, so RLS is also active.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidTenantIdError,
  Mode,
  RecordNotFoundError,
  SenderType,
  conversations,
  createPrismaClient,
  customers,
  events,
  knowledge,
  lockConversation,
  messages,
  persona,
  tenants,
  withTenant,
  type PrismaClient,
} from '../src/index.js';
import { TEST_DATABASE_URL, app, createTenantFixture, owner, resetDatabase, snapshot, type TenantFixture } from './db.js';

let prisma: PrismaClient;
let A: TenantFixture;
let B: TenantFixture;
let aBefore: Record<string, unknown[]>;

beforeAll(() => {
  prisma = createPrismaClient(TEST_DATABASE_URL);
});

beforeEach(async () => {
  await resetDatabase();
  A = await createTenantFixture('A', 'person-1');
  B = await createTenantFixture('B', 'person-1');
  aBefore = await snapshot(A.tenantId);
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.end();
  await owner.end();
});

const asB = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(prisma, B.tenantId, fn);
const asA = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(prisma, A.tenantId, fn);
const expectAUnchanged = async () => expect(await snapshot(A.tenantId)).toEqual(aBefore);

describe('withTenant', () => {
  it('rejects a malformed tenant ID before touching the database', async () => {
    await expect(withTenant(prisma, 'not-a-uuid', async () => 1)).rejects.toBeInstanceOf(InvalidTenantIdError);
    await expect(withTenant(prisma, '', async () => 1)).rejects.toBeInstanceOf(InvalidTenantIdError);
  });

  it('sets the tenant and bounded timeouts transaction-locally', async () => {
    const inside = await asA(async (tx) => {
      const rows = await tx.$queryRaw<{ t: string; l: string; s: string }[]>`
        SELECT current_setting('app.tenant_id') AS t, current_setting('lock_timeout') AS l, current_setting('statement_timeout') AS s`;
      return rows[0];
    });
    expect(inside).toEqual({ t: A.tenantId, l: '2s', s: '5s' });
    // Outside the transaction the context is gone (fails closed).
    expect(await prisma.customer.findMany()).toEqual([]);
  });
});

describe('tenants (global)', () => {
  it('finds a tenant by ID and returns null for unknown or malformed IDs', async () => {
    expect((await tenants.findById(prisma, A.tenantId))?.id).toBe(A.tenantId);
    expect(await tenants.findById(prisma, '00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await tenants.findById(prisma, 'nope')).toBeNull();
  });

  it('listIds returns tenant IDs only', async () => {
    expect((await tenants.listIds(prisma)).sort()).toEqual([A.tenantId, B.tenantId].sort());
  });
});

describe('customers', () => {
  it('findById: B cannot read A\'s customer', async () => {
    expect(await asB((tx) => customers.findById(tx, B.tenantId, A.customerId))).toBeNull();
    expect((await asA((tx) => customers.findById(tx, A.tenantId, A.customerId)))?.id).toBe(A.customerId);
  });

  it('findOrCreateByExternalRef: the same person gets a separate random ID per tenant, and A is unchanged', async () => {
    const inB = await asB((tx) => customers.findOrCreateByExternalRef(tx, B.tenantId, 'person-1'));
    expect(inB.id).toBe(B.customerId);
    expect(inB.id).not.toBe(A.customerId);
    const fresh = await asB((tx) => customers.findOrCreateByExternalRef(tx, B.tenantId, 'person-2'));
    expect(fresh.tenantId).toBe(B.tenantId);
    expect([A.customerId, B.customerId]).not.toContain(fresh.id);
    await expectAUnchanged();
  });

  it('findByExternalRef: each tenant finds only its own record for the same address, and never creates one', async () => {
    expect((await asB((tx) => customers.findByExternalRef(tx, B.tenantId, 'person-1')))?.id).toBe(B.customerId);
    expect((await asA((tx) => customers.findByExternalRef(tx, A.tenantId, 'person-1')))?.id).toBe(A.customerId);
    expect(await asB((tx) => customers.findByExternalRef(tx, B.tenantId, 'nobody'))).toBeNull();
    await expectAUnchanged();
  });
});

describe('conversations', () => {
  it('findById: B cannot read A\'s conversation', async () => {
    expect(await asB((tx) => conversations.findById(tx, B.tenantId, A.conversationId))).toBeNull();
  });

  it('findByCustomer: B cannot read A\'s conversation through A\'s customer ID', async () => {
    expect(await asB((tx) => conversations.findByCustomer(tx, B.tenantId, A.customerId))).toBeNull();
    expect((await asA((tx) => conversations.findByCustomer(tx, A.tenantId, A.customerId)))?.id).toBe(A.conversationId);
  });

  it('findOrCreateForCustomer: B cannot attach a conversation to A\'s customer', async () => {
    await expect(asB((tx) => conversations.findOrCreateForCustomer(tx, B.tenantId, A.customerId))).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    const same = await asB((tx) => conversations.findOrCreateForCustomer(tx, B.tenantId, B.customerId));
    expect(same.id).toBe(B.conversationId);
    await expectAUnchanged();
  });

  it('list: B sees only its own conversations, and a cursor from A finds nothing', async () => {
    const list = await asB((tx) => conversations.list(tx, B.tenantId));
    expect(list.map((c) => c.id)).toEqual([B.conversationId]);
    expect(await asB((tx) => conversations.list(tx, B.tenantId, { cursorId: A.conversationId }))).toEqual([]);
  });

  it('setMode: B cannot change A\'s conversation mode', async () => {
    expect(await asB((tx) => conversations.setMode(tx, B.tenantId, A.conversationId, Mode.HUMAN))).toBe(0);
    await expectAUnchanged();
    expect(await asA((tx) => conversations.setMode(tx, A.tenantId, A.conversationId, Mode.HUMAN))).toBe(1);
  });

  it('lockConversation: B cannot lock A\'s conversation; A gets its row and mode', async () => {
    expect(await asB((tx) => lockConversation(tx, B.tenantId, A.conversationId))).toBeNull();
    expect(await asA((tx) => lockConversation(tx, A.tenantId, A.conversationId))).toEqual({ id: A.conversationId, mode: 'AI', status: 'OPEN' });
  });

  it('setStatus: B cannot close A\'s conversation; A can', async () => {
    expect(await asB((tx) => conversations.setStatus(tx, B.tenantId, A.conversationId, 'CLOSED'))).toBe(0);
    await expectAUnchanged();
    expect(await asA((tx) => conversations.setStatus(tx, A.tenantId, A.conversationId, 'CLOSED'))).toBe(1);
  });

  it('listSummaries: the status filter applies inside the tenant only', async () => {
    await owner.query(`UPDATE conversations SET status = 'CLOSED' WHERE id = $1`, [A.conversationId]);
    expect((await asA((tx) => conversations.listSummaries(tx, A.tenantId, { status: 'CLOSED' }))).map((c) => c.id)).toEqual([A.conversationId]);
    expect(await asA((tx) => conversations.listSummaries(tx, A.tenantId, { status: 'OPEN' }))).toEqual([]);
    expect(await asB((tx) => conversations.listSummaries(tx, B.tenantId, { status: 'CLOSED' }))).toEqual([]);
  });
});

describe('messages', () => {
  it('listStalePending: each tenant sees only its own old PENDING customer messages', async () => {
    await owner.query(`UPDATE messages SET reply_status = 'PENDING', created_at = now() - interval '1 hour' WHERE id = ANY($1::uuid[])`, [
      [A.messageId, B.messageId],
    ]);
    const cutoff = new Date();
    expect((await asB((tx) => messages.listStalePending(tx, B.tenantId, cutoff))).map((m) => m.id)).toEqual([B.messageId]);
    expect((await asA((tx) => messages.listStalePending(tx, A.tenantId, cutoff))).map((m) => m.id)).toEqual([A.messageId]);
    expect(await asA((tx) => messages.listStalePending(tx, A.tenantId, new Date(Date.now() - 2 * 3600_000)))).toEqual([]);
  });

  it('findById / findByExternalId / findReplyTo: B finds nothing of A\'s', async () => {
    await asB(async (tx) => {
      expect(await messages.findById(tx, B.tenantId, A.messageId)).toBeNull();
      expect(await messages.findByExternalId(tx, B.tenantId, 'ext-A')).toBeNull();
    });
    await asA((tx) =>
      messages.create(tx, A.tenantId, { conversationId: A.conversationId, senderType: SenderType.AI, body: 'r', inReplyToMessageId: A.messageId }),
    );
    expect(await asB((tx) => messages.findReplyTo(tx, B.tenantId, A.messageId))).toBeNull();
    expect((await asA((tx) => messages.findByExternalId(tx, A.tenantId, 'ext-A')))?.id).toBe(A.messageId);
  });

  it('create: a message under tenant B pointing at A\'s conversation is rejected, and A is unchanged', async () => {
    await expect(
      asB((tx) => messages.create(tx, B.tenantId, { conversationId: A.conversationId, senderType: SenderType.HUMAN, body: 'x' })),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expectAUnchanged();
  });

  it('create: the database also rejects it if the repository check is bypassed (composite FK)', async () => {
    await expect(
      asB((tx) =>
        tx.message.create({ data: { tenantId: B.tenantId, conversationId: A.conversationId, senderType: SenderType.HUMAN, body: 'x' } }),
      ),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expectAUnchanged();
  });

  it('create: a reply cannot reference A\'s message, or a message from another conversation', async () => {
    await expect(
      asB((tx) =>
        messages.create(tx, B.tenantId, { conversationId: B.conversationId, senderType: SenderType.AI, body: 'x', inReplyToMessageId: A.messageId }),
      ),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expectAUnchanged();
  });

  it('listForConversation: B listing A\'s conversation gets nothing', async () => {
    expect(await asB((tx) => messages.listForConversation(tx, B.tenantId, A.conversationId))).toEqual([]);
    expect((await asA((tx) => messages.listForConversation(tx, A.tenantId, A.conversationId))).map((m) => m.id)).toEqual([A.messageId]);
  });
});

describe('persona and knowledge (AI context sources)', () => {
  it('persona.get returns only the context tenant\'s persona', async () => {
    expect((await asA((tx) => persona.get(tx, A.tenantId)))?.tone).toBe('persona-A');
    expect((await asB((tx) => persona.get(tx, B.tenantId)))?.tone).toBe('persona-B');
    // Asking for A's persona while in B's context returns nothing (app filter and RLS disagree → no rows).
    expect(await asB((tx) => persona.get(tx, A.tenantId))).toBeNull();
  });

  it('knowledge: B cannot read A\'s entries by ID or by listing', async () => {
    expect(await asB((tx) => knowledge.findById(tx, B.tenantId, A.knowledgeId))).toBeNull();
    const list = await asB((tx) => knowledge.list(tx, B.tenantId));
    expect(list.map((k) => k.id)).toEqual([B.knowledgeId]);
    expect(list.every((k) => k.titleEn === 'kb-B')).toBe(true);
  });
});

describe('events', () => {
  it('listLifecycle: only CLOSED / REOPENED events, and B gets nothing of A\'s', async () => {
    await owner.query(`INSERT INTO conversation_events (tenant_id, conversation_id, event_type) VALUES ($1, $2, 'CLOSED'), ($1, $2, 'REOPENED')`, [
      A.tenantId,
      A.conversationId,
    ]);
    expect((await asA((tx) => events.listLifecycle(tx, A.tenantId, A.conversationId))).map((e) => e.eventType).sort()).toEqual(['CLOSED', 'REOPENED']);
    expect(await asB((tx) => events.listLifecycle(tx, B.tenantId, A.conversationId))).toEqual([]);
  });

  it('create: B cannot record an event on A\'s conversation or referencing A\'s message', async () => {
    await expect(asB((tx) => events.create(tx, B.tenantId, { conversationId: A.conversationId, eventType: 'TAKEOVER' }))).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    await expect(
      asB((tx) => events.create(tx, B.tenantId, { conversationId: B.conversationId, eventType: 'AI_REPLY_SENT', messageId: A.messageId })),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expectAUnchanged();
  });

  it('listForConversation: B listing A\'s conversation gets nothing', async () => {
    expect(await asB((tx) => events.listForConversation(tx, B.tenantId, A.conversationId))).toEqual([]);
    expect((await asA((tx) => events.listForConversation(tx, A.tenantId, A.conversationId))).map((e) => e.id)).toEqual([A.eventId]);
  });
});
