// Dashboard session (dev stand-in): signed cookie value and the tenant-switch rules.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decideCreatorSelect, decideEnterTenant, homeFor, signSession, verifySession, type Session } from '../lib/session-token';

const SECRET = 'test-secret-test-secret-test-secret-123';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('session token', () => {
  it('round-trips a creator and a tenant session', () => {
    for (const s of [{ role: 'creator' }, { role: 'creator', tenantId: A }, { role: 'tenant', tenantId: A }] as Session[]) {
      expect(verifySession(signSession(s, SECRET), SECRET)).toEqual(s);
    }
  });

  it('rejects an edited payload (tenant lock cannot be lifted or moved by editing the cookie)', () => {
    const token = signSession({ role: 'tenant', tenantId: A }, SECRET);
    const [, sig] = token.split('.');
    for (const forged of [{ role: 'creator' }, { role: 'tenant', tenantId: B }]) {
      const payload = Buffer.from(JSON.stringify(forged)).toString('base64url');
      expect(verifySession(`${payload}.${sig}`, SECRET)).toBeNull();
    }
  });

  it('rejects a wrong secret, garbage and missing values', () => {
    const token = signSession({ role: 'tenant', tenantId: A }, SECRET);
    expect(verifySession(token, `${SECRET}-other`)).toBeNull();
    for (const bad of [undefined, '', 'abc', 'a.b', `${token}.x`, A]) expect(verifySession(bad, SECRET)).toBeNull();
  });

  it('rejects a correctly signed but invalid shape (tenant role without a tenant)', () => {
    const payload = Buffer.from(JSON.stringify({ role: 'tenant' })).toString('base64url');
    const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
    expect(verifySession(`${payload}.${sig}`, SECRET)).toBeNull();
  });
});

describe('tenant switch rules', () => {
  it('a visitor without a session may enter one tenant, which locks the session to it', () => {
    expect(decideEnterTenant(null, A)).toEqual({ allowed: true, next: { role: 'tenant', tenantId: A } });
  });

  it('a locked tenant session can switch through neither select action', () => {
    const locked: Session = { role: 'tenant', tenantId: A };
    expect(decideEnterTenant(locked, B)).toEqual({ allowed: false, reason: 'locked-to-tenant' });
    expect(decideCreatorSelect(locked, B)).toEqual({ allowed: false, reason: 'locked-to-tenant' });
  });

  it('the Inboxes creator may switch freely, but must exit before entering as a tenant', () => {
    expect(decideCreatorSelect({ role: 'creator' }, A)).toEqual({ allowed: true, next: { role: 'creator', tenantId: A } });
    expect(decideCreatorSelect({ role: 'creator', tenantId: A }, B)).toEqual({ allowed: true, next: { role: 'creator', tenantId: B } });
    expect(decideEnterTenant({ role: 'creator', tenantId: A }, B)).toEqual({ allowed: false, reason: 'exit-first' });
  });

  it('without a session the creator picker is refused', () => {
    expect(decideCreatorSelect(null, A)).toEqual({ allowed: false, reason: 'not-creator' });
  });

  it('sends each session to its own home', () => {
    expect(homeFor(null)).toBe('/start');
    expect(homeFor({ role: 'creator' })).toBe('/select-tenant');
    expect(homeFor({ role: 'creator', tenantId: A })).toBe('/');
    expect(homeFor({ role: 'tenant', tenantId: A })).toBe('/');
  });
});
