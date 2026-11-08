// DEV STAND-IN tenant picker endpoint (workflow/phase-9-plan.md).
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { apiEnvSchema, loadEnv } from '@mini-inbox/config';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app as appPool, createTenantFixture, owner, resetDatabase } from '../../../packages/database/test/db.js';
import { API_ENV } from '../src/config/api-env.js';

async function boot(nodeEnv?: 'production'): Promise<INestApplication> {
  const { AppModule } = await import('../src/app.module.js');
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (nodeEnv) builder = builder.overrideProvider(API_ENV).useValue({ ...loadEnv(apiEnvSchema), NODE_ENV: nodeEnv });
  const app = (await builder.compile()).createNestApplication();
  await app.init();
  return app;
}

let dev: INestApplication;
beforeAll(async () => {
  dev = await boot();
});
beforeEach(async () => {
  await resetDatabase();
  await createTenantFixture('A', 'p');
  await createTenantFixture('B', 'p');
});
afterAll(async () => {
  await dev?.close();
  await appPool.end();
  await owner.end();
});

describe('GET /dev/tenants', () => {
  it('outside production: lists tenant IDs and names only, without a tenant header', async () => {
    const res = await request(dev.getHttpServer()).get('/dev/tenants').expect(200);
    expect(res.body.map((t: { name: string }) => t.name)).toEqual(['tenant-A', 'tenant-B']);
    for (const t of res.body) expect(Object.keys(t).sort()).toEqual(['id', 'name']);
  });

  it('in production: 404', async () => {
    const prod = await boot('production');
    try {
      await request(prod.getHttpServer()).get('/dev/tenants').expect(404);
    } finally {
      await prod.close();
    }
  });
});
