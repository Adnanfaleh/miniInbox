// DEV STAND-IN channel read endpoint for the customer simulator: tenant isolation and customer-only fields.
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { apiEnvSchema, loadEnv } from '@mini-inbox/config';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app as appPool, createTenantFixture, owner, resetDatabase, type TenantFixture } from '../../../packages/database/test/db.js';
import { API_ENV } from '../src/config/api-env.js';

async function boot(nodeEnv?: 'production'): Promise<INestApplication> {
  const { AppModule } = await import('../src/app.module.js');
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (nodeEnv) builder = builder.overrideProvider(API_ENV).useValue({ ...loadEnv(apiEnvSchema), NODE_ENV: nodeEnv });
  const app = (await builder.compile()).createNestApplication();
  await app.init();
  return app;
}

const PERSON = '+966500000777';
let dev: INestApplication;
let A: TenantFixture;
let B: TenantFixture;

const thread = (tenantId: string, from: string) =>
  request(dev.getHttpServer()).get(`/dev/channel/${tenantId}/messages`).query({ from });

beforeAll(async () => {
  dev = await boot();
});
beforeEach(async () => {
  await resetDatabase();
  // The same person writes to both tenants: one customer record and conversation per tenant.
  A = await createTenantFixture('A', PERSON);
  B = await createTenantFixture('B', PERSON);
  // Explicit, increasing times so the thread order is deterministic.
  let second = 0;
  const add = (t: TenantFixture, sender: string, body: string) =>
    owner.query(
      `INSERT INTO messages (tenant_id, conversation_id, sender_type, body, created_at) VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
      [t.tenantId, t.conversationId, sender, body, ++second],
    );
  await add(A, 'AI', 'ai-reply-A');
  await add(A, 'SYSTEM', 'notice-A');
  await add(A, 'HUMAN', 'staff-reply-A');
  await add(B, 'AI', 'ai-reply-B');
});
afterAll(async () => {
  await dev?.close();
  await appPool.end();
  await owner.end();
});

describe('GET /dev/channel/:tenantId/messages', () => {
  it('returns the sender\'s thread with each tenant, never the other tenant\'s messages', async () => {
    const a = (await thread(A.tenantId, PERSON).expect(200)).body;
    const b = (await thread(B.tenantId, PERSON).expect(200)).body;
    expect(a.messages.map((m: { body: string }) => m.body)).toEqual(['body-A', 'ai-reply-A', 'notice-A', 'staff-reply-A']);
    expect(b.messages.map((m: { body: string }) => m.body)).toEqual(['body-B', 'ai-reply-B']);
    expect(JSON.stringify(b)).not.toContain('-A');
    expect(JSON.stringify(a)).not.toContain('-B');
  });

  it('labels customer, AI, staff and notice messages, and exposes no internal fields', async () => {
    const a = (await thread(A.tenantId, PERSON).expect(200)).body;
    expect(a.mode).toBe('AI');
    expect(a.messages.map((m: { senderType: string }) => m.senderType)).toEqual(['CUSTOMER', 'AI', 'SYSTEM', 'HUMAN']);
    for (const m of a.messages) expect(Object.keys(m).sort()).toEqual(['body', 'createdAt', 'id', 'senderType']);
    expect(Object.keys(a).sort()).toEqual(['messages', 'mode']);
  });

  it('an address that has not written to this tenant gets an empty thread, and nothing is created', async () => {
    const before = (await owner.query(`SELECT count(*)::int AS n FROM customers`)).rows[0].n;
    expect((await thread(A.tenantId, '+966500000999').expect(200)).body).toEqual({ mode: null, messages: [] });
    expect((await owner.query(`SELECT count(*)::int AS n FROM customers`)).rows[0].n).toBe(before);
  });

  it('unknown or malformed tenant → 404; missing or blank sender → 400', async () => {
    await thread('33333333-3333-4333-8333-333333333333', PERSON).expect(404);
    await thread('not-a-uuid', PERSON).expect(404);
    await request(dev.getHttpServer()).get(`/dev/channel/${A.tenantId}/messages`).expect(400);
    await thread(A.tenantId, '   ').expect(400);
  });

  it('ignores an x-tenant-id header: the URL tenant decides, so a header for A cannot read A through B\'s URL', async () => {
    const res = await thread(B.tenantId, PERSON).set('x-tenant-id', A.tenantId).expect(200);
    expect(JSON.stringify(res.body)).not.toContain('-A');
  });

  it('in production: 404', async () => {
    const prod = await boot('production');
    try {
      await request(prod.getHttpServer()).get(`/dev/channel/${A.tenantId}/messages`).query({ from: PERSON }).expect(404);
    } finally {
      await prod.close();
    }
  });
});
