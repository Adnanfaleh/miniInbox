// Read APIs: GET /conversations and GET /conversations/:id (CLAUDE.md section 10; workflow/phase-7-plan.md).
// Hand-written in the shape of the isolation-test generator (read, list, unauth), because conversations are
// created by the webhook rather than by a POST on this resource.
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TENANT_HEADER } from '@mini-inbox/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app as appPool, createTenantFixture, owner, resetDatabase, type TenantFixture } from '../../../packages/database/test/db.js';

let nest: INestApplication;
let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  const { AppModule } = await import('../src/app.module.js');
  nest = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
  await nest.init();
});

beforeEach(async () => {
  await resetDatabase();
  A = await createTenantFixture('A', 'person-1');
  B = await createTenantFixture('B', 'person-1');
});

afterAll(async () => {
  await nest?.close();
  await appPool.end();
  await owner.end();
});

const get = (tenantId: string | null, url: string) => {
  const r = request(nest.getHttpServer()).get(url);
  return tenantId ? r.set(TENANT_HEADER, tenantId) : r;
};
const insertMessage = async (t: TenantFixture, conversationId: string, senderType: string, body: string) => {
  const r = await owner.query(`INSERT INTO messages (tenant_id, conversation_id, sender_type, body) VALUES ($1, $2, $3, $4) RETURNING id`, [
    t.tenantId,
    conversationId,
    senderType,
    body,
  ]);
  await new Promise((res) => setTimeout(res, 5));
  return r.rows[0].id as string;
};
const newConversation = async (t: TenantFixture, ref: string) => {
  const c = await owner.query(`INSERT INTO customers (tenant_id, external_ref) VALUES ($1, $2) RETURNING id`, [t.tenantId, ref]);
  const v = await owner.query(`INSERT INTO conversations (tenant_id, customer_id) VALUES ($1, $2) RETURNING id`, [t.tenantId, c.rows[0].id]);
  await new Promise((res) => setTimeout(res, 5));
  return v.rows[0].id as string;
};

describe('tenant isolation', () => {
  it('read: B gets 404 for A\'s conversation, with no A data in the body', async () => {
    const res = await get(B.tenantId, `/conversations/${A.conversationId}`).expect(404);
    expect(JSON.stringify(res.body)).not.toMatch(new RegExp(`${A.conversationId}|body-A|${A.tenantId}`));
  });

  it('list: B\'s list never contains A\'s conversations, and A\'s cursor gives B nothing', async () => {
    const res = await get(B.tenantId, '/conversations').expect(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([B.conversationId]);
    const viaCursor = await get(B.tenantId, `/conversations?cursor=${A.conversationId}`).expect(200);
    expect(viaCursor.body.items).toEqual([]);
  });

  it('a "before" cursor from A\'s conversation returns no messages for B\'s conversation', async () => {
    const res = await get(B.tenantId, `/conversations/${B.conversationId}?before=${A.messageId}`).expect(200);
    expect(res.body.messages).toEqual([]);
  });

  it('missing, malformed or unknown tenant header → 404', async () => {
    await get(null, '/conversations').expect(404);
    await get('nope', '/conversations').expect(404);
    await get('00000000-0000-4000-8000-000000000000', `/conversations/${A.conversationId}`).expect(404);
  });

  it('responses expose no tenant_id or tenantId', async () => {
    const list = await get(A.tenantId, '/conversations').expect(200);
    const detail = await get(A.tenantId, `/conversations/${A.conversationId}`).expect(200);
    for (const body of [list.body, detail.body]) {
      expect(JSON.stringify(body)).not.toMatch(/tenant_?id/i);
      expect(JSON.stringify(body)).not.toContain(A.tenantId);
    }
  });
});

describe('conversation list', () => {
  it('shows each conversation with its customer label, mode and last message; grouping is one row per sender', async () => {
    await owner.query(`UPDATE customers SET display_name = 'Layla' WHERE id = $1`, [A.customerId]);
    await insertMessage(A, A.conversationId, 'AI', 'The latest AI answer');
    const res = await get(A.tenantId, '/conversations').expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      id: A.conversationId,
      mode: 'AI',
      customer: { id: A.customerId, label: 'Layla' },
      lastMessage: { senderType: 'AI', preview: 'The latest AI answer' },
    });
  });

  it('newest first, paginated with a cursor', async () => {
    const c2 = await newConversation(A, 'person-2');
    const c3 = await newConversation(A, 'person-3');
    const page1 = await get(A.tenantId, '/conversations?limit=2').expect(200);
    expect(page1.body.items.map((i: { id: string }) => i.id)).toEqual([c3, c2]);
    expect(page1.body.nextCursor).toBe(c2);
    const page2 = await get(A.tenantId, `/conversations?limit=2&cursor=${page1.body.nextCursor}`).expect(200);
    expect(page2.body.items.map((i: { id: string }) => i.id)).toEqual([A.conversationId]);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('invalid query → 400', async () => {
    await get(A.tenantId, '/conversations?limit=0').expect(400);
    await get(A.tenantId, '/conversations?limit=500').expect(400);
    await get(A.tenantId, '/conversations?cursor=abc').expect(400);
  });
});

describe('conversation detail', () => {
  it('returns the conversation and its messages oldest first, with sender types kept distinct', async () => {
    await insertMessage(A, A.conversationId, 'AI', 'ai answer');
    await insertMessage(A, A.conversationId, 'SYSTEM', 'team joined');
    await insertMessage(A, A.conversationId, 'HUMAN', 'staff answer');
    const res = await get(A.tenantId, `/conversations/${A.conversationId}`).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.conversation).toMatchObject({ id: A.conversationId, mode: 'AI', customer: { id: A.customerId, label: 'person-1' } });
    expect(res.body.messages.map((m: { senderType: string; body: string }) => [m.senderType, m.body])).toEqual([
      ['CUSTOMER', 'body-A'],
      ['AI', 'ai answer'],
      ['SYSTEM', 'team joined'],
      ['HUMAN', 'staff answer'],
    ]);
    expect(Object.keys(res.body.messages[0]).sort()).toEqual(
      ['body', 'complexity', 'createdAt', 'id', 'inReplyToMessageId', 'intent', 'replyStatus', 'senderType'].sort(),
    );
    expect(res.body.olderCursor).toBeNull();
  });

  it('pages back through older history with "before"', async () => {
    const ids = [A.messageId];
    for (let i = 1; i <= 4; i++) ids.push(await insertMessage(A, A.conversationId, 'CUSTOMER', `m${i}`));
    const latest = await get(A.tenantId, `/conversations/${A.conversationId}?limit=2`).expect(200);
    expect(latest.body.messages.map((m: { id: string }) => m.id)).toEqual(ids.slice(3));
    const older = await get(A.tenantId, `/conversations/${A.conversationId}?limit=2&before=${latest.body.olderCursor}`).expect(200);
    expect(older.body.messages.map((m: { id: string }) => m.id)).toEqual(ids.slice(1, 3));
    const oldest = await get(A.tenantId, `/conversations/${A.conversationId}?limit=2&before=${older.body.olderCursor}`).expect(200);
    expect(oldest.body.messages.map((m: { id: string }) => m.id)).toEqual([ids[0]]);
    expect(oldest.body.olderCursor).toBeNull();
  });

  it('unknown or malformed ID → 404; invalid query → 400', async () => {
    await get(A.tenantId, '/conversations/00000000-0000-4000-8000-000000000000').expect(404);
    await get(A.tenantId, '/conversations/not-a-uuid').expect(404);
    await get(A.tenantId, `/conversations/${A.conversationId}?limit=201`).expect(400);
  });
});

describe('through the webhook', () => {
  it('two messages from the same sender appear as one conversation with two customer messages', async () => {
    const post = (externalId: string, text: string) =>
      request(nest.getHttpServer()).post(`/webhook/${A.tenantId}/message`).send({ externalId, from: '+966500000005', text }).expect(202);
    const r1 = await post('w1', 'first');
    await post('w2', 'second');
    const list = await get(A.tenantId, '/conversations').expect(200);
    expect(list.body.items.filter((i: { id: string }) => i.id === r1.body.conversationId)).toHaveLength(1);
    const detail = await get(A.tenantId, `/conversations/${r1.body.conversationId}`).expect(200);
    expect(detail.body.messages.map((m: { senderType: string; body: string }) => [m.senderType, m.body])).toEqual([
      ['CUSTOMER', 'first'],
      ['CUSTOMER', 'second'],
    ]);
    expect(detail.body.messages.every((m: { replyStatus: string }) => m.replyStatus === 'PENDING')).toBe(true);
  });
});
