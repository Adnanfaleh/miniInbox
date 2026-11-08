// Worker integration tests (CLAUDE.md section 10; workflow/phase-5-plan.md).
// Real Postgres (test DB, app_user), real Redis (test prefix), real API webhook; MOCK AI provider only.
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AI_REPLY_QUEUE, INBOUND_MESSAGE_QUEUE, REPLY_PRIORITY, inboundMessageJobId, personaCacheKey } from '@mini-inbox/contracts';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app as appPool, createTenantFixture, owner, resetDatabase, snapshot, type TenantFixture } from '../../../packages/database/test/db.js';
import { AI_PROVIDER } from '../src/ai/ai-provider.js';
import { MockAiProvider } from '../src/ai/mock.provider.js';
import { DEFAULT_WORKER_SETTINGS, WORKER_SETTINGS, type WorkerSettings } from '../src/config/worker-env.js';
import { PersonaCache } from '../src/pipeline/persona-cache.js';
import { localDayAndMinute } from '../src/pipeline/working-hours.js';
import { AiReplyHandler } from '../src/queues/ai-reply.handler.js';
import { InboundMessageHandler } from '../src/queues/inbound-message.handler.js';
import { PendingRecovery } from '../src/queues/pending-recovery.service.js';
import { QueueWorkers } from '../src/queues/queue-workers.service.js';
import { ReplyQueue } from '../src/queues/reply-queue.service.js';
import { WorkerModule } from '../src/worker.module.js';

const prefix = process.env.QUEUE_PREFIX!;
let api: INestApplication;
let redis: Redis;
let inboundQueue: Queue;
let replyQueue: Queue;
let worker: TestingModule;
let mock: MockAiProvider;
let A: TenantFixture;
let B: TenantFixture;

const TEST_SETTINGS: WorkerSettings = {
  ...DEFAULT_WORKER_SETTINGS,
  autorun: false,
  orderWaitMs: 150,
  agingAfterMs: 100,
  agingSweepMs: 60_000,
  replyAttempts: 1,
  replyBackoffMs: 50,
};

async function bootWorker(settings: Partial<WorkerSettings> = {}): Promise<void> {
  mock = new MockAiProvider();
  worker = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(AI_PROVIDER)
    .useValue(mock)
    .overrideProvider(WORKER_SETTINGS)
    .useValue({ ...TEST_SETTINGS, ...settings })
    .compile();
  await worker.init();
}

const startConsumers = () => worker.get(QueueWorkers).start();

beforeAll(async () => {
  const { AppModule } = await import('../../api/src/app.module.js');
  api = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
  await api.init();
  redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  inboundQueue = new Queue(INBOUND_MESSAGE_QUEUE, { connection: redis, prefix });
  replyQueue = new Queue(AI_REPLY_QUEUE, { connection: redis, prefix });
});

beforeEach(async () => {
  await Promise.all([inboundQueue.obliterate({ force: true }), replyQueue.obliterate({ force: true })]);
  await resetDatabase();
  A = await createTenantFixture('A', '+966500000100');
  B = await createTenantFixture('B', '+966500000100');
  await setHours(A.tenantId, 'open');
  await setHours(B.tenantId, 'open');
  const keys = await redis.keys('t:{*}:persona');
  if (keys.length) await redis.del(...keys);
  await bootWorker();
});

afterEach(async () => {
  await worker?.close();
});

afterAll(async () => {
  await Promise.all([inboundQueue.obliterate({ force: true }), replyQueue.obliterate({ force: true })]);
  await inboundQueue.close();
  await replyQueue.close();
  redis.disconnect();
  await api?.close();
  await appPool.end();
  await owner.end();
});

// ---------- helpers ----------

const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;

/** Working hours relative to "now" in the tenant's time zone, so tests don't depend on the clock. */
async function setHours(tenantId: string, state: 'open' | 'closed'): Promise<void> {
  const { minute } = localDayAndMinute(new Date(), 'Asia/Riyadh');
  const at = (offset: number) => {
    const m = (((minute + offset) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const [start, end] = state === 'open' ? [at(-120), at(120)] : [at(120), at(180)];
  await owner.query(`UPDATE persona_configs SET working_days = 'SUN-SAT', work_start = $2, work_end = $3 WHERE tenant_id = $1`, [tenantId, start, end]);
}

const postWebhook = (tenantId: string, externalId: string, text: string, from = '+966500000101') =>
  request(api.getHttpServer()).post(`/webhook/${tenantId}/message`).send({ externalId, from, text }).expect(202);

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 100));
  }
}

const statusOf = async (messageId: string) => (await rows(`SELECT reply_status FROM messages WHERE id = $1`, [messageId]))[0]?.reply_status;
const settled = (messageId: string) => waitFor(async () => {
  const s = await statusOf(messageId);
  return s && s !== 'PENDING' ? s : undefined;
});
const replyTo = async (messageId: string) => (await rows(`SELECT * FROM messages WHERE in_reply_to_message_id = $1`, [messageId]))[0];

/** Inserts a PENDING customer message directly (for ordering and failure tests that bypass stage 1). */
async function pendingMessage(t: TenantFixture, conversationId: string, text: string, complexity?: 'simple' | 'complex'): Promise<string> {
  const r = await rows(
    `INSERT INTO messages (tenant_id, conversation_id, sender_type, body, reply_status, complexity)
     VALUES ($1, $2, 'CUSTOMER', $3, 'PENDING', $4) RETURNING id`,
    [t.tenantId, conversationId, text, complexity ?? null],
  );
  await new Promise((r) => setTimeout(r, 5)); // distinct created_at values
  return r[0].id;
}

async function secondConversation(t: TenantFixture, ref: string): Promise<string> {
  const c = await rows(`INSERT INTO customers (tenant_id, external_ref) VALUES ($1, $2) RETURNING id`, [t.tenantId, ref]);
  const v = await rows(`INSERT INTO conversations (tenant_id, customer_id) VALUES ($1, $2) RETURNING id`, [t.tenantId, c[0].id]);
  return v[0].id;
}

const job = (t: TenantFixture, conversationId: string, messageId: string) => ({ tenantId: t.tenantId, conversationId, messageId });

// ---------- tests ----------

describe('end to end: webhook → inbound-message → ai-reply → stored AI reply', () => {
  it('classifies, replies as AI, links the reply, records the event and settles the message', async () => {
    startConsumers();
    const res = await postWebhook(A.tenantId, 'e2e-1', 'When do you open?');
    const { messageId, conversationId } = res.body;
    expect(await settled(messageId)).toBe('REPLIED');

    const inbound = (await rows(`SELECT complexity, intent FROM messages WHERE id = $1`, [messageId]))[0];
    expect(inbound).toEqual({ complexity: 'simple', intent: 'question' });
    const reply = await replyTo(messageId);
    expect(reply).toMatchObject({ sender_type: 'AI', tenant_id: A.tenantId, conversation_id: conversationId });
    expect(reply.body).toMatch(/^\[MOCK\]/);
    const events = await rows(`SELECT event_type, message_id FROM conversation_events WHERE conversation_id = $1 AND event_type = 'AI_REPLY_SENT'`, [conversationId]);
    expect(events).toEqual([{ event_type: 'AI_REPLY_SENT', message_id: reply.id }]);
  });
});

describe('tenant isolation', () => {
  it('an AI job for tenant A never sees tenant B\'s persona or knowledge (and vice versa)', async () => {
    startConsumers();
    const ra = await postWebhook(A.tenantId, 'iso-a', 'question for A');
    const rb = await postWebhook(B.tenantId, 'iso-b', 'question for B');
    await settled(ra.body.messageId);
    await settled(rb.body.messageId);

    const forA = mock.calls.filter((c) => c.text.includes('question for A'));
    const forB = mock.calls.filter((c) => c.text.includes('question for B'));
    expect(forA.map((c) => c.kind).sort()).toEqual(['classify', 'reply']);
    expect(forB.map((c) => c.kind).sort()).toEqual(['classify', 'reply']);
    for (const c of forA) {
      expect(c.system).toContain('kb-A');
      expect(c.system).not.toContain('kb-B');
      expect(c.system).not.toContain('persona-B');
      expect(c.text).not.toContain('question for B');
    }
    for (const c of forB) {
      expect(c.system).toContain('kb-B');
      expect(c.system).not.toContain('kb-A');
      expect(c.system).not.toContain('persona-A');
    }
    expect(forA.find((c) => c.kind === 'reply')!.system).toContain('persona-A');
  });

  it('a job naming tenant B with tenant A\'s conversation and message loads nothing and writes nothing', async () => {
    const msg = await pendingMessage(A, A.conversationId, 'private A text');
    const before = await snapshot(A.tenantId);
    const forged = job(B, A.conversationId, msg);
    expect(await worker.get(InboundMessageHandler).handle({ data: forged })).toBe('ignored');
    expect(await worker.get(AiReplyHandler).handle({ data: forged, moveToDelayed: async () => undefined })).toBe('ignored');
    expect(await snapshot(A.tenantId)).toEqual(before);
    expect(mock.calls).toHaveLength(0);
  });

  it('a malformed job payload is rejected without retries (no tenant, or extra text field)', async () => {
    const handler = worker.get(InboundMessageHandler);
    await expect(handler.handle({ data: { conversationId: A.conversationId, messageId: A.messageId } })).rejects.toThrow('invalid job payload');
    await expect(handler.handle({ data: { ...job(A, A.conversationId, A.messageId), text: 'leak' } })).rejects.toThrow('invalid job payload');
  });

  it('the persona cache is keyed per tenant and never returns one tenant\'s entry for another', async () => {
    const cache = worker.get(PersonaCache);
    const a = await cache.get(A.tenantId);
    const b = await cache.get(B.tenantId);
    expect(a!.persona!.tone).toBe('persona-A');
    expect(b!.persona!.tone).toBe('persona-B');
    expect(await redis.exists(`t:{${A.tenantId}}:persona`, `t:{${B.tenantId}}:persona`)).toBe(2);
    expect(personaCacheKey(A.tenantId)).toContain(A.tenantId);

    // Poison B's key with A's snapshot: it must be ignored and B's own data loaded instead.
    await redis.set(personaCacheKey(B.tenantId), JSON.stringify(a), 'EX', 60);
    const again = await cache.get(B.tenantId);
    expect(again!.tenantId).toBe(B.tenantId);
    expect(again!.persona!.tone).toBe('persona-B');
  });
});

describe('takeover and idempotency', () => {
  it('a retried reply job creates no second AI reply', async () => {
    startConsumers();
    const { body } = await postWebhook(A.tenantId, 'retry-1', 'hello there');
    await settled(body.messageId);
    const handler = worker.get(AiReplyHandler);
    expect(await handler.handle({ data: job(A, body.conversationId, body.messageId), moveToDelayed: async () => undefined })).toBe('already-settled');
    expect(await rows(`SELECT id FROM messages WHERE in_reply_to_message_id = $1`, [body.messageId])).toHaveLength(1);
  });

  it('messages during HUMAN mode get no AI reply, also not after return to AI; new messages after return do', async () => {
    await owner.query(`UPDATE conversations SET mode = 'HUMAN' WHERE id = $1`, [A.conversationId]);
    startConsumers();
    const during = await postWebhook(A.tenantId, 'human-1', 'are you there?', '+966500000100');
    expect(await settled(during.body.messageId)).toBe('SKIPPED');
    expect(await replyTo(during.body.messageId)).toBeUndefined();

    await owner.query(`UPDATE conversations SET mode = 'AI' WHERE id = $1`, [A.conversationId]);
    const after = await postWebhook(A.tenantId, 'human-2', 'back again', '+966500000100');
    expect(await settled(after.body.messageId)).toBe('REPLIED');
    expect(await statusOf(during.body.messageId)).toBe('SKIPPED');
    expect(await replyTo(during.body.messageId)).toBeUndefined();
    // The takeover-period message is never classified and never the message being answered. It may appear as
    // earlier history when the AI answers a later message, so the model has the full conversation context.
    expect(mock.calls.some((c) => c.kind === 'classify' && c.text.includes('are you there?'))).toBe(false);
    expect(mock.calls.some((c) => c.kind === 'reply' && c.text.split('\n').at(-1)!.includes('are you there?'))).toBe(false);
  });

  it('a takeover between drafting and writing discards the draft and records it', async () => {
    startConsumers();
    mock.beforeReplyReturns = async () => {
      await owner.query(`UPDATE conversations SET mode = 'HUMAN' WHERE tenant_id = $1`, [A.tenantId]);
    };
    const { body } = await postWebhook(A.tenantId, 'race-1', 'quick question', '+966500000100');
    expect(await settled(body.messageId)).toBe('SKIPPED');
    expect(await replyTo(body.messageId)).toBeUndefined();
    const events = await rows(`SELECT event_type, message_id FROM conversation_events WHERE event_type = 'DRAFT_DISCARDED'`);
    expect(events).toEqual([{ event_type: 'DRAFT_DISCARDED', message_id: body.messageId }]);
  });
});

describe('takeover and return through the API endpoints', () => {
  const act = (action: 'takeover' | 'return-to-ai') =>
    request(api.getHttpServer()).post(`/conversations/${A.conversationId}/${action}`).set('x-tenant-id', A.tenantId).expect(200);

  it('takeover disables AI replies; after return, new messages get AI replies and notices never reach the model', async () => {
    startConsumers();
    await act('takeover');
    const during = await postWebhook(A.tenantId, 'api-1', 'need a person', '+966500000100');
    expect(await settled(during.body.messageId)).toBe('SKIPPED');
    await act('return-to-ai');
    const after = await postWebhook(A.tenantId, 'api-2', 'thanks, one more question', '+966500000100');
    expect(await settled(after.body.messageId)).toBe('REPLIED');
    expect(await replyTo(during.body.messageId)).toBeUndefined();
    const replyCall = mock.calls.find((c) => c.kind === 'reply' && c.text.includes('one more question'))!;
    expect(replyCall.text).not.toContain('team has joined');
    expect(replyCall.text).not.toContain('AI assistant again');
  });

  it('a message still queued when the conversation returns to AI is never answered by the AI', async () => {
    await act('takeover');
    // Consumers are not running yet: the job waits in the queue while the human is in charge.
    const during = await postWebhook(A.tenantId, 'api-3', 'sent while human', '+966500000100');
    await act('return-to-ai');
    startConsumers();
    const after = await postWebhook(A.tenantId, 'api-4', 'after return', '+966500000100');
    expect(await settled(after.body.messageId)).toBe('REPLIED');
    expect(await statusOf(during.body.messageId)).toBe('SKIPPED');
    expect(await replyTo(during.body.messageId)).toBeUndefined();
  });
});

describe('persona edits', () => {
  it('after PUT /persona, the next AI reply uses the new persona, not the cached old one', async () => {
    startConsumers();
    const first = await postWebhook(A.tenantId, 'p-1', 'first question', '+966500000100');
    await settled(first.body.messageId);
    expect(await redis.exists(personaCacheKey(A.tenantId))).toBe(1); // the old persona is cached

    await request(api.getHttpServer())
      .put('/persona')
      .set('x-tenant-id', A.tenantId)
      .send({
        tone: 'brand-new-tone',
        replyType: 'professional',
        languagePreference: 'en',
        replyMaxLength: 300,
        businessInstructions: '',
        outOfKbMessageEn: 'n/a',
        outOfKbMessageAr: 'n/a',
        outOfHoursMessageEn: 'closed',
        outOfHoursMessageAr: 'closed',
        workingDays: 'SUN-SAT',
        workStart: '00:00',
        workEnd: '23:59',
        handoffNoticesEnabled: true,
        knowledge: [{ titleEn: 'kb-new', titleAr: 'kb-new', contentEn: 'new content', contentAr: 'new content' }],
      })
      .expect(200);
    await setHours(A.tenantId, 'open');

    const second = await postWebhook(A.tenantId, 'p-2', 'second question', '+966500000100');
    expect(await settled(second.body.messageId)).toBe('REPLIED');
    const call = mock.calls.find((c) => c.kind === 'reply' && c.text.split('\n').at(-1)!.includes('second question'))!;
    expect(call.system).toContain('brand-new-tone');
    expect(call.system).toContain('kb-new');
    expect(call.system).not.toContain('persona-A');
  });
});

describe('reply behaviour', () => {
  it('out of working hours: sends the tenant\'s out-of-hours message without any model call', async () => {
    await setHours(A.tenantId, 'closed');
    await owner.query(`UPDATE persona_configs SET out_of_hours_message_en = 'We are closed now.' WHERE tenant_id = $1`, [A.tenantId]);
    startConsumers();
    const { body } = await postWebhook(A.tenantId, 'ooh-1', 'hello?');
    expect(await settled(body.messageId)).toBe('REPLIED');
    expect((await replyTo(body.messageId)).body).toBe('We are closed now.');
    expect(mock.calls).toHaveLength(0);
    expect((await rows(`SELECT complexity FROM messages WHERE id = $1`, [body.messageId]))[0].complexity).toBeNull();
  });

  it('a question outside the knowledge base gets the tenant\'s out-of-knowledge-base message', async () => {
    await owner.query(`UPDATE persona_configs SET out_of_kb_message_en = 'Let me check with the team.' WHERE tenant_id = $1`, [A.tenantId]);
    startConsumers();
    const { body } = await postWebhook(A.tenantId, 'kb-1', 'do you sell rockets? [unanswerable]');
    expect(await settled(body.messageId)).toBe('REPLIED');
    expect((await replyTo(body.messageId)).body).toBe('Let me check with the team.');
  });

  it('Arabic customer + match_customer → Arabic out-of-knowledge-base message', async () => {
    await owner.query(`UPDATE persona_configs SET language_preference = 'match_customer', out_of_kb_message_ar = 'سنتحقق ونعود إليك.' WHERE tenant_id = $1`, [A.tenantId]);
    startConsumers();
    const { body } = await postWebhook(A.tenantId, 'ar-1', 'هل تبيعون الصواريخ؟ [unanswerable]');
    expect(await settled(body.messageId)).toBe('REPLIED');
    expect((await replyTo(body.messageId)).body).toBe('سنتحقق ونعود إليك.');
  });

  it('an unreadable classification falls back to complex/other and is still answered', async () => {
    startConsumers();
    const { body } = await postWebhook(A.tenantId, 'garbage-1', 'something odd [garbage]');
    expect(await settled(body.messageId)).toBe('REPLIED');
    expect((await rows(`SELECT complexity, intent FROM messages WHERE id = $1`, [body.messageId]))[0]).toEqual({ complexity: 'complex', intent: 'other' });
  });

  it('replies longer than the persona limit are trimmed', async () => {
    await owner.query(`UPDATE persona_configs SET reply_max_length = 20 WHERE tenant_id = $1`, [A.tenantId]);
    startConsumers();
    const { body } = await postWebhook(A.tenantId, 'long-1', 'please give me a very long answer about everything');
    expect(await settled(body.messageId)).toBe('REPLIED');
    expect((await replyTo(body.messageId)).body.length).toBeLessThanOrEqual(20);
  });
});

describe('failures, priority and order', () => {
  it('a job that fails for good marks the message FAILED, and the next message in the conversation is still answered', async () => {
    const failing = await pendingMessage(A, A.conversationId, 'this breaks [fail]');
    const next = await pendingMessage(A, A.conversationId, 'normal question');
    await inboundQueue.add('inbound-message', job(A, A.conversationId, failing), { jobId: inboundMessageJobId(A.tenantId, failing), attempts: 1 });
    await inboundQueue.add('inbound-message', job(A, A.conversationId, next), { jobId: inboundMessageJobId(A.tenantId, next), attempts: 1 });
    startConsumers();
    expect(await settled(failing)).toBe('FAILED');
    expect(await settled(next)).toBe('REPLIED');
  });

  it('between conversations, a simple message is answered before an earlier complex one', async () => {
    const conv2 = await secondConversation(A, 'person-2');
    const complexMsg = await pendingMessage(A, A.conversationId, 'hard one [complex]', 'complex');
    const simpleMsg = await pendingMessage(A, conv2, 'easy one', 'simple');
    const replies = worker.get(ReplyQueue);
    await replies.add(job(A, A.conversationId, complexMsg), REPLY_PRIORITY.complex);
    await replies.add(job(A, conv2, simpleMsg), REPLY_PRIORITY.simple);
    startConsumers();
    await settled(complexMsg);
    await settled(simpleMsg);
    const [c, s] = [await replyTo(complexMsg), await replyTo(simpleMsg)];
    expect(new Date(s.created_at).getTime()).toBeLessThan(new Date(c.created_at).getTime());
  });

  it('inside one conversation, arrival order wins: an earlier complex message is answered before a later simple one', async () => {
    const first = await pendingMessage(A, A.conversationId, 'first, hard [complex]', 'complex');
    const second = await pendingMessage(A, A.conversationId, 'second, easy', 'simple');
    const replies = worker.get(ReplyQueue);
    await replies.add(job(A, A.conversationId, first), REPLY_PRIORITY.complex);
    await replies.add(job(A, A.conversationId, second), REPLY_PRIORITY.simple);
    startConsumers();
    await settled(first);
    await settled(second);
    const [r1, r2] = [await replyTo(first), await replyTo(second)];
    expect(new Date(r1.created_at).getTime()).toBeLessThan(new Date(r2.created_at).getTime());
  });

  it('a complex reply job waiting longer than the aging threshold is raised to the simple priority', async () => {
    const msg = await pendingMessage(A, A.conversationId, 'waits long [complex]', 'complex');
    const replies = worker.get(ReplyQueue);
    await replies.add(job(A, A.conversationId, msg), REPLY_PRIORITY.complex);
    expect(await replies.promoteAged()).toBe(0); // not old enough yet
    await new Promise((r) => setTimeout(r, 150));
    expect(await replies.promoteAged()).toBe(1);
    const queued = await replyQueue.getJob(inboundMessageJobId(A.tenantId, msg));
    expect(queued!.priority).toBe(REPLY_PRIORITY.simple);
  });
});

describe('recovery sweep: messages whose queue job was lost', () => {
  // The sweep treats a PENDING message as lost when it is older than recoverAfterMs and has no live job.
  const LATER = () => Date.now() + DEFAULT_WORKER_SETTINGS.recoverAfterMs + 1000;

  it('re-queues a lost message under its own tenant, and the worker then answers it', async () => {
    const lostA = await pendingMessage(A, A.conversationId, 'stored, never queued');
    const lostB = await pendingMessage(B, B.conversationId, 'stored, never queued in B');
    const recovery = worker.get(PendingRecovery);
    expect(await recovery.sweep(Date.now())).toBe(0); // too recent: may still be on its way
    expect(await recovery.sweep(LATER())).toBe(2);
    const jobA = await inboundQueue.getJob(inboundMessageJobId(A.tenantId, lostA));
    const jobB = await inboundQueue.getJob(inboundMessageJobId(B.tenantId, lostB));
    expect(jobA!.data).toEqual(job(A, A.conversationId, lostA));
    expect(jobB!.data).toEqual(job(B, B.conversationId, lostB));
    startConsumers();
    expect(await settled(lostA)).toBe('REPLIED');
    expect(await settled(lostB)).toBe('REPLIED');
  });

  it('leaves a message alone while it still has a live job, and never queues it twice', async () => {
    const msg = await pendingMessage(A, A.conversationId, 'queued normally');
    await inboundQueue.add('inbound-message', job(A, A.conversationId, msg), { jobId: inboundMessageJobId(A.tenantId, msg) });
    const recovery = worker.get(PendingRecovery);
    expect(await recovery.sweep(LATER())).toBe(0);
    expect((await inboundQueue.getJobs(['waiting', 'prioritized', 'delayed'])).length).toBe(1);
  });

  it('unblocks a conversation: a later message waiting behind a lost one is answered after the sweep', async () => {
    const lost = await pendingMessage(A, A.conversationId, 'lost first message');
    const later = await pendingMessage(A, A.conversationId, 'second message');
    await worker.get(ReplyQueue).add(job(A, A.conversationId, later), REPLY_PRIORITY.simple);
    startConsumers();
    await new Promise((r) => setTimeout(r, 400)); // the later message keeps waiting behind the lost one
    expect((await rows(`SELECT reply_status FROM messages WHERE id = $1`, [later]))[0].reply_status).toBe('PENDING');
    expect(await worker.get(PendingRecovery).sweep(LATER())).toBe(1);
    expect(await settled(lost)).toBe('REPLIED');
    expect(await settled(later)).toBe('REPLIED');
    const [r1, r2] = [await replyTo(lost), await replyTo(later)];
    expect(new Date(r1.created_at).getTime()).toBeLessThan(new Date(r2.created_at).getTime());
  });

  it('ignores settled messages and seeded history (no reply status)', async () => {
    const done = await pendingMessage(A, A.conversationId, 'already answered');
    await owner.query(`UPDATE messages SET reply_status = 'REPLIED' WHERE id = $1`, [done]);
    // The fixture's own customer message has reply_status NULL (history).
    expect(await worker.get(PendingRecovery).sweep(LATER())).toBe(0);
  });
});

describe('closed conversations (lifecycle)', () => {
  it('staff close while the model is answering: the waiting message is skipped, no AI reply is stored', async () => {
    startConsumers();
    mock.beforeReplyReturns = async () => {
      await request(api.getHttpServer()).post(`/conversations/${A.conversationId}/close`).set('x-tenant-id', A.tenantId).expect(200);
    };
    const { body } = await postWebhook(A.tenantId, 'close-race-1', 'quick question', '+966500000100');
    expect(await settled(body.messageId)).toBe('SKIPPED');
    await new Promise((r) => setTimeout(r, 200)); // let the reply stage finish
    expect(await replyTo(body.messageId)).toBeUndefined();
  });

  it('the reply writer re-checks the status under the lock: a draft for a closed conversation is discarded', async () => {
    startConsumers();
    mock.beforeReplyReturns = async () => {
      // Status changes but the message is still PENDING: only the writer's own check can stop the reply.
      await owner.query(`UPDATE conversations SET status = 'CLOSED' WHERE id = $1`, [A.conversationId]);
    };
    const { body } = await postWebhook(A.tenantId, 'close-race-2', 'another question', '+966500000100');
    expect(await settled(body.messageId)).toBe('SKIPPED');
    expect(await replyTo(body.messageId)).toBeUndefined();
    const discarded = await rows(`SELECT message_id FROM conversation_events WHERE event_type = 'DRAFT_DISCARDED'`);
    expect(discarded).toEqual([{ message_id: body.messageId }]);
  });

  it('a queued job for a closed conversation is skipped without a model call', async () => {
    const msg = await pendingMessage(A, A.conversationId, 'arrived just before closing');
    await owner.query(`UPDATE conversations SET status = 'CLOSED' WHERE id = $1`, [A.conversationId]);
    await inboundQueue.add('inbound-message', job(A, A.conversationId, msg), { jobId: inboundMessageJobId(A.tenantId, msg) });
    startConsumers();
    expect(await settled(msg)).toBe('SKIPPED');
    expect(mock.calls).toHaveLength(0);
  });

  it('after the customer reopens it, the new message gets an AI reply', async () => {
    startConsumers();
    await request(api.getHttpServer()).post(`/conversations/${A.conversationId}/close`).set('x-tenant-id', A.tenantId).expect(200);
    const { body } = await postWebhook(A.tenantId, 'reopen-1', 'back with a question', '+966500000100');
    expect(body.conversationId).toBe(A.conversationId);
    expect(await settled(body.messageId)).toBe('REPLIED');
    expect((await replyTo(body.messageId)).sender_type).toBe('AI');
  });
});
