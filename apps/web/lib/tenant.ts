import 'server-only';
import { cookies } from 'next/headers';
import { tenantIdSchema } from '@mini-inbox/contracts';

/**
 * DEV STAND-IN, NOT AUTHENTICATION. The tenant chosen on /select-tenant, kept in an httpOnly cookie.
 * Only server code reads it; it is never put in URLs, forms, server-action arguments or client components.
 * The API still verifies the tenant on every call. Real staff login replaces this later.
 */
export const TENANT_COOKIE = 'mi_tenant';

export async function currentTenantId(): Promise<string | null> {
  const parsed = tenantIdSchema.safeParse((await cookies()).get(TENANT_COOKIE)?.value);
  return parsed.success ? parsed.data : null;
}
