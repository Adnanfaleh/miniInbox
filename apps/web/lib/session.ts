import 'server-only';
import { redirect } from 'next/navigation';
import { api } from './api';
import { homeFor, type Session } from './session-token';
import { currentSession } from './tenant';

/**
 * DEV STAND-IN, NOT AUTHENTICATION: the page needs a session with a chosen tenant that still exists.
 * No session → the start page. A creator without a tenant → the creator picker. The API verifies the tenant
 * again on every call.
 */
export async function requireTenant(): Promise<{ id: string; name: string; role: Session['role'] }> {
  const session = await currentSession();
  if (!session?.tenantId) redirect(homeFor(session));
  const tenant = (await api.devTenants().catch(() => [])).find((t) => t.id === session.tenantId);
  if (!tenant) redirect(session.role === 'creator' ? '/select-tenant' : '/start');
  return { ...tenant, role: session.role };
}

/** The creator picker is only for the Inboxes creator role. Anyone else goes back where they belong. */
export async function requireCreator(): Promise<void> {
  const session = await currentSession();
  if (session?.role !== 'creator') redirect(homeFor(session));
}

/** The start page and "Select tenant" list are only for visitors without a session: Exit first. */
export async function requireNoSession(): Promise<void> {
  const session = await currentSession();
  if (session) redirect(homeFor(session));
}
