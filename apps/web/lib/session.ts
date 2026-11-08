import 'server-only';
import { redirect } from 'next/navigation';
import { api } from './api';
import { currentTenantId } from './tenant';

/**
 * DEV STAND-IN, NOT AUTHENTICATION: the page needs a chosen tenant that still exists. A missing, malformed or
 * unknown tenant cookie sends the user back to the picker. The API verifies the tenant again on every call.
 */
export async function requireTenant(): Promise<{ id: string; name: string }> {
  const id = await currentTenantId();
  if (!id) redirect('/select-tenant');
  const tenant = (await api.devTenants().catch(() => [])).find((t) => t.id === id);
  if (!tenant) redirect('/select-tenant');
  return tenant;
}
