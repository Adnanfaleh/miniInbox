// After seeding, each demo tenant sees only its own conversations through the API (workflow/phase-10-plan.md).
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TENANT_HEADER } from '@mini-inbox/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../../packages/database/src/client.js';
import { SEED_TENANTS, SHARED_PERSON, seed } from '../../../packages/database/src/seed.js';
import { app as appPool, owner, resetDatabase } from '../../../packages/database/test/db.js';

let nest: INestApplication;

beforeAll(async () => {
  await resetDatabase();
  const ownerPrisma = createPrismaClient(process.env.TEST_MIGRATION_DATABASE_URL!);
  await seed(ownerPrisma);
  await ownerPrisma.$disconnect();
  const { AppModule } = await import('../src/app.module.js');
  nest = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
  await nest.init();
});

afterAll(async () => {
  await nest?.close();
  await appPool.end();
  await owner.end();
});

const list = (tenantId: string) => request(nest.getHttpServer()).get('/conversations').set(TENANT_HEADER, tenantId).expect(200);

describe('seeded tenants', () => {
  it('each tenant lists only its own two conversations', async () => {
    const coffee = (await list(SEED_TENANTS.coffee)).body.items;
    const clinic = (await list(SEED_TENANTS.clinic)).body.items;
    expect(coffee).toHaveLength(2);
    expect(clinic).toHaveLength(2);
    const coffeeIds = new Set(coffee.map((c: { id: string }) => c.id));
    expect(clinic.some((c: { id: string }) => coffeeIds.has(c.id))).toBe(false);
  });

  it('the shared person has a separate history in each tenant, and one tenant cannot open the other\'s', async () => {
    const coffeeConv = (await list(SEED_TENANTS.coffee)).body.items.find((c: { customer: { label: string } }) => c.customer.label === SHARED_PERSON);
    const clinicConv = (await list(SEED_TENANTS.clinic)).body.items.find((c: { customer: { label: string } }) => c.customer.label === SHARED_PERSON);
    expect(coffeeConv.customer.id).not.toBe(clinicConv.customer.id);

    const coffeeDetail = await request(nest.getHttpServer()).get(`/conversations/${coffeeConv.id}`).set(TENANT_HEADER, SEED_TENANTS.coffee).expect(200);
    expect(coffeeDetail.body.messages.map((m: { body: string }) => m.body)).toEqual(['مرحبا، كم سعر اللاتيه؟', 'وهل عندكم واي فاي؟']);
    const crossRead = await request(nest.getHttpServer()).get(`/conversations/${coffeeConv.id}`).set(TENANT_HEADER, SEED_TENANTS.clinic).expect(404);
    expect(JSON.stringify(crossRead.body)).not.toContain('اللاتيه');
  });

  it('each tenant\'s persona is its own', async () => {
    const coffee = await request(nest.getHttpServer()).get('/persona').set(TENANT_HEADER, SEED_TENANTS.coffee).expect(200);
    const clinic = await request(nest.getHttpServer()).get('/persona').set(TENANT_HEADER, SEED_TENANTS.clinic).expect(200);
    expect([coffee.body.timeZone, clinic.body.timeZone]).toEqual(['Asia/Riyadh', 'Europe/London']);
    expect(coffee.body.knowledge.map((k: { titleEn: string }) => k.titleEn)).toContain('Menu prices');
    expect(clinic.body.knowledge.map((k: { titleEn: string }) => k.titleEn)).not.toContain('Menu prices');
  });
});
