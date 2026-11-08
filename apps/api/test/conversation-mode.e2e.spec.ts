// Takeover, return to AI and manual reply (CLAUDE.md sections 7 and 10; workflow/phase-6-plan.md).
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TENANT_HEADER } from '@mini-inbox/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app as appPool, createTenantFixture, owner, resetDatabase, snapshot, type TenantFixture } from '../../../packages/database/test/db.js';

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

const http = () => request(nest.getHttpServer());
const act = (tenantId: string, conversationId: string, action: 'takeover' | 'return-to-ai') =>
  http().post(`/conversations/${conversationId}/${action}`).set(TENANT_HEADER, tenantId);
const reply = (tenantId: string, conversationId: string, text: unknown) =>
  http().post(`/conversations/${conversationId}/reply`).set(TENANT_HEADER, tenantId).send({ text });
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const modeOf = async (id: string) => (await rows(`SELECT mode FROM conversations WHERE id = $1`, [id]))[0].mode;
const eventsOf = async (id: string) =>
  (await rows(`SELECT event_type FROM conversation_events WHERE conversation_id = $1 ORDER BY created_at, id`, [id])).map((r) => r.event_type);
const systemMessages = async (id: string) =>
  (await rows(`SELECT body FROM messages WHERE conversation_id = $1 AND sender_type = 'SYSTEM' ORDER BY created_at, id`, [id])).map((r) => r.body);

describe('tenant isolation', () => {
  it('tenant B cannot take over, return or reply on tenant A\'s conversation (404, A unchanged)', async () => {
    await owner.query(`UPDATE conversations SET mode = 'HUMAN' WHERE id = $1`, [A.conversationId]);
    const before = await snapshot(A.tenantId);
    await act(B.tenantId, A.conversationId, 'takeover').expect(404);
    await act(B.tenantId, A.conversationId, 'return-to-ai').expect(404);
    await reply(B.tenantId, A.conversationId, 'hello from B').expect(404);
    expect(await snapshot(A.tenantId)).toEqual(before);
  });

  it('unknown or malformed conversation IDs → 404; missing tenant header → 404', async () => {
    await act(A.tenantId, '00000000-0000-4000-8000-000000000000', 'takeover').expect(404);
    await act(A.tenantId, 'not-a-uuid', 'takeover').expect(404);
    await http().post(`/conversations/${A.conversationId}/takeover`).expect(404);
  });
});

describe('takeover and return to AI', () => {
  it('takeover sets HUMAN, records the event and a notice; repeating it changes nothing', async () => {
    const res = await act(A.tenantId, A.conversationId, 'takeover').expect(200);
    expect(res.body).toMatchObject({ conversationId: A.conversationId, mode: 'HUMAN' });
    expect(res.body.modeChangedAt).toBeTruthy();
    expect(await modeOf(A.conversationId)).toBe('HUMAN');

    await act(A.tenantId, A.conversationId, 'takeover').expect(200);
    // The fixture already holds one TAKEOVER event; one more was added, not two.
    expect((await eventsOf(A.conversationId)).filter((e) => e === 'TAKEOVER')).toHaveLength(2);
    expect(await systemMessages(A.conversationId)).toEqual(['A member of our team has joined the conversation and will reply to you.']);
  });

  it('return to AI sets AI, records the event, skips messages from the takeover period, and adds a notice', async () => {
    await act(A.tenantId, A.conversationId, 'takeover').expect(200);
    const pending = await rows(
      `INSERT INTO messages (tenant_id, conversation_id, sender_type, body, reply_status) VALUES ($1, $2, 'CUSTOMER', 'during takeover', 'PENDING') RETURNING id`,
      [A.tenantId, A.conversationId],
    );
    const res = await act(A.tenantId, A.conversationId, 'return-to-ai').expect(200);
    expect(res.body.mode).toBe('AI');
    expect(await modeOf(A.conversationId)).toBe('AI');
    expect((await rows(`SELECT reply_status FROM messages WHERE id = $1`, [pending[0].id]))[0].reply_status).toBe('SKIPPED');
    expect((await eventsOf(A.conversationId)).at(-1)).toBe('RETURN_TO_AI');
    expect((await systemMessages(A.conversationId)).at(-1)).toBe('You are now chatting with our AI assistant again.');

    // Returning again is a no-op.
    await act(A.tenantId, A.conversationId, 'return-to-ai').expect(200);
    expect((await eventsOf(A.conversationId)).filter((e) => e === 'RETURN_TO_AI')).toHaveLength(1);
  });

  it('notices follow the tenant language: Arabic customer with match_customer → Arabic notice', async () => {
    await owner.query(`UPDATE persona_configs SET language_preference = 'match_customer' WHERE tenant_id = $1`, [A.tenantId]);
    await owner.query(
      `INSERT INTO messages (tenant_id, conversation_id, sender_type, body) VALUES ($1, $2, 'CUSTOMER', 'مرحبا، أريد المساعدة')`,
      [A.tenantId, A.conversationId],
    );
    await act(A.tenantId, A.conversationId, 'takeover').expect(200);
    expect(await systemMessages(A.conversationId)).toEqual(['انضم أحد أعضاء فريقنا إلى المحادثة وسيرد عليك.']);
  });

  it('notices turned off: no notice message, the events are still recorded', async () => {
    await owner.query(`UPDATE persona_configs SET handoff_notices_enabled = false WHERE tenant_id = $1`, [A.tenantId]);
    await act(A.tenantId, A.conversationId, 'takeover').expect(200);
    await act(A.tenantId, A.conversationId, 'return-to-ai').expect(200);
    expect(await systemMessages(A.conversationId)).toEqual([]);
    expect((await eventsOf(A.conversationId)).slice(-2)).toEqual(['TAKEOVER', 'RETURN_TO_AI']);
  });
});

describe('manual reply', () => {
  it('is stored with the HUMAN sender type in HUMAN mode', async () => {
    await act(A.tenantId, A.conversationId, 'takeover').expect(200);
    const res = await reply(A.tenantId, A.conversationId, 'Hi, this is Sara from the team.').expect(201);
    expect((await rows(`SELECT sender_type, tenant_id, body FROM messages WHERE id = $1`, [res.body.messageId]))[0]).toEqual({
      sender_type: 'HUMAN',
      tenant_id: A.tenantId,
      body: 'Hi, this is Sara from the team.',
    });
  });

  it('is refused with 409 while the AI is in charge, and nothing is stored', async () => {
    await reply(A.tenantId, A.conversationId, 'too early').expect(409);
    expect(await rows(`SELECT 1 FROM messages WHERE body = 'too early'`)).toHaveLength(0);
  });

  it('invalid body → 400', async () => {
    await act(A.tenantId, A.conversationId, 'takeover').expect(200);
    await reply(A.tenantId, A.conversationId, '   ').expect(400);
    await reply(A.tenantId, A.conversationId, 'x'.repeat(4001)).expect(400);
  });
});

describe('locking', () => {
  it('a takeover waiting on a locked conversation fails fast with 409 instead of hanging', async () => {
    const holder = await owner.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [A.conversationId]);
      const started = Date.now();
      const res = await act(A.tenantId, A.conversationId, 'takeover');
      expect(res.status).toBe(409);
      expect(Date.now() - started).toBeLessThan(4000);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    expect(await modeOf(A.conversationId)).toBe('AI');
  });
});

describe('close and reopen (conversation lifecycle)', () => {
  const close = (tenantId: string, conversationId: string) => http().post(`/conversations/${conversationId}/close`).set(TENANT_HEADER, tenantId);
  const statusOf = async (id: string) => (await rows(`SELECT status FROM conversations WHERE id = $1`, [id]))[0].status;
  const webhook = (tenantId: string, externalId: string, from: string, text: string) =>
    http().post(`/webhook/${tenantId}/message`).send({ externalId, from, text }).expect(202);
  const list = async (tenantId: string, status?: string) =>
    (await http().get(`/conversations${status ? `?status=${status}` : ''}`).set(TENANT_HEADER, tenantId).expect(200)).body.items.map((c: { id: string }) => c.id);

  it('tenant B cannot close A\'s conversation (404, A unchanged)', async () => {
    const before = await snapshot(A.tenantId);
    await close(B.tenantId, A.conversationId).expect(404);
    expect(await snapshot(A.tenantId)).toEqual(before);
  });

  it('close: CLOSED status and event, waiting messages skipped, no notice to the customer; closing again changes nothing', async () => {
    await owner.query(`UPDATE messages SET reply_status = 'PENDING' WHERE id = $1`, [A.messageId]);
    const res = await close(A.tenantId, A.conversationId).expect(200);
    expect(res.body).toMatchObject({ conversationId: A.conversationId, status: 'CLOSED' });
    expect(await statusOf(A.conversationId)).toBe('CLOSED');
    expect((await rows(`SELECT reply_status FROM messages WHERE id = $1`, [A.messageId]))[0].reply_status).toBe('SKIPPED');
    expect(await systemMessages(A.conversationId)).toEqual([]);
    await close(A.tenantId, A.conversationId).expect(200);
    expect((await eventsOf(A.conversationId)).filter((e) => e === 'CLOSED')).toHaveLength(1);
  });

  it('a closed conversation is read-only for staff: takeover, return and reply → 409, nothing stored', async () => {
    await close(A.tenantId, A.conversationId).expect(200);
    const before = await snapshot(A.tenantId);
    await act(A.tenantId, A.conversationId, 'takeover').expect(409);
    await act(A.tenantId, A.conversationId, 'return-to-ai').expect(409);
    await reply(A.tenantId, A.conversationId, 'too late').expect(409);
    expect(await snapshot(A.tenantId)).toEqual(before);
  });

  it('lists: Open by default without it, the Closed tab with it; the detail shows status and a CLOSED marker', async () => {
    await close(A.tenantId, A.conversationId).expect(200);
    expect(await list(A.tenantId)).toEqual([]);
    expect(await list(A.tenantId, 'CLOSED')).toEqual([A.conversationId]);
    expect(await list(B.tenantId, 'CLOSED')).toEqual([]);
    const detail = (await http().get(`/conversations/${A.conversationId}`).set(TENANT_HEADER, A.tenantId).expect(200)).body;
    expect(detail.conversation.status).toBe('CLOSED');
    expect(detail.lifecycle.map((l: { type: string }) => l.type)).toEqual(['CLOSED']);
    await http().get(`/conversations?status=ARCHIVED`).set(TENANT_HEADER, A.tenantId).expect(400);
  });

  it('the customer\'s next message reopens the same conversation in AI mode, even if staff had taken over', async () => {
    const first = (await webhook(A.tenantId, 'lc-1', '+966500000201', 'hello')).body;
    await act(A.tenantId, first.conversationId, 'takeover').expect(200);
    await close(A.tenantId, first.conversationId).expect(200);

    const again = (await webhook(A.tenantId, 'lc-2', '+966500000201', 'me again')).body;
    expect(again.conversationId).toBe(first.conversationId);
    expect(await statusOf(first.conversationId)).toBe('OPEN');
    expect(await modeOf(first.conversationId)).toBe('AI');
    expect((await rows(`SELECT reply_status FROM messages WHERE id = $1`, [again.messageId]))[0].reply_status).toBe('PENDING');
    expect(await eventsOf(first.conversationId)).toEqual(['TAKEOVER', 'CLOSED', 'REOPENED']);
    const detail = (await http().get(`/conversations/${first.conversationId}`).set(TENANT_HEADER, A.tenantId).expect(200)).body;
    expect(detail.lifecycle.map((l: { type: string }) => l.type)).toEqual(['CLOSED', 'REOPENED']);
    // The customer is not told: the channel view has no lifecycle data and no closing notice.
    const channel = (await http().get(`/dev/channel/${A.tenantId}/messages`).query({ from: '+966500000201' }).expect(200)).body;
    expect(Object.keys(channel).sort()).toEqual(['messages', 'mode']);
    expect(channel.messages.filter((m: { senderType: string }) => m.senderType === 'SYSTEM')).toHaveLength(1); // the takeover notice only
  });
});
