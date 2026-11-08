import 'server-only';
import { cookies } from 'next/headers';
import { loadEnv, webEnvSchema } from '@mini-inbox/config';
import { signSession, verifySession, type Session } from './session-token';

/**
 * DEV STAND-IN, NOT AUTHENTICATION. The dashboard session (role and tenant) lives in a signed httpOnly cookie.
 * Only server code reads it; the tenant is never put in URLs, forms, server-action arguments or client components.
 * The API still verifies the tenant on every call. Real staff login replaces this later.
 */
export const SESSION_COOKIE = 'mi_session';

const env = loadEnv(webEnvSchema);
const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/' };

export async function currentSession(): Promise<Session | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value, env.WEB_SESSION_SECRET);
}

export async function currentTenantId(): Promise<string | null> {
  return (await currentSession())?.tenantId ?? null;
}

/** Server actions only (cookies can't be set while rendering). */
export async function writeSession(session: Session): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, signSession(session, env.WEB_SESSION_SECRET), cookieOptions);
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
