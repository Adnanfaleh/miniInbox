// Persona API: GET /persona and PUT /persona (CLAUDE.md sections 5 and 10; workflow/phase-8-plan.md).
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TENANT_HEADER, personaCacheKey, type PersonaInput } from '@mini-inbox/contracts';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app as appPool, createTenantFixture, owner, resetDatabase, snapshot, type TenantFixture } from '../../../packages/database/test/db.js';

let nest: INestApplication;
let redis: Redis;
let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  const { AppModule } = await import('../src/app.module.js');
  nest = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
  await nest.init();
  redis = new Redis(process.env.REDIS_URL!);
});

beforeEach(async () => {
  await resetDatabase();
  A = await createTenantFixture('A', 'person-1');
  B = await createTenantFixture('B', 'person-1');
});

afterAll(async () => {
  redis?.disconnect();
  await nest?.close();
  await appPool.end();
  await owner.end();
});

const http = () => request(nest.getHttpServer());
const getPersona = (tenantId: string) => http().get('/persona').set(TENANT_HEADER, tenantId);
const putPersona = (tenantId: string, body: unknown) => http().put('/persona').set(TENANT_HEADER, tenantId).send(body as object);

const valid = (overrides: Partial<PersonaInput> = {}): PersonaInput => ({
  tone: 'Friendly and short',
  replyType: 'friendly',
  languagePreference: 'match_customer',
  replyMaxLength: 400,
  businessInstructions: 'Never promise delivery times.',
  outOfKbMessageEn: 'Let me check with the team.',
  outOfKbMessageAr: 'سأتحقق مع الفريق.',
  outOfHoursMessageEn: 'We are closed now.',
  outOfHoursMessageAr: 'نحن مغلقون الآن.',
  workingDays: 'SUN-THU',
  workStart: '09:00',
  workEnd: '18:00',
  handoffNoticesEnabled: false,
  knowledge: [
    { titleEn: 'Hours', titleAr: 'الساعات', contentEn: 'Open 9 to 6.', contentAr: 'نفتح من 9 إلى 6.' },
    { titleEn: 'Prices', titleAr: 'الأسعار', contentEn: 'Latte 15 SAR.', contentAr: 'اللاتيه 15 ريال.' },
  ],
  ...overrides,
});

describe('tenant isolation', () => {
  it('GET returns only the caller\'s persona and knowledge', async () => {
    const res = await getPersona(B.tenantId).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.tone).toBe('persona-B');
    expect(res.body.knowledge.map((k: { titleEn: string }) => k.titleEn)).toEqual(['kb-B']);
    expect(JSON.stringify(res.body)).not.toMatch(/persona-A|kb-A|tenant_?id/i);
  });

  it('PUT by B changes only B: A\'s persona, knowledge and cache entry are untouched', async () => {
    await redis.set(personaCacheKey(A.tenantId), '{"tenantId":"cached-A"}', 'EX', 60);
    await redis.set(personaCacheKey(B.tenantId), '{"tenantId":"cached-B"}', 'EX', 60);
    const before = await snapshot(A.tenantId);

    await putPersona(B.tenantId, { ...valid(), tenantId: A.tenantId }).expect(200);

    expect(await snapshot(A.tenantId)).toEqual(before);
    expect(await redis.get(personaCacheKey(A.tenantId))).toBe('{"tenantId":"cached-A"}');
    expect(await redis.get(personaCacheKey(B.tenantId))).toBeNull();
    expect((await getPersona(B.tenantId).expect(200)).body.tone).toBe('Friendly and short');
    await redis.del(personaCacheKey(A.tenantId));
  });

  it('missing tenant header → 404', async () => {
    await http().get('/persona').expect(404);
    await http().put('/persona').send(valid()).expect(404);
  });
});

describe('saving', () => {
  it('replaces the persona and the whole knowledge list; the time zone is read-only', async () => {
    const res = await putPersona(A.tenantId, { ...valid(), timeZone: 'Europe/London' }).expect(200);
    expect(res.body).toMatchObject({
      tone: 'Friendly and short',
      replyType: 'friendly',
      languagePreference: 'match_customer',
      workingDays: 'SUN-THU',
      workStart: '09:00',
      workEnd: '18:00',
      handoffNoticesEnabled: false,
      timeZone: 'Asia/Riyadh',
    });
    expect(res.body.knowledge.map((k: { titleEn: string }) => k.titleEn).sort()).toEqual(['Hours', 'Prices']);
    const stored = await owner.query(`SELECT title_en FROM knowledge_entries WHERE tenant_id = $1`, [A.tenantId]);
    expect(stored.rows.map((r) => r.title_en).sort()).toEqual(['Hours', 'Prices']);

    await putPersona(A.tenantId, valid({ knowledge: [] })).expect(200);
    expect((await owner.query(`SELECT 1 FROM knowledge_entries WHERE tenant_id = $1`, [A.tenantId])).rowCount).toBe(0);
  });

  it('a tenant without a persona yet gets 404 on GET and can create one with PUT', async () => {
    await owner.query(`DELETE FROM persona_configs WHERE tenant_id = $1`, [A.tenantId]);
    await getPersona(A.tenantId).expect(404);
    await putPersona(A.tenantId, valid()).expect(200);
    await getPersona(A.tenantId).expect(200);
  });
});

describe('validation (server side)', () => {
  const cases: [string, Partial<PersonaInput> | Record<string, unknown>, string][] = [
    ['unknown working days', { workingDays: 'weekdays' }, 'workingDays'],
    ['bad time format', { workStart: '9am' }, 'workStart'],
    ['start equals end', { workStart: '09:00', workEnd: '09:00' }, 'workEnd'],
    ['reply length too small', { replyMaxLength: 5 }, 'replyMaxLength'],
    ['unknown language', { languagePreference: 'fr' }, 'languagePreference'],
    ['empty tone', { tone: '   ' }, 'tone'],
    ['reply type too long', { replyType: 'x'.repeat(51) }, 'replyType'],
    ['instructions too long', { businessInstructions: 'x'.repeat(4001) }, 'businessInstructions'],
    ['too many knowledge entries', { knowledge: Array.from({ length: 51 }, () => valid().knowledge[0]) }, 'knowledge'],
    ['knowledge entry without content', { knowledge: [{ titleEn: 'a', titleAr: 'b', contentEn: '', contentAr: 'c' }] }, 'knowledge.0.contentEn'],
  ];
  it.each(cases)('%s → 400 naming the field, nothing saved', async (_name, override, path) => {
    const before = await snapshot(A.tenantId);
    const res = await putPersona(A.tenantId, { ...valid(), ...override }).expect(400);
    expect(res.body.issues.map((i: { path: string }) => i.path)).toContain(path);
    expect(await snapshot(A.tenantId)).toEqual(before);
  });
});
