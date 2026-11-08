// Webhook and queue tests (CLAUDE.md section 10; workflow/phase-4-plan.md).
// Isolation: per-tenant dedupe and customer identity, IDs-only job payloads, tenant from the URL only.
// Functional: grouping, idempotent delivery, validation, fail-fast when Redis is down, concurrent first messages.
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { INBOUND_MESSAGE_QUEUE, TENANT_HEADER, inboundMessageJobId } from '@mini-inbox/contracts';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app as appPool, createTenantFixture, owner, resetDatabase, type TenantFixture } from '../../../packages/database/test/db.js';
import { API_ENV, type ApiEnv } from '../src/config/api-env.js';

let nest: INestApplication;
let redis: Redis;
let queue: Queue;
let A: TenantFixture;
let B: TenantFixture;

async function createApp(override?: Partial<ApiEnv>): Promise<INestApplication> {
  const { AppModule } = await import('../src/app.module.js');
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (override) {
    const { apiEnvSchema, loadEnv } = await import('@mini-inbox/config');
    builder = builder.overrideProvider(API_ENV).useValue({ ...loadEnv(apiEnvSchema), ...override });
  }
  const created = (await builder.compile()).createNestApplication();
  await created.init();
  return created;
}

beforeAll(async () => {
  nest = await createApp();
  redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  queue = new Queue(INBOUND_MESSAGE_QUEUE, { connection: redis, prefix: process.env.QUEUE_PREFIX });
});

beforeEach(async () => {
  await queue.obliterate({ force: true });
  await resetDatabase();
  A = await createTenantFixture('A', 'fixture-person');
  B = await createTenantFixture('B', 'fixture-person');
});

afterAll(async () => {
  await queue?.obliterate({ force: true });
  await queue?.close();
  redis?.disconnect();
  await nest?.close();
  await appPool.end();
  await owner.end();
});

const post = (tenantId: string, body: object, target: INestApplication = nest) =>
  request(target.getHttpServer()).post(`/webhook/${tenantId}/message`).send(body);

const rows = async (sql: string, params: unknown[]) => (await owner.query(sql, params)).rows;
const allJobs = () => queue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed', 'prioritized']);

describe('webhook: tenant from the URL', () => {
  it('unknown or malformed tenant → 404, nothing stored or queued', async () => {
    await post('00000000-0000-4000-8000-000000000000', { externalId: 'e1', from: '+966500000001', text: 'hi' }).expect(404);
    await post('not-a-uuid', { externalId: 'e1', from: '+966500000001', text: 'hi' }).expect(404);
    expect(await rows(`SELECT 1 FROM messages WHERE external_id = 'e1'`, [])).toHaveLength(0);
    expect(await allJobs()).toHaveLength(0);
  });

  it('an x-tenant-id header naming B on A\'s URL is ignored: stored under A', async () => {
    const res = await post(A.tenantId, { externalId: 'e1', from: '+966500000001', text: 'hi', tenantId: B.tenantId })
      .set(TENANT_HEADER, B.tenantId)
      .expect(202);
    expect(await rows(`SELECT tenant_id FROM messages WHERE id = $1`, [res.body.messageId])).toEqual([{ tenant_id: A.tenantId }]);
  });

  it('invalid body → 400 without echoing values, nothing stored', async () => {
    const res = await post(A.tenantId, { externalId: '', from: 'secret-sender', text: '   ' }).expect(400);
    expect(JSON.stringify(res.body)).not.toContain('secret-sender');
    expect(res.body.issues.map((i: { path: string }) => i.path).sort()).toEqual(['externalId', 'from', 'text']);
    expect(await allJobs()).toHaveLength(0);
  });
});

describe('webhook: storage and queue', () => {
  it('stores a CUSTOMER message, returns 202 with IDs, and queues an IDs-only job', async () => {
    const res = await post(A.tenantId, { externalId: 'e1', from: '+966500000099', text: 'secret body' }).expect(202);
    const { messageId, conversationId } = res.body;
    expect(await rows(`SELECT sender_type, body, external_id, conversation_id FROM messages WHERE id = $1`, [messageId])).toEqual([
      { sender_type: 'CUSTOMER', body: 'secret body', external_id: 'e1', conversation_id: conversationId },
    ]);
    const jobs = await allJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe(inboundMessageJobId(A.tenantId, messageId));
    expect(jobs[0]!.data).toEqual({ tenantId: A.tenantId, conversationId, messageId });
    expect(JSON.stringify(jobs[0]!.data)).not.toMatch(/secret body|966500000099/);
    expect(jobs[0]!.opts).toMatchObject({ attempts: 5, backoff: { type: 'exponential', delay: 2000 } });
  });

  it('grouping: two messages from the same sender in one tenant → one customer, one conversation', async () => {
    const r1 = await post(A.tenantId, { externalId: 'e1', from: '+966500000002', text: 'one' }).expect(202);
    const r2 = await post(A.tenantId, { externalId: 'e2', from: '+966500000002', text: 'two' }).expect(202);
    expect(r2.body.conversationId).toBe(r1.body.conversationId);
    expect(await rows(`SELECT id FROM customers WHERE tenant_id = $1 AND external_ref = '+966500000002'`, [A.tenantId])).toHaveLength(1);
    expect(await rows(`SELECT id FROM messages WHERE conversation_id = $1`, [r1.body.conversationId])).toHaveLength(2);
  });

  it('idempotent delivery: the same externalId twice → one message, one job, 202 both times', async () => {
    const body = { externalId: 'dup-1', from: '+966500000002', text: 'hi' };
    const r1 = await post(A.tenantId, body).expect(202);
    const r2 = await post(A.tenantId, body).expect(202);
    expect(r2.body).toEqual(r1.body);
    expect(await rows(`SELECT id FROM messages WHERE tenant_id = $1 AND external_id = 'dup-1'`, [A.tenantId])).toHaveLength(1);
    expect(await allJobs()).toHaveLength(1);
  });

  it('concurrent first messages from a new sender → one customer and one conversation', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => post(A.tenantId, { externalId: `c-${i}`, from: '+966500000003', text: `m${i}` })),
    );
    expect(results.map((r) => r.status)).toEqual([202, 202, 202, 202, 202]);
    expect(new Set(results.map((r) => r.body.conversationId)).size).toBe(1);
    expect(await rows(`SELECT id FROM customers WHERE tenant_id = $1 AND external_ref = '+966500000003'`, [A.tenantId])).toHaveLength(1);
    expect(await allJobs()).toHaveLength(5);
  });
});

describe('webhook: tenant isolation', () => {
  it('the same externalId in A and B is stored once in each tenant', async () => {
    const body = { externalId: 'shared-ext', from: '+966500000001', text: 'hi' };
    const ra = await post(A.tenantId, body).expect(202);
    const rb = await post(B.tenantId, body).expect(202);
    expect(ra.body.messageId).not.toBe(rb.body.messageId);
    const stored = await rows(`SELECT tenant_id FROM messages WHERE external_id = 'shared-ext' ORDER BY tenant_id`, []);
    expect(stored.map((r) => r.tenant_id).sort()).toEqual([A.tenantId, B.tenantId].sort());
    const jobIds = (await allJobs()).map((j) => j.id).sort();
    expect(jobIds).toEqual([inboundMessageJobId(A.tenantId, ra.body.messageId), inboundMessageJobId(B.tenantId, rb.body.messageId)].sort());
  });

  it('the same sender in A and B → two customers with different IDs and two conversations', async () => {
    const ra = await post(A.tenantId, { externalId: 'x1', from: '+966500000004', text: 'hi' }).expect(202);
    const rb = await post(B.tenantId, { externalId: 'x2', from: '+966500000004', text: 'hi' }).expect(202);
    expect(ra.body.conversationId).not.toBe(rb.body.conversationId);
    const custs = await rows(`SELECT id, tenant_id FROM customers WHERE external_ref = '+966500000004'`, []);
    expect(custs).toHaveLength(2);
    expect(custs[0].id).not.toBe(custs[1].id);
    // B's conversation is not visible from A's side: each job names its own tenant.
    for (const job of await allJobs()) {
      const conv = await rows(`SELECT tenant_id FROM conversations WHERE id = $1`, [job.data.conversationId]);
      expect(conv).toEqual([{ tenant_id: job.data.tenantId }]);
    }
  });
});

describe('webhook: sender format (one form per person)', () => {
  it('accepts + followed by 8 to 15 digits only; spaces, dashes, emails and missing + → 400, nothing stored', async () => {
    for (const from of ['+966 50 000 0001', '+966-500000001', '966500000001', 'someone@example.com', '+1234567', '+1234567890123456']) {
      const res = await post(A.tenantId, { externalId: `bad-${from}`, from, text: 'hi' }).expect(400);
      expect(res.body.issues.map((i: { path: string }) => i.path)).toEqual(['from']);
      expect(JSON.stringify(res.body)).not.toContain(from);
    }
    expect(await rows(`SELECT id FROM messages WHERE tenant_id = $1 AND external_id LIKE 'bad-%'`, [A.tenantId])).toHaveLength(0);
    expect(await allJobs()).toHaveLength(0);
    await post(A.tenantId, { externalId: 'ok-1', from: '+12345678', text: 'hi' }).expect(202);
    await post(A.tenantId, { externalId: 'ok-2', from: '+123456789012345', text: 'hi' }).expect(202);
  });
});

describe('webhook: message ID reused by a different sender', () => {
  it('→ 409, nothing stored or queued; the original sender\'s retry is still a 202 duplicate', async () => {
    const first = await post(A.tenantId, { externalId: 'reuse-1', from: '+966500000011', text: 'mine' }).expect(202);
    const jobsBefore = (await allJobs()).length;
    const other = await post(A.tenantId, { externalId: 'reuse-1', from: '+966500000022', text: 'not mine' }).expect(409);
    expect(JSON.stringify(other.body)).not.toContain(first.body.messageId);
    expect(await rows(`SELECT id FROM customers WHERE tenant_id = $1 AND external_ref = '+966500000022'`, [A.tenantId])).toHaveLength(0);
    expect((await allJobs()).length).toBe(jobsBefore);
    const retry = await post(A.tenantId, { externalId: 'reuse-1', from: '+966500000011', text: 'mine' }).expect(202);
    expect(retry.body.messageId).toBe(first.body.messageId);
  });
});

describe('webhook: rate limit keys', () => {
  it('keys are tenant-namespaced and never hold the phone number', async () => {
    await post(A.tenantId, { externalId: 'k-1', from: '+966500000051', text: 'hi' }).expect(202);
    const keys = await redis.keys(`t:{${A.tenantId}}:rl:*`);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(keys.join(' ')).not.toContain('966500000051');
  });
});

// The blocks below open and close their own app instances. Closing a second instance resets nestjs-cls global
// state, so every test that uses the shared `nest` app must come before this point.
describe('webhook: Redis unavailable', () => {
  it('fails fast with 503, keeps the message, and a retry after recovery queues it', async () => {
    const down = await createApp({ REDIS_URL: 'redis://127.0.0.1:1' });
    try {
      const body = { externalId: 'r-1', from: '+966500000001', text: 'hi' };
      const started = Date.now();
      await post(A.tenantId, body, down).expect(503);
      expect(Date.now() - started).toBeLessThan(3500);
      expect(await rows(`SELECT id FROM messages WHERE tenant_id = $1 AND external_id = 'r-1'`, [A.tenantId])).toHaveLength(1);
      expect(await allJobs()).toHaveLength(0);
      // The sender retries once the queue is reachable (here: the healthy app instance).
      const retry = await post(A.tenantId, body).expect(202);
      expect((await allJobs()).map((j) => j.id)).toEqual([inboundMessageJobId(A.tenantId, retry.body.messageId)]);
    } finally {
      await down.close();
    }
  });
});

describe('webhook: rate limits', () => {
  it('per sender: over the limit → 429 with Retry-After; another sender and another tenant are unaffected', async () => {
    const limited = await createApp({ WEBHOOK_RATE_PER_SENDER: 2, WEBHOOK_RATE_PER_TENANT: 100 });
    try {
      const send = (tenantId: string, from: string, id: string) =>
        post(tenantId, { externalId: id, from, text: 'hi' }, limited);
      await send(A.tenantId, '+966500000031', 'rl-1').expect(202);
      await send(A.tenantId, '+966500000031', 'rl-2').expect(202);
      const over = await send(A.tenantId, '+966500000031', 'rl-3').expect(429);
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
      expect(await rows(`SELECT id FROM messages WHERE tenant_id = $1 AND external_id = 'rl-3'`, [A.tenantId])).toHaveLength(0);
      await send(A.tenantId, '+966500000032', 'rl-4').expect(202);
      await send(B.tenantId, '+966500000031', 'rl-5').expect(202);
    } finally {
      await limited.close();
    }
  });

  it('per tenant: over the tenant limit → 429 for any sender of that tenant only', async () => {
    const limited = await createApp({ WEBHOOK_RATE_PER_SENDER: 100, WEBHOOK_RATE_PER_TENANT: 2 });
    try {
      await post(A.tenantId, { externalId: 't-1', from: '+966500000041', text: 'hi' }, limited).expect(202);
      await post(A.tenantId, { externalId: 't-2', from: '+966500000042', text: 'hi' }, limited).expect(202);
      await post(A.tenantId, { externalId: 't-3', from: '+966500000043', text: 'hi' }, limited).expect(429);
      await post(B.tenantId, { externalId: 't-4', from: '+966500000043', text: 'hi' }, limited).expect(202);
    } finally {
      await limited.close();
    }
  });

});

describe('webhook: request size', () => {
  it('a body over 32 kB → 413 before it is read; normal messages still pass', async () => {
    const { AppModule } = await import('../src/app.module.js');
    const { configureHttp } = await import('../src/http.js');
    const sized = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureHttp(sized);
    await sized.init();
    try {
      await post(A.tenantId, { externalId: 'big-1', from: '+966500000061', text: 'x'.repeat(40_000) }, sized).expect(413);
      await post(A.tenantId, { externalId: 'small-1', from: '+966500000061', text: 'hi' }, sized).expect(202);
    } finally {
      await sized.close();
    }
  });
});
