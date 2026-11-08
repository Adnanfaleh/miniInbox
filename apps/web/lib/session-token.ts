import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * DEV STAND-IN, NOT AUTHENTICATION. The dashboard session: which role was chosen on the start page and, once
 * picked, which tenant. It is stored in an httpOnly cookie signed with WEB_SESSION_SECRET (HMAC-SHA256), so a value
 * edited in the browser is rejected and treated as "no session". Real staff login replaces this later.
 *
 * - `creator` (Inboxes creator): may move between any tenant's dashboard.
 * - `tenant`: locked to one tenant. Leaving it needs Exit, which clears the session.
 *
 * Kept free of Next.js imports so the signing and the switch rules can be unit tested.
 */
export const sessionSchema = z.discriminatedUnion('role', [
  z.strictObject({ role: z.literal('creator'), tenantId: z.uuid().optional() }),
  z.strictObject({ role: z.literal('tenant'), tenantId: z.uuid() }),
]);

export type Session = z.infer<typeof sessionSchema>;

const mac = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function signSession(session: Session, secret: string): string {
  const payload = Buffer.from(JSON.stringify(sessionSchema.parse(session))).toString('base64url');
  return `${payload}.${mac(payload, secret)}`;
}

/** Returns the session, or null for a missing, malformed, tampered or wrongly signed value. */
export function verifySession(token: string | undefined, secret: string): Session | null {
  if (!token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(payload, secret));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = sessionSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type SwitchDecision = { allowed: true; next: Session } | { allowed: false; reason: 'locked-to-tenant' | 'not-creator' | 'exit-first' };

/** Picking a tenant from "Select tenant" on the start page: only with no session. A tenant session is locked. */
export function decideEnterTenant(current: Session | null, tenantId: string): SwitchDecision {
  if (!current) return { allowed: true, next: { role: 'tenant', tenantId } };
  if (current.role === 'tenant') return { allowed: false, reason: 'locked-to-tenant' };
  return { allowed: false, reason: 'exit-first' };
}

/** Picking a tenant in Inboxes creator mode: only the creator role may switch. */
export function decideCreatorSelect(current: Session | null, tenantId: string): SwitchDecision {
  if (current?.role === 'creator') return { allowed: true, next: { role: 'creator', tenantId } };
  return { allowed: false, reason: current?.role === 'tenant' ? 'locked-to-tenant' : 'not-creator' };
}

/** Where a session belongs: its tenant's inbox, the creator picker, or the start page. */
export function homeFor(session: Session | null): string {
  if (session?.tenantId) return '/';
  return session?.role === 'creator' ? '/select-tenant' : '/start';
}
