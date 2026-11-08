// Tenant-context isolation tests through the real HTTP stack (CLAUDE.md section 10; workflow/phase-3-plan.md).
// A test-only controller exercises the guard, TenantContext, TenantDb, the Zod pipe and the exception filter.
// Feature endpoints get their own cross-tenant tests in later phases.
import 'reflect-metadata';
import { Body, Controller, Get, NotFoundException, Param, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TENANT_HEADER } from '@mini-inbox/contracts';
import { SenderType, customers, messages } from '@mini-inbox/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
// Shared database fixtures (owner-role setup and snapshots). Must load first: it reads the root .env.
import {
  TEST_DATABASE_URL,
  app as appPool,
  createTenantFixture,
  owner,
  resetDatabase,
  snapshot,
  type TenantFixture,
} from '../../../packages/database/test/db.js';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe.js';
import { TenantContext } from '../src/tenant/tenant-context.service.js';
import { TenantDb } from '../src/database/tenant-db.service.js';

// The API under test connects as app_user to the test database.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';

const messageBody = z.object({ conversationId: z.uuid(), text: z.string().min(1).max(100) });

@Controller('__test')
class ProbeController {
  constructor(
    private readonly tenantContext: TenantContext,
    private readonly db: TenantDb,
  ) {}

  @Get('whoami')
  whoami() {
    return { tenantId: this.tenantContext.tenantId() };
  }

  @Get('customers/:id')
  async customer(@Param('id', new ZodValidationPipe(z.uuid())) id: string) {
    const found = await this.db.run((tx, tenantId) => customers.findById(tx, tenantId, id));
    if (!found) throw new NotFoundException();
    return { id: found.id };
  }

  @Post('messages')
  async message(@Body(new ZodValidationPipe(messageBody)) body: z.infer<typeof messageBody>) {
    const created = await this.db.run((tx, tenantId) =>
      messages.create(tx, tenantId, { conversationId: body.conversationId, senderType: SenderType.HUMAN, body: body.text }),
    );
    return { id: created.id };
  }
}

let nest: INestApplication;
let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  const { AppModule } = await import('../src/app.module.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: [ProbeController] }).compile();
  nest = moduleRef.createNestApplication();
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

describe('TenantHeaderGuard (dev stand-in)', () => {
  it('missing header → 404', async () => {
    await http().get('/__test/whoami').expect(404);
  });

  it('malformed header → 404', async () => {
    await http().get('/__test/whoami').set(TENANT_HEADER, 'not-a-uuid').expect(404);
    await http().get('/__test/whoami').set(TENANT_HEADER, `${A.tenantId}' OR '1'='1`).expect(404);
  });

  it('unknown tenant → 404', async () => {
    await http().get('/__test/whoami').set(TENANT_HEADER, '00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('a valid tenant is placed in context; tenant IDs in the query or body are ignored', async () => {
    const res = await http().get(`/__test/whoami?tenantId=${B.tenantId}`).set(TENANT_HEADER, A.tenantId).expect(200);
    expect(res.body).toEqual({ tenantId: A.tenantId });
  });
});

describe('Cross-tenant access through TenantDb', () => {
  it('B reading A\'s customer by ID → 404; A reading it → 200', async () => {
    await http().get(`/__test/customers/${A.customerId}`).set(TENANT_HEADER, B.tenantId).expect(404);
    const res = await http().get(`/__test/customers/${A.customerId}`).set(TENANT_HEADER, A.tenantId).expect(200);
    expect(res.body).toEqual({ id: A.customerId });
  });

  it('B posting a message into A\'s conversation → 404, and A\'s data is unchanged', async () => {
    const before = await snapshot(A.tenantId);
    const res = await http()
      .post('/__test/messages')
      .set(TENANT_HEADER, B.tenantId)
      .send({ conversationId: A.conversationId, text: 'hello', tenantId: A.tenantId })
      .expect(404);
    expect(res.body).toEqual({ statusCode: 404, message: 'Not Found' });
    expect(await snapshot(A.tenantId)).toEqual(before);
  });

  it('A posting into its own conversation stores the message under A', async () => {
    const res = await http()
      .post('/__test/messages')
      .set(TENANT_HEADER, A.tenantId)
      .send({ conversationId: A.conversationId, text: 'hello', tenantId: B.tenantId })
      .expect(201);
    const row = (await owner.query('SELECT tenant_id, sender_type FROM messages WHERE id = $1', [res.body.id])).rows[0];
    expect(row).toEqual({ tenant_id: A.tenantId, sender_type: 'HUMAN' });
  });

  it('invalid input → 400 listing paths only, without echoing values', async () => {
    const res = await http()
      .post('/__test/messages')
      .set(TENANT_HEADER, A.tenantId)
      .send({ conversationId: 'secret-value-123', text: '' })
      .expect(400);
    expect(JSON.stringify(res.body)).not.toContain('secret-value-123');
    expect(res.body.issues.map((i: { path: string }) => i.path).sort()).toEqual(['conversationId', 'text']);
  });
});
